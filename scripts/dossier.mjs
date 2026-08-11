#!/usr/bin/env node
/**
 * Build the dossier for ONE prospect and print it. No Google Sheets, no email
 * generation, no writes.
 *
 *   node scripts/dossier.mjs \
 *     --first=Andy --last=Thurling \
 *     --title="VP Airspace Innovation" \
 *     --company=DroneUp --website=droneup.com \
 *     --email=andy.thurling@droneup.com
 *
 *   node scripts/dossier.mjs --csv=leads.csv --limit=5 --out=dossiers.md
 *
 * WHY THIS EXISTS. The pipeline's expensive failure mode is not a bad email,
 * it is a confident email written from nothing, and you cannot see that in the
 * output: it reads fine. You can only see it in the research. This prints the
 * research, so a bad run is diagnosable in one prospect rather than in six
 * hundred rows and a Smartlead bounce report.
 *
 * Run it on five prospects from any new list before you process the list. If
 * the dossiers come back empty, the fix is in retrieval and nothing you do to
 * the prompt will help.
 */
import fs from "node:fs";
import { buildDossier, dossierMarkdown } from "../lib/dossier.js";
import { hasWebSearch, rawSearchProvider, hasOpenAI, RESEARCH_MODEL } from "../lib/search.js";

// Load .env / .env.local by hand: this runs outside Next, which is what loads
// them normally. Handles the multi-line quoted values a service-account key
// needs.
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, "utf8");
  const re = /^\s*([A-Z0-9_]+)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  let m;
  while ((m = re.exec(txt))) {
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
}

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=([\s\S]*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? "true" : m[2];
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

const ALIAS = {
  firstName: ["fname", "firstname", "first"],
  lastName: ["lname", "lastname", "last"],
  title: ["job_title", "jobtitle", "title", "designation", "role"],
  companyName: ["company", "companyname", "organization", "account"],
  email: ["email", "emailaddress", "workemail"],
  industry: ["industry", "sector", "vertical"],
  companyWebsite: ["website", "companywebsite", "domain", "url"]
};

function leadsFromCSV(path, limit) {
  const rows = parseCSV(fs.readFileSync(path, "utf8"));
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const out = [];
  for (const r of rows.slice(1, 1 + limit)) {
    const lead = {};
    for (const [canon, keys] of Object.entries(ALIAS)) {
      for (const k of keys) {
        const i = head.indexOf(k.replace(/[^a-z0-9]/g, ""));
        if (i !== -1 && r[i] && String(r[i]).trim()) { lead[canon] = String(r[i]).trim(); break; }
      }
    }
    if (!lead.companyWebsite && lead.email && lead.email.includes("@")) {
      lead.companyWebsite = lead.email.split("@")[1].toLowerCase();
    }
    if (lead.companyName) out.push(lead);
  }
  return out;
}

async function main() {
  if (!hasWebSearch()) {
    console.error("No search provider configured.");
    console.error("Set OPENAI_API_KEY (uses the Responses web_search tool) and optionally");
    console.error("TAVILY_API_KEY / SERPER_API_KEY / BRAVE_API_KEY for a cheaper raw-list provider.");
    process.exit(1);
  }
  console.error(`[search] openai=${hasOpenAI() ? RESEARCH_MODEL : "off"} raw=${rawSearchProvider() || "none"}`);

  const leads = args.csv
    ? leadsFromCSV(args.csv, parseInt(args.limit || "5", 10))
    : [{
      firstName: args.first || "",
      lastName: args.last || "",
      title: args.title || "",
      companyName: args.company || "",
      companyWebsite: args.website || (args.email && args.email.includes("@") ? args.email.split("@")[1] : ""),
      email: args.email || "",
      industry: args.industry || ""
    }];

  if (!leads.length || !leads[0].companyName) {
    console.error("Nothing to research. Pass --company=... or --csv=leads.csv");
    process.exit(1);
  }

  const chunks = [];
  for (const lead of leads) {
    console.error(`[dossier] ${lead.firstName} ${lead.lastName} @ ${lead.companyName} ...`);
    // No site scrape here: companyWebsiteIntel pulls in cheerio and this is a
    // retrieval test, not a full pipeline run. The dossier's own search
    // establishes what the company does anyway; passing the scrape only makes
    // its disambiguation slightly sharper.
    const t0 = Date.now();
    const d = await buildDossier(lead, { description: args.desc || "" }, null, {});
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!d) {
      chunks.push(`# ${lead.firstName} ${lead.lastName} — ${lead.companyName}\n\n**Dossier not built** (no search provider, or out of time).`);
    } else {
      chunks.push(dossierMarkdown(lead, d));
    }
    console.error(`[dossier] done in ${secs}s ${d && !d.empty ? "" : "(EMPTY — retrieval found nothing that survived sourcing)"}`);
  }

  const doc = chunks.join("\n\n---\n\n");
  if (args.out) {
    fs.writeFileSync(args.out, doc);
    console.error(`[dossier] written to ${args.out}`);
  } else {
    console.log(doc);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
