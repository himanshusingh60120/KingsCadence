/**
 * JOB TITLE (JT) GATE
 * ──────────────────────────────────────────────────────────────────────────
 * Only prospects inside the approved title bracket are worth generating for.
 * Everything else is written back as "Not present in JT" and never consumes
 * a research call or an OpenAI call.
 *
 * The bracket has two doors, and a lead only needs to pass ONE:
 *
 *   DOOR 1 - Named title. One of the explicitly approved titles (Head of
 *            Strategy, VP Market Intelligence, CMO, ...). These bypass the
 *            seniority floor because the list already encodes the seniority
 *            that was intended (e.g. "Competitive Intelligence Analyst" is
 *            approved by name even though Analyst sits below Manager).
 *
 *   DOOR 2 - Function + seniority. The title/department falls in an approved
 *            function family (Strategy, Insights, Marketing, Product,
 *            Procurement, Data & Analytics, Commercial/BD, Expansion,
 *            Exec leadership) AND clears that family's seniority floor.
 *
 * The floors differ per family on purpose, taken from the approved list:
 * Marketing was only ever approved at Director+ (CMO, VP/Director Marketing),
 * while Product was approved down to Product Manager. A single global
 * "Manager+" floor would have let Marketing Managers through.
 */

// ── Seniority ─────────────────────────────────────────────────────────────
export const RANK = {
  CXO: 5,      // CEO, COO, CMO, CCO, Chief <X> Officer, Founder, President, MD
  HEAD_VP: 4,  // VP, SVP, EVP, Head of, Global Head, Chief (non-officer)
  DIRECTOR: 3, // Director, Senior Director, Associate Director
  MANAGER: 2,  // Manager, Senior Manager, Lead, Principal
  IC: 1,       // Analyst, Specialist, Executive (junior sense), Associate
  UNKNOWN: 0
};

export const RANK_LABEL = { 5: "CXO", 4: "Head/VP", 3: "Director", 2: "Manager", 1: "IC", 0: "unknown" };

// Titles that must never pass, whatever else they contain. These are the
// junior / irrelevant-function shapes that leak in from list vendors.
const HARD_DENY = [
  /\b(intern|internship|trainee|apprentice|student|fresher|graduate\s+program)\b/i,
  /\bexecutive\s+assistant\b/i,
  /\b(personal|virtual)\s+assistant\b/i,
  /\b(recruiter|talent\s+acquisition|hr\b|human\s+resources|payroll|benefits)\b/i,
  /\b(receptionist|office\s+manager|facilities|janitor|driver|technician)\b/i,
  /\b(sdr|bdr)\b/i,
  /\b(sales\s+development\s+rep|business\s+development\s+rep)/i,
  /\b(account\s+executive|account\s+manager|territory\s+manager|inside\s+sales|field\s+sales)\b/i,
  /\b(customer\s+(service|support|success)\s+(rep|representative|agent|associate))\b/i,
  /\b(software|qa|test|network|devops|support)\s+engineer\b/i,
  /\b(professor|lecturer|researcher\s+at|phd\s+candidate)\b/i,
  /\b(freelance|consultant\s+at\s+self|self[-\s]employed|retired|seeking|open\s+to\s+work)\b/i
];

