/**
 * THE PROSPECT DOSSIER
 * ──────────────────────────────────────────────────────────────────────────
 * What a human does before writing to a senior stranger, and what this
 * pipeline was never doing:
 *
 *   1. What has gone RIGHT at this company in the last three to four months
 *   2. Who is this PERSON, what do they own, what did they do before
 *   3. What market is this, who else is in it, what moved in it recently
 *   4. What could Kings Research actually sell THEM, given 1-3
 *   5. Which hooks are worth opening on, ranked, each with its evidence
 *
 * The old pipeline had a partial 3 (deriveMarketContext), a partial 4
 * (engagementThesis), and nothing at all for 1 or 2. Steps 1-3 ran on Google
 * News RSS, which returned nothing on both of the sample rows, so the emails
 * were written from step 4 alone. That is exactly what the output shows:
 * fluent, confident, and about nothing.
 *
 * WHY THIS IS A SEPARATE LAYER RATHER THAN A BETTER PROMPT.
 * The dossier is retrieval; the cadence is writing. Keeping them apart means
 * the research can be inspected, cached, corrected by a human, and reused
 * across all four emails, and it means a research failure is VISIBLE as an
 * empty dossier instead of invisible as confident prose. Every field here is
 * either sourced to a URL that was actually opened, or absent. There is no
 * third state, and specifically there is no "probably true".
 *
 * WHAT IT COSTS. Two or three search calls per COMPANY (cached, so the second
 * contact at the same account is free) and one per PERSON. On a list with
 * three contacts per account that is roughly 1.7 search calls per row.
 */
// Explicit .js extensions, and no import from research.js. Both are so that
// this module loads under bare `node` as well as under the Next bundler,
// which is what lets scripts/dossier.mjs run a single prospect with no build
// step. research.js pulls in cheerio and would break that.
import { chatJSON } from "./ai.js";
import { groundedJSON, keepSourced, hasWebSearch } from "./search.js";

/** The four-month ceiling, matching MAX_NEWS_AGE_DAYS in lib/research.js.
 *  "Strictly the last 3-4 months" is the brief, and it is enforced here in
 *  code rather than asked for in a prompt. */
export const MAX_DOSSIER_AGE_DAYS = 120;
const NEWS_WINDOW_DAYS = Number(process.env.DOSSIER_NEWS_DAYS || MAX_DOSSIER_AGE_DAYS);

/** Same contract as research.js's withinWindow: no date means no trust. An
 *  item that cannot prove when it happened is how a 2023 headline reaches a
 *  2026 email. */
function withinWindow(pubDate, maxAgeDays, now = new Date()) {
  if (!pubDate) return false;
  const t = Date.parse(pubDate);
  if (Number.isNaN(t)) return false;
  const ageDays = (now - t) / 86400000;
  if (ageDays < -2) return false;
  return ageDays <= maxAgeDays;
}

function s(v, n = 300) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
function arr(v) { return Array.isArray(v) ? v : []; }

function cacheGet(bucket, key) {
  const c = globalThis[bucket] || (globalThis[bucket] = new Map());
  const hit = c.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.value;
  return undefined;
}
function cacheSet(bucket, key, value) {
  const c = globalThis[bucket] || (globalThis[bucket] = new Map());
  c.set(key, { value, at: Date.now() });
  return value;
}

/* ────────────────────────────────────────────────────────────────────────
   1. POSITIVE COMPANY NEWS, LAST 3-4 MONTHS, SOURCED AND DATED
   ────────────────────────────────────────────────────────────────────────
   Three hard constraints, all enforced in code after the call rather than
   asked for in the prompt, because a prompt constraint is a preference and a
   code constraint is a fact:

     DATED     — an item with no ISO date is dropped. "Recently" is how a
                 2023 shutdown reached a 2026 email.
     IN WINDOW — reuses withinWindow(), the same filter the RSS path uses.
     SOURCED   — the host must appear in the citation set (see keepSourced).

   POSITIVE-ONLY is judged, not filtered, and it is judged from the reader's
   side of the table: a rival's funding round is negative for them however
   upbeat the headline. That judgement stays in the model because it needs
   context; the three constraints above do not, so they do not stay there. */
