import { chatJSON } from "./ai";
import { insightBlock } from "./insights";
import { thesisBlock, bulletMatchesThesis } from "./thesis";
import { chooseAngle, chooseClosing, chooseSubjectShape, chooseLeadIn, chooseOpeningForm } from "./angles";
import { dossierBlock } from "./dossier";

// Kept short and focused on genuinely spammy / identity-breaking phrasing.
// (The advisory tone itself is enforced positively in the system prompt.)
export // ── BANNED VOCABULARY, IN TWO TIERS ───────────────────────────────────────
// The single list had grown to 175 entries and every generation tripped at
// least one of them, so no row ever reached Ready. A guard that blocks
// everything is the same as no guard: the operator stops trusting the status
// column and bulk-approves, which is worse than shipping a slightly imperfect
// email.
//
// FATAL  the email is genuinely unshippable. Verbatim templates that appeared
//        on every row, report-vendor vocabulary that undoes the whole
//        repositioning, and flattery dressed as analysis. These force retries
//        and, if they survive, hold the row.
//
// SOFT   worth one repair pass, not worth blocking a send. Mostly hedges and
//        vague offers. If they survive the repair the row still ships, with
//        the residue recorded in Signal so patterns are visible over time.
const BANNED_FATAL = [
  "cagr",
  "market size",
  "market value",
  "forecast period",
  "market forecast",
  "is expected to reach",
  "is projected to reach",
  "by 2030",
  "by 2031",
  "by 2032",
  "by 2033",
  "by 2034",
  "by 2035",
  "usd billion",
  "usd million",
  "syndicated",
  "our report",
  "this report",
  "the report covers",
  "sample copy",
  "table of contents",
  "market study",
  "research report",
  "segmentation analysis",
  "market overview",
  "key players",
  "i hope you're well",
  "i hope you are well",
  "hope you're doing well",
  "hope this finds you",
  "i won't take up your time",
  "no need to reply if",
  "we track your sector pricing quarterly",
  "that you probably cannot from inside",
  "i'm not chasing a reply",
  "i am not chasing a reply",
  "not chasing a reply",
  "just sharing what we're tracking",
  "just sharing what we are tracking",
  "just sharing some insights",
  "just sharing insights",
  "i won't chase you",
  "i wont chase you",
  "no pressure at all",
  "i'm not expecting a reply",
  "i am not expecting a reply",
  "if any of that is worth a longer conversation",
  "you know where i am",
  "reply and i will send the account-movement breakdown",
  "create an opening for",
  "creates an opening for",
  "an opportunity for you",
  "positioned to benefit",
  "positioned to capture",
  "well positioned to",
  "stands to gain",
  "strengthen your market position",
  "capture market share",
  "capture a larger",
  "this could be a win",
  "bodes well",
];

const BANNED_SOFT = [
  "i hope this email finds you well",
  "touching base",
  "reaching out to you today",
  "i noticed that as",
  "i've noticed that as",
  "we provide insights",
  "make better decisions",
  "help you make better decisions",
  "protect and expand their market share",
  "protect and expand its market share",
  "growth pockets",
  "clarify their priorities",
  "sharpen their positioning",
  "sharpen their competitive positioning",
  "sharpen their market positioning",
  "challenges and opportunities",
  "evolving landscape",
  "rapidly evolving",
  "over the next 12 to 24 months",
  "strategic bets",
  "leaders like you",
  "in this dynamic",
  "increasingly pertinent",
  "grappling with",
  "evolving",
  "navigate",
  "navigating",
  "robust financial",
  "next area of growth",
  "what rivals",
  "20-minute",
  "20 minute",
  "20 minutes",
  "20 min",
  "twenty-minute",
  "twenty minute",
  "compare notes on this ahead of your",
  "would you be open to a brief",
  "from my work across your sector",
  "from our work across your sector",
  "observations from my work across",
  "observations from our work across",
  "share some insights from our work",
  "positions you well",
  "well-positioned",
  "well positioned",
  "poised to",
  "capitalize on",
  "market positioning",
  "resonate",
  "resonates",
  "resonated",
  "many firms/companies are",
  "many firms are",
  "many companies are",
  "companies in your space are",
  "capture a larger share",
  "i've observed that",
  "i have observed that",
  "syndicated research spam",
  "projected to grow",
  "expected to grow at",
  "growing at a",
  "may influence",
  "could impact",
  "raises questions about",
  "could influence",
  "may impact",
  "may affect",
  "could affect",
  "raises questions",
  "raise questions",
  "could lead to",
  "may lead to",
  "could result in",
  "may result in",
  "could create",
  "may create",
  "could reshape",
  "may reshape",
  "could shift",
  "may shift",
  "signals a",
  "signalling a",
  "signaling a",
  "positions itself",
  "positioning itself",
  "could prompt",
  "may prompt",
  "potentially expanding",
  "potential impacts",
  "potential implications",
  "worth keeping an eye",
  "something to watch",
  "the breakdown by borough",
  "the read on the implications",
  "our analysis on this",
  "insights on how",
  "i can share insights",
  "if this angle is useful",
  "our detailed read on how",
  "the implications for",
  "our perspective on this",
  "three things we can see that you probably cannot",
  "could allow you to",
  "might allow you to",
  "less competition",
  "diminishing options for customers",
];

const BANNED_PHRASES = [...BANNED_FATAL, ...BANNED_SOFT];

// Buzzwords that make a subject line read like an AI-generated consulting
// report title. Checked as whole words / phrases; a hit forces regeneration.
export const SUBJECT_BANNED = [
  "strategic", "strategy", "strategies", "navigating", "navigate", "navigates",
  "evolving", "landscape", "positioning", "competitive", "challenges",
  "leverage", "leveraging", "optimize", "optimizing",
  "optimisation", "optimization", "enhance", "enhancing", "emerging",
  "dynamic", "pivotal", "perspectives", "growth pockets", "unlock", "unlocking",
  "maximize", "maximizing", "maximise", "synergy", "synergies", "transform",
  "transformative", "transformation", "opportunities", "opportunity",
  // Weak filler that made subjects read templated ("insights on X", "trends in
  // Y", "updates on Z"). A hyper-personalized subject names the concrete thing.
  "insights", "insight", "trends", "trend", "updates", "update", "overview",
  // Abstract category nouns: they describe a topic, not a fact, so they read
  // like a report title even when short ("bcci's quality assurance focus",
  // "DPC's building systems focus"). A real subject names the thing itself,
  // not the category it belongs to.
  "focus", "expertise", "leadership", "factors", "drivers", "capabilities",
  "solutions", "excellence",
  // Weak musing tails: they promise nothing, the tail must name a payoff
  // (the growth angle, what it opens up, next moves).
  "a thought", "quick thought", "one idea for you", "a read for you",
  "worth a look", "some thoughts", "food for thought"
];

const ANCHOR_STOPWORDS = new Set(("the and for with from into over under this that your their have has been will would could company companies group inc ltd llc corp holdings global international services solutions systems technologies technology industries industrial products limited announces announced recent recently expands expansion new").split(" "));

// Build the set of prospect-specific anchor tokens a subject may draw on:
// company-name words, key words from the real event, the matched report title,
// and the industry/sub-industry. A subject that contains none of these could
// have been sent to anyone, which is the opposite of hyper-personalized.
export function subjectAnchors(lead, events = [], reportHook = null) {
  const anchors = new Set();
  const add = (text, minLen) => {
    for (const w of String(text || "").toLowerCase().match(/[a-z0-9$][a-z0-9$-]*/g) || []) {
      if (w.length >= minLen && !ANCHOR_STOPWORDS.has(w)) anchors.add(w);
    }
  };
  add(shortCompany(lead.companyName), 3);
  add(lead.industry, 4);
  add(lead.subIndustry, 4);
  for (const e of events.slice(0, 4)) add(e.what, 5);
  if (reportHook) { add(reportHook.title, 5); add(reportHook.hook, 5); }
  return anchors;
}

// Enforce hyper-personalization: the subject must contain at least one anchor
// token, i.e. name something only THIS prospect would recognize (their company,
// their event, their sector, the matched report). Retries are the enforcement.
export function subjectAnchored(subject, anchors) {
  if (!anchors || !anchors.size) return null;
  const words = String(subject || "").toLowerCase().match(/[a-z0-9$][a-z0-9$-]*/g) || [];
  for (const w of words) {
    if (anchors.has(w)) return null;
    // allow plural/possessive drift: "drones" anchors on "drone" and vice versa
    if (w.length > 4 && (anchors.has(w + "s") || anchors.has(w.replace(/s$/, "")))) return null;
  }
  return "subject has no prospect-specific anchor (name their company, event, product, or sector)";
}

const JOB_TITLE_WORDS = new Set(("ceo cfo coo cto cmo cio cdo chief executive officer founder cofounder president vice vp svp evp director manager head lead leader owner partner principal chairman chairwoman controller regulatory secretary treasurer general managing senior analyst engineer consultant specialist coordinator supervisor administrator representative associate assistant").split(" "));

/** Subjects may be theme- or company-anchored, but must never leak the recipient's job title. */
export function subjectProblem(subject, company, title) {
  const s = (subject || "").toLowerCase();
  const sWords = new Set(s.match(/[a-z]+/g) || []);
  const companyWords = new Set(((company || "").toLowerCase().match(/[a-z0-9]+/g) || []));

  // (1) Never leak the recipient's job title into the subject.
  if (title) {
    for (const w of (title.toLowerCase().match(/[a-z]+/g) || [])) {
      if (JOB_TITLE_WORDS.has(w) && !companyWords.has(w) && sWords.has(w)) {
        return `job-title word "${w}" in subject`;
      }
    }
  }

  // (2) Never write the subject in the RECIPIENT's voice. First-person-plural
  //     ("our strategy", "we're seeing", "impact us") makes an outside advisor
  //     read as if they work at the prospect's company, which breaks the
  //     sender/recipient identity rule. Subjects must stay in the reader's
  //     frame: "your...", the company name, or a neutral question.
  //     - we / our / ours are checked case-insensitively (the bare "we" token
  //       also covers we're / we've / we'll).
  //     - "us" is checked case-SENSITIVELY, so the country "US" / "U.S." in a
  //       subject like "SeAH's US move" is never mistaken for the pronoun.
  const plural = s.match(/\b(we|our|ours)\b/i);
  if (plural) {
    return `first-person-plural "${plural[0]}" in subject (use "your" or the company name)`;
  }
  if (/\bus\b/.test(subject || "")) {
    return `first-person-plural "us" in subject (use "your" or the company name)`;
  }

  return null;
}

// Deterministic backstop, reached only if all model attempts still leaked
// first-person-plural into the subject. Rewrites the sender out of the reader's
// voice: "our strategy" -> "your strategy". For the common possessive case this
// is exactly right; anything else becomes second-person, which is still
// non-leaking and readable. "us" is handled case-sensitively so the country
// "US"/"U.S." is left alone.
function fixSubjectVoice(subject) {
  return (subject || "")
    .replace(/\bours\b/gi, "yours")
    .replace(/\bour\b/gi, "your")
    .replace(/\bwe\b/gi, "you")   // also turns we're / we've / we'll into you're / you've / you'll
    .replace(/\bus\b/g, "you")    // case-sensitive: pronoun only, never the country
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^([a-z])/, (m) => m.toUpperCase());
}

// PATTERNED BOILERPLATE. Literal strings could not hold these: the model
// simply varied the noun. "We track your sector pricing quarterly" was banned
// and "We track UAS developments quarterly" and "We track defense spending
// trends quarterly" sailed straight through on the next rows.
//
// The whole construction is wrong anyway. It makes the email about what Kings
// Research WATCHES, which frames the firm as a monitoring subscription rather
// than a consultancy, and it is a claim the reader cannot verify.
const BANNED_PATTERNS = [
  [/\bwe\s+(?:track|monitor|follow|watch|analyz\w*|analys\w*|observe|study)\b[^.!?]{0,70}\b(?:quarterly|weekly|monthly|daily|continuously|closely|constantly|regularly|routinely|on an ongoing basis|in real time)\b/i,
   'a "we track X quarterly" surveillance claim'],
  // No adverb needed: "We track funding dynamics in your sector." is the same
  // empty habit claim with the giveaway word removed.
  [/\bwe\s+(?:track|monitor|follow|watch|analyz\w*|analys\w*)\b\s+(?:[a-z-]+\s+){0,3}(?:developments?|trends?|dynamics|activity|movements?|changes?|shifts?|landscape|space|sector|market)\b/i,
   'a "we track developments" line that claims a habit instead of naming a finding'],
  [/\b(?:here(?:'s| is| are)|these are)\s+(?:three|3|two|2|a few|some)\s+(?:things|insights?|specifics?|areas?|points?)\b/i,
   'a "here are three things" list preamble'],
  [/\bthings? (?:we|you) (?:can see|cannot see|probably cannot)\b/i, 'an "insider/outsider visibility" claim'],
  [/\bwe\s+can\s+provide\b/i, 'a "we can provide" service menu opener'],
  [/\bcan\s+provide\s+insights?\s+on\b/i, 'a "provide insights on" menu opener'],
  [/\bi'?m?\s+not\s+(?:chasing|expecting|looking for)\s+a\s+repl/i, "an explicit no-reply disclaimer, which is itself a chase"],
  [/\bthe\s+(?:timing|choice|decision)\s+is\s+(?:yours|entirely yours|solely yours)\b/i, "a stock release line"],
  [/\byou\s+can\s+(?:explore|find|keep up with|read)\s+more\b/i, "a footer-style link lead-in"]
];

export function bannedPatternHits(text) {
  const t = String(text || "");
  const out = [];
  for (const [re, label] of BANNED_PATTERNS) {
    const m = t.match(re);
    if (m) out.push(`${label}: "${m[0].trim().slice(0, 60)}"`);
  }
  return out;
}

export function bannedHits(text) {
  const t = (text || "").toLowerCase();
  return BANNED_PHRASES.filter((p) => t.includes(p));
}

/** Unshippable. Forces a retry and, if it survives, holds the row. */
export function fatalHits(text) {
  const t = (text || "").toLowerCase();
  return BANNED_FATAL.filter((p) => t.includes(p));
}

/** Worth one repair, never worth blocking a send. */
export function softHits(text) {
  const t = (text || "").toLowerCase();
  return BANNED_SOFT.filter((p) => t.includes(p));
}

// ── STALE DATES ───────────────────────────────────────────────────────────
// The recency filter drops stale ITEMS, but nothing stopped the model writing
// a date from its own training data: "announced on October 12, 2023" reached a
// live email in 2026. A date that old, stated confidently, destroys exactly
// the credibility the email is trying to build.
// ── FABRICATION GUARD ─────────────────────────────────────────────────────
// The most serious defect in the system, and the one that makes an email
// actively dangerous rather than merely weak.
//
// In one run of eight generated rows, 16 of 17 numeric claims were invented:
// "78% of surveyed farmers", "a 25% rise in demand since Q2 2023", "$2 billion
// in East Midlands renewable contracts", "60% of public entities report budget
// expansions". One email named "XYZ Training Services" as a competitor.
//
// A research firm's entire proposition is that its numbers are real. One
// checkable fabrication in front of a strategy lead does not cost a deal, it
// costs the firm's standing with that person permanently, and they will tell
// colleagues. This is the one guard worth blocking a send for.
//
// The rule: every figure in the email must appear in the research corpus.
// Nothing is inferred, nothing is "probably about right".
const PLACEHOLDERS = /\b(XYZ|ABC|Acme|Company\s+[A-C]\b|Competitor\s+[A-C]\b|\[.*?\]|<.*?>|Lorem|TBD|placeholder|Example\s+(Corp|Inc|Ltd))\b/i;

/**
 * MAGNITUDE-AWARE NUMBER MATCHING.
 *
 * The old check compared DIGIT STRINGS. `digitsOf("$1.2 billion")` is "12",
 * and a site that says "12 regions" therefore validated a fabricated $1.2bn
 * contract value. The same slip passed "$500 million" against "500 completed
 * projects" and "$300 million" against "over 300 staff". Three invented
 * figures shipped in one email, each one waved through by boilerplate.
 *
 * A number is now normalised to its ACTUAL VALUE AND KIND before comparison:
 *
 *   "$500 million"          -> MAG:500000000
 *   "500 completed projects"-> NUM:500
 *   "38%"                   -> PCT:38
 *   "3x"                    -> MULT:3
 *
 * MAG never matches NUM, so a headcount can no longer stand in for a contract
 * value. Matching stays exact rather than approximate: a rounded figure is a
 * different claim, and the reader checks the one you wrote.
 */
const SCALE = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12
};
// LONGEST FIRST. With "k|m|..." leading, the alternation matched the "m" of
// "million" and the claim was extracted as the truncated "$500 m", which then
// compared against a source token built from the full "$500 million" and
// missed. Order matters in a JS alternation; it is not a set.
const SCALE_WORD = "trillion|billion|million|thousand|mm|bn|tn|k|m|b|t";

function num(x) { return parseFloat(String(x).replace(/,/g, "")); }

/** Canonical tokens for a body of text. `bare` adds plain integers, which we
 *  want from the SOURCE (a headline's "500" is evidence) but not from the
 *  BODY (a claim of "three things" is not a checkable figure). */
function canonicalNumbers(text, { bare = false } = {}) {
  const out = new Set();
  const t = String(text || "");
  for (const m of t.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s?%/g)) out.add(`PCT:${num(m[1])}`);
  for (const m of t.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s+per\s?cent(?:age)?\b/gi)) out.add(`PCT:${num(m[1])}`);
  for (const m of t.matchAll(new RegExp(`[$£€]?\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${SCALE_WORD})\\b`, "gi"))) {
    out.add(`MAG:${num(m[1]) * (SCALE[m[2].toLowerCase()] || 1)}`);
  }
  for (const m of t.matchAll(new RegExp(`[$£€]\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\b(?!\\s*(?:${SCALE_WORD})\\b)`, "gi"))) {
    out.add(`MAG:${num(m[1])}`);
  }
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)x\b/gi)) out.add(`MULT:${num(m[1])}`);
  if (bare) {
    for (const m of t.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\b/g)) {
      const raw = m[1].replace(/,/g, "");
      if (/^(19|20)\d{2}$/.test(raw)) continue;   // a 2026 dateline is not evidence for "$2 billion"
      out.add(`NUM:${num(raw)}`);
    }
  }
  return out;
}

