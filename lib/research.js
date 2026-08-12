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
  // MAX_NEWS_AGE_DAYS is the ceiling for every branch: the brief is that no
  // email may cite anything older than four months. Small companies get the
  // full window because they publish rarely; large ones get less because
  // there is plenty of fresher material.
  if (hc && hc < 200) return MAX_NEWS_AGE_DAYS;
  if (rev && rev < 50) return MAX_NEWS_AGE_DAYS;
  if (hc && hc > 5000) return 75;
  return 90;
}

/**
 * THE FOUR-MONTH CEILING.
 * One number, exported, used by every window calculation and every hard
 * filter below. Previously the size branch could return 150 days while the
 * quarter branch capped at 100 and the fallback ladder stopped at 120: three
 * different answers to the same question, which is how a five-month-old item
 * reached a draft. Anything older than this is not "slightly stale", it is a
 * signal to the reader that nobody is actually watching their market.
 */
export const MAX_NEWS_AGE_DAYS = 120;

/**
 * THE RECENCY WINDOW
 * ────────────────────────────────────────────────────────────────────────
 * Rule: the CURRENT QUARTER. If the quarter has only just started, reach
 * back 8 weeks into the previous one so a January or July run is not
 * working from three headlines.
 *
 * A cold email is only credible if the event is live. "AirMap is shutting
 * down its drone traffic management app" was true in 2023; sent today it
 * tells the reader you are not actually watching their market, which is the
 * one thing you are selling. Stale beats nothing is FALSE in this business.
 */
export function quarterWindowDays(now = new Date()) {
  const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const qStart = new Date(now.getFullYear(), qStartMonth, 1);
  const daysIn = Math.floor((now - qStart) / 86400000);
  // Under 4 weeks into the quarter: add 8 weeks of the previous quarter.
  const target = daysIn < 28 ? daysIn + 56 : daysIn;

  // FLOOR OF 60 DAYS. The literal reading of "current quarter" gave a 34-day
  // window on 4 August, and most mid-size companies simply do not generate
  // news every 34 days: rows that previously found events came back "no event
  // found" and the model filled the vacuum by inventing statistics, which is
  // far worse than a slightly older headline. 60 days is still inside the
  // "last 4 to 8 weeks" the brief treats as acceptable reach-back, and it is
  // capped at 100 so nothing genuinely stale gets through.
  return Math.min(Math.max(target, 60), MAX_NEWS_AGE_DAYS);
}

/**
 * Google News treats `when:Nd` as a HINT and routinely ignores it for entity
 * queries, returning the canonical story about a company regardless of age.
 * pubDate was already being captured here and then never checked, which is
 * exactly how a 2023 shutdown reached a 2026 email. This is the hard filter.
 */
