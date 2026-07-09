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
  "next area of growth", "what rivals"
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

const SYSTEM_PROMPT = `You are a senior advisor at Kings Research (Kings Global), a strategic market intelligence and advisory firm. You write warm, credible, CONSULTATIVE cold emails to senior leaders. You are a thinking partner offering perspective, NOT a vendor pushing a product and NOT a market-research house selling a report.

IDENTITY RULE (never violate):
- YOU are the SENDER at Kings Research (an advisory firm). The prospect is the RECIPIENT at THEIR company. Never conflate the two, never replace their company with "we/our".
- This is cold outreach; they do not know you. Be respectful and senior in tone.

CONSULTANCY, NOT A DATA VENDOR (this is the whole point):
- Position Kings Research as a strategic advisory and market-intelligence partner that helps leadership teams think through decisions, NOT as a report you can buy.
- ABSOLUTELY NO market-size, CAGR, forecast, "market is worth USD X", or "growing at Y%" figures. Those make you read like a market-research seller and are banned everywhere in the email.
- The ONLY numbers permitted are ones the prospect's OWN company actually announced in a real event provided to you (e.g. the size of an investment they just made). Never invent statistics, client names, or specific outcome percentages.

THE OPENING (a consultant's observation, not a pitch):
- If a real, recent EVENT for the prospect's company or industry is provided, OPEN by referencing that specific event and the strategic question it raises for them. Use its "angle". This is the strongest, most credible opener. Use at most ONE event, precisely.
- If the event is about ANOTHER organization (a competitor, supplier, OEM, university, or agency), frame it as the market signal it creates for the prospect and the question it raises for THEM. NEVER imply the prospect is party to someone else's deal, and never tell them to "leverage", "capitalize on", or "benefit from" another company's move.
- If no event is provided, open on the genuine sector-level shift the company operates within (the pressures and questions leaders in that space are weighing right now). Do NOT reach for unrelated news about other companies to manufacture a hook.
- Never restate the recipient's job title. No "I hope this email finds you well", no "touching base".

ADVISORY POSITIONING:
- After the hook, one or two lines: Kings Research is a strategic market-intelligence and advisory firm that supports leadership teams on exactly this kind of question.
- You MAY include ONE short list (3 to 4 items) of the SPECIFIC advisory / research areas relevant to THIS company's domain and the event, e.g. competitor and ecosystem mapping, supply-chain and sourcing intelligence, technology-adoption tracking, partnership and investment monitoring, regulatory and policy analysis, market and white-space assessment. Tailor the items; keep each short. Use this list in the FIRST email only.
- Frame everything as help with THEIR decision, never "we sell X".

THE CTA (soft, explicitly non-vendor):
- Make clear this is NOT a standard vendor pitch: offer to share a few observations you are seeing across their sector, of value whether or not they ever work with you.
- Ask for a brief 20-minute introductory conversation, low pressure, next week or in the coming days.
- End the email at the CTA line. Do NOT add a signature, sign-off, or contact details; those are appended automatically.

PLAIN LANGUAGE (write like a sharp human, not like AI, this matters):
- Say something SPECIFIC to THIS company and THIS event. If a sentence would fit any company in any industry, cut it or replace it with something only this reader would recognize.
- BANNED words/phrases anywhere in the email (they are the reason cold emails read as AI-generated): "growth pockets", "strategic bets", "white space / white-space", "competitive positioning", "navigate / navigating", "evolving landscape", "evolving demands", "rapidly evolving", "dynamic industry / market", "both challenges and opportunities", "clarify their priorities", "sharpen their positioning", "leaders like you", "undoubtedly", "increasingly pertinent / critical", "pivotal", "resonate / resonates", "grappling with", "over the next 12 to 24 months", "in today's ... landscape". Do not use these or close variants.
- The advisory-area terms (competitor mapping, white-space assessment, technology-adoption tracking, and so on) belong ONLY in the Email 1 capability list, never in the prose openings, questions, or peer story.
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

STYLE: warm but professional, appropriate for a senior executive. No em dashes or en dashes (use commas or "and"). Greet with "Dear [First]," then a blank line. Put \\n\\n between paragraphs. If you use the capability list, put each item on its own line starting with "- ".

Return ONLY valid JSON: {"subject": "...", "body": "..."}. No markdown.`;

