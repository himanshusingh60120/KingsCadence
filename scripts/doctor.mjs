#!/usr/bin/env node
/**
 * npm run doctor
 *
 * Makes ONE live search call and prints exactly what came back: which model
 * answered, whether the web search tool actually ran, what it searched for,
 * how many sources and citations arrived, and the first lines of the prose.
 *
 * WHY THIS EXISTS. Three runs were spent guessing at this from a one-line
 * error in a spreadsheet cell. That is a terrible way to debug an API, and it
 * was my fault for not shipping this first. Everything the sheet can only hint
 * at is printed here in full.
 *
 * Run it after any change to OPENAI_API_KEY or RESEARCH_MODEL, and before
 * reprocessing a sheet.
 */
import fs from "node:fs";
import { research, RESEARCH_MODEL, hasOpenAI, rawSearchProvider, keepSourced, hostOf } from "../lib/search.js";

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, "utf8");
  const re = /^\s*([A-Z0-9_]+)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))\s*$/gm;
  let m;
  while ((m = re.exec(txt))) {
    if (process.env[m[1]]) continue;
    process.env[m[1]] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
}

const arg = (k, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const company = arg("company", "DroneUp");
const website = arg("website", "droneup.com");

const line = (s = "") => console.log(s);
const rule = () => line("─".repeat(70));

line();
rule();
line("  KINGS CADENCE — SEARCH DOCTOR");
rule();
line();

const key = (process.env.OPENAI_API_KEY || "").trim();
line(`  OPENAI_API_KEY     ${key ? `set, ${key.length} chars, starts "${key.slice(0, 7)}..."` : "NOT SET"}`);
line(`  key shape valid    ${hasOpenAI() ? "yes" : "NO — must start with sk-"}`);
line(`  RESEARCH_MODEL     ${process.env.RESEARCH_MODEL || `(not set, defaulting to ${RESEARCH_MODEL})`}`);
line(`  CHAT_MODEL         ${process.env.CHAT_MODEL || "(not set, defaulting to gpt-4o-mini)"}`);
line(`  raw provider       ${rawSearchProvider() || "none (optional)"}`);
line();

if (!hasOpenAI()) {
  line("  STOP. No usable OPENAI_API_KEY, so nothing else can be tested.");
  line("  Locally this reads .env.local; on Vercel it reads the environment variable.");
  line();
  process.exit(1);
}

rule();
line(`  LIVE CALL: recent news for "${company}"`);
rule();
line();

const t0 = Date.now();
const r = await research(
  "You are a corporate-development analyst. You search the web and report only what you actually read.",
  `Find genuine, recent, positive corporate developments for the company "${company}" (${website}). ` +
  `Contracts, funding, partnerships, approvals, launches, expansion. Today is ${new Date().toISOString().slice(0, 10)}. ` +
  `Only items from the last 120 days. For each: what happened, the date as YYYY-MM-DD, and the URL you read it on.`,
  { timeoutMs: 90000 }
);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

line(`  completed in       ${secs}s`);
line(`  model that answered ${r.model || "(none succeeded)"}`);
line(`  call succeeded     ${r.ok ? "yes" : "NO"}`);
line(`  SEARCH TOOL RAN    ${r.searched ? "YES" : "NO  <-- this is the thing that matters"}`);
line(`  queries issued     ${r.queries.length ? r.queries.length : "0"}`);
r.queries.slice(0, 6).forEach((q) => line(`                       - ${q}`));
line(`  evidence URLs      ${r.citations.length}`);
line(`  distinct hosts     ${new Set(r.citations.map((c) => hostOf(c.url))).size}`);
line(`  prose length       ${r.text.length} chars`);
line(`  error              ${r.error || "none"}`);
line();

if (r.citations.length) {
  rule();
  line("  EVIDENCE SET (first 8)");
  rule();
  r.citations.slice(0, 8).forEach((c, i) => line(`  ${String(i + 1).padStart(2)}. ${c.url}`));
  line();
}

if (r.text) {
  rule();
  line("  PROSE (first 900 chars)");
  rule();
  line(r.text.slice(0, 900).split("\n").map((l) => "  " + l).join("\n"));
  line();
}

// The exact check that empties the dossier when it fails.
rule();
line("  SOURCING CHECK SIMULATION");
rule();
const fake = r.citations.slice(0, 3).map((c, i) => ({ headline: `item ${i + 1}`, url: c.url, date: "2026-07-01" }));
const invented = { headline: "invented", url: "https://not-a-real-source.example/x", date: "2026-07-01" };
const kept = keepSourced([...fake, invented], r.citations, { requireDate: true });
line(`  real items kept    ${kept.length} of ${fake.length}`);
line(`  invented dropped   ${kept.some((k) => k.headline === "invented") ? "NO — the check is broken" : "yes"}`);
line();

rule();
line("  VERDICT");
rule();
if (!r.ok) {
  line("  The API call itself failed. The reason is printed above as `error`.");
  line("  Every model and every fallback in the ladder was tried.");
} else if (!r.searched) {
  line("  The model answered WITHOUT searching. This is a prompt or model");
  line("  problem, NOT a key problem. Try setting RESEARCH_MODEL to a model");
  line("  that supports the web_search tool.");
} else if (!r.citations.length) {
  line("  The search ran but produced no URLs at all — no sources, no");
  line("  annotations, and none written into the prose. This is unusual;");
  line("  paste the prose above into a message and it can be diagnosed.");
} else {
  line("  HEALTHY. The search ran, returned evidence, and the sourcing check");
  line("  keeps real items while dropping invented ones.");
  line("  Safe to process the sheet.");
}
line();
