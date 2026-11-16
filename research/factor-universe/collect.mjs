// Research-only collector for two history tests:
//   1. the Factor lab on a wide universe (about 1,000 large US companies, so a
//      test can pick the 500 largest at each past date), and
//   2. the Earnings Forecast history test on real filings.
// Public data only: the SEC's company list, company facts and filing index
// (free, keyless, identified as this site) and Yahoo daily bars through the
// site's own shared client. No private store, no keys, no AI, nothing
// published to the site. Raw public facts only: no score, rank or test result.
// node research/factor-universe/collect.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { yahooFinance as yahoo } from "../../lib/yahoo.mjs";
import { TICKERS, SECTORS } from "../../scripts/build.mjs";
import { DAY0, dayNo, extract, whyDropped, mergeFacts } from "./extract.mjs";

const OUT = new URL("./data/", import.meta.url);
const UA = process.env.SEC_USER_AGENT || "Mingstreet research (mingstreet.app)";
const POOL_TARGET = Number(process.env.FACTOR_POOL || 1000);   // companies kept
const SCAN_MAX = Number(process.env.FACTOR_SCAN || 1700);      // company-list rows read at most
const FORECAST_TOP = 26;                                       // raw filings kept for the forecast test
const SINCE = "2004-06-01";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Earlier SEC registrants of today's companies (holding-company
// reorganizations and mergers where the shares carried over one for one, so
// the price history is continuous). Each is merged only when the file's own
// company name matches, so a wrong number can never mix two companies.
const PREDECESSORS = {
  XOM: [["0000034088", /exxon/i]],
  GOOGL: [["0001288776", /google/i]],
  LIN: [["0000884905", /praxair/i]],
  DIS: [["0001001039", /disney|twdc/i]],
  BLK: [["0001364742", /blackrock/i]],
  MRVL: [["0001058057", /marvell/i]],
  ETN: [["0000031277", /eaton/i]],
  MDT: [["0000064670", /medtronic/i]],
  ICE: [["0001174746", /intercontinental/i]],
  CI: [["0000701221", /cigna/i]],
  BKR: [["0000808362", /baker hughes/i]],
  APA: [["0000006769", /apache/i]],
  AVGO: [["0001649338", /broadcom/i], ["0001441634", /avago/i]],
  DINO: [["0000048039", /holly/i]],
  TPL: [["0000097517", /texas pacific/i]],
  BG: [["0001144519", /bunge/i]],
  STE: [["0001624899", /steris/i], ["0000815065", /steris/i]],
  VTRS: [["0001623613", /mylan/i], ["0000069499", /mylan/i]],
  FTI: [["0001135152", /fmc tech/i]],
  WCN: [["0001057058", /waste connections/i]],
};
const errors = [];
const log = (...a) => console.log(...a);

// --- SEC: one shared pace (about 7 requests a second, under the 10 allowed) ---
let nextSlot = 0;
async function secGet(url, { head = 0 } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now(), at = Math.max(now, nextSlot); nextSlot = at + 140;
    if (at > now) await sleep(at - now);
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(90000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("HTTP " + res.status);
      if (head && res.body?.getReader) {
        // Only the first bytes are needed (the industry code sits at the top).
        const reader = res.body.getReader(); let text = ""; const dec = new TextDecoder();
        while (text.length < head) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); }
        try { await reader.cancel(); } catch { /* already closed */ }
        return text;
      }
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(4000 * (attempt + 1));
    }
  }
  return null;
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

// --- Yahoo daily bars: split-adjusted close, cash dividends, splits, dollar volume ---
const sig = (x) => (x == null || !Number.isFinite(x) ? null : Number(x.toPrecision(6)));
async function bars(sym, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await yahoo.chart(sym, { period1: SINCE, interval: "1d", events: "div|split" });
      const t = [], c = [], dollars = [];
      for (const q of res?.quotes || []) {
        if (!q?.date || !(q.close > 0)) continue;
        t.push(dayNo(new Date(q.date).toISOString())); c.push(sig(q.close)); dollars.push((q.volume || 0) * q.close);
      }
      if (t.length < 260) { const e = new Error("too few bars"); e.final = true; throw e; }
      const ev = res?.events || {};
      const list = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);
      const d = list(ev.dividends).filter((x) => x?.date && x.amount > 0).map((x) => [dayNo(new Date(x.date).toISOString()), sig(x.amount)]);
      const sp = list(ev.splits).filter((x) => x?.date && x.numerator > 0 && x.denominator > 0).map((x) => [dayNo(new Date(x.date).toISOString()), sig(x.numerator / x.denominator)]);
      return { t, c, dollars, d, sp };
    } catch (err) {
      if (err.final || attempt === attempts - 1) throw err;
      await sleep(2500 * (attempt + 1));
    }
  }
  return null;
}

