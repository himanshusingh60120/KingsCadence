import { NextResponse } from "next/server";
import { research, keepSourced, hostOf, RESEARCH_MODEL, hasOpenAI, rawSearchProvider } from "../../../lib/search";

/**
 * GET /api/doctor
 *
 * The same diagnostic as `npm run doctor`, reachable from a browser.
 *
 * WHY IT EXISTS. `scripts/doctor.mjs` needs a terminal and a local .env, which
 * is useless if you edit on GitHub and deploy on Vercel: the only environment
 * that has your real keys is the deployment itself. Debugging it from a
 * one-line error in a spreadsheet cell cost three runs, and that was avoidable.
 *
 * This makes ONE live search call inside the deployment and reports exactly
 * what came back:
 *   - which model answered (the ladder may not have used your first choice)
 *   - WHETHER THE WEB SEARCH TOOL ACTUALLY RAN. This is the single field that
 *     matters; every failure so far has come down to it.
 *   - what it searched for, and how many sources came back through each of
 *     the three evidence channels
 *   - a sourcing simulation, so you can see what would survive keepSourced()
 *
 * Usage:
 *   /api/doctor
 *   /api/doctor?company=ICR%20Integrity&website=icr-world.com
 *
 * SECRETS: the key is never returned, only a masked fingerprint (prefix and
 * length) so you can confirm WHICH key is deployed without exposing it. Set
 * DOCTOR_TOKEN in Vercel and pass ?token=... to lock the endpoint down.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function maskKey(k) {
  const key = String(k || "").trim();
  if (!key) return "(not set)";
  return `${key.slice(0, 7)}...${key.slice(-4)} (length ${key.length})`;
}

export async function GET(req) {
  const started = Date.now();
  const { searchParams } = new URL(req.url);

  const gate = (process.env.DOCTOR_TOKEN || "").trim();
  if (gate && searchParams.get("token") !== gate) {
    return NextResponse.json({ error: "bad or missing ?token" }, { status: 401 });
  }

  const company = (searchParams.get("company") || "DroneUp").trim();
  const website = (searchParams.get("website") || "").trim();

  const env = {
    OPENAI_API_KEY: maskKey(process.env.OPENAI_API_KEY),
    OPENAI_API_KEY_looks_valid: hasOpenAI(),
    RESEARCH_MODEL: process.env.RESEARCH_MODEL || `(not set, defaulting to ${RESEARCH_MODEL})`,
    CHAT_MODEL: process.env.CHAT_MODEL || "(not set, defaulting to gpt-4o-mini)",
    DOSSIER_NEWS_DAYS: process.env.DOSSIER_NEWS_DAYS || "(not set, defaulting to 120)",
    raw_search_provider: rawSearchProvider() || "(none, using OpenAI web search only)",
    maxDuration_of_this_route: maxDuration
  };

  if (!hasOpenAI()) {
    return NextResponse.json({
      verdict: "FAIL: no usable OPENAI_API_KEY in this deployment",
      whatToDo: "Set OPENAI_API_KEY in Vercel, tick Production AND Preview, then REDEPLOY. Environment variable changes do not reach an existing deployment until it is rebuilt.",
      env
    }, { status: 200 });
  }

  const r = await research(
    "You are a corporate-development analyst. You search the web and report only what you actually read.",
    `Find genuine, positive, recent corporate developments for the company "${company}"` +
    `${website ? ` (${website})` : ""} from the last 120 days. Today is ${new Date().toISOString().slice(0, 10)}. ` +
    `Report each with its publication date and the exact URL you read it on.`,
    { timeoutMs: 90000, contextSize: "medium" }
  );

  // Simulate the sourcing check the dossier applies, using the URLs the model
  // wrote in its own prose as candidate claims. If "survivingItems" is 0 while
  // "searched" is true, the evidence channels are the problem, not the search.
  const citationHosts = [...new Set(r.citations.map((c) => hostOf(c.url)).filter(Boolean))];
  const simulated = r.citations.slice(0, 5).map((c) => ({ url: c.url, date: "2026-01-01" }));
  const surviving = keepSourced(simulated, r.citations).length;

  const verdict = !r.ok
    ? `FAIL: the API call did not succeed`
    : !r.searched
      ? `FAIL: the model answered WITHOUT searching`
      : !r.citations.length
        ? `FAIL: search ran but produced no source URLs`
        : `PASS: search ran and returned ${r.citations.length} sources`;

  const whatToDo = !r.ok
    ? "Read `error` below: it is the API's own message. A 401 means the key is wrong or was not redeployed; a 404 or 'model not found' means RESEARCH_MODEL is not available to this key, so unset it and let the ladder choose."
    : !r.searched
      ? "The tool was offered and refused. Try setting RESEARCH_MODEL in Vercel to a current model with web search support, then redeploy and re-run this."
      : !r.citations.length
        ? "The search ran but nothing carried a URL. Check `prosePreview` below: if the prose has no links in it, the model ignored the inline-URL instruction."
        : "Retrieval is healthy. Reprocess the sheet.";

  return NextResponse.json({
    verdict,
    whatToDo,
    company,
    elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
    env,
    call: {
      modelThatAnswered: r.model,
      searchToolActuallyRan: r.searched,
      queriesIssued: r.queries,
      error: r.error
    },
    evidence: {
      totalSources: r.citations.length,
      distinctHosts: citationHosts,
      sampleUrls: r.citations.slice(0, 10).map((c) => c.url),
      sourcingSimulation: `${surviving}/${simulated.length} sample claims would survive keepSourced()`
    },
    // The raw prose, so a bad result can be READ rather than guessed at. This
    // is the thing that would have shown the problem three runs ago.
    prosePreview: String(r.text || "").slice(0, 2500),
    proseHasInlineUrls: /https?:\/\//.test(r.text || "")
  });
}