// ── DOOR 1: the approved title list, verbatim from the brief ───────────────
// Each entry is [label, regex]. Order matters only for reporting.
const APPROVED_TITLES = [
  ["Head of Strategy",                 /\bhead\b.{0,25}\bstrateg/i],
  ["Corporate Strategy (Dir/Mgr)",     /\b(director|manager|dir\.?|mgr\.?)\b.{0,30}\b(corporate|corp)\s+strateg/i],
  ["Corporate Strategy (Dir/Mgr)",     /\bcorporate\s+strateg\w*\b.{0,20}\b(director|manager|lead)\b/i],
  ["VP/Dir Market Intelligence",       /\b(vp|v\.p\.|vice\s+president|director|head)\b.{0,30}\bmarket\s+intelligence\b/i],
  ["Market Intelligence",              /\bmarket\s+intelligence\b.{0,20}\b(director|manager|head|lead|vp)\b/i],
  ["Director Business Insights",       /\b(director|head|vp|manager)\b.{0,30}\bbusiness\s+insight/i],
  ["Strategy & Planning Lead",         /\bstrateg\w*\s*(&|and|\/|,)?\s*planning\b.{0,20}\b(lead|head|director|manager|vp)\b/i],
  ["Strategy & Planning Lead",         /\b(lead|head|director|manager|vp)\b.{0,25}\bstrateg\w*\s*(&|and|\/)\s*planning\b/i],
  ["Market Research Manager",          /\bmarket\s+research\b.{0,20}\b(manager|director|head|lead|vp)\b/i],
  ["Market Research Manager",          /\b(manager|director|head|lead|vp)\b.{0,20}\bmarket\s+research\b/i],
  ["Competitive Intelligence",         /\bcompetit\w*\s+intelligence\b/i],
  ["CMO",                              /\bchief\s+marketing\s+officer\b|\bcmo\b/i],
  ["VP/Dir Marketing",                 /\b(vp|v\.p\.|svp|evp|vice\s+president|director|head)\b.{0,30}\bmarketing\b/i],
  ["VP/Dir Product Marketing",         /\bproduct\s+marketing\b.{0,20}\b(director|head|vp|manager|lead)\b/i],
  ["Head of Product Strategy",         /\bproduct\s+strateg/i],
  ["Dir Customer/Consumer Insights",   /\b(customer|consumer|market|shopper)\s+insight/i],
  ["Product Manager/Director",         /\b(product)\b.{0,15}\b(manager|director|head|lead|owner)\b/i],
  ["Product Manager/Director",         /\b(director|head|vp)\b.{0,20}\bproduct\b/i],
  ["CEO/COO",                          /\bchief\s+(executive|operating)\s+officer\b|\bceo\b|\bcoo\b/i],
  ["Chief Commercial Officer",         /\bchief\s+commercial\s+officer\b|\bcco\b/i],
  ["VP/Dir Business Development",      /\b(vp|v\.p\.|svp|evp|vice\s+president|director|head)\b.{0,30}\bbusiness\s+development\b/i],
  ["Head of Global Expansion",         /\b(global|international)\s+(expansion|strateg|growth|markets?|business)\b/i],
  ["Head of Global Expansion",         /\b(expansion|market\s+entry)\b.{0,20}\b(head|director|vp|lead)\b/i],
  ["Chief Strategy Officer",           /\bchief\s+strategy\s+officer\b|\bcso\b/i],
  ["On-demand Data & Analytics",       /\b(data\s*(&|and|\/)?\s*analytics|analytics)\b.{0,20}\b(head|director|vp|manager|lead)\b/i],
  ["On-demand Data & Analytics",       /\b(head|director|vp|manager|lead)\b.{0,25}\b(data\s*(&|and|\/)?\s*analytics)\b/i]
];

