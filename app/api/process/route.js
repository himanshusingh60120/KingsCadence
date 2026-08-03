import { NextResponse } from "next/server";
import { readSheet, writeRowCells, appendRows, readTabSafe, ensureTab } from "../../../lib/google";
import { companyWebsiteIntel, newsSignals, classifyEvents, deriveCompetitors } from "../../../lib/research";
import { generateEmail, reviewStatus, sortEvents } from "../../../lib/engine";
import { resolveTimezone } from "../../../lib/timezone";
import { jobTitleGate, isUnparseableTitle, NOT_IN_JT, NEEDS_ENRICHMENT } from "../../../lib/titles";
import { parseInsights, matchInsight, INSIGHTS_HEADER } from "../../../lib/insights";

// The Insight Library is read once per warm instance, not once per row: it is
// the same 40-60 findings for every prospect in a run.
const INSIGHTS_TTL_MS = 10 * 60 * 1000;
async function loadInsights(spreadsheetId) {
  const cache = globalThis.__kc_insights || (globalThis.__kc_insights = new Map());
  const hit = cache.get(spreadsheetId);
  if (hit && Date.now() - hit.at < INSIGHTS_TTL_MS) return hit.value;
  let rows = await readTabSafe(spreadsheetId, "Insights");
  if (!rows.length) {
    // First run on a sheet: create the tab with its header row so the shape
    // of a finding is obvious without reading the docs.
    try { await ensureTab(spreadsheetId, "Insights", INSIGHTS_HEADER); } catch { /* non-fatal */ }
    rows = await readTabSafe(spreadsheetId, "Insights");
  }
  const value = parseInsights(rows);
  cache.set(spreadsheetId, { value, at: Date.now() });
  return value;
}

export const maxDuration = 60;

// Per-instance cache: on Vercel a warm serverless instance is often reused
// across consecutive invocations (e.g. a bulk run processing many rows back
// to back). Multiple contacts at the SAME company should not re-scrape the
// site or re-run the same news queries. Keyed by domain (falls back to
// company name); a fresh cold instance simply starts empty, this is a
// best-effort speed/cost win, not a correctness dependency.
const researchCache = globalThis.__kc_researchCache || (globalThis.__kc_researchCache = new Map());
const RESEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h: long enough to cover a bulk run, short enough to stay fresh

async function getCachedResearch(cacheKey, fn) {
  const hit = researchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RESEARCH_CACHE_TTL_MS) return hit.value;
  const value = await fn();
  researchCache.set(cacheKey, { value, at: Date.now() });
  return value;
}

// Competitors for a prospect: the sheet's own `Competitors` column wins (a
// human named them); otherwise the model derives up to 5 real, named rivals
// from the scraped site description. Derived names are search seeds and
// prospecting suggestions only, never stated as fact inside an email.
function sheetCompetitors(lead) {
  return String(lead.competitors || "")
    .split(/[,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, why: "" }));
}

async function research(lead) {
  const cacheKey = (lead.companyWebsite || lead.companyName || "").toLowerCase().trim();
  const run = async () => {
    const companyIntel = await companyWebsiteIntel(lead.companyWebsite);
    let competitors = sheetCompetitors(lead);
    if (!competitors.length) {
      competitors = await deriveCompetitors(lead.companyName, lead.industry, companyIntel.description);
    }
    const news = await newsSignals(lead.companyName, lead.industry, {
      domain: lead.companyWebsite,
      headCount: lead.companyHeadCount,
      revenue: lead.companyRevenue,
      subIndustry: lead.subIndustry,
      competitors
    });
    return [companyIntel, news, competitors];
  };
  const [companyIntel, news, competitors] = cacheKey ? await getCachedResearch(cacheKey, run) : await run();
  return { companyIntel, news, competitors };
}