export function withinWindow(pubDate, maxAgeDays, now = new Date()) {
  if (!pubDate) return false;              // no date, no trust
  const t = Date.parse(pubDate);
  if (Number.isNaN(t)) return false;
  const ageDays = (now - t) / 86400000;
  if (ageDays < -2) return false;          // clock skew or a bad feed
  return ageDays <= maxAgeDays;
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
/**
 * Widening ladder. If the quarter window returns nothing usable, try 90 days,
 * then 120. Anything found beyond the first rung is tagged `aged` so the
 * copywriter describes it accurately ("earlier this year") instead of implying
 * it happened last month.
 *
 * The alternative is an empty row, and an empty row is precisely what makes
 * the model reach into its training data and invent a figure. A slightly older
 * real event is always the better trade.
 */
export async function newsSignalsWithFallback(companyName, industry, opts = {}) {
  const rungs = [null, 90, MAX_NEWS_AGE_DAYS];
  let last = { items: [], newsSummary: "" };
  for (const override of rungs) {
    const res = await newsSignals(companyName, industry, override ? { ...opts, windowOverride: override } : opts);
    const usable = (res.items || []).filter((i) => i.scope !== "own-site");
    if (usable.length >= 2) {
      if (override) {
        res.items = res.items.map((i) => ({ ...i, aged: true }));
        res.newsSummary = `NOTE: nothing was published in the current quarter for this company, so the window was widened to ${override} days. Describe these as earlier in the year, never as recent or "last month".\n` + res.newsSummary;
      }
      return res;
    }
    last = res;
  }
  return last;
}

export async function newsSignals(companyName, industry, opts = {}) {
  const { domain, headCount, revenue, subIndustry, competitors, domainQueries, watchQueries } = opts;
  const items = [];
  const queries = [];
  const ambiguous = isAmbiguousName(companyName);
  // The quarter rule is the ceiling. Company size may only NARROW it (a large
  // company generates enough news that 30 days is plenty); it may never widen
  // it past the current quarter.
  const quarterDays = opts.windowOverride || quarterWindowDays();
  const companyWindow = Math.min(windowForCompanySize(headCount, revenue), quarterDays);
  const MAX_AGE_DAYS = Math.min(quarterDays, MAX_NEWS_AGE_DAYS);

  // COMPETITOR WATCH RUNS FIRST. A rival's move is the highest-value hook we
  // have: the reader already knows everything about their own company, and
  // what they lack is visibility into what competitors are doing to their
  // market and share. That information deficit IS the product.
  //
  // Ordering matters, not just presence. These queries used to run after the
  // prospect's own two queries, and with 6 headlines taken per query the
  // company's own news filled the 12-item window before a single competitor
  // headline landed. Competitors now go first and are given a guaranteed
  // share of the window (see the prioritized merge below).
  for (const comp of (competitors || []).slice(0, 4)) {
    const cname = String(comp && comp.name ? comp.name : comp || "").trim();
    if (!cname || cname.toLowerCase() === (companyName || "").toLowerCase()) continue;
    queries.push({ q: `"${cname}" ${EVENT_TERMS} when:${companyWindow}d`, scope: "competitor" });
  }
  // ── DOMAIN WATCH: news about the MARKET THEY SELL INTO ────────────────
  // deriveMarketContext has been producing these query terms all along and
  // newsSignals destructured them and then never issued a single search with
  // them. That is the whole reason an aviation insurer was fed its own press
  // release about in-orbit servicing: the only queries that ever ran were on
  // the company name and its competitors' names.
  //
  // This scope now carries the largest quota. The reader already knows their
  // own news. What they do not have is a live read on the market that moves
  // their buyers' budgets, and that gap is the product.
  // The thesis's watch queries come first: they were written against the
  // decisions this company's leadership actually owns, so news they return is
  // news that could change one of those decisions.
  const marketQueries = [...new Set([...(watchQueries || []), ...(domainQueries || [])])];
  for (const dq of marketQueries.slice(0, 6)) {
    queries.push({ q: `${dq} when:${companyWindow}d`, scope: "domain" });
  }
  // A second, event-shaped pass over the top market terms. Google News matches
  // natural phrasing better than bare topic strings, and pairing a topic with
  // event vocabulary surfaces the things that actually move a decision.
  for (const dq of marketQueries.slice(0, 3)) {
    queries.push({ q: `${dq} ${EVENT_TERMS} when:${companyWindow}d`, scope: "domain" });
  }

  if (companyName) {
    const nameTerm = ambiguous && industry ? `"${companyName}" "${industry}"` : `"${companyName}"`;
    queries.push({ q: `${nameTerm} when:${companyWindow}d`, scope: "company" });
    queries.push({ q: `"${companyName}" ${EVENT_TERMS} when:${companyWindow}d`, scope: "company" });
  }
  // The company's own domain: catches press releases, certifications, and
  // named services that never get picked up by third-party coverage. This is
  // the material that keeps a "no external event" prospect from falling back
  // to a generic category description in the email.
  if (domain) {
    const bareDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (bareDomain) queries.push({ q: `site:${bareDomain} when:${companyWindow}d`, scope: "own-site" });
  }
  if (industry) {
    const industryTerm = subIndustry ? `"${subIndustry}"` : `"${industry}"`;
    queries.push({ q: `${industryTerm} ${EVENT_TERMS} when:${Math.min(30, companyWindow)}d`, scope: "industry" });
  }

  for (const { q, scope } of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await get(url, 7000);
    if (!xml) continue;
    const matches = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
    for (const m of matches.slice(0, 6)) {
      const title = m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      // THE FIX: drop anything outside the window before it can reach the
      // classifier. Previously pubDate was parsed and discarded.
      if (!withinWindow(m[2], MAX_AGE_DAYS)) continue;
      if (title && !items.some((i) => i.title === title)) {
        items.push({ title, date: m[2], ts: Date.parse(m[2]) || 0, scope });
      }
    }
  }
  // PRIORITIZED MERGE. classifyEvents only sees the first 12 headlines, so a
  // flat list lets a chatty prospect's own PR crowd out every rival headline
  // and quietly turns the whole cadence back into "here is your own news".
  // Each scope gets a reserved quota, competitor first.
  const QUOTA = { competitor: 5, domain: 5, company: 3, industry: 2, "own-site": 1 };
  const prioritized = [];
  for (const scope of ["competitor", "domain", "company", "industry", "own-site"]) {
    prioritized.push(
      ...items.filter((i) => i.scope === scope)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))   // freshest first
        .slice(0, QUOTA[scope])
    );
  }
  // Backfill if a scope came back empty, so a prospect with no rival coverage
  // still gets a full window rather than a half-empty one.
  for (const i of items) {
    if (prioritized.length >= 14) break;
    if (!prioritized.includes(i)) prioritized.push(i);
  }

  const newsSummary = prioritized.slice(0, 12)
    .map((i) => `[${i.scope}] ${i.title} (${(i.date || "").slice(0, 16)})`)
    .join("\n");
  return { items: prioritized, newsSummary };
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
export async function classifyEvents(companyName, industry, news, companyDesc = "", competitors = [], marketCtx = null) {
  const items = (news && news.items) || [];
  if (!items.length) return [];
  const competitorNames = (competitors || [])
    .map((c) => String(c && c.name ? c.name : c || "").trim())
    .filter(Boolean);

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
    `What the target company ACTUALLY does (from its own website): ${companyDesc ? `"${String(companyDesc).slice(0, 700)}"` : "(unknown; infer conservatively from the name and sector, and lean toward dropping third-party news)"}\n` +
    `WHAT THE TARGET ACTUALLY SELLS: ${marketCtx && marketCtx.sells ? `"${marketCtx.sells}"` : "(unknown)"}\n` +
    `WHO PAYS THEM: ${marketCtx && marketCtx.buyerWorld ? `"${marketCtx.buyerWorld}"` : "(unknown)"}\n` +
    `THE MARKET THEY COMPETE IN: ${marketCtx && marketCtx.market ? `"${marketCtx.market}"` : "(unknown)"}\n` +
    `RELEVANCE TEST, apply to every headline: would this change a decision, a price, a risk, or a customer conversation for a company that sells the above? ` +
    `If the honest answer is no, DROP IT. An industry label is not relevance: an aviation INSURER is not affected by a satellite launch, it is affected by loss events, liability rulings and reinsurance capacity. ` +
    `Set "affects" to a short phrase naming the concrete thing that changes for them (a price, a renewal, a buyer's budget, a compliance cost, a competitive threat), or "" if nothing concrete changes. ` +
    `An event with no concrete "affects" is not usable and must be dropped.\n` +
    `KNOWN COMPETITORS of the target: ${competitorNames.length ? competitorNames.map((c) => `"${c}"`).join(", ") : "(none identified)"}. ` +
    `Label an event "competitor" ONLY when it is about one of these named companies, or about a company that genuinely sells the same thing to the same buyers. ` +
    `A large customer, supplier, landlord, or unrelated corporation is NOT a competitor: a warehouse closure at Amazon is not a competitor event for a building-inspection firm, it is at most a market signal.\n\n` +
    `Event types to use: ${EVENT_TAXONOMY}.\n\n` +
    `Headlines:\n${headlines}\n\n` +
    `For each event also set "relevance":\n` +
    `- "direct": about the target company itself, a NAMED competitor's move that plausibly shifts the target's market, OR a market / regulatory / supply-chain shift that genuinely affects what the target does.\n` +
    `- "peripheral": real industry news, but about other players, with no specific line to the target's own decisions.\n\n` +
    `Also set "subject":\n` +
    `- "self": the event is about the target company itself.\n` +
    `- "competitor": the event is a named rival's or peer's move in the target's market.\n` +
    `- "market": a regulatory, demand, supply-chain, or customer-side shift not owned by any one player.\n\n` +
    `Also set "negativeForTarget": true when the event, whoever it is about, is BAD NEWS for the target specifically ` +
    `(a ban, tariff, restriction, delisting, or regulation that hits the target's own products, market access, or customers; ` +
    `a customer loss; a rival winning something the target was competing for). This is judged from the TARGET's point of view: ` +
    `"U.S. bans China-made drones" is negativeForTarget for a Chinese drone maker even though the headline names no company. ` +
    `Otherwise false.\n\n` +
    `Also set "tone", judged strictly FROM THE TARGET'S POINT OF VIEW, whoever the event is about:\n` +
    `- "positive": the target gains from this. Their own win, contract, funding, certification, approval, partnership, product launch, facility, award, hire, or expansion; a rule change that widens their market or their customers' budgets; demand growth in a segment they actually serve.\n` +
    `- "neutral": it happens near them but they neither gain nor lose from it.\n` +
    `- "negative": the target loses from this, including a rival winning something, a restriction, a downturn, a customer loss, or any bad news about the target itself.\n` +
    `Judge the SUBSTANCE, not the wording. A rival's funding round is negative for the target even though the headline is upbeat. A regulator approving a category the target sells into is positive even though the headline names no company. When you are unsure, answer "neutral", never "positive".\n\n` +
    `Also set "sensitive": true when the event is negative/embarrassing news about the TARGET company itself ` +
    `(executive detention or arrest, lawsuit, probe into the company, scandal, layoffs, bankruptcy, fatal accident, ` +
    `recall, breach, sanctions/fines against it); otherwise false. A competitor's bad news is NOT sensitive for the target.\n\n` +
    `Return JSON of the form:\n` +
    `{"events":[{"type":"<one event type above>","scope":"company|industry","relevance":"direct|peripheral",` +
    `"subject":"self|competitor|market","sensitive":true|false,"tone":"positive|neutral|negative",` +
    `"affects":"<the concrete thing that changes for THIS company, or empty>",` +
    `"recency":"<date if known, else empty>","what":"<one-sentence factual summary that STAYS FAITHFUL to the headline: keep its specific subject and key terms, do not soften, generalize, or drop the core (e.g. a pivot to 'airspace safety' stays 'airspace safety', it does NOT become 'managing air space')>",` +
    `"angle":"<the forward question or opening this creates for THIS company, phrased as an advisor would raise it: what it makes reachable, which buyers it newly qualifies them for, which adjacent segment opens. Never a risk, a threat, or a warning. If the event is about another organization, phrase it as the market signal it creates for the target's share, pricing, or pipeline, NEVER as a move the target can 'leverage' or is party to, and never gloating>"}]}\n\n` +
    `Rules: keep at most 4 events, strongest first. RANKING, and this is the current brief: (1) the target's OWN positive developments, (2) a market or regulatory shift that is positive for the target, (3) everything else. ` +
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
      // POSITIVE ONLY. The cadence is now anchored exclusively on good news
      // for the reader, so a neutral or negative event is not a weaker hook,
      // it is not a hook at all: the row falls through to advisory framing,
      // which is a complete email in its own right. Both tests must pass, the
      // model's judgement AND the vocabulary check, because the classifier is
      // reliably right about substance and reliably soft about wording.
      .filter((e) => e.tone === "positive" && isPositiveForTarget(e))
      // Events with a stated consequence sort FIRST, but events without one
      // are no longer dropped. Combined with the narrowed window above, that
      // filter was removing the last remaining event on most rows and leaving
      // the model with nothing but its own memory to write from. A weaker
      // real event beats an invented one every single time.
      .sort((a, b) => ((b.affects || "").length > 8 ? 1 : 0) - ((a.affects || "").length > 8 ? 1 : 0))
      // LABEL VERIFICATION. The model called an Amazon warehouse closure a
      // "competitor" event for a building-evaluation firm, and the email then
      // described Amazon as "a major competitor". If we hold a competitor
      // list and the event names none of them, the claim is downgraded to a
      // market signal, which is both true and still usable as a hook.
      .map((e) => {
        if (e.subject !== "competitor" || !competitorNames.length) return e;
        const text = `${e.what || ""} ${e.angle || ""}`.toLowerCase();
        const named = competitorNames.some((n) => text.includes(n.toLowerCase()));
        return named ? e : { ...e, subject: "market", mislabeled: true };
      })
      .slice(0, 4)
      .map((e) => ({
        type: String(e.type).slice(0, 60),
        scope: e.scope === "industry" ? "industry" : "company",
        relevance: e.relevance === "peripheral" ? "peripheral" : "direct",
        subject: e.subject === "competitor" ? "competitor" : e.subject === "market" ? "market" : "self",
        scopeHint: e.scope || "",
        negativeForTarget: e.negativeForTarget === true,
        tone: "positive",
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

// Gain vocabulary. An event has to LOOK like a win as well as be classified
// as one: the classifier will occasionally call a rival's expansion positive
// for the target on some second-order reasoning, and the reader will not
// follow that reasoning, they will just see a competitor's name.
const POSITIVE_RE = new RegExp(
  "\\b(win[s]?|won|award(?:ed|s)?|secur(?:ed|es)|contract[s]?|deal|order[s]?|" +
  "partnership|partner(?:ed|s)? with|collaborat(?:ion|ing|es)|alliance|" +
  "rais(?:ed|es|ing)|funding|investment|invests?|series [a-e]\\b|backing|" +
  "launch(?:ed|es)?|unveil(?:ed|s)?|introduc(?:ed|es)|debut[s]?|" +
  "expan(?:d|ds|ded|sion)|open(?:ed|s|ing) (?:a |its |new )|new (?:facility|plant|office|site|line)|" +
  "certif(?:ied|ication)|approv(?:ed|al)|clear(?:ed|ance)|authoris(?:ed|ation)|authoriz(?:ed|ation)|waiver|" +
  "acquir(?:ed|es)|acquisition of|selected|chosen|appoint(?:ed|s)|hir(?:ed|es|ing)|" +
  "growth|grew|record (?:revenue|quarter|year)|milestone|expands? into)\\b", "i");

/**
 * Deterministic backstop for the positive-only rule.
 *
 * Two conditions, and both are required:
 *   1. The event must carry gain vocabulary, so it reads as a win at a glance.
 *   2. It must NOT be a competitor's win. A rival raising $40M is genuinely
 *      good news for somebody, and that somebody is not the reader. Opening
 *      an email on it is the old threat framing wearing a smile.
 */
function isPositiveForTarget(e) {
  if (e.subject === "competitor") return false;
  if (e.negativeForTarget === true) return false;
  const text = `${e.what || ""} ${e.type || ""}`;
  if (SENSITIVE_RE.test(text) || MARKET_HOSTILE_RE.test(text)) return false;
  return POSITIVE_RE.test(text);
}

function isSensitiveForTarget(e) {
  // A market or regulatory event that is BAD NEWS FOR THE TARGET is not a
  // usable hook either, even though it is not "their own news". Emailing a
  // DJI employee about a US ban on Chinese drones to ask if they want a read
  // on their own collapsing market access is the same ambulance-chasing in a
  // different costume. The classifier judges this from the target's point of
  // view; the regex below is the deterministic backstop.
  if (e.negativeForTarget === true) return true;

  const aboutTarget = e.subject !== "competitor" && e.subject !== "market";
  if (aboutTarget) {
    if (e.sensitive === true) return true;
    return SENSITIVE_RE.test(`${e.what || ""} ${e.type || ""}`);
  }

  // Market-scope backstop: restriction vocabulary aimed at a whole category
  // is usually aimed at somebody, and if it reached this prospect's news feed
  // that somebody is often them. Cheap to drop, expensive to send.
  if (e.subject === "market" && MARKET_HOSTILE_RE.test(`${e.what || ""} ${e.type || ""}`)) return true;
  return false;
}

// Restriction vocabulary. Deliberately narrower than SENSITIVE_RE: a market
// event mentioning a lawsuit somewhere is fine, one announcing a ban is not.
const MARKET_HOSTILE_RE = new RegExp(
  "\\b(ban(?:s|ned|ning)?|prohibit(?:s|ed|ion)?|restrict(?:s|ed|ion|ions)?|blacklist(?:ed)?|" +
  "entity list|delist(?:ed|ing)?|embargo|tariffs? on|sanction(?:s|ed)? on|crackdown|outlaw(?:ed|s)?|" +
  "forced (?:sale|divest)|export controls?)\\b", "i");

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
export async function deriveMarketContext(companyName, industry, companyDesc = "") {
  if (!companyName) return { competitors: [], domainQueries: [], buyerWorld: "", segments: [], sells: "", market: "", rivals: [] };
  const system =
    "You are a market analyst briefing a research firm before it writes to this company. Return ONLY valid JSON.\n\n" +
    "You produce three things.\n\n" +
    "1. COMPETITORS: the closest REAL, currently-operating companies that compete for the same buyers. " +
    "Only companies you are confident exist and genuinely compete; if unsure, return an empty list. Never invent one.\n\n" +
    "2. DOMAIN QUERIES: this is the important one. Search phrases for news about THE MARKET THIS COMPANY OPERATES IN, " +
    "not about the company. Think about what the company actually SELLS, WHO BUYS IT, and WHAT MOVES THAT MARKET, " +
    "then write the searches a analyst covering that market would run this quarter.\n" +
    "   The sector label on a list is usually useless. \"Aerospace\" for an aviation INSURER is wrong: their market is " +
    "aviation insurance rates, hull loss claims, airline fleet risk, UAS underwriting, and reinsurance capacity, " +
    "NOT rockets and in-orbit servicing. Write queries for the market they SELL INTO and the forces that move their " +
    "buyers' budgets: pricing, capacity, regulation, claims, demand shifts, new entrants, supply chain.\n" +
    "   Each query is 2 to 5 words, no quotes, no boolean, the way someone would type it into a news search.\n\n" +
    "3. BUYER WORLD: one line naming who this company sells to and what those buyers worry about. " +
    "This tells the email writer whose problem to speak to.\n\n" +
    "4. SEGMENTS: 3 to 5 SPECIFIC segments, applications, product lines or customer types this company actually serves, " +
    "taken from its own site copy. These are what stop the email's bullets being interchangeable: a bullet that names " +
    "\"the UAS underwriting book\" is alive, one that names \"the competitive landscape\" is dead. Concrete nouns only, " +
    "no generic categories, no marketing adjectives.\n\n" +
    "5. SELLS: one short line, plainly, what they sell. Not their tagline.";
  const user =
    `Company: "${companyName}"\nSector as labelled (may be wrong or too broad): "${industry || "?"}"\n` +
    `What it actually does, from its own website: ${companyDesc ? `"${String(companyDesc).slice(0, 700)}"` : "(unknown)"}\n\n` +
    `Return {"competitors":[{"name":"<real company>","why":"<what they compete on>"}],` +
    `"domainQueries":["<market query>","<market query>","<market query>","<market query>","<market query>"],` +
    `"buyerWorld":"<one line: who buys from them and what those buyers worry about>",` +
    `"segments":["<specific segment>","<specific segment>","<specific segment>"],` +
    `"sells":"<one plain line: what they sell>","market":"<2-5 words naming the market they compete in>"}`;
  try {
    const out = await chatJSON(system, user, { temperature: 0.3, maxTokens: 600 });
    const list = Array.isArray(out.competitors) ? out.competitors : [];
    const dq = Array.isArray(out.domainQueries) ? out.domainQueries : [];
    return {
      competitors: list
        .filter((c) => c && c.name && String(c.name).trim().length >= 2)
        .slice(0, 5)
        .map((c) => ({ name: String(c.name).trim().slice(0, 80), why: String(c.why || "").trim().slice(0, 200) })),
      domainQueries: dq
        .map((q) => String(q || "").replace(/["']/g, "").trim())
        // A query containing the company's own name returns the company's own
        // press releases, which is the exact failure this field exists to fix.
        .filter((q) => q.length >= 4 && q.split(/\s+/).length <= 6 &&
          !q.toLowerCase().includes(String(companyName || "").toLowerCase()))
        .slice(0, 5),
      buyerWorld: String(out.buyerWorld || "").trim().slice(0, 300),
      segments: (Array.isArray(out.segments) ? out.segments : [])
        .map((x) => String(x || "").trim()).filter((x) => x.length >= 3).slice(0, 5),
      sells: String(out.sells || "").trim().slice(0, 240),
      market: String(out.market || "").trim().slice(0, 80),
      rivals: list.filter((c) => c && c.name).map((c) => String(c.name).trim()).slice(0, 5)
    };
  } catch {
    return { competitors: [], domainQueries: [], buyerWorld: "", segments: [], sells: "", market: "", rivals: [] };
  }
}

/** Back-compat wrapper. */
export async function deriveCompetitors(companyName, industry, companyDesc = "") {
  const { competitors } = await deriveMarketContext(companyName, industry, companyDesc);
  return competitors;
}
