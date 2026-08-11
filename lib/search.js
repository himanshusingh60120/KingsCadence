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
  const empty = { text: "", citations: [], ok: false };
  if (!hasOpenAI()) return empty;

  const tool = { type: "web_search", search_context_size: contextSize };
  // Up to 100 allowed domains. Used by the person lookup to keep it on
  // professional-profile sources rather than the open web.
  if (allowedDomains && allowedDomains.length) {
    tool.filters = { allowed_domains: allowedDomains.slice(0, 100) };
  }

  const call = async (toolSpec) => {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}`
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        tools: [toolSpec],
        // Deterministic-ish: this is retrieval, not copywriting. Creativity
        // here shows up as invented detail.
        temperature: 0.2,
        store: false
      })
    });
    return r;
  };

  try {
    let res = await withTimeout(call(tool), timeoutMs, null);
    if (!res) return empty;

    // `web_search` is the current tool; `web_search_preview` is the legacy
    // name and is all that some accounts/models accept. Retry once rather
    // than making the operator diagnose a 400.
    if (res.status === 400) {
      const legacy = { type: "web_search_preview" };
      if (allowedDomains && allowedDomains.length) {
        // The preview tool does not support filters. Drop them rather than
        // fail: a wider search is better than no search.
      }
      res = await withTimeout(call(legacy), timeoutMs, null);
      if (!res) return empty;
    }
    if (!res.ok) return empty;

    const data = await res.json();
    const out = Array.isArray(data.output) ? data.output : [];
    let text = "";
    const citations = [];
    const seen = new Set();

    for (const item of out) {
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const c of item.content) {
        if (c.type !== "output_text") continue;
        text += c.text || "";
        for (const a of c.annotations || []) {
          if (a.type !== "url_citation" || !a.url) continue;
          if (seen.has(a.url)) continue;
          seen.add(a.url);
          citations.push({ url: a.url, title: a.title || "" });
        }
      }
    }
    return { text: text.trim(), citations, ok: !!text.trim() };
  } catch {
    return empty;
  }
}

/**
 * Grounded search that returns parsed JSON plus the evidence set, so callers
 * can verify claim-by-claim instead of trusting the whole object.
 */
export async function groundedJSON(instructions, input, opts = {}) {
  const sys =
    `${instructions}\n\n` +
    `OUTPUT: return ONLY a single valid JSON object. No markdown, no fences, no commentary before or after.\n` +
    `EVIDENCE RULE, absolute: every factual claim you return must carry the exact source URL you read it from, ` +
    `in that claim's "url" field. If you cannot produce a URL you actually opened for a claim, OMIT THE CLAIM. ` +
    `Do not fill a "url" field with a plausible-looking address, a homepage, or a search results page. ` +
    `Returning three sourced items is a success. Returning eight items where five are from memory is a failure ` +
    `that will be caught and discarded downstream, so it costs you the good three as well.`;
  const { text, citations, ok } = await openaiSearch(sys, input, opts);
  return { data: ok ? parseLooseJSON(text) : null, citations, raw: text, ok };
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
