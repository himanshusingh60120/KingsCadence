import { NextResponse } from "next/server";
import { readSheet, writeRowCells } from "../../../lib/google";
import { companyWebsiteIntel, newsSignals, classifyEvents } from "../../../lib/research";
import { generateEmail } from "../../../lib/engine";
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
    const [companyIntel, news] = await Promise.all([
      companyWebsiteIntel(lead.companyWebsite),
      newsSignals(lead.companyName, lead.industry)
    ]);

    // 2) EVENT TYPING: GPT turns noisy headlines into real, typed events, each
    //    with the strategic "angle" it raises, and drops third-party industry
    //    news that has no bearing on what THIS company actually does (judged
    //    against the scraped site description). [] => sector-level fallback.
    const events = await classifyEvents(lead.companyName, lead.industry, news, companyIntel.description);

    // What this row anchored on (written to the sheet for visibility).
    const signal = events.length
      ? `${events[0].type}: ${events[0].what}`.slice(0, 240)
      : "Sector-level (no relevant company-specific event found)";

    // 3) Generate E1-E4 sequentially. Pure consultancy: no report, no market
    //    figures. E1 opens on an event angle (or the sector shift if none).
    const cells = { "Signal": signal };
    const results = [];
    for (let step = 1; step <= 4; step++) {
      const scKey = `E${step} Subject`, bcKey = `E${step} Body`;
      if (!force && lead[scKey] && lead[bcKey]) { results.push({ step, skipped: true }); continue; }
      const out = await generateEmail(step, lead, companyIntel, news, events);
      if (out.subject !== "GENERATION_FAILED") {
        cells[scKey] = out.subject;
        cells[bcKey] = out.body;
        results.push({ step, subject: out.subject });
      } else {
        results.push({ step, failed: true });
      }
    }
    const anyEmail = results.some((r) => r.subject);
    if (anyEmail) cells["Status"] = "Ready";

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
