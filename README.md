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
industry news about unrelated players, and (3) writes **one subject line and
four email bodies** back into that sheet only.

Rows are gated on job title first: only prospects inside the approved title
bracket are researched or written for. Everything else is stamped
`Not present in JT` before a single API call is made.

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

**One subject line, not four.** E2-E4 send as replies on the same Smartlead
thread and inherit E1's subject as `Re: ...`, so only `E1 Subject` is
generated. This removes three model calls' worth of subject generation per
prospect and three more chances for the banned-word guard to reject an
otherwise-good body.

## The job title (JT) gate

`lib/titles.js` decides whether a row is worth spending money on, and runs
**before** the website scrape, the news queries, and every OpenAI call. On a
typical purchased list it drops 40-60% of rows, which makes it the largest
cost saving in the pipeline as well as the targeting filter.

A lead passes through either of two doors:

- **Approved title.** One of the named titles from the brief (Head of Strategy,
  Director/Manager Corporate Strategy, VP/Director Market Intelligence,
  Director Business Insights, Strategy & Planning Lead, Market Research
  Manager, Competitive Intelligence Analyst/Manager, CMO, VP/Director
  Marketing, VP/Director Product Marketing, Head of Product Strategy,
  Director Customer/Consumer Insights, Product Manager/Director, CEO/COO,
  Chief Commercial Officer, VP/Director Business Development, Head of Global
  Expansion / International Strategy). These bypass the seniority floor,
  because the list already encodes the seniority intended: Competitive
  Intelligence Analyst is approved by name even though Analyst sits below
  Manager.
- **Function + seniority.** The title or department falls in an approved family
  (Strategy, Insights, Marketing, Product, Procurement, Data & Analytics,
  Commercial/BD, Expansion, Exec) **and** clears that family's floor.

Floors are deliberately per-family rather than one global "Manager+", taken
from what the approved list actually named:

| Family | Floor | Why |
|---|---|---|
| Strategy | Manager+ | list names Manager, Corporate Strategy |
| Insights / Market Intel / CI | Manager+ | CI Analyst passes via the named list |
| Marketing | **Director+** | list only ever named CMO, VP, Director |
| Product | Manager+ | list names Product Manager |
| Procurement | Manager+ | brief says Manager+ |
| Data & Analytics | Manager+ | brief says Manager+ |
| Commercial / BD | **Director+** | list names VP/Director BD, CCO |
| Global Expansion | Director+ | list names Head of |
| CEO / COO | CXO | list names CEO/COO only |

Japanese titles are handled natively. `経営企画` (corporate planning) is the
real strategy seat in a Japanese org and carries more internal weight than the
US equivalent, so it maps to STRATEGY, with `部長 / 課長 / 本部長 / 執行役員`
mapping onto the seniority ladder.

Hard denials run first and beat everything: interns, assistants, recruiters,
HR, support engineers, SDR/BDR, account executives and account managers.
`Chief Executive Officer` is correctly *not* caught by the junior sense of
"executive" (as in `Marketing Executive`, the India/UK usage).

### Dry-run it before you spend anything

```bash
node scripts/jt-check.mjs leads.csv --out=triage.csv
```

No network, no OpenAI, no Sheets. Prints the pass rate, what passed and why,
and the ranked rejection reasons. Run it on every new list: a pass rate far
outside 30-60% is usually a list problem rather than a gate problem.

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

- **Out of the title bracket** is stamped `Not present in JT` and **skipped
  entirely**, before any research or generation spend. The `Signal` column
  records why (e.g. `JT filter: MARKETING below seniority floor (is Manager,
  needs Director+)`) so a bad list is diagnosable at a glance.
- **Broken company data** (the company field is a bare domain like `usi.edu`, or
  empty) is **skipped entirely** and marked `Needs review: ...`. This prevents the
  model from inventing a company name to fill the gap.
- **No real signal found** still gets a draft, but is marked
  `Needs review: no company-specific signal found` rather than `Ready`, so a
  person decides before it sends.
- Only rows with a genuine, relevant event **and** clean company data are
  auto-marked **`Ready`**.

## Never hook on the prospect's own bad news

A negative or sensitive event at the prospect's **own** company (an executive
detained or arrested, a lawsuit, a probe, a scandal, layoffs, a bankruptcy, a
fatal incident, a recall, a breach, sanctions) is **never** used as a signal or
mentioned in an email. Cold-emailing an employee about their employer's crisis
is ambulance-chasing: it embarrasses the reader and burns the domain. The
classifier marks such events sensitive and a keyword backstop in code drops
them regardless, so the row anchors on the next-best real event (or falls back
to sector-level). The same event at a **competitor** is kept, soberly framed,
as the market signal it is for the prospect.

## Competitor moves are the primary hook, and new pipeline

Prospects have full information about their own company and almost none about
rivals; that gap is what a market-intelligence firm sells. So:

- **Competitor watch.** Each prospect's named competitors (an optional
  `Competitors` sheet column, else up to 5 real rivals derived by the model
  from the scraped site) are news-searched too. A relevant rival or
  market/regulatory move is ranked **above** the prospect's own good news as
  the Email 1 anchor, framed as what it means for the prospect's share,
  pricing, or pipeline.
- **Derived Targets tab.** Every strong event detected about a prospect fans
  out to that prospect's competitors as new outreach rows on a
  `Derived Targets` tab (target company, why they compete, the event as their
  ready-made signal, and the angle). The companies most likely to buy a read
  on "Echodyne's $40M factory" are Echodyne's competitors, not Echodyne.

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

Output columns are appended automatically if missing, **in this order**:

| Col | Header | Contents |
|---|---|---|
| I | `E1 Subject` | the one subject line for the whole thread |
| J | `E1 Body` | email 1 |
| K | `E2 Body` | email 2 (thread reply) |
| L | `E3 Body` | email 3 (thread reply) |
| M | `E4 Body` | email 4 (thread reply) |
| N | `Status` | `Ready` / `Not present in JT` / `Needs review: ...` |
| O | `Signal` | what the row anchored on, or the JT rejection reason |
| P | `Timezone` | resolved from country + state |

I:N assumes the standard **8 input columns in A:H**. If your input block is a
different width the headers still resolve correctly by name, but the letters
shift, so map Smartlead against the header names rather than the letters.

`Status` values:

- `Ready` - in the title bracket, a real signal, clean company data. Safe to send.
- `Not present in JT` - outside the approved title bracket. No emails generated.
- `Needs review: <reason>` - drafted but held for a human (no signal found, or
  a domain-as-company / missing company name, which is skipped entirely).

**Migrating an existing sheet:** delete the old `E2 Subject`, `E3 Subject` and
`E4 Subject` columns before the first run, or start on a fresh tab. The old
"insert Timezone before E1 Subject" migration was removed because it shifted
every output column one to the right, which is exactly what breaks the I:N
block Smartlead maps against. Output columns are now only ever appended.

Rows with Status = replied / dnc / paused / bounced are never touched.
Filled rows are skipped unless "Regenerate filled rows" is checked.