// ── DOOR 2: function families and their seniority floors ──────────────────
const FAMILIES = [
  {
    key: "STRATEGY",
    floor: RANK.MANAGER,
    test: /\b(strateg\w*|corporate\s+development|corp\s+dev|business\s+planning|strategic\s+planning|corporate\s+planning|business\s+strategy|m&a)\b/i
  },
  {
    key: "INSIGHTS",
    floor: RANK.MANAGER,
    test: /\b(market\s+intelligence|competit\w*\s+intelligence|market\s+research|consumer\s+insight\w*|customer\s+insight\w*|business\s+insight\w*|market\s+insight\w*|insights?|business\s+intelligence|market\s+analysis|research\s*(&|and)\s*insight)\b/i
  },
  {
    key: "MARKETING",
    floor: RANK.DIRECTOR, // approved list only ever named CMO / VP / Director
    test: /\b(marketing|brand|demand\s+gen\w*|growth\s+marketing|go[-\s]to[-\s]market|gtm)\b/i
  },
  {
    key: "PRODUCT",
    floor: RANK.MANAGER,
    test: /\b(product|portfolio|pricing\s+strategy)\b/i
  },
  {
    key: "PROCUREMENT",
    floor: RANK.MANAGER,
    test: /\b(procurement|purchasing|sourcing|category\s+management|vendor\s+management|supply\s+management|indirect\s+spend)\b/i
  },
  {
    key: "DATA_ANALYTICS",
    floor: RANK.MANAGER,
    test: /\b(data\s*(&|and|\/)?\s*analytics|analytics|data\s+science|data\s+strategy|decision\s+science)\b/i
  },
  {
    key: "COMMERCIAL",
    floor: RANK.DIRECTOR, // approved list: VP/Dir BD and Chief Commercial Officer
    test: /\b(business\s+development|commercial|partnerships?|alliances|corporate\s+ventures)\b/i
  },
  {
    key: "EXPANSION",
    floor: RANK.DIRECTOR,
    test: /\b(global\s+expansion|international\s+(strateg|business|expansion|markets?)|market\s+entry|new\s+markets?|geo\w*\s+expansion)\b/i
  },
  {
    key: "EXEC",
    floor: RANK.CXO,
    // (?<!vice\s) keeps "Area Vice President" out of the EXEC family.
    test: /\b(chief\s+executive|chief\s+operating|ceo|coo|(?<!vice\s)president|founder|co[-\s]?founder|owner|managing\s+director|general\s+manager|proprietor)\b/i
  }
];

// Department names that map onto an approved family, used when the title
// itself is vague ("Director" with department "Corporate Strategy").
const DEPT_FAMILIES = [
  [/\bstrateg|corporate\s+development|planning\b/i, "STRATEGY"],
  [/\binsight|intelligence|research\b/i, "INSIGHTS"],
  [/\bmarketing|brand\b/i, "MARKETING"],
  [/\bproduct\b/i, "PRODUCT"],
  [/\bprocurement|purchasing|sourcing|supply\b/i, "PROCUREMENT"],
  [/\banalytics|data\b/i, "DATA_ANALYTICS"],
  [/\bbusiness\s+development|commercial\b/i, "COMMERCIAL"],
  [/\bexecutive|leadership|board|c[-\s]?suite\b/i, "EXEC"]
];

// ── Japanese titles ───────────────────────────────────────────────────────
// The Japan list is a real segment for Kings Research and English regexes
// miss it entirely. 経営企画 (corporate planning) is the true strategy seat
// in a Japanese org and carries far more internal weight than the US
// equivalent, so it is treated as a first-class approved function.
const JP_RANK = [
  [/社長|代表取締役|CEO|最高経営責任者|会長/, RANK.CXO],
  [/執行役員|取締役|本部長|事業部長|統括/, RANK.HEAD_VP],
  [/部長|ディレクター/, RANK.DIRECTOR],
  [/課長|マネージャー|マネジャー|係長|リーダー/, RANK.MANAGER],
  [/主任|担当|アナリスト/, RANK.IC]
];
const JP_FAMILY = [
  [/経営企画|事業企画|戦略/, "STRATEGY"],
  [/市場調査|マーケットリサーチ|競合|インサイト|市場分析/, "INSIGHTS"],
  [/マーケティング|宣伝|広報戦略/, "MARKETING"],
  [/商品企画|製品企画|プロダクト/, "PRODUCT"],
  [/購買|調達|仕入/, "PROCUREMENT"],
  [/データ|analytics|分析/i, "DATA_ANALYTICS"],
  [/事業開発|営業企画|海外事業/, "COMMERCIAL"],
  [/海外展開|グローバル/, "EXPANSION"]
];

