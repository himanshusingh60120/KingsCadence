/**
 * THE MISSING RETRIEVAL LAYER
 * ──────────────────────────────────────────────────────────────────────────
 * Both sample rows in the last run came back `NO GIVE (no finding matched, no
 * event found)` — for DroneUp and Insitu, two companies with a great deal of
 * genuine, recent, checkable news. That is not a copy problem and no prompt
 * change fixes it. The retrieval was empty, so the copywriter had nothing to
 * write from and produced the only thing it could: category prose.
 *
 * The old retrieval was Google News RSS alone, behind five sequential filters
 * (boolean query -> `when:Nd` -> parseable pubDate -> relevance -> positive).
 * Each is individually defensible; multiplied together on a free, rate-limited,
 * increasingly unreliable RSS endpoint they yield zero on most rows.
 *
 * This module adds a real search layer with citations. Google News stays as
 * the last-resort fallback, it is no longer the only door.
 *
 * PROVIDERS, in the order they are tried:
 *   1. OPENAI web_search   — no new key, you already pay for it. Returns
 *                            synthesised text WITH url citations, which is
 *                            what makes the grounding check below possible.
 *   2. TAVILY / SERPER / BRAVE — cheaper and faster per call if you have a key.
 *                            Return raw result lists, no synthesis.
 *   3. Google News RSS     — lib/research.js, unchanged, still there.
 *
 * Nothing here throws. A provider that is not configured, is down, or is rate
 * limited returns empty and the caller degrades to the next one. An outage
 * must look like "no data", never like "no news".
 */

const OPENAI_URL = "https://api.openai.com/v1/responses";

/** Model used for the grounded research calls. Deliberately NOT CHAT_MODEL:
 *  gpt-4o-mini is fine for classification and far too weak for search
 *  synthesis, where the failure mode is confidently mis-attributing a fact to
 *  a source that does not contain it. */
export const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "gpt-4.1";

export function hasOpenAI() {
  return (process.env.OPENAI_API_KEY || "").trim().startsWith("sk-");
}

/** Which raw-list provider is configured, if any. */
export function rawSearchProvider() {
  if ((process.env.TAVILY_API_KEY || "").trim()) return "tavily";
  if ((process.env.SERPER_API_KEY || "").trim()) return "serper";
  if ((process.env.BRAVE_API_KEY || "").trim()) return "brave";
  return null;
}

/** True when this deployment can do grounded research at all. When false the
 *  dossier layer stands down cleanly and the pipeline behaves exactly as it
 *  did before this module existed. */
export function hasWebSearch() {
  return hasOpenAI() || !!rawSearchProvider();
}

