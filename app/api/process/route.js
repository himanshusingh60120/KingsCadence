import { NextResponse } from "next/server";
import { readSheet, writeRowCells, appendRows, readTabSafe, ensureTab } from "../../../lib/google";
import { companyWebsiteIntel, newsSignalsWithFallback, classifyEvents, deriveMarketContext, quarterWindowDays } from "../../../lib/research";
import { generateEmail, reviewStatus, sortEvents } from "../../../lib/engine";
import { resolveTimezone } from "../../../lib/timezone";
import { isUnparseableTitle, NOT_IN_JT, NEEDS_ENRICHMENT } from "../../../lib/titles";
import { judgeRelevance, meetsReadyBar } from "../../../lib/relevance";
import { parseInsights, matchInsight, INSIGHTS_HEADER } from "../../../lib/insights";
import { engagementThesis } from "../../../lib/thesis";
import { buildDossier, dossierMarkdown, dossierSignal } from "../../../lib/dossier";
import { hasWebSearch } from "../../../lib/search";

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

export const maxDuration = 300; // was 60; a full row exceeded it (see README)

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

/**
 * ORDERING MATTERS AND IT WAS WRONG.
 *
 * research() read `lead.__thesis` for its watch queries, but the thesis was
 * not built until 100 lines later in POST. Those queries were therefore ALWAYS
 * empty and the thesis never influenced the news search at all.
 *
 * The correct order, which is also the cheapest:
 *
 *   1. scrape          once, cached per company
 *   2. relevance gate  cheap, and rejects ~40% of rows before any spend
 *   3. marketCtx + thesis   IN PARALLEL: both depend only on the scrape
 *   4. news            needs the queries from both of the above
 *
 * Steps 3's two calls used to run sequentially at opposite ends of the
 * function. Running them together removes roughly 8-12 seconds per row, which
 * matters because a full row was hitting the 60s function ceiling and
 * returning Vercel's HTML error page to a client that expected JSON.
 */
async function scrapeIntel(lead) {
  const cacheKey = (lead.companyWebsite || lead.companyName || "").toLowerCase().trim();
  const run = () => companyWebsiteIntel(lead.companyWebsite);
  return cacheKey ? getCachedResearch(`intel:${cacheKey}`, run) : run();
}

async function gatherNews(lead, marketCtx, thesis, competitors) {
  const cacheKey = (lead.companyWebsite || lead.companyName || "").toLowerCase().trim();
  const run = () => newsSignalsWithFallback(lead.companyName, lead.industry, {
    domain: lead.companyWebsite,
    headCount: lead.companyHeadCount,
    revenue: lead.companyRevenue,
    subIndustry: lead.subIndustry,
    competitors,
    domainQueries: marketCtx.domainQueries,
    // Now actually populated: the thesis is built before this runs.
    watchQueries: (thesis && thesis.watchQueries) || []
  });
  return cacheKey ? getCachedResearch(`news:${cacheKey}`, run) : run();
}

