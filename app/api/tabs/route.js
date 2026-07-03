import { NextResponse } from "next/server";
import { sheetsClient, extractSpreadsheetId } from "../../../lib/google";

export async function POST(req) {
  try {
    const { spreadsheet } = await req.json();
    const spreadsheetId = extractSpreadsheetId(spreadsheet);
    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    return NextResponse.json({
      spreadsheetId,
      title: meta.data.properties.title,
      tabs: meta.data.sheets.map((s) => s.properties.title)
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