async function withTimeout(promise, ms, onTimeoutValue) {
  let t;
  const timeout = new Promise((res) => { t = setTimeout(() => res(onTimeoutValue), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(t); }
}

/**
 * Models return JSON wrapped in prose, fenced, or with a trailing comma more
 * often than anyone admits, and a single parse failure here costs a whole row.
 * Tolerant by design: strip fences, take the outermost brace pair, repair the
 * two failure modes that actually occur.
 */
export function parseLooseJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { /* fall through to repair */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

/**
 * GROUNDED SEARCH: one call, synthesised answer, and the list of URLs the
 * model actually read.
 *
 * The `citations` return value is the important half and the reason this is
 * not just another chat call. It is the evidence set: a claim whose source URL
 * is not in it was not retrieved, it was remembered. `groundedJSON` below uses
 * that to drop unsupported claims mechanically, which is the only reliable
 * defence against a model that has read a lot about DroneUp during training
 * and is happy to tell you about it.
 *
 * @returns {{text: string, citations: Array<{url,title}>, ok: boolean}}
 */
export async function openaiSearch(instructions, input, {
  timeoutMs = 60000,
  contextSize = "medium",
  allowedDomains = null,
  model = RESEARCH_MODEL
} = {}) {
  // EVERY FAILURE USED TO RETURN THE SAME EMPTY SHAPE WITH NO REASON.
  //
  // That is how a whole run came back with `dossier: empty (no sourced
  // research)` on every single row, for DroneUp, DJI and Echodyne alike.
  // Those companies obviously have recent news. The retrieval was erroring,
  // and an erroring retrieval was indistinguishable from an honest "I looked
  // and found nothing" — which is the one distinction the operator needs,
  // because the two have completely different fixes.
  //
  // `error` is now carried out of here and all the way to the Signal column.
  const fail = (error) => ({ text: "", citations: [], ok: false, error });
  if (!hasOpenAI()) return fail("OPENAI_API_KEY missing or malformed");

  const tool = { type: "web_search", search_context_size: contextSize };
  // Up to 100 allowed domains. Used by the person lookup to keep it on
  // professional-profile sources rather than the open web.
  if (allowedDomains && allowedDomains.length) {
    tool.filters = { allowed_domains: allowedDomains.slice(0, 100) };
  }

  const call = async (toolSpec, { withTemperature = true, force = true } = {}) => {
    const payload = {
      model,
      instructions,
      input,
      tools: [toolSpec],
      store: false,
      // ── THE ACTUAL BUG ────────────────────────────────────────────────
      // In the Responses API the model DECIDES whether to call the tool.
      // Handed a "return ONLY a single valid JSON object" instruction, it
      // decided not to: it answered about DroneUp, DJI and Echodyne from
      // memory, emitted well-formed JSON, and never touched the web. No
      // search means no citations, no citations means keepSourced() discards
      // every claim, and every row came back empty.
      //
      // The instruction was doing the damage. Forcing the tool is the fix.
      tool_choice: force ? { type: toolSpec.type } : "auto",
      // The second, independent evidence source. `url_citation` annotations
      // only appear when the model chooses to cite inline; `action.sources`
      // is what the search tool ACTUALLY retrieved, whether or not the model
      // decided to footnote it. Relying on annotations alone meant a real
      // search with no inline citations still looked like a total failure.
      include: ["web_search_call.action.sources"]
    };
    // Several current models reject `temperature` outright with a 400. This
    // is a retrieval call, so temperature was never load-bearing; it is sent
    // when accepted and dropped the moment it is not.
    if (withTemperature) payload.temperature = 0.2;
    return fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}`
      },
      body: JSON.stringify(payload)
    });
  };

  const reason = async (res) => {
    try {
      const j = await res.clone().json();
      return `${res.status} ${(j && j.error && j.error.message) || res.statusText || ""}`.trim().slice(0, 200);
    } catch { return `${res.status} ${res.statusText || ""}`.trim(); }
  };

  try {
    let res = await withTimeout(call(tool), timeoutMs, null);
    if (!res) return fail(`timeout after ${Math.round(timeoutMs / 1000)}s`);

    // Three things 400 here, and all three used to look like "no news":
    //   1. `temperature` unsupported on this model
    //   2. `web_search` unsupported, only the legacy `web_search_preview` is
    //   3. the model name itself is not available to this key
    // Each retry is attempted in turn, and whatever finally fails is reported.
    if (res.status === 400) {
      const first = await reason(res);
      // 1. temperature unsupported on this model
      res = await withTimeout(call(tool, { withTemperature: false }), timeoutMs, null);
      if (!res) return fail(`timeout after retry (first error: ${first})`);
      // 2. forced tool_choice or the `include` field unsupported
      if (res.status === 400) {
        res = await withTimeout(call(tool, { withTemperature: false, force: false }), timeoutMs, null);
        if (!res) return fail(`timeout after retry (first error: ${first})`);
      }
      // 3. `web_search` unsupported, only the legacy preview tool is.
      //    The preview tool does not support domain filters; a wider search
      //    beats no search, so they are dropped rather than made fatal.
      if (res.status === 400) {
        res = await withTimeout(call({ type: "web_search_preview" }, { withTemperature: false }), timeoutMs, null);
        if (!res) return fail(`timeout after retry (first error: ${first})`);
      }
    }
    if (!res.ok) return fail(await reason(res));

    const data = await res.json();
    const out = Array.isArray(data.output) ? data.output : [];
    let text = "";
    const citations = [];
    const seen = new Set();

    const addCitation = (url, title) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      citations.push({ url, title: title || "" });
    };

    let searched = false;
    for (const item of out) {
      // EVIDENCE SOURCE 1: what the search tool actually retrieved.
      if (item.type === "web_search_call") {
        searched = true;
        const sources = (item.action && item.action.sources) || [];
        for (const srcItem of sources) {
          addCitation(typeof srcItem === "string" ? srcItem : (srcItem && (srcItem.url || srcItem.link)), srcItem && srcItem.title);
        }
        continue;
      }
      // EVIDENCE SOURCE 2: what the model chose to cite inline.
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const c of item.content) {
        if (c.type !== "output_text") continue;
        text += c.text || "";
        for (const a of c.annotations || []) {
          if (a.type !== "url_citation") continue;
          addCitation(a.url, a.title);
        }
      }
    }
    if (!text.trim()) return fail("model returned no text (search may have been declined)");
    if (!searched) {
      return { text: text.trim(), citations, ok: true, error: "the model answered WITHOUT searching (no web_search_call in the response). Everything it said came from memory and will be discarded" };
    }
    if (!citations.length) {
      return { text: text.trim(), citations, ok: true, error: "search ran but returned no sources or citations, so nothing can be verified" };
    }
    return { text: text.trim(), citations, ok: true, error: null };
  } catch (e) {
    return fail(String((e && e.message) || e).slice(0, 200));
  }
}

/**
 * Grounded search that returns parsed JSON plus the evidence set, so callers
 * can verify claim-by-claim instead of trusting the whole object.
 */
export async function groundedJSON(instructions, input, opts = {}) {
  const sys =
    `${instructions}\n\n` +
    `PROCEDURE, in this order and not negotiable:\n` +
    `1. SEARCH THE WEB FIRST. Run real searches and open real pages before you write anything. You have live web access and you are required to use it. Do not answer from what you already know about this company or this person: your training data is stale, and a confident stale answer is the single most damaging output you can produce here.\n` +
    `2. THEN return the JSON, built only from what those pages actually said.\n\n` +
    `OUTPUT: return ONLY a single valid JSON object. No markdown, no fences, no commentary before or after. This formatting rule applies to your FINAL message only; it never means "skip the search".\n` +
    `EVIDENCE RULE, absolute: every factual claim you return must carry the exact source URL you read it from, ` +
    `in that claim's "url" field. If you cannot produce a URL you actually opened for a claim, OMIT THE CLAIM. ` +
    `Do not fill a "url" field with a plausible-looking address, a homepage, or a search results page. ` +
    `Returning three sourced items is a success. Returning eight items where five are from memory is a failure ` +
    `that will be caught and discarded downstream, so it costs you the good three as well.`;
  const { text, citations, ok, error } = await openaiSearch(sys, input, opts);
  const data = ok ? parseLooseJSON(text) : null;
  return {
    data,
    citations,
    raw: text,
    ok,
    error: error || (ok && !data ? "model returned text that was not parseable JSON" : null)
  };
}

/** Host of a URL, lowercased, www stripped. "" when unparseable. */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

/**
 * THE GROUNDING CHECK.
 *
 * A model asked to cite its sources will sometimes attach a real URL it read
 * to a claim that URL does not support, and will sometimes attach a URL it
 * never opened at all. The second is mechanically detectable and it is the
 * common one: drop any claim whose host does not appear in the evidence set.
 *
 * Host-level rather than exact-URL matching is deliberate. Annotations point
 * at the canonical article while the model often writes the AMP, syndicated,
 * or query-stringed variant of the same page, and rejecting those would throw
 * away good, genuinely-retrieved facts.
 *
 * This does NOT verify that the source says what the claim says. Nothing at
 * this layer can. It verifies the source was opened, which removes the entire
 * class of failure where a two-year-old memory arrives dressed as this
 * quarter's news with a citation bolted on.
 */
export function keepSourced(items, citations, { requireDate = false } = {}) {
  const hosts = new Set((citations || []).map((c) => hostOf(c.url)).filter(Boolean));
  if (!hosts.size) return [];
  return (Array.isArray(items) ? items : []).filter((it) => {
    if (!it || typeof it !== "object") return false;
    const h = hostOf(it.url);
    if (!h || !hosts.has(h)) return false;
    if (requireDate && !it.date) return false;
    return true;
  });
}

// ── RAW LIST PROVIDERS ────────────────────────────────────────────────────
// Optional. Cheaper per call than a synthesis pass and useful when you want
// headlines rather than an answer. All three normalise to the same shape as
// newsSignals() items so they can be merged with the Google News path.

async function tavily(query, { maxResults, days }) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: (process.env.TAVILY_API_KEY || "").trim(),
      query,
      max_results: maxResults,
      search_depth: "basic",
      topic: "news",
      days
    })
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.results || []).map((x) => ({
    title: x.title || "",
    url: x.url || "",
    snippet: (x.content || "").slice(0, 400),
    date: x.published_date || ""
  }));
}

