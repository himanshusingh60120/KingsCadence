# Kings Cadence

Sheet-driven cold email cadence generator for Kings Research. Select a Google
Sheet tab, and for every prospect it: (1) screens the company live (its website
+ Google News for mergers, takeovers, regulation, expansion in the last 30–60
days), (2) maps the prospect to the best Kings Research report with a 90%
weight on the company's domain of work and 10% on the person's role
(embeddings shortlist → GPT re-rank, same architecture as ReportMapper),
(3) scrapes hard figures from the report page, and (4) generates 4
hyper-personalized advisory emails (E1 Subject/Body ... E4 Subject/Body)
written back into that sheet only.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local`, add `OPENAI_API_KEY` and the Google
   service account credentials.
3. In Google Cloud Console: enable the **Google Sheets API**, create a service
   account + JSON key, and **share every spreadsheet you'll use with the
   service account email (Editor)**.
4. `npm run build:catalog` → commit `data/catalog.json`.
5. `npm run dev` → http://localhost:3000

## Deploy (Vercel)

Push to GitHub, import in Vercel, add the three env vars, deploy.
`data/catalog.json` must be committed. Refresh it monthly (or wire a cron).

## Sheet contract

Input headers (row 1): `firstName lastName title companyName companyWebsite
department level industry subIndustry companyHeadCount companyRevenue country
state city email linkedin address status verificationStatus catchAllStatus`

Output columns are appended automatically if missing: `Matched Report,
Report URL, Relevance, E1 Subject, E1 Body, E2 Subject, E2 Body, E3 Subject,
E3 Body, E4 Subject, E4 Body, Status`.

Rows with Status = replied / dnc / paused / bounced are never touched.
Filled rows are skipped unless "Regenerate filled rows" is checked.
