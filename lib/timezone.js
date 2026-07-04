// lib/timezone.js
// Maps a prospect's country (refined by state for multi-timezone countries)
// to an IANA timezone. Every value below exists in the approved timezone list
// (timezone.csv - "Timezone (use this)" column), so whatever this returns is
// safe to paste into the sending tool.

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (Côte d'Ivoire, Türkiye…)
    .toLowerCase()
    .replace(/[.'\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ---------- United States (state / abbreviation -> tz) ----------
const US_STATE_TZ = {
  // Eastern
  ct: "America/New_York", connecticut: "America/New_York",
  de: "America/New_York", delaware: "America/New_York",
  fl: "America/New_York", florida: "America/New_York",
  ga: "America/New_York", georgia: "America/New_York",
  in: "America/Indianapolis", indiana: "America/Indianapolis",
  ky: "America/New_York", kentucky: "America/New_York",
  me: "America/New_York", maine: "America/New_York",
  md: "America/New_York", maryland: "America/New_York",
  ma: "America/New_York", massachusetts: "America/New_York",
  mi: "America/Detroit", michigan: "America/Detroit",
  nh: "America/New_York", "new hampshire": "America/New_York",
  nj: "America/New_York", "new jersey": "America/New_York",
  ny: "America/New_York", "new york": "America/New_York",
  nc: "America/New_York", "north carolina": "America/New_York",
  oh: "America/New_York", ohio: "America/New_York",
  pa: "America/New_York", pennsylvania: "America/New_York",
  ri: "America/New_York", "rhode island": "America/New_York",
  sc: "America/New_York", "south carolina": "America/New_York",
  vt: "America/New_York", vermont: "America/New_York",
  va: "America/New_York", virginia: "America/New_York",
  wv: "America/New_York", "west virginia": "America/New_York",
  dc: "America/New_York", "district of columbia": "America/New_York",
  "washington dc": "America/New_York",
  // Central
  al: "America/Chicago", alabama: "America/Chicago",
  ar: "America/Chicago", arkansas: "America/Chicago",
  il: "America/Chicago", illinois: "America/Chicago",
  ia: "America/Chicago", iowa: "America/Chicago",
  ks: "America/Chicago", kansas: "America/Chicago",
  la: "America/Chicago", louisiana: "America/Chicago",
  mn: "America/Chicago", minnesota: "America/Chicago",
  ms: "America/Chicago", mississippi: "America/Chicago",
  mo: "America/Chicago", missouri: "America/Chicago",
  ne: "America/Chicago", nebraska: "America/Chicago",
  nd: "America/Chicago", "north dakota": "America/Chicago",
  ok: "America/Chicago", oklahoma: "America/Chicago",
  sd: "America/Chicago", "south dakota": "America/Chicago",
  tn: "America/Chicago", tennessee: "America/Chicago",
  tx: "America/Chicago", texas: "America/Chicago",
  wi: "America/Chicago", wisconsin: "America/Chicago",
  // Mountain
  az: "America/Phoenix", arizona: "America/Phoenix",
  co: "America/Denver", colorado: "America/Denver",
  id: "America/Boise", idaho: "America/Boise",
  mt: "America/Denver", montana: "America/Denver",
  nm: "America/Denver", "new mexico": "America/Denver",
  ut: "America/Denver", utah: "America/Denver",
  wy: "America/Denver", wyoming: "America/Denver",
  // Pacific
  ca: "America/Los_Angeles", california: "America/Los_Angeles",
  nv: "America/Los_Angeles", nevada: "America/Los_Angeles",
  or: "America/Los_Angeles", oregon: "America/Los_Angeles",
  wa: "America/Los_Angeles", washington: "America/Los_Angeles",
  // Alaska / Hawaii
  ak: "America/Anchorage", alaska: "America/Anchorage",
  hi: "Pacific/Honolulu", hawaii: "Pacific/Honolulu",
  // Territories
  pr: "America/Puerto_Rico", "puerto rico": "America/Puerto_Rico",
  gu: "Pacific/Guam", guam: "Pacific/Guam"
};

// ---------- Canada (province -> tz) ----------
const CA_PROVINCE_TZ = {
  bc: "America/Vancouver", "british columbia": "America/Vancouver",
  ab: "America/Edmonton", alberta: "America/Edmonton",
  sk: "America/Regina", saskatchewan: "America/Regina",
  mb: "America/Winnipeg", manitoba: "America/Winnipeg",
  on: "America/Toronto", ontario: "America/Toronto",
  qc: "America/Montreal", quebec: "America/Montreal",
  nb: "America/Halifax", "new brunswick": "America/Halifax",
  ns: "America/Halifax", "nova scotia": "America/Halifax",
  pe: "America/Halifax", "prince edward island": "America/Halifax",
  nl: "America/St_Johns", "newfoundland and labrador": "America/St_Johns",
  newfoundland: "America/St_Johns",
  yt: "America/Vancouver", yukon: "America/Vancouver",
  nt: "America/Edmonton", "northwest territories": "America/Edmonton",
  nu: "America/Winnipeg", nunavut: "America/Winnipeg"
};

// ---------- Australia (state -> tz) ----------
const AU_STATE_TZ = {
  wa: "Australia/Perth", "western australia": "Australia/Perth",
  nt: "Australia/Darwin", "northern territory": "Australia/Darwin",
  sa: "Australia/Adelaide", "south australia": "Australia/Adelaide",
  qld: "Australia/Brisbane", queensland: "Australia/Brisbane",
  nsw: "Australia/Sydney", "new south wales": "Australia/Sydney",
  act: "Australia/Sydney", "australian capital territory": "Australia/Sydney",
  vic: "Australia/Melbourne", victoria: "Australia/Melbourne",
  tas: "Australia/Hobart", tasmania: "Australia/Hobart"
};

// ---------- Country -> tz (main business timezone) ----------
const COUNTRY_TZ = {
  // North America
  "united states": "America/New_York", usa: "America/New_York",
  us: "America/New_York", "united states of america": "America/New_York",
  america: "America/New_York",
  canada: "America/Toronto",
  mexico: "America/Mexico_City",
  // LATAM
  brazil: "America/Sao_Paulo", brasil: "America/Sao_Paulo",
  argentina: "America/Buenos_Aires",
  chile: "America/Santiago",
  colombia: "America/Bogota",
  peru: "America/Lima",
  venezuela: "America/Caracas",
  ecuador: "America/Guayaquil",
  bolivia: "America/La_Paz",
  paraguay: "America/Asuncion",
  uruguay: "America/Montevideo",
  guyana: "America/Guyana",
  suriname: "America/Paramaribo",
  panama: "America/Panama",
  "costa rica": "America/Costa_Rica",
  guatemala: "America/Guatemala",
  honduras: "America/Tegucigalpa",
  nicaragua: "America/Managua",
  "el salvador": "America/El_Salvador",
  belize: "America/Belize",
  // Caribbean
  "dominican republic": "America/Santo_Domingo",
  "puerto rico": "America/Puerto_Rico",
  jamaica: "America/Jamaica",
  cuba: "America/Havana",
  haiti: "America/Port-au-Prince",
  "trinidad and tobago": "America/Port_of_Spain",
  trinidad: "America/Port_of_Spain",
  bahamas: "America/Nassau",
  barbados: "America/Barbados",
  bermuda: "Atlantic/Bermuda",
  aruba: "America/Aruba",
  curacao: "America/Curacao",
  "cayman islands": "America/Jamaica",
  // Europe (Western)
  "united kingdom": "Europe/London", uk: "Europe/London",
  england: "Europe/London", scotland: "Europe/London",
  wales: "Europe/London", "northern ireland": "Europe/London",
  "great britain": "Europe/London", britain: "Europe/London",
  ireland: "Europe/Dublin",
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  spain: "Europe/Madrid",
  portugal: "Europe/Lisbon",
  italy: "Europe/Rome",
  netherlands: "Europe/Amsterdam", holland: "Europe/Amsterdam",
  "the netherlands": "Europe/Amsterdam",
  belgium: "Europe/Brussels",
  luxembourg: "Europe/Luxembourg",
  switzerland: "Europe/Zurich",
  austria: "Europe/Vienna",
  monaco: "Europe/Monaco",
  andorra: "Europe/Andorra",
  malta: "Europe/Malta",
  liechtenstein: "Europe/Vaduz",
  "san marino": "Europe/San_Marino",
  iceland: "Atlantic/Reykjavik",
  // Europe (Nordics)
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  denmark: "Europe/Copenhagen",
  finland: "Europe/Helsinki",
  // Europe (Central/Eastern)
  poland: "Europe/Warsaw",
  "czech republic": "Europe/Prague", czechia: "Europe/Prague",
  slovakia: "Europe/Bratislava",
  hungary: "Europe/Budapest",
  romania: "Europe/Bucharest",
  bulgaria: "Europe/Sofia",
  greece: "Europe/Athens",
  turkey: "Europe/Istanbul", turkiye: "Europe/Istanbul",
  ukraine: "Europe/Kiev",
  belarus: "Europe/Minsk",
  moldova: "Europe/Chisinau",
  russia: "Europe/Moscow", "russian federation": "Europe/Moscow",
  serbia: "Europe/Belgrade",
  croatia: "Europe/Zagreb",
  slovenia: "Europe/Ljubljana",
  "bosnia and herzegovina": "Europe/Sarajevo", bosnia: "Europe/Sarajevo",
  "north macedonia": "Europe/Skopje", macedonia: "Europe/Skopje",
  montenegro: "Europe/Podgorica",
  albania: "Europe/Tirane",
  lithuania: "Europe/Vilnius",
  latvia: "Europe/Riga",
  estonia: "Europe/Tallinn",
  cyprus: "Asia/Nicosia",
  // Middle East
  "united arab emirates": "Asia/Dubai", uae: "Asia/Dubai",
  "saudi arabia": "Asia/Riyadh", ksa: "Asia/Riyadh",
  qatar: "Asia/Qatar",
  kuwait: "Asia/Kuwait",
  bahrain: "Asia/Bahrain",
  oman: "Asia/Muscat",
  israel: "Asia/Jerusalem",
  palestine: "Asia/Amman", "palestinian territories": "Asia/Amman",
  jordan: "Asia/Amman",
  lebanon: "Asia/Beirut",
  iraq: "Asia/Baghdad",
  iran: "Asia/Tehran",
  syria: "Asia/Beirut",
  yemen: "Asia/Aden",
  // South Asia
  india: "Asia/Kolkata",
  pakistan: "Asia/Karachi",
  bangladesh: "Asia/Dhaka",
  "sri lanka": "Asia/Colombo",
  nepal: "Asia/Kathmandu",
  bhutan: "Asia/Thimphu",
  maldives: "Indian/Maldives",
  afghanistan: "Asia/Kabul",
  // East / Southeast Asia
  china: "Asia/Shanghai", "peoples republic of china": "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  macau: "Asia/Macau", macao: "Asia/Macau",
  taiwan: "Asia/Taipei",
  japan: "Asia/Tokyo",
  "south korea": "Asia/Seoul", korea: "Asia/Seoul",
  "republic of korea": "Asia/Seoul",
  "north korea": "Asia/Pyongyang",
  mongolia: "Asia/Ulaanbaatar",
  singapore: "Asia/Singapore",
  malaysia: "Asia/Kuala_Lumpur",
  indonesia: "Asia/Jakarta",
  thailand: "Asia/Bangkok",
  vietnam: "Asia/Saigon", "viet nam": "Asia/Saigon",
  philippines: "Asia/Manila", "the philippines": "Asia/Manila",
  myanmar: "Asia/Rangoon", burma: "Asia/Rangoon",
  cambodia: "Asia/Phnom_Penh",
  laos: "Asia/Vientiane",
  brunei: "Asia/Brunei",
  "timor-leste": "Asia/Dili", "east timor": "Asia/Dili",
  // Central Asia / Caucasus
  kazakhstan: "Asia/Almaty",
  uzbekistan: "Asia/Tashkent",
  turkmenistan: "Asia/Ashgabat",
  kyrgyzstan: "Asia/Bishkek",
  tajikistan: "Asia/Dushanbe",
  azerbaijan: "Asia/Baku",
  georgia_country: "Asia/Tbilisi", // see resolveTimezone: "Georgia" the country
  armenia: "Asia/Yerevan",
  // Oceania
  australia: "Australia/Sydney",
  "new zealand": "Pacific/Auckland",
  fiji: "Pacific/Fiji",
  "papua new guinea": "Pacific/Port_Moresby",
  "new caledonia": "Pacific/Noumea",
  samoa: "Pacific/Apia",
  tonga: "Pacific/Tongatapu",
  guam: "Pacific/Guam",
  // Africa
  "south africa": "Africa/Johannesburg",
  nigeria: "Africa/Lagos",
  egypt: "Africa/Cairo",
  kenya: "Africa/Nairobi",
  morocco: "Africa/Casablanca",
  algeria: "Africa/Algiers",
  tunisia: "Africa/Tunis",
  libya: "Africa/Tripoli",
  ghana: "Africa/Accra",
  ethiopia: "Africa/Addis_Ababa",
  eritrea: "Africa/Addis_Ababa",
  tanzania: "Africa/Dar_es_Salaam",
  uganda: "Africa/Kampala",
  rwanda: "Africa/Kigali",
  burundi: "Africa/Bujumbura",
  sudan: "Africa/Khartoum",
  somalia: "Africa/Mogadishu",
  djibouti: "Africa/Djibouti",
  zambia: "Africa/Lusaka",
  zimbabwe: "Africa/Harare",
  malawi: "Africa/Blantyre",
  mozambique: "Africa/Maputo",
  botswana: "Africa/Gaborone",
  namibia: "Africa/Windhoek",
  lesotho: "Africa/Maseru",
  eswatini: "Africa/Mbabane", swaziland: "Africa/Mbabane",
  angola: "Africa/Luanda",
  "democratic republic of the congo": "Africa/Kinshasa",
  "dr congo": "Africa/Kinshasa", drc: "Africa/Kinshasa",
  congo: "Africa/Brazzaville", "republic of the congo": "Africa/Brazzaville",
  gabon: "Africa/Libreville",
  cameroon: "Africa/Douala",
  "central african republic": "Africa/Bangui",
  chad: "Africa/Ndjamena",
  "equatorial guinea": "Africa/Malabo",
  benin: "Africa/Porto-Novo",
  togo: "Africa/Lome",
  "ivory coast": "Africa/Abidjan", "cote divoire": "Africa/Abidjan",
  senegal: "Africa/Dakar",
  mali: "Africa/Bamako",
  guinea: "Africa/Conakry",
  "burkina faso": "Africa/Ouagadougou",
  niger: "Africa/Niamey",
  gambia: "Africa/Banjul", "the gambia": "Africa/Banjul",
  "sierra leone": "Africa/Freetown",
  liberia: "Africa/Monrovia",
  mauritania: "Africa/Nouakchott",
  madagascar: "Indian/Antananarivo",
  mauritius: "Indian/Mauritius",
  seychelles: "Indian/Mahe",
  comoros: "Indian/Comoro",
  "cape verde": "Atlantic/Cape_Verde", "cabo verde": "Atlantic/Cape_Verde"
};

// Countries where the state column meaningfully changes the timezone
const STATE_MAPS = {
  "united states": US_STATE_TZ, usa: US_STATE_TZ, us: US_STATE_TZ,
  "united states of america": US_STATE_TZ, america: US_STATE_TZ,
  canada: CA_PROVINCE_TZ,
  australia: AU_STATE_TZ
};

/**
 * Resolve a timezone for a lead.
 * @param {string} country - value of the sheet's `country` column
 * @param {string} [state] - value of the sheet's `state` column (refines US/CA/AU)
 * @returns {string} IANA timezone from the approved list, or "" if unknown
 */
export function resolveTimezone(country, state) {
  const c = norm(country);
  if (!c) return "";

  // "Georgia" is both a US state and a country. The sheet's `country` column
  // holding "Georgia" means the country in the Caucasus.
  if (c === "georgia") return "Asia/Tbilisi";

  const stateMap = STATE_MAPS[c];
  if (stateMap) {
    const s = norm(state);
    if (s && stateMap[s]) return stateMap[s];
  }
  return COUNTRY_TZ[c] || "";
}
