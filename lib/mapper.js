import fs from "fs";
import path from "path";
import { embed, cosine, chatJSON } from "./ai";

let _catalog = null;

export function loadCatalog() {
  if (_catalog) return _catalog;
  const p = path.join(process.cwd(), "data", "catalog.json");
  _catalog = JSON.parse(fs.readFileSync(p, "utf8"));
  return _catalog; // [{ title, url, vector }]
}

/**
 * 90% weight: what the COMPANY does (industry, sub-industry, website intel).
 * 10% weight: the prospect's role.
 * Shortlist by weighted cosine, then GPT re-ranks the top 25 and writes the
 * relevance bridge that the email engine uses as its hook.
 */
export async function mapProspectToReport(lead, companyIntel) {
  const catalog = loadCatalog();

  const companyText = [
    lead.industry, lead.subIndustry, lead.companyName,
    companyIntel.description, companyIntel.keywords
  ].filter(Boolean).join(". ");

  const roleText = [lead.title, lead.department, lead.level].filter(Boolean).join(". ");

  const [cVec, rVec] = await embed([companyText || "general business", roleText || "executive"]);

  const scored = catalog
    .map((r) => ({ ...r, score: 0.9 * cosine(cVec, r.vector) + 0.1 * cosine(rVec, r.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  const list = scored.map((r, i) => `${i + 1}. ${r.title}`).join("\n");

  const system = `You match B2B prospects to market research reports for Kings Research, an advisory firm.
WEIGHTING RULE (strict): 90% of your judgment must come from the COMPANY'S DOMAIN OF WORK (its industry, what it sells, its markets). Only 10% from the person's job title. Pick the report a strategy consultant would bring to a first meeting with THIS COMPANY.
Return ONLY JSON: {"index": <1-25>, "reason": "<one sentence: why this market directly touches this company's revenue, cost, risk or roadmap, written as a business tension, not a compliment>"}`;

  const user = `COMPANY: ${lead.companyName} (${lead.companyWebsite || "no site"})
INDUSTRY: ${lead.industry || "?"} / ${lead.subIndustry || "-"}
WHAT THE COMPANY DOES (from its website): ${companyIntel.description || "unknown"}
RECENT NEWS SIGNALS: ${companyIntel.newsSummary || "none found"}
PROSPECT ROLE (10% weight only): ${lead.title || "?"} in ${lead.department || "?"}

CANDIDATE REPORTS:
${list}`;

  const pick = await chatJSON(system, user, { temperature: 0.2, maxTokens: 300 });
  const idx = Math.min(Math.max(parseInt(pick.index, 10) || 1, 1), scored.length) - 1;
  return { title: scored[idx].title, url: scored[idx].url, reason: pick.reason || "" };
}