async function companyNews(lead, companyIntel) {
  const company = s(lead.companyName, 120);
  if (!company) return { items: [], citations: [] };

  const instructions =
    `You are a corporate-development analyst preparing a briefing on one company. ` +
    `You search the web and report only what you actually read.\n\n` +
    `Find this company's GENUINE, POSITIVE, RECENT corporate developments: contracts and awards, ` +
    `funding, certifications, regulatory approvals, partnerships and joint ventures, product and ` +
    `technology launches, new facilities, capacity expansion, geographic expansion, major customer ` +
    `wins, senior hires, milestones.\n\n` +
    `POSITIVE IS JUDGED FROM THE COMPANY'S SIDE OF THE TABLE. A rival's win, a lawsuit, a probe, ` +
    `layoffs, a recall, a ban, a tariff, a downturn or any bad news about this company is NOT ` +
    `positive and must be omitted entirely, however neutral the wording. When unsure, omit.\n\n` +
    `DISAMBIGUATION: many companies share a name with an unrelated business, a ticker, or a sports ` +
    `team. Use the website and description below to confirm every item is about the RIGHT company. ` +
    `A confidently-reported item about the wrong company is the worst possible output.\n\n` +
    `DATES: report the publication date of each item as strict ISO YYYY-MM-DD. If you cannot ` +
    `establish a real date, omit the item. Do not estimate, do not infer from context, do not use today's date.`;

  const input =
    `Company: "${company}"\n` +
    `Website: ${lead.companyWebsite || "(unknown)"}\n` +
    `Sector label from our list (may be wrong): ${lead.industry || "-"}\n` +
    `What the company says it does: ${s(companyIntel.description, 500) || "(unknown)"}\n` +
    `Today's date: ${new Date().toISOString().slice(0, 10)}\n` +
    `WINDOW: only items published in the last ${NEWS_WINDOW_DAYS} days. Anything older is out of scope.\n\n` +
    `Return: {"items":[{"headline":"<what happened, one plain factual line, with the number or ` +
    `named counterparty intact>","date":"<YYYY-MM-DD>","url":"<the exact page you read this on>",` +
    `"why":"<one line: what this opens up for them commercially>"}]}\n` +
    `Up to 6 items, most significant first. If there is genuinely nothing positive in the window, ` +
    `return {"items":[]}. An empty list is a correct and useful answer.`;

  const { data, citations, error } = await groundedJSON(instructions, input, { contextSize: "medium" });
  const raw = arr(data && data.items).map((x) => ({
    headline: s(x.headline, 300),
    date: s(x.date, 10),
    url: s(x.url, 400),
    why: s(x.why, 240)
  })).filter((x) => x.headline);

  const sourced = keepSourced(raw, citations, { requireDate: true })
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
    .filter((x) => withinWindow(x.date, NEWS_WINDOW_DAYS))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 6);

  return { items: sourced, citations, error };
}

/* ────────────────────────────────────────────────────────────────────────
   2. THE PERSON
   ────────────────────────────────────────────────────────────────────────
   NOT a LinkedIn scrape. LinkedIn blocks automated access, and building
   scraping into a pipeline that runs on every row is both unreliable and a
   terms violation that puts the sending domain at risk. What actually works,
   and is what a human does anyway, is searching the public record: the
   profile's public summary as it appears in search results, the company's own
   leadership page, conference speaker bios, podcast and webinar appearances,
   press quotes, standards-body and working-group membership.

   That public record is what produced the strongest line in the ChatGPT
   dossier — "former USAF test pilot, commanded the 452d Flight Test Squadron,
   ex-CTO at NUAIR" — and none of it came from behind a login.

   SCOPE, and this is a hard rule in the prompt below: professional public
   record only. What they do, what they have run, what they speak about. This
   is a business email, not a background check, and personal detail in a cold
   email reads as surveillance rather than research. It is also the fastest
   way to get a domain blocked.

   If you have a Proxycurl / People Data Labs / Clay seat, that enrichment
   belongs here as an extra source. It is not required and is not assumed. */