function hasJapanese(s) {
  return /[\u3040-\u30ff\u4e00-\u9faf]/.test(s || "");
}

/** Seniority rank from a free-text job title. */
export function seniorityRank(title) {
  const t = ` ${String(title || "").toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ")} `;
  if (!t.trim()) return RANK.UNKNOWN;

  if (hasJapanese(title)) {
    for (const [re, rank] of JP_RANK) if (re.test(title)) return rank;
  }

  // CXO first: "Chief <anything> Officer" and the common acronyms. Checked
  // before the junior "officer" rule so "Chief Procurement Officer" != IC.
  if (/\bchief\b.{0,30}\bofficer\b/.test(t)) return RANK.CXO;
  if (/\b(ceo|coo|cmo|cco|cso|cro|cpo|cdo|cio|cto|cfo|cxo)\b/.test(t)) return RANK.CXO;
  // "president" only counts as CXO when it is NOT part of "vice president".
  // "Area Vice President" was being read as EXEC/CXO and rejected for failing
  // a CXO floor, when it is a Head/VP with no in-scope function.
  if (/\bvice president\b/.test(t)) return RANK.HEAD_VP;
  if (/\b(founder|co founder|cofounder|owner|proprietor|managing director|managing partner|president|chairman|chairwoman)\b/.test(t)) return RANK.CXO;

  if (/\b(evp|svp|vp|v p|vice president|executive vice president|senior vice president)\b/.test(t)) return RANK.HEAD_VP;
  // "Head of X" / "Global Head" / "Group Head". Not "Head Chef" style noise.
  if (/\b(head of|global head|group head|regional head|head,|head -)\b/.test(t)) return RANK.HEAD_VP;
  if (/\bhead\b/.test(t) && /\b(strateg|marketing|product|insight|intelligence|research|procurement|analytics|commercial|business)\b/.test(t)) return RANK.HEAD_VP;
  if (/\bchief\b/.test(t)) return RANK.HEAD_VP;

  if (/\b(director|dir|directeur|直属)\b/.test(t)) return RANK.DIRECTOR;
  if (/\b(manager|mgr|lead|leader|principal|superintendent)\b/.test(t)) return RANK.MANAGER;

  // Junior shapes. "Executive" here is the India/UK junior sense
  // ("Marketing Executive"); the senior senses were caught above.
  if (/\b(analyst|specialist|associate|coordinator|assistant|officer|executive|consultant|engineer|scientist|administrator|representative|agent|advisor)\b/.test(t)) return RANK.IC;

  return RANK.UNKNOWN;
}

/** Seniority from the sheet's own `level` / seniority column, as a fallback. */
export function rankFromLevel(level) {
  const l = String(level || "").toLowerCase();
  if (!l.trim()) return RANK.UNKNOWN;
  if (/c[-_\s]?level|cxo|c[-_\s]?suite|owner|founder|partner|chief/.test(l)) return RANK.CXO;
  if (/vp|vice president|head/.test(l)) return RANK.HEAD_VP;
  if (/director/.test(l)) return RANK.DIRECTOR;
  if (/manager|lead/.test(l)) return RANK.MANAGER;
  if (/senior|entry|intern|staff|individual|analyst/.test(l)) return RANK.IC;
  return RANK.UNKNOWN;
}

function familiesFor(title, department) {
  const found = new Set();
  const t = String(title || "");
  const d = String(department || "");
  for (const f of FAMILIES) if (f.test.test(t)) found.add(f.key);
  if (hasJapanese(t + d)) {
    for (const [re, key] of JP_FAMILY) if (re.test(t) || re.test(d)) found.add(key);
  }
  // Department only opens a family when the title did not name one itself.
  if (!found.size) {
    for (const [re, key] of DEPT_FAMILIES) if (re.test(d)) found.add(key);
  }
  return [...found];
}

