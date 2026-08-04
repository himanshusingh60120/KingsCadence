import { chatJSON } from "./ai";
import { insightBlock } from "./insights";
import { thesisBlock, bulletMatchesThesis } from "./thesis";
import { chooseAngle, chooseClosing, chooseSubjectShape } from "./angles";

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
  "segmentation analysis", "market overview", "key players",
  // HEDGE VERBS. These are the tell of an email that has nothing to say. When
  // the model has no real give it reaches for "may influence", "could impact",
  // "raises questions about" and produces a sentence that asserts nothing:
  // "This launch may influence future product development and competition in
  // this segment." Ban the hedge and the model must either be concrete or
  // fail the guard, and a failed guard holds the row instead of sending mush.
  "may influence", "could influence", "may impact", "could impact",
  "may affect", "could affect", "raises questions", "raise questions",
  "could lead to", "may lead to", "could result in", "may result in",
  "could create", "may create", "could reshape", "may reshape",
  "could shift", "may shift", "signals a", "signalling a", "signaling a",
  "positions itself", "positioning itself", "could prompt", "may prompt",
  "potentially expanding", "potential impacts", "potential implications",
  "worth keeping an eye", "something to watch",
  // VAGUE OFFERS. The ask must name a thing. "I have the read on the
  // implications" is not a thing; "the breakdown by borough" is.
  "the read on the implications", "our analysis on this", "insights on how",
  "i can share insights", "if this angle is useful", "our detailed read on how",
  "the implications for", "our perspective on this",
  // Openers that waste the only two lines a phone shows.
  "i hope you're well", "i hope you are well", "hope you're doing well",
  "hope this finds you", "i won't take up your time", "no need to reply if",
  // SEEDED BOILERPLATE. Every one of these came from an EXAMPLE SENTENCE in
  // this file's own prompts, and the model reproduced them word for word on
  // every single row: an insurer, a radar firm and a drone operator were all
  // told "we track your sector pricing quarterly". A prompt example is a
  // template, not an illustration. Never write a quotable line in a prompt.
  "we track your sector pricing quarterly",
  "three things we can see that you probably cannot",
  "that you probably cannot from inside",
  "i'm not chasing a reply", "i am not chasing a reply",
  "not chasing a reply", "just sharing what we're tracking",
  "just sharing what we are tracking", "just sharing some insights",
  "just sharing insights", "i won't chase you", "i wont chase you",
  "no pressure at all", "i'm not expecting a reply", "i am not expecting a reply",
  "if any of that is worth a longer conversation",
  "you know where i am",
  "reply and i will send the account-movement breakdown",
  // FLATTERY-AS-ANALYSIS. Predicting the reader's success is pleasant,
  // unfalsifiable, and produces no reply because nothing is at stake. The
  // implication line has to carry a risk or an open question instead.
  "create an opening for", "creates an opening for", "an opportunity for you",
  "positioned to benefit", "positioned to capture", "well positioned to",
  "stands to gain", "could allow you to", "might allow you to",
  "strengthen your market position", "capture market share",
  "capture a larger", "this could be a win", "bodes well",
  "less competition", "diminishing options for customers"
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
export const WORD_CAP = { 1: 110, 2: 60, 3: 100, 4: 130 };

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
    if (bullets > 3) return `it has ${bullets} bullets. Email 1 allows 2 or 3`;
  } else if (step === 2) {
    if (listItems >= 2) return "it contains a list. Email 2 is a short reply and carries no list";
  } else if (step === 3) {
    if (bullets > 2) return `it has ${bullets} list items. Email 3 allows a maximum of 2, and only if both are concrete deliverables`;
  } else if (step === 4) {
    if (listItems > 3) return `it has ${listItems} list items. Email 4 is exactly 3`;
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
export function subjectMagnet(subject, prospectCompany = "", outsideNames = []) {
  const raw = String(subject || "").trim();
  if (!raw) return "the subject is empty";

  // Machine artefacts. People do not join two halves with a plus sign, and
  // every reader has learned the shape means advertising.
  if (/\s[+|/•·—–>]\s|\s(?:and|&)\s+your\b/i.test(raw)) {
    return `the subject uses a joiner ("${(raw.match(/\s[+|/•·—–>]\s|\s(?:and|&)\s+your\b/i) || [""])[0].trim()}") to bolt an outside thing onto their thing. That is a formula, and a reader spots it in half a second. Write one plain fragment instead`;
  }
  if (/[\[\]{}<>]|^\s*(re|fwd):/i.test(raw)) return "the subject uses brackets or a fake Re:/Fwd:. Both read as automated or dishonest";

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 7) return `the subject is ${words.length} words. The limit is 6, and 3 to 4 is better. A phone shows about 35 characters`;
  if (raw.length > 46) return `the subject is ${raw.length} characters and will be cut off on a phone. Get it under 40`;

  // Title Case is a headline, and headlines are marketing.
  const contentWords = words.filter((w) => w.length > 3 && /^[A-Za-z]/.test(w));
  const capped = contentWords.filter((w) => /^[A-Z]/.test(w));
  if (contentWords.length >= 3 && capped.length === contentWords.length) {
    return "the subject is in Title Case, which reads as a headline or a report title. Lowercase or sentence case only";
  }

  // Leading with a stranger's name: nothing in it belongs to the reader.
  const head = words.slice(0, 2).join(" ").toLowerCase();
  for (const n of outsideNames) {
    const first = String(n || "").trim().split(/\s+/)[0];
    if (first && first.length > 2 && head.startsWith(first.toLowerCase())) {
      return `the subject opens on "${first}", a company the reader does not work for. Nothing in it is theirs, so there is no reason to open it. Lead on their side of it`;
    }
  }

  const low = raw.toLowerCase();
  const DEAD = ["quick question", "touching base", "following up", "follow up", "reaching out",
    "opportunity", "opportunities", "insights", "insight", "partnership", "trends", "update",
    "thoughts", "checking in", "circling back", "introduction", "connect", "collaboration", "synergy"];
  const hit = DEAD.find((d) => low.includes(d));
  if (hit) return `the subject contains "${hit}", which is on every filter's and every reader's ignore list`;

  const own = String(prospectCompany || "").toLowerCase().trim();
  if (own && low.replace(/[^a-z0-9 ]/g, "").trim() === own.replace(/[^a-z0-9 ]/g, "").trim()) {
    return "the subject is just their company name, which says nothing";
  }

  // Concreteness, not capitalisation. The rule above REQUIRES lowercase, so
  // testing for a capital letter as proof of a proper noun contradicted it and
  // killed good lines like "orlando has a second bidder" and "seeker vs
  // perimeter tracks". What matters is whether the words point at anything;
  // reject only when every content word is abstract.
  const ABSTRACT = new Set(("market markets industry industries sector sectors business businesses strategy strategic " +
    "growth trends trend insight insights opportunity opportunities landscape dynamics developments " +
    "solutions services offerings capabilities positioning performance value impact change changes " +
    "future outlook overview analysis approach initiative initiatives innovation transformation " +
    "competitive competition ecosystem space area areas thing things stuff").split(/\s+/));
  const STOP = new Set("a an the and or but of in on at to for from with your our its is are was were now just new".split(" "));
  const content = low.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  const concrete = content.filter((w) => !ABSTRACT.has(w));
  if (content.length && !concrete.length) {
    return "every word in the subject is abstract. It points at nothing, so it reads as a label. Name a real thing: a place, a programme, a number, a document, a line item";
  }

  return null;
}

