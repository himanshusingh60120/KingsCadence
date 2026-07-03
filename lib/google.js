import { google } from "googleapis";

let _sheets = null;

export function sheetsClient() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

export function extractSpreadsheetId(input) {
  const m = String(input || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input || "").trim();
}

export const OUTPUT_COLUMNS = [
  "Matched Report", "Report URL", "Relevance",
  "E1 Subject", "E1 Body", "E2 Subject", "E2 Body",
  "E3 Subject", "E3 Body", "E4 Subject", "E4 Body",
  "Status"
];

export function colToA1(col) {
  let s = "";
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

export async function readSheet(spreadsheetId, sheetName) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`
  });
  const values = res.data.values || [];
  const headers = (values[0] || []).map((h) => String(h).trim());
  const rows = values.slice(1).map((rv, i) => {
    const row = { __rowNumber: i + 2 };
    headers.forEach((h, j) => { row[h] = (rv[j] || "").trim(); });
    return row;
  });
  return { headers, rows };
}

export async function ensureOutputColumns(spreadsheetId, sheetName, headers) {
  const missing = OUTPUT_COLUMNS.filter((c) => !headers.includes(c));
  if (!missing.length) return headers;
  const sheets = sheetsClient();
  const start = headers.length + 1;
  const end = headers.length + missing.length;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!${colToA1(start)}1:${colToA1(end)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [missing] }
  });
  return [...headers, ...missing];
}

export async function writeRowCells(spreadsheetId, sheetName, rowNumber, headerIndex, cellMap) {
  // cellMap: { "E1 Subject": "...", ... }
  const sheets = sheetsClient();
  const data = Object.entries(cellMap)
    .filter(([h]) => headerIndex[h])
    .map(([h, v]) => ({
      range: `'${sheetName}'!${colToA1(headerIndex[h])}${rowNumber}`,
      values: [[v]]
    }));
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data }
  });
}
