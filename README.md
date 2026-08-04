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

## Relevance: judged, not pattern-matched

The regex gate was too strict, and strictness was the wrong tool. A title list
cannot know that "Airspace Innovation" at DroneUp is a senior product seat,
that "Area Vice President" at a radar company runs a region and buys
competitive intelligence, or that an Assistant Director of Student Conduct is
irrelevant no matter how senior she is.

`lib/relevance.js` asks the question an SDR actually asks:

> Would this person, at **this company**, plausibly buy or champion strategic
> market intelligence?

Two things are judged and both must pass:

- **Company fit.** Does this organisation buy market intelligence at all? A
  drone manufacturer does. A university's student affairs office and a regional
  disaster-restoration franchise do not, at any seniority. **The old gate had
  this nowhere, and it is the more important of the two filters** — most of the
  waste in the last run was Utah Disaster Kleenup and a state university, not
  wrong titles.
- **Person fit.** `buyer` (owns the budget or decision), `influencer` (would use
  the intelligence and can champion it upward), or `no`.

The judge is deliberately **inclusive on the person, strict on the company**.
Missing a real buyer is a worse error than including a marginal one, so a vague
or mislabelled title at a good company is judged on what the seat most likely
does and returns `influencer` rather than `no`.

**Cost.** The model is only consulted on ambiguous rows. Obvious rejects
(intern, recruiter, student, SDR) short-circuit on regex before any spend, and
verdicts are cached per title+company. If the API is unreachable the row falls
back to the title rules and is passed rather than dropped: an outage must never
look like a rejection.

The verdict is written into `Signal` as `[buyer]` or `[influencer]` so you can
see why each row was kept.

`lib/titles.js` is still there and still used for the fast paths and the
fallback, but it is no longer the decision-maker.

## The old job title (JT) gate

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


## The Insight Library: the give that works with zero news

The single biggest failure in the old output was on rows with no news. With
nothing to anchor on, the engine fell back to the scraped website and handed
the reader a description of their own company with a compliment on it:

> *"DPC's focus on building evaluation, design, and construction administration
> positions it as a vital partner for property owners and managers. With decades
> of experience, your efforts to maintain and restore buildings..."*

Peter wrote that copy. It is a **mirror**, not a give, and no prompt fixes it
because the *material* is wrong. Google News is free; every competitor with an
Apollo seat and an API key builds the same email.

Kings Research has trackers, primary interviews and years of segment work.
**That** is the give. It works in a dead quarter, on a company that has not
issued a press release in three years, and it cannot be replicated.

So the anchor priority is enforced **in code**, not prompt:

1. **A matched proprietary finding** — works always, primary
2. A competitor or market move — when one exists
3. Their own news, outside angle only
4. Nothing → **hold the row.** A generic email is worse than no email: it burns
   the domain *and* the prospect.

### The `Insights` tab

Created automatically on first run. Six columns:

| Column | Example |
|---|---|
| `Industry` | Building services |
| `Segment Keywords` | facade restoration; building envelope; FISP; Local Law 11 |
| `Finding` | Cycle 10 filings show 38% of buildings that filed SWARMP in cycle 9 have moved to Unsafe, against 22% |
| `Implication` | A lot of owners about to need scope work they have not budgeted for |
| `Withheld` | The breakdown by borough and building class |
| `Source Date` | 2026-Q2 |

`insights-template.csv` has worked examples. Aim for 40-60 findings tagged to
industry and sub-segment; matching is deterministic keyword overlap, and a
finding is **never** model-generated — a hallucinated statistic sent to a
senior buyer is unrecoverable, and the whole point is that the number is
checkable.

A finding is usable only if it passes four tests:

- **Non-obvious** — if they already know it, it is not a give
- **Uncomfortable** — it should imply they might be a step behind
- **Checkable** — a specific number or named mechanism; falsifiability is what
  makes it credible
- **Incomplete** — the number lands, the breakdown requires a reply. That last
  one is the entire sales mechanic.

Matching is conservative (`MIN_SCORE = 3`): a wrong finding is worse than no
finding, because it tells a senior reader you do not actually know their
segment, which is the one thing you are claiming.

## Guards that run on every generated email

