/**
 * RELEVANCE JUDGE
 * ──────────────────────────────────────────────────────────────────────────
 * The regex gate was too strict, and strictness was the wrong tool. A title
 * list cannot know that "Airspace Innovation" at DroneUp is a senior product
 * seat, that "Area Vice President" at a radar company runs a region and buys
 * competitive intelligence, or that an Assistant Director of Student Conduct
 * at a university is irrelevant no matter how senior she is.
 *
 * So the question is no longer "does this title match a pattern". It is the
 * question a good SDR actually asks:
 *
 *     Would this person, at THIS company, plausibly buy or champion
 *     strategic market intelligence?
 *
 * Two things are judged, and BOTH must pass:
 *
 *   COMPANY  Does this organization buy market intelligence at all? A drone
 *            manufacturer does. A university's student affairs office and a
 *            regional disaster-restoration firm do not, at any seniority.
 *            This filter matters more than the title one and the old gate
 *            had it nowhere.
 *
 *   PERSON   Is this seat a buyer (owns the budget or the decision), an
 *            influencer (would use the intelligence and can champion it
 *            internally), or irrelevant?
 *
 * Cost control: the model is only consulted on AMBIGUOUS rows. Clear passes
 * (an approved title) and clear rejects (intern, recruiter, student) short
 * circuit on regex and never reach the API. On a real list that is roughly
 * half the rows, and the judge call is small.
 */
import { chatJSON } from "./ai";
import { jobTitleGate, seniorityRank, RANK } from "./titles";

// Titles that are never worth a model call, whatever the company.
const OBVIOUS_NO = [
  /\b(intern|internship|trainee|apprentice|student|fresher)\b/i,
  /\b(recruiter|talent\s+acquisition|human\s+resources|payroll|benefits\s+admin)\b/i,
  /\b(executive|personal|virtual)\s+assistant\b/i,
  /\b(receptionist|janitor|driver|security\s+guard|warehouse)\b/i,
  /\b(sdr|bdr)\b/i,
  /\b(customer\s+(service|support)\s+(rep|representative|agent))\b/i,
  /\b(retired|seeking|open\s+to\s+work|self[-\s]employed|unemployed)\b/i
];

const VERDICTS = new Set(["buyer", "influencer", "no"]);

/** Per-instance cache. The same title at the same company recurs constantly. */
function cacheKey(lead) {
  return `${String(lead.title || "").toLowerCase().trim()}::${String(lead.companyName || "").toLowerCase().trim()}`;
}

const SYSTEM = `You qualify B2B prospects for Kings Research, a strategic market-intelligence and advisory firm.

Kings Research sells: competitor tracking, segment and demand analysis, market-entry reads, pricing and peer benchmarking, and advisory work for leadership teams deciding where to invest next. It is bought by companies that COMPETE in a market and need outside visibility into it.

You answer two questions.

1. COMPANY FIT. Would this ORGANIZATION plausibly buy market intelligence?
   YES: manufacturers, technology and software firms, insurers, industrial and materials companies, healthcare and pharma, financial services, consultancies, distributors, energy, logistics, any company with competitors and a growth agenda.
   NO: universities and schools (unless the contact is in a commercial or research-commercialisation role), local trade and repair services, restoration and cleaning franchises, single-site contractors, charities, government service departments, staffing agencies, and any organisation with no real competitive market to analyse.
   When the company is unfamiliar, judge from what it does, not from its size. A small specialist manufacturer is a fine fit. A regional disaster-restoration firm is not.

2. PERSON FIT. Would this SEAT buy this, champion it internally, or use it?
Also return TWO scores:

"buyLikelihood"    0-100. The probability that a person in THIS seat, at THIS company, would personally buy or approve a market-intelligence engagement. Judge the SEAT, not the individual. A Head of Corporate Strategy at a mid-size manufacturer is 85+. A VP Marketing at the same firm is 70-80. A Product Manager is 40-60. An IT Director is under 20.
"decisionInfluence" true when this seat, even without the budget, sits close enough to the decision to put a proposal in front of whoever signs: they set requirements, run the evaluation, or own the problem the research would solve.

   "buyer"      - owns the budget or the decision: strategy, corporate development, market intelligence, insights, research, product, marketing leadership, commercial leadership, procurement leadership, general management, C-suite, founders.
   "influencer" - would USE the intelligence and can push it upward even without the budget: senior product, senior marketing, business development, regional and country leadership, R&D and technology leadership, planning, analytics, pricing, category management, sales leadership.
   "no"         - the work never touches market or competitive questions: HR, payroll, IT support, facilities, legal, accounting, field service, individual contributors in delivery roles, administrators, junior support staff.

BE INCLUSIVE ON THE PERSON, STRICT ON THE COMPANY. A mislabeled or vague title at a good company should be judged on what the seat most likely does; if it plausibly touches market, product, commercial or strategy questions at a decent seniority, return "influencer" rather than "no". Missing a real buyer is a worse error than including a marginal one. But a great title at a company with no market to analyse is still "no".

A title that is a department ("Aerospace"), a team ("Airspace Innovation"), a product ("Aras PLM") or a bare function ("Business Development") is a DATA problem, not a seniority problem. Infer what the seat most likely is at that company and judge that.

Return ONLY valid JSON.`;

