import { chatJSON } from "./ai";

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
  "capture a larger share", "i've observed that", "i have observed that"
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

function cleanDashes(t) {
  return (t || "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s*--\s*/g, ", ")
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
export function reviewStatus(lead, events) {
  const company = (lead.companyName || "").trim();
  const domainLike = !company.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(company);
  if (!company) return { ready: false, skipGeneration: true, reason: "missing company name" };
  if (domainLike) return { ready: false, skipGeneration: true, reason: "company is a domain, add a real company name" };
  if (!events || !events.length) return { ready: false, skipGeneration: false, reason: "no company-specific signal found" };
  return { ready: true, skipGeneration: false, reason: "" };
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

COMPETITOR AND MARKET MOVES ARE YOUR STRONGEST HOOK:
- The reader has complete information about their own company and almost none about their rivals. That information gap is precisely what Kings Research sells, so an email anchored on WHAT A COMPETITOR OR THE MARKET JUST DID, and what it means for the reader's share, pricing, or pipeline, out-converts an email about the reader's own news every time.
- When a screened event has subject "competitor" or "market": open by naming the move plainly, then state the concrete question it raises for the READER's business (share, pricing, customers, pipeline), then offer the specific read. This IS the give.
- ANCHOR PRIORITY for Email 1: (1) a supplied real insight, (2) a relevant competitor or market/regulatory move and its implication for the reader, (3) the reader's own event with an outside angle, (4) a grounded point about their business. Never invert this order.

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

STRUCTURE (keep it SHORT, no wall of text):
- "Dear [First]," then a blank line.
- The GIVE first (2 to 4 sentences): the specific observation or outside angle, then 1 to 2 more sentences of grounded, specific context around it (a concrete implication, detail, or angle drawn from the dossier or event) so the opening reads as genuinely informed. Keep every line factual and grounded, never padding, flattery, or an invented trend.
- In the FIRST email only, after the give: ONE line on who Kings Research is (a market-intelligence and advisory firm that works across their sector), then a SHORT list of 2 to 3 SPECIFIC ways Kings Research could help THIS prospect with THIS situation. Each item must be concrete and tailored to them (e.g. "which competitors are moving on X and how fast", "how peers have priced Y"), NOT a generic service category like "competitive positioning". 2 to 3 items only, each on its own line starting with "- ". Later emails (E2 to E4) have NO list.
- The CTA (see below).

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

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events, reportHook = null) {
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

  if (lead.insight) {
    L.push("");
    L.push("═══ REAL INSIGHT TO LEAD WITH (this is your GIVE, open EMAIL 1 on it in plain words, do not water it down) ═══");
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
    L.push("═══ NO RELEVANT COMPANY-SPECIFIC EVENT FOUND ═══");
    L.push(`There is no news event to hook on. Ground your give in the RESEARCH DOSSIER above: a specific, TRUE point about what ${comp} actually does and who it serves (from its own words), or a real item in its recent news. Do NOT fabricate an event or an industry 'trend', and do NOT recite vague platitudes like "the sector is evolving" or "grappling with change", those read as generic AI. If the dossier is thin, say less, a short honest note beats invented filler.`);
  }

  L.push("");
  const advisoryAngle = (personaDesc.split(/ADVISORY ANGLE:/i)[1] || personaDesc).replace(/\.\s*$/, "").trim();
  L.push(`PERSONA STEER (${personaKey}): if you mention Kings Research's focus in the single Email 1 positioning line, lean toward ${advisoryAngle}. Internal note only, never put the persona or their job title into the prose.`);
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
  const common = `\nKeep it SHORT. Lead with the GIVE, do not open with who you are. No market-size/CAGR/forecast figures, no invented stats or client names. The ask is a REPLY or to SEND something specific, NEVER a meeting or "20 minutes". No signature or sign-off, end at the CTA. No em/en dashes. \\n\\n between paragraphs. SUBJECT in the reader's frame ("your" or the company name), never "we/our/us". Return ONLY {"subject":"...","body":"..."}`;

  if (step === 1) return `${ctx}

Write EMAIL 1 (first touch) to ${first} at ${comp}. An opening give paragraph, one positioning line, a tailored 2 to 3 item list, a CTA.
- "Dear ${first}," then a blank line.
- GIVE FIRST, grounded in the RESEARCH DOSSIER / event above, 3 to 4 sentences: if a REAL INSIGHT is provided, open with it. Else if a real event is provided, NAME it and give a specific OUTSIDE angle on it (NOT a question about their own decision), then add 1 to 2 more sentences of grounded, specific context around it (a concrete implication or detail) so it reads as informed. Else give a concrete, TRUE point about ${comp}'s actual business (from the dossier) with 1 to 2 lines of real context. Keep every line factual and grounded, no invented trends, no flattery, no platitudes.
- ONE line: who Kings Research (Kings Global) is, ending with "We can help ${comp} with:" so the list never dangles.
- Then 2 to 3 SPECIFIC ways Kings Research could help ${comp} with THIS exact situation, each on its own line starting with "- ", tailored and concrete (not generic service categories).
- CTA: offer to SEND a specific named thing, or invite a reply. Do NOT ask for a call or "20 minutes".
SUBJECT: 5 to 9 words, a CLICK MAGNET: name the COMPANY (${comp}) AND, if there is an event, the specific movement or decision, then a VALUE TAIL naming a concrete business payoff (the growth angle, what it opens up, the expansion upside, next moves). Never a musing tail like "a thought". Concrete, never abstract report-title nouns, no banned subject words.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (follow-up) to ${first} at ${comp}. 2 to 4 sentences. No positioning line, no list.
- "Dear ${first}," then a blank line.
- A DIFFERENT specific give from E1: one more concrete observation or outside angle tied to the event, the insight, or ${comp}'s business. Not a restatement, not a question about their own news.
- CTA: a DIFFERENT reply/value ask from E1, offer to send something specific. No meeting, no "20 minutes".
SUBJECT: 5 to 9 words, name ${comp} and the specific angle of this email, then a VALUE TAIL naming a payoff, different from E1's tail. Concrete, no report-title phrasing, no banned subject words.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (the segment pitch, this is where Kings Research's actual work earns the reply) to ${first} at ${comp}. 3 to 4 sentences. No list.
- "Dear ${first}," then a blank line.
- From the dossier or event, pick ONE specific SEGMENT or APPLICATION that genuinely matters to ${comp} (e.g. a product line, coverage type, customer group, or use case they actually serve). Name it precisely.
- Offer Kings Research's specific current read on THAT segment: what is driving demand, who is moving, where the openings are. Frame it as insight into a segment worth exploring further, NEVER as a market-size pitch: absolutely no market value, CAGR, forecast, or "by 2030" figures, that instantly rebrands you as a report vendor.
- CTA: offer to send that named read, closing line different from E1 and E2.
SUBJECT: 5 to 9 words, name ${comp} and that exact segment or application, then a VALUE TAIL naming a payoff (e.g. the growth angle in that segment), different from earlier tails. No report-title phrasing, no banned subject words.${common}`;

  return `${ctx}

Write EMAIL 4 (courteous close) to ${first} at ${comp}. 2 to 4 sentences. No list.
- "Dear ${first}," then a blank line.
- ONE forward-looking, SPECIFIC angle relevant to ${comp} (not a generic "how will you adapt to change" question). Do not repeat E1 to E3.
- OPEN DOOR: warm, low-pressure, reply-based, offer to send your read if it is useful. No meeting, no "20 minutes", no "12 to 24 months".
SUBJECT: 5 to 9 words, name ${comp} and the specific forward angle, then a VALUE TAIL naming a payoff, different from earlier tails. No report-title phrasing, no banned subject words.${common}`;
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

export async function generateEmail(step, lead, companyIntel, news, events = [], usedSubjects = [], usedCTAs = []) {
  const [pKey, pDesc] = resolvePersona(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events);
  let basePrompt = stepPrompt(step, lead, ctx);
  if (usedSubjects.length) {
    basePrompt += `\n\nSubjects already used in earlier emails to this person (do NOT reuse or closely echo any, each subject must be clearly different): ${usedSubjects.map((s) => `"${s}"`).join(", ")}`;
  }
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
      if (!out.subject || !out.body) continue;
      out.subject = cleanDashes(out.subject).replace(/\s+/g, " ").trim();
      out.body = ensureGreeting(cleanDashes(stripSignature(out.body)), first);

      const reasons = [];
      const problems = bannedHits(out.body + " " + out.subject);
      if (problems.length) reasons.push(`it used banned phrase(s): ${problems.map((p) => `"${p}"`).join(", ")}`);
      const subjIssue = subjectProblem(out.subject, comp, lead.title);
      if (subjIssue) reasons.push(`the subject had a problem: ${subjIssue}`);
      const subjGeneric = subjectGeneric(out.subject);
      if (subjGeneric) reasons.push(`the subject was generic: ${subjGeneric}`);
      if (usedSubjects.some((s) => s.toLowerCase().trim() === out.subject.toLowerCase().trim())) {
        reasons.push(`the subject "${out.subject}" was already used in an earlier email`);
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

  // Ship the best we have rather than nothing, but repair the subject first:
  // a targeted subject-only regeneration with the rejection reason, so a
  // banned/duplicate subject is not written to the sheet just because three
  // full attempts ran out.
  if (last) {
    const stillBad = subjectGeneric(last.subject) || subjectProblem(last.subject, comp, lead.title) ||
      usedSubjects.some((s) => s.toLowerCase().trim() === last.subject.toLowerCase().trim());
    if (stillBad) {
      try {
        const fix = await chatJSON(
          SYSTEM_PROMPT,
          `The email body below is final. Write ONLY a new subject line for it: 3 to 7 words, hyper-specific to this prospect (name the event, product, segment, or company in the body), conversational, none of the banned subject words, in the reader's frame (never we/our/us), and clearly different from: ${usedSubjects.map((s) => `"${s}"`).join(", ") || "(none)"}. The previous subject "${last.subject}" was rejected because: ${stillBad}. Return ONLY {"subject":"..."}.\n\nBODY:\n${last.body}`
        );
        if (fix.subject) {
          const s = cleanDashes(fix.subject).replace(/\s+/g, " ").trim();
          if (!subjectGeneric(s) && !subjectProblem(s, comp, lead.title)) last.subject = s;
        }
      } catch { /* keep last.subject */ }
    }
    if (subjectProblem(last.subject, comp, lead.title)) {
      last.subject = fixSubjectVoice(last.subject);
    }
    return last;
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED" };
}
