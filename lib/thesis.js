/**
 * THE ENGAGEMENT THESIS
 * ──────────────────────────────────────────────────────────────────────────
 * The missing layer. The pipeline went NEWS -> EMAIL, so every bullet had to
 * be invented on the spot from a headline, and what came out were guesses
 * wearing the costume of deliverables:
 *
 *     - how many Walmart partnerships may shift to Wing as they enter Florida
 *     - what impact Wing's pricing strategies might have on your cost structure
 *     - how quickly Florida regulators may adapt to increased competition
 *
 * Every one is a speculation. The reader cannot buy any of them, and the
 * hedging ("may", "might", "may") is not a style problem, it is the honest
 * consequence of asking a model to invent a deliverable from a headline.
 *
 * The right sequence is the one a human consultant uses:
 *
 *     WHAT ARE THEY  ->  WHAT DECISIONS DO THEY MAKE  ->  WHAT COULD WE
 *     ACTUALLY SELL THEM  ->  which news hooks into that  ->  write
 *
 * This module is step 1-3. It runs ONCE per company and produces a durable
 * engagement thesis: what they really are (correcting the list's industry
 * label), the decisions their leadership actually makes, their real named
 * rivals, and 6-8 CONCRETE Kings Research deliverables for this specific
 * company. Email 1's bullets are then DRAWN from that list rather than
 * invented, which is what makes them buyable and what removes the hedging
 * at source.
 *
 * The thesis also produces the news queries, so the search is anchored to
 * what would actually change one of their decisions.
 */
import { chatJSON } from "./ai";

const SYSTEM = `You are a senior consultant at Kings Research, a market-intelligence and advisory firm, preparing to approach a company. Kings Research sells decision support, not insurance, software, or hardware: market sizing and forecasting, competitor tracking, segment and demand analysis, pricing and peer benchmarking, technology adoption monitoring, risk and regulatory intelligence, customer and white-space mapping, and strategic advisory.

Your job is to work out what this company ACTUALLY is, what decisions its leadership actually makes, and what Kings Research could concretely sell them.

STEP 1 - WHAT ARE THEY, REALLY.
The industry label on a prospect list is frequently wrong and it is the single biggest cause of worthless outreach. "Global Aerospace" is NOT an aerospace manufacturer, it is a specialist AVIATION INSURER: it underwrites hull, liability and product risk for airlines, OEMs, airports, MRO firms and drone operators. An email to them about rocket launches is worthless; an email about fleet expansion, claims trends, or how eVTOL changes risk profiles is not. Read the site copy and work out what they sell and who pays them, ignoring the label if it disagrees.

STEP 2 - WHAT DECISIONS DO THEY MAKE.
Name the recurring, high-stakes decisions their leadership owns, the ones where being wrong is expensive. For an aviation insurer: what to price risk at, which segments to underwrite or exit, which regions to enter, how to reserve against emerging aircraft types. These decisions are what data can improve, and they are the real product.

STEP 3 - WHAT COULD KINGS RESEARCH SELL THEM.
6 to 8 CONCRETE deliverables, each a NAMED THING a client could buy and a Kings Research analyst could actually produce. Each must be specific to THIS company's world, naming their real segments, their real rivals, their real risk categories, their real customer types.
  GOOD, these are buyable:
    "Quarterly competitor intelligence on Allianz, AIG Aerospace and AXA XL: product launches, pricing moves and geographic expansion"
    "Insurance implications of eVTOL and advanced air mobility: adoption forecasts and how they change risk profiles"
    "Fleet expansion tracker: which carriers are adding aircraft, by region and aircraft type"
    "Claims and loss trend analysis across your underwriting classes"
  DEAD, these are speculations or generic categories, never write them:
    "how many partnerships may shift to a competitor"
    "what impact their pricing strategies might have on your cost structure"
    "competitive positioning analysis"
    "market trends and insights"
A deliverable is a NOUN THEY CAN BUY, not a QUESTION YOU ARE GUESSING AT. If it contains "may", "might", "could", or "potential", it is not a deliverable.

STEP 4 - WHAT TO WATCH.
Search phrases for news that would genuinely move one of the decisions in step 2. About the MARKET, never containing the company's own name. A trade journalist's phrasing, 2 to 5 words.

Return ONLY valid JSON. Be concrete throughout: a vague thesis produces a vague email and the reader deletes it.`;

function clean(v, n = 240) { return String(v || "").trim().slice(0, n); }
function list(v, n, minLen = 4) {
  return (Array.isArray(v) ? v : [])
    .map((x) => String(x || "").trim())
    .filter((x) => x.length >= minLen)
    .slice(0, n);
}

// A deliverable containing hedge words is a guess, not something anyone can
// buy. Dropped here so it can never reach a bullet.
const SPECULATIVE = /\b(may|might|could|would|potential(ly)?|possible|perhaps|likely|expected to|if they)\b/i;
const GENERIC_DELIVERABLE = /^(competitive positioning|market (trends|insights|analysis|research|overview)|industry (trends|analysis)|strategic (analysis|insights)|business intelligence|data analysis)\.?$/i;