The prompt used to carry all of these and the model treated them as
suggestions. They are now code, and a failure forces regeneration:

| Guard | Catches |
|---|---|
| `bannedHits` | AI tells and report-vendor vocabulary (CAGR, market size, "by 2030", "key players", "navigating", "many firms are") |
| `lengthProblem` | E1 90 words, E2 50, E3 80, E4 110. Hard, with 15% tolerance |
| `pitchProblem` | "We can help X with:" capability lists, positioning lines, bullets outside E4 |
| `mirrorProblem` | The opening being lifted from the prospect's own website copy |

**The fallback was the real bug.** After three failed attempts the old code
shipped the body unchanged and only repaired the subject, which is why
"navigating" and "many firms are" kept appearing in sent copy despite being
banned. The body now gets one targeted repair pass, and if it still fails the
row is written `Needs review: unfixable: ...` rather than `Ready`.

## The bug behind the irrelevant news

`deriveMarketContext` has been producing `domainQueries` — search phrases for
the market a company **sells into** — since before any of these changes.
`newsSignals` destructured that field and then **never issued a single search
with it**. The only queries that ever ran were on the company's name and its
competitors' names.

That is the whole reason an aviation insurer was fed its own press release
about in-orbit servicing. "Global Aerospace" the search string returns Global
Aerospace's PR. What moves their business is aviation insurance rates, hull
loss claims, UAS underwriting and reinsurance capacity — none of which
contains the words "Global Aerospace".

Now wired, with the largest quota of the classifier window:

| Scope | Quota | What it searches |
|---|---|---|
| `domain` | 6 | the market they sell into |
| `competitor` | 5 | named rivals |
| `company` | 3 | their own news |
| `industry` | 2 | sector-wide |
| `own-site` | 1 | their press page |

Two supporting changes: any domain query containing the company's own name is
dropped (it returns their PR, defeating the point), and every event must now
carry an `affects` field naming the concrete thing that changes for **this**
company — a price, a renewal, a buyer's budget, a compliance cost. **An event
with no concrete consequence is dropped at source.** That is what stops the
hedging, far more than banning the hedge words: the model wrote "this may
influence future product development" because it had been handed an event with
no consequence and asked to find one.

## Recency: the current quarter, hard-enforced

`when:Nd` in a Google News query is a **hint**, and Google routinely ignores it
for entity queries, returning the canonical story about a company regardless of
age. `pubDate` was being parsed and then discarded, which is exactly how a 2023
AirMap shutdown reached a 2026 email.

Two fixes:

**`quarterWindowDays()`** — the current quarter, and if the quarter has only
just started, 8 weeks back into the previous one so a January or July run is
not working from three headlines:

| Run date | Days into quarter | Window |
|---|---|---|
| 4 Aug | 34 | 34 days (current quarter) |
| 5 Jul | 4 | 60 days (reaches into Q2) |
| 2 Apr | 1 | 57 days |
| 25 Sep | 86 | 86 days |

Company size may only **narrow** this window, never widen it past the quarter.

**`withinWindow()`** — a hard filter at ingestion. Anything outside the window
is dropped before the classifier sees it, and **an item with no parseable date
is dropped too**. Items are then sorted freshest-first inside each scope quota.

Stale beats nothing is false in this business. A cold email is only credible if
the event is live: sending a two-year-old headline tells the reader you are not
actually watching their market, which is the one thing you are selling.

## Effect first, cause second

The single biggest structural change. Every previous email announced somebody
else's transaction and then asserted an effect:

> Procore's recent $845M acquisition of DroneDeploy will shift your customer
> landscape in drone operations technology.

The reader's eye travels through a stranger's news before reaching anything of
theirs — and on a phone that is the entire preview pane. Same facts, reordered:

> Your next few renewal conversations in UAS compliance are going to run into a
> bundled competitor that was not there last quarter. Procore bought
> DroneDeploy for $845M and is folding it into a platform your buyers already
> licence.

The reader appears in sentence one. The outside company appears in sentence
two, where it belongs — as the reason.

`openingProblem()` enforces it in code, because the prompt asked for this
before and the model kept reverting: the events it is handed are competitor
events, and restating one is the path of least resistance.