/** The checkable figures a reader could look up, with their surface text so
 *  the rejection message can name them. */
function numericClaims(text) {
  const out = [];
  const t = String(text || "");
  for (const re of [
    /\b\d{1,3}(?:\.\d+)?\s?%/g,
    new RegExp(`[$£€]\\s?\\d[\\d,.]*(?:\\s*(?:${SCALE_WORD})\\b)?`, "gi"),
    new RegExp(`\\b\\d[\\d,.]*\\s+(?:${SCALE_WORD})\\b`, "gi"),
    /\b\d+(?:\.\d+)?x\b/gi
  ]) for (const m of t.matchAll(re)) out.push(m[0].trim());
  // Drop any claim wholly contained in a longer one, so "$500 million" is
  // reported once rather than as "$500" and "500 million".
  const all = [...new Set(out)].sort((a, b) => b.length - a.length);
  return all.filter((c, i) => !all.slice(0, i).some((longer) => longer.includes(c)));
}

export function fabricationProblem(body, sourceText = "") {
  const b = String(body || "");

  const ph = b.match(PLACEHOLDERS);
  if (ph) {
    return `it contains the placeholder "${ph[0]}" as if it were a real name. Never invent a company: name one from the research or name none`;
  }

  const src = String(sourceText || "");
  const claims = numericClaims(b);
  if (src.length < 40) {
    if (claims.length) {
      return `it states figures (${claims.slice(0, 3).join(", ")}) with no research behind them on this row. Remove every number and write only what can be supported, or the email is a liability`;
    }
    return null;
  }

  const srcTokens = canonicalNumbers(src, { bare: true });
  const supported = (tok) => {
    if (srcTokens.has(tok)) return true;
    // A magnitude may be evidenced by the same VALUE written plainly.
    const [kind, val] = tok.split(":");
    if (kind === "MAG") return srcTokens.has(`NUM:${val}`);
    return false;
  };
  const unsupported = [];
  for (const c of claims) {
    for (const tok of canonicalNumbers(c)) {
      if (!supported(tok) && !unsupported.includes(c)) unsupported.push(c);
    }
  }

  if (unsupported.length) {
    return `it states ${unsupported.length} figure(s) that appear nowhere in the research: ${unsupported.slice(0, 4).map((x) => `"${x}"`).join(", ")}. Every number must come from the material above. Delete them and make the point without a figure`;
  }
  return null;
}

/**
 * INVENTED ORGANISATIONS.
 *
 * There was no guard for this at all, which is how "Brightline Energy" and
 * "GreenTech Innovations" reached a draft: two companies that do not exist,
 * each credited with a contract that does not exist. The number guard was
 * looking at digits and never at names.
 *
 * This is the more damaging failure of the two. A wrong figure looks like
 * sloppiness; a confidently named counterparty that the reader cannot find
 * anywhere looks like the whole email was generated, because it was.
 *
 * Rule: any organisation named in the body must appear in the retrieved
 * material. The prospect's own company, their name, and Kings Research are
 * exempt for obvious reasons.
 */
const CORP_WORD = /\b(Inc|Incorporated|Ltd|Limited|LLC|LLP|PLC|Corp|Corporation|Company|Group|Holdings|Technologies|Technology|Systems|Solutions|Industries|Partners|Ventures|Labs|Laboratories|Energy|Aviation|Aerospace|Motors|Pharma|Bank|Capital|Networks|Robotics|Dynamics)\b/;

// Words that are capitalised because a sentence started, not because they name
// anything. Without this, "Your Q3 recompetes" reads as an organisation.
const SENTENCE_STARTERS = new Set(("dear your the this these those three two one both last recent reply if when with after every most our we they it in on at for and but so as now here there what which who how a an new happy shall should would could i").split(" "));
const ENTITY_STOP = new Set((
  // dates
  "january february march april may june july august september october november december " +
  "monday tuesday wednesday thursday friday saturday sunday q1 q2 q3 q4 " +
  // us
  "kings research global " +
  // geography and demonyms
  "america american americas europe european asia asian africa african uk us usa eu china chinese " +
  "india indian germany german france french japan japanese canada canadian australia australian " +
  "korea korean taiwan brazil mexico spain italy netherlands nordics gulf uae saudi israel " +
  "north south east west midwest pacific atlantic nato english western eastern " +
  // regulators and agencies that appear constantly in these sectors
  "faa easa fda epa sec dod dot doe nasa caa uscg tsa itar ndaa gdpr ofcom hse " +
  // industry and business acronyms
  "uas utm uav bvlos aam evtol isr ai ml iot saas plm erp crm gtm tam sam kpi roi api sdk " +
  "rfp rfi rfq oem mro ip esg hr it rnd ceo cto cfo coo cmo cio vp svp evp md " +
  "gps lidar radar sar c2 uss usss"
).split(/\s+/).filter(Boolean));

export function inventedEntityProblem(body, sourceText = "", lead = {}) {
  const src = String(sourceText || "").toLowerCase();
  if (src.length < 40) return null;   // nothing to check against; the number guard covers this row

  // Drop the greeting so the recipient's own name is never a candidate.
  const b = String(body || "").replace(/^\s*dear\s+[^,\n]+,?/i, " ");

  const exempt = [lead.companyName, lead.firstName, lead.lastName, "Kings Research", "Kings Global"]
    .filter(Boolean).map((x) => String(x).toLowerCase());

  const candidates = new Set();
  for (const sentence of b.split(/(?<=[.?!:\n])\s+/)) {
    const words = sentence.split(/[\s]+/)
      .map((w) => w.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9&']+$/g, ""))
      .filter(Boolean);
    let run = [];
    let startedSentence = false;   // true when this run began at word 0
    const flush = () => {
      let seq = run.slice();
      // Strip a leading sentence-opener so "Recent Brightline Energy" does not
      // become an entity called "Recent Brightline".
      while (seq.length && SENTENCE_STARTERS.has(seq[0].toLowerCase())) seq = seq.slice(1);
      if (seq.length >= 2) candidates.add(seq.join(" "));
      // A SINGLE capitalised token counts too, as long as it is not the word
      // that opened the sentence. Mid-sentence capitalisation in English is
      // essentially always a proper noun, and restricting to multi-word names
      // is what let "Siemens", "Raytheon", "Thales", "Skydio", "Aegion" and
      // "Fibrwrap" through as Ready in the last run: all invented, all one
      // word. Sentence-initial position is the only real false-positive
      // source, and `startedSentence` excludes exactly that.
      else if (seq.length === 1 && (!startedSentence || /[a-z][A-Z]/.test(seq[0]) || CORP_WORD.test(seq[0]))) {
        candidates.add(seq[0]);
      }
      run = [];
      startedSentence = false;
    };
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      if (/^[A-Z][A-Za-z&.'’À-ɏ-]*$/.test(w) && w.length >= 2) {
        if (!run.length) startedSentence = wi === 0;
        run.push(w);
      } else flush();
    }
    flush();
  }

  const missing = [];
  // Longest first, and a shorter candidate contained in a longer one is the
  // same organisation mentioned twice, not two problems.
  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  const deduped = ordered.filter((c, i) => !ordered.slice(0, i).some((longer) => longer.toLowerCase().includes(c.toLowerCase())));
  for (const cand of deduped) {
    const lc = cand.toLowerCase().replace(/['’]s\b/g, "").trim();
    if (!lc || ENTITY_STOP.has(lc)) continue;
    // A multi-word candidate made entirely of stoplist words is not a company
    // ("North America", "United States").
    if (lc.split(/\s+/).every((tok) => ENTITY_STOP.has(tok))) continue;
    if (exempt.some((e) => e && (lc.includes(e) || e.includes(lc)))) continue;
    if (src.includes(lc)) continue;
    // Lenient fallback: a distinctive token of the name appearing in the
    // research is enough. "Brightline" would pass if the research mentioned
    // Brightline anywhere; it does not.
    const distinctive = cand.split(/\s+/).filter((t) => t.length >= 5 && !CORP_WORD.test(t));
    if (distinctive.some((t) => src.includes(t.toLowerCase()))) continue;
    missing.push(cand);
  }

  if (missing.length) {
    return `it names organisations that appear nowhere in the research: ${missing.slice(0, 3).map((x) => `"${x}"`).join(", ")}. These were invented. Name only companies present in the material above, or make the point without naming anyone`;
  }
  return null;
}

export function staleDateProblem(text, maxAgeDays = 120, now = new Date()) {
  const t = String(text || "");
  const currentYear = now.getFullYear();
  const oldestYear = new Date(now.getTime() - maxAgeDays * 86400000).getFullYear();

  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = parseInt(m[0], 10);
    // Forward-looking references ("by 2028") are a different problem, handled
    // by the report-vendor bans. This is about claiming something HAPPENED.
    if (y > currentYear) continue;
    if (y < oldestYear) {
      return `the email dates an event to ${y}, which is outside the current window. Use only what the research above actually returned, and if it carries no date, do not invent one`;
    }
  }
  // A month named with no year, alongside a year elsewhere, is ambiguous but
  // acceptable. A full date older than the window is not.
  const md = t.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+((?:19|20)\d{2})\b/i);
  if (md) {
    const y = parseInt(md[2], 10);
    if (y < oldestYear) return `the email states "${md[0]}", which is older than the current window. Use only dates the research returned`;
  }
  return null;
}

// A subject reads as AI when it is too long (a report title, not a line you'd
// actually type) or stuffed with abstract buzzwords. Deterministic backstop to
// the prompt's subject rules; a hit forces the model to try again. Genericness
// can't be auto-rewritten the way a pronoun leak can, so the retries are the
// enforcement here.
export function subjectGeneric(subject) {
  const s = (subject || "").toLowerCase();
  const words = (subject || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 11) {
    return `subject too long (${words.length} words, aim <= 8) — reads like a report title`;
  }
  for (const term of SUBJECT_BANNED) {
    const re = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(s)) return `generic buzzword "${term}" in subject`;
  }
  return null;
}

// ── THE MIRROR TEST ───────────────────────────────────────────────────────
// The failure mode on no-news rows: with no event to anchor on, the model
// falls back to the scraped site text and hands the reader a description of
// their own company with a compliment on it. ("DPC's focus on building
// evaluation positions it as a vital partner...") That is not a give, it is
// a mirror, and a senior reader deletes it instantly because they wrote the
// source copy themselves.
//
// Detection: shingle the opening of the body against the scraped site text.
// Heavy overlap means the give was lifted from their own marketing.
const MIRROR_STOP = new Set(("the a an and or but for with from into over under of to in on at by as is are was were be been being this that these those your their our its it we you they he she i not no so if then than there here what which who whom whose when where why how all any both each few more most other some such only own same too very can will just").split(" "));

function shingles(text, n = 3) {
  const w = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  const keep = w.filter((x) => !MIRROR_STOP.has(x));
  const out = new Set();
  for (let i = 0; i + n <= keep.length; i++) out.add(keep.slice(i, i + n).join(" "));
  return out;
}

export function mirrorProblem(body, siteText) {
  if (!siteText || String(siteText).length < 120) return null;
  // Only the GIVE is tested: the first two non-greeting paragraphs. Later
  // lines legitimately name their segments and products.
  const paras = String(body || "").split(/\n\s*\n/).filter(Boolean);
  const give = paras.filter((p) => !/^dear\s/i.test(p.trim())).slice(0, 2).join(" ");
  const a = shingles(give);
  if (a.size < 6) return null;
  const b = shingles(siteText);
  let hits = 0;
  for (const s of a) if (b.has(s)) hits++;
  const ratio = hits / a.size;
  if (ratio >= 0.18) {
    return `the opening is a MIRROR: ${Math.round(ratio * 100)}% of it is lifted from the prospect's own website copy. They wrote that. Open on the finding, the competitor move, or the market shift instead, and never describe their business back to them`;
  }
  return null;
}

// ── LENGTH ────────────────────────────────────────────────────────────────
// Word caps are the difference between an email a VP reads on a phone and one
// they scroll past. Enforced in code because the model treats prompt-level
// limits as suggestions and drifts 40-60% over on roughly one row in five.
export const WORD_CAP = { 1: 140, 2: 60, 3: 100, 4: 130 };

export function lengthProblem(body, step) {
  const cap = WORD_CAP[step] || 100;
  const n = (String(body || "").trim().match(/\S+/g) || []).length;
  const ceiling = Math.round(cap * 1.15); // small tolerance, then reject
  if (n > ceiling) return `the email is ${n} words, the hard limit for this step is ${cap}. Cut it to ${cap} or fewer, delete whole sentences rather than trimming words`;
  return null;
}

