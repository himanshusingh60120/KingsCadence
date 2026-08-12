/**
 * THE RETRIEVAL LAYER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * THREE FAILED RUNS, ONE ARCHITECTURAL MISTAKE BEHIND ALL OF THEM.
 *
 * Run 1: every row empty and silent. Five exits returned the same empty
 *        object with no reason. Total failure was indistinguishable from
 *        "this company has no news".
 *
 * Run 2: `no url citations returned`. The model was never calling the tool.
 *        In the Responses API the tool is OFFERED, not compelled, and an
 *        instruction demanding "ONLY a single valid JSON object" made
 *        answering from memory the efficient choice. Fixed with tool_choice.
 *
 * Run 3: `search ran but returned no sources or citations`. The tool WAS
 *        called. But `url_citation` annotations attach to PROSE, and a bare
 *        JSON blob is not prose, so nothing was annotated. The sourcing check
 *        then correctly discarded everything.
 *
 * All three are the same root mistake: ONE CALL DOING TWO JOBS. Searching
 * wants prose, citations and room to work. Structuring wants terse JSON and
 * nothing else. Demanding both in one request means the JSON requirement
 * quietly suppresses the evidence the whole design depends on.
 *
 * THE FIX IS TO SPLIT THEM.
 *
 *   STAGE 1  research()   web search forced, PROSE out, URLs inline.
 *                         Retrieval and evidence happen here.
 *   STAGE 2  structure()  cheap, tool-free, turns that prose into the JSON
 *                         the caller asked for. No search, no new facts.
 *
 * Evidence is then collected from THREE independent places, so no single API
 * quirk can empty it:
 *   1. `web_search_call.action.sources`  what the tool actually retrieved
 *   2. `url_citation` annotations        what the model chose to footnote
 *   3. URLs parsed out of the prose      what it wrote down itself
 *
 * (3) is the one that makes this robust: the prose is explicitly instructed to
 * carry a URL beside every fact, so it works even if the API attaches nothing.
 *
 * Nothing throws. Every failure carries a reason all the way to the sheet.
 */

const OPENAI_URL = "https://api.openai.com/v1/responses";

/** Model used for the grounded research calls. Deliberately NOT CHAT_MODEL:
 *  gpt-4o-mini is fine for classification and far too weak for search
 *  synthesis, where the failure mode is confidently mis-attributing a fact to
 *  a source that does not contain it. */
export const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "gpt-4.1";
// If the configured model is unavailable to this key, or does not support the
// web search tool, these are tried in order rather than failing the row. Model
// availability changes constantly and must never be the thing that silently
// empties an entire run.
const MODEL_LADDER = [...new Set([RESEARCH_MODEL, "gpt-4.1", "gpt-4o"])];

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
/* ═════════════════════════════════════════════════════════════════════════
   STAGE 1: RESEARCH. Forced web search, prose out, evidence collected.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * @returns {{text, citations, queries, searched, ok, error, model}}
 */