function buildContext(lead, companyIntel, news, personaKey, personaDesc, events) {
  const comp = shortCompany(lead.companyName);
  const L = [];
  L.push("═══ PROSPECT INTELLIGENCE (personalize from this; never paste verbatim) ═══");
  L.push(`Name: ${lead.firstName} ${lead.lastName} | Title: ${lead.title} | Level: ${lead.level || "-"}`);
  L.push(`Company: ${comp} (RECIPIENT's company, use this exact short name) | HQ: ${[lead.city, lead.country].filter(Boolean).join(", ")}`);
  L.push(`Industry / sector: ${lead.industry || "-"} / ${lead.subIndustry || "-"}`);
  if (companyIntel.description) L.push(`What the company does (from its website): ${companyIntel.description}`);

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
    L.push(`There is no event to hook on. Open on something CONCRETE and specific to what ${comp} actually does (use the website description above: the specific business they are in and who they serve), tied to ONE real, named dynamic in ${lead.subIndustry || lead.industry || "their market"}. Do NOT fabricate an event, do NOT open on unrelated news, and do NOT recite vague platitudes like "the sector is evolving", "grappling with change", or "where the next area of growth lies", those are exactly what makes this read as generic AI.`);
  }

  L.push("");
  const advisoryAngle = (personaDesc.split(/ADVISORY ANGLE:/i)[1] || personaDesc).replace(/\.\s*$/, "").trim();
  L.push(`PERSONA STEER (${personaKey}): when you choose the Email 1 capability-list items, lean toward ${advisoryAngle}. This is an internal note for picking the list ONLY, never put it, the persona, or their job title into the prose.`);
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
  const common = `\nNo market-size, CAGR or forecast figures. No signature or sign-off, end at the CTA. No em/en dashes. \\n\\n between paragraphs. The SUBJECT must be in the reader's frame, use "your" or the company name and never "we/our/us". Return ONLY {"subject":"...","body":"..."}`;

  if (step === 1) return `${ctx}

Write EMAIL 1 (consultative introduction) to ${first} at ${comp}.
P1 THE HOOK: "Dear ${first}," then a blank line. If a real event is provided, open on it specifically and the question it raises for ${comp} (use its 'angle'). If none, open on something concrete about what ${comp} actually does and ONE real, specific dynamic in ${sector}, not a vague "the sector is evolving" platitude. 2 to 4 sentences, a senior advisor's observation, never a restatement of their role.
P2 POSITIONING: one or two lines placing Kings Research (Kings Global) as a strategic market-intelligence and advisory firm that supports leadership teams on exactly this kind of question.
P3 CAPABILITY LIST: a short list of 3 to 4 SPECIFIC advisory / research areas relevant to ${comp}'s domain and the event, each on its own line starting with "- ".
P4 CTA: make clear this is not a standard vendor pitch, offer to share a few observations from your work across ${sector}, and ask for a brief 20-minute introductory conversation next week.
SUBJECT: short (3 to 7 words) and specific to the P1 hook, name the actual event or a concrete detail. Conversational, never a report-title of abstract nouns, and none of the banned subject words.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (short, warm follow-up) to ${first} at ${comp}. NO capability list this time.
P1: "Dear ${first}," then a blank line, then a brief note surfacing ONE specific observation or trend Kings Research is seeing that is relevant to ${comp}'s situation (tie back to the event or ${sector} shift). 2 to 3 sentences, prose only.
P2 CTA: gently re-offer, e.g. "Would it be useful to compare notes on this ahead of your ${nextQuarter()} planning? A short 20-minute call is all it would take."
SUBJECT: short (3 to 7 words), specific to that one observation, conversational. No abstract report-title phrasing, no banned subject words.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (peer perspective, credibility) to ${first} at ${comp}. NO capability list.
P1: "Dear ${first}," then a blank line, then reference an ANONYMIZED comparable organization in a similar sector. Be CONCRETE and human about the actual decision or tension they faced (not "clarifying priorities"), and how an outside perspective helped them think it through. Do NOT invent percentages or client names, do NOT use the words "clarify their priorities" or "sharpen their positioning", and do NOT open with "I recently worked with", vary the framing.
P2: one sentence linking that to ${first}'s situation at ${comp}, specifically.
P3 CTA: "Worth a short conversation on how they approached it?"
SUBJECT: short (3 to 7 words), the peer angle in plain words, conversational and specific (not a generic "a peer's approach to X" line). No report-title phrasing, no banned subject words.${common}`;

  return `${ctx}

Write EMAIL 4 (courteous close) to ${first} at ${comp}. NO capability list.
P1: "Dear ${first}," then a blank line, then ONE more specific forward-looking angle: an event signal not yet used (open on its 'angle'), or one sharp, concrete question ${comp} will face soon in ${sector}. Make it specific to them, not a generic "how will you adapt to change" question. Do NOT repeat E1 to E3.
P2 OPEN DOOR: warm and low-pressure, e.g. "I know timing matters. Whenever it is useful, I would be glad to share a short perspective tailored to ${comp}, just reply here."
SUBJECT: short (3 to 7 words), specific to the forward angle, conversational. No report-title phrasing, no banned subject words.${common}`;
}

export async function generateEmail(step, lead, companyIntel, news, events = []) {
  const [pKey, pDesc] = resolvePersona(lead);
  const ctx = buildContext(lead, companyIntel, news, pKey, pDesc, events);
  const prompt = stepPrompt(step, lead, ctx);
  const comp = shortCompany(lead.companyName);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await chatJSON(SYSTEM_PROMPT, prompt);
      if (!out.subject || !out.body) continue;
      out.subject = cleanDashes(out.subject).replace(/\s+/g, " ").trim();
      out.body = cleanDashes(stripSignature(out.body))
        .replace(/^(Dear\s+[^,]+,)\s*\n?(?!\n)/, "$1\n\n");

      const problems = bannedHits(out.body + " " + out.subject);
      const subjIssue = subjectProblem(out.subject, comp, lead.title);
      const subjGeneric = subjectGeneric(out.subject);
      if ((problems.length || subjIssue || subjGeneric) && attempt < 2) continue;
      // Final backstop: if the last attempt still leaks first-person-plural
      // into the subject, rewrite it into the reader's frame rather than
      // shipping "our strategy". (Genericness can't be auto-fixed, so the
      // retries above are its only guard.)
      if (subjectProblem(out.subject, comp, lead.title)) {
        out.subject = fixSubjectVoice(out.subject);
      }
      return out;
    } catch { /* retry */ }
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED" };
}