// ── PITCH SHAPE ───────────────────────────────────────────────────────────
// A capability list is what turns a give into a vendor pitch. E1 used to be
// specced with one; it is now banned outright in every email, and E4's
// numbered give-away list is the one permitted exception.
// A PROVENANCE line ("we track X quarterly") is wanted and must survive this
// check. What is banned is the MENU: a generic description of the firm and a
// list of interchangeable service categories.
const PITCH_SHAPES = [
  [/\bhow we (can |could )?help\b/i, 'a "how we help" menu'],
  [/\bour (services|offerings|capabilities|solutions)\b/i, "a services menu"],
  [/\b(kings research|kings global) is a (market|strategic|leading|global|research)/i, "a generic description of the firm. Say what you TRACK, not what you ARE"],
  [/\bwe (are|'re) a (market|strategic|leading|global) /i, "a generic description of the firm"],
  [/\bwe (specialise|specialize) in\b/i, "a self-description"],
  [/\bacross (your sector|the sector|your industry)\b/i, "vague sector-wide positioning. Name the actual thing you track"]
];

export function pitchProblem(body, step) {
  const b = String(body || "");
  for (const [re, label] of PITCH_SHAPES) {
    if (re.test(b)) return `it contains ${label}`;
  }
  // Lists: E3 may carry two concrete deliverables, E4 carries the three-item
  // give-away. E1 and E2 carry none.
  const bullets = (b.match(/^\s*[-*•]\s+/gm) || []).length;
  const numbered = (b.match(/^\s*\d[.)]\s+/gm) || []).length;
  const listItems = bullets + numbered;
  if (step === 1) {
    if (bullets > 4) return `it has ${bullets} points. Email 1 allows 3 or 4`;
    if (bullets === 1) return "it has a single point. Email 1's block is 3 or 4 points, or none at all";
  } else if (step === 2) {
    if (listItems >= 2) return "it contains a list. Email 2 is a short reply and carries no list";
  } else if (step === 3) {
    if (bullets > 2) return `it has ${bullets} list items. Email 3 allows a maximum of 2, and only if both are concrete deliverables`;
  } else if (step === 4) {
    if (listItems > 3) return `it has ${listItems} list items. Email 4 is exactly 3`;
  }
  return null;
}

// ── POSITIVITY GUARD ──────────────────────────────────────────────────────
// The brief is now that every hook is GOOD NEWS. The prompt says so, but a
// model trained on the previous version of this prompt reaches for the
// threat framing by reflex ("this puts pressure on your renewals"), and one
// such sentence undoes the whole register. This is the deterministic check.
//
// Deliberately narrow: it fires on the THREAT VOCABULARY aimed at the
// reader, not on any negative word anywhere. "No risk of that" is fine.
// "This threatens your position" is not.
const NEGATIVE_FRAMES = [
  [/\b(threat(?:en(?:s|ed|ing)?)?)\b/i, "a threat framing"],
  [/\byour\s+\w+(?:\s+\w+)?\s+(?:is|are|will be|could be|may be)\s+(?:at risk|exposed|vulnerable|under pressure|squeezed)\b/i, "a warning about the reader's position"],
  [/\b(falling behind|losing ground|lose share|losing share|erod(?:e|es|ing)|squeez(?:e|ed|ing)\s+(?:on|your)|headwinds?)\b/i, "downside language"],
  [/\b(disrupt(?:s|ed|ing|ion)?\s+your|puts?\s+pressure\s+on|at\s+stake\s+for\s+you)\b/i, "a downside framing aimed at the reader"],
  [/\b(before it is too late|risk of missing|you may be missing|might be losing)\b/i, "fear-of-missing-out pressure"]
];

export function negativityProblem(body) {
  const b = String(body || "");
  for (const [re, label] of NEGATIVE_FRAMES) {
    const m = b.match(re);
    if (m) {
      return `it contains ${label}: "${m[0].trim().slice(0, 60)}". Every email in this cadence is anchored on something GOOD for the reader. Rewrite the sentence as what the development OPENS UP, not as what it endangers`;
    }
  }
  return null;
}

// ── REPETITION ────────────────────────────────────────────────────────────
// E2 and E3 kept restating E1. In the DPC run all three emails opened on the
// same Amazon facility closure with the same framing, which reads to the
// reader as one email sent three times. The prompt said "a DIFFERENT give";
// nothing checked it. This does.
export function repetitionProblem(body, earlierBodies = []) {
  if (!earlierBodies.length) return null;
  // Bigrams as well as trigrams. E2 rarely copies E1 verbatim, it PARAPHRASES
  // it ("Fugro is moving its remote operations center to Houston" becomes
  // "Fugro's recent move to shift its remote operations to Houston"), which
  // trigrams miss and bigrams catch.
  const a2 = shingles(body, 2), a3 = shingles(body, 3);
  if (a2.size < 5) return null;
  const overlap = (a, b) => {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const sh of a) if (b.has(sh)) hits++;
    return hits / a.size;
  };
  for (let i = 0; i < earlierBodies.length; i++) {
    const prev = earlierBodies[i];
    const ratio = Math.max(overlap(a2, shingles(prev, 2)), overlap(a3, shingles(prev, 3)));
    if (ratio >= 0.18) {
      return `it repeats email ${i + 1} (${Math.round(ratio * 100)}% overlap). This is a NEW touch and needs a NEW give: a different angle, a different segment, a different second-order effect. Do not restate the same event in different words`;
    }
  }
  return null;
}

// ── OUTPUT SANITY ─────────────────────────────────────────────────────────
// A model return that is not a usable body must never reach the sheet. One
// row shipped a literal "0" into the E3 Body cell because the value was
// passed straight through to Sheets, where USER_ENTERED coerced it.
export function usableBody(v) {
  if (typeof v !== "string") return null;
  const b = v.trim();
  if (b.length < 40) return null;              // not an email
  if (!/[a-z]{3,}/i.test(b)) return null;      // no actual words
  return b;
}

// ── BULLET QUALITY ────────────────────────────────────────────────────────
// Bullets belong in E1. The reason the old ones failed was not that they were
// bullets, it was that they were SERVICE CATEGORIES: "Insights on how
// competitors are adjusting their pricing" fits any company in any sector, so
// it proves nothing. A bullet earns its place only when it names something.
// What counts as "naming something". Deliberately generous: the goal is to
// catch service categories, not to reject good copy on a technicality. An
// earlier version rejected "which three underwriters have already repriced
// hull cover for US-built airframes" because "three" is not a digit and "US"
// is two letters, which is exactly the kind of brittleness that makes a guard
// worse than no guard.
const SPELLED_NUMBERS = /\b(two|three|four|five|six|seven|eight|nine|ten|dozen|half|third|quarter)\b/i;
function isSpecific(text, anchorTokens = []) {
  if (/\d/.test(text)) return true;                          // 38%, $3B, 2024
  if (SPELLED_NUMBERS.test(text)) return true;                // "three underwriters"
  if (/\b[A-Z]{2,}\b/.test(text)) return true;                // US, EU, FAA, UAS
  if (/(?!^)\b[A-Z][a-zA-Z]{2,}/.test(text.slice(1))) return true; // SeAH, Northrop
  if (/\b[a-z]+-[a-z]+(-[a-z]+)?\b/i.test(text)) return true; // cold-work, flange-to-pipe
  return anchorTokens.some((t) => t.length > 3 && text.toLowerCase().includes(t.toLowerCase()));
}

const BULLET_DEAD_OPENERS = /^\s*[-*•]\s*(an?\s+)?(analysis|insights?|evaluation|assessment|understanding|mapping|review|overview|examination|exploration|identification|monitoring)\b/i;

// A bullet is a NOUN THEY CAN BUY. The moment it hedges, it has stopped being
// a deliverable and become a guess about the future, and nobody purchases a
// guess. "how many Walmart partnerships may shift to Wing" is not something a
// Kings Research analyst can produce; "which of your Florida accounts sit in
// Wing's announced service radius" is.
const SPECULATIVE_BULLET = /\b(may|might|could|would likely|potential(ly)?|possibly|perhaps|if they|whether they|how many .* (will|may|might))\b/i;
const QUESTION_BULLET = /^\s*[-*•]\s*(how|what|whether|why|when|which of|do they|are they|is there|can they)\b/i;

// Filler that reads as substance but names nothing. A bullet ending in one of
// these is interchangeable between every prospect in the sector, which is the
// exact failure that made the old three-bullet block feel like a template.
const GENERIC_BULLET_TAILS = /\b(market shifts?|market trends?|emerging technologies|industry trends?|competitive positioning|market dynamics|key players|growth opportunities|best practices|the competitive landscape|market share trends?|customer needs|industry developments?|strategic priorities|operational efficiency)\b/i;

export function bulletProblem(body, step, anchorTokens = []) {
  if (step !== 1 && step !== 3) return null;
  const lines = String(body || "").split("\n").filter((l) => /^\s*[-*•]\s+/.test(l));
  if (!lines.length) return null;

  for (const line of lines) {
    if (BULLET_DEAD_OPENERS.test(line)) {
      return `a bullet starts with an abstract service noun ("${line.trim().slice(0, 55)}..."). That shape is a service category, not a question. Rewrite it naming a real entity, a number, or a named segment`;
    }
    const text = line.replace(/^\s*[-*•]\s+/, "");
    if (SPECULATIVE_BULLET.test(text)) {
      return `the bullet "${text.trim().slice(0, 60)}" is a SPECULATION, not a deliverable ("${(text.match(SPECULATIVE_BULLET) || [""])[0]}"). Nobody can buy a guess about what might happen. Replace it with a named thing a Kings Research analyst produces, taken from the deliverables list`;
    }
    if (QUESTION_BULLET.test(line) && !/^\s*[-*•]\s*which of\b/i.test(line)) {
      return `the bullet "${text.trim().slice(0, 60)}" is phrased as a question. Bullets are things they RECEIVE, not questions you are asking. Rewrite it as the deliverable`;
    }
    if (GENERIC_BULLET_TAILS.test(text) && !isSpecific(text, anchorTokens)) {
      return `the bullet "${text.trim().slice(0, 60)}" ends in filler ("${(text.match(GENERIC_BULLET_TAILS) || [""])[0]}") and names nothing real. Replace the filler with the actual segment, rival, or number it refers to`;
    }
    if (!isSpecific(text, anchorTokens)) {
      return `the bullet "${text.trim().slice(0, 60)}" names nothing specific. Every bullet needs a real name, a number, or a named segment in it, or it could be sent to any company in any industry`;
    }
  }
  return null;
}

// ── SUBJECT AS CLICK MAGNET ───────────────────────────────────────────────
// "Global Aerospace's in-orbit servicing technologies" is a label about
// something the reader already knows, and it is 48 characters of nothing. A
// subject earns the open when something OUTSIDE has moved and it touches them.
/**
 * SUBJECT LINES
 * ──────────────────────────────────────────────────────────────────────────
 * Corrected. I had been enforcing a lowercase, no-company-name, "looks like
 * internal mail" style. That is a SaaS SDR convention and it is the wrong one
 * for consultative research sales, where the buyer is a strategy or insights
 * lead and an unpunctuated fragment reads as sloppy rather than casual.
 *
 * The house rule, which was in the original brief all along:
 *   [Prospect Company] + [a specific, verifiable thing]
 * properly capitalised, professional, and naming the prospect's own company
 * so it is visibly not a blast.
 */