async function personBrief(lead, companyIntel) {
  const first = s(lead.firstName, 60);
  const last = s(lead.lastName, 60);
  const company = s(lead.companyName, 120);
  const name = [first, last].filter(Boolean).join(" ");
  if (!name || !company) return { person: null, citations: [] };

  const instructions =
    `You research a named business professional's PUBLIC PROFESSIONAL RECORD so a consultant can ` +
    `write to them as a peer rather than as a stranger with a template.\n\n` +
    `SOURCES: the public summary of their professional profile as it appears in search results, ` +
    `their employer's own leadership or team page, conference and webinar speaker bios, panel ` +
    `listings, published interviews and press quotes, bylined articles, patents, standards bodies ` +
    `and industry working groups.\n\n` +
    `STRICT SCOPE, do not exceed it: current role and what it covers, previous roles and employers, ` +
    `professional background and domain expertise, topics they publicly speak or write about, ` +
    `industry bodies they sit on. NOTHING about their personal life, family, home, health, politics, ` +
    `religion, or anything outside their professional record. If a source offers it, ignore it.\n\n` +
    `IDENTITY: confirm the person you describe is at THIS company. Common names collide, and ` +
    `attributing a stranger's career to your recipient is instantly obvious and unrecoverable. ` +
    `If you cannot confirm identity with confidence, return nulls. Nulls are a correct answer here ` +
    `and are far better than a confident mismatch.`;

  const input =
    `Name: "${name}"\n` +
    `Title on our list (may be abbreviated or stale): "${s(lead.title, 120)}"\n` +
    `Company: "${company}"${lead.companyWebsite ? ` (${lead.companyWebsite})` : ""}\n` +
    `What the company does: ${s(companyIntel.description, 400) || "(unknown)"}\n\n` +
    `Return: {"confirmed":<true|false>,` +
    `"roleScope":"<one or two lines: what this seat actually owns day to day, in their industry's vocabulary>",` +
    `"background":"<one or two lines: the career that got them here, naming real prior employers and roles>",` +
    `"speaksAbout":["<a topic they publicly engage with>", ...0-4],` +
    `"credibility":"<one line: what would make this person take a stranger's email seriously, given who they are>",` +
    `"sources":[{"what":"<which claim above this supports>","url":"<the exact page you read>"}]}\n` +
    `If "confirmed" is false, set every other field to null or an empty list.`;

  const { data, citations, error } = await groundedJSON(instructions, input, {
    contextSize: "medium",
    timeoutMs: 45000
  });
  if (!data || data.confirmed !== true) return { person: null, citations, error };

  const sources = keepSourced(arr(data.sources).map((x) => ({
    what: s(x.what, 160), url: s(x.url, 400)
  })), citations);

  // A person brief with no surviving source is a memory, not research. The
  // whole value of this section is that it lets the email reference something
  // verifiable about the reader's career; an unsourced version of that is the
  // single most damaging thing this pipeline could send.
  if (!sources.length) return { person: null, citations, error };

  return {
    person: {
      roleScope: s(data.roleScope, 400),
      background: s(data.background, 400),
      speaksAbout: arr(data.speaksAbout).map((x) => s(x, 80)).filter(Boolean).slice(0, 4),
      credibility: s(data.credibility, 300),
      sources: sources.slice(0, 6)
    },
    citations,
    error
  };
}

/* ────────────────────────────────────────────────────────────────────────
   3. THE DOMAIN: WHAT MARKET, WHO ELSE, WHAT MOVED
   ────────────────────────────────────────────────────────────────────────
   deriveMarketContext already asks a model for competitors FROM MEMORY. That
   is fine as a search seed and unusable as a fact: it is how a shut-down
   company ends up named in a live email. This version searches, so the rivals
   are current and each one carries a URL.

   The `domainMoves` half is the piece with the highest reply rate attached to
   it and the piece the old pipeline most consistently failed to retrieve. The
   reader has complete information about their own company and almost none
   about the market around it. That asymmetry is the entire product. */