await mkdir(new URL("forecast/", OUT), { recursive: true });

// 1. The SEC's company list (largest first) → candidates, one per company.
const listText = await secGet("https://www.sec.gov/files/company_tickers.json");
if (!listText) throw new Error("SEC company list unavailable");
const list = Object.values(JSON.parse(listText));
const cikOfTicker = new Map(list.map((v) => [String(v.ticker).toUpperCase(), String(v.cik_str).padStart(10, "0")]));
const seen = new Set(), candidates = [];
for (const [rank, v] of list.entries()) {
  const sym = String(v.ticker || "").toUpperCase(), cik = String(v.cik_str).padStart(10, "0");
  if (seen.has(cik) || !/^[A-Z]{1,5}(-[A-Z])?$/.test(sym)) continue;
  seen.add(cik); candidates.push({ rank, sym, cik, name: String(v.title || "").slice(0, 60) });
  if (candidates.length >= SCAN_MAX) break;
}
log(`company list: ${list.length} rows, ${candidates.length} candidates; first: ${candidates.slice(0, 8).map((c) => c.sym).join(" ")}`);

// 2. Company facts for each candidate until the pool is full.
const facts = {}, companies = [], dropped = [], merged = [];
let scanned = 0;
await pool(candidates, 4, async (c) => {
  if (companies.length >= POOL_TARGET) return;
  scanned++;
  try {
    const text = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`);
    if (!text) { if (c.rank < 400) dropped.push({ sym: c.sym, rank: c.rank, why: "no company-facts file" }); return; }
    const json = JSON.parse(text);
    for (const [oldCik, name] of PREDECESSORS[c.sym] || []) {
      if (oldCik === c.cik) continue;
      try {
        const oldText = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${oldCik}.json`);
        const older = oldText && JSON.parse(oldText);
        if (!older || !name.test(String(older.entityName || ""))) { merged.push(`${c.sym}: ${oldCik} skipped (${older ? older.entityName : "no file"})`); continue; }
        mergeFacts(json, older);
        merged.push(`${c.sym}: ${oldCik} ${older.entityName}`);
      } catch (err) { errors.push(`predecessor ${c.sym} ${oldCik}: ${err.message}`); }
    }
    const rows = extract(json);
    if (!rows && c.rank < 400) dropped.push({ sym: c.sym, rank: c.rank, why: whyDropped(json) });
    if (!rows || companies.length >= POOL_TARGET) return;
    facts[c.sym] = rows; companies.push(c);
    if (companies.length % 100 === 0) log(`facts: ${companies.length} kept of ${scanned} read`);
  } catch (err) { errors.push(`facts ${c.sym}: ${err.message}`); }
});
companies.sort((a, b) => a.rank - b.rank);
dropped.sort((a, b) => a.rank - b.rank);
log(`facts: ${companies.length} companies kept of ${scanned} read`);
for (const d of dropped) log(`not kept: ${d.sym} (rank ${d.rank}): ${d.why}`);
for (const m of merged) log(`earlier registrant: ${m}`);

// 3. Industry code (the first bytes of each filing index).
await pool(companies, 4, async (c) => {
  try {
    const head = await secGet(`https://data.sec.gov/submissions/CIK${c.cik}.json`, { head: 3000 });
    const m = head && /"sic"\s*:\s*"(\d{3,4})"/.exec(head), d = head && /"sicDescription"\s*:\s*"([^"]{0,60})"/.exec(head);
    if (m) c.sic = Number(m[1]);
    if (d) c.sicDesc = d[1];
  } catch (err) { errors.push(`sic ${c.sym}: ${err.message}`); }
});
log(`industry codes: ${companies.filter((c) => c.sic).length} of ${companies.length}`);

