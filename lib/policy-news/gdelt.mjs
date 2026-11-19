// GDELT news volume and tone per covered stock (2026-11-19, owner request).
//
// GDELT's DOC 2.0 API (https://api.gdeltproject.org/api/v2/doc/doc) counts
// the world's online news articles that match a query, in 15-minute to daily
// steps over a rolling three months, and scores their average tone. It is
// free with no key; GDELT asks for credit and for at most about one request
// every five seconds (a faster caller gets a plain-text "Please limit
// requests" answer instead of JSON). Terms: open for any use with credit,
// https://www.gdeltproject.org/about.html#termsofuse.
//
// What we keep, per stock, once a day:
//   vol24   articles matching the stock's query in the last 24 hours
//   base    the average articles a day over the six days before that
//   ratio   vol24 / base (null when base is under one article a day)
//   tone24  average tone of the last 24 hours (GDELT's -10..+10 scale),
//           read only when the stock's news volume spiked (ratio >= 2), so
//           the daily call count stays near one per stock
//   toneBase the average tone of the six days before
//
// Why: the engines' crash test found that washout bounces after a one-day
// drop of 7% or more lose money (catalyst crash test, 2026-11-18), matching
// research that drops with news drift on and drops without news reverse.
// GDELT volume tells those two kinds of drop apart with no AI call.
//
// Pure parsers are exported for the offline smoke test; fetches take a
// fetchImpl so the test never touches the network.

export const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
export const GDELT_GAP_MS = 5500;          // one request every 5.5 s
export const GDELT_TIMEOUT_MS = 20000;
export const GDELT_SPAN_DAYS = 7;          // last 24 h + the six days before
export const GDELT_SPIKE_RATIO = 2;        // tone is read only past this
export const GDELT_SPIKE_MIN = 10;         // ...and with at least this many articles
export const GDELT_TONE_MAX = 12;          // tone reads per day at most
export const GDELT_HISTORY_DAYS = 90;      // daily rows kept per stock

// Hand-made query per covered stock: the company name GDELT will find in a
// headline or story, quoted. Funds are left out (news about "SPDR S&P 500"
// is not news about the market). A missing stock is skipped, never guessed.
// Short or common-word names get a second, more specific phrase.
export const GDELT_QUERIES = Object.freeze({
  AAPL: '("Apple Inc" OR "Tim Cook" OR iPhone)', MSFT: '"Microsoft"', AMZN: '("Amazon.com" OR "Andy Jassy" OR "Amazon Web Services")',
  META: '("Meta Platforms" OR "Mark Zuckerberg")', GOOGL: '(Alphabet OR Google)', TSLA: '(Tesla OR "Elon Musk")', NVDA: '(Nvidia OR "Jensen Huang")',
  TSM: '(TSMC OR "Taiwan Semiconductor")', AVGO: '"Broadcom"', ORCL: '("Oracle Corp" OR "Oracle Corporation" OR "Larry Ellison")', NFLX: '"Netflix"',
  JPM: '("JPMorgan" OR "Jamie Dimon")', V: '("Visa Inc" OR "Visa card")', MA: '"Mastercard"', LLY: '("Eli Lilly" OR tirzepatide OR Zepbound OR Mounjaro)',
  MRNA: '"Moderna"', MRK: '("Merck & Co" OR Keytruda)', WMT: '"Walmart"', COST: '"Costco"',
  CRWD: '"CrowdStrike"', ADBE: '"Adobe"', SHOP: '"Shopify"', BAC: '"Bank of America"', SCHW: '("Charles Schwab" OR "Schwab Corp")', BABA: '"Alibaba"',
  MS: '"Morgan Stanley"', GS: '"Goldman Sachs"', HOOD: '"Robinhood"', AXP: '"American Express"', AMD: '("Advanced Micro Devices" OR "AMD chip" OR "Lisa Su")',
  C: '"Citigroup"', UNH: '("UnitedHealth" OR "Optum")', DELL: '"Dell Technologies"', ASML: '"ASML"', VST: '("Vistra Corp" OR "Vistra Energy")',
  NOW: '"ServiceNow"', MDB: '"MongoDB"', ACN: '"Accenture"', OKTA: '"Okta"', SNOW: '("Snowflake Inc" OR "Snowflake AI")', RKLB: '"Rocket Lab"',
  CRM: '"Salesforce"', FTNT: '"Fortinet"', INTU: '("Intuit" OR TurboTax)', TEAM: '"Atlassian"', NKE: '("Nike Inc" OR "Nike shares")',
  PANW: '"Palo Alto Networks"', IBM: '"IBM"', QCOM: '"Qualcomm"', HD: '"Home Depot"', PLTR: '"Palantir"', DDOG: '"Datadog"', SBUX: '"Starbucks"',
  ANET: '"Arista Networks"', TXN: '"Texas Instruments"', INTC: '("Intel Corp" OR "Intel chip" OR "Intel shares")', NVO: '("Novo Nordisk" OR Wegovy OR Ozempic)',
  CRWV: '"CoreWeave"', MRVL: '"Marvell Technology"', AMAT: '"Applied Materials"', MU: '("Micron Technology" OR "Micron shares")', BE: '"Bloom Energy"',
  SNDK: '"SanDisk"', WDC: '"Western Digital"', ARM: '("Arm Holdings" OR "Arm Ltd")', VRT: '"Vertiv"', TGT: '("Target Corp" OR "Target stores")',
  SPCX: '"SpaceX"',
});

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function gdeltUrl(query, mode, days = GDELT_SPAN_DAYS) {
  const q = `${query} sourcelang:english`;
  return `${GDELT_URL}?query=${encodeURIComponent(q)}&mode=${mode}&format=json&timespan=${days}d&TIMELINESMOOTH=0`;
}