/**
 * Judge one lead. Returns:
 *   { relevant: true,  verdict: "buyer"|"influencer", reason, source }
 *   { relevant: false, verdict: "no",                 reason, source }
 *
 * `source` is "rule" when decided without a model call, "ai" otherwise, and
 * "fallback" when the model was unreachable (in which case the row is passed
 * through rather than silently dropped: an API blip must not delete pipeline).
 */
export async function judgeRelevance(lead = {}, companyIntel = {}) {
  const title = String(lead.title || "").replace(/\s+/g, " ").trim();
  const company = String(lead.companyName || "").trim();

  if (!title && !company) {
    return { relevant: false, verdict: "no", buyLikelihood: 0, decisionInfluence: false, reason: "no title and no company on the row", source: "rule" };
  }

  // ── Fast path: obvious rejects, no model call ──────────────────────────
  for (const re of OBVIOUS_NO) {
    if (re.test(title)) {
      return { relevant: false, verdict: "no", buyLikelihood: 0, decisionInfluence: false, reason: `role type is never a buyer (${(title.match(re) || [""])[0].trim()})`, source: "rule" };
    }
  }

  // ── Fast path: an explicitly approved title at any company still gets the
  //    company check, because a CMO at a school district is still not a buyer.
  //    But a senior approved title is strong enough that we only ask the model
  //    about the COMPANY, which it answers in the same call anyway.
  const gate = jobTitleGate(lead);

  const cache = globalThis.__kc_relevance || (globalThis.__kc_relevance = new Map());
  const key = cacheKey(lead);
  if (cache.has(key)) return cache.get(key);

  const user =
    `Person title: "${title || "(blank)"}"\n` +
    `Department: "${lead.department || "-"}"\n` +
    `Seniority hint from the list vendor: "${lead.level || "-"}"\n` +
    `Company: "${company || "(unknown)"}"\n` +
    `Industry as labelled: "${lead.industry || "-"}"${lead.subIndustry ? ` / "${lead.subIndustry}"` : ""}\n` +
    `What the company actually does (scraped from its own website): ${companyIntel.description ? `"${String(companyIntel.description).slice(0, 500)}"` : "(not available, judge from the name and industry)"}\n\n` +
    `Return {"companyFit":true|false,"companyReason":"<8 words>","verdict":"buyer|influencer|no",` +
    `"buyLikelihood":<0-100>,"decisionInfluence":true|false,` +
    `"reason":"<12 words, plain, why this seat would or would not engage>"}`;

  let out;
  try {
    out = await chatJSON(SYSTEM, user, { temperature: 0.1, maxTokens: 200 });
  } catch {
    // The model is unreachable. Fall back to the regex gate rather than
    // dropping the row: an outage must never look like a rejection.
    const res = gate.inJT
      ? { relevant: true, verdict: "influencer", buyLikelihood: 60, decisionInfluence: gate.rank >= 3, reason: "relevance model unavailable, passed on title rules", source: "fallback" }
      : { relevant: false, verdict: "no", buyLikelihood: 0, decisionInfluence: false, reason: `relevance model unavailable, ${gate.reason}`, source: "fallback" };
    cache.set(key, res);
    return res;
  }

  const verdict = VERDICTS.has(out.verdict) ? out.verdict : "no";
  const buyLikelihood = Math.max(0, Math.min(100, parseInt(out.buyLikelihood, 10) || 0));
  const decisionInfluence = out.decisionInfluence === true;
  const companyFit = out.companyFit !== false;
  const reason = String(out.reason || "").slice(0, 120);
  const companyReason = String(out.companyReason || "").slice(0, 120);

  let res;
  if (!companyFit) {
    res = { relevant: false, verdict: "no", buyLikelihood: 0, decisionInfluence: false, reason: `company does not buy market intelligence (${companyReason})`, source: "ai" };
  } else if (verdict === "no") {
    // One safety net in the permissive direction: if the model says no but the
    // deterministic list says this is an explicitly approved title at a good
    // company, trust the list. The named titles were chosen deliberately.
    if (gate.inJT && String(gate.matched || "").startsWith("approved title")) {
      res = { relevant: true, verdict: "buyer", buyLikelihood: 80, decisionInfluence: true, reason: `${gate.matched} (model was unsure)`, source: "rule" };
    } else {
      res = { relevant: false, verdict: "no", buyLikelihood, decisionInfluence, reason, source: "ai" };
    }
  } else {
    // Very junior seats are influencers at best, and only when the function
    // is genuinely relevant. This stops "buyer" being handed to an analyst.
    const rank = seniorityRank(title);
    const finalVerdict = (verdict === "buyer" && rank === RANK.IC) ? "influencer" : verdict;
    res = { relevant: true, verdict: finalVerdict, buyLikelihood, decisionInfluence, reason, source: "ai" };
  }

  cache.set(key, res);
  return res;
}

/**
 * The Ready bar, as specified: a row only auto-sends when the SEAT would very
 * likely buy (80+) or sits close enough to the decision to put a proposal in
 * front of whoever signs. Everything else is drafted and held for a human,
 * because a perfect email to someone who cannot act on it is wasted send
 * volume and wasted domain reputation.
 */
export function meetsReadyBar(rel) {
  if (!rel || !rel.relevant) return false;
  return (rel.buyLikelihood || 0) >= 80 || rel.decisionInfluence === true;
}

/** Status strings written to the sheet. */
export const NOT_RELEVANT = "Not present in JT";