export function subjectMagnet(subject, prospectCompany = "", outsideNames = []) {
  const raw = String(subject || "").trim();
  if (!raw) return "the subject is empty";

  // The prospect's own company name must appear. It is the clearest possible
  // signal that this was written for them and not sprayed at a list.
  const own = String(prospectCompany || "").trim();
  if (own) {
    const core = own.replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|group|holdings|technologies|systems)\b\.?/gi, "").trim();
    const token = (core.split(/\s+/)[0] || core);
    if (token.length > 2 && !new RegExp(token.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i").test(raw)) {
      return `the subject does not name ${own}. The prospect's own company must appear in it, that is what makes it visibly written for them rather than sprayed at a list`;
    }
  }

  // Machine artefacts. A plus sign is not something a person types.
  if (/\s[+|/•·>]\s/.test(raw)) {
    return `the subject uses a "${(raw.match(/\s[+|/•·>]\s/) || [""])[0].trim()}" joiner, which reads as automated. Use plain words or a comma`;
  }
  if (/[\[\]{}<>]|^\s*(re|fwd):/i.test(raw)) return "the subject uses brackets or a fake Re:/Fwd:. Both read as automated or dishonest";

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 3) return `the subject is ${words.length} word(s). Give it 4 to 8: it should read as a proper phrase, not a fragment`;
  if (words.length > 9) return `the subject is ${words.length} words. Keep it to 8 or fewer`;
  if (raw.length > 62) return `the subject is ${raw.length} characters. Keep it under 60 so it survives a phone`;

  // PROPER CAPITALISATION. Sentence case: first letter up, proper nouns up.
  // All-lowercase reads as careless to this buyer, and ALL CAPS as shouting.
  if (/^[a-z]/.test(raw)) return "the subject starts lowercase. Capitalise the first word: this reader expects a professionally written line";
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length > 6 && letters === letters.toUpperCase()) return "the subject is in capitals, which reads as shouting";

  const low = raw.toLowerCase();
  const DEAD = ["quick question", "touching base", "following up", "follow up", "reaching out",
    "checking in", "circling back", "opportunity", "opportunities", "synergy", "collaboration",
    "let's connect", "introduction", "partnership proposal", "exciting", "game changer"];
  const hit = DEAD.find((d) => low.includes(d));
  if (hit) return `the subject contains "${hit}", which is on every reader's ignore list`;

  // Report-title phrasing is the other failure mode for this buyer.
  if (/\b(market (report|study|outlook|overview|analysis)|whitepaper|forecast to \d{4}|cagr)\b/i.test(raw)) {
    return "the subject reads as a research report title, which is exactly the positioning the pivot moves away from";
  }

  // Beyond the company name it must carry one more concrete thing.
  const withoutOwn = own ? low.replace(new RegExp(own.toLowerCase().replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"), " ") : low;
  const ABSTRACT = new Set(("market markets industry sector business strategy strategic growth trends trend " +
    "insight insights opportunity landscape dynamics developments solutions services offerings " +
    "capabilities positioning performance value impact change changes future outlook overview " +
    "analysis approach initiative innovation transformation competitive competition ecosystem").split(/\s+/));
  const STOP = new Set("a an the and or but of in on at to for from with your our its is are was were now just new after before".split(" "));
  const content = withoutOwn.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  if (content.length && !content.some((w) => !ABSTRACT.has(w))) {
    return "apart from the company name every word is abstract. Name the actual thing: the competitor, the programme, the regulation, the number";
  }

  return null;
}

// ── OPENING GUARD ─────────────────────────────────────────────────────────
// Every email in the last run opened on someone else's transaction. The
// prompt asked for effect-first; the model kept reverting because the events
// it was handed are competitor events and the path of least resistance is to
// restate one. This makes it non-optional.
// No SAFE_OPENERS list any more. A list of permitted first words is a menu,
// and a model reading a menu takes the first item: seven of ten emails opened
// "Your ...". What is enforced instead is the ASSIGNED opening form.

// ── PRESUMPTION GUARD ─────────────────────────────────────────────────────
// "Your next conversations with military buyers will face increased
// competition. This shift will alter your pricing strategies." A stranger
// telling a twenty-year veteran what their own conversations and pricing will
// do. The reader's first reaction is irritation, not interest.
//
// Certain about outside facts, modest about their business. This catches the
// second-person future assertion, which is always the presumptuous move.
const PRESUMPTION = [
  [/\byour\b[^.!?]{0,90}?\bwill\b(?!\s+(?:you|i|we|be able|find|see)\b)/i, 'a prediction about the reader\'s own business ("your ... will ...")'],
  [/\b(?:this|that|it|the (?:shift|move|change|deal|acquisition|partnership))\b[^.!?]{0,40}?\b(?:will|is going to)\s+(?:alter|affect|change|impact|reshape|reduce|increase|erode|force|require|shift|tighten|squeeze)\b[^.!?]{0,40}\byour\b/i, "a flat assertion about what will happen inside their company"],
  [/\byou (?:will|must|need to|should) (?:need|have|adjust|reconsider|rethink|revisit|act)\b/i, "telling the reader what they must do"],
  [/\byour (?:market share|margins?|pricing|revenue|pipeline|renewals?) will\b/i, "predicting a specific number inside their business"],
  [/\bis going to (?:hurt|damage|erode|threaten) (?:your|you)\b/i, "a threat framing"]
];

export function presumptionProblem(body) {
  const b = String(body || "");
  for (const [re, label] of PRESUMPTION) {
    const m = b.match(re);
    if (m) {
      return `it contains ${label}: "${m[0].trim().slice(0, 70)}". You cannot know what happens inside their company, and asserting it reads as presumptuous to someone who has run that business for years. State the OUTSIDE fact definitely, with its date, then give the implication as a condition they can test ("whether that reaches your bids depends on ...") or as the question it raises`;
    }
  }
  return null;
}

// ── DATE GUARD ────────────────────────────────────────────────────────────
// "AeroVironment's recent partnership with Applied Intuition, announced on
// October 12, 2023" went out in an August 2026 email. This is a direct
// consequence of the rule demanding a date: given no real one, the model
// invents a plausible one, and an invented date is worse than none at all
// because the reader can check it.
//
// Only dates the research actually returned are permitted, plus month names
// inside the current window. Everything else is rejected.
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";

export function dateProblem(body, allowedDates = [], now = new Date()) {
  const t = String(body || "");
  const nowYear = now.getFullYear();

  // Any explicit year older than last year is stale on its face.
  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = parseInt(m[0], 10);
    if (y < nowYear - 1) {
      return `the email cites ${y}, which is stale. Only events inside the current window may be referenced, and a date that old tells the reader you are not watching their market`;
    }
    if (y > nowYear) {
      return `the email cites ${y}, which is in the future. That is an invented date`;
    }
  }

  // A specific day-level date must match something the research returned.
  const explicit = [...t.matchAll(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\b`, "gi"))].map((m) => m[0]);
  if (explicit.length && allowedDates.length) {
    const allowed = allowedDates.map((d) => String(d || "").toLowerCase());
    for (const e of explicit) {
      const el = e.toLowerCase();
      const monthName = (el.match(new RegExp(MONTHS, "i")) || [""])[0].toLowerCase();
      const dayNum = (el.match(/\d{1,2}(?!\d)/) || [""])[0];
      const ok = allowed.some((a) => a.includes(monthName) && (!dayNum || a.includes(dayNum)));
      if (!ok) {
        return `the email states "${e}" as a date, but the research did not return that date. Never write a date the material does not carry: an invented one is checkable and destroys the credibility of everything else in the email. Say "last month" or "this quarter", or drop the date`;
      }
    }
  }
  if (explicit.length && !allowedDates.length) {
    return `the email states "${explicit[0]}" as a date, but no date came back with this event. Use "last month" or "this quarter" instead of inventing a specific one`;
  }
  return null;
}

/**
 * Strip every occurrence of the connect URL and the sentence carrying it, so
 * the line can be re-attached in exactly one place.
 */
function stripConnect(body) {
  return String(body || "")
    .split("\n")
    .map((line) => {
      if (!/kingsresearch\.com\/connect/i.test(line)) return line;
      // Drop only the sentence that carries the URL, keeping the rest of the
      // line: the ask usually shares it ("Reply and I will send it. You can
      // also connect with me here: <url>").
      const kept = line
        .split(/(?<=[.?!])\s+/)
        .filter((sent) => !/kingsresearch\.com\/connect/i.test(sent))
        .join(" ")
        .trim();
      return kept;
    })
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * THE LINK GOES ON ITS OWN LINE, LAST.
 *
 * Email 1 only, as the final line of the email, after a line break, never
 * appended to the end of the ask sentence. Applied deterministically after
 * generation so it is identical on every row and cannot drift.
 */
export function fixLinkPlacement(body, step) {
  const stripped = stripConnect(body);
  if (!LINK_STEPS.includes(step)) return stripped;
  return `${stripped}\n${CONNECT_URL}`;
}

export function linkProblem(body, step) {
  const b = String(body || "");
  const want = LINK_STEPS.includes(step);
  const count = (b.match(/kingsresearch\.com\/connect/gi) || []).length;

  if (!want) {
    return count > 0
      ? `this email carries the ${CONNECT_URL} link. Only Email 1 does. This is a reply on a thread where the address has already been given, so remove it entirely`
      : null;
  }
  if (count === 0) return `the ${CONNECT_URL} link is missing. It goes on its OWN LINE as the very last line of the email`;
  if (count > 1) return `the link appears ${count} times. Once only, on its own line at the end`;

  const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || "";
  if (!/kingsresearch\.com\/connect/i.test(lastLine)) {
    return "the link is not the last line. It goes on its own line at the very end, after the ask, with nothing following it";
  }
  // It must be ALONE on that line, not tacked onto the end of the ask.
  const withoutUrl = lastLine.replace(/https?:\/\/\S+/g, "").replace(/[\s.,:;()\[\]-]/g, "");
  if (withoutUrl.length > 0) {
    return "the link is appended to the end of a sentence. It goes on a line of its own, below the closing paragraph";
  }
  return null;
}

/**
 * PARAGRAPH SHAPE.
 *
 * The Linzi email was not only false, it was badly built: a four-clause
 * opening, then a paragraph that started a new claim and slid into a bullet
 * list with no break, then a bare CTA. On a phone that is a wall.
 *
 * The shape that reads is fixed and simple:
 *
 *   Dear [First],
 *
 *   The give, and what it changes for them.   2-3 sentences
 *
 *   Lead-in line:
 *   - bullet
 *   - bullet
 *   - bullet
 *
 *   The ask, and on Email 1 the link, in the closing sentence.
 *
 * Enforced here rather than asked for, because "put a blank line between
 * paragraphs" has been in the prompt from the start and is followed about
 * half the time.
 */
export function paragraphProblem(body, step) {
  const b = String(body || "").trim();
  const paras = b.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (paras.length < 3) {
    return "the email is not broken into paragraphs. It needs at least: the greeting, the give, and the ask, each separated by a blank line";
  }
  if (!/^dear\s+[^,\n]+,?$/i.test(paras[0])) {
    return "the greeting is not on its own line. \"Dear [First],\" sits alone with a blank line after it";
  }

  const isBullet = (l) => /^\s*[-*\u2022]\s+/.test(l);
  const bodyParas = paras.slice(1);

  const bulletBlocks = bodyParas.filter((p) => p.split("\n").some(isBullet)).length;
  if (bulletBlocks > 1) {
    return "the bullets are split across separate blocks. Keep them in one contiguous list under a single lead-in line";
  }

  for (const p of bodyParas) {
    const lines = p.split("\n");
    const introducesBullets = lines.some(isBullet);
    if (introducesBullets) {
      // The lead-in may be a fragment, but it must be SHORT. The Linzi email
      // used it to smuggle in two fresh factual claims before the colon,
      // which is how a bullet block became the middle of an argument instead
      // of a list. New claims belong in their own paragraph above.
      const intro = lines.filter((l) => !isBullet(l)).join(" ").trim();
      const iw = intro.split(/\s+/).filter(Boolean).length;
      if (iw > 30 || numericClaims(intro).length) {
        return "the lead-in above the bullets is asserting facts instead of introducing the list. It is one short line ending in a colon, and it carries no figures: move any factual claim into its own paragraph above it";
      }
      continue;
    }
    const prose = lines.join(" ").trim();
    if (!prose) continue;
    const words = prose.split(/\s+/).filter(Boolean).length;
    const sentences = prose.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 1).length;
    if (sentences > 3) {
      return `a paragraph runs to ${sentences} sentences. Three is the ceiling: split it or cut one, because a senior reader scans this on a phone`;
    }
    if (words > 60) {
      return `a paragraph runs to ${words} words. Sixty is the ceiling. Delete a whole sentence rather than compressing the words`;
    }
  }

  // The connect URL is a trailing LINE, not a paragraph: drop it before
  // measuring the closing paragraph, or the word count punishes the URL.
  const last = (paras[paras.length - 1] || "")
    .split("\n").filter((l) => !/^https?:\/\/\S+$/i.test(l.trim())).join("\n").trim();
  if (last.split("\n").some(isBullet)) {
    return "the email ends on a bullet. Close with a sentence: the ask is prose, and it is the last thing they read";
  }
  if (last.split(/\s+/).filter(Boolean).length > 45) {
    return "the closing paragraph is too long. The ask is one or two sentences";
  }
  void step;
  return null;
}

export function openingProblem(body, prospectCompany = "", outsideNames = [], openingForm = null) {
  const paras = String(body || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const first = (paras.find((p) => !/^dear\s/i.test(p)) || "").trim();
  if (!first) return null;
  const sentence = (first.split(/(?<=[.?!])\s/)[0] || first).trim();

  const compTokens = String(prospectCompany || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const startsWithOwn = compTokens.some((c) => sentence.toLowerCase().startsWith(c));
  if (startsWithOwn) return null; // their own name is fine, it is their world

  // Any outside org named in the first few words is a backwards opening.
  const head = sentence.split(/\s+/).slice(0, 4).join(" ");
  for (const n of outsideNames) {
    const name = String(n || "").trim();
    if (name.length < 3) continue;
    const firstWord = name.split(/\s+/)[0];
    if (new RegExp(`^\\s*(the\\s+)?${firstWord.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i").test(head)) {
      return `the email opens on "${firstWord}", which is somebody else's news. Open on what is changing in ${prospectCompany || "the reader"}'s own world and put ${firstWord} in the SECOND sentence as the reason`;
    }
  }
  if (/^(the\s+)?(pentagon|faa|fda|epa|sec|congress|government|department of)\b/i.test(head)) {
    return `the email opens on an outside body, which is not the reader's world. Lead with what changes for them and name the body in the second sentence`;
  }
  // "Your" is reserved for the POSSESSIVE form, one of six. Without this the
  // whole list opens the same way.
  if (/^your\b/i.test(sentence) && openingForm && openingForm.key !== "POSSESSIVE") {
    return `the email opens with "Your", but the assigned opening form for this prospect is ${openingForm.key}. Seven of ten emails in the last run opened "Your ...", which makes a list read as one template. Rewrite the first sentence in the assigned form: ${openingForm.rule}`;
  }
  if (openingForm && openingForm.key === "QUESTION" && !/\?/.test(first)) {
    return `the assigned opening form is QUESTION, but the opening contains no question. Open with a real question their internal data cannot answer`;
  }
  return null;
}

// ── PROSE NORMALIZER ──────────────────────────────────────────────────────
// The model capitalises inconsistently: within one email some bullets opened
// with a capital and some did not, and sentences after a full stop were left
// lowercase. It reads as careless, which is fatal in an email whose entire
// claim is rigour. Fixed deterministically after generation rather than asked
// for in the prompt, because a prompt cannot guarantee it and this can.
const ABBREV = /\b(?:[A-Z]\.|e\.g|i\.e|etc|vs|approx|est|Inc|Ltd|Co|Corp|Dr|Mr|Mrs|Ms|Jr|Sr|St|No|Fig|U\.S|U\.K|E\.U)\.$/;

// Dotted acronyms must survive the space-after-punctuation rule. "U.S. Coast
// Guard" was arriving as "U. S. Coast Guard" in shipped emails, which reads as
// a broken template and undermines everything else in the message.
const DOTTED_ACRONYM = /\b(?:[A-Za-z]\.){2,}/g;

export function normalizeProse(text) {
  // The model sometimes writes the two characters backslash-n rather than an
  // actual line break, which shipped a whole body as a single visible line.
  text = String(text || "").replace(/\r\n/g, "\n").replace(/\\r\\n|\\n/g, "\n");
  let t = String(text || "");

  // PROTECT URLS AND EMAILS FIRST. The space-after-punctuation rule below
  // treated the dots in "https://www.kingsresearch.com/connect" as sentence
  // ends and produced "https://www. Kingsresearch. Com/connect", a dead link
  // in every email that carried one. Masked here, restored at the end.
  const vault = [];
  const stash = (m0) => { vault.push(m0); return `\u0000V${vault.length - 1}\u0000`; };
  t = t.replace(/(https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+|[\w.+-]+@[\w-]+\.[\w.-]+)/gi, stash);
  t = t.replace(DOTTED_ACRONYM, stash);

  // Collapse stray double spaces, but never touch newlines.
  t = t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n");
  // A space is required after sentence punctuation followed by a letter.
  t = t.replace(/([.?!,;:])([A-Za-z])/g, (m, p, c) => (/[.?!]/.test(p) ? `${p} ${c}` : `${p} ${c}`));

  const lines = t.split("\n").map((line) => {
    const bullet = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)(.*)$/);
    const prefix = bullet ? bullet[1] : "";
    let body = bullet ? bullet[2] : line;
    if (!body.trim()) return line;

    // First character of every line and every list item is capitalised, so a
    // list is never half upper and half lower.
    body = body.replace(/^([a-z])/, (m0, c) => c.toUpperCase());

    // Capitalise after sentence ends, skipping abbreviations.
    body = body.replace(/([.?!])(\s+)([a-z])/g, (m0, punct, sp, ch, off, whole) => {
      const before = whole.slice(0, off + 1);
      if (ABBREV.test(before)) return m0;
      return `${punct}${sp}${ch.toUpperCase()}`;
    });

    return prefix + body;
  });

  t = lines.join("\n");
  // A bulleted item should not end in a full stop when its siblings do not;
  // normalise the whole list to no trailing period, which reads cleaner.
  const items = t.split("\n").filter((l) => /^\s*[-*•]\s+/.test(l));
  if (items.length >= 2) {
    t = t.split("\n").map((l) => (/^\s*[-*•]\s+/.test(l) ? l.replace(/\.\s*$/, "") : l)).join("\n");
  }

  // Restore untouched.
  t = t.replace(/\u0000V(\d+)\u0000/g, (m0, i) => vault[Number(i)] || "");
  return t;
}

// ── THE CONNECT LINK ──────────────────────────────────────────────────────
// Blended into the body rather than appended, so it reads as part of the
// sentence a person would write, not as a footer.
//
// DELIVERABILITY NOTE: a link in the first touch measurably lowers inbox
// placement on cold sends. LINK_STEPS controls where it appears. If reply
// rates fall or seed tests show worse placement, change this to [3, 4].
export const CONNECT_URL = "https://www.kingsresearch.com/connect";
// EMAIL 1 ONLY, and only in the closing line. A link repeated across three of
// four touches reads as a campaign, and a link mid-thread invites the reader
// to leave before they have finished the paragraph. E2-E4 are replies on an
// established thread; they need no address, they need a point.
export const LINK_STEPS = [1];