function floorFor(key) {
  const f = FAMILIES.find((x) => x.key === key);
  return f ? f.floor : RANK.DIRECTOR;
}

/**
 * The gate. Returns:
 *   { inJT: true,  matched: "<why it passed>", rank, rankLabel, families }
 *   { inJT: false, reason: "<why it failed>",  rank, rankLabel, families }
 *
 * Callers write `Not present in JT` to the Status column on a false, and skip
 * all research + generation for that row.
 */
export function jobTitleGate(lead = {}) {
  const title = String(lead.title || "").replace(/\s+/g, " ").trim();
  const department = String(lead.department || "").trim();
  const level = String(lead.level || "").trim();

  if (!title && !department) {
    return { inJT: false, reason: "no job title on the row", rank: 0, rankLabel: "unknown", families: [] };
  }

  for (const re of HARD_DENY) {
    if (re.test(title)) {
      return {
        inJT: false,
        reason: `excluded title pattern (${(title.match(re) || [""])[0].trim()})`,
        rank: seniorityRank(title), rankLabel: RANK_LABEL[seniorityRank(title)], families: []
      };
    }
  }

  // Rank: prefer what the title says; fall back to the sheet's level column.
  let rank = seniorityRank(title);
  if (rank === RANK.UNKNOWN) rank = rankFromLevel(level);

  // DOOR 1 - explicitly approved title.
  for (const [label, re] of APPROVED_TITLES) {
    if (re.test(title)) {
      return { inJT: true, matched: `approved title: ${label}`, rank, rankLabel: RANK_LABEL[rank], families: familiesFor(title, department) };
    }
  }

  // DOOR 2 - approved function family + that family's seniority floor.
  const families = familiesFor(title, department);
  if (!families.length) {
    return { inJT: false, reason: `function not in scope (${title || department})`, rank, rankLabel: RANK_LABEL[rank], families: [] };
  }

  const passing = families.filter((k) => rank >= floorFor(k));
  if (passing.length) {
    return { inJT: true, matched: `${passing[0]} @ ${RANK_LABEL[rank]}`, rank, rankLabel: RANK_LABEL[rank], families };
  }

  const needed = Math.min(...families.map(floorFor));
  return {
    inJT: false,
    reason: `${families[0]} below seniority floor (is ${RANK_LABEL[rank]}, needs ${RANK_LABEL[needed]}+)`,
    rank, rankLabel: RANK_LABEL[rank], families
  };
}

/** The exact string written to the Status column for out-of-bracket rows. */
export const NOT_IN_JT = "Not present in JT";

/**
 * Rows whose title field is not actually a title. On real purchased lists a
 * large share of the job_title column contains a department ("Aerospace"), a
 * software product ("Aras PLM"), a team name ("Airspace Innovation"), or a
 * bare function with no seniority word ("Business Development").
 *
 * Those are RECOVERABLE. Andy Thurling at DroneUp under "Airspace Innovation"
 * is a genuinely senior prospect; binning him identically to a Marketing
 * Manager who is correctly out of scope throws away real pipeline. They get
 * their own status so they can be routed to a re-enrichment pass instead of
 * being deleted.
 */
export const NEEDS_ENRICHMENT = "Needs enrichment: unparseable title";

export function isUnparseableTitle(lead = {}) {
  const title = String(lead.title || "").replace(/\s+/g, " ").trim();
  if (!title) return false;                       // blank is its own reason
  if (seniorityRank(title) !== RANK.UNKNOWN) return false;  // has a seniority word
  if (rankFromLevel(lead.level) !== RANK.UNKNOWN) return false; // sheet knows the level
  for (const re of HARD_DENY) if (re.test(title)) return false;  // genuinely wrong, not vague

  const words = title.split(/[\s,\/&-]+/).filter(Boolean);
  // Short, seniority-free strings are almost always a department or a product
  // name rather than a person's actual title.
  return words.length <= 3;
}
