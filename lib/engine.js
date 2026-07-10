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
  "share some insights from our work"
];

// Buzzwords that make a subject line read like an AI-generated consulting
// report title. Checked as whole words / phrases; a hit forces regeneration.
export const SUBJECT_BANNED = [
  "strategic", "strategy", "strategies", "navigating", "navigate", "navigates",
  "evolving", "landscape", "positioning", "competitive", "challenges",
  "opportunities", "leverage", "leveraging", "optimize", "optimizing",
  "optimisation", "optimization", "enhance", "enhancing", "emerging",
  "dynamic", "pivotal", "perspectives", "growth pockets", "unlock", "unlocking",
  "maximize", "maximizing", "maximise", "synergy", "synergies", "transform",
  "transformative", "transformation"
];

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
  if (words.length >= 10) {
    return `subject too long (${words.length} words, aim <= 7) — reads like a report title`;
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

function shortCompany(name) {
  return (name || "").replace(/\b(plc|ltd|limited|inc|incorporated|llc|corp|corporation|holdings|group|co)\.?$/gi, "").trim() || name;
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
  if (["marketing", "brand", "product manager", "demand gen", "cmo", "growth"].some(has))
    return ["MARKETING", "TENSION: where demand is moving and which segment to pursue before peers do. ADVISORY ANGLE: demand and competitive positioning analysis."];
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
- The GIVE first (1 to 2 sentences): the specific observation, insight, or outside angle.
- In the FIRST email only, after the give: ONE line on who Kings Research is (a market-intelligence and advisory firm that works across their sector), then a SHORT list of 2 to 3 SPECIFIC ways Kings Research could help THIS prospect with THIS situation. Each item must be concrete and tailored to them (e.g. "which competitors are moving on X and how fast", "how peers have priced Y"), NOT a generic service category like "competitive positioning". 2 to 3 items only, each on its own line starting with "- ". Later emails (E2 to E4) have NO list.
- The CTA (see below).

THE CTA (offer value, do NOT ask for a meeting):
- Ask them to let you SEND something specific, or to reply, NOT for a call or "20 minutes". Name the specific thing you would send.
- NEVER ask for a meeting in these emails. NEVER use "a brief 20-minute conversation", "a short 20-minute call", "20 minutes", or "would you be open to a brief ...". The goal is a reply and a value exchange first, a call comes later.
- Vary the CTA across the four emails, never repeat the same closing line. RIGHT shapes: "If that is useful, I can send you the specifics, want them?"; "Happy to forward what we are seeing on X, shall I?"; "I can share the breakdown, just reply and it is yours."; "No agenda, if X is on your radar I will send our read on it."

PLAIN LANGUAGE (write like a sharp human, not like AI, this matters):
- Say something SPECIFIC to THIS company and THIS event. If a sentence would fit any company in any industry, cut it or replace it with something only this reader would recognize.
- BANNED words/phrases anywhere in the email (they are the reason cold emails read as AI-generated): "growth pockets", "strategic bets", "white space / white-space", "competitive positioning", "navigate / navigating", "evolving landscape", "evolving demands", "rapidly evolving", "dynamic industry / market", "both challenges and opportunities", "clarify their priorities", "sharpen their positioning", "leaders like you", "undoubtedly", "increasingly pertinent / critical", "pivotal", "resonate / resonates", "grappling with", "over the next 12 to 24 months", "in today's ... landscape". Do not use these or close variants.
- Keep advisory-area jargon (competitor mapping, white-space assessment, technology-adoption tracking, and so on) OUT of the prose give and questions; if you reference how Kings Research helps, do it in the tailored 2 to 3 item Email 1 list, phrased specifically to this prospect.
- Prefer short, concrete, plain words. One clear idea per sentence, no stacked abstractions.
- Vary your wording across the four emails, do not reuse the same phrases or sentence shapes.

SUBJECT LINES (this is where cold emails most obviously read as AI, get it right):
- SHORT and specific. Aim for 3 to 7 words, hard maximum 9. If it is longer than a text you would actually send, it is too long.
- Anchor to the CONCRETE thing in the email, the actual event, product, deal, or company, not an abstract theme. Good subjects name something real; bad subjects describe a concept.
- Lowercase or sentence case, conversational. It should sound like a busy person typed it, not like the title of a consulting report.
- NEVER use the "[Company] + Abstract Business Nouns" report-title format. BANNED examples of exactly what NOT to write: "Jones Brothers Trucking Competitive Positioning", "EvapTech, Inc. Navigating Operational Efficiency Challenges", "Fidelity Investments and Employee Engagement Challenges", "Strategic perspectives for Algal Bio in the evolving Food Additives Market landscape".
- BANNED subject words: strategic, strategy, navigating, evolving, landscape, positioning, competitive, challenges, opportunities, leverage, optimize, enhance, emerging, dynamic, pivotal, perspectives, unlock, maximize, transform, synergy.
- GOOD examples (short, specific, human): for a pivot, "the airspace pivot" or "delivery to airspace safety"; for a deal, "the Orbital UAV deal" or "$350M over five years"; for a launch, "Osmo Pocket 4P" or "quick thought on the Pocket 4P"; for a partnership, "Echodyne + Axon" or "radar for public safety"; with no event, "a question on aviation risk" or "where aviation insurers are exposed".
- Reader's frame only: NEVER first-person-plural (we, our, us, ours), which makes you sound like you work at their company. Say "your" or name the company, never "our strategy".
- NEVER include the recipient's job title or seniority words. Avoid salesy words like Free, Guaranteed, Buy.

STYLE: warm but professional, appropriate for a senior executive. No em dashes or en dashes (use commas or "and"). Greet with "Dear [First]," then a blank line. Put \\n\\n between paragraphs.

Return ONLY valid JSON: {"subject": "...", "body": "..."}. No markdown.`;

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events) {
  const comp = shortCompany(lead.companyName);
  const L = [];
  L.push("═══ PROSPECT INTELLIGENCE (personalize from this; never paste verbatim) ═══");
  L.push(`Name: ${lead.firstName} ${lead.lastName} | Title: ${lead.title} | Level: ${lead.level || "-"}`);
  L.push(`Company: ${comp} (RECIPIENT's company, use this exact short name) | HQ: ${[lead.city, lead.country].filter(Boolean).join(", ")}`);
  L.push(`Industry / sector: ${lead.industry || "-"} / ${lead.subIndustry || "-"}`);
  if (companyIntel.description) L.push(`What the company does (from its website): ${companyIntel.description}`);

  // Grounded research dossier: the real retrieved text the email MUST draw
  // from, so no-event rows are anchored in fact instead of invented "trends".
  const companyHeadlines = ((news && news.items) || [])
    .filter((i) => i.scope === "company")
    .slice(0, 8)
    .map((i) => `- ${i.title}${i.date ? ` (${String(i.date).slice(0, 16)})` : ""}`)
    .join("\n");
  if (companyIntel.siteText || companyHeadlines) {
    L.push("");
    L.push("═══ RESEARCH DOSSIER (real retrieved facts, this is the ONLY material you may state as fact) ═══");
    if (companyIntel.siteText) L.push(`In ${comp}'s own words (from its website): ${companyIntel.siteText}`);
    if (companyHeadlines) L.push(`Recent news mentioning ${comp}:\n${companyHeadlines}`);
    L.push("GROUNDING RULE: every factual statement in the email must be supported by this dossier, the supplied insight, or the event above. Do NOT invent industry 'trends', statistics, competitor moves, or developments that are not here. If the dossier only tells you what the company does, make your give a specific, TRUE point about their actual business plus an honest offer, never a made-up trend.");
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
      L.push(`${i + 1}. [${e.type} | ${e.scope || "industry"}]${e.recency ? ` (${String(e.recency).slice(0, 16)})` : ""} ${e.what || e.headline || ""}`);
      if (e.angle) L.push(`   angle: ${e.angle}`);
    });
    L.push("If an event is about another organization, use its 'angle' to raise the question it creates for the prospect, never frame it as a deal the prospect is party to or can 'leverage'.");
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

Write EMAIL 1 (first touch) to ${first} at ${comp}. Short: a give, one positioning line, a tailored 2 to 3 item list, a CTA.
- "Dear ${first}," then a blank line.
- GIVE FIRST, grounded in the RESEARCH DOSSIER / event above: if a REAL INSIGHT is provided, open with it. Else if a real event is provided, give a specific OUTSIDE angle on it, NOT a question about their own decision. Else give ONE concrete, TRUE point about ${comp}'s actual business (from the dossier), no invented trends, no platitudes.
- ONE line: who Kings Research (Kings Global) is (works across ${sector}).
- Then 2 to 3 SPECIFIC ways Kings Research could help ${comp} with THIS exact situation, each on its own line starting with "- ", tailored and concrete (not generic service categories).
- CTA: offer to SEND a specific named thing, or invite a reply. Do NOT ask for a call or "20 minutes".
SUBJECT: short (3 to 7 words), specific to the give. No report-title phrasing, no banned subject words.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (follow-up) to ${first} at ${comp}. 2 to 4 sentences. No positioning line, no list.
- "Dear ${first}," then a blank line.
- A DIFFERENT specific give from E1: one more concrete observation or outside angle tied to the event, the insight, or ${comp}'s business. Not a restatement, not a question about their own news.
- CTA: a DIFFERENT reply/value ask from E1, offer to send something specific. No meeting, no "20 minutes".
SUBJECT: short (3 to 7 words), specific to this give. No report-title phrasing, no banned subject words.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (a genuine give, NOT a made-up story) to ${first} at ${comp}. 2 to 4 sentences. No list.
- "Dear ${first}," then a blank line.
- Offer something concretely USEFUL you can share, named specifically enough to sound real: a particular breakdown, comparison, or read relevant to ${comp}'s situation (or a second facet of the supplied insight). Do NOT invent an anonymized "comparable client / peer" story, and do NOT invent statistics, outcomes, or client names.
- CTA: a DIFFERENT reply/value ask, offer to send that specific thing. No meeting, no "20 minutes".
SUBJECT: short (3 to 7 words), specific. No report-title phrasing, no banned subject words.${common}`;

  return `${ctx}

Write EMAIL 4 (courteous close) to ${first} at ${comp}. 2 to 4 sentences. No list.
- "Dear ${first}," then a blank line.
- ONE forward-looking, SPECIFIC angle relevant to ${comp} (not a generic "how will you adapt to change" question). Do not repeat E1 to E3.
- OPEN DOOR: warm, low-pressure, reply-based, offer to send your read if it is useful. No meeting, no "20 minutes", no "12 to 24 months".
SUBJECT: short (3 to 7 words), specific. No report-title phrasing, no banned subject words.${common}`;
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

export async function generateEmail(step, lead, companyIntel, news, events = [], usedSubjects = []) {
  const [pKey, pDesc] = resolvePersona(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events);
  let prompt = stepPrompt(step, lead, ctx);
  if (usedSubjects.length) {
    prompt += `\n\nSubjects already used in earlier emails to this person (do NOT reuse or closely echo any, each subject must be clearly different): ${usedSubjects.map((s) => `"${s}"`).join(", ")}`;
  }
  const comp = shortCompany(lead.companyName);
  const first = (lead.firstName || "there").toString().trim();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await chatJSON(SYSTEM_PROMPT, prompt);
      if (!out.subject || !out.body) continue;
      out.subject = cleanDashes(out.subject).replace(/\s+/g, " ").trim();
      out.body = ensureGreeting(cleanDashes(stripSignature(out.body)), first);

      const problems = bannedHits(out.body + " " + out.subject);
      const subjIssue = subjectProblem(out.subject, comp, lead.title);
      const subjGeneric = subjectGeneric(out.subject);
      const subjDup = usedSubjects.some((s) => s.toLowerCase().trim() === out.subject.toLowerCase().trim());
      if ((problems.length || subjIssue || subjGeneric || subjDup) && attempt < 2) continue;
      // Final backstop: if the last attempt still leaks first-person-plural
      // into the subject, rewrite it into the reader's frame rather than
      // shipping "our strategy". (Genericness/duplication can't be auto-fixed,
      // so the retries above are their guard.)
      if (subjectProblem(out.subject, comp, lead.title)) {
        out.subject = fixSubjectVoice(out.subject);
      }
      return out;
    } catch { /* retry */ }
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED" };
}