// GDELT dates look like "20261112T151500Z". Returns ms or null.
export function gdeltDateMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(String(s || "").trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return Number.isFinite(ms) ? ms : null;
}

// A timeline answer: { timeline: [{ series, data: [{ date, value }] }] }.
// Returns [{ ms, value }] sorted, or null when the body is not a timeline
// (GDELT answers a rate-limited or malformed request with plain text).
export function parseTimeline(body) {
  let j = body;
  if (typeof body === "string") {
    const t = body.trim();
    if (!t.startsWith("{")) return null;
    try { j = JSON.parse(t); } catch { return null; }
  }
  const series = Array.isArray(j?.timeline) ? j.timeline[0] : null;
  if (!series || !Array.isArray(series.data)) return Array.isArray(j?.timeline) ? [] : null;
  const out = [];
  for (const p of series.data) {
    const ms = gdeltDateMs(p?.date);
    const v = num(p?.value);
    if (ms != null && v != null) out.push({ ms, value: v });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// Volume read from a timelinevolraw answer. The last 24 hours run back from
// nowMs (or from the newest point when that is earlier, so a feed that lags
// by an hour is not read as a quiet day); the base is the daily average of
// the six days before.
export function volumeRead(points, nowMs) {
  if (!Array.isArray(points)) return null;
  if (!points.length) return { vol24: 0, base: 0, ratio: null, points: 0 };
  const end = Math.min(nowMs, points[points.length - 1].ms + 15 * 60000);
  const cut = end - 86400000, start = cut - 6 * 86400000;
  let vol24 = 0, prior = 0;
  for (const p of points) {
    if (p.ms > cut && p.ms <= end) vol24 += p.value;
    else if (p.ms > start && p.ms <= cut) prior += p.value;
  }
  const base = prior / 6;
  return { vol24: Math.round(vol24), base: r2(base), ratio: base >= 1 ? r2(vol24 / base) : null, points: points.length };
}

// Tone read from a timelinetone answer: the plain average of the steps in
// each window (GDELT already averages articles within a step).
export function toneRead(points, nowMs) {
  if (!Array.isArray(points) || !points.length) return null;
  const end = Math.min(nowMs, points[points.length - 1].ms + 15 * 60000);
  const cut = end - 86400000, start = cut - 6 * 86400000;
  const a = [], b = [];
  for (const p of points) {
    if (p.ms > cut && p.ms <= end) a.push(p.value);
    else if (p.ms > start && p.ms <= cut) b.push(p.value);
  }
  const avg = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : null);
  return { tone24: r2(avg(a)), toneBase: r2(avg(b)) };
}

async function fetchBody(url, { fetchImpl, timeoutMs }) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "stonks-app market-data pipeline (https://mingstreet.app)", accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

// Read the stocks in `symbols` that are still due today, one request at a
// time, until `budgetMs` runs out. Returns { reads: { SYM: row }, done: [SYM],
// calls, errors, stopped }. A stock whose read fails is not marked done, so
// the next bake the same day tries it again. A rate-limit answer stops the
// whole pass (the rest wait for the next bake).
export async function readGdelt({ symbols, nowMs = Date.now(), fetchImpl = globalThis.fetch, budgetMs = 8 * 60000, gapMs = GDELT_GAP_MS, timeoutMs = GDELT_TIMEOUT_MS, toneMax = GDELT_TONE_MAX, log = () => {} } = {}) {
  const started = Date.now();
  const reads = {}, done = [], errors = [];
  let calls = 0, tones = 0, stopped = null, last = 0;
  const call = async (url) => {
    const wait = last + gapMs - Date.now();
    if (calls > 0 && wait > 0) await sleep(wait);
    last = Date.now();
    calls += 1;
    return fetchBody(url, { fetchImpl, timeoutMs });
  };
  for (const sym of symbols) {
    const query = GDELT_QUERIES[sym];
    if (!query) continue;
    if (Date.now() - started + gapMs > budgetMs) { stopped = "time budget"; break; }
    try {
      const body = await call(gdeltUrl(query, "timelinevolraw"));
      const pts = parseTimeline(body);
      if (pts == null) {
        if (/limit|too many|rate/i.test(String(body).slice(0, 300))) { stopped = "rate limited"; break; }
        throw new Error("not a timeline");
      }
      const vol = volumeRead(pts, nowMs);
      const row = { vol24: vol.vol24, base: vol.base, ratio: vol.ratio };
      if (vol.ratio != null && vol.ratio >= GDELT_SPIKE_RATIO && vol.vol24 >= GDELT_SPIKE_MIN && tones < toneMax
        && Date.now() - started + gapMs <= budgetMs) {
        try {
          const tpts = parseTimeline(await call(gdeltUrl(query, "timelinetone")));
          const t = toneRead(tpts, nowMs);
          if (t) { row.tone24 = t.tone24; row.toneBase = t.toneBase; tones += 1; }
        } catch (err) { errors.push(`${sym} tone: ${String(err?.message || err).split("\n")[0]}`); }
      }
      reads[sym] = row;
      done.push(sym);
    } catch (err) {
      errors.push(`${sym}: ${String(err?.message || err).split("\n")[0]}`);
    }
  }
  log(`  · GDELT: ${done.length} stocks read, ${calls} calls, ${tones} tone reads${stopped ? `, stopped (${stopped})` : ""}${errors.length ? `, ${errors.length} error(s)` : ""}`);
  return { reads, done, calls, tones, errors, stopped };
}
