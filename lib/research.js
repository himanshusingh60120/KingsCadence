import * as cheerio from "cheerio";
import { chatJSON } from "./ai";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function get(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; } finally { clearTimeout(t); }
}

/** What does this company actually do? (title, meta description, og, h1/h2 text) */
export async function companyWebsiteIntel(website) {
  const out = { description: "", keywords: "" };
  if (!website) return out;
  let domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  for (const scheme of ["https://", "https://www."]) {
    const html = await get(scheme + domain);
    if (!html) continue;
    const $ = cheerio.load(html);
    const bits = [
      $('meta[name="description"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $("title").first().text(),
      $("h1").slice(0, 2).text(),
      $("h2").slice(0, 3).text()
    ].filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim());
    out.description = [...new Set(bits)].join(" | ").slice(0, 900);
    out.keywords = ($('meta[name="keywords"]').attr("content") || "").slice(0, 300);
    if (out.description) break;
  }
  return out;
}

// Event-oriented terms used to boost recall on genuine corporate developments
// (your point 5): M&A, capacity, closures, geo expansion, launches, JVs,
// partnerships, investment, big deals, price/input-cost moves, regulation.
const EVENT_TERMS =
  '(expansion OR "capacity expansion" OR acquisition OR merger OR acquires OR "joint venture" OR ' +
  'partnership OR partners OR investment OR invests OR "new plant" OR facility OR closure OR ' +
  '"shuts down" OR launch OR launches OR "new product" OR contract OR "supply deal" OR ' +
  '"price increase" OR tariff OR regulation OR regulatory OR earnings OR revenue)';

/**
 * Latest news: company-specific (broad + event-boosted) and industry-level.
 * Google News RSS, no API key. Recall lives here; precision (typing real
 * events) is done separately in classifyEvents().
 */
export async function newsSignals(companyName, industry) {
  const items = [];
  const queries = [];
  if (companyName) {
    queries.push({ q: `"${companyName}" when:90d`, scope: "company" });
    queries.push({ q: `"${companyName}" ${EVENT_TERMS} when:120d`, scope: "company" });
  }
  if (industry) {
    queries.push({ q: `"${industry}" ${EVENT_TERMS} when:30d`, scope: "industry" });
  }

  for (const { q, scope } of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await get(url, 7000);
    if (!xml) continue;
    const matches = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
    for (const m of matches.slice(0, 6)) {
      const title = m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (title && !items.some((i) => i.title === title)) {
        items.push({ title, date: m[2], scope });
      }
    }
  }
  const newsSummary = items.slice(0, 12)
    .map((i) => `[${i.scope}] ${i.title} (${(i.date || "").slice(0, 16)})`)
    .join("\n");
  return { items, newsSummary };
}

const EVENT_TAXONOMY = [
  "M&A (acquisition / merger / takeover)",
  "Capacity expansion (new plant, line, or output increase)",
  "Facility closure or downsizing",
  "Geographic expansion (new country / region entry)",
  "New product or technology launch",
  "Joint venture",
  "Partnership / collaboration agreement",
  "Investment announcement (capex, funding, stake)",
  "Major customer / purchase / supply deal",
  "Price increase (product, raw material, or input cost move)",
  "Regulatory change affecting the company or sector",
  "Earnings / revenue milestone"
].join("; ");

/**
 * Turn noisy headlines into a short list of TYPED, real events, each with an
 * "angle": the specific decision, cost, or risk the event forces on the
 * prospect. That angle is what EMAIL 1 opens on.
 *
 * Two filters run here: NOISE (stock moves, listicles, same-name-different-
 * company) and, crucially, RELEVANCE. Every event is judged against what the
 * target company ACTUALLY does (companyDesc, scraped from its own site), so a
 * generic industry headline about some OTHER player (a competitor, OEM, or
 * university) with no bearing on the target is dropped rather than dressed up
 * as the prospect's own opportunity. e.g. an aviation *insurer* should not be
 * pitched a jet-engine maker's new factory. Returns [] on no relevant signal
 * so the engine cleanly falls back to a sector-level opener.
 */