// 4. Daily bars. SPY sets the calendar.
const spy = await bars("SPY");
const calendar = spy.t, calPos = new Map(calendar.map((d, i) => [d, i]));
const months = [...new Set(calendar.map((d) => { const x = new Date(DAY0 + d * 86400000); return x.getUTCFullYear() * 100 + x.getUTCMonth() + 1; }))];
const monthPos = new Map(months.map((m, i) => [m, i]));
const monthOf = (d) => { const x = new Date(DAY0 + d * 86400000); return x.getUTCFullYear() * 100 + x.getUTCMonth() + 1; };
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
function pack(b) {
  const idx = b.t.map((d) => calPos.get(d));
  const first = idx.find((i) => i != null);
  if (first == null) return null;
  const c = new Array(calendar.length - first).fill(null);
  const byMonth = new Map();
  b.t.forEach((d, k) => {
    const i = idx[k]; if (i == null) return;
    c[i - first] = b.c[k];
    const m = monthOf(d); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(b.dollars[k]);
  });
  const nearest = (d) => { for (let k = 0; k < 6; k++) { const i = calPos.get(d + k); if (i != null) return i; } return null; };
  const m0 = monthPos.get(monthOf(calendar[first]));
  const dv = months.slice(m0).map((m) => { const xs = byMonth.get(m); return xs ? Math.round(median(xs) / 1e4) / 100 : null; });
  return { s: first, c, m0, dv, d: b.d.map(([d, a]) => [nearest(d), a]).filter((x) => x[0] != null), sp: b.sp.map(([d, r]) => [nearest(d), r]).filter((x) => x[0] != null) };
}
const prices = { SPY: pack(spy) };
let priced = 0;
await pool(companies, 4, async (c) => {
  try {
    const b = await bars(c.sym);
    const p = b && pack(b);
    if (!p) throw new Error("no bars on the calendar");
    prices[c.sym] = p; priced++;
    if (priced % 100 === 0) log(`bars: ${priced}`);
  } catch (err) { if (err.final) c.short = true; errors.push(`bars ${c.sym}: ${err.message}`); }
  await sleep(120);
});
// One slow second pass for names that failed for another reason (rate limits).
for (const c of companies.filter((x) => !prices[x.sym] && !x.short)) {
  try { await sleep(1200); const b = await bars(c.sym, 1), p = b && pack(b); if (p) { prices[c.sym] = p; priced++; } } catch { /* already listed */ }
}
log(`bars: ${priced} of ${companies.length}`);

// 4b. Today's quoted market value, price and share count for each company:
//     the check on the share counts read from filings (filers scale their
//     share tags differently, and some report one share class only).
let quoted = 0;
for (let i = 0; i < companies.length; i += 40) {
  try {
    const batch = companies.slice(i, i + 40);
    const quotes = await yahoo.quote(batch.map((c) => c.sym));
    const bySym = new Map((Array.isArray(quotes) ? quotes : [quotes]).filter((q) => q?.symbol).map((q) => [q.symbol, q]));
    for (const c of batch) {
      const q = bySym.get(c.sym);
      if (!q || !(q.marketCap > 0)) continue;
      c.q = { cap: q.marketCap, px: q.regularMarketPrice ?? null, so: q.sharesOutstanding ?? null, cur: q.currency ?? null };
      quoted++;
    }
  } catch (err) { errors.push(`quotes ${i}: ${err.message}`); }
  await sleep(300);
}
log(`quoted market values: ${quoted} of ${companies.length}`);

// 5. Earnings Forecast test: public quote fields for the covered stocks, and
//    the unmodified company-facts file for the largest of them.
const covered = TICKERS.filter((s) => SECTORS[s] !== "ETF");
const chains = {};
try {
  for (let i = 0; i < covered.length; i += 40) {
    const quotes = await yahoo.quote(covered.slice(i, i + 40));
    for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
      if (!q?.symbol) continue;
      chains[q.symbol] = { spot: q.regularMarketPrice ?? null, currency: q.currency ?? null, name: q.longName || q.shortName || q.symbol, marketCap: q.marketCap ?? null, financialCurrency: q.financialCurrency ?? null, forwardPE: q.forwardPE ?? null, sector: SECTORS[q.symbol] || null, cik: cikOfTicker.get(q.symbol) || null };
    }
  }
} catch (err) { errors.push(`quotes: ${err.message}`); }
const top = Object.entries(chains).filter(([, q]) => q.marketCap > 0 && q.cik).sort((a, b) => b[1].marketCap - a[1].marketCap).slice(0, FORECAST_TOP);
let rawKept = 0;
await pool(top, 2, async ([sym, q]) => {
  try {
    const text = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${q.cik}.json`);
    if (!text) return;
    await writeFile(new URL(`forecast/CIK${q.cik}.json.gz`, OUT), gzipSync(text));
    rawKept++;
  } catch (err) { errors.push(`forecast facts ${sym}: ${err.message}`); }
});
log(`forecast: ${Object.keys(chains).length} quotes, ${rawKept} company-facts files`);

const builtAtIso = new Date().toISOString();
await writeFile(new URL("universe.json.gz", OUT), gzipSync(JSON.stringify({ builtAtIso, day0: "2000-01-01", calendar, months, companies })));
await writeFile(new URL("prices.json.gz", OUT), gzipSync(JSON.stringify(prices)));
await writeFile(new URL("facts.json.gz", OUT), gzipSync(JSON.stringify(facts)));
await writeFile(new URL("forecast/chains.json", OUT), JSON.stringify({ builtAtIso, chains }, null, 1));
await writeFile(new URL("meta.json", OUT), JSON.stringify({ builtAtIso, since: SINCE, scanned, companies: companies.length, priced, quoted, sic: companies.filter((c) => c.sic).length, forecastFiles: rawKept, merged, dropped, errors: errors.slice(0, 200), errorCount: errors.length }, null, 1));
log(`done: ${companies.length} companies, ${priced} with bars, ${errors.length} errors`);
