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
  "Signal",
  "Timezone",
  "E1 Subject", "E1 Body", "E2 Subject", "E2 Body",
  "E3 Subject", "E3 Body", "E4 Subject", "E4 Body",
  "Status"
];

// ── Flexible input headers ────────────────────────────────────────────────
// The sheet's column names vary (fname vs firstName, company vs companyName,
// job_title vs title, time_zone vs Timezone, ...). We normalize every row to
// the canonical keys the engine expects, so the sheet can use whatever header
// spelling the lead source produces. `companyWebsite` is DERIVED from the
// email domain when no website column is present (B2B email domain == site).
const HEADER_ALIASES = {
  firstName: ["fname", "firstname", "first", "givenname"],
  lastName: ["lname", "lastname", "last", "surname", "familyname"],
  title: ["jobtitle", "title", "designation", "role", "position"],
  companyName: ["company", "companyname", "organization", "organisation", "account", "employer"],
  email: ["email", "emailaddress", "workemail", "mail"],
  country: ["country"],
  state: ["state", "region", "province", "stateprovince"],
  city: ["city", "town"],
  companyWebsite: ["companywebsite", "website", "domain", "url", "site", "web"],
  industry: ["industry", "sector", "vertical"],
  department: ["department", "dept", "function"],
  level: ["level", "seniority", "joblevel"],
  subIndustry: ["subindustry", "subsector"]
};

// Timezone may already exist under a different spelling on input.
const OUTPUT_ALIASES = {
  "Timezone": ["time_zone", "timezone", "time zone"]
};

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com",
  "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "aol.com", "icloud.com",
  "me.com", "mac.com", "protonmail.com", "proton.me", "gmx.com", "gmx.net",
  "mail.com", "yandex.com", "zoho.com", "qq.com", "163.com", "126.com"
]);

const nkey = (s) => String(s || "").toLowerCase().replace(/[\s._-]+/g, "");

function normalizeLead(row) {
  // Case/spacing-insensitive lookup of the row's own columns.
  const lc = {};
  for (const k of Object.keys(row)) {
    if (k === "__rowNumber") continue;
    lc[nkey(k)] = row[k];
  }
  const pick = (aliases) => {
    for (const a of aliases) {
      const v = lc[nkey(a)];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };

  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const v = pick(aliases);
    if (v || row[canonical] == null) row[canonical] = v;
  }

  // Derive website from the email domain when no website column is given.
  if (!row.companyWebsite && row.email && row.email.includes("@")) {
    const dom = row.email.split("@")[1].toLowerCase().trim().replace(/^www\./, "");
    if (dom && !FREE_MAIL.has(dom)) row.companyWebsite = dom;
  }

  // Expose canonical "Timezone" from an input alias (time_zone) so the
  // "already filled" skip-check works against whatever column they use.
  if (!row["Timezone"]) {
    const tz = pick(OUTPUT_ALIASES["Timezone"]);
    if (tz) row["Timezone"] = tz;
  }

  return row;
}

export function colToA1(col) {
  let s = "";
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

// True if `name` (or any of its output aliases) already exists in `headers`.
function headersHave(headers, name) {
  const want = new Set([name, ...(OUTPUT_ALIASES[name] || [])].map(nkey));
  return headers.some((h) => want.has(nkey(h)));
}

// Resolve a canonical output column to the actual 1-based index in the sheet,
// honoring aliases (e.g. "Timezone" -> the existing "time_zone" column).
function resolveHeaderIndex(name, headerIndex) {
  if (headerIndex[name]) return headerIndex[name];
  const want = new Set([name, ...(OUTPUT_ALIASES[name] || [])].map(nkey));
  for (const k of Object.keys(headerIndex)) {
    if (want.has(nkey(k))) return headerIndex[k];
  }
  return undefined;
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
    return normalizeLead(row);
  });
  return { headers, rows };
}

export async function ensureOutputColumns(spreadsheetId, sheetName, headers) {
  const sheets = sheetsClient();
  headers = [...headers];

  // Migration case only: sheets that already have "E1 Subject" but no timezone
  // column at all get one inserted right before it. Skipped when a timezone
  // column already exists under any spelling (e.g. an input "time_zone").
  if (!headersHave(headers, "Timezone") && headers.includes("E1 Subject")) {
    const insertAt = headers.indexOf("E1 Subject"); // 0-based
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))"
    });
    const sheet = (meta.data.sheets || []).find(
      (s) => s.properties && s.properties.title === sheetName
    );
    if (sheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            insertDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: "COLUMNS",
                startIndex: insertAt,
                endIndex: insertAt + 1
              },
              inheritFromBefore: true
            }
          }]
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!${colToA1(insertAt + 1)}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Timezone"]] }
      });
      headers.splice(insertAt, 0, "Timezone");
    }
  }

  const missing = OUTPUT_COLUMNS.filter((c) => !headersHave(headers, c));
  if (!missing.length) return headers;
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
  // cellMap keyed by canonical output name ("Timezone", "Signal", "E1 Subject"...).
  const sheets = sheetsClient();
  const data = Object.entries(cellMap)
    .map(([h, v]) => ({ idx: resolveHeaderIndex(h, headerIndex), v }))
    .filter(({ idx }) => idx)
    .map(({ idx, v }) => ({
      range: `'${sheetName}'!${colToA1(idx)}${rowNumber}`,
      values: [[v]]
    }));
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data }
  });
}

// Exported for offline testing of the header-normalization layer.
export { normalizeLead };