async function domainScan(lead, companyIntel, thesis) {
  const company = s(lead.companyName, 120);
  if (!company) return { domain: null, citations: [] };

  const instructions =
    `You are a market analyst. You search the web and report only what you read.\n\n` +
    `Establish (a) what market this company really competes in, correcting the sector label if it ` +
    `is wrong, (b) its real, currently-operating, named competitors, and (c) what has genuinely ` +
    `MOVED in that market in the last ${NEWS_WINDOW_DAYS} days.\n\n` +
    `THE SECTOR LABEL ON A PROSPECT LIST IS OFTEN WRONG AND IT IS THE MAIN CAUSE OF WORTHLESS ` +
    `OUTREACH. A company labelled "Aerospace" may be an aviation INSURER, whose market is hull ` +
    `rates, claims trends and reinsurance capacity, not rockets. Read what they actually sell and ` +
    `who pays them, then correct the label.\n\n` +
    `COMPETITORS must be companies selling a comparable thing to comparable buyers, verified as ` +
    `currently operating. Not customers, not suppliers, not investors, not large unrelated ` +
    `corporations that happen to appear nearby in the news. Omit any you cannot verify.\n\n` +
    `MARKET MOVES must be about the market, not about this company: a rival's launch or contract, ` +
    `a regulatory change, a procurement or standards shift, a demand or pricing move, a new ` +
    `entrant. Each needs a real ISO date within the window and the URL you read it on.`;

  const input =
    `Company: "${company}"\n` +
    `Website: ${lead.companyWebsite || "(unknown)"}\n` +
    `Sector label from our list (treat as a hint, override it if wrong): "${lead.industry || "-"}"\n` +
    `What they say they do: ${s(companyIntel.description, 500) || "(unknown)"}\n` +
    `${thesis && thesis.whatTheyAre ? `Our current read on them: ${s(thesis.whatTheyAre, 300)}\n` : ""}` +
    `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n` +
    `Return: {"market":"<3-8 words: the market as an analyst would name it>",` +
    `"sells":"<one plain line: what they sell>",` +
    `"buyers":"<one line: who writes the cheques and what those buyers are judged on>",` +
    `"competitors":[{"name":"<real company>","why":"<what they compete on>","url":"<page confirming they operate in this market>"}],` +
    `"domainMoves":[{"what":"<what happened in the market, factually, with names and numbers intact>",` +
    `"date":"<YYYY-MM-DD>","url":"<the exact page you read>",` +
    `"soWhat":"<one line: the concrete thing this changes for a company like theirs, a price, a renewal, a buyer requirement, a qualification>"}]}\n` +
    `Up to 5 competitors and up to 5 market moves. Omit anything unverified.`;

  const { data, citations, error } = await groundedJSON(instructions, input, { contextSize: "high" });
  if (!data) return { domain: null, citations, error };

  const competitors = keepSourced(arr(data.competitors).map((c) => ({
    name: s(c.name, 80), why: s(c.why, 200), url: s(c.url, 400)
  })).filter((c) => c.name && c.name.toLowerCase() !== company.toLowerCase()), citations).slice(0, 5);

  const domainMoves = keepSourced(arr(data.domainMoves).map((m) => ({
    what: s(m.what, 300), date: s(m.date, 10), url: s(m.url, 400), soWhat: s(m.soWhat, 240)
  })).filter((m) => m.what), citations, { requireDate: true })
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date))
    .filter((m) => withinWindow(m.date, NEWS_WINDOW_DAYS))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);

  return {
    domain: {
      market: s(data.market, 100),
      sells: s(data.sells, 240),
      buyers: s(data.buyers, 300),
      competitors,
      domainMoves
    },
    citations,
    error
  };
}

/* ────────────────────────────────────────────────────────────────────────
   4 + 5. THE FIT AND THE HOOKS
   ────────────────────────────────────────────────────────────────────────
   Deliberately NO web search on this call. Steps 1-3 are retrieval; this is
   reasoning over what was retrieved. Handing it a search tool at this point
   invites it to go and find supporting material for a hook it has already
   decided it likes, which is how unsourced claims get laundered into an
   otherwise-sourced dossier. Everything here must be derivable from the
   material above or it does not belong in the dossier. */