```
REJECT  "Procore's recent $845M acquisition of DroneDeploy will shift..."
        -> opens on "Procore", which is somebody else's news
PASS    "Your next few renewal conversations in UAS compliance..."
```

Subjects follow the same rule: a subject may not **start** with another
company's name. "Procore's $845M acquisition of DroneDeploy" is a headline
about a stranger — nothing in it belongs to the reader, so there is no reason
to open. It should name what is now in question for them.

## Grammar, fixed deterministically

Bullets were arriving half capitalised and half not, within the same email, and
sentences after a full stop were left lowercase. It reads as careless, which is
fatal in an email whose entire claim is rigour.

`normalizeProse()` runs after generation rather than being asked for in the
prompt, because a prompt cannot guarantee it and this can: every line and list
item capitalised, sentence case restored after `. ? !` while skipping
abbreviations (`U.S.`, `e.g.`, `Inc.`), and trailing periods normalised across
a list so items match each other.

## The connect link

`https://www.kingsresearch.com/connect` is woven **into a sentence**, never
appended as a footer and never on its own line — `linkProblem()` rejects a bare
URL line, a missing link, and any duplicate.

**Deliverability note:** a link in the first touch measurably lowers inbox
placement on cold sends. `LINK_STEPS` at the top of `lib/engine.js` currently
reads `[1, 3, 4]` — E2 stays clean because it is a short bump. If seed tests
show worse placement or reply rates fall, change it to `[3, 4]`.

## The Ready bar

`Ready` now requires three things, not one:

1. the copy passed every guard,
2. the row has a real give, **and**
3. **the seat would actually buy** — `buyLikelihood >= 80`, or
   `decisionInfluence` true (they set requirements, run the evaluation, or own
   the problem, even without the budget).

The judge scores the seat, not the person: a Head of Corporate Strategy at a
mid-size manufacturer is 85+, a VP Marketing 70-80, a Product Manager 40-60, an
IT Director under 20. `Signal` now shows it — `[buyer 85% decider]` — so a
held row explains itself.

A flawless email to someone who cannot act on it still costs send volume and
domain reputation.

## Why every email looked the same

Twenty rows came back with the same shape:

- every E1 opened on a rival's name — Wing did X, Northrop did Y, Pentagon did Z
- every subject was `[Rival]'s [move] + your [thing]`
- every E1 carried **"We track your sector pricing quarterly. Three things we can see that you probably cannot from inside:"** — verbatim, to an insurer, a radar firm and a drone operator alike
- every E4 opened **"I'm not chasing a reply, just sharing what we're tracking"**

Two causes, and both were mine.

**Prompt examples become templates.** Every one of those stock lines was
written into this repo's prompts as an *illustration*. Models copy example
sentences word for word. A quotable line in a prompt is a template, not an
example — the prompts now describe the *move* and let the model write the
sentence. All the seeded phrases are on the banned list, so they cannot come
back.

**Each guard narrowed the space.** "Must open on the give", "must name an
outside actor", "must have three bullets" — individually reasonable, together
they left exactly one survivable shape. Twenty emails from one mould read as
bulk mail whatever the words are.

And under both, a deeper error: **anchoring on the rival's move.** A competitor
move is a fact, and a fact plus a guess about its effect is not substance.
What earns a reply is what that fact does to a decision the reader owns.

## Angle rotation

`lib/angles.js` assigns each prospect one of five entry angles, hashed from
their email so it is stable on re-run but spread across a list:

| Angle | Opens on |
|---|---|
| `DECISION` | a call they own that just got harder |
| `STRUCTURAL` | how their market actually works — a mechanism they may not have connected |
| `BUYER` | what is changing in what their customers need or budget |
| `RIVAL` | a competitor move — but the move is only the setup |
| `REGULATORY` | a rule, followed one step past the obvious |

Availability constrains it: `RIVAL` needs a competitor event, `REGULATORY`
needs a regulatory one. `STRUCTURAL` always works, because it is a read rather
than a headline — which is what lets a row with no news still say something.

Across the nine leads in the last run: `STRUCTURAL` 3, `DECISION` 2,
`REGULATORY` 2, `RIVAL` 1, `BUYER` 1. Rival openings went from nine of nine to
one of nine.

