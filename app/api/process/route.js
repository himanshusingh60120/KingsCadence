import { NextResponse } from "next/server";
import { readSheet, writeRowCells } from "../../../lib/google";
import { companyWebsiteIntel, newsSignals, scrapeReport } from "../../../lib/research";
import { mapProspectToReport } from "../../../lib/mapper";
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

    // 1) SCREENING: live company research (site + fresh news, mergers, regulation)
    const [companyIntel, news] = await Promise.all([
      companyWebsiteIntel(lead.companyWebsite),
      newsSignals(lead.companyName, lead.industry)
    ]);

    // 2) REPORT MAPPING: 90% company domain, 10% role
    const report = await mapProspectToReport(lead, {
      ...companyIntel, newsSummary: news.newsSummary
    });

    // 3) Hard numbers from the report page
    const reportData = await scrapeReport(report.url);

    // 4) Generate E1-E4 sequentially (each sees the same intel, different angle)
    const cells = {
      "Matched Report": report.title,
      "Report URL": report.url,
      "Relevance": report.reason
    };
    const results = [];
    for (let step = 1; step <= 4; step++) {
      const scKey = `E${step} Subject`, bcKey = `E${step} Body`;
      if (!force && lead[scKey] && lead[bcKey]) { results.push({ step, skipped: true }); continue; }
      const out = await generateEmail(step, lead, report, reportData, companyIntel, news, report.reason);
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
      report: report.title,
      relevance: report.reason,
      newsUsed: news.items.length,
      results
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