async function serper(query, { maxResults }) {
  const r = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: {
      "X-API-KEY": (process.env.SERPER_API_KEY || "").trim(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q: query, num: maxResults })
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.news || []).map((x) => ({
    title: x.title || "",
    url: x.link || "",
    snippet: (x.snippet || "").slice(0, 400),
    // Serper returns human strings ("3 days ago"), kept verbatim; the caller
    // treats an unparseable date as unknown rather than guessing at one.
    date: x.date || ""
  }));
}

async function brave(query, { maxResults }) {
  const u = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const r = await fetch(u, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": (process.env.BRAVE_API_KEY || "").trim()
    }
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.results || []).map((x) => ({
    title: x.title || "",
    url: x.url || "",
    snippet: (x.description || "").slice(0, 400),
    date: x.age || x.page_age || ""
  }));
}

/**
 * Raw web/news results from whichever provider is configured. Returns [] when
 * none is, which is a supported state: the dossier runs on openaiSearch alone.
 */
export async function webSearch(query, { maxResults = 8, days = 120, timeoutMs = 12000 } = {}) {
  const provider = rawSearchProvider();
  if (!provider || !query) return [];
  const run =
    provider === "tavily" ? tavily(query, { maxResults, days })
      : provider === "serper" ? serper(query, { maxResults })
        : brave(query, { maxResults });
  try {
    const items = await withTimeout(run, timeoutMs, []);
    return (items || []).filter((x) => x.title && x.url);
  } catch { return []; }
}
