# Kings Cadence

Sheet-driven cold email cadence generator for Kings Research. Select a Google
Sheet tab, and for every prospect it: (1) screens the company live, reading its
website to learn what the company actually does and scanning Google News for
genuine corporate events (M&A, capacity expansions, facility closures,
geographic expansion, product launches, joint ventures, partnerships,
investment announcements, major deals, price/input-cost moves and regulatory
changes in the last 30-120 days), (2) uses GPT to type those headlines into
real events, each with the strategic question it raises, keeping only the ones
that genuinely bear on what that specific company does and discarding generic
industry news about unrelated players, and (3) writes 4 consultancy emails
(E1 Subject/Body ... E4 Subject/Body) back into that sheet only.

Kings Research is positioned as a strategic advisory and market-intelligence
partner, **not** a report vendor, and every email is built to **give before it
asks**: it leads with something concrete and useful, and the ask is a reply or
"let me send you X", never a meeting. There is deliberately no market-size,
CAGR, or forecast figure anywhere. The only numbers that can appear are ones the
prospect's own company announced, or a real insight you supply (see below).
Email 1 opens on that supplied insight if present, otherwise on an outside angle
on the prospect's most relevant recent event, otherwise on something concrete
about the prospect's own business. When an event is about another organization
(a competitor, OEM, supplier, or agency), it is framed as the market signal it
creates for the prospect, never as a deal the prospect is party to or can
"leverage".

The four touches are: E1 an intro + the give, E2 a second specific give, E3 a
genuine give (a specific read or breakdown you offer to share, **not** a
fabricated "a comparable client" story), and E4 a forward-looking angle + an
open door. No email asks for a call or "20 minutes".

## Give the reader something real: the `Insight` column

The single biggest lever on reply rate is leading with a real, specific finding
rather than a generic observation. Add an optional **`Insight`** column (aliases:
`KR Insight`, `data point`, `finding`, `hook`) to your sheet and, per row, drop
in a concrete Kings Research data point or finding for that prospect's segment.
When present, Email 1 opens on it verbatim-in-spirit as the give. When absent,
the email leads with a specific outside angle on the event and offers to send
the detail, so a human can attach the real thing. Without a real give, no-signal
prospects are inherently generic, this column is how you fix that.

## Only good rows are auto-marked "Ready"

Not every row should be blasted. The pipeline holds the ones that would embarrass
you:

- **Broken company data** (the company field is a bare domain like `usi.edu`, or
  empty) is **skipped entirely** and marked `Needs review: ...`. This prevents the
  model from inventing a company name to fill the gap.
- **No real signal found** still gets a draft, but is marked
  `Needs review: no company-specific signal found` rather than `Ready`, so a
  person decides before it sends.
- Only rows with a genuine, relevant event **and** clean company data are
  auto-marked **`Ready`**.

## Relevance & tone guardrails

A few rules are enforced in code, beyond the prompt:

- **Relevance filter.** Every detected event is judged against what the prospect
  actually does (read from its own website). A headline about a *different*
  company with no bearing on the prospect is dropped rather than reframed as
  their opportunity — e.g. an aviation *insurer* is not pitched a jet-engine
  maker's new factory.
- **Third-party framing.** A relevant event about another organization is posed
  as a signal that raises a question for the prospect, never a move they can
  "leverage" or "capitalize on".
- **No meeting-ask, no templated closers.** "20-minute conversation", "compare
  notes ahead of your Q4 planning", and similar are banned in code; the CTA is a
  value exchange (a reply, or something specific sent over).
- **Plain, specific language.** A long list of AI-tell phrases ("growth pockets",
  "evolving landscape", "grappling with", "navigate/navigating", ...) is banned
  in code and triggers regeneration, so emails don't read as machine-written.
- **Subject-line discipline.** Subjects are short (a `subjectGeneric` guard flags
  buzzwords and report-title length), stay in the reader's frame (never
  "we/our/us"), and never contain a job title or salesy words.
- **No market figures.** No market-size, CAGR, or forecast numbers anywhere.

## Setup

1. `npm install`
2. Copy `.env.example` -> `.env.local`, add `OPENAI_API_KEY` and the Google
   service account credentials.
3. In Google Cloud Console: enable the **Google Sheets API**, create a service
   account + JSON key, and **share every spreadsheet you'll use with the
   service account email (Editor)**.
4. `npm run dev` -> http://localhost:3000

## Deploy (Vercel)

Push to GitHub, import in Vercel, add the env vars, deploy.

## Sheet contract

Input headers (row 1): `firstName lastName title companyName companyWebsite
department level industry subIndustry companyHeadCount companyRevenue country
state city email linkedin address status verificationStatus catchAllStatus`.
Header spellings are flexible (`fname`/`company`/`job_title`/... are all
recognized). Optional: an **`Insight`** column to supply a real give per row.

Output columns are appended automatically if missing: `Signal, Timezone,
E1 Subject, E1 Body, E2 Subject, E2 Body, E3 Subject, E3 Body, E4 Subject,
E4 Body, Status`. `Signal` records what each row anchored on (the top relevant
detected event, or "Sector-level" when none was found). `Status` is `Ready` only
for rows with a real signal and clean company data; otherwise
`Needs review: <reason>` (a domain-as-company or missing name is skipped; a
no-signal row is drafted but held).

Rows with Status = replied / dnc / paused / bounced are never touched.
Filled rows are skipped unless "Regenerate filled rows" is checked.
