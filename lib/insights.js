/**
 * THE INSIGHT LIBRARY
 * ──────────────────────────────────────────────────────────────────────────
 * The give in a cold email from a research firm should be PROPRIETARY DATA,
 * not a news headline. Google News is free and every competitor with an
 * Apollo seat and an API key can build the same email. Kings Research's
 * trackers, primary interviews and segment work cannot be replicated, and
 * that asymmetry is the only durable reason a stranger replies.
 *
 * So the anchor priority is, in code, not prompt:
 *   1. A matched proprietary finding  <- works with zero news, PRIMARY
 *   2. A competitor / market move     <- when one exists
 *   3. The prospect's own event, outside angle only
 *   4. Nothing -> HOLD THE ROW. Do not send.
 *
 * Findings come from an "Insights" tab in the same spreadsheet and are
 * matched by deterministic keyword overlap. They are NEVER model-generated:
 * a hallucinated statistic sent to a senior buyer is unrecoverable, and the
 * whole point is that the number is checkable.
 *
 * Insights tab columns (header row, spelling flexible):
 *   Industry | Segment Keywords | Finding | Implication | Withheld | Source Date
 *
 *   Industry        broad vertical, used as a coarse filter
 *   Segment Keywords comma/semicolon separated; what a matching lead looks like
 *   Finding         the number or mechanism, stated plainly. THE GIVE.
 *   Implication     one line: why it costs or gains them something
 *   Withheld        what you did NOT include, and will send on reply. THE ASK.
 *   Source Date     freshness; stale findings are down-ranked
 */

const nkey = (s) => String(s || "").toLowerCase().replace(/[\s._-]+/g, "");

const COLS = {
  industry: ["industry", "sector", "vertical"],
  keywords: ["segmentkeywords", "keywords", "segment", "keyword", "match", "tags"],
  finding: ["finding", "insight", "datapoint", "data", "stat", "thegive"],
  implication: ["implication", "sowhat", "meaning", "why", "impact"],
  withheld: ["withheld", "held", "theask", "breakdown", "detail", "sendonreply"],
  sourceDate: ["sourcedate", "date", "asof", "freshness", "quarter"]
};

function pick(row, aliases) {
  for (const a of aliases) {
    const v = row[nkey(a)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/** Normalize raw Insights-tab rows into usable findings. */
export function parseInsights(rows = []) {
  return rows
    .map((raw) => {
      const row = {};
      for (const k of Object.keys(raw)) row[nkey(k)] = raw[k];
      return {
        industry: pick(row, COLS.industry),
        keywords: pick(row, COLS.keywords),
        finding: pick(row, COLS.finding),
        implication: pick(row, COLS.implication),
        withheld: pick(row, COLS.withheld),
        sourceDate: pick(row, COLS.sourceDate)
      };
    })
    // A finding with nothing to withhold has no ask, and a finding with no
    // text is not a finding. Both are dropped rather than half-used.
    .filter((i) => i.finding && i.finding.length >= 15);
}

// Words too generic to earn a match on their own. A lead matching only
// "services" or "solutions" has not really matched anything.
const WEAK = new Set(("the and for with from into services solutions systems group company companies inc ltd llc corp global international products management consulting technology technologies industry industrial business").split(" "));

/** Freshness multiplier: a finding from two years ago is not a give. */
function freshness(sourceDate) {
  const s = String(sourceDate || "");
  const y = (s.match(/20\d{2}/) || [])[0];
  if (!y) return 0.9;
  const age = new Date().getFullYear() - parseInt(y, 10);
  if (age <= 0) return 1.2;
  if (age === 1) return 1.0;
  if (age === 2) return 0.7;
  return 0.4;
}

/**
 * Match a lead to the single strongest finding, or null.
 *
 * Scoring is deliberately conservative. A wrong finding is worse than no
 * finding: it tells a senior reader you do not actually know their segment,
 * which is the one thing you are claiming. MIN_SCORE enforces that a match
 * rests on real, specific overlap rather than one weak generic token.
 */
export function matchInsight(lead, companyIntel = {}, insights = []) {
  if (!Array.isArray(insights) || !insights.length) return null;

  const blob = [
    lead.industry, lead.subIndustry, lead.title, lead.department,
    lead.companyName,
    companyIntel.description, companyIntel.keywords, companyIntel.siteText
  ].filter(Boolean).join(" ").toLowerCase();
  if (!blob.trim()) return null;

  const leadIndustry = String(lead.industry || "").toLowerCase();
  const leadSub = String(lead.subIndustry || "").toLowerCase();

  let best = null, bestScore = 0;

  for (const ins of insights) {
    const kws = String(ins.keywords).toLowerCase()
      .split(/[,;|]+/).map((k) => k.trim())
      .filter((k) => k.length >= 3 && !WEAK.has(k));

    let score = 0;
    for (const k of kws) {
      const re = new RegExp(`\\b${k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
      if (!re.test(blob)) continue;
      // Multi-word phrases are far stronger evidence than single tokens:
      // "facade restoration" matching is a real segment hit, "facade" alone
      // could be anything.
      score += k.includes(" ") ? 3 : 1;
    }

    // Industry agreement is a bonus, never a requirement: sub-industry is
    // often blank on purchased lists.
    const insIndustry = String(ins.industry || "").toLowerCase();
    if (insIndustry && leadIndustry && (insIndustry.includes(leadIndustry) || leadIndustry.includes(insIndustry))) score += 2;
    if (insIndustry && leadSub && (insIndustry.includes(leadSub) || leadSub.includes(insIndustry))) score += 1;

    score *= freshness(ins.sourceDate);

    if (score > bestScore) { bestScore = score; best = ins; }
  }

  // 3 = one multi-word segment hit, or an industry match plus a token.
  // Below that the "match" is noise and the row is better held.
  const MIN_SCORE = 3;
  return bestScore >= MIN_SCORE ? { ...best, score: Number(bestScore.toFixed(2)) } : null;
}

/**
 * The insight as the model should see it: the finding and its implication are
 * the GIVE, the withheld detail is the ASK. Kept as a rigid block so the model
 * restates the number rather than reinterpreting it.
 */
export function insightBlock(ins) {
  if (!ins) return "";
  const L = [];
  L.push("═══ THE GIVE: A REAL KINGS RESEARCH FINDING (this is proprietary, it is why they reply) ═══");
  L.push(`FINDING (state this plainly, keep the number EXACTLY as written, do not round, soften, or reword the figure): ${ins.finding}`);
  if (ins.implication) L.push(`WHAT IT MEANS FOR THEM (one line, in your own words): ${ins.implication}`);
  if (ins.withheld) L.push(`WITHHELD, this is your ASK (offer to send exactly this, name it concretely): ${ins.withheld}`);
  if (ins.sourceDate) L.push(`As of: ${ins.sourceDate}`);
  L.push("RULE: this finding is the entire opening. Do NOT preface it with who you are, do NOT describe the prospect's own business back to them first, and do NOT add any statistic that is not written above.");
  return L.join("\n");
}

/** Header row written when the Insights tab is created for the first time. */
export const INSIGHTS_HEADER = [
  "Industry", "Segment Keywords", "Finding", "Implication", "Withheld", "Source Date"
];
