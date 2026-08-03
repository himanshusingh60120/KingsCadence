import { chatJSON } from "./ai";
import { insightBlock } from "./insights";

// Kept short and focused on genuinely spammy / identity-breaking phrasing.
// (The advisory tone itself is enforced positively in the system prompt.)
export const BANNED_PHRASES = [
  "i hope this email finds you well", "touching base", "reaching out to you today",
  "i noticed that as", "i've noticed that as",
  "we provide insights", "make better decisions", "help you make better decisions",
  "protect and expand their market share", "protect and expand its market share",
  // Overused AI filler that made every email read the same. Hard-banned so the
  // model is forced to say something specific instead. (Broader, softer avoid-
  // list lives in the system prompt; these are the worst repeat offenders.)
  "growth pockets", "clarify their priorities", "sharpen their positioning",
  "sharpen their competitive positioning", "sharpen their market positioning",
  "challenges and opportunities", "evolving landscape", "rapidly evolving",
  "over the next 12 to 24 months", "strategic bets", "leaders like you",
  "in this dynamic", "increasingly pertinent",
  // Second pass: platitudes that still slipped through on no-event prospects.
  "grappling with", "evolving", "navigate", "navigating", "robust financial",
  "next area of growth", "what rivals",
  // Strategy change: no meeting-ask, no templated give-nothing closers.
  "20-minute", "20 minute", "20 minutes", "20 min", "twenty-minute", "twenty minute",
  "compare notes on this ahead of your", "would you be open to a brief",
  "from my work across your sector", "from our work across your sector",
  "observations from my work across", "observations from our work across",
  "share some insights from our work",
  // Flattery filler: empty compliments a senior reader registers as padding.
  "positions you well", "well-positioned", "well positioned", "poised to",
  "capitalize on", "market positioning",
  // Third pass (from the 16 Jul run): prompt-only bans that kept slipping into
  // shipped bodies because they were never code-enforced. "resonate" catches
  // "resonates"/"resonated" (substring match); the "many firms/companies are"
  // shapes are the invented-trend tell on no-signal rows.
  "resonate", "many firms are", "many companies are", "companies in your space are",
  "capture a larger share", "i've observed that", "i have observed that",
  // REPORT-VENDOR TELLS. The pivot from report vendor to advisory firm dies the
  // moment one of these appears: the reader instantly re-files the email under
  // "syndicated research spam", which is the exact bucket the old campaign sat
  // in. Prompt-level bans were being ignored on ~1 in 12 rows, so they are now
  // code-enforced and force a regeneration.
  "cagr", "market size", "market value", "forecast period", "market forecast",
  "is expected to reach", "is projected to reach", "projected to grow",
  "expected to grow at", "growing at a", "by 2030", "by 2031", "by 2032",
  "by 2033", "by 2034", "by 2035", "usd billion", "usd million",
  "syndicated", "our report", "this report", "the report covers",
  "sample copy", "table of contents", "market study", "research report",
  "segmentation analysis", "market overview", "key players", "vendor landscape"
];

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

