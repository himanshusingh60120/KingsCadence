import { chatJSON } from "./ai";

const DISCOUNT = process.env.DISCOUNT || "10%";

export const BANNED_PHRASES = [
  "protect and expand their market share", "protect and expand its market share",
  "uncover emerging opportunities", "weighing its strategic priorities",
  "i would be glad to share", "i noticed that as", "i've noticed that as",
  "rapidly evolving landscape", "we provide insights",
  "support sharper strategic decision-making", "make better decisions",
  "adopt advanced solutions", "adopting advanced solutions",
  "manage these risks", "manage your risk", "quantify and manage", "quantify your exposure",
  "i hope this email finds you well", "reaching out to you today", "touching base"
];

const JOB_TITLE_WORDS = new Set(("ceo cfo coo cto cmo cio cdo chief executive officer founder cofounder president vice vp svp evp director manager head lead leader owner partner principal chairman chairwoman controller regulatory secretary treasurer general managing senior analyst engineer consultant specialist coordinator supervisor administrator representative associate assistant").split(" "));

export function subjectProblem(subject, company, title) {
  const s = (subject || "").toLowerCase();
  const sWords = new Set(s.match(/[a-z]+/g) || []);
  const companyWords = new Set(((company || "").toLowerCase().match(/[a-z0-9]+/g) || []));
  if (title) {
    for (const w of (title.toLowerCase().match(/[a-z]+/g) || [])) {
      if (JOB_TITLE_WORDS.has(w) && !companyWords.has(w) && sWords.has(w)) {
        return `job-title word "${w}" in subject`;
      }
    }
  }
  const sig = [...companyWords].filter((w) => w.length > 1 && !["plc", "ltd", "inc", "llc", "holdings", "group", "the"].includes(w));
  if (sig.length && !sig.some((w) => sWords.has(w) || s.includes(w))) {
    return "company name missing from subject";
  }
  return null;
}

export function bannedHits(text) {
  const t = (text || "").toLowerCase();
  return BANNED_PHRASES.filter((p) => t.includes(p));
}

function cleanDashes(t) {
  return (t || "").replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/\s*--\s*/g, ", ")
    .replace(/,\s*,/g, ",").replace(/,\s*\./g, ".");
}

function stripSignature(body) {
  return (body || "")
    .replace(/\n\s*(Best|Regards|Cheers|Warm regards|All the best|Sincerely|Thanks|Kind regards|Thank you|Looking forward|Talk soon)[\s,]*\n?[\s\S]*$/i, "")
    .replace(/\n\s*\[(Your )?Name\][\s\S]*$/i, "")
    .trim();
}

function shortCompany(name) {
  return (name || "").replace(/\b(plc|ltd|limited|inc|incorporated|llc|corp|corporation|holdings|group|co)\.?$/gi, "").trim() || name;
}

export function resolvePersona(lead) {
  const blob = `${lead.department || ""} ${lead.title || ""}`.toLowerCase();
  const has = (t) => (t.length <= 3 ? new RegExp(`\\b${t}\\b`).test(blob) : blob.includes(t));
  if (["procurement", "purchasing", "sourcing", "supply chain", "vendor", "buyer", "logistics"].some(has))
    return ["PROCUREMENT", "TENSION: pricing volatility, margin compression, supplier reliability, no clean cost benchmark. HELP: cost and supplier benchmarking against the rest of the market."];
  if (["sales", "business development", "account executive", "commercial", "revenue", "country manager", "gtm"].some(has))
    return ["SALES", "TENSION: shifting buyer demand, losing share to agile competitors, needing segment-level sizing for GTM. HELP: segment-level market sizing and which segments/regions to prioritise."];
  if (["marketing", "brand", "product manager", "demand gen", "cmo", "growth"].some(has))
    return ["MARKETING", "TENSION: where demand is moving, which segment to chase before peers. HELP: demand/segment sizing and competitive positioning."];
  if (["finance", "treasury", "accounting", "fp&a", "investment", "actuar", "pricing", "cfo", "controller", "regulatory", "compliance", "risk", "audit"].some(has))
    return ["FINANCE", "TENSION: a cost or exposure estimated by feel because no clean external benchmark exists; defending assumptions, rates and budgets, and regulatory shifts reshaping cost lines. HELP: a defensible external benchmark and a read on how a regulatory/cost shift reshapes their assumptions."];
  if (["r&d", "engineering", "cto", "technical", "innovation", "technology", "scientist", "data scien"].some(has))
    return ["R&D", "TENSION: which technology/material/standard is about to become table stakes. HELP: a technology-adoption roadmap, what becomes table stakes and when."];
  return ["LEADERSHIP", "TENSION: where the next revenue pocket is, what competitors see that they don't, regulatory threats. HELP: opportunity/white-space assessment and competitive positioning for their next move."];
}