export async function POST(req) {
  // Captured OUTSIDE the try so the catch can still write a Status. The old
  // code called req.clone().json() in the catch, which throws because the
  // body stream was already consumed by req.json() here, so the catch failed
  // silently and the row was left completely blank: no emails, no status, no
  // error. Three rows vanished that way in the last run.
  // Wall clock for this invocation. Generation checks it so a row finishes and
  // writes a Status instead of being killed mid-flight, which leaves the sheet
  // row blank and tells the operator nothing.
  const deadline = Date.now() + (maxDuration - 25) * 1000;

  let reqBody = {};
  try {
    reqBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  try {
    const { spreadsheetId, sheetName, rowNumber, force } = reqBody;

    const { headers, rows } = await readSheet(spreadsheetId, sheetName);
    const headerIndex = {};
    headers.forEach((h, i) => { headerIndex[h] = i + 1; });
    const lead = rows.find((r) => r.__rowNumber === rowNumber);
    if (!lead) return NextResponse.json({ error: `Row ${rowNumber} not found` }, { status: 404 });

    const status = (lead.Status || "").toLowerCase();
    if (["replied", "dnc", "do not contact", "paused", "bounced"].includes(status)) {
      return NextResponse.json({ skipped: true, reason: status });
    }

    // ── RELEVANCE (part 1 of 2): obvious rejects only ────────────────────
    // The full judgment needs to know what the company DOES, which requires
    // the site scrape, so it runs after research. Only titles that are never
    // buyers at any company are rejected here, for free, before any spend.
    // Everything else, including vague and mislabelled titles, goes through.

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

    // ── 1) SCRAPE ────────────────────────────────────────────────────────
    const companyIntel = await scrapeIntel(lead);

    // Recover a real company name if the column held a bare domain, BEFORE
    // anything downstream uses it. Previously this ran after the news search
    // and forced a second full search.
    const looksDomain = (c) => !!c && !c.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c);
    let companyNameFixed = false;
    if ((!lead.companyName || looksDomain(lead.companyName)) && companyIntel.companyName) {
      lead.companyName = companyIntel.companyName;
      companyNameFixed = true;
    }

    // ── 2) RELEVANCE GATE ────────────────────────────────────────────────
    // Runs BEFORE the two expensive derivation calls and before the news
    // search. It rejects roughly 40% of a purchased list, and every one of
    // those rows now costs one small call instead of four large ones.
    //
    // The question is the one an SDR asks: would this person, at THIS
    // company, buy or champion market intelligence? The company half of that
    // matters more than the title half.
    const rel = await judgeRelevance(lead, companyIntel);
    // The seat bar is part of the bracket decision, not a separate gate later
    // on: a seat that would not buy and cannot influence the buyer is simply
    // not in the target bracket, and should cost nothing to establish.
    if (rel.relevant && !meetsReadyBar(rel)) {
      rel.relevant = false;
      rel.reason = `seat unlikely to buy (${rel.buyLikelihood || 0}%, no decision influence)`;
    }
    if (!rel.relevant) {
      const enrichable = isUnparseableTitle(lead);
      await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, {
        "Status": enrichable ? NEEDS_ENRICHMENT : NOT_IN_JT,
        "Signal": enrichable
          ? `title field is not a title ("${lead.title}"), re-enrich from LinkedIn`
          : `not relevant: ${rel.reason}`
      });
      return NextResponse.json({
        ok: true, notRelevant: true, verdict: rel.verdict,
        reason: rel.reason, source: rel.source, results: []
      });
    }

    // ── 3) MARKET CONTEXT + ENGAGEMENT THESIS, IN PARALLEL ───────────────
    // Both depend only on the scrape, and they used to run sequentially at
    // opposite ends of this function. Together they are the difference
    // between finishing inside the function limit and returning an HTML
    // error page to a client expecting JSON.
    const [marketCtx, thesis] = await Promise.all([
      deriveMarketContext(lead.companyName, lead.industry, companyIntel.description),
      engagementThesis(lead, companyIntel)
    ]);

    let competitors = sheetCompetitors(lead);
    if (!competitors.length) competitors = marketCtx.competitors;

    lead.__profile = marketCtx;
    if (thesis) {
      lead.__thesis = thesis;
      lead.__profile = {
        ...marketCtx,
        segments: thesis.segments.length ? thesis.segments : marketCtx.segments,
        rivals: thesis.rivals.length ? thesis.rivals : marketCtx.rivals
      };
    }

    // ── 4) NEWS + DOSSIER, IN PARALLEL ───────────────────────────────────
    // These are two independent retrieval paths over the same question and
    // they run together because neither depends on the other.
    //
    // The dossier is the primary path: real search, citations, a sourcing
    // check on every claim. Google News RSS is retained as the secondary,
    // because it is free and occasionally surfaces a local or trade item the
    // search misses. Where they disagree, the dossier wins, because only its
    // items were verified against the page they came from.
    //
    // Running them together costs nothing in wall clock and means a dossier
    // failure (no key, rate limit, timeout) degrades exactly to today's
    // behaviour rather than to an empty row.
    const [news, dossier] = await Promise.all([
      gatherNews(lead, marketCtx, thesis, competitors),
      buildDossier(lead, companyIntel, thesis, { deadline })
    ]);
    // The window the news filter actually used, so the date guard knows what
    // could legitimately have come back.
    lead.__maxAgeDays = quarterWindowDays();

    // 2) EVENT TYPING: GPT turns noisy headlines into real, typed events, each
    //    with the strategic "angle" it raises, and drops third-party industry
    //    news that has no bearing on what THIS company actually does (judged
    //    against the scraped site description). [] => sector-level fallback.
    const rawEvents = await classifyEvents(lead.companyName, lead.industry, news, companyIntel.description, competitors, marketCtx);

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
    //
    // The old "NO GIVE (no finding matched, no event found)" was accurate and
    // useless: it named the absence without saying whether the research had
    // run and found nothing, or never ran at all. Those need different fixes.
    const dSignal = dossierSignal(dossier);
    const signal = insight
      ? `finding: ${insight.finding}`.slice(0, 240)
      : dossier && !dossier.empty && dossier.hooks.length
        ? `hook: ${dossier.hooks[0].hook}`.slice(0, 240)
        : events.length
          ? `${events[0].subject}/${events[0].type}: ${events[0].what}`.slice(0, 240)
          : hasWebSearch()
            ? "NO GIVE (search ran, nothing survived sourcing)"
            : "NO GIVE (no search provider configured, RSS only)";

    // Decide if this row is safe to auto-send or should be held for a human.
    const review = reviewStatus(lead, events, insight, dossier);
    const cells = { "Signal": `[${rel.verdict} ${rel.buyLikelihood || 0}%${rel.decisionInfluence ? " decider" : ""}] ${signal}${dSignal ? ` | ${dSignal}` : ""}`.slice(0, 250) };

    // The research, in the sheet. A Google Sheets cell holds 50k characters,
    // so the full dossier fits comfortably; it is truncated well short of
    // that only to keep the tab responsive to scroll.
    if (dossier) {
      cells["Dossier"] = dossierMarkdown(lead, dossier).slice(0, 45000);
      cells["Hooks"] = (dossier.hooks || [])
        .map((h, i) => `${i + 1}. [${h.strength}] ${h.hook}\n   evidence: ${h.evidence}`)
        .join("\n") || "(none)";
    }
    // Surface the recovered real company name back in the sheet's company column.
    if (companyNameFixed) cells["company"] = lead.companyName;

    // Broken company data (a bare domain / empty) would risk a hallucinated
    // company name (e.g. "Morson Praxis"), so skip generation and flag it.
    if (review.skipGeneration) {
      cells["Status"] = `Needs data: ${review.reason}`;
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
    const earlierBodies = [];
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
        earlierBodies.push(lead[bcKey]);
        const c = lastLine(lead[bcKey]);
        if (c) usedCTAs.push(c);
        results.push({ step, skipped: true });
        continue;
      }
      if (Date.now() > deadline - 15000) {
        results.push({ step, failed: true, reason: "out of time" });
        continue;
      }
      const out = await generateEmail(step, lead, companyIntel, news, events, usedSubjects, usedCTAs, insight, earlierBodies, (dossier && dossier.domain && dossier.domain.buyers) || (thesis ? thesis.whoPaysThem : marketCtx.buyerWorld), thesis, deadline, dossier);
      if (out.quality && out.quality !== "ok") qualityIssues.push(`E${step}: ${out.quality}`);
      if (out.body !== "GENERATION_FAILED") {
        if (scKey && out.subject) {
          cells[scKey] = out.subject;
          usedSubjects.push(out.subject);
        }
        cells[bcKey] = out.body;
        earlierBodies.push(out.body);
        const c = lastLine(out.body);
        if (c) usedCTAs.push(c);
        results.push({ step, subject: out.subject || "(thread reply)" });
      } else {
        results.push({ step, failed: true });
      }
    }
    const anyEmail = results.some((r) => r.subject && !r.failed);
    if (anyEmail) {
      // ── STATUS ───────────────────────────────────────────────────────
      // ONE thing decides Ready: does this person belong in the target
      // bracket. Nothing else holds a row.
      //
      // Copy quality used to block sends, and the result was a status column
      // that read "Needs review" on nearly every row. An operator facing that
      // stops reading the reasons and bulk-approves, so the guard protected
      // nothing and cost every send. Quality findings now go to Signal, where
      // they stay visible and can be reviewed in bulk without gating anything.
      //
      // The seat bar (80% buy likelihood, or decision influence) is applied
      // where it belongs: it decides JT membership, not send-readiness. A seat
      // below it is written "Not present in JT" and never gets emails at all.
      // Style findings go to Signal and never block. INVENTED FACTS are the
      // one exception, and they are not a style finding: a figure the reader
      // can check and find false destroys the firm's credibility with that
      // person permanently. Better to send nothing on that row.
      const fabricated = qualityIssues.filter((q) => /appear nowhere in the research|placeholder|outside the current window|no research behind them|were invented/i.test(q));
      if (qualityIssues.length && !fabricated.length) {
        cells["Signal"] = `${cells["Signal"]} | copy: ${qualityIssues[0].replace(/^E(\d): (unfixable: )?/, "E$1 ")}`.slice(0, 250);
      }
      if (fabricated.length) {
        cells["Status"] = `Do not send: ${fabricated[0]}`.slice(0, 240);
        await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, cells);
        return NextResponse.json({ ok: true, timezone, signal, blocked: fabricated[0], results });
      }
      if (!review.ready && review.reason) {
        // Still recorded, still not blocking: an email with no outside view is
        // weaker, but it is a judgement call for the operator, not a veto.
        cells["Signal"] = `${cells["Signal"]} | ${review.reason}`.slice(0, 250);
      }
      cells["Status"] = "Ready";
    }

    if (!anyEmail) {
      // Nothing was written, so there is nothing to send. This is a failure,
      // not a quality judgement, and the reason belongs in Status because the
      // row needs re-running rather than reviewing.
      const why = (results.find((r) => r.reason) || {}).reason || "generation failed";
      cells["Status"] = `Retry: ${why}`.slice(0, 240);
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
      // Verified rivals first. A derived target that has been out of business
      // for two years is worse than no derived target: it goes into a list a
      // human then works.
      const fanout = (dossier && dossier.domain && dossier.domain.competitors.length)
        ? dossier.domain.competitors
        : competitors;
      if (selfEvent && fanout && fanout.length) {
        const seen = globalThis.__kc_derivedSeen || (globalThis.__kc_derivedSeen = new Set());
        const rowsOut = [];
        for (const c of fanout.slice(0, 5)) {
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
      dossier: dossier ? {
        empty: !!dossier.empty,
        news: (dossier.news || []).length,
        marketMoves: dossier.domain ? dossier.domain.domainMoves.length : 0,
        competitors: dossier.domain ? dossier.domain.competitors.length : 0,
        personConfirmed: !!dossier.person,
        hooks: (dossier.hooks || []).length
      } : null,
      derivedTargets,
      results
    });
  } catch (e) {
    // A thrown error used to return 500 without writing anything, leaving the
    // row blank: not Ready, not rejected, just invisible. Every row now ends
    // with a Status, so nothing can silently disappear from a bulk run.
    try {
      if (reqBody && reqBody.spreadsheetId && reqBody.sheetName && reqBody.rowNumber) {
        const { headers } = await readSheet(reqBody.spreadsheetId, reqBody.sheetName);
        const hi = {};
        headers.forEach((h, i) => { hi[h] = i + 1; });
        await writeRowCells(reqBody.spreadsheetId, reqBody.sheetName, reqBody.rowNumber, hi, {
          "Status": `Error: ${String(e.message || e).slice(0, 180)}`
        });
      }
    } catch { /* the original error is what matters */ }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
