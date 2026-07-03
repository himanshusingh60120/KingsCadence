import * as cheerio from "cheerio";

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function get(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; } finally { clearTimeout(t); }
}

/** What does this company actually do? (title, meta description, og, h1/h2 text) */
export async function companyWebsiteIntel(website) {
  const out = { description: "", keywords: "" };
  if (!website) return out;
  let domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  for (const scheme of ["https://", "https://www."]) {
    const html = await get(scheme + domain);
    if (!html) continue;
    const $ = cheerio.load(html);
    const bits = [
      $('meta[name="description"]').attr("content"),
      $('meta[property="og:description"]').attr("content"),
      $("title").first().text(),
      $("h1").slice(0, 2).text(),
      $("h2").slice(0, 3).text()
    ].filter(Boolean).map((s) => s.replace(/\s+/g, " ").trim());
    out.description = [...new Set(bits)].join(" | ").slice(0, 900);
    out.keywords = ($('meta[name="keywords"]').attr("content") || "").slice(0, 300);
    if (out.description) break;
  }
  return out;
}

/** Latest news: company-specific + industry-level. Google News RSS, no API key. */
export async function newsSignals(companyName, industry) {
  const items = [];
  const queries = [];
  if (companyName) queries.push(`"${companyName}" when:60d`);
  if (industry) queries.push(`"${industry}" (merger OR acquisition OR regulation OR expansion OR investment) when:30d`);

  for (const q of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await get(url, 7000);
    if (!xml) continue;
    const matches = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/g)];
    for (const m of matches.slice(0, 5)) {
      const title = m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (title && !items.some((i) => i.title === title)) {
        items.push({ title, date: m[2], scope: q.startsWith(`"${companyName}"`) ? "company" : "industry" });
      }
    }
  }
  const newsSummary = items.slice(0, 8)
    .map((i) => `[${i.scope}] ${i.title} (${(i.date || "").slice(0, 16)})`)
    .join("\n");
  return { items, newsSummary };
}

/** Deep-scrape a Kings Research report page: size, forecast, CAGR, highlights, regions. */
export async function scrapeReport(url) {
  const data = {
    url, title: "", sizeCurrent: "", baseYear: "", sizeForecast: "", forecastYear: "",
    cagr: "", highlights: [], drivers: [], leadingRegion: "", fastestRegion: ""
  };
  const html = await get(url, 15000);
  if (!html) return data;
  const $ = cheerio.load(html);
  data.title = $("h1").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ");

  let m = text.match(/(?:valued at|reached|estimated at|stood at|size was|size is|was)\s+USD\s+([\d,.]+)\s*(billion|million|trillion)\s+in\s+(\d{4})/i)
       || text.match(/USD\s+([\d,.]+)\s*(billion|million|trillion)\s+in\s+(\d{4})/i);
  if (m) { data.sizeCurrent = `USD ${m[1]} ${m[2]}`; data.baseYear = m[3]; }

  m = text.match(/(?:reach|grow to|projected to reach|expected to reach|surpass|hit)\s+USD\s+([\d,.]+)\s*(billion|million|trillion)\s+by\s+(\d{4})/i)
    || text.match(/USD\s+([\d,.]+)\s*(billion|million|trillion)\s+by\s+(\d{4})/i);
  if (m) { data.sizeForecast = `USD ${m[1]} ${m[2]}`; data.forecastYear = m[3]; }

  m = text.match(/CAGR\s+(?:of\s+)?([\d.]+)\s*%/i) || text.match(/([\d.]+)\s*%\s+CAGR/i);
  if (m) data.cagr = `${m[1]}%`;

  // Key Market Highlights list
  const hl = $('*:contains("Key Market Highlights")').last();
  if (hl.length) {
    hl.nextAll().slice(0, 4).find("li").each((_, li) => {
      const t = $(li).text().replace(/^\d+\.\s*/, "").replace(/\s+/g, " ").trim();
      if (t && data.highlights.length < 6 && !data.highlights.includes(t)) data.highlights.push(t);
    });
  }

  for (const re of [/driven by\s+([^.]{20,250})\./gi, /(?:fueled|propelled|supported)\s+by\s+([^.]{20,250})\./gi]) {
    for (const d of text.matchAll(re)) {
      if (data.drivers.length < 3 && !data.drivers.includes(d[1].trim())) data.drivers.push(d[1].trim());
    }
  }

  m = text.match(/(North America|Europe|Asia[- ]Pacific|APAC|Latin America|Middle East(?:\s*(?:&|and)\s*Africa)?)\s+(?:held|accounted for|dominated|led|captured|commands?)[^.]{0,150}\./i);
  if (m) data.leadingRegion = m[1];
  m = text.match(/(North America|Europe|Asia[- ]Pacific|APAC|Latin America|Middle East(?:\s*(?:&|and)\s*Africa)?)\s+(?:is|was|will be|is expected to be|is projected to be)\s+the\s+fastest[- ]growing/i);
  if (m) data.fastestRegion = m[1];

  return data;
}