const SYSTEM_PROMPT = `You are a senior advisor at Kings Research, a market intelligence and consulting firm. You write cold emails that feel like a well-informed peer offering help with a problem the prospect is living, NOT a vendor pushing a product.

IDENTITY RULE (never violate):
- YOU are the SENDER at Kings Research (advisory/consulting firm).
- The prospect is the RECIPIENT at THEIR company. Never conflate the two. Never replace their company with "we/our".
- This is cold outreach; they do not know you.

THE HOOK IS EVERYTHING, OPEN ON A PROBLEM, NOT A TITLE:
- HARD BANS on the opening: "I noticed that as [title]...", any restatement of their job, generic adjectives ("rapidly evolving landscape"), leading with a headline market size.
- Build the opener from: (1) a decision or number this person plausibly owns, (2) a real tension: a fresh news event hitting their business, a cost priced by feel, a missing benchmark, a quiet peer move, a requirement about to change, (3) an implied gap an advisory firm closes, left hanging.
- If FRESH NEWS SIGNALS are provided, the strongest possible hook ties one specific, recent event (merger, takeover, regulation, expansion) to a decision the prospect owns. Use at most ONE news item, precisely, never a news dump.

ADVISORY POSITIONING, SELL HELP, NOT A REPORT:
- After the hook, ONE line: Kings Research is an advisory firm + the SPECIFIC engagement you'd run for someone in their seat + the outcome. Banned as too vague: "we provide insights", "help you make better decisions".
- Use numbers as PROOF you track the space, never as "market is big, so buy".
- Never imply you sell software, compliance tools, or risk systems. You advise and analyse.
- CTA is a short, low-pressure working session or tailored briefing framed around THEIR decision. No "buy", no "purchase". No signature or sign-off; the email ENDS at the CTA line.

SUBJECT LINES:
- MANDATORY: built around the prospect's COMPANY NAME. NEVER include their job title or seniority words (Chief, Officer, Director, Controller, Head, VP, Manager...).
- Title Case, no slashes/dashes/colons/plus signs. Banned words: Insights, Intelligence, Study, Report, Opportunities, Growth.
- Quiet curiosity tied to the specific tension in the email.

STYLE: no em dashes or en dashes (use commas or "and"). Put \\n\\n after the greeting and between paragraphs. If you use 2 data points, MERGE them into one flowing sentence, never back-to-back stat-listing.

Return ONLY valid JSON: {"subject": "...", "body": "..."}. No markdown.`;

function buildContext(lead, report, reportData, companyIntel, news, personaKey, personaDesc, relevance) {
  const comp = shortCompany(lead.companyName);
  const L = [];
  L.push("═══ PROSPECT INTELLIGENCE (personalize from this; never paste verbatim) ═══");
  L.push(`Name: ${lead.firstName} ${lead.lastName} | Title: ${lead.title} | Level: ${lead.level || "-"}`);
  L.push(`Company: ${comp} (RECIPIENT's company, use this exact short name) | HQ: ${[lead.city, lead.country].filter(Boolean).join(", ")}`);
  L.push(`Industry: ${lead.industry || "-"} / ${lead.subIndustry || "-"} | Headcount: ${lead.companyHeadCount || "-"} | Revenue: ${lead.companyRevenue || "-"}`);
  if (companyIntel.description) L.push(`What the company does (from its website): ${companyIntel.description}`);
  if (news.newsSummary) {
    L.push("");
    L.push("═══ FRESH NEWS SIGNALS (last 30-60 days; pick AT MOST ONE as the hook if genuinely relevant) ═══");
    L.push(news.newsSummary);
  }
  L.push("");
  L.push(`═══ RELEVANCE BRIDGE (why the ${report.title} matters to THEM; rephrase into a problem) ═══`);
  L.push(relevance || report.reason || "");
  L.push("");
  L.push(`DETECTED PERSONA: ${personaKey}. ${personaDesc}`);
  L.push("");
  if (reportData.sizeCurrent || reportData.cagr || reportData.highlights.length) {
    L.push("═══ REPORT DATA (never name the source; say we/our team/our data) ═══");
    if (reportData.sizeCurrent) L.push(`Current size: ${reportData.sizeCurrent} (${reportData.baseYear})`);
    if (reportData.sizeForecast) L.push(`Forecast: ${reportData.sizeForecast} by ${reportData.forecastYear}`);
    if (reportData.cagr) L.push(`CAGR: ${reportData.cagr}`);
    if (reportData.leadingRegion) L.push(`Leading region: ${reportData.leadingRegion}`);
    if (reportData.fastestRegion) L.push(`Fastest-growing region: ${reportData.fastestRegion}`);
    reportData.highlights.slice(0, 5).forEach((h, i) => L.push(`Highlight ${i + 1}: ${h}`));
    if (reportData.drivers.length) L.push(`Drivers: ${reportData.drivers.join("; ")}`);
  } else {
    L.push("No verified figures scraped. Keep any number directional and clearly an estimate; never fabricate precise statistics.");
  }
  return L.join("\n");
}

