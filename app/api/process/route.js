import { NextResponse } from "next/server";
import { readSheet, writeRowCells } from "../../../lib/google";
import { companyWebsiteIntel, newsSignals, classifyEvents } from "../../../lib/research";
import { generateEmail, reviewStatus } from "../../../lib/engine";
import { resolveTimezone } from "../../../lib/timezone";

export const maxDuration = 60;

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
    let [companyIntel, news] = await Promise.all([
      companyWebsiteIntel(lead.companyWebsite),
      newsSignals(lead.companyName, lead.industry)
    ]);

    // If the company column was a bare domain (or empty), recover the real
    // company name by crawling the site, then re-run the news search with the
    // real name so the row gets proper signal instead of being skipped.
    const looksDomain = (c) => !!c && !c.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(c);
    let companyNameFixed = false;
    if ((!lead.companyName || looksDomain(lead.companyName)) && companyIntel.companyName) {
      lead.companyName = companyIntel.companyName;
      companyNameFixed = true;
      news = await newsSignals(lead.companyName, lead.industry);
    }

    // 2) EVENT TYPING: GPT turns noisy headlines into real, typed events, each
    //    with the strategic "angle" it raises, and drops third-party industry
    //    news that has no bearing on what THIS company actually does (judged
    //    against the scraped site description). [] => sector-level fallback.
    const events = await classifyEvents(lead.companyName, lead.industry, news, companyIntel.description);

    // What this row anchored on (written to the sheet for visibility).
    const signal = events.length
      ? `${events[0].type}: ${events[0].what}`.slice(0, 240)
      : "Sector-level (no relevant company-specific event found)";

    // Decide if this row is safe to auto-send or should be held for a human.
    const review = reviewStatus(lead, events);
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
    const lastLine = (b) => {
      const ls = (b || "").split("\n").map((l) => l.trim()).filter(Boolean);
      return ls.length ? ls[ls.length - 1].toLowerCase() : "";
    };
    for (let step = 1; step <= 4; step++) {
      const scKey = `E${step} Subject`, bcKey = `E${step} Body`;
      if (!force && lead[scKey] && lead[bcKey]) {
        if (lead[scKey]) usedSubjects.push(lead[scKey]);
        const c = lastLine(lead[bcKey]);
        if (c) usedCTAs.push(c);
        results.push({ step, skipped: true });
        continue;
      }
      const out = await generateEmail(step, lead, companyIntel, news, events, usedSubjects, usedCTAs);
      if (out.subject !== "GENERATION_FAILED") {
        cells[scKey] = out.subject;
        cells[bcKey] = out.body;
        usedSubjects.push(out.subject);
        const c = lastLine(out.body);
        if (c) usedCTAs.push(c);
        results.push({ step, subject: out.subject });
      } else {
        results.push({ step, failed: true });
      }
    }
    const anyEmail = results.some((r) => r.subject);
    // Only rows with a real signal AND clean data are auto-marked Ready; a
    // no-signal draft is generated but flagged so a person decides before send.
    if (anyEmail) cells["Status"] = review.ready ? "Ready" : `Needs review: ${review.reason}`;

    await writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, cells);

    return NextResponse.json({
      ok: true,
      timezone,
      signal,
      eventsUsed: events.length,
      newsUsed: news.items.length,
      results
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