function cleanDashes(t) {  return (t || "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s*--\s*/g, ", ")
    .replace(/,\s*,/g, ",").replace(/,\s*\./g, ".");
}

// Emails end at the CTA; the sending platform appends the Kings Research
// signature. Strip any sign-off / signature the model adds on its own.
function stripSignature(body) {
  return (body || "")
    .replace(/\n\s*(Best|Regards|Cheers|Warm regards|All the best|Sincerely|Thanks|Kind regards|Thank you|Looking forward|Talk soon|Yours)[\s,]*\n?[\s\S]*$/i, "")
    .replace(/\n\s*\[(Your )?Name\][\s\S]*$/i, "")
    .trim();
}

// Sheets are inconsistent about company casing ("bcci", "DPC", "Echodyne").
// A subject or body that repeats "bcci" verbatim reads as sloppy to a C-suite
// reader. Names already containing a capital letter are left untouched (the
// person who entered them presumably got the branding right, e.g. "eBay").
// All-lowercase names are normalized: a short, spaceless token (<=5 chars)
// is almost always an acronym -> uppercase it (bcci -> BCCI); anything longer
// gets Title Cased word-by-word.
function properCaseCompany(name) {
  const trimmed = (name || "").trim();
  if (!trimmed || /[A-Z]/.test(trimmed)) return trimmed;
  if (!trimmed.includes(" ") && trimmed.length <= 5) return trimmed.toUpperCase();
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortCompany(name) {
  const stripped = (name || "").replace(/\b(plc|ltd|limited|inc|incorporated|llc|corp|corporation|holdings|group|co)\.?$/gi, "").trim() || name;
  return properCaseCompany(stripped);
}

// Decide whether a row is safe to auto-mark "Ready" or should be held for a
// human. Broken company data (a bare domain or empty) would risk a hallucinated
// company name, so it is skipped entirely. A clean company with no real signal
// still gets a draft, but is flagged "no signal" so a person decides before it
// sends, rather than blasting generic filler.
export function reviewStatus(lead, events, insight = null, dossier = null) {
  const company = (lead.companyName || "").trim();
  const domainLike = !company.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(company);
  if (!company) return { ready: false, skipGeneration: true, reason: "missing company name" };
  if (domainLike) return { ready: false, skipGeneration: true, reason: "company is a domain, add a real company name" };

  // A row is only sendable if it has something to GIVE. Three sources count,
  // in order: a matched proprietary finding, a per-row insight, or a real
  // competitor/market/company event.
  //
  // Everything else is a mirror: an email that describes the prospect's own
  // business back to them. Those used to be drafted and marked "Needs review",
  // which in practice meant they got sent anyway on a bulk approve. They are
  // still drafted (a human may attach a real finding), but the reason now
  // names the actual problem so it is obvious what to fix.
  const hasFinding = !!(insight || (lead.insight && String(lead.insight).trim()));
  if (hasFinding) return { ready: true, skipGeneration: false, reason: "" };

  // A verified dossier IS a give, and on most rows it is a better one than a
  // news event: it carries a dated market move, a named rival, and a reason
  // the reader cannot get from inside their own building.
  if (dossier && !dossier.empty && (dossier.hooks.length || dossier.news.length ||
      (dossier.domain && dossier.domain.domainMoves.length))) {
    return { ready: true, skipGeneration: false, reason: "" };
  }

  // Search ran and returned nothing that survived sourcing. This is the row
  // that produced "Real-time compliance solutions that enhance operational
  // efficiency are a priority for your customers": fluent, confident, about
  // nothing. It is still drafted, because a human may attach a finding, but
  // the reason now says plainly that there is no material behind it.
  if (dossier && dossier.empty) {
    return { ready: true, skipGeneration: false, reason: "no sourced research found, copy is advisory framing only, review before sending" };
  }

  // NO POSITIVE EVENT is no longer a held row. Under the positive-anchor
  // brief most rows will land here, because genuinely good, genuinely recent,
  // genuinely relevant news is rare, and holding the majority of a list makes
  // the status column meaningless. The advisory framing (a hooked market
  // opening plus 3 or 4 points on the work Kings Research would do for them)
  // is a complete email, and it is what an advisory firm has to sell anyway.
  if (!events || !events.length) {
    return { ready: true, skipGeneration: false, reason: "advisory framing, no positive news hook in the last four months" };
  }

  return { ready: true, skipGeneration: false, reason: "" };
}

/**
 * Deterministic anchor ordering. The system prompt tells the model to lead on
 * a competitor or market move, but nothing enforced WHICH event it saw first,
 * and models anchor hard on position 1. That is how a DJI row with a live
 * market event ("U.S. bans new China-made drones") still opened on DJI's own
 * product launch. Sorting in code removes the choice.
 */
export function sortEvents(events = []) {
  const rank = (e) => {
    // INVERTED under the positive-anchor brief. A competitor event survives
    // the filter only in the rare case where it is a genuine tailwind for the
    // reader, so it can no longer outrank the reader's own win, which is the
    // strongest positive hook there is.
    if (e.subject === "self") return 0;
    if (e.subject === "market") return 1;
    return 2; // competitor
  };
  return [...events].sort((a, b) => rank(a) - rank(b));
}

// "Map Keywords with Report Hooks": deterministic keyword-overlap match of a
// lead against the Reports tab. The matched report TITLE and HOOK come straight
// from the sheet, never from the model, so the pitched report cannot be
// hallucinated. Returns null when nothing genuinely matches.
export function matchReportHook(lead, companyIntel, reports) {
  if (!Array.isArray(reports) || !reports.length) return null;
  const blob = [
    lead.industry, lead.subIndustry, lead.title, lead.department,
    shortCompany(lead.companyName),
    companyIntel && companyIntel.description,
    companyIntel && companyIntel.keywords
  ].filter(Boolean).join(" ").toLowerCase();

  let best = null, bestScore = 0;
  for (const r of reports) {
    const kws = String(r.keywords).toLowerCase().split(/[,;|/]+/).map((k) => k.trim()).filter((k) => k.length >= 3);
    let score = 0;
    for (const k of kws) {
      const re = new RegExp(`\\b${k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
      if (re.test(blob)) score += k.includes(" ") ? 2 : 1; // multi-word matches count double
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 1 ? best : null;
}

/**
 * Persona = the strategic tension a seat tends to live with, plus the advisory
 * angle Kings Research leads with. Used to tailor the capability framing.
 */
export function resolvePersona(lead) {
  const blob = `${lead.department || ""} ${lead.title || ""}`.toLowerCase();
  const has = (t) => (t.length <= 3 ? new RegExp(`\\b${t}\\b`).test(blob) : blob.includes(t));
  if (["procurement", "purchasing", "sourcing", "supply chain", "vendor", "buyer", "logistics"].some(has))
    return ["PROCUREMENT", "TENSION: pricing volatility, supplier reliability, and margin pressure with no clean external cost benchmark. ADVISORY ANGLE: supplier and cost benchmarking, supply-chain and sourcing intelligence."];
  if (["sales", "business development", "account executive", "commercial", "revenue", "country manager", "gtm"].some(has))
    return ["SALES", "TENSION: shifting buyer demand and losing share to more agile competitors, without segment-level visibility for GTM. ADVISORY ANGLE: segment and competitor mapping, which segments and regions to prioritise."];
  if (["marketing", "brand", "demand gen", "cmo", "growth"].some(has))
    return ["MARKETING", "TENSION: where demand is moving and which segment to pursue before peers do. ADVISORY ANGLE: demand and competitive positioning analysis."];
  if (["product", "plm", "portfolio", "cpo", "product manager", "product management"].some(has))
    return ["PRODUCT", "TENSION: which segment or application to build for next, and which competing products are gaining ground. ADVISORY ANGLE: segment and application-level analysis, competing-product tracking."];
  if (["strategy", "strategic", "corporate development", "corp dev", "ceo", "coo", "chief", "president", "founder", "managing director"].some(has))
    return ["STRATEGY", "TENSION: which segment or application merits investment next, and what peers are committing to. ADVISORY ANGLE: segment growth and application-level assessment, peer-move monitoring."];
  if (["finance", "treasury", "accounting", "fp&a", "investment", "actuar", "pricing", "cfo", "controller", "regulatory", "compliance", "risk", "audit"].some(has))
    return ["FINANCE", "TENSION: assumptions and cost lines defended by feel because no clean external benchmark exists, with regulatory shifts reshaping them. ADVISORY ANGLE: defensible external benchmarking, policy and regulatory impact analysis."];
  if (["r&d", "engineering", "cto", "technical", "innovation", "technology", "scientist", "data scien"].some(has))
    return ["R&D", "TENSION: which technology, material, or standard is about to become table stakes. ADVISORY ANGLE: technology-adoption tracking and competitive technology mapping."];
  return ["LEADERSHIP", "TENSION: where the next area of growth is, what rivals see that they do not, and which moves to prioritise. ADVISORY ANGLE: opportunity and white-space assessment, competitive and ecosystem positioning."];
}

const SYSTEM_PROMPT = `You are a senior advisor at Kings Research (Kings Global), a strategic market-intelligence and advisory firm. You write short, warm, credible cold emails to senior leaders. You are a thinking partner who leads with something useful, NOT a vendor asking for a meeting.

THE ONE RULE THAT MATTERS (give before you ask):
- Every email must GIVE the reader something concrete and useful BEFORE it asks for anything. The give is a specific observation, a real data point, or a sharp outside angle they do not already have. If a sentence would fit any company in any industry, it is not a give, cut it.
- You are writing to earn a reply from a busy, senior person. They will give you nothing if you give them nothing. No email may be a request for their time dressed up in flattery.

IDENTITY RULE (never violate):
- YOU are the SENDER at Kings Research (an advisory firm). The prospect is the RECIPIENT at THEIR company. Never conflate the two, never replace their company with "we/our", and NEVER invent a company name. If you are unsure of their company, do not name one.

NEVER USE THE READER'S OWN BAD NEWS (hard rule):
- A negative or sensitive event at the prospect's OWN company (an executive detained or arrested, a lawsuit, a probe, a scandal, layoffs, a bankruptcy, a fatal incident, a recall, a breach, sanctions or fines) is NEVER a hook, a give, an aside, or a PS. You are emailing an employee of that company; raising their employer's crisis reads as ambulance-chasing, embarrasses the reader internally, and burns the domain. If the only events available are sensitive, write as if there is no event at all.
- A COMPETITOR'S setback is different: it is a legitimate market signal for the reader (share may move, customers may re-evaluate). If you use one, state it soberly as a market fact and the question it raises, never gloat and never speculate on wrongdoing.

COMPETITOR AND MARKET MOVES ARE YOUR HOOK (this is the single most important rule after the give):
- The reader has complete information about their own company and almost none about their rivals. That information gap is the ONLY thing you are selling. An email about the reader's own news tells them what they already know; an email about a RIVAL's move tells them something they cannot see from inside. Write the second one.
- HARD RULE: if ANY screened event has subject "competitor" or "market", Email 1 MUST anchor on it. Anchoring on the reader's own news while a competitor or market event is available is a failed email, rewrite it.
- Shape of the anchor: name the rival's move plainly and factually, then state in one line the concrete question it raises for the READER's business (their share, their pricing, their pipeline, their renewal cycles), then offer the specific read. That is the whole give.
- ANCHOR PRIORITY for Email 1, never inverted: (1) a supplied Kings Research FINDING, which outranks all news because it is proprietary and no rival can reproduce it, (2) a relevant competitor or market/regulatory move and its implication for the reader, (3) the reader's own event with an OUTSIDE angle, (4) nothing, in which case write short and honest rather than padding.
- Never name a competitor you were not given. If no competitor event is in the context, do NOT invent one to satisfy this rule, fall to the next anchor.

YOU ARE NOT A REPORT VENDOR (the reader has deleted a thousand of those):
- NEVER write: a market size, a CAGR, a growth percentage, a forecast, a "by 2030" figure, a currency-and-billions projection, a "key players" list, a segmentation breakdown, a table of contents, a sample copy offer, or the words "report", "syndicated", or "market study". One of these and the email is dead on arrival.
- The thing you offer to send is a READ, a BRIEF, a BREAKDOWN, or a TEARDOWN of a specific situation, never a report or a sample. Name it concretely, e.g. "what the pricing change does to mid-market renewals", not "our latest report".

DO NOT LECTURE THEM ABOUT THEIR OWN NEWS:
- If the prospect's company made a move (a pivot, deal, launch, closure), do NOT ask them what they plan to do about it or explain its significance, they know their own decision far better than you do. That reads as condescending.
- Instead bring an OUTSIDE angle: what you are seeing elsewhere that connects to their move, and offer to share the specifics. The value is the outside view, not a quiz about their own choice.

CONSULTANCY, NOT A DATA VENDOR:
- Kings Research helps leadership teams think through decisions, it is not a report you can buy. NO market-size, CAGR, forecast, or "growing at Y%" figures anywhere. The only numbers allowed are ones the prospect's OWN company announced, or a real INSIGHT supplied to you below.

USING A SUPPLIED INSIGHT:
- If a REAL INSIGHT is provided in the context, THAT is your give, lead the FIRST email with it in plain words, as the concrete thing you are bringing. Do not water it down.
- If NO insight is provided, your give is a specific, genuinely useful outside observation tied to the event or the reader's actual business, PLUS a concrete offer to send the underlying detail (name the specific thing you would send). NEVER fabricate statistics, client names, or specific outcomes to manufacture a give.

GROUND EVERYTHING IN REAL RETRIEVED FACTS (do not hallucinate):
- A RESEARCH DOSSIER (the company's own website text and its recent news) is provided in the context. Every factual claim in your email must be supported by that dossier, the supplied insight, or the event.
- Do NOT invent industry "trends", statistics, competitor actions, partnerships, or developments that are not in the dossier. A generic invented trend ("I'm seeing a trend where insurers tailor products to emerging risks...") is THE failure mode, never write one.
- If the dossier is thin, make your give a specific TRUE point about what the company actually does (grounded in its own words) plus an honest offer to share Kings Research's read, and keep it short. Less is better than fabricated.

STRUCTURE (short, and the shape matters as much as the words):
- "Dear [First]," then a blank line.
- THE GIVE, first sentence, no run-up. State the finding, the competitor move or the market shift with its number or named mechanism intact. Never open with "I was looking at", "I noticed", "I came across", "As a leader in", or anything about the sender.
- ONE line on what it means for THEM: a cost, a risk, a shift in their customers, something about to land on their desk.
- The CTA (see below), one line.
THE EMAIL 1 SHAPE (this exact shape, it is what earns the reply):
  1. The give: the market event and what it is, in one or two sentences, with its specifics intact.
  2. The consequence FOR THEM: one line naming what actually changes. A price, a renewal, a buyer's budget, a competitive threat. Not "this is significant", not "this may influence".
  3. "We can help ${'${comp}'} with:" and THREE bullets, each naming one of their real segments, buyers, rivals or the event itself.
  4. One line offering a specific named thing, and a reply ask.

ESTABLISHING WHO YOU ARE (a stranger's insight is worthless without provenance):
- The reader does need to know why you, of all people, are telling them this. But there is a right way and a wrong way, and the difference decides whether they reply.
- WRONG, a MENU: "Kings Research is a market-intelligence and advisory firm that works across your sector. We can help [Company] with: - Analyzing how X positions you against competitors - Mapping competitor moves - Understanding customer shifts". Generic service categories, interchangeable between every prospect in the sector. The reader stops at the colon.
- RIGHT, a PROVENANCE LINE: ONE sentence saying HOW YOU KNOW the thing you just told them, written as a piece of EVIDENCE rather than a claim about your habits.
  THE TEST: name the specific body of work the fact came out of, the way an analyst would cite their own dataset. Point at the thing you counted, the round of filings you read, the set of awards you went through, the interviews you ran. Something with an edge to it that a reader could ask a follow-up question about.
  BANNED SHAPE, and this is absolute: any sentence of the form "we track / monitor / watch / analyse [something] [quarterly / monthly / continuously / closely / regularly]". It asserts a habit, not a finding. It is unverifiable, it is what a monitoring subscription says, and it has appeared in almost every email this system has ever written. If your provenance line contains "we track", delete it and write what you FOUND instead.
  If you cannot name a specific body of work, write NO provenance line at all. Silence is better than a habit claim.
- PLACEMENT: the provenance line goes AFTER the give, never before it. Opening with who you are wastes the two lines a phone shows. Email 1 gets exactly one such line. Email 3 may go further (see its instructions). Emails 2 and 4 get none, they are replies on a thread where you have already introduced yourself.
- Lists are permitted in exactly three places: Email 1's advisory block (3 or 4 points, and ONLY on rows with no news event, see the NO NEWS section), Email 3's two concrete deliverables, and Email 4's three-item give-away. Nowhere else.
- Even in the permitted places, a list of SERVICE CATEGORIES is still banned. "Competitor benchmarking / market sizing / customer research" is a brochure. Each point must name a thing that exists in THIS company's world: their segment, their buyer type, their geography, their programme, their certification, their sales cycle.
- WORD LIMITS ARE HARD: E1 140 words, E2 60, E3 100, E4 130. Including the greeting. If you are over, delete a whole sentence, do not compress words.

CERTAIN ABOUT FACTS, HUMBLE ABOUT THEIR BUSINESS (this is the whole difference between a consultant and a cold caller):
- "Your next conversations with military buyers will face increased competition. This shift will alter your pricing strategies and affect buyer preferences." Read that as the person receiving it. A stranger has just told a twenty-year industry veteran what their own conversations will be like and what their pricing will do. It is presumptuous, and the reader's first reaction is not interest, it is irritation.
- The rule: BE DEFINITE ABOUT WHAT HAPPENED OUTSIDE THEIR COMPANY. Be MODEST ABOUT WHAT IT MEANS INSIDE IT.
    Outside, state it flatly, with a date: what was announced, by whom, when, with the number. No hedging on verifiable facts, hedging there just reads as unsure.
    Inside, you do not know their book, their pipeline, or their roadmap. They do. Offer the implication as a read they can accept or reject, or as the question it raises. Attach it to a CONDITION so they can test it against what they know.
- NEVER write a sentence of the form "your X will Y". No "your conversations will face", "this will alter your pricing", "this will affect your buyers", "you will need to". Predicting their future is the intimidating move and it is always wrong, because you cannot know.
- The mature version of the same content: state the outside fact with its date, then name the specific condition under which it matters to them, then let them judge. Something along the lines of naming what changed, then "whether that reaches your bids depends on whether buyers are already asking for X, which you would see before we would."
- This is not hedging. Hedging is being vague about facts. This is being precise about facts and honest about the limits of what an outsider can know. The first is weak, the second is what earns a reply from a senior person.

EVERY NUMBER MUST COME FROM THE MATERIAL ABOVE. THIS IS ABSOLUTE:
- TWO KINDS OF NUMBER, and only one of them is ever allowed.
  ALLOWED: a figure attached to a REAL, DATED, SOURCED EVENT in the material above. A contract value that was announced, a funding amount that was raised, a headcount a company published, a figure inside a supplied Kings Research finding. These are checkable, and the reader checking them and finding them right is the point.
  FORBIDDEN, always, with no exception and regardless of how well sourced you believe it to be: a market size, a CAGR, a growth rate, a forecast, a projection, a "2026-2032" range, a TAM, an adoption rate, or any figure describing how big a market is or will become. Kings Research is not selling a report and the moment one of these appears the email is re-filed as one.
- So: numbers are permitted when they describe something that HAPPENED. They are banned when they describe something PROJECTED. If the material contains a forecast figure, do not use it.
- Do not write a percentage, a currency figure, a growth rate, an adoption rate or a survey result unless it appears verbatim in the research block. Not one.
- NEVER INVENT A COUNTERPARTY. Naming a company that won a contract, made an investment, or entered a market, when that company is not in the material above, is the single most damaging thing you can do. The reader searches the name, finds nothing, and every other sentence becomes suspect. If you do not have a real named counterparty from the research, describe what changed without naming anyone.
- If you feel a sentence needs a number and the research has none, the sentence does not need a number. Make the point qualitatively, or make a different point.
- Never invent a company name, and never use a placeholder. Naming "XYZ Training Services" or "Company A" as a competitor is worse than naming nobody.
- Kings Research sells the reliability of its numbers. One checkable fabrication in front of a strategy lead does not cost a deal, it costs the firm's standing with that person permanently, and they tell colleagues. An email with no figures still works. An email with one invented figure is a liability.

POSITIVE ANCHOR ONLY (this replaces the old "find the uncomfortable angle" rule, and it is absolute):
- The event you open on must be GOOD NEWS, judged from the reader's side of the table: a win, a contract, a funding round, a certification, a partnership, a new facility, a launch, an approval, an expansion, an award, or a rule change that widens their market. Nothing else is a hook.
- FORBIDDEN as a hook or an aside, however elegantly phrased: a threat, a loss, a rival closing in, a squeeze, a risk they have not priced, a warning about what might not transfer, a downturn, a ban, a tariff, a restriction, an investigation, or anything the reader would read as "a stranger is telling me my position is weaker than I think". If the only event available is one of those, treat the row as HAVING NO EVENT and use the advisory framing instead.
- BUT POSITIVE IS NOT FLATTERY, AND THIS IS THE WHOLE CRAFT OF IT. "Congratulations on the Series C, that is a huge milestone" is worthless: they know, everyone has said it, and nothing was offered. The move is to take their good news as the PREMISE and add something they do not have.
- THE SHAPE: [their win, stated flatly with its number and its date] then [the forward question it opens that they cannot answer from inside] then [what you hold on that question]. The value sits in the second and third parts, never the first.
  WEAK: "Echodyne's new radar facility is an impressive step forward and positions you well for growth."
  STRONG: "Echodyne's new radar line comes online right as three of the primes you sell into are re-opening their sensor qualification lists. Which of those lists a new facility gets onto, and on what evidence, is decided outside the building."
  Same fact, same positive register, but the second one hands them something.
- FORWARD, NEVER BACKWARD. Because the anchor is a win, the natural next thought is what it opens up: which adjacent segment it makes reachable, which buyers it newly qualifies them for, where comparable moves went next. Write that. You are not warning them about anything.
- Do not congratulate more than once and never in the subject. One clause acknowledging the news is the ceiling; the rest of the email is the give.
- NO NEGATIVE VOCABULARY anywhere in the body: threat, threaten, risk, squeeze, pressure, erode, vulnerable, exposed, lose, losing, falling behind, disrupt, headwind, at stake. If a sentence needs one of those words, the sentence is the old rule showing through, delete it.

THE ONE-SENTENCE TEST (apply before you finish):
- Could this email have been sent to any other company in the sector by swapping the name? If yes it is worthless, rewrite it.
- Does the opening tell the reader something they already know about themselves? If yes, that is a MIRROR, not a give. They wrote their own website. Delete it and open on the finding or the rival's move instead.
- Is there a number, a named competitor, or a named mechanism in the first two sentences? If not, you have not given anything.

THE CTA (offer value, do NOT ask for a meeting):
- Ask them to let you SEND something specific, or to reply, NOT for a call or "20 minutes". Name the specific thing you would send.
- NEVER ask for a meeting. NEVER use "a brief 20-minute conversation", "a short 20-minute call", "20 minutes", or "would you be open to a brief ...". The goal is a reply and a value exchange first.
- NEVER end two emails in a cadence with the same or a near-identical closing sentence, a repeated closer is the clearest mass-mail tell. If a list of already-used closing lines is provided, your closing line must be clearly different from all of them.
- Senior, unhurried tone. GOOD shapes (vary them, do not copy verbatim): "Shall I send it over?"; "If helpful, I will send it across, just reply."; "Happy to share it, no strings attached."; "If [specific topic] is on your radar, reply and I will forward our read."; "Reply 'send' and it is yours." Avoid the tic of ending every email with "want them?".

PLAIN LANGUAGE (write like a sharp human, not like AI, this matters):
- Say something SPECIFIC to THIS company and THIS event. If a sentence would fit any company in any industry, cut it or replace it with something only this reader would recognize.
- BANNED words/phrases anywhere in the email (they are the reason cold emails read as AI-generated): "growth pockets", "strategic bets", "white space / white-space", "competitive positioning", "navigate / navigating", "evolving landscape", "evolving demands", "rapidly evolving", "dynamic industry / market", "both challenges and opportunities", "clarify their priorities", "sharpen their positioning", "leaders like you", "undoubtedly", "increasingly pertinent / critical", "pivotal", "resonate / resonates", "grappling with", "over the next 12 to 24 months", "in today's ... landscape". Do not use these or close variants.
- Keep advisory-area jargon (competitor mapping, white-space assessment, technology-adoption tracking, and so on) OUT of the prose give and questions; if you reference how Kings Research helps, do it in the tailored 2 to 3 item Email 1 list, phrased specifically to this prospect.
- Prefer short, concrete, plain words. One clear idea per sentence, no stacked abstractions.
- Vary your wording across the four emails, do not reuse the same phrases or sentence shapes.

SUBJECT LINES (this is where the open is won or lost, get it right):
- CLICK MAGNET RULE: when there is a real event, the subject names BOTH the company AND the specific movement or decision, e.g. "DroneUp's pivot to airspace management", "Echodyne's $40M radar factory", "DJI shuts its education division", "Insitu's Orbital UAV deal". Seeing their own company next to their own news is what earns the open.
- With NO event, name the company and ONE concrete, true thing about them, e.g. "Global Aerospace and UAS cover", "where Global Aerospace is exposed".
- VALUE TAIL (the candy): after the company + news anchor, add a short tail that promises a CONCRETE BUSINESS PAYOFF a decision-maker wants: the growth angle, the expansion play, what it opens up, where the upside is, the revenue angle, next moves. e.g. "DJI's education exit, the growth angle"; "Echodyne's $40M factory, what it opens up"; "USI's Amcor partnership, the expansion upside"; "DroneUp's airspace pivot, next moves"; "Insitu's Orbital deal, where the upside is". Keep the company and the news UP FRONT; the tail is short. VARY the tail across the four emails, never reuse one.
- NEVER use weak musing tails: "a thought", "a quick thought", "one idea for you", "a read for you", "worth a look". They promise nothing. The tail must name a payoff.
- NEVER clickbait or pushy: no "don't miss", "urgent", "act now", no fake scarcity, no exclamation marks. Confident and specific, not salesy.
- GRAMMAR: possessives of names ending in s take a bare apostrophe: "Engineers and Architects' focus", "Influential Drones' program", NEVER "Architects's".
- SHORT: aim 5 to 9 words, hard maximum 10. Sentence case (capitalize only the first word and proper nouns), conversational, like a busy person typed it, not a report title. ALWAYS use the company name's EXACT given capitalization verbatim, character for character, e.g. "BCCI's", "DPC's", "Echodyne's" - never lowercase a company name or acronym, never re-case it. No em dashes, use commas.
- CONCRETE, not abstract: "Echodyne's $40M radar factory" (company + a real movement) is right. NEVER the "[Company] + Abstract Business Nouns" report-title format. BANNED examples: "Jones Brothers Trucking Competitive Positioning", "EvapTech, Inc. Navigating Operational Efficiency Challenges", "Strategic perspectives for Algal Bio in the evolving Food Additives Market landscape".
- EXECUTIVE TRUST TEST: a C-suite reader deletes anything that smells like a mass campaign. Before finalizing, ask: could a stranger have written this about ANY company in the sector by swapping the name? If yes, rewrite it. The tail must name a checkable FACT or MECHANISM (a dollar figure, a named deal, a specific segment, a specific capability), never a category label like "focus", "expertise", "leadership", or "opportunities" standing in for one. "Echodyne's $40M radar factory" is checkable and earns trust; "BCCI's quality assurance focus" is a category, not a fact, and reads as mail-merge.
- NEVER copy this prompt's own example tails verbatim ("the growth angle", "the expansion upside", "next moves", "where the upside is", "demand drivers", "trust factors") - they are illustrations of the SHAPE, not lines to reuse. Write a tail specific to this prospect's actual facts.
- BANNED subject words: strategic, strategy, navigating, evolving, landscape, positioning, competitive, challenges, opportunities, leverage, optimize, enhance, emerging, dynamic, pivotal, perspectives, unlock, maximize, transform, synergy, focus, expertise, leadership, factors, drivers.
- Reader's frame only: NEVER first-person-plural (we, our, us, ours). Naming the company is required, but NEVER the recipient's job title, and no salesy words (Free, Guaranteed, Buy).

PARAGRAPH SHAPE (this is a hard structure, not a suggestion):
- "Dear [First]," alone on its own line, then a BLANK LINE.
- Then the give and what it changes for them. AT MOST THREE SENTENCES and AT MOST SIXTY WORDS in any one paragraph. If you have more to say, start a new paragraph; if you cannot, delete a whole sentence rather than compressing words.
- If the email has bullets, they sit in ONE contiguous block under ONE short lead-in line, with a blank line before the lead-in. Never two separate bullet groups, never bullets mixed into running prose.
- The ask is ALWAYS its own final paragraph, in prose, one or two sentences. Never end on a bullet.
- A BLANK LINE between every paragraph. Not a single newline, a blank line.

THE LINK:
- The address ${'${CONNECT_URL}'} appears in EMAIL 1 ONLY, and nowhere else in the cadence. Emails 2, 3 and 4 are replies on a thread where you have already given it; repeating it is what makes a sequence read as a campaign.
- In Email 1 it goes in the LAST SENTENCE of the LAST PARAGRAPH, inside that sentence, once. Nothing follows it. Never on a line of its own, never as a footer, never in the middle of the email where it invites the reader to leave before they have finished reading.

STYLE: warm but professional, appropriate for a senior executive. No em dashes or en dashes (use commas or "and").

Return ONLY valid JSON: {"subject": "...", "body": "..."}. No markdown.`;

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events, reportHook = null, insight = null, buyerWorld = "", thesis = null, angle = null, subjectShape = "", closing = "", leadIn = "", openingForm = null, dossier = null) {
  const comp = shortCompany(lead.companyName);
  const L = [];
  if (angle) {
    L.push("═══ YOUR ENTRY ANGLE FOR THIS PROSPECT (not negotiable) ═══");
    L.push(`ANGLE: ${angle.name}`);
    L.push(angle.open);
    L.push("");
    if (openingForm && openingForm.rule) {
      L.push(`OPENING FORM for Email 1 (the grammatical shape of your first sentence, not optional): ${openingForm.rule}`);
    }
    L.push("");
    L.push(`SUBJECT SHAPE for Email 1: ${subjectShape}`);
    L.push(`CLOSING MOVE for Email 4: ${closing}`);
    L.push(`LEAD-IN STANCE for the Email 1 bullet block: ${leadIn}`);
    L.push("These are assigned per prospect so that no two people on this list receive the same-shaped email. Twenty emails built from one template read as bulk mail, whatever the words are. Follow the angle even when a different opening feels more natural.");
    L.push("");
  }
  if (thesis) { L.push(thesisBlock(thesis)); L.push(""); }
  L.push("DATE RULE: the ONLY dates you may write are the ones printed beside the events below. Do not add a date from your own knowledge, do not guess a month, and do not convert a relative date into a specific one. If an event carries no date, write \"last month\" or \"this quarter\" or nothing at all. A date the reader checks and finds wrong ends the relationship, and it is the one thing in this email they can check in thirty seconds.");
  L.push("");
  L.push("═══ PROSPECT INTELLIGENCE (personalize from this; never paste verbatim) ═══");
  if (buyerWorld) {
    // Whose budget actually moves. An aviation INSURER is not moved by rocket
    // launches; it is moved by hull rates, claims and fleet risk. Anchoring on
    // the wrong market is how "in-orbit servicing" ended up in an email to an
    // insurance operations lead.
    L.push(`WHO THEY SELL TO AND WHAT THOSE BUYERS WORRY ABOUT: ${buyerWorld}`);
    L.push("Anchor the email in THAT market. A development in an adjacent field that does not touch their buyers' budgets is not a hook, however impressive it sounds.");
  }
  L.push(`Name: ${lead.firstName} ${lead.lastName} | Title: ${lead.title} | Level: ${lead.level || "-"}`);
  L.push(`Company: ${comp} (RECIPIENT's company, use this exact short name) | HQ: ${[lead.city, lead.country].filter(Boolean).join(", ")}`);
  L.push(`Industry / sector: ${lead.industry || "-"} / ${lead.subIndustry || "-"}`);
  if (companyIntel.description) L.push(`What the company does (from its website): ${companyIntel.description}`);

  // Grounded research dossier: the real retrieved text the email MUST draw
  // from. Raw headlines are deliberately EXCLUDED: for generic company names
  // ("Global Aerospace") the news query phrase-matches unrelated stories, so
  // the only news the email may cite are the relevance-screened EVENT SIGNALS.
  if (companyIntel.siteText) {
    L.push("");
    L.push("═══ RESEARCH DOSSIER (real retrieved facts, this is the ONLY material you may state as fact) ═══");
    L.push(`In ${comp}'s own words (from its website): ${companyIntel.siteText}`);
    L.push("GROUNDING RULE: every factual statement in the email must be supported by this dossier, the supplied insight, or the EVENT SIGNALS below. The event signals are the ONLY news you may reference; never cite any other headline, partnership, or development. Do NOT invent industry 'trends', statistics, or competitor moves. If the dossier only tells you what the company does, make your give a specific, TRUE point about their actual business plus an honest offer, never a made-up trend.");
  }

  // ── THE VERIFIED DOSSIER ──────────────────────────────────────────────
  // Sits ABOVE the event signals because it is strictly better material:
  // every line carries a date and a source that was actually opened, whereas
  // the RSS path could only ever offer a headline. On rows where the dossier
  // is present, it is what the email is written from.
  const dBlock = dossierBlock(dossier, comp);
  if (dBlock) {
    L.push("");
    L.push(dBlock);
  }

  // ANCHOR 1: a matched proprietary Kings Research finding. This outranks
  // every news event, because it is the one thing a competitor with the same
  // tooling cannot reproduce. It also works on a prospect with no news at all,
  // which is the majority of any list.
  if (insight) {
    L.push("");
    L.push(insightBlock(insight));
  } else if (lead.insight) {
    L.push("");
    L.push("═══ THE GIVE: A REAL FINDING SUPPLIED ON THIS ROW (open EMAIL 1 on it in plain words, do not water it down) ═══");
    L.push(String(lead.insight));
  }

  if (events && events.length) {
    L.push("");
    L.push("═══ REAL EVENT SIGNALS (screened twice: genuinely relevant to what THIS company does, AND positive from their point of view. Every item here is at most four months old. Open EMAIL 1 on the ONE most relevant and use its 'angle' as the forward question) ═══");
    events.slice(0, 6).forEach((e, i) => {
      L.push(`${i + 1}. [${e.type} | ${e.scope || "industry"} | subject: ${e.subject || "self"}]${e.recency ? ` (${String(e.recency).slice(0, 16)})` : ""} ${e.what || e.headline || ""}`);
      if (e.angle) L.push(`   angle: ${e.angle}`);
    });
    L.push("If an event is about another organization, use its 'angle' to raise the question it creates for the prospect, never frame it as a deal the prospect is party to or can 'leverage'.");
    if (events.some((e) => e.subject === "competitor" || e.subject === "market")) {
      L.push(`These events survived a POSITIVE-ONLY screen, so every one of them is a tailwind for ${comp}. Open on the one that most clearly opens something up for them, and use its 'angle' as the forward question. Do not reframe any of them as a risk, and never present a market shift as something ${comp} needs to defend against.`);
    }
  } else {
    L.push("");
    L.push("═══ NO NEWS EVENT FOUND ═══");
    if (insight || lead.insight) {
      L.push(`There is no news hook, and none is needed: the FINDING above is the give. Open EMAIL 1 on it. Use the dossier only to make the implication specific to ${comp}, never as the opening.`);
    } else {
      L.push(`There is no positive news event and no proprietary finding for this prospect. Use ADVISORY FRAMING, which is a complete and legitimate email, not a fallback you should apologise for. Kings Research is a market intelligence and advisory firm; on a row like this the email sells the WORK rather than a headline.`);
      L.push(`STRUCTURE FOR EMAIL 1 ON THIS ROW:`);
      L.push(`1. A HOOKED OPENING, one or two sentences. Anchor it on something structurally TRUE about the market ${comp} sells into, in their vocabulary: how buying decisions in their segment actually get made, what a buyer compares before they commit, which part of the cycle is decided outside the building. It must be a statement about their MARKET, never a description of ${comp} itself. They wrote their own website; reading it back to them is a mirror and a senior reader deletes it on sight.`);
      L.push(`2. ONE SHORT LEAD-IN LINE saying what Kings Research does, in one clause, as provenance, not as a brochure. Say what you TRACK. Never "Kings Research is a leading market intelligence firm".`);
      L.push(`3. THEN 3 OR 4 POINTS, each on its own line starting with "- ". These are the advisory work you would do FOR THIS COMPANY, and they are the reason the email exists. Each point must name something real out of the dossier or the domain profile: their actual segment, their actual buyer type, their actual geography, their actual product line, a named certification or contract vehicle, a real competitor. A point that would fit any company in the sector is worthless, rewrite it.`);
      L.push(`   The four areas to draw from, phrased as the deliverable and not as the category: where demand in their segment is forming and who is capturing it; who they are actually being compared against in live deals and on what terms; which adjacent segment or geography their current capability already qualifies them for; and what buyers in their category are now asking for that they were not asking for a year ago.`);
      L.push(`   WRONG (a brochure): "- Competitive benchmarking and market sizing". RIGHT (a deliverable): "- who else bid the last three municipal water-treatment retrofits in the Midwest, and what separated the winning terms".`);
      L.push(`4. A CTA offering to send ONE of those points, named specifically. Not a meeting.`);
      L.push(`TONE: positive and forward-looking throughout. No warnings, no risks, no "you may be missing". You are describing work that would help them grow, not a problem they have.`);
      L.push(`Do NOT invent an industry trend, a statistic, a client name, or a competitor. Everything the points reference must come from the dossier or the domain profile above. A point can name a real segment without carrying a number; it must never carry a number you invented.`);
    }
  }

  L.push("");
  const advisoryAngle = (personaDesc.split(/ADVISORY ANGLE:/i)[1] || personaDesc).replace(/\.\s*$/, "").trim();
  L.push(`PERSONA STEER (${personaKey}): internal note only. If it fits naturally, lean the give toward ${advisoryAngle}. Never put the persona, the job title, or a positioning line into the prose.`);
  return L.join("\n");
}

function nextQuarter() {
  const q = ["Q2","Q2","Q2","Q3","Q3","Q3","Q4","Q4","Q4","Q1","Q1","Q1"];
  return q[new Date().getMonth()];
}

function stepPrompt(step, lead, ctx) {
  const first = lead.firstName;
  const comp = shortCompany(lead.companyName);
  const sector = (lead.subIndustry || lead.industry || "your sector").toString();

  // Only EMAIL 1 carries a subject. E2-E4 are thread replies in Smartlead and
  // inherit E1's subject as "Re: ...", so asking the model for three more
  // subjects burned tokens and gave the banned-word guard three more chances
  // to reject an otherwise-good body.
  const common = step === 1
    ? `\nKeep it SHORT. Lead with the GIVE, do not open with who you are. No market-size/CAGR/forecast figures, no invented stats or client names. The ask is a REPLY or to SEND something specific, NEVER a meeting or "20 minutes". No signature or sign-off, end at the CTA. No em/en dashes. \\n\\n between paragraphs. SUBJECT in the reader's frame ("your" or the company name), never "we/our/us". Return ONLY {"subject":"...","body":"..."}`
    : `\nKeep it SHORT. This is a REPLY on the same thread as Email 1, so there is NO subject line: do not write one. Lead with the GIVE. No market-size/CAGR/forecast figures, no invented stats or client names. The ask is a REPLY or to SEND something specific, NEVER a meeting or "20 minutes". No signature or sign-off, end at the CTA. No em/en dashes. \\n\\n between paragraphs. Return ONLY {"body":"..."}`;

  if (step === 1) return `${ctx}

Write EMAIL 1 (first touch) to ${first} at ${comp}.
HARD LIMIT: 140 words total, including the greeting. Shorter is better. A senior reader sees roughly the first 90 characters on a phone, so the FIRST SENTENCE must carry the give.
- "Dear ${first}," then a blank line.
- EFFECT FIRST, CAUSE SECOND. THIS IS THE MOST IMPORTANT RULE IN THIS PROMPT.
  The first sentence describes SOMETHING CHANGING IN THE READER'S OWN WORLD, in their vocabulary, about their work. The cause comes SECOND, in the next sentence, as the explanation.
  WRONG, and it is what every previous email did: "Procore's $845M acquisition of DroneDeploy will shift your customer landscape." That opens on a stranger's transaction. The reader's eye has to travel through someone else's news before reaching anything of theirs, and on a phone that is the entire preview.
  RIGHT: "The FAA waiver clears the way into three metro corridors that were closed to you last quarter. It landed last month, and it is the same approval two of the operators already scaling in those corridors were waiting on."
  Same facts. The reader appears in sentence one and the outside detail appears in sentence two, where it belongs, as the reason.
- THE OPENING MUST BE A HOOK, and a hook has a specific job: make the second sentence unavoidable. It does that by putting a CONCRETE, POSITIVE, CHECKABLE fact next to an OPEN QUESTION it raises. Fact alone is a news alert. Question alone is a survey. The pair is a hook.
  Test it on the phone preview, which is roughly the first 90 characters: after those 90 characters, does the reader want the rest? If the first line could be swapped into an email to their competitor without changing a word, it is not a hook, it is a header.
  A hook is never a compliment, never a rhetorical question ("Have you considered ...?"), never a statistic with no owner, and never the word "imagine".
- ABSOLUTE: THE FIRST SENTENCE MUST NOT BEGIN WITH THE NAME OF ANY COMPANY THAT IS NOT THE READER'S OWN, AND MUST NOT BEGIN WITH "The Pentagon", "The FAA", or any other outside body. Begin with "Your", "The renewals", "Two of the", "Buyers in", "The qualification window", or whatever names the reader's situation. If your draft opens on an outside name, you have written it backwards, rewrite it.
- Follow the ENTRY ANGLE assigned in the angle block above. It tells you WHICH part of their world to open on.
- The opening must carry SUBSTANCE, not a headline restated. A fact plus a guess about its effect is not substance. Test it: does the first half tell the reader something about how their own world works that they had not connected? If it only says a thing happened and asserts it is bad for them, they have read forty of those this month.
- THE FACT MUST BE CHECKABLE, but NEVER AT THE COST OF BEING TRUE. Give the counterparty, the number, and the programme where the material carries them.
- ON DATES: use RELATIVE time unless the material above states an exact date. "Last month", "three weeks ago", "this quarter" are always safe and read naturally. An exact date you invented is worse than no date at all, because the reader can check it and will, and the moment one detail is wrong every other claim in the email becomes suspect. If the material does not give you a date, do not produce one.
- THEN one line making it concrete on their side: a cost, a bid, a renewal, a qualification, a budget cycle, a named segment. Never "this will impact your market share", which asserts nothing.
- THEN 3 or 4 POINTS, each on its own line starting with "- ". These are the reason the email works, so get them right. Three is the floor and four is the ceiling: two reads as thin, five reads as a brochure.
  WHAT THEY ARE: the specific pieces of work Kings Research would put in front of this person, each one answering something THEY CANNOT ANSWER FROM THE INSIDE. Each point names a real entity, a number, a named segment, or a named mechanism from the material above.
  KEEP THEM POSITIVE IN DIRECTION: what is opening up, who is buying, what they now qualify for, where the demand is forming. Not what they are missing and not what could go wrong.
  GOOD, because each one implies you already hold the answer:
    - which three underwriters have already repriced hull cover for US-built airframes
    - where the displaced AirMap accounts actually went in the two prior UTM exits
    - what Wing's Florida launch does to your per-drop economics in that corridor
  BAD, because they are service categories that would fit any company in any sector:
    - Insights on how competitors are adjusting their pricing in response to market shifts
    - Analysis of emerging technologies and their impact
    - Evaluation of market share trends among key players
  TEST EACH POINT: could it be sent, word for word, to a company in a different industry? If yes, it is worthless, rewrite it with a name, a number, or a named segment in it.
  BUT THE NAME MUST BE REAL. Every company, agency, programme or contract you name in a point must appear in the material above. Inventing a plausible-sounding winner ("Brightline Energy took the $500m contract") to make a point concrete is the worst failure available to you: the reader searches it, finds nothing, and stops trusting the entire email. A point naming a real SEGMENT with no company in it is always better than a point naming a company that does not exist.
  NEVER start a point with "Analysis of", "Insights on", "Evaluation of", "Assessment of", "Understanding", "Mapping", or "A review of". Those are category labels; the reader is buying an answer, not a method.
- ONE SHORT LEAD-IN line before the bullets, ending in a colon, carrying NO figures and NO new factual claims. Its only job is to hand over to the list.
  Do NOT write "Kings Research is a market-intelligence and advisory firm", do NOT write "We can help ${comp} with", and do NOT write any variant of "we track ${sector} quarterly" or "we monitor this closely". Those are the two failure modes: a brochure and a habit claim.
  Write the lead-in yourself in six to twelve words. It should read like the moment a colleague turns their laptop round.
- CTA: its OWN final paragraph, prose, one or two sentences. Offer the specific named thing. "Reply and I will send the account-movement breakdown from both exits." NEVER a meeting, never "20 minutes".
- THE LINK: weave ${CONNECT_URL} into the LAST SENTENCE of that closing paragraph, once, inside the sentence. Nothing comes after it. It appears in this email only, never in Emails 2, 3 or 4.
SUBJECT: the house rule, and it is not negotiable.
- IT MUST NAME ${comp}. The prospect's own company appears in the subject line. That is what makes it visibly written for them rather than sprayed at a list, and for this buyer it is the strongest open-rate lever there is.
- SHAPE: ${comp} plus ONE specific, verifiable thing. The competitor and its move, the regulation, the programme, the figure, the segment. Join them with plain words such as "and", "after", "in", or "means for". Never a plus sign, pipe, arrow or bracket.
- 4 to 8 WORDS, under 60 characters.
- PROPERLY CAPITALISED, SENTENCE CASE. First word capitalised, proper nouns capitalised, the rest lowercase. Not all-lowercase, which reads as careless to a strategy or insights lead. Not Title Case, which reads as a press release.
- GRAMMAR MUST BE CLEAN. It is the first evidence the reader has of whether you are worth reading.
- It should read as a line a senior consultant would put on an email to a client: professional, specific, unhurried. Not clever, not a tease, not a headline.
- NEVER a research-report title: no "market outlook", "industry analysis", "forecast to 2030", "whitepaper".
- POSITIVE REGISTER, matching the body. The subject names the win and what it opens, never a warning. "Echodyne's new radar line and the primes' qualification lists" is right. "What Echodyne's expansion puts at risk" is not, and neither is anything with threat, risk, pressure, losing, or falling behind in it.
- NEVER: "quick question", "touching base", "following up", "reaching out", "opportunity", "synergy", "let's connect", "exciting", or ${comp}'s name standing alone with nothing else.
- Beyond ${comp}'s name it must carry one concrete thing. ${comp} plus abstractions ("market dynamics", "strategic priorities") names nothing and will not be opened.
- Use the SUBJECT SHAPE assigned in the angle block above for the arrangement. Write the words yourself.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (thread reply, no subject) to ${first} at ${comp}.
HARD LIMIT: 60 words. This is the shortest email in the sequence.
- "Dear ${first}," then a blank line.
- A SECOND, DIFFERENT give. NOT a restatement of E1, NOT "just floating this to the top", NOT "following up", NOT "circling back". A bump that gives nothing spends a touch and earns nothing. Use a second finding or a second angle from the context. If the context genuinely holds one give only, take a NARROWER cut of it (a sub-segment, a second-order effect) rather than repeating it.
- CTA: one short line, a DIFFERENT ask from E1. No meeting.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (thread reply, no subject) to ${first} at ${comp}. This is where Kings Research's actual work earns the reply.
HARD LIMIT: 100 words.
- "Dear ${first}," then a blank line.
- Name ONE specific SEGMENT or APPLICATION ${comp} actually serves, taken from the dossier or the event. Be precise: a product line, a customer type, a coverage class, a geography, a named use case.
- Give Kings Research's read on THAT segment: what is moving, who is moving into it, where the opening or the squeeze is. A substantive observation, never a question and never a description of their own business read back to them.
- ABSOLUTELY NO market size, CAGR, forecast, or "by 2030" figure. That one move re-files you as a report vendor and the thread is over.
- THEN, and only here in the whole cadence, two lines on WHAT KINGS RESEARCH WOULD ACTUALLY DO on this specific segment. Each on its own line starting with "- ". These must be concrete deliverables tied to the segment you just named, phrased as the thing they would receive: "- who is winning ${comp}'s renewals in that segment and on what terms" NOT "- competitive positioning analysis". Generic service categories are worse than saying nothing. Two items maximum, and only if you can make both specific.
- CTA: its own final paragraph, offering the named read for that segment, closing line different from E1 and E2. NO LINK: this is a reply on the thread where Email 1 already gave the address, and repeating it is what makes a sequence read as a campaign.${common}`;

  return `${ctx}

Write EMAIL 4 (thread reply, no subject) to ${first} at ${comp}. This is the LAST touch and it should be the HIGHEST-REPLY email in the sequence, because it asks for nothing.
HARD LIMIT: 130 words.
- "Dear ${first}," then a blank line.
- Open with the CLOSING MOVE specified in the angle block above, in your own words. Write the line yourself. Do not announce that you are not chasing a reply: saying it is itself a chase, and every email in the last run opened with that exact move.
- Then GIVE IT ALL AWAY: exactly 3 numbered items, one line each, each a concrete thing Kings Research is watching in their space right now. Draw them from the finding, the events and the dossier. Every item must be checkable and specific: a number, a named move, a named mechanism. No advice, no "consider whether you...", no generic observations.
- Close with an open door and NO ASK: no CTA, no offer to send anything, no question mark. Write that final line yourself, differently from any stock closing. The absence of an ask is the entire point of this email. Do not put one back in.
- NO LINK. Email 1 carried it; this is the touch that asks for nothing, and a URL is an ask.${common}`;
}

// Guarantee the body opens with "Dear <First>," on its own line. The model
// occasionally drops the greeting and opens mid-sentence (as in Roy's email);
// this is the deterministic backstop so no email ever goes out unaddressed.
function ensureGreeting(body, first) {
  const b = (body || "").trim();
  if (/^dear\s+/i.test(b)) {
    return b.replace(/^(Dear\s+[^,\n]+,)\s*\n?(?!\n)/i, "$1\n\n");
  }
  const name = (first || "there").toString().trim() || "there";
  return `Dear ${name},\n\n${b}`;
}

// Last non-empty line of a body = its closing / CTA line.
function ctaLine(body) {
  const lines = (body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].toLowerCase() : "";
}

export async function generateEmail(step, lead, companyIntel, news, events = [], usedSubjects = [], usedCTAs = [], insight = null, earlierBodies = [], buyerWorld = "", thesis = null, deadline = 0, dossier = null) {
  const wantsSubject = step === 1; // E2-E4 are thread replies, no subject
  const [pKey, pDesc] = resolvePersona(lead);

  // THE DOSSIER AS EVIDENCE, not just as context.
  //
  // This flattening is load-bearing and easy to miss. fabricationProblem()
  // rejects any figure that does not appear in the source corpus, so without
  // this the guard would reject the dossier's OWN sourced numbers as invented
  // and hold every well-researched row for review. The better the research,
  // the worse the failure would look: exactly the rows worth sending are the
  // ones carrying figures.
  const dsr = dossier && !dossier.empty ? dossier : null;
  const dossierFacts = dsr ? [
    ...dsr.news.map((n) => `${n.headline} ${n.why || ""} ${n.date}`),
    ...(dsr.domain ? [dsr.domain.market, dsr.domain.sells, dsr.domain.buyers] : []),
    ...(dsr.domain ? dsr.domain.competitors.map((c) => `${c.name} ${c.why}`) : []),
    ...(dsr.domain ? dsr.domain.domainMoves.map((m) => `${m.what} ${m.soWhat} ${m.date}`) : []),
    ...(dsr.person ? [dsr.person.roleScope, dsr.person.background, ...dsr.person.speaksAbout] : []),
    ...dsr.krFit.map((k) => `${k.offer} ${k.because}`),
    ...dsr.hooks.map((h) => `${h.hook} ${h.evidence}`)
  ].filter(Boolean).join(" \n ") : "";
  // Assigned per prospect, stable on re-run, spread across the list.
  const angle = chooseAngle(lead, events, thesis);
  // Outside organisations the model might wrongly lead on.
  // The only dates the copy may state. Anything else is invented.
  const allowedDates = [
    ...(news && news.items ? news.items.map((i) => i.date).filter(Boolean) : []),
    ...(events || []).map((e) => e.recency).filter(Boolean),
    // Dossier dates are the only ones in the pipeline that were verified
    // against the page they came from, so they are the most trustworthy
    // dates the copy can carry.
    ...(dsr ? dsr.news.map((n) => n.date) : []),
    ...(dsr && dsr.domain ? dsr.domain.domainMoves.map((m) => m.date) : [])
  ].filter(Boolean).map((d) => {
    const t = Date.parse(d);
    return Number.isNaN(t) ? String(d) : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  });

  // Everything the research genuinely returned. A figure not traceable to this
  // corpus was invented by the model.
  // NUMERIC corpus: only text that makes verifiable factual claims. The raw
  // site blob was previously included, and its stray digits (street numbers,
  // copyright years, product codes) made almost any two-digit figure look
  // supported. "$1.2 billion", "15%" and "25%" all shipped that way.
  const numericCorpus = [
    (news && news.newsSummary) || "",
    ...(events || []).map((e) => `${e.what || ""} ${e.angle || ""} ${e.affects || ""}`),
    insight ? `${insight.finding} ${insight.implication || ""} ${insight.withheld || ""}` : "",
    dossierFacts
  ].filter(Boolean).join(" \n ");

  // NAME corpus: wider, since naming a real segment or rival from the site is
  // legitimate even though quoting a number off it is not.
  const sourceCorpus = [
    numericCorpus,
    (companyIntel && companyIntel.description) || "",
    thesis ? [thesis.whatTheyAre, ...(thesis.segments || []), ...(thesis.rivals || [])].join(" ") : ""
  ].filter(Boolean).join(" \n ");

  const outsideNames = [
    // Dossier competitors come first: they were verified against a live page,
    // where thesis rivals are recalled from training and can be defunct.
    ...(dsr && dsr.domain ? dsr.domain.competitors.map((c) => c.name) : []),
    ...(thesis && thesis.rivals ? thesis.rivals : []),
    ...(lead.__profile && lead.__profile.rivals ? lead.__profile.rivals : []),
    ...(events || []).flatMap((e) => (`${e.what || ""}`.match(/\b[A-Z][a-zA-Z&.]{2,}(?:\s[A-Z][a-zA-Z&.]{2,})?/g) || []))
  ].filter(Boolean);
  const subjectShape = chooseSubjectShape(lead);
  const openingForm = chooseOpeningForm(lead);
  const closing = chooseClosing(lead);
  const leadIn = chooseLeadIn(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events, null, insight, buyerWorld, thesis, angle, subjectShape, closing, leadIn, openingForm, dossier);
  let basePrompt = stepPrompt(step, lead, ctx);
  if (usedCTAs.length) {
    basePrompt += `\n\nClosing lines already used in earlier emails to this person (your closing line must be clearly different from all of these): ${usedCTAs.map((s) => `"${s}"`).join(", ")}`;
  }
  if (earlierBodies.length) {
    // Showing the model the actual earlier emails is far more effective than
    // telling it to "be different". It cannot avoid repeating what it has not
    // been shown, and it writes each step in a separate call.
    basePrompt += `\n\nEMAILS ALREADY SENT TO THIS PERSON, in order. Your email must make a DIFFERENT point. Do not restate these, do not re-explain the same event, do not reuse their phrasing:\n` +
      earlierBodies.map((b, i) => `--- EMAIL ${i + 1} ---\n${b}`).join("\n\n");
  }
  const comp = shortCompany(lead.companyName);
  const first = (lead.firstName || "there").toString().trim();

  // Real nouns and numbers pulled from the actual research, used to check that
  // bullets are grounded in the material rather than invented categories.
  const prof = lead.__profile || null;
  const anchorTokens = [
    ...(events || []).flatMap((e) => `${e.what || ""} ${e.angle || ""} ${e.affects || ""}`.match(/\b[A-Z][a-zA-Z]{3,}\b|\b\d[\d,.%$]*\b/g) || []),
    ...(insight ? `${insight.finding} ${insight.withheld || ""}`.match(/\b[A-Z][a-zA-Z]{3,}\b|\b\d[\d,.%$]*\b/g) || [] : []),
    // The domain profile is the richest source of prospect-specific nouns:
    // their real segments and real rivals are precisely what a bullet must
    // name to stop being interchangeable.
    ...(prof ? prof.segments : []),
    ...(prof ? prof.rivals : []),
    // Proper nouns and figures out of the verified dossier. A bullet naming
    // one of these is grounded by definition.
    ...(dossierFacts.match(/\b[A-Z][a-zA-Z]{3,}\b|\b\d[\d,.%$]*\b/g) || [])
  ].filter(Boolean).slice(0, 80);

  // Retries carry explicit feedback: the model is told exactly WHY the last
  // attempt was rejected. Blind retries were shipping banned words after 3
  // tries (e.g. a "navigating ..." subject); telling it the reason fixes most
  // rejections on the second attempt.
  let feedback = "";
  let last = null;

  // RETRY BUDGET. Four steps at three attempts each, plus repair passes, is up
  // to twenty sequential model calls for one row. That is what pushed a row
  // past the function ceiling and made the client receive an HTML error page
  // instead of JSON.
  //
  // Email 1 gets the full three: it carries the subject and is the only touch
  // most prospects will ever see. Later steps get two. And if the row is
  // already close to its deadline, everything drops to one attempt so the row
  // finishes and writes a Status rather than dying mid-flight and leaving the
  // sheet blank.
  const timeLeft = deadline ? deadline - Date.now() : Infinity;
  const pressed = timeLeft < 45000;
  const maxAttempts = pressed ? 1 : (step === 1 ? 3 : 2);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Never start another round trip with no time to finish it.
    if (deadline && Date.now() > deadline - 12000) break;
    try {
      const out = await chatJSON(SYSTEM_PROMPT, basePrompt + feedback);
      const rawBody = usableBody(out.body);
      if (!rawBody) continue;                       // "0", null, a fragment
      if (wantsSubject && typeof out.subject !== "string") continue;
      out.subject = wantsSubject ? cleanDashes(out.subject).replace(/\s+/g, " ").trim() : "";
      out.body = fixLinkPlacement(normalizeProse(ensureGreeting(cleanDashes(stripSignature(rawBody)), first)), step);

      const reasons = [];
      const fatal = fatalHits(out.body + " " + out.subject);
      if (fatal.length) reasons.push(`it used phrases that cannot ship: ${fatal.map((p) => `"${p}"`).join(", ")}`);
      const soft = softHits(out.body + " " + out.subject);
      if (soft.length) reasons.push(`it used weak phrasing: ${soft.map((p) => `"${p}"`).join(", ")}. Replace each with the specific consequence rather than a hedge`);
      const staleIssue = staleDateProblem(out.body);
      if (staleIssue) reasons.push(staleIssue);
      const fabIssue = fabricationProblem(out.body, numericCorpus);
      if (fabIssue) reasons.push(fabIssue);
      // Names, not just numbers. "Brightline Energy" and "GreenTech
      // Innovations" were invented wholesale and nothing checked them.
      const entIssue = inventedEntityProblem(out.body, sourceCorpus, lead);
      if (entIssue) reasons.push(entIssue);
      const paraIssue = paragraphProblem(out.body, step);
      if (paraIssue) reasons.push(paraIssue);
      const patternProblems = bannedPatternHits(out.body);
      if (patternProblems.length) reasons.push(`it used a banned construction, ${patternProblems.join("; ")}. Write the introduction to Kings Research in your own words, tied to this specific situation`);
      const patterned = bannedPatternHits(out.body);
      if (patterned.length) reasons.push(patterned[0]);
      const lenIssue = lengthProblem(out.body, step);
      if (lenIssue) reasons.push(lenIssue);
      const pitchIssue = pitchProblem(out.body, step);
      if (pitchIssue) reasons.push(pitchIssue);
      const negIssue = negativityProblem(out.body + " " + (out.subject || ""));
      if (negIssue) reasons.push(negIssue);
      const mirrorIssue = mirrorProblem(out.body, companyIntel && companyIntel.siteText);
      if (mirrorIssue) reasons.push(mirrorIssue);
      const repeatIssue = repetitionProblem(out.body, earlierBodies);
      if (repeatIssue) reasons.push(repeatIssue);
      const bulletIssue = bulletProblem(out.body, step, anchorTokens);
      if (bulletIssue) reasons.push(bulletIssue);
      if (step === 1) {
        const openIssue = openingProblem(out.body, lead.companyName, outsideNames, openingForm);
        if (openIssue) reasons.push(openIssue);
      }
      const linkIssue = linkProblem(out.body, step);
      if (linkIssue) reasons.push(linkIssue);
      const presumeIssue = presumptionProblem(out.body);
      if (presumeIssue) reasons.push(presumeIssue);
      const dateIssue = dateProblem(out.body, allowedDates);
      if (dateIssue) reasons.push(dateIssue);
      if (wantsSubject) {
        const subjIssue = subjectProblem(out.subject, comp, lead.title);
        if (subjIssue) reasons.push(`the subject had a problem: ${subjIssue}`);
        const subjGeneric = subjectGeneric(out.subject);
        if (subjGeneric) reasons.push(`the subject was generic: ${subjGeneric}`);
        const magnet = subjectMagnet(out.subject, lead.companyName, outsideNames);
        if (magnet) reasons.push(magnet);
      }
      const cta = ctaLine(out.body);
      if (cta && usedCTAs.some((c) => c === cta)) {
        reasons.push(`the closing line was identical to an earlier email's, write a clearly different closer`);
      }

      if (!reasons.length) return out;
      last = out;
      feedback = `\n\nYour previous attempt was REJECTED because ${reasons.join("; ")}. Fix exactly these issues and return the corrected JSON.`;
    } catch { /* retry */ }
  }

  // ── FALLBACK ────────────────────────────────────────────────────────────
  // The old behaviour shipped `last` unchanged after 3 failed attempts, which
  // is why banned phrases ("navigating", "many firms are") kept appearing in
  // sent copy: the body guard was advisory only. Now the body gets one
  // targeted repair pass, and if it STILL fails it is returned flagged so the
  // caller holds the row instead of marking it Ready. A held row costs
  // nothing. A shipped row that reads as AI costs the domain.
  if (last) {
    // Only these can hold a row. Soft phrasing gets one repair attempt and
    // then ships: an imperfect email that sends beats a perfect one that never
    // does, and a status column that always says "needs review" gets ignored.
    const bodyIssues = () => [
      fatalHits(last.body).length ? `it still contains phrases that cannot ship: ${fatalHits(last.body).map((p) => `"${p}"`).join(", ")}` : null,
      staleDateProblem(last.body),
      fabricationProblem(last.body, numericCorpus),
      inventedEntityProblem(last.body, sourceCorpus, lead),
      paragraphProblem(last.body, step),
      bannedPatternHits(last.body).length ? `it still contains ${bannedPatternHits(last.body)[0]}` : null,
      bannedPatternHits(last.body)[0] || null,
      lengthProblem(last.body, step),
      pitchProblem(last.body, step),
      negativityProblem(last.body),
      mirrorProblem(last.body, companyIntel && companyIntel.siteText),
      repetitionProblem(last.body, earlierBodies),
      bulletProblem(last.body, step, anchorTokens),
      step === 1 ? openingProblem(last.body, lead.companyName, outsideNames, openingForm) : null,
      linkProblem(last.body, step),
      presumptionProblem(last.body),
      dateProblem(last.body, allowedDates)
    ].filter(Boolean);

    let issues = bodyIssues();

    // SURGICAL PASS FIRST. Banned phrases were surviving three attempts plus a
    // general repair, because the general repair is handed a list of abstract
    // complaints and rewrites broadly. This one does a single job and names
    // the exact strings, which fixes it on the first try in most cases.
    const stuck = bannedHits(last.body);
    if (stuck.length && (!deadline || Date.now() < deadline - 15000)) {
      try {
        const fix = await chatJSON(
          SYSTEM_PROMPT,
          `Rewrite the email body below, removing these exact phrases: ${stuck.map((x) => `"${x}"`).join(", ")}.\n` +
          `They are banned because they appeared verbatim in every email we sent, which is what made a whole campaign read as machine-generated.\n` +
          `Replace each with a fresh phrasing of the SAME IDEA in your own words. Do not delete the idea, do not shorten the email, do not add anything new, keep every fact, number, name and the greeting exactly as they are.\n` +
          `Return ONLY {"body":"..."}.\n\nBODY:\n${last.body}`
        );
        if (fix.body) {
          const cleaned = fixLinkPlacement(normalizeProse(ensureGreeting(cleanDashes(stripSignature(fix.body)), first)), step);
          if (usableBody(cleaned) && bannedHits(cleaned).length < stuck.length) {
            last = { ...last, body: cleaned };
            issues = bodyIssues();
          }
        }
      } catch { /* fall through to the general repair */ }
    }

    if (issues.length && (!deadline || Date.now() < deadline - 15000)) {
      try {
        const fix = await chatJSON(
          SYSTEM_PROMPT,
          `Fix the email body below. Problems: ${issues.join("; ")}.\n` +
          `HOW TO FIX A HEDGE: a phrase like "could impact", "may influence" or "raises questions" means the sentence asserts nothing. Do not delete the words and leave the sentence limp. REPLACE the whole sentence with a concrete claim drawn from the material: name what changes, for whom, and by roughly how much, or name what you do not yet know and would need to check. If the material genuinely will not support a concrete claim, DELETE the sentence entirely and let the email be shorter.\n` +
          `Change NOTHING else: keep the same facts, the same numbers, the same greeting, the same ask. Do not add new claims or invented statistics. Do not soften the opening into a compliment.\n` +
          `Hard word limit: ${WORD_CAP[step] || 100} words.\n` +
          `Return ONLY {"body":"..."}.\n\nBODY:\n${last.body}`
        );
        if (fix.body) {
          const repaired = fixLinkPlacement(normalizeProse(ensureGreeting(cleanDashes(stripSignature(fix.body)), first)), step);
          const before = issues.length + softHits(last.body).length;
          const candidate = { ...last, body: repaired };
          const after = [
            bannedHits(repaired).length ? `banned phrase(s): ${bannedHits(repaired).join(", ")}` : null,
            bannedPatternHits(repaired).length ? bannedPatternHits(repaired)[0] : null,
            bannedPatternHits(repaired)[0] || null,
            lengthProblem(repaired, step),
            pitchProblem(repaired, step),
            mirrorProblem(repaired, companyIntel && companyIntel.siteText),
            fabricationProblem(repaired, numericCorpus),
            inventedEntityProblem(repaired, sourceCorpus, lead),
            paragraphProblem(repaired, step),
            linkProblem(repaired, step)
          ].filter(Boolean);
          const afterTotal = after.length + softHits(repaired).length;
          if (afterTotal < before) { last = candidate; issues = after.filter(Boolean); }
        }
      } catch { /* keep last.body */ }
    }

    if (wantsSubject) {
      const stillBad = subjectMagnet(last.subject, lead.companyName, outsideNames) || subjectGeneric(last.subject) || subjectProblem(last.subject, comp, lead.title);
      if (stillBad && (!deadline || Date.now() < deadline - 10000)) {
        try {
          const fix = await chatJSON(
            SYSTEM_PROMPT,
            `The email body below is final. Write ONLY a new subject line for it: 3 to 7 words naming the FINDING, the competitor move, or the specific mechanism in the body, not the company's category. Conversational, sentence case, none of the banned subject words, never we/our/us. The previous subject "${last.subject}" was rejected because: ${stillBad}. Return ONLY {"subject":"..."}.\n\nBODY:\n${last.body}`
          );
          if (fix.subject) {
            const s = cleanDashes(fix.subject).replace(/\s+/g, " ").trim();
            if (!subjectMagnet(s, lead.companyName, outsideNames) && !subjectGeneric(s) && !subjectProblem(s, comp, lead.title)) last.subject = s;
          }
        } catch { /* keep last.subject */ }
      }
      if (subjectProblem(last.subject, comp, lead.title)) last.subject = fixSubjectVoice(last.subject);
    } else {
      last.subject = "";
    }

    // `quality` is what the route uses to decide Ready vs Needs review.
    if (!usableBody(last.body)) {
      return { subject: "", body: "GENERATION_FAILED", quality: "model returned an unusable body" };
    }
    // Name the real problem. "unfixable: banned" told the operator nothing
    // about which phrase or how to fix the prompt.
    const stillBanned = bannedHits(last.body);
    const detail = stillBanned.length
      ? `stock phrase "${stillBanned[0]}"`
      : String(issues[0] || "").replace(/\s+/g, " ").slice(0, 150);
    return { ...last, quality: issues.length ? `unfixable: ${detail}` : "ok" };
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED", quality: "generation failed" };
}