async function fitAndHooks(lead, companyIntel, thesis, news, person, domain) {
  const company = s(lead.companyName, 120);
  const first = s(lead.firstName, 60);

  const material = [
    `COMPANY: ${company} | ${lead.companyWebsite || "-"}`,
    `WHAT THEY DO (their own site): ${s(companyIntel.description, 500) || "(unknown)"}`,
    domain ? `MARKET: ${domain.market} | SELLS: ${domain.sells} | BUYERS: ${domain.buyers}` : "",
    domain && domain.competitors.length
      ? `VERIFIED COMPETITORS: ${domain.competitors.map((c) => `${c.name} (${c.why})`).join("; ")}` : "",
    news.length
      ? `THEIR RECENT POSITIVE NEWS:\n${news.map((n) => `- [${n.date}] ${n.headline} :: opens up: ${n.why}`).join("\n")}`
      : "THEIR RECENT POSITIVE NEWS: none found in the window.",
    domain && domain.domainMoves.length
      ? `RECENT MARKET MOVES:\n${domain.domainMoves.map((m) => `- [${m.date}] ${m.what} :: changes: ${m.soWhat}`).join("\n")}`
      : "RECENT MARKET MOVES: none found in the window.",
    person
      ? `THE PERSON: ${first} ${s(lead.lastName, 60)}, ${s(lead.title, 120)}\n  owns: ${person.roleScope}\n  background: ${person.background}\n  speaks about: ${person.speaksAbout.join(", ") || "-"}\n  what earns their attention: ${person.credibility}`
      : `THE PERSON: ${first} ${s(lead.lastName, 60)}, ${s(lead.title, 120)}. No public professional record confirmed, so do not reference their background at all.`,
    thesis && thesis.deliverables.length
      ? `OUR STANDING READ ON WHAT WE COULD SELL THEM:\n${thesis.deliverables.map((d) => `- ${d}`).join("\n")}`
      : ""
  ].filter(Boolean).join("\n\n");

  const system =
    `You are the sales head at Kings Research, a strategic market-intelligence and advisory firm. ` +
    `Kings Research sells DECISION SUPPORT: competitor tracking, segment and demand analysis, ` +
    `pricing and peer benchmarking, technology-adoption monitoring, regulatory intelligence, ` +
    `customer and white-space mapping, market-entry work, strategic advisory. It does NOT sell ` +
    `reports, subscriptions, software, or data feeds, and it never pitches a meeting.\n\n` +
    `You are handed a research pack on one prospect and you produce two things: what we could ` +
    `concretely sell this specific company, and the hooks worth opening on.\n\n` +
    `ABSOLUTE CONSTRAINT: use ONLY the material given. Every fact you reference must already be in ` +
    `it. Do not add a development, a statistic, a competitor, a date, or a market figure from your ` +
    `own knowledge, however confident you are. If the pack is thin, produce fewer and weaker hooks ` +
    `and say so. A thin honest dossier gets a human to intervene; a padded one gets sent.\n\n` +
    `A DELIVERABLE IS A NOUN SOMEONE CAN BUY, not a question you are guessing at. ` +
    `"Which of the three primes' sensor qualification lists a new line can reach, and on what ` +
    `evidence" is buyable. "Competitive positioning analysis" is a brochure. "How many partnerships ` +
    `may shift to a rival" is a guess. If it contains may, might, could or potential, rewrite it.\n\n` +
    `A HOOK IS EVIDENCE PLUS AN ASYMMETRY. The reader knows everything about their own company and ` +
    `almost nothing about the market around it. The strongest hook is therefore a verified market or ` +
    `competitor move plus the specific question it opens that they cannot answer from inside the ` +
    `building. Their own good news is a weaker hook and works only as a PREMISE you add to, never as ` +
    `congratulation. Rank accordingly.\n\n` +
    `Return ONLY valid JSON.`;

  const user =
    `${material}\n\n` +
    `Return:\n` +
    `{"krFit":[{"offer":"<a named, buyable Kings Research deliverable specific to THIS company>",` +
    `"because":"<the fact in the pack that makes it relevant now>"}],` +
    `"hooks":[{"hook":"<the angle, one line, as you would say it to the rep>",` +
    `"evidence":"<the exact fact from the pack it rests on, with its date>",` +
    `"whyItLands":"<why this specific person, in this seat, replies to this>",` +
    `"strength":"<strong|moderate|weak>"}],` +
    `"summary":"<4-6 sentences a rep can read in fifteen seconds before writing: who this company ` +
    `is, what just happened, who this person is, and the one angle to lead on. Plain prose, no bullets.>",` +
    `"gaps":["<what the research could not establish, so a human knows what to check>", ...0-3]}\n\n` +
    `4-6 krFit items. 3-5 hooks, strongest first. Be specific enough that this could not have been ` +
    `written about any other company in the sector.`;

  try {
    const out = await chatJSON(system, user, { temperature: 0.4, maxTokens: 1800 });
    const SPECULATIVE = /\b(may|might|could|potential(ly)?|possibly|perhaps)\b/i;
    return {
      krFit: arr(out.krFit).map((x) => ({
        offer: s(x.offer, 260), because: s(x.because, 240)
      })).filter((x) => x.offer.length > 15 && !SPECULATIVE.test(x.offer)).slice(0, 6),
      hooks: arr(out.hooks).map((x) => ({
        hook: s(x.hook, 260),
        evidence: s(x.evidence, 300),
        whyItLands: s(x.whyItLands, 240),
        strength: ["strong", "moderate", "weak"].includes(s(x.strength, 10).toLowerCase())
          ? s(x.strength, 10).toLowerCase() : "moderate"
      })).filter((x) => x.hook && x.evidence).slice(0, 5),
      summary: s(out.summary, 1400),
      gaps: arr(out.gaps).map((x) => s(x, 160)).filter(Boolean).slice(0, 3)
    };
  } catch {
    return { krFit: [], hooks: [], summary: "", gaps: ["fit/hook synthesis failed"] };
  }
}