// ── OPENING GUARD ─────────────────────────────────────────────────────────
// Every email in the last run opened on someone else's transaction. The
// prompt asked for effect-first; the model kept reverting because the events
// it was handed are competitor events and the path of least resistance is to
// restate one. This makes it non-optional.
const SAFE_OPENERS = /^(your|yours|you|the |two |three |a |an |most |every|buyers|renewals|margins|bids|procurement|budgets|by |if |when |there |it |what|between|across|inside|nobody|no one|half|one of)/i;

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

export function linkProblem(body, step) {
  const b = String(body || "");
  const want = LINK_STEPS.includes(step);
  const count = (b.match(/kingsresearch\.com\/connect/gi) || []).length;
  if (want && count === 0) {
    return `the ${CONNECT_URL} link is missing. Weave it into a sentence, not as a footer`;
  }
  if (count > 1) return `the link appears ${count} times. Once only`;
  if (!want && count > 0) return "this email should carry no link";
  if (count === 1) {
    // A URL alone on its own line is a footer, which is what we are avoiding.
    const line = b.split("\n").find((l) => /kingsresearch\.com\/connect/i.test(l)) || "";
    const stripped = line.replace(/https?:\/\/\S+/g, "").replace(/[\s.,:;()\[\]-]/g, "");
    if (stripped.length < 12) {
      return "the link sits on its own line like a footer. Put it inside a sentence so it reads as part of the thought";
    }
  }
  return null;
}