export async function classifyEvents(companyName, industry, news, companyDesc = "") {
  const items = (news && news.items) || [];
  if (!items.length) return [];

  const headlines = items
    .slice(0, 12)
    .map((i, n) => `${n + 1}. [${i.scope}] ${i.title} (${(i.date || "").slice(0, 16)})`)
    .join("\n");

  const system =
    "You are a corporate-development analyst for an advisory firm. From raw news " +
    "headlines you extract GENUINE business events and, for each, the strategic " +
    "question it forces on THIS SPECIFIC company's leadership. You are ruthless on TWO axes. " +
    "NOISE: discard stock-price moves, analyst ratings, listicles/round-ups, generic " +
    "market-size stories, and any headline clearly about a different company with a similar name. " +
    "RELEVANCE: judge every event against what the target company ACTUALLY does (given below). " +
    "A development at some OTHER organization (a competitor, supplier, OEM, university, or agency) " +
    "counts only if it plausibly changes THIS company's own decisions, costs, risks, or opportunities. " +
    "A generic industry headline that does not specifically touch this company is NOT an event for it. " +
    "An irrelevant event is worse than none. Return ONLY valid JSON.";

  const user =
    `Target company: "${companyName || "?"}"\n` +
    `Industry / sector: "${industry || "?"}"\n` +
    `What the target company ACTUALLY does (from its own website): ${companyDesc ? `"${String(companyDesc).slice(0, 700)}"` : "(unknown; infer conservatively from the name and sector, and lean toward dropping third-party news)"}\n\n` +
    `Event types to use: ${EVENT_TAXONOMY}.\n\n` +
    `Headlines:\n${headlines}\n\n` +
    `For each event also set "relevance":\n` +
    `- "direct": about the target company itself, OR a market / regulatory / supply-chain shift that genuinely affects what the target does.\n` +
    `- "peripheral": real industry news, but about other players, with no specific line to the target's own decisions.\n\n` +
    `Return JSON of the form:\n` +
    `{"events":[{"type":"<one event type above>","scope":"company|industry","relevance":"direct|peripheral",` +
    `"recency":"<date if known, else empty>","what":"<one-sentence factual summary of the event>",` +
    `"angle":"<the specific decision, cost, or risk this forces on THIS company, phrased as an advisor would raise it. If the event is about another organization, phrase it as the market signal it creates for the target, NEVER as a move the target can 'leverage' or is party to>"}]}\n\n` +
    `Rules: keep at most 4 events, strongest first, prefer company-scope and "direct". ` +
    `Do NOT stretch to make an unrelated third-party move look relevant, mark it "peripheral". ` +
    `If NO genuine, relevant event is present, return {"events":[]}. Never invent an event that is not supported by a headline.`;

  try {
    const out = await chatJSON(system, user, { temperature: 0.4, maxTokens: 800 });
    const events = Array.isArray(out.events) ? out.events : [];
    return events
      .filter((e) => e && e.type && (e.what || e.angle))
      // Keep only events that genuinely bear on THIS company: either about the
      // company itself (company-scope, inherently relevant) or explicitly judged
      // "direct". Generic third-party industry news ("peripheral") is dropped so
      // the engine falls back to a sector-level opener instead of pitching an
      // unrelated company's move as the prospect's opportunity.
      .filter((e) => e.scope === "company" || e.relevance === "direct")
      .slice(0, 4)
      .map((e) => ({
        type: String(e.type).slice(0, 60),
        scope: e.scope === "industry" ? "industry" : "company",
        relevance: e.relevance === "peripheral" ? "peripheral" : "direct",
        recency: (e.recency || "").toString().slice(0, 16),
        what: (e.what || "").toString().slice(0, 300),
        angle: (e.angle || "").toString().slice(0, 300)
      }));
  } catch {
    return [];
  }
}