export async function POST(req) {
  try {
    const { spreadsheetId, sheetName, rowNumber, force } = await req.json();

    const { headers, rows } = await readSheet(spreadsheetId, sheetName);
    const headerIndex = {};
    headers.forEach((h, i) => { headerIndex[h] = i + 1; });
    const lead = rows.find((r) => r.__rowNumber === rowNumber);
    if (!lead) return NextResponse.json({ error: `Row ${rowNumber} not found` }, { status: 404 });

    const status = (lead.Status || "").toLowerCase();
    if (["replied", "dnc", "do not contact", "paused", "bounced"].includes(status)) {
      return NextResponse.json({ skipped: true, reason: status });
    }

    // ── JOB TITLE GATE ───────────────────────────────────────────────────
    // Runs BEFORE anything that costs money. An out-of-bracket row never
    // scrapes a website, never queries Google News, and never touches the
    // OpenAI API: it is stamped "Not present in JT" and the row is done.
    // On a typical purchased list this drops 40-60% of rows, so it is also
    // the single biggest cost saving in the pipeline.
    const jt = jobTitleGate(lead);
    if (!jt.inJT) {
      // Two different failures, two different statuses. A Marketing Manager is
      // correctly out of scope and dead. "Airspace Innovation" is a senior
      // person whose title column holds a team name, and is recoverable with
      // one enrichment pass, so it must not be binned with the first kind.
      const enrichable = isUnparseableTitle(lead);
      await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, {
        "Status": enrichable ? NEEDS_ENRICHMENT : NOT_IN_JT,
        "Signal": enrichable
          ? `title field is not a title ("${lead.title}"), re-enrich from LinkedIn`
          : `JT filter: ${jt.reason}`
      });
      return NextResponse.json({
        ok: true, notInJT: true, enrichable, reason: jt.reason,
        title: lead.title || "", seniority: jt.rankLabel, results: []
      });
    }

    // Country -> Timezone (state refines US/Canada/Australia). Independent of
    // email generation: fills even on rows whose emails are already done.
    const timezone = resolveTimezone(lead.country, lead.state);
    if (timezone && (force || !lead["Timezone"])) {
      await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, {
        "Timezone": timezone
      });
    }

    if (!force && lead["E1 Subject"] && lead["E4 Body"]) {
      return NextResponse.json({ skipped: true, reason: "already filled", timezone });
    }
    if (!(lead.email || "").includes("@")) {
      return NextResponse.json({ skipped: true, reason: "no email" });
    }

    // 1) SCREENING: live company research (its website + fresh news covering
    //    M&A, capacity, closures, launches, partnerships, regulation, ...).
    let { companyIntel, news, competitors } = await research(lead);

    // If the company column was a bare domain (or empty), recover the real
    // company name by crawling the site, then re-run the news search with the
    // real name so the row gets proper signal instead of being skipped.
    const looksDomain = (c) => !!c && !c.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c);
    let companyNameFixed = false;
    if ((!lead.companyName || looksDomain(lead.companyName)) && companyIntel.companyName) {
      lead.companyName = companyIntel.companyName;
      companyNameFixed = true;
      news = await newsSignals(lead.companyName, lead.industry, {
        domain: lead.companyWebsite,
        headCount: lead.companyHeadCount,
        revenue: lead.companyRevenue,
        subIndustry: lead.subIndustry,
        competitors
      });
    }

    // 2) EVENT TYPING: GPT turns noisy headlines into real, typed events, each
    //    with the strategic "angle" it raises, and drops third-party industry
    //    news that has no bearing on what THIS company actually does (judged
    //    against the scraped site description). [] => sector-level fallback.
    const rawEvents = await classifyEvents(lead.companyName, lead.industry, news, companyIntel.description);

    // ── ANCHOR ORDER, ENFORCED IN CODE ───────────────────────────────────
    // Competitor and market events sort to the front. The prompt already said
    // to lead on them, but models anchor on whatever sits at position 1, so a
    // row with a live market event could still open on the prospect's own
    // product launch. Sorting removes the choice.
    const events = sortEvents(rawEvents);

    // ── THE GIVE ─────────────────────────────────────────────────────────
    // A matched proprietary finding outranks every news event, and works on
    // the majority of rows that have no news at all. This is the difference
    // between "here is your own website back" and "here is a number you
    // cannot get anywhere else".
    const library = await loadInsights(spreadsheetId);
    const insight = matchInsight(lead, companyIntel, library);

    // What this row anchored on (written to the sheet for visibility).
    const signal = insight
      ? `finding: ${insight.finding}`.slice(0, 240)
      : events.length
        ? `${events[0].subject}/${events[0].type}: ${events[0].what}`.slice(0, 240)
        : "NO GIVE (no finding matched, no event found)";

    // Decide if this row is safe to auto-send or should be held for a human.
    const review = reviewStatus(lead, events, insight);
    const cells = { "Signal": signal };
    // Surface the recovered real company name back in the sheet's company column.
    if (companyNameFixed) cells["company"] = lead.companyName;

    // Broken company data (a bare domain / empty) would risk a hallucinated
    // company name (e.g. "Morson Praxis"), so skip generation and flag it.
    if (review.skipGeneration) {
      cells["Status"] = `Needs review: ${review.reason}`;
      await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, cells);
      return NextResponse.json({
        ok: true, timezone, signal, held: review.reason,
        eventsUsed: events.length, newsUsed: news.items.length, results: []
      });
    }

    // 3) Generate E1-E4 sequentially, give-first with no meeting-ask. E1 leads
    //    on a supplied insight, else an outside angle on the event, else the
    //    company's own business. E3 is a genuine give, not a fabricated peer.
    const results = [];
    const usedSubjects = [];
    const usedCTAs = [];
    const qualityIssues = [];
    const lastLine = (b) => {
      const ls = (b || "").split("\n").map((l) => l.trim()).filter(Boolean);
      return ls.length ? ls[ls.length - 1].toLowerCase() : "";
    };
    // ONE subject (E1 only). E2-E4 send as replies on the same Smartlead
    // thread and inherit it as "Re: ...", so the sheet carries E1 Subject
    // plus four bodies. Column map: I=E1 Subject, J:M=E1-E4 Body, N=Status.
    for (let step = 1; step <= 4; step++) {
      const bcKey = `E${step} Body`;
      const scKey = step === 1 ? "E1 Subject" : null;
      const alreadyDone = scKey ? (lead[scKey] && lead[bcKey]) : lead[bcKey];
      if (!force && alreadyDone) {
        const c = lastLine(lead[bcKey]);
        if (c) usedCTAs.push(c);
        results.push({ step, skipped: true });
        continue;
      }
      const out = await generateEmail(step, lead, companyIntel, news, events, usedSubjects, usedCTAs, insight);
      if (out.quality && out.quality !== "ok") qualityIssues.push(`E${step}: ${out.quality}`);
      if (out.body !== "GENERATION_FAILED") {
        if (scKey && out.subject) {
          cells[scKey] = out.subject;
          usedSubjects.push(out.subject);
        }
        cells[bcKey] = out.body;
        const c = lastLine(out.body);
        if (c) usedCTAs.push(c);
        results.push({ step, subject: out.subject || "(thread reply)" });
      } else {
        results.push({ step, failed: true });
      }
    }
    const anyEmail = results.some((r) => r.subject && !r.failed);
    // Only rows with a real signal AND clean data are auto-marked Ready; a
    // no-signal draft is generated but flagged so a person decides before send.
    if (anyEmail) {
      // Copy that could not be repaired to pass the banned-phrase, length,
      // pitch-shape and mirror guards is held even when the targeting was
      // fine. A held row costs nothing; a shipped row that reads as AI costs
      // the sending domain.
      if (qualityIssues.length) {
        cells["Status"] = `Needs review: ${qualityIssues[0]}`.slice(0, 240);
      } else {
        cells["Status"] = review.ready ? "Ready" : `Needs review: ${review.reason}`;
      }
    }

    await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, cells);

    // ── DERIVED TARGETS ──────────────────────────────────────────────────
    // A real event at THIS prospect is also a ready-made outreach signal for
    // its competitors: they will care more about how a rival's move hits
    // their market and share than the rival itself does. Each strong event
    // about the prospect (subject "self") fans out to its named competitors
    // as new prospecting rows on a "Derived Targets" tab, deduped per run.
    let derivedTargets = 0;
    try {
      const selfEvent = events.find((e) => e.subject === "self" && e.scope === "company");
      if (selfEvent && competitors && competitors.length) {
        const seen = globalThis.__kc_derivedSeen || (globalThis.__kc_derivedSeen = new Set());
        const rowsOut = [];
        for (const c of competitors.slice(0, 5)) {
          const key = `${c.name}::${selfEvent.what}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          rowsOut.push([
            c.name,
            c.why || "",
            lead.companyName,
            `${selfEvent.type}: ${selfEvent.what}`,
            selfEvent.angle || "",
            sheetName,
            String(rowNumber),
            new Date().toISOString().slice(0, 10)
          ]);
        }
        if (rowsOut.length) {
          await appendRows(spreadsheetId, "Derived Targets", [
            "Target Company", "Why they compete", "Event Source Company",
            "Event (their signal)", "Angle for the target", "Source Tab", "Source Row", "Added"
          ], rowsOut);
          derivedTargets = rowsOut.length;
        }
      }
    } catch { /* prospect row already written; derived targets are best-effort */ }

    return NextResponse.json({
      ok: true,
      timezone,
      signal,
      eventsUsed: events.length,
      newsUsed: news.items.length,
      derivedTargets,
      results
    });
  } catch (e) {
    // A thrown error used to return 500 without writing anything, leaving the
    // row blank: not Ready, not rejected, just invisible. Every row now ends
    // with a Status, so nothing can silently disappear from a bulk run.
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body && body.spreadsheetId && body.sheetName && body.rowNumber) {
        const { headers } = await readSheet(body.spreadsheetId, body.sheetName);
        const hi = {};
        headers.forEach((h, i) => { hi[h] = i + 1; });
        await writeRowCells(body.spreadsheetId, body.sheetName, body.rowNumber, hi, {
          "Status": `Error: ${String(e.message || e).slice(0, 180)}`
        });
      }
    } catch { /* the original error is what matters */ }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