export async function engagementThesis(lead = {}, companyIntel = {}) {
  const company = clean(lead.companyName, 120);
  if (!company) return null;

  const cache = globalThis.__kc_thesis || (globalThis.__kc_thesis = new Map());
  const key = company.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const site = [companyIntel.description, companyIntel.siteText].filter(Boolean).join(" ").slice(0, 3000);
  if (site.length < 60 && !lead.industry) return null;

  const user =
    `Company: "${company}"\n` +
    `Website: ${lead.companyWebsite || "(unknown)"}\n` +
    `Industry label from the prospect list (often WRONG, treat as a hint and override it if the site says otherwise): "${lead.industry || "-"}"${lead.subIndustry ? ` / "${lead.subIndustry}"` : ""}\n` +
    `Their own website copy:\n${site || "(none)"}\n\n` +
    `Return:\n` +
    `{"whatTheyAre":"<one plain line: what they actually sell. Correct the industry label if it is wrong>",` +
    `"whoPaysThem":"<one line: the customer types who write the cheques>",` +
    `"market":"<2-5 words naming the market they compete in, as an analyst would name it>",` +
    `"segments":["<real segment, product line, coverage class or customer type>", ...3-6],` +
    `"rivals":["<real company that sells the same thing to the same buyers>", ...3-6],` +
    `"decisions":["<a recurring high-stakes decision their leadership owns>", ...3-5],` +
    `"deliverables":["<a named, buyable Kings Research deliverable specific to this company>", ...6-8],` +
    `"watchAreas":["<what to monitor that would move one of those decisions>", ...3-5],` +
    `"watchQueries":["<news search phrase about their market, never their own name>", ...4-6]}`;

  let out;
  try {
    out = await chatJSON(SYSTEM, user, { temperature: 0.3, maxTokens: 1400 });
  } catch {
    return null;
  }

  const thesis = {
    whatTheyAre: clean(out.whatTheyAre, 300),
    whoPaysThem: clean(out.whoPaysThem, 300),
    market: clean(out.market, 80),
    segments: list(out.segments, 6),
    rivals: list(out.rivals, 6, 2).filter((r) => r.toLowerCase() !== key),
    decisions: list(out.decisions, 5, 10),
    deliverables: list(out.deliverables, 8, 20)
      .filter((d) => !SPECULATIVE.test(d) && !GENERIC_DELIVERABLE.test(d)),
    watchAreas: list(out.watchAreas, 5),
    watchQueries: list(out.watchQueries, 6)
      .map((q) => q.replace(/["']/g, "").trim())
      .filter((q) => !q.toLowerCase().includes(key) && q.split(/\s+/).length <= 6)
  };

  // A thesis with nothing to sell is not a thesis.
  if (!thesis.deliverables.length && !thesis.segments.length) return null;

  cache.set(key, thesis);
  return thesis;
}

/**
 * The thesis as the copywriter sees it. The deliverables block is the
 * important part: Email 1's bullets must be CHOSEN from this list and made
 * concrete against the event, not invented.
 */
export function thesisBlock(t) {
  if (!t) return "";
  const L = [];
  L.push("═══ WHO THIS COMPANY ACTUALLY IS (this overrides the industry label on the list) ═══");
  if (t.whatTheyAre) L.push(`THEY SELL: ${t.whatTheyAre}`);
  if (t.whoPaysThem) L.push(`THEIR CUSTOMERS: ${t.whoPaysThem}`);
  if (t.market) L.push(`THEIR MARKET: ${t.market}`);
  if (t.segments.length) L.push(`THEIR SEGMENTS (name one of these, never a generic category): ${t.segments.join(" | ")}`);
  if (t.rivals.length) L.push(`THEIR REAL RIVALS: ${t.rivals.join(", ")}`);
  if (t.decisions.length) {
    L.push("");
    L.push(`DECISIONS THEIR LEADERSHIP OWNS (the give should touch one of these): ${t.decisions.join(" | ")}`);
  }
  if (t.deliverables.length) {
    L.push("");
    L.push("═══ WHAT KINGS RESEARCH CAN ACTUALLY SELL THIS COMPANY ═══");
    L.push("The bullets in Email 1 MUST be drawn from this list. Pick the 3 most relevant to the event above and phrase each as the thing they would RECEIVE. Do NOT invent new ones, and do NOT turn them into questions or speculations: every bullet is a noun they can buy, never a guess about what might happen.");
    t.deliverables.forEach((d, i) => L.push(`  ${i + 1}. ${d}`));
  }
  if (t.watchAreas.length) L.push(`\nWHAT THEIR LEADERSHIP IS WATCHING: ${t.watchAreas.join(" | ")}`);
  return L.join("\n");
}

/** Loose check that a bullet came from the thesis rather than thin air. */
export function bulletMatchesThesis(bulletText, thesis) {
  if (!thesis || !thesis.deliverables.length) return true; // nothing to check against
  const stop = new Set("the and for with from into your their our its how what which who when where that this those these are was were will".split(" "));
  const toks = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((w) => !stop.has(w)));
  const b = toks(bulletText);
  if (!b.size) return false;
  const pool = [...thesis.deliverables, ...thesis.segments, ...thesis.rivals, ...thesis.watchAreas].join(" ");
  const p = toks(pool);
  let hits = 0;
  for (const w of b) if (p.has(w)) hits++;
  return hits >= 2;
}
