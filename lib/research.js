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

/** What does this company actually do? Meta/headings PLUS the company's own
 *  paragraph text, so the email can be grounded in real, retrieved fact rather
 *  than an invented "industry trend". */
// Best-effort real company name from a homepage: og:site_name and app-name are
// the cleanest; else the <title> with taglines and filler stripped. Rejects
// anything that is empty, over-long, or still looks like a bare domain.
function deriveCompanyName($, domain) {
  const cands = [
    $('meta[property="og:site_name"]').attr("content"),
    $('meta[name="application-name"]').attr("content"),
    $('meta[name="apple-mobile-web-app-title"]').attr("content")
  ].map((s) => (s || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  let name = cands[0] || "";
  if (!name) {
    // Split the <title> on common separators, drop pure-filler segments
    // ("Home", "Welcome") wherever they sit, and take the first real segment.
    const title = ($("title").first().text() || "").replace(/\s+/g, " ").trim();
    const filler = /^(home|homepage|welcome|welcome to|about|about us|contact|menu|official site|official website)$/i;
    const segs = title
      .split(/[|\-–—:•·]/)
      .map((s) => s.replace(/^(welcome to)\s+/i, "").trim())
      .filter((s) => s && !filler.test(s));
    name = segs[0] || "";
  }
  const looksDomain = /\.[a-z]{2,}$/i.test(name) && !name.includes(" ");
  if (!name || name.length < 2 || name.length > 60 || looksDomain) return "";
  return name;
}

export async function companyWebsiteIntel(website) {
  const out = { description: "", keywords: "", siteText: "", companyName: "" };
  if (!website) return out;
  let domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  for (const scheme of ["https://", "https://www."]) {
    const html = await get(scheme + domain);
    if (!html) continue;
    const $ = cheerio.load(html);
    out.companyName = deriveCompanyName($, domain);
    const bits = [
      $('meta[name="description"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $("title").first().text(),
      $("h1").slice(0, 2).text(),
      $("h2").slice(0, 3).text()
    ].filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim());
    out.description = [...new Set(bits)].join(" | ").slice(0, 900);
    out.keywords = ($('meta[name="keywords"]').attr("content") || "").slice(0, 300);
    // Real body copy: the company's own words about what it does and who it
    // serves. This is the grounded substance for prospects with no news event.
    $("script, style, nav, footer, header, noscript, svg, form").remove();
    const paras = $("p, li")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length >= 40 && t.length <= 300);
    out.siteText = [...new Set(paras)].slice(0, 10).join(" ").slice(0, 1400);
    if (out.description || out.siteText) break;
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

// Names this short are almost always ambiguous against unrelated news (a
// 3-4 letter acronym like "DPC" or "bcci" collides with other orgs, sports
// teams, tickers). Anchoring the query with the industry cuts that noise.
function isAmbiguousName(name) {
  const n = (name || "").trim();
  return !n || n.length <= 5 || !/\s/.test(n);
}

// Smaller companies publish real news far less often than large ones, so a
// fixed 90-day window under-collects for them while over-collecting noise
// for large ones. Widen the window when size signals are small or unknown;
// tighten slightly when the company is clearly large (news volume is high,
// so older items are less likely to still be the freshest genuine signal).
function windowForCompanySize(headCount, revenue) {
  const hc = parseInt(String(headCount || "").replace(/[^0-9]/g, ""), 10) || 0;
  const rev = parseInt(String(revenue || "").replace(/[^0-9]/g, ""), 10) || 0;
  if (hc && hc < 200) return 150;
  if (rev && rev < 50) return 150; // revenue sheets are typically in $M
  if (hc && hc > 5000) return 75;
  return 90;
}

/**
 * Latest news: company-specific (broad + event-boosted), the company's own
 * domain (press releases, certifications - the hyperpersonalization detail
 * that survives when there's no external news event), and industry-level.
 * Google News RSS, no API key. Recall lives here; precision (typing real
 * events) is done separately in classifyEvents().
 *
 * `opts` is additive and optional so existing call sites keep working:
 *   { domain, headCount, revenue, subIndustry }
 */
export async function newsSignals(companyName, industry, opts = {}) {
  const { domain, headCount, revenue, subIndustry, competitors } = opts;
  const items = [];
  const queries = [];
  const ambiguous = isAmbiguousName(companyName);
  const companyWindow = windowForCompanySize(headCount, revenue);

  if (companyName) {
    const nameTerm = ambiguous && industry ? `"${companyName}" "${industry}"` : `"${companyName}"`;
    queries.push({ q: `${nameTerm} when:${companyWindow}d`, scope: "company" });
    queries.push({ q: `"${companyName}" ${EVENT_TERMS} when:${companyWindow + 30}d`, scope: "company" });
  }
  // COMPETITOR WATCH: a rival's move is the highest-value hook we have. The
  // reader already knows everything about their own company; what they lack is
  // visibility into what competitors are doing to their market and share, and
  // that information deficit is exactly what an intelligence firm sells. So we
  // actively search the named competitors' news, not just the prospect's own.
  for (const comp of (competitors || []).slice(0, 3)) {
    const cname = String(comp && comp.name ? comp.name : comp || "").trim();
    if (!cname || cname.toLowerCase() === (companyName || "").toLowerCase()) continue;
    queries.push({ q: `"${cname}" ${EVENT_TERMS} when:${companyWindow}d`, scope: "competitor" });
  }
  // The company's own domain: catches press releases, certifications, and
  // named services that never get picked up by third-party coverage. This is
  // the material that keeps a "no external event" prospect from falling back
  // to a generic category description in the email.
  if (domain) {
    const bareDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (bareDomain) queries.push({ q: `site:${bareDomain} when:180d`, scope: "own-site" });
  }
  if (industry) {
    const industryTerm = subIndustry ? `"${subIndustry}"` : `"${industry}"`;
    queries.push({ q: `${industryTerm} ${EVENT_TERMS} when:30d`, scope: "industry" });
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
  "Strategic pivot / business model change / repositioning (a shift in what the company focuses on or sells)",
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
  "Competitor move (a named rival's expansion, launch, deal, pricing move, or exit that shifts the target's market)",
  "Leadership or organizational change",
  "Earnings / revenue milestone",
  "Other notable corporate development"
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
    "question it forces on THIS SPECIFIC company's leadership. You are ruthless on THREE axes. " +
    "NOISE: discard stock-price moves, analyst ratings, listicles/round-ups, generic " +
    "market-size stories, and any headline clearly about a different company with a similar name. " +
    "RELEVANCE: judge every event against what the target company ACTUALLY does (given below). " +
    "A development at some OTHER organization counts only if it plausibly changes THIS company's " +
    "own decisions, costs, risks, or opportunities. A generic industry headline that does not " +
    "specifically touch this company is NOT an event for it. An irrelevant event is worse than none. " +
    "SENSITIVITY: a negative or embarrassing event at the TARGET company itself (an executive " +
    "detained or arrested, a lawsuit, a criminal or regulatory probe INTO the company, a scandal, " +
    "layoffs, a bankruptcy, a fatal accident, a recall, a data breach, sanctions or fines against it) " +
    "is NEVER usable as a sales hook: cold-emailing an employee about their own company's crisis is " +
    "tone-deaf and destroys trust. Mark such events sensitive so they are excluded. The SAME kind of " +
    "event at a COMPETITOR is different: it is a legitimate market signal for the target (a rival's " +
    "disruption reshapes share), so mark it subject 'competitor', NOT sensitive. " +
    "PRIORITY: a named competitor's or peer's move that plausibly shifts the target's demand, pricing, " +
    "customers, or share is the MOST valuable event type of all, because the target has full information " +
    "about its own moves and near-zero visibility into rivals. Rank a genuinely relevant competitor or " +
    "market/regulatory event ABOVE the target's own good news. Return ONLY valid JSON.";

  const user =
    `Target company: "${companyName || "?"}"\n` +
    `Industry / sector: "${industry || "?"}"\n` +
    `What the target company ACTUALLY does (from its own website): ${companyDesc ? `"${String(companyDesc).slice(0, 700)}"` : "(unknown; infer conservatively from the name and sector, and lean toward dropping third-party news)"}\n\n` +
    `Event types to use: ${EVENT_TAXONOMY}.\n\n` +
    `Headlines:\n${headlines}\n\n` +
    `For each event also set "relevance":\n` +
    `- "direct": about the target company itself, a NAMED competitor's move that plausibly shifts the target's market, OR a market / regulatory / supply-chain shift that genuinely affects what the target does.\n` +
    `- "peripheral": real industry news, but about other players, with no specific line to the target's own decisions.\n\n` +
    `Also set "subject":\n` +
    `- "self": the event is about the target company itself.\n` +
    `- "competitor": the event is a named rival's or peer's move in the target's market.\n` +
    `- "market": a regulatory, demand, supply-chain, or customer-side shift not owned by any one player.\n\n` +
    `Also set "sensitive": true when the event is negative/embarrassing news about the TARGET company itself ` +
    `(executive detention or arrest, lawsuit, probe into the company, scandal, layoffs, bankruptcy, fatal accident, ` +
    `recall, breach, sanctions/fines against it); otherwise false. A competitor's bad news is NOT sensitive for the target.\n\n` +
    `Return JSON of the form:\n` +
    `{"events":[{"type":"<one event type above>","scope":"company|industry","relevance":"direct|peripheral",` +
    `"subject":"self|competitor|market","sensitive":true|false,` +
    `"recency":"<date if known, else empty>","what":"<one-sentence factual summary that STAYS FAITHFUL to the headline: keep its specific subject and key terms, do not soften, generalize, or drop the core (e.g. a pivot to 'airspace safety' stays 'airspace safety', it does NOT become 'managing air space')>",` +
    `"angle":"<the specific decision, cost, or risk this forces on THIS company, phrased as an advisor would raise it. If the event is about another organization, phrase it as the market signal it creates for the target's share, pricing, or pipeline, NEVER as a move the target can 'leverage' or is party to, and never gloating>"}]}\n\n` +
    `Rules: keep at most 4 events, strongest first. RANKING: (1) a relevant competitor move or market/regulatory shift that bears on the target's share or demand, (2) the target's own positive developments, (3) everything else. Never rank the target's own news first when an equally relevant competitor or market event exists. ` +
    `Pick the type that MOST accurately fits the headline, never force an ill-fitting one, and do NOT default to "Capacity expansion" for a repositioning or an unrelated move; if the company is changing what it focuses on or sells that is a "Strategic pivot / business model change", and if nothing fits well use "Other notable corporate development". ` +
    `Do NOT stretch to make an unrelated third-party move look relevant, mark it "peripheral". ` +
    `If NO genuine, relevant event is present, return {"events":[]}. Never invent an event that is not supported by a headline.`;

  try {
    const out = await chatJSON(system, user, { temperature: 0.4, maxTokens: 900 });
    const events = Array.isArray(out.events) ? out.events : [];
    return events
      .filter((e) => e && e.type && (e.what || e.angle))
      // Keep only events that genuinely bear on THIS company: either about the
      // company itself (company-scope, inherently relevant) or explicitly judged
      // "direct" (which now includes named-competitor moves). Generic third-party
      // industry news ("peripheral") is still dropped.
      .filter((e) => e.scope === "company" || e.relevance === "direct")
      // NEVER anchor outreach on the prospect's OWN bad news (an executive
      // detained, a lawsuit, layoffs, a fatal incident...). The model marks
      // these "sensitive"; a keyword regex is the deterministic backstop so a
      // mis-labelled crisis headline can still never become the hook. The same
      // event at a COMPETITOR is kept: a rival's disruption is a legitimate
      // market signal for the prospect.
      .filter((e) => !isSensitiveForTarget(e))
      .slice(0, 4)
      .map((e) => ({
        type: String(e.type).slice(0, 60),
        scope: e.scope === "industry" ? "industry" : "company",
        relevance: e.relevance === "peripheral" ? "peripheral" : "direct",
        subject: e.subject === "competitor" ? "competitor" : e.subject === "market" ? "market" : "self",
        recency: (e.recency || "").toString().slice(0, 16),
        what: (e.what || "").toString().slice(0, 300),
        angle: (e.angle || "").toString().slice(0, 300)
      }));
  } catch {
    return [];
  }
}

// Negative / crisis vocabulary that must never headline an email about the
// prospect's OWN company. Deliberately broad: losing one legitimate hook is
// cheap; sending "sorry about your VP's detention, want a report?" is fatal.
const SENSITIVE_RE = new RegExp(
  "\\b(detain(?:ed|s|ment)?|arrest(?:ed|s)?|indict(?:ed|ment)?|lawsuit|sued|sues|fraud|scandal|" +
  "probe[sd]?|investigat(?:ed|ion|ing)|layoff[s]?|laid off|job cuts|bankrupt(?:cy)?|insolven(?:t|cy)|" +
  "fatal(?:ity|ities)?|death[s]?|died|killed|data breach|hacked|sanction(?:ed|s)?|fined|penalt(?:y|ies)|" +
  "recall(?:ed|s)?|resign(?:ed|s|ation)?|shutdown of|banned|ban[s]? (?:on|against))\\b", "i");

function isSensitiveForTarget(e) {
  const aboutTarget = e.subject !== "competitor" && e.subject !== "market";
  if (!aboutTarget) return false;
  if (e.sensitive === true) return true;
  return SENSITIVE_RE.test(`${e.what || ""} ${e.type || ""}`);
}

/**
 * "Who else should care?" For each prospect we derive up to 5 NAMED, real
 * competitors / closely similar companies. Two uses:
 *  1. Their news is searched too, so a rival's move can become the prospect's
 *     hook (a far stronger reason to buy intelligence than their own news).
 *  2. They are written to a "Derived Targets" tab as new outreach prospects,
 *     with the detected event as their ready-made signal ("Echodyne just
 *     opened a $40M radar factory, here is what it does to your market").
 * Names come from the model but are used ONLY as search seeds and human-
 * reviewed prospecting suggestions, never stated as fact inside an email.
 */
export async function deriveCompetitors(companyName, industry, companyDesc = "") {
  if (!companyName) return [];
  const system =
    "You are a market analyst. Given a company, its sector, and what it does, name its closest REAL, " +
    "currently-operating competitors or highly similar companies. Only include companies you are " +
    "confident actually exist and genuinely compete in the same space; if you are not sure of any, " +
    "return an empty list. Never invent a company. Return ONLY valid JSON.";
  const user =
    `Company: "${companyName}"\nSector: "${industry || "?"}"\n` +
    `What it does: ${companyDesc ? `"${String(companyDesc).slice(0, 600)}"` : "(unknown)"}\n\n` +
    `Return {"competitors":[{"name":"<real company name>","why":"<one short line: what they compete on>"}]} with at most 5 entries, strongest overlap first.`;
  try {
    const out = await chatJSON(system, user, { temperature: 0.3, maxTokens: 400 });
    const list = Array.isArray(out.competitors) ? out.competitors : [];
    return list
      .filter((c) => c && c.name && String(c.name).trim().length >= 2)
      .slice(0, 5)
      .map((c) => ({
        name: String(c.name).trim().slice(0, 80),
        why: String(c.why || "").trim().slice(0, 200)
      }));
  } catch {
    return [];
  }
}
