import { chatJSON } from "./ai";

// Kept short and focused on genuinely spammy / identity-breaking phrasing.
// (The advisory tone itself is enforced positively in the system prompt.)
export const BANNED_PHRASES = [
  "i hope this email finds you well", "touching base", "reaching out to you today",
  "i noticed that as", "i've noticed that as",
  "we provide insights", "make better decisions", "help you make better decisions",
  "protect and expand their market share", "protect and expand its market share"
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
  return ["LEADERSHIP", "TENSION: where the next growth pocket is, what competitors see that they do not, and which strategic bets to place. ADVISORY ANGLE: opportunity and white-space assessment, competitive and ecosystem positioning."];
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

SUBJECT LINES:
- Quiet curiosity tied to the specific event or sector theme in the email. Sentence case is fine. A short question is fine.
- Write the subject in the READER's frame. NEVER use first-person-plural (we, our, us, ours); it makes you sound like you work at their company. Say "your strategy" or name the company ("Acme's strategy"), never "our strategy".
- NEVER include the recipient's job title or seniority words (Chief, Officer, Director, Controller, Head, VP, Manager...). The company name is optional. Avoid salesy words like Free, Guaranteed, Buy.

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
    L.push(`Open on the genuine sector-level shift in: ${lead.industry || lead.subIndustry || "this company's market"}. Name the real pressures and questions leaders in that space are weighing now. Do NOT fabricate a company-specific event, and do NOT open on unrelated news about other companies.`);
  }

  L.push("");
  L.push(`DETECTED PERSONA: ${personaKey}. ${personaDesc}`);
  L.push("(Use this only to TAILOR which advisory areas you mention; never restate their title in the email.)");
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
P1 THE HOOK: "Dear ${first}," then a blank line. If a real event is provided, open on it specifically and the strategic question it raises for ${comp} (use its 'angle'). If none, open on the genuine ${sector} shift leaders are weighing now. 2 to 4 sentences, a senior advisor's observation, never a restatement of their role.
P2 POSITIONING: one or two lines placing Kings Research (Kings Global) as a strategic market-intelligence and advisory firm that supports leadership teams on exactly this kind of question.
P3 CAPABILITY LIST: a short list of 3 to 4 SPECIFIC advisory / research areas relevant to ${comp}'s domain and the event, each on its own line starting with "- ".
P4 CTA: make clear this is not a standard vendor pitch, offer to share a few observations from your work across ${sector}, and ask for a brief 20-minute introductory conversation next week.
SUBJECT: quiet curiosity tied to the P1 hook. Sentence case or a short question. Never the recipient's job title.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (short, warm follow-up) to ${first} at ${comp}. NO capability list this time.
P1: "Dear ${first}," then a blank line, then a brief note surfacing ONE specific observation or trend Kings Research is seeing that is relevant to ${comp}'s situation (tie back to the event or ${sector} shift). 2 to 3 sentences, prose only.
P2 CTA: gently re-offer, e.g. "Would it be useful to compare notes on this ahead of your ${nextQuarter()} planning? A short 20-minute call is all it would take."
SUBJECT: short, curiosity-led, tied to that observation. Never the recipient's job title.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (peer perspective, credibility) to ${first} at ${comp}. NO capability list.
P1: "Dear ${first}," then a blank line, then reference an ANONYMIZED comparable organization in a similar sector: the strategic question they were weighing and how Kings Research's advisory support helped them think it through. Keep the outcome QUALITATIVE (clearer prioritisation, sharper positioning); do NOT invent specific percentages or client names.
P2: one sentence linking that to ${first}'s situation at ${comp}.
P3 CTA: "Worth a short conversation on how they approached it?"
SUBJECT: peer-perspective angle, curiosity-led. Never the recipient's job title.${common}`;

  return `${ctx}

Write EMAIL 4 (courteous close) to ${first} at ${comp}. NO capability list.
P1: "Dear ${first}," then a blank line, then ONE more specific forward-looking angle: an event signal not yet used (open on its 'angle'), or a sharp strategic question ${comp} will face over the next 12 to 24 months in ${sector}. Do NOT repeat E1 to E3.
P2 OPEN DOOR: warm and low-pressure, e.g. "I know timing matters. Whenever it is useful, I would be glad to share a short perspective tailored to ${comp}, just reply here."
SUBJECT: tied to the forward angle, curiosity-led. Never the recipient's job title.${common}`;
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
      if ((problems.length || subjIssue) && attempt < 2) continue;
      // Final backstop: if the last attempt still leaks first-person-plural
      // into the subject, rewrite it into the reader's frame rather than
      // shipping "our strategy".
      if (subjectProblem(out.subject, comp, lead.title)) {
        out.subject = fixSubjectVoice(out.subject);
      }
      return out;
    } catch { /* retry */ }
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED" };
}