Subject shapes (six) and E4 closing moves (five) rotate the same way, and both
are described rather than quoted so no stock sentence can propagate.

## The engagement thesis — the layer that was missing

The pipeline went **news → email**. Every bullet therefore had to be invented
on the spot from a headline, and what came out were guesses wearing the costume
of deliverables:

> - how many Walmart partnerships may shift to Wing as they enter Florida
> - what impact Wing's pricing strategies might have on your cost structure
> - how quickly Florida regulators may adapt to increased competition

Nobody can buy any of those. And the hedging is not a style problem — it is the
honest consequence of asking a model to invent a deliverable from a headline.
Banning "may" without fixing the input just produced held rows.

`lib/thesis.js` inserts the sequence a human consultant actually uses:

```
WHAT ARE THEY  →  WHAT DECISIONS DO THEY OWN  →  WHAT COULD WE SELL THEM
               →  which news hooks into that  →  write
```

It runs once per company and produces:

| Field | What it is |
|---|---|
| `whatTheyAre` | corrects the list's industry label — "Global Aerospace" is an aviation **insurer**, not a manufacturer |
| `whoPaysThem` | the customer types who sign cheques |
| `segments` / `rivals` | their real coverage classes and their real named competitors |
| `decisions` | the recurring high-stakes calls their leadership owns |
| `deliverables` | **6-8 named, buyable Kings Research products for this company** |
| `watchQueries` | news searches anchored to those decisions |

**Email 1's bullets are drawn from `deliverables`, not invented.** That single
change is what removes the speculation at source:

> - Quarterly competitor tracking on Allianz, AIG Aerospace and AXA XL: product launches, pricing moves, geographic expansion
> - Fleet expansion tracker: which carriers are adding aircraft, by region and type
> - Insurance implications of eVTOL and advanced air mobility, with adoption forecasts by aircraft class

Each is a **noun they can buy**. Deliverables containing `may`, `might`,
`could`, or `potential` are filtered out of the thesis before they can reach a
bullet, and `bulletProblem()` rejects any bullet that is a speculation or is
phrased as a question.

## The bullets: back, and checked

Stripping them was an overcorrection. The bullets give Email 1 substance, tell
the reader what kind of thinking they would get, and break up the wall. The
problem was never the bullets. It was **interchangeable** bullets.

Dead — would read identically for every insurer on the list:

> - Insights on how competitors are adjusting their pricing in response to market shifts
> - Analysis of emerging technologies in aviation and their impact on insurance needs
> - Evaluation of market share trends among key players in aerospace insurance

Alive — only makes sense for one prospect:

> - Which of your last-mile delivery accounts sit inside Wing's announced Florida service radius
> - What Walmart's partner actually failed on, cost line by cost line
> - Where AeroVironment's public safety UAS pricing has moved since March

`bulletProblem()` enforces the difference: a bullet is rejected if it opens
with an abstract service noun (`Insights on`, `Analysis of`, `Evaluation of`),
ends in filler (`market shifts`, `key players`, `the competitive landscape`),
or contains no real name, number, or named segment from the prospect's own
world. The segment and rival lists from `deriveMarketContext` feed the anchor
check, so "the UAS underwriting book" passes and "the competitive landscape"
does not.

## Subject lines that get opened

A subject naming only the reader's own news is their press release read back to
them, and a number does not rescue it:

```
DEAD   "Global Aerospace's in-orbit servicing technologies"
DEAD   "Echodyne's new $40M manufacturing hub"
DEAD   "DJI's eVTOL cargo drone launch"
DEAD   "energy project delivery insights"

OPENS  "Wing's Florida move + your renewals"
OPENS  "Northrop's $3B and radar pricing"
OPENS  "SeAH's US hub, your hull book"
```

The shape that works: **[the specific outside move] + [what it touches for
them]**. First half is what happened, second half is why they should care. 4-8
words, sentence case, under 48 characters, and at least one proper noun that is
**not** the prospect's own company.

## Saying who you are: provenance, not a menu

Removing the capability list entirely was an overcorrection. A stranger's
insight *does* need provenance — the reader has to know why you of all people
are telling them this. But there is a right and a wrong way:

