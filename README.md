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

Kings Research is positioned throughout as a strategic advisory and
market-intelligence partner, **not** a report vendor. There is deliberately no
market-size, CAGR, or forecast figure anywhere in the emails. The only numbers
that can appear are ones the prospect's own company announced in a real event.
Email 1 opens on the prospect's most relevant recent event (or, if none is
relevant, on the sector-level shift their market is going through). When an
event is about another organization (a competitor, OEM, supplier, or agency),
it is framed as the market signal it creates for the prospect, never as a deal
the prospect is party to or can "leverage".

## Relevance & tone guardrails

The value of the cadence lives in relevance, so a few rules are enforced in code
beyond the prompt:

- **Relevance filter.** Every detected event is judged against what the prospect
  actually does (read from its own website). A headline about a *different*
  company with no bearing on the prospect is dropped rather than reframed as
  their opportunity — e.g. an aviation *insurer* is not pitched a jet-engine
  maker's new factory. If nothing relevant remains, the emails fall back to the
  sector-level shift instead of manufacturing a hook.
- **Third-party framing.** A relevant event about another organization is posed
  as a signal that raises a question for the prospect, never as a move they can
  "leverage" or "capitalize on".
- **Subject-line voice.** Subjects stay in the reader's frame. They never slip
  into the recipient's voice with "we/our/us" ("our strategy") — validated in
  code with automatic regeneration and a deterministic fallback — and job-title
  and salesy words are kept out too.
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
state city email linkedin address status verificationStatus catchAllStatus`

Output columns are appended automatically if missing: `Signal, Timezone,
E1 Subject, E1 Body, E2 Subject, E2 Body, E3 Subject, E3 Body, E4 Subject,
E4 Body, Status`. `Signal` records what each row anchored on (the top relevant
detected event, or "Sector-level" when no relevant company event was found).

Rows with Status = replied / dnc / paused / bounced are never touched.
Filled rows are skipped unless "Regenerate filled rows" is checked.
