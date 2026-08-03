#!/usr/bin/env node
/**
 * Dry-run the job-title gate over a CSV export of your list.
 * No network, no OpenAI, no Sheets. Free to run as many times as you like.
 *
 *   node scripts/jt-check.mjs leads.csv
 *   node scripts/jt-check.mjs leads.csv --out=triage.csv
 *
 * Reads any CSV with a title column (title / job_title / jobTitle /
 * designation / role / position). Optional department and level columns are
 * used when present. Prints the pass rate plus the top rejection reasons, so
 * you can see what the gate is throwing away BEFORE it runs on the sheet.
 *
 * Run this on a sample of every new list. A pass rate far outside 30-60% is
 * usually a list problem, not a gate problem: below that the vendor sold you
 * junior contacts, above it the filters were probably too loose upstream.
 */
import fs from "node:fs";
import { jobTitleGate } from "../lib/titles.js";

// Minimal RFC-4180-ish parser: handles quoted fields and embedded commas.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const nkey = (s) => String(s || "").toLowerCase().replace(/[\s._-]+/g, "");
const pick = (obj, aliases) => {
  for (const a of aliases) {
    const v = obj[nkey(a)];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
};

const file = process.argv[2];
const outArg = process.argv.find((a) => a.startsWith("--out="));
if (!file) {
  console.error("usage: node scripts/jt-check.mjs <leads.csv> [--out=triage.csv]");
  process.exit(1);
}

const rows = parseCSV(fs.readFileSync(file, "utf8"));
const headers = rows[0].map((h) => nkey(h));
const leads = rows.slice(1).map((r) => {
  const o = {};
  headers.forEach((h, i) => { o[h] = r[i] || ""; });
  return {
    title: pick(o, ["title", "jobtitle", "job_title", "designation", "role", "position"]),
    department: pick(o, ["department", "dept", "function"]),
    level: pick(o, ["level", "seniority", "joblevel"]),
    company: pick(o, ["company", "companyname", "organization", "account"]),
    email: pick(o, ["email", "emailaddress", "workemail"])
  };
});

let pass = 0;
const reasons = new Map();
const matched = new Map();
const out = [["email", "company", "title", "verdict", "why", "seniority"]];

for (const l of leads) {
  const g = jobTitleGate(l);
  if (g.inJT) {
    pass++;
    matched.set(g.matched, (matched.get(g.matched) || 0) + 1);
  } else {
    // Group reasons by their shape, not the specific title, so the tally is readable.
    const key = g.reason.replace(/\(.*\)/, "").trim();
    reasons.set(key, (reasons.get(key) || 0) + 1);
  }
  out.push([l.email, l.company, l.title, g.inJT ? "READY" : "Not present in JT", g.matched || g.reason, g.rankLabel]);
}

const n = leads.length || 1;
console.log(`\n  ${leads.length} rows`);
console.log(`  IN  bracket : ${pass} (${((pass / n) * 100).toFixed(1)}%)`);
console.log(`  OUT bracket : ${leads.length - pass} (${(((leads.length - pass) / n) * 100).toFixed(1)}%)\n`);

const top = (m, label) => {
  if (!m.size) return;
  console.log(`  ${label}`);
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`));
  console.log("");
};
top(matched, "Passed as:");
top(reasons, "Rejected because:");

if (outArg) {
  const path = outArg.split("=")[1];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  fs.writeFileSync(path, out.map((r) => r.map(esc).join(",")).join("\n"));
  console.log(`  wrote ${path}\n`);
}