export function bannedHits(text) {
  const t = (text || "").toLowerCase();
  return BANNED_PHRASES.filter((p) => t.includes(p));
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
export const WORD_CAP = { 1: 90, 2: 50, 3: 80, 4: 110 };

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
const PITCH_SHAPES = [
  [/\bwe can help\b/i, 'a "we can help ..." capability list'],
  [/\bhow we (can |could )?help\b/i, 'a "how we help" list'],
  [/\bour (services|offerings|capabilities|solutions)\b/i, "a services list"],
  [/\b(kings research|kings global) is a\b/i, "a positioning line explaining who Kings Research is (the signature covers it)"],
  [/\bwe (are|'re) a (market|strategic|leading)\b/i, "a positioning line about the sender"],
  [/\bwe (specialise|specialize|work with|partner with) \b/i, "a self-description"]
];

export function pitchProblem(body, step) {
  const b = String(body || "");
  for (const [re, label] of PITCH_SHAPES) {
    if (re.test(b)) return `it contains ${label}. Delete it entirely, the email must be a give and nothing else`;
  }
  // Bullet lists are allowed only in E4, where the give-away list IS the email.
  if (step !== 4) {
    const bullets = (b.match(/^\s*[-*•]\s+/gm) || []).length;
    if (bullets >= 2) return "it contains a bullet list. Only Email 4 may use a list. Rewrite as plain sentences";
  }
  return null;
}

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
export function reviewStatus(lead, events, insight = null) {
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

  if (!events || !events.length) {
    return { ready: false, skipGeneration: false, reason: "no give available (no finding matched, no event found)" };
  }

  // An event exists, but if it is only the prospect's OWN news the email can
  // do no better than tell them what they already know. Still sendable, but
  // flagged, because a matched finding would make it far stronger.
  const hasOutsideView = events.some((e) => e.subject === "competitor" || e.subject === "market");
  if (!hasOutsideView) {
    return { ready: false, skipGeneration: false, reason: "only the prospect's own news, no outside view" };
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
    if (e.subject === "competitor") return 0;
    if (e.subject === "market") return 1;
    return 2; // self
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
- NO CAPABILITY LIST, in any email. Never "We can help [Company] with:", never a bulleted list of services, never a line explaining who Kings Research is or what it does. The signature carries the identity. A capability list is the single clearest vendor tell there is: it converts a give into a pitch, and the reader stops reading at the colon. The ONLY permitted list in the whole cadence is Email 4's three-item give-away.
- WORD LIMITS ARE HARD: E1 90 words, E2 50, E3 80, E4 110. Including the greeting. If you are over, delete a whole sentence, do not compress words.

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

STYLE: warm but professional, appropriate for a senior executive. No em dashes or en dashes (use commas or "and"). Greet with "Dear [First]," then a blank line. Put \\n\\n between paragraphs.

Return ONLY valid JSON: {"subject": "...", "body": "..."}. No markdown.`;

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events, reportHook = null, insight = null) {
  const comp = shortCompany(lead.companyName);
  const L = [];
  L.push("═══ PROSPECT INTELLIGENCE (personalize from this; never paste verbatim) ═══");
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
    L.push("═══ REAL EVENT SIGNALS (screened as genuinely relevant to what THIS company does; open EMAIL 1 on the ONE most relevant, use its 'angle' as the strategic question) ═══");
    events.slice(0, 6).forEach((e, i) => {
      L.push(`${i + 1}. [${e.type} | ${e.scope || "industry"} | subject: ${e.subject || "self"}]${e.recency ? ` (${String(e.recency).slice(0, 16)})` : ""} ${e.what || e.headline || ""}`);
      if (e.angle) L.push(`   angle: ${e.angle}`);
    });
    L.push("If an event is about another organization, use its 'angle' to raise the question it creates for the prospect, never frame it as a deal the prospect is party to or can 'leverage'.");
    if (events.some((e) => e.subject === "competitor" || e.subject === "market")) {
      L.push(`PRIORITIZE the competitor/market events above: what another player or the market just did, and what it means for ${comp}'s share, pricing, or pipeline, is a stronger opener than ${comp}'s own news. The reader cannot see rivals from inside; that gap is the give.`);
    }
  } else {
    L.push("");
    L.push("═══ NO NEWS EVENT FOUND ═══");
    if (insight || lead.insight) {
      L.push(`There is no news hook, and none is needed: the FINDING above is the give. Open EMAIL 1 on it. Use the dossier only to make the implication specific to ${comp}, never as the opening.`);
    } else {
      L.push(`There is no news event AND no proprietary finding for this prospect. This row has NOTHING TO GIVE.`);
      L.push(`Do NOT manufacture one. Specifically: do NOT open by describing what ${comp} does, do NOT compliment their experience or positioning, do NOT invent an industry trend, and do NOT write "many firms are..." or "the sector is evolving". Describing their own business back to them is a MIRROR, not a give: they wrote that copy, and a senior reader deletes it on sight.`);
      L.push(`Write the shortest honest email you can: one concrete, TRUE observation about their segment drawn from the dossier, and an honest offer to send Kings Research's read on it. Under 60 words. This row will be held for human review anyway, so do not pad it to look finished.`);
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
HARD LIMIT: 90 words total, including the greeting. Shorter is better. A senior reader sees roughly the first 90 characters on a phone, so the FIRST SENTENCE must carry the give.
- "Dear ${first}," then a blank line.
- OPEN ON THE GIVE. Sentence one states the finding, the competitor move, or the market shift, with its number or specific mechanism intact. No preamble, no "I was looking at", no "I noticed", no compliment, no description of what their company does.
- ONE line on what it means for them: a cost, a risk, a shift in their customers, something about to land on their desk. Concrete, not "this is significant".
- CTA: offer the WITHHELD detail by name, in a short line. "I have the breakdown by X. Want it?" or "Reply and I will send the segment split." NEVER a meeting.
- NO list, NO bullets, NO "we can help ${comp} with:", NO line explaining who Kings Research is. The signature carries that. A capability list turns a give into a pitch and is the single clearest vendor tell.
SUBJECT: 3 to 7 words. Name the FINDING or the MOVE, not the company's category. e.g. "FISP cycle 10 filings", "Datadog's consumption pricing", "38% conversion in cycle 10". Lowercase sentence case, like a colleague typed it. No banned subject words.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (thread reply, no subject) to ${first} at ${comp}.
HARD LIMIT: 50 words. This is the shortest email in the sequence.
- "Dear ${first}," then a blank line.
- A SECOND, DIFFERENT give. NOT a restatement of E1, NOT "just floating this to the top", NOT "following up", NOT "circling back". A bump that gives nothing spends a touch and earns nothing. Use a second finding or a second angle from the context. If the context genuinely holds one give only, take a NARROWER cut of it (a sub-segment, a second-order effect) rather than repeating it.
- CTA: one short line, a DIFFERENT ask from E1. No meeting.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (thread reply, no subject) to ${first} at ${comp}. This is where Kings Research's actual work earns the reply.
HARD LIMIT: 80 words.
- "Dear ${first}," then a blank line.
- Name ONE specific SEGMENT or APPLICATION ${comp} actually serves, taken from the dossier or the event. Be precise: a product line, a customer type, a coverage class, a geography, a named use case.
- Give Kings Research's read on THAT segment: what is moving, who is moving into it, where the opening or the squeeze is. A substantive observation, never a question and never a description of their own business read back to them.
- ABSOLUTELY NO market size, CAGR, forecast, or "by 2030" figure. That one move re-files you as a report vendor and the thread is over.
- CTA: offer the named read for that segment. Closing line different from E1 and E2.${common}`;

  return `${ctx}

Write EMAIL 4 (thread reply, no subject) to ${first} at ${comp}. This is the LAST touch and it should be the HIGHEST-REPLY email in the sequence, because it asks for nothing.
HARD LIMIT: 110 words.
- "Dear ${first}," then a blank line.
- Open by releasing them: make clear you are not chasing a reply. One short warm line. No resentment, no guilt, no "I'll assume you're not interested", no "last try".
- Then GIVE IT ALL AWAY: exactly 3 numbered items, one line each, each a concrete thing Kings Research is watching in their space right now. Draw them from the finding, the events and the dossier. Every item must be checkable and specific: a number, a named move, a named mechanism. No advice, no "consider whether you...", no generic observations.
- Close with an open door and NO ASK: no CTA, no offer to send anything, no question mark. Something in the shape of "If any of that is worth a longer conversation, you know where I am." The absence of an ask is the entire point of this email. Do not put one back in.${common}`;
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

export async function generateEmail(step, lead, companyIntel, news, events = [], usedSubjects = [], usedCTAs = [], insight = null) {
  const wantsSubject = step === 1; // E2-E4 are thread replies, no subject
  const [pKey, pDesc] = resolvePersona(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events, null, insight);
  let basePrompt = stepPrompt(step, lead, ctx);
  if (usedCTAs.length) {
    basePrompt += `\n\nClosing lines already used in earlier emails to this person (your closing line must be clearly different from all of these): ${usedCTAs.map((s) => `"${s}"`).join(", ")}`;
  }
  const comp = shortCompany(lead.companyName);
  const first = (lead.firstName || "there").toString().trim();

  // Retries carry explicit feedback: the model is told exactly WHY the last
  // attempt was rejected. Blind retries were shipping banned words after 3
  // tries (e.g. a "navigating ..." subject); telling it the reason fixes most
  // rejections on the second attempt.
  let feedback = "";
  let last = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await chatJSON(SYSTEM_PROMPT, basePrompt + feedback);
      if (!out.body) continue;
      if (wantsSubject && !out.subject) continue;
      out.subject = wantsSubject ? cleanDashes(out.subject).replace(/\s+/g, " ").trim() : "";
      out.body = ensureGreeting(cleanDashes(stripSignature(out.body)), first);

      const reasons = [];
      const problems = bannedHits(out.body + " " + out.subject);
      if (problems.length) reasons.push(`it used banned phrase(s): ${problems.map((p) => `"${p}"`).join(", ")}`);
      const lenIssue = lengthProblem(out.body, step);
      if (lenIssue) reasons.push(lenIssue);
      const pitchIssue = pitchProblem(out.body, step);
      if (pitchIssue) reasons.push(pitchIssue);
      const mirrorIssue = mirrorProblem(out.body, companyIntel && companyIntel.siteText);
      if (mirrorIssue) reasons.push(mirrorIssue);
      if (wantsSubject) {
        const subjIssue = subjectProblem(out.subject, comp, lead.title);
        if (subjIssue) reasons.push(`the subject had a problem: ${subjIssue}`);
        const subjGeneric = subjectGeneric(out.subject);
        if (subjGeneric) reasons.push(`the subject was generic: ${subjGeneric}`);
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
    const bodyIssues = () => [
      bannedHits(last.body).length ? `it still contains banned phrase(s): ${bannedHits(last.body).map((p) => `"${p}"`).join(", ")}` : null,
      lengthProblem(last.body, step),
      pitchProblem(last.body, step),
      mirrorProblem(last.body, companyIntel && companyIntel.siteText)
    ].filter(Boolean);

    let issues = bodyIssues();
    if (issues.length) {
      try {
        const fix = await chatJSON(
          SYSTEM_PROMPT,
          `Rewrite the email body below so that it no longer has these problems: ${issues.join("; ")}.\n` +
          `Change NOTHING else: keep the same specific facts, the same numbers, the same greeting, the same ask. Do not add new claims, do not add statistics, do not soften the opening into a compliment.\n` +
          `Hard word limit: ${WORD_CAP[step] || 100} words.\n` +
          `Return ONLY {"body":"..."}.\n\nBODY:\n${last.body}`
        );
        if (fix.body) {
          const repaired = ensureGreeting(cleanDashes(stripSignature(fix.body)), first);
          const before = issues.length;
          const candidate = { ...last, body: repaired };
          const after = [
            bannedHits(repaired).length ? "banned" : null,
            lengthProblem(repaired, step),
            pitchProblem(repaired, step),
            mirrorProblem(repaired, companyIntel && companyIntel.siteText)
          ].filter(Boolean);
          if (after.length < before) { last = candidate; issues = after; }
        }
      } catch { /* keep last.body */ }
    }

    if (wantsSubject) {
      const stillBad = subjectGeneric(last.subject) || subjectProblem(last.subject, comp, lead.title);
      if (stillBad) {
        try {
          const fix = await chatJSON(
            SYSTEM_PROMPT,
            `The email body below is final. Write ONLY a new subject line for it: 3 to 7 words naming the FINDING, the competitor move, or the specific mechanism in the body, not the company's category. Conversational, sentence case, none of the banned subject words, never we/our/us. The previous subject "${last.subject}" was rejected because: ${stillBad}. Return ONLY {"subject":"..."}.\n\nBODY:\n${last.body}`
          );
          if (fix.subject) {
            const s = cleanDashes(fix.subject).replace(/\s+/g, " ").trim();
            if (!subjectGeneric(s) && !subjectProblem(s, comp, lead.title)) last.subject = s;
          }
        } catch { /* keep last.subject */ }
      }
      if (subjectProblem(last.subject, comp, lead.title)) last.subject = fixSubjectVoice(last.subject);
    } else {
      last.subject = "";
    }

    // `quality` is what the route uses to decide Ready vs Needs review.
    return { ...last, quality: issues.length ? `unfixable: ${issues[0]}`.slice(0, 160) : "ok" };
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED", quality: "generation failed" };
}
