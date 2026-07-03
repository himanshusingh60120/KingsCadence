import { NextResponse } from "next/server";
import { readSheet, ensureOutputColumns } from "../../../lib/google";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const { spreadsheetId, sheetName } = await req.json();
    let { headers, rows } = await readSheet(spreadsheetId, sheetName);
    headers = await ensureOutputColumns(spreadsheetId, sheetName, headers);

    const leads = rows
      .filter((r) => (r.email || "").includes("@"))
      .map((r) => ({
        rowNumber: r.__rowNumber,
        name: `${r.firstName || ""} ${r.lastName || ""}`.trim(),
        company: r.companyName || "",
        title: r.title || "",
        status: r.Status || r.status || "",
        done: Boolean(r["E1 Subject"] && r["E4 Body"])
      }));

    return NextResponse.json({ headers, leads, total: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