/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Build the full dossier.
 *
 * CACHING SPLIT, and it matters on a real list: the company half (news,
 * domain) is cached per domain, the person half per email address. Three
 * contacts at DroneUp cost one company research pass and three cheap person
 * passes, not three of everything.
 *
 * PARALLELISM: the three retrieval calls are independent and run together.
 * Sequentially they were the difference between finishing inside the function
 * limit and returning Vercel's HTML error page to a client expecting JSON,
 * which is a failure this repo has already had once.
 *
 * DEGRADATION: with no search provider configured this returns a null-shaped
 * dossier immediately and the pipeline behaves exactly as it does today. The
 * dossier is an upgrade to the anchor, never a dependency of it.
 */
export async function buildDossier(lead, companyIntel = {}, thesis = null, { deadline = 0 } = {}) {
  if (!hasWebSearch()) return null;
  // The three searches plus synthesis need roughly 60-90 seconds. If the row
  // does not have that much budget left, skip research rather than start it
  // and be killed halfway: a null dossier degrades to the old behaviour, a
  // half-finished one kills the function and leaves the sheet row blank.
  //
  // On a Vercel Hobby plan (60s hard cap) this will skip EVERY time, which is
  // correct and is why maxDuration is 300 in both vercel.json and the route.
  if (deadline && deadline - Date.now() < 75000) return null;

  const companyKey = s(lead.companyWebsite || lead.companyName, 200).toLowerCase();
  const personKey = s(lead.email, 200).toLowerCase();

  const cachedCompany = companyKey ? cacheGet("__kc_dossierCompany", companyKey) : undefined;
  const cachedPerson = personKey ? cacheGet("__kc_dossierPerson", personKey) : undefined;

  const [newsRes, domainRes, personRes] = await Promise.all([
    cachedCompany ? Promise.resolve(cachedCompany.news) : companyNews(lead, companyIntel),
    cachedCompany ? Promise.resolve(cachedCompany.domain) : domainScan(lead, companyIntel, thesis),
    cachedPerson ? Promise.resolve(cachedPerson) : personBrief(lead, companyIntel)
  ]);

  if (companyKey && !cachedCompany) {
    cacheSet("__kc_dossierCompany", companyKey, { news: newsRes, domain: domainRes });
  }
  if (personKey && !cachedPerson) cacheSet("__kc_dossierPerson", personKey, personRes);

  const news = newsRes.items || [];
  const domain = domainRes.domain || null;
  const person = personRes.person || null;

  // Nothing survived the sourcing checks. Returning null rather than an empty
  // shell is deliberate: the caller then takes the existing no-dossier path
  // instead of writing an email around an empty research block, and Signal
  // says so plainly so the operator can see which rows found nothing.
  // WHY it is empty matters more than the fact. "The search errored" and "the
  // search ran and this company genuinely has no news" look identical in the
  // sheet and have completely different fixes: one is a config problem you
  // solve once, the other is a prospect you hand to a human.
  const errors = [newsRes.error, domainRes.error, personRes.error].filter(Boolean);
  if (!news.length && !person && (!domain || (!domain.competitors.length && !domain.domainMoves.length))) {
    return {
      empty: true, news: [], person: null, domain, krFit: [], hooks: [], summary: "",
      error: errors[0] || null,
      gaps: errors.length ? [`search failed: ${errors[0]}`] : ["search ran and returned nothing that survived sourcing"]
    };
  }

  const synth = await fitAndHooks(lead, companyIntel, thesis, news, person, domain);

  return {
    empty: false,
    news,
    person,
    domain,
    krFit: synth.krFit,
    hooks: synth.hooks,
    summary: synth.summary,
    gaps: synth.gaps,
    error: errors[0] || null,
    builtAt: new Date().toISOString().slice(0, 10)
  };
}