export async function research(brief, question, {
  timeoutMs = 90000,
  contextSize = "high",
  allowedDomains = null
} = {}) {
  const base = { text: "", citations: [], queries: [], searched: false, ok: false, error: null, model: null };
  if (!hasOpenAI()) return { ...base, error: "OPENAI_API_KEY missing or malformed" };

  const instructions =
    `${brief}\n\n` +
    `HOW TO WORK, and none of this is optional:\n` +
    `1. SEARCH THE WEB FIRST, several times, with different phrasings. You have live web access and you are required to use it. Do not answer from what you already know: your training data is stale, and a confident stale answer is the most damaging thing you can produce here.\n` +
    `2. Open the pages. Read them. Report only what they actually say.\n` +
    `3. WRITE THE FULL URL INLINE, in plain text, immediately after every fact you report, like this: "Company X won a $40m contract on 2026-06-02 (https://example.com/the-article)". Every fact, no exceptions. A fact with no URL beside it is discarded downstream, so it is wasted work.\n` +
    `4. Give exact dates as YYYY-MM-DD wherever the page states one. If a page carries no verifiable date, say so rather than estimating.\n` +
    `5. If your searches genuinely turn up nothing on a point, write "NOTHING FOUND" for it. That is a real and useful answer. Filling the gap from memory is not.\n\n` +
    `Write plain prose. No JSON, no tables, no code fences: another step reads this and structures it.`;

  const buildPayload = (model, toolSpec, { force, include, temperature }) => {
    const p = { model, instructions, input: question, tools: [toolSpec], store: false };
    if (force) p.tool_choice = { type: toolSpec.type };
    if (include) p.include = ["web_search_call.action.sources"];
    if (temperature) p.temperature = 0.2;
    return p;
  };

  const post = (payload) => fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}`
    },
    body: JSON.stringify(payload)
  });

  const reasonOf = async (res) => {
    try {
      const j = await res.clone().json();
      return `${res.status} ${(j && j.error && j.error.message) || res.statusText || ""}`.trim().slice(0, 220);
    } catch { return `${res.status} ${res.statusText || ""}`.trim(); }
  };

  const tool = { type: "web_search", search_context_size: contextSize };
  if (allowedDomains && allowedDomains.length) {
    tool.filters = { allowed_domains: allowedDomains.slice(0, 100) };
  }

  // Each rung drops one thing a given model or account might reject, so an
  // unsupported field degrades the request instead of emptying the run.
  const rungs = [
    { toolSpec: tool, force: true, include: true, temperature: true },
    { toolSpec: tool, force: true, include: true, temperature: false },
    { toolSpec: tool, force: true, include: false, temperature: false },
    { toolSpec: { type: "web_search" }, force: true, include: false, temperature: false },
    { toolSpec: { type: "web_search_preview" }, force: true, include: false, temperature: false },
    { toolSpec: { type: "web_search_preview" }, force: false, include: false, temperature: false }
  ];

  // ── WHAT THE LADDER IS AND IS NOT FOR ────────────────────────────────
  // It exists for ONE failure: a 400 saying some optional field is not
  // supported by this model or account. It walked on every failure, which
  // meant 3 models x 6 rungs = 18 attempts at up to 90s each, or 27 minutes,
  // against a 275-second function budget. On a 429 it hammered a server that
  // was already asking it to slow down, and on a hung connection it burned
  // the row's whole budget discovering the same hang eighteen times.
  //
  // Now: only a 400 advances a rung. Everything else stops.
  //
  // And the combination that WORKS is remembered process-wide, so the three
  // sections of one dossier and every subsequent row start from the shape
  // that already succeeded instead of re-deriving it.
  const memo = globalThis.__kc_searchShape || (globalThis.__kc_searchShape = {});
  const order = [];
  if (memo.model && memo.rung != null) order.push([memo.model, memo.rung]);
  for (const model of MODEL_LADDER) {
    for (let ri = 0; ri < rungs.length; ri++) {
      if (memo.model === model && memo.rung === ri) continue;
      order.push([model, ri]);
    }
  }

  let lastError = "no attempt was made";
  const deadModels = new Set();
  for (const [model, ri] of order) {
    if (deadModels.has(model)) continue;
    const rung = rungs[ri];
    let res;
    try {
      res = await withTimeout(post(buildPayload(model, rung.toolSpec, rung)), timeoutMs, null);
    } catch (e) {
      // A network throw is not a "wrong field" signal. Trying five more
      // shapes against the same unreachable host is pure latency.
      return { ...base, error: `network error: ${String((e && e.message) || e).slice(0, 160)}` };
    }
    if (!res) {
      // Same reasoning for a timeout, and it is the expensive one: at 90s a
      // walk through the rest of the ladder outlives the function.
      return { ...base, error: `timed out after ${Math.round(timeoutMs / 1000)}s on ${model}`, model };
    }
    if (!res.ok) {
      lastError = `${model}: ${await reasonOf(res)}`;
      // Rate limited or server-side: retrying a different SHAPE cannot help,
      // and retrying at all makes a 429 worse.
      if (res.status === 429 || res.status >= 500) {
        return { ...base, error: lastError, model };
      }
      // Auth is a deployment fault. Eighteen 401s is still one 401.
      if (res.status === 401 || res.status === 403) {
        return { ...base, error: lastError, model };
      }
      // The model itself is unavailable: no rung varies the model, so skip
      // its remaining rungs entirely.
      if (res.status === 404 || (/model/i.test(lastError) && /not (found|exist)|do not have access|unsupported model/i.test(lastError))) {
        deadModels.add(model);
        continue;
      }
      if (res.status === 400) continue;   // the one case a rung can fix
      return { ...base, error: lastError, model };
    }

      let data;
      try { data = await res.json(); } catch { lastError = `${model}: response was not JSON`; continue; }

      const out = Array.isArray(data.output) ? data.output : [];
      const citations = [];
      const queries = [];
      const seen = new Set();
      const add = (url, title) => {
        if (!url) return;
        const clean = String(url).trim().replace(/[.,;:]+$/, "");
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        citations.push({ url: clean, title: title || "" });
      };

      let text = "";
      let searched = false;
      for (const item of out) {
        if (item.type === "web_search_call") {
          searched = true;
          if (item.action && item.action.query) queries.push(String(item.action.query).slice(0, 120));
          for (const src of (item.action && item.action.sources) || []) {
            add(typeof src === "string" ? src : (src && (src.url || src.link)), src && src.title);
          }
          continue;
        }
        if (item.type !== "message" || !Array.isArray(item.content)) continue;
        for (const c of item.content) {
          if (c.type !== "output_text") continue;
          text += c.text || "";
          for (const a of c.annotations || []) {
            if (a.type === "url_citation") add(a.url, a.title);
          }
        }
      }
      // EVIDENCE SOURCE 3, and the one that makes this robust: the prose was
      // instructed to carry URLs inline, so this works even when the API
      // attaches no annotations and no sources at all.
      for (const u of urlsInText(text)) add(u, "");

      if (!text.trim()) { lastError = `${model}: returned no text`; continue; }

      if (memo.model !== model || memo.rung !== ri) {
        memo.model = model;
        memo.rung = ri;
        if (ri > 0 || model !== MODEL_LADDER[0]) {
          console.error(`[search] settled on model="${model}" rung=${ri} (earlier shapes rejected: ${lastError})`);
        }
      }
      return {
        text: text.trim(), citations, queries, searched, ok: true, model,
        error: searched
          ? (citations.length ? null : "search ran but produced no URLs at all")
          : "the model answered WITHOUT searching (no web_search_call in the response)"
      };
  }
  return { ...base, error: lastError };
}

/* ═════════════════════════════════════════════════════════════════════════
   STAGE 2: STRUCTURE. No tools, no search, no chance to invent.
   ═════════════════════════════════════════════════════════════════════════ */

async function structure(prose, schemaInstruction, { model = process.env.CHAT_MODEL || "gpt-4o-mini" } = {}) {
  const system =
    "You convert a research briefing into JSON. You are a FORMATTER, not a researcher.\n\n" +
    "ABSOLUTE: use only what is written in the briefing. Do not add a fact, a company, a date, a figure or " +
    "a URL that is not already there. If the briefing says NOTHING FOUND for something, return an empty list " +
    "for it. Adding anything of your own defeats the entire point of the step before this one.\n\n" +
    "Every item you output must carry the URL that appeared beside that fact in the briefing. If a fact has " +
    "no URL beside it, DROP IT: it will be discarded downstream anyway.\n\n" +
    "Return ONLY the JSON object. No markdown, no fences, no commentary.";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(process.env.OPENAI_API_KEY || "").trim()}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `RESEARCH BRIEFING:\n${prose}\n\n${schemaInstruction}` }
        ]
      })
    });
    if (!res.ok) return { data: null, error: `structuring call failed: ${res.status}` };
    const j = await res.json();
    const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const data = parseLooseJSON(raw);
    return { data, error: data ? null : "structuring call returned unparseable JSON" };
  } catch (e) {
    return { data: null, error: `structuring call threw: ${String((e && e.message) || e).slice(0, 150)}` };
  }
}

/**
 * Research, then structure, carrying stage 1's evidence set through so
 * `keepSourced` can check stage 2's output against what was truly retrieved.
 */
export async function groundedJSON(brief, question, opts = {}) {
  // The schema sits at the end of `question` as a "Return: {...}" block.
  // Stage 1 is better WITHOUT it: a schema inside a research prompt pulls the
  // model straight back toward terse JSON, which is what suppressed the
  // citations in the first place.
  const splitAt = question.search(/\nReturn:/);
  const researchQuestion = splitAt > 0 ? question.slice(0, splitAt).trim() : question;
  const schemaInstruction = splitAt > 0 ? question.slice(splitAt).trim() : "Return the JSON object described above.";

  const r = await research(brief, researchQuestion, opts);
  if (!r.ok) {
    return { data: null, citations: [], raw: "", ok: false, error: r.error, searched: false, queries: [], model: r.model };
  }
  const st = await structure(r.text, schemaInstruction);
  return {
    data: st.data,
    citations: r.citations,
    raw: r.text,
    ok: true,
    searched: r.searched,
    queries: r.queries,
    model: r.model,
    error: r.error || st.error || null
  };
}

/** Host of a URL, lowercased, www stripped. "" when unparseable. */
/** URLs written into prose. The third and most robust evidence source: it
 *  survives whatever the API does or does not attach to the response. */
export function urlsInText(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/https?:\/\/[^\s)\]}>"'`,]+/g)) {
    out.push(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...new Set(out)];
}

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