**Wrong — a menu.** Generic service categories, interchangeable between every
prospect in the sector. The reader stops at the colon:

> Kings Research is a market-intelligence and advisory firm that works across
> your sector. We can help DroneUp with:
> - Analyzing how X positions you against emerging competitors
> - Mapping competitor moves

**Right — a provenance line.** One sentence saying *how you know* the thing you
just said:

> We track the UTM vendor landscape quarterly, which is where that pattern
> comes from.

A fifth of the words, and it proves an ongoing data capability instead of
claiming a service. Placement matters: **after** the give, never before, because
opening with who you are wastes the two lines a phone shows.

Where each email stands:

| Email | Self-introduction allowed |
|---|---|
| E1 | one provenance line, after the give |
| E2 | none — it is a reply on a thread |
| E3 | **two concrete deliverables**, tied to the named segment |
| E4 | none |

E3 is where a real offer earns its place, because by then you have given twice.
The two items must be phrased as what they would *receive* ("who is winning
your renewals in that segment and on what terms"), not as service categories
("competitive positioning analysis").

## Never tell them good news about themselves

> "AirMap shutting down will create an opening for DroneUp to capture market
> share in airspace management services."

That is flattery wearing analysis as a costume. It is pleasant, unfalsifiable,
and produces no reply, because nothing is at stake. It is the mirror problem in
a new outfit: instead of describing their business back to them, it predicts
their success back to them.

The implication line must carry a **risk, an uncertainty, or a question they
have not asked**. Same fact, stronger:

> AirMap's users do not automatically become yours. In the two prior UTM exits
> we tracked, most displaced accounts went to the incumbent's partner network
> rather than the nearest competitor.

Uncomfortable, specific, checkable — and that is why someone replies. The
flattery vocabulary is banned in code: `create an opening for`, `positioned to
benefit`, `stands to gain`, `capture market share`, `strengthen your market
position`, `less competition`.

## The cadence

One subject, four bodies, and the psychology inverted.

**E1 — the finding.** ≤90 words. Number, implication, one-line ask. No bullet
list, no positioning line, no "Kings Research is a...". The signature carries
identity; a capability list converts a give into a pitch and the reader stops
at the colon.

**E2 — a second, different finding.** ≤50 words. Not a bump. "Just floating
this to the top" spends a touch and gives nothing.

**E3 — narrow to their segment.** ≤80 words. Their actual product line,
customer type, or geography, with a substantive read on it.

**E4 — give it away.** ≤110 words. Three numbered items, everything you are
watching in their space, and **no ask at all**: no CTA, no offer, no question
mark. It is the only email that wants nothing from them, which is exactly why
it should be the highest-reply touch in the sequence.

Then E5 three weeks later on a new thread with a new finding. A meaningful
share of replies land there.

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

- `Ready` - in the title bracket, a real give (a matched finding or an outside
  view), clean company data, and copy that passed every guard. Safe to send.
- `Not present in JT` - wrong function or seniority. Dead.
- `Needs enrichment: unparseable title` - the title column holds a department
  ("Aerospace"), a product ("Aras PLM"), a team name ("Airspace Innovation"),
  or a bare function with no seniority word ("Business Development"). These are
  **recoverable** and must not be binned with the first kind: Andy Thurling at
  DroneUp under "Airspace Innovation" is real pipeline. Route to Sales
  Navigator for a re-enrichment pass.
- `Error: <message>` - the row threw. Previously these returned a 500 and wrote
  nothing, leaving the row blank: not Ready, not rejected, just invisible on a
  5,000-row sheet.
- `Needs review: <reason>` - drafted but held for a human (no signal found, or
  a domain-as-company / missing company name, which is skipped entirely).

**Migrating an existing sheet:** delete the old `E2 Subject`, `E3 Subject` and
`E4 Subject` columns before the first run, or start on a fresh tab. The old
"insert Timezone before E1 Subject" migration was removed because it shifted
every output column one to the right, which is exactly what breaks the I:N
block Smartlead maps against. Output columns are now only ever appended.

Rows with Status = replied / dnc / paused / bounced are never touched.
Filled rows are skipped unless "Regenerate filled rows" is checked.