/**
 * The dossier as the COPYWRITER sees it: a block appended to the prompt
 * context. Deliberately not the same as the human-readable version below.
 *
 * The rules embedded here are the ones the sample output broke. "Real-time
 * compliance solutions that enhance operational efficiency are a priority for
 * your customers" is not a sentence anyone wrote on purpose; it is what a
 * model produces when asked to sound informed with nothing to be informed
 * about. Naming the material and forbidding anything outside it is the fix.
 */
export function dossierBlock(d, companyName = "") {
  if (!d || d.empty) return "";
  const L = [];
  L.push("═══ VERIFIED RESEARCH DOSSIER ═══");
  L.push("Every item below was retrieved from a named source in the last four months and survived a sourcing check. This is the ONLY external material you may state as fact. Anything not in this block, however certain you feel about it, is invented and must not appear.");

  if (d.news.length) {
    L.push("");
    L.push(`WHAT HAS GONE WELL AT ${companyName || "THIS COMPANY"} RECENTLY (dated, sourced):`);
    d.news.forEach((n) => L.push(`- [${n.date}] ${n.headline}${n.why ? ` (opens up: ${n.why})` : ""}`));
  }
  if (d.domain) {
    L.push("");
    L.push(`MARKET: ${d.domain.market || "-"}`);
    if (d.domain.sells) L.push(`WHAT THEY SELL: ${d.domain.sells}`);
    if (d.domain.buyers) L.push(`WHO PAYS THEM AND WHAT THOSE BUYERS ARE JUDGED ON: ${d.domain.buyers}`);
    if (d.domain.competitors.length) {
      L.push(`VERIFIED COMPETITORS (these are real and current, you may name them; you may NOT name any other): ${d.domain.competitors.map((c) => c.name).join(", ")}`);
    }
    if (d.domain.domainMoves.length) {
      L.push("");
      L.push("WHAT MOVED IN THEIR MARKET (dated, sourced). THIS IS YOUR STRONGEST MATERIAL: the reader already knows their own news and has almost no visibility into these. That asymmetry is the entire reason this email is worth their time.");
      d.domain.domainMoves.forEach((m) => L.push(`- [${m.date}] ${m.what} :: changes for them: ${m.soWhat}`));
    }
  }
  if (d.person) {
    L.push("");
    L.push("THE READER (public professional record, verified):");
    if (d.person.roleScope) L.push(`- what this seat owns: ${d.person.roleScope}`);
    if (d.person.background) L.push(`- career: ${d.person.background}`);
    if (d.person.speaksAbout.length) L.push(`- publicly engages with: ${d.person.speaksAbout.join(", ")}`);
    L.push("USE THIS TO SET THE REGISTER, NOT AS CONTENT. Write to the technical depth this person operates at and skip what they obviously already know. You may reference their background at most ONCE, in a single clause, and only where it genuinely bears on the point. Listing their career back to them is flattery, and a senior reader deletes it.");
  }
  if (d.krFit.length) {
    L.push("");
    L.push("WHAT KINGS RESEARCH COULD ACTUALLY DO FOR THEM (drawn from the above; the Email 1 bullets must come from this list, not be invented):");
    d.krFit.forEach((k) => L.push(`- ${k.offer}`));
  }
  if (d.hooks.length) {
    L.push("");
    L.push("RANKED HOOKS (the top one is your Email 1 anchor unless a proprietary Kings Research finding is supplied, which outranks everything):");
    d.hooks.forEach((h, i) => L.push(`${i + 1}. [${h.strength}] ${h.hook}\n   evidence: ${h.evidence}\n   why it lands with this reader: ${h.whyItLands}`));
  }
  return L.join("\n");
}

/**
 * The dossier as a HUMAN sees it. This is the artefact to paste into Slack,
 * hand to a rep before a call, or read before approving a row. It is also the
 * thing that makes the research auditable: if an email says something odd, the
 * dossier shows whether the research was wrong or the copywriter was.
 */
