import fs from "fs";
import path from "path";
import zlib from "zlib";
import OpenAI from "openai";

const SITEMAP = "https://www.kingsresearch.com/sitemap-reports.xml";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const client = new OpenAI({ apiKey: (process.env.OPENAI_API_KEY || "").trim() });

async function fetchXml(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await r.arrayBuffer());
  const isGz = url.endsWith(".gz") || (r.headers.get("content-type") || "").includes("gzip") || (buf[0] === 0x1f && buf[1] === 0x8b);
  return isGz ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

function locs(xml) {
  return [...xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map((m) => m[1]);
}

function titleFromUrl(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  return slug.replace(/-\d+$/, "").split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

async function main() {
  console.log("Fetching sitemap...");
  let xml = await fetchXml(SITEMAP);
  let urls = locs(xml);
  // sitemap-index aware: if the locs are themselves sitemaps, expand them
  if (urls.length && urls.every((u) => u.includes("sitemap"))) {
    const all = [];
    for (const u of urls) all.push(...locs(await fetchXml(u)));
    urls = all;
  }
  urls = urls.filter((u) => /kingsresearch\.com\/.+/.test(u));
  const entries = urls.map((url) => ({ url, title: titleFromUrl(url) })).filter((e) => e.title);
  console.log(`${entries.length} report URLs. Embedding...`);

  const out = [];
  for (let i = 0; i < entries.length; i += 500) {
    const batch = entries.slice(i, i + 500);
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: batch.map((e) => e.title) });
    res.data.forEach((d, j) => out.push({ ...batch[j], vector: d.embedding }));
    console.log(`  ${Math.min(i + 500, entries.length)}/${entries.length}`);
  }

  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "data", "catalog.json"), JSON.stringify(out));
  console.log(`Wrote data/catalog.json (${out.length} reports).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