export function openingProblem(body, prospectCompany = "", outsideNames = []) {
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
  if (!SAFE_OPENERS.test(sentence)) {
    const w = sentence.split(/\s+/)[0];
    if (/^[A-Z][a-z]{2,}/.test(w)) {
      return `the first sentence starts with "${w}", which reads as a headline about someone else. Start on the reader's situation instead`;
    }
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

export function normalizeProse(text) {
  let t = String(text || "");

  // PROTECT URLS AND EMAILS FIRST. The space-after-punctuation rule below
  // treated the dots in "https://www.kingsresearch.com/connect" as sentence
  // ends and produced "https://www. Kingsresearch. Com/connect", a dead link
  // in every email that carried one. Masked here, restored at the end.
  const vault = [];
  t = t.replace(/(https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+|[\w.+-]+@[\w-]+\.[\w.-]+)/gi, (m0) => {
    vault.push(m0);
    return `\u0000LINK${vault.length - 1}\u0000`;
  });

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
  t = t.replace(/\u0000LINK(\d+)\u0000/g, (m0, i) => vault[Number(i)] || "");
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
export const LINK_STEPS = [1, 3, 4];

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
THE EMAIL 1 SHAPE (this exact shape, it is what earns the reply):
  1. The give: the market event and what it is, in one or two sentences, with its specifics intact.
  2. The consequence FOR THEM: one line naming what actually changes. A price, a renewal, a buyer's budget, a competitive threat. Not "this is significant", not "this may influence".
  3. "We can help ${'${comp}'} with:" and THREE bullets, each naming one of their real segments, buyers, rivals or the event itself.
  4. One line offering a specific named thing, and a reply ask.

ESTABLISHING WHO YOU ARE (a stranger's insight is worthless without provenance):
- The reader does need to know why you, of all people, are telling them this. But there is a right way and a wrong way, and the difference decides whether they reply.
- WRONG, a MENU: "Kings Research is a market-intelligence and advisory firm that works across your sector. We can help [Company] with: - Analyzing how X positions you against competitors - Mapping competitor moves - Understanding customer shifts". Generic service categories, interchangeable between every prospect in the sector. The reader stops at the colon.
- RIGHT, a PROVENANCE LINE: ONE sentence saying HOW YOU KNOW the thing you just told them. "We track the UTM vendor landscape quarterly, which is where that number comes from." "We have been mapping facade filings across the five boroughs since cycle 8." This does everything the menu was trying to do in a fifth of the words, and it proves an ongoing data capability instead of claiming a service.
- PLACEMENT: the provenance line goes AFTER the give, never before it. Opening with who you are wastes the two lines a phone shows. Email 1 gets exactly one such line. Email 3 may go further (see its instructions). Emails 2 and 4 get none, they are replies on a thread where you have already introduced yourself.
- Never a bulleted list of services in ANY email. The only lists permitted in the whole cadence are Email 3's two concrete deliverables and Email 4's three-item give-away.
- WORD LIMITS ARE HARD: E1 110 words, E2 60, E3 100, E4 130. Including the greeting. If you are over, delete a whole sentence, do not compress words.

CERTAIN ABOUT FACTS, HUMBLE ABOUT THEIR BUSINESS (this is the whole difference between a consultant and a cold caller):
- "Your next conversations with military buyers will face increased competition. This shift will alter your pricing strategies and affect buyer preferences." Read that as the person receiving it. A stranger has just told a twenty-year industry veteran what their own conversations will be like and what their pricing will do. It is presumptuous, and the reader's first reaction is not interest, it is irritation.
- The rule: BE DEFINITE ABOUT WHAT HAPPENED OUTSIDE THEIR COMPANY. Be MODEST ABOUT WHAT IT MEANS INSIDE IT.
    Outside, state it flatly, with a date: what was announced, by whom, when, with the number. No hedging on verifiable facts, hedging there just reads as unsure.
    Inside, you do not know their book, their pipeline, or their roadmap. They do. Offer the implication as a read they can accept or reject, or as the question it raises. Attach it to a CONDITION so they can test it against what they know.
- NEVER write a sentence of the form "your X will Y". No "your conversations will face", "this will alter your pricing", "this will affect your buyers", "you will need to". Predicting their future is the intimidating move and it is always wrong, because you cannot know.
- The mature version of the same content: state the outside fact with its date, then name the specific condition under which it matters to them, then let them judge. Something along the lines of naming what changed, then "whether that reaches your bids depends on whether buyers are already asking for X, which you would see before we would."
- This is not hedging. Hedging is being vague about facts. This is being precise about facts and honest about the limits of what an outsider can know. The first is weak, the second is what earns a reply from a senior person.

NEVER TELL THEM GOOD NEWS ABOUT THEMSELVES:
- "AirMap shutting down will create an opening for DroneUp to capture market share" is not analysis, it is flattery wearing analysis as a costume. It tells the reader something pleasant and unfalsifiable, they feel briefly good, and they do not reply, because nothing was at stake.
- The IMPLICATION line must carry a RISK, an UNCERTAINTY, or a QUESTION THEY HAVE NOT ASKED. Not a predicted win. What could go wrong, what might not transfer, what a rival gets that they do not, what assumption in their plan just stopped holding.
- Strong version of the same fact: "AirMap's users do not automatically become yours. In the two prior exits we tracked, most displaced accounts went to the incumbent's partner network rather than the nearest competitor." That is uncomfortable, specific, checkable, and it is why someone replies.
- If you cannot find the uncomfortable angle, the email has no reason to exist. Write it short and let the guard hold it.

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

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events, reportHook = null, insight = null, buyerWorld = "", thesis = null, angle = null, subjectShape = "", closing = "") {
  const comp = shortCompany(lead.companyName);
  const L = [];
  if (angle) {
    L.push("═══ YOUR ENTRY ANGLE FOR THIS PROSPECT (not negotiable) ═══");
    L.push(`ANGLE: ${angle.name}`);
    L.push(angle.open);
    L.push(`SUBJECT SHAPE for Email 1: ${subjectShape}`);
    L.push(`CLOSING MOVE for Email 4: ${closing}`);
    L.push("These are assigned per prospect so that no two people on this list receive the same-shaped email. Twenty emails built from one template read as bulk mail, whatever the words are. Follow the angle even when a different opening feels more natural.");
    L.push("");
  }
  if (thesis) { L.push(thesisBlock(thesis)); L.push(""); }
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
HARD LIMIT: 110 words total, including the greeting. Shorter is better. A senior reader sees roughly the first 90 characters on a phone, so the FIRST SENTENCE must carry the give.
- "Dear ${first}," then a blank line.
- EFFECT FIRST, CAUSE SECOND. THIS IS THE MOST IMPORTANT RULE IN THIS PROMPT.
  The first sentence describes SOMETHING CHANGING IN THE READER'S OWN WORLD, in their vocabulary, about their work. The cause comes SECOND, in the next sentence, as the explanation.
  WRONG, and it is what every previous email did: "Procore's $845M acquisition of DroneDeploy will shift your customer landscape." That opens on a stranger's transaction. The reader's eye has to travel through someone else's news before reaching anything of theirs, and on a phone that is the entire preview.
  RIGHT: "Your next few renewal conversations in UAS compliance are going to run into a bundled competitor that was not there last quarter. Procore bought DroneDeploy for $845M three weeks ago and is folding it into a platform your buyers already licence."
  Same facts. The reader now appears in sentence one and the outside company appears in sentence two, where it belongs, as the reason.
- ABSOLUTE: THE FIRST SENTENCE MUST NOT BEGIN WITH THE NAME OF ANY COMPANY THAT IS NOT THE READER'S OWN, AND MUST NOT BEGIN WITH "The Pentagon", "The FAA", or any other outside body. Begin with "Your", "The renewals", "Two of the", "Buyers in", "The qualification window", or whatever names the reader's situation. If your draft opens on an outside name, you have written it backwards, rewrite it.
- Follow the ENTRY ANGLE assigned in the angle block above. It tells you WHICH part of their world to open on.
- The opening must carry SUBSTANCE, not a headline restated. A fact plus a guess about its effect is not substance. Test it: does the first half tell the reader something about how their own world works that they had not connected? If it only says a thing happened and asserts it is bad for them, they have read forty of those this month.
- THE FACT MUST BE CHECKABLE. Name WHEN (a month, a quarter, "three weeks ago") and, where the material gives it, the number, the counterparty, or the programme. A fact a reader can verify in thirty seconds is what makes the rest of the email trustworthy; an undated claim is indistinguishable from a guess and is treated as one. Never invent a date or a figure: if the material above does not carry one, say what it does carry and no more.
- THEN one line making it concrete on their side: a cost, a bid, a renewal, a qualification, a budget cycle, a named segment. Never "this will impact your market share", which asserts nothing.
- THEN 2 or 3 BULLETS, each on its own line starting with "- ". These are the reason the email works, so get them right.
  WHAT THEY ARE: specific QUESTIONS THIS PERSON CANNOT ANSWER FROM THE INSIDE, which you are implying you already can. Each bullet names a real entity, a number, a named segment, or a named mechanism from the material above.
  GOOD, because each one implies you already hold the answer:
    - which three underwriters have already repriced hull cover for US-built airframes
    - where the displaced AirMap accounts actually went in the two prior UTM exits
    - what Wing's Florida launch does to your per-drop economics in that corridor
  BAD, because they are service categories that would fit any company in any sector:
    - Insights on how competitors are adjusting their pricing in response to market shifts
    - Analysis of emerging technologies and their impact
    - Evaluation of market share trends among key players
  TEST EACH BULLET: could it be sent, word for word, to a company in a different industry? If yes, it is worthless, rewrite it with a name, a number, or a named segment in it.
  NEVER start a bullet with "Analysis of", "Insights on", "Evaluation of", "Assessment of", "Understanding", "Mapping", or "A review of".
- ONE SHORT LEAD-IN before the bullets, naming what you track, so the bullets have provenance: "We track ${sector} pricing quarterly. Three things we can see that you probably cannot from inside:" Do NOT write "Kings Research is a market-intelligence and advisory firm" or "We can help ${comp} with". Say what you TRACK, not what you ARE.
- CTA: offer the specific named thing, in a short line. "Reply and I will send the account-movement breakdown from both exits." NEVER a meeting, never "20 minutes".
SUBJECT: it has ONE job, which is to make the first line worth reading. Not to sell, not to summarise, not to qualify.
- 2 to 6 WORDS, UNDER 40 CHARACTERS. A phone shows about 35. Three words beats seven almost every time, and the instinct to add context is what ruins subject lines.
- ALL LOWERCASE, or sentence case at most. Never Title Case: Title Case is a headline, and headlines are marketing.
- IT SHOULD LOOK LIKE INTERNAL MAIL. The strongest cold subjects are indistinguishable from a note a colleague typed in four seconds, because internal mail is the only category of email that is never a pitch. Shorthand, not summary.
- NO JOINERS. No "+", no "|", no arrow, no brackets, no bolting an outside thing onto their thing. That construction is a machine artefact, people do not write plus signs in subject lines, and every reader has learned the shape means advertising.
- DO NOT FOLLOW A FORMULA. If someone could describe the pattern of your subject after seeing three of them, so can the reader, and they will stop opening.
- DO NOT SUMMARISE THE EMAIL. If the subject already says what it is about, opening has no payoff. Leave it unfinished.
- DO NOT LEAD ON A COMPETITOR'S NAME, and do not make it about the prospect's own product, which they already know about.
- It must still name something REAL: a number, a proper noun, a programme, or something of theirs.
- NEVER: "quick question", "touching base", "following up", "reaching out", "opportunity", "insights", "partnership", "trends", "update", "thoughts".
- Use the SUBJECT REGISTER assigned in the angle block above. It gives you the STANCE. Write the words yourself.${common}`;

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
- CTA: offer the named read for that segment, closing line different from E1 and E2. Weave ${CONNECT_URL} into a sentence naturally, once, not as a footer.${common}`;

  return `${ctx}

Write EMAIL 4 (thread reply, no subject) to ${first} at ${comp}. This is the LAST touch and it should be the HIGHEST-REPLY email in the sequence, because it asks for nothing.
HARD LIMIT: 130 words.
- "Dear ${first}," then a blank line.
- Open with the CLOSING MOVE specified in the angle block above, in your own words. Write the line yourself. Do not announce that you are not chasing a reply: saying it is itself a chase, and every email in the last run opened with that exact move.
- Then GIVE IT ALL AWAY: exactly 3 numbered items, one line each, each a concrete thing Kings Research is watching in their space right now. Draw them from the finding, the events and the dossier. Every item must be checkable and specific: a number, a named move, a named mechanism. No advice, no "consider whether you...", no generic observations.
- Close with an open door and NO ASK: no CTA, no offer to send anything, no question mark. Write that final line yourself, differently from any stock closing. The absence of an ask is the entire point of this email. Do not put one back in.
- You may place ${CONNECT_URL} once inside that closing sentence if it reads naturally as "where the rest of this lives", never as a call to action and never on its own line.${common}`;
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

export async function generateEmail(step, lead, companyIntel, news, events = [], usedSubjects = [], usedCTAs = [], insight = null, earlierBodies = [], buyerWorld = "", thesis = null) {
  const wantsSubject = step === 1; // E2-E4 are thread replies, no subject
  const [pKey, pDesc] = resolvePersona(lead);
  // Assigned per prospect, stable on re-run, spread across the list.
  const angle = chooseAngle(lead, events, thesis);
  // Outside organisations the model might wrongly lead on.
  const outsideNames = [
    ...(thesis && thesis.rivals ? thesis.rivals : []),
    ...(lead.__profile && lead.__profile.rivals ? lead.__profile.rivals : []),
    ...(events || []).flatMap((e) => (`${e.what || ""}`.match(/\b[A-Z][a-zA-Z&.]{2,}(?:\s[A-Z][a-zA-Z&.]{2,})?/g) || []))
  ].filter(Boolean);
  const subjectShape = chooseSubjectShape(lead);
  const closing = chooseClosing(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events, null, insight, buyerWorld, thesis, angle, subjectShape, closing);
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
    ...(prof ? prof.rivals : [])
  ].filter(Boolean).slice(0, 50);

  // Retries carry explicit feedback: the model is told exactly WHY the last
  // attempt was rejected. Blind retries were shipping banned words after 3
  // tries (e.g. a "navigating ..." subject); telling it the reason fixes most
  // rejections on the second attempt.
  let feedback = "";
  let last = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await chatJSON(SYSTEM_PROMPT, basePrompt + feedback);
      const rawBody = usableBody(out.body);
      if (!rawBody) continue;                       // "0", null, a fragment
      if (wantsSubject && typeof out.subject !== "string") continue;
      out.subject = wantsSubject ? cleanDashes(out.subject).replace(/\s+/g, " ").trim() : "";
      out.body = normalizeProse(ensureGreeting(cleanDashes(stripSignature(rawBody)), first));

      const reasons = [];
      const problems = bannedHits(out.body + " " + out.subject);
      if (problems.length) reasons.push(`it used banned phrase(s): ${problems.map((p) => `"${p}"`).join(", ")}`);
      const lenIssue = lengthProblem(out.body, step);
      if (lenIssue) reasons.push(lenIssue);
      const pitchIssue = pitchProblem(out.body, step);
      if (pitchIssue) reasons.push(pitchIssue);
      const mirrorIssue = mirrorProblem(out.body, companyIntel && companyIntel.siteText);
      if (mirrorIssue) reasons.push(mirrorIssue);
      const repeatIssue = repetitionProblem(out.body, earlierBodies);
      if (repeatIssue) reasons.push(repeatIssue);
      const bulletIssue = bulletProblem(out.body, step, anchorTokens);
      if (bulletIssue) reasons.push(bulletIssue);
      if (step === 1) {
        const openIssue = openingProblem(out.body, lead.companyName, outsideNames);
        if (openIssue) reasons.push(openIssue);
      }
      const linkIssue = linkProblem(out.body, step);
      if (linkIssue) reasons.push(linkIssue);
      const presumeIssue = presumptionProblem(out.body);
      if (presumeIssue) reasons.push(presumeIssue);
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
    const bodyIssues = () => [
      bannedHits(last.body).length ? `it still contains banned phrase(s): ${bannedHits(last.body).map((p) => `"${p}"`).join(", ")}` : null,
      lengthProblem(last.body, step),
      pitchProblem(last.body, step),
      mirrorProblem(last.body, companyIntel && companyIntel.siteText),
      repetitionProblem(last.body, earlierBodies),
      bulletProblem(last.body, step, anchorTokens),
      step === 1 ? openingProblem(last.body, lead.companyName, outsideNames) : null,
      linkProblem(last.body, step),
      presumptionProblem(last.body)
    ].filter(Boolean);

    let issues = bodyIssues();
    if (issues.length) {
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
          const repaired = normalizeProse(ensureGreeting(cleanDashes(stripSignature(fix.body)), first));
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
      const stillBad = subjectMagnet(last.subject, lead.companyName, outsideNames) || subjectGeneric(last.subject) || subjectProblem(last.subject, comp, lead.title);
      if (stillBad) {
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
    return { ...last, quality: issues.length ? `unfixable: ${issues[0]}`.slice(0, 160) : "ok" };
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED", quality: "generation failed" };
}