export function dossierMarkdown(lead, d) {
  if (!d) return "";
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const L = [`# ${name} — ${lead.companyName}`, `${lead.title || ""} | ${lead.email || ""}`, ""];
  if (d.empty) {
    if (d.error) {
      L.push(`**The search did not run successfully.** \`${d.error}\``);
      L.push("");
      L.push("This is a configuration or API problem, not a fact about this prospect. Every row in the run will look like this until it is fixed. Check `OPENAI_API_KEY` and `RESEARCH_MODEL` in the Vercel environment, then re-run one row with `npm run dossier` to confirm before reprocessing the sheet.");
    } else {
      L.push("**No sourced research returned.** The search ran and nothing cleared the sourcing bar for this prospect inside the window. Do not send a generated email on this row without adding material by hand.");
    }
    return L.join("\n");
  }
  if (d.summary) { L.push("## Summary"); L.push(d.summary); L.push(""); }

  L.push("## 1. Recent positive news");
  if (d.news.length) d.news.forEach((n) => L.push(`- **${n.date}** — ${n.headline}${n.why ? `\n  - Opens up: ${n.why}` : ""}\n  - Source: ${n.url}`));
  else L.push("- None found in the window.");

  L.push("");
  L.push("## 2. The person");
  if (d.person) {
    L.push(`- **Owns:** ${d.person.roleScope}`);
    L.push(`- **Background:** ${d.person.background}`);
    if (d.person.speaksAbout.length) L.push(`- **Speaks about:** ${d.person.speaksAbout.join(", ")}`);
    if (d.person.credibility) L.push(`- **What earns their attention:** ${d.person.credibility}`);
    d.person.sources.forEach((s2) => L.push(`  - Source: ${s2.url}`));
  } else L.push("- No public professional record confirmed. Do not reference their background.");

  L.push("");
  L.push("## 3. Domain, competitors, what moved");
  if (d.domain) {
    L.push(`- **Market:** ${d.domain.market}`);
    L.push(`- **Sells:** ${d.domain.sells}`);
    L.push(`- **Buyers:** ${d.domain.buyers}`);
    if (d.domain.competitors.length) {
      L.push("- **Competitors:**");
      d.domain.competitors.forEach((c) => L.push(`  - ${c.name} — ${c.why} (${c.url})`));
    }
    if (d.domain.domainMoves.length) {
      L.push("- **Recent market moves:**");
      d.domain.domainMoves.forEach((m) => L.push(`  - **${m.date}** — ${m.what}\n    - Changes: ${m.soWhat}\n    - Source: ${m.url}`));
    }
  } else L.push("- Not established.");

  L.push("");
  L.push("## 4. How Kings Research helps");
  if (d.krFit.length) d.krFit.forEach((k) => L.push(`- **${k.offer}**\n  - Because: ${k.because}`));
  else L.push("- Not established.");

  L.push("");
  L.push("## 5. Hooks, ranked");
  if (d.hooks.length) d.hooks.forEach((h, i) => L.push(`${i + 1}. **[${h.strength}]** ${h.hook}\n   - Evidence: ${h.evidence}\n   - Why it lands: ${h.whyItLands}`));
  else L.push("- None.");

  if (d.gaps && d.gaps.length) {
    L.push("");
    L.push("## Gaps (check these before sending)");
    d.gaps.forEach((g) => L.push(`- ${g}`));
  }
  return L.join("\n");
}

/** Compact form for the sheet's Signal column. */
export function dossierSignal(d) {
  if (!d) return "";
  if (d.empty) {
    return d.error
      ? `dossier: SEARCH FAILED (${String(d.error).slice(0, 90)})`
      : "dossier: empty (search ran, this prospect genuinely had nothing)";
  }
  const bits = [];
  if (d.news.length) bits.push(`${d.news.length} news`);
  if (d.domain && d.domain.domainMoves.length) bits.push(`${d.domain.domainMoves.length} market moves`);
  if (d.domain && d.domain.competitors.length) bits.push(`${d.domain.competitors.length} rivals`);
  if (d.person) bits.push("person confirmed");
  const top = d.hooks.length ? ` | top hook: ${d.hooks[0].hook}` : "";
  return `dossier: ${bits.join(", ") || "thin"}${top}`;
}