function nextQuarter() {
  const q = ["Q2","Q2","Q2","Q3","Q3","Q3","Q4","Q4","Q4","Q1","Q1","Q1"];
  return q[new Date().getMonth()];
}

function stepPrompt(step, lead, report, ctx) {
  const first = lead.firstName;
  const comp = shortCompany(lead.companyName);
  const topic = (report.title || "").replace(/\bmarket\b/gi, "").replace(/\s+/g, " ").trim();
  const common = `\nNo signature. No em/en dashes. \\n\\n between paragraphs. Return ONLY {"subject":"...","body":"..."}`;

  if (step === 1) return `${ctx}

Write EMAIL 1 (cold outreach) to ${first} at ${comp}.
P1 THE HOOK: "Hi ${first}," then new paragraph. Open on a SPECIFIC tension ${first} plausibly lives with, ideally anchored to ONE fresh news signal or the relevance bridge rephrased as a problem. Never restate their title. 2-3 sentences, a peer's observation.
P2 HOW WE HELP AS PROOF: one line naming Kings Research as an advisory firm + the specific engagement for someone in ${first}'s seat + outcome. Then ONE number as proof you track the ${topic} space (include the forecast year), tied to what it implies for ${first}'s own cost, risk, share or roadmap.
P3 CTA: low-pressure working session, e.g. "happy to walk you and your team through how we'd approach this for ${comp}, no obligation".
SUBJECT: 4-9 words, Title Case, built around "${comp}", tied to the P1 tension. Under 150 words.${common}`;

  if (step === 2) return `${ctx}

Write EMAIL 2 (follow-up, data depth) to ${first} at ${comp}.
P1: "Hi ${first}," then a line like "Another angle on the ${topic.toLowerCase()} numbers worth tracking for ${comp}..." MERGE the CAGR with ONE fresh highlight (regional shift or segment value) into a single flowing sentence, then one line on how we'd help ${first}'s team act on that shift. Max 4 sentences.
P2 CTA: "Would it help to have us pull together a short briefing on this for your ${nextQuarter()} planning?"
SUBJECT: 4-8 words, Title Case, around "${comp}" and this specific trend. Under 100 words.${common}`;

  if (step === 3) return `${ctx}

Write EMAIL 3 (social proof) to ${first} at ${comp}.
P1: "Hi ${first}," then a believable anonymized peer in a similar sector: the specific question we helped with, the concrete outcome (a number, e.g. "18% improvement in win rates"), and the MECHANISM (what they did with our advisory input).
P2: one sentence linking that outcome to ${first}'s situation at ${comp}.
P3 CTA: "Worth a quick look at how they approached it?"
SUBJECT: 4-9 words, Title Case, around "${comp}", peer-outcome angle. Under 100 words.${common}`;

  return `${ctx}

Write EMAIL 4 (deepest insight + courteous close) to ${first} at ${comp}.
P1: "Hi ${first}," then lead straight into the single most specific, granular finding available (a segment moving faster than the rest, a technology replacement, a sharp regional signal, or the freshest news signal not yet used), framed as one precise detail a peer would flag in passing, touching what ${first} owns at ${comp}. Do NOT repeat E1/E2 premises or summarize the market.
P2: two sentences max: "On a separate note, we're extending a ${DISCOUNT} courtesy rate on a tailored analysis this month."
P3 OPEN DOOR: "Whenever the timing is right, just reply here and I'll put together a short read tailored to ${comp}."
SUBJECT: 4-8 words, Title Case, around "${comp}", the granular detail. Under 110 words.${common}`;
}

export async function generateEmail(step, lead, report, reportData, companyIntel, news, relevance) {
  const [pKey, pDesc] = resolvePersona(lead);
  const ctx = buildContext(lead, report, reportData, companyIntel, news, pKey, pDesc, relevance);
  const prompt = stepPrompt(step, lead, report, ctx);
  const comp = shortCompany(lead.companyName);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await chatJSON(SYSTEM_PROMPT, prompt);
      if (!out.subject || !out.body) continue;
      out.subject = cleanDashes(out.subject).replace(/\s+/g, " ").trim();
      out.body = cleanDashes(stripSignature(out.body))
        .replace(/^(Hi\s+[^,]+,)\s*\n?(?!\n)/, "$1\n\n");

      const problems = bannedHits(out.body + " " + out.subject);
      const subjIssue = subjectProblem(out.subject, comp, lead.title);
      if ((problems.length || subjIssue) && attempt < 2) continue;
      return out;
    } catch { /* retry */ }
  }
  return { subject: "GENERATION_FAILED", body: "GENERATION_FAILED" };
}
