// Research-only collector: long daily history of public market data for the
// Top Picks macro/cycle backtest. Yahoo daily bars (split/dividend adjusted)
// and public FRED CSV series. No private store, no keys, nothing from the site.
// node research/long-history/collect.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import YahooFinance from "yahoo-finance2";
import { TICKERS } from "../../scripts/build.mjs";

const OUT = new URL("./data/", import.meta.url);
const SINCE = "2006-01-01";
const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } },
});
const EXTRA = [
  // market + style
  "SPY","QQQ","IWM","DIA","MDY","RSP","VTI","MTUM","QUAL","USMV","VLUE","IWF","IWD",
  // sector + industry ETFs (no survivorship bias)
  "XLK","XLF","XLV","XLE","XLI","XLY","XLP","XLB","XLU","XLRE","XLC","KRE","KBE","SMH","SOXX","IGV","XHB","ITB","XRT","IBB","XBI","IYT","XOP","OIH","XME","ITA","IHI","KIE","IAI","PAVE","TAN","ARKK",
  // rates / credit / dollar / commodities / vol
  "BIL","SHY","IEI","IEF","TLT","TIP","LQD","HYG","JNK","EMB","UUP","FXY","GLD","SLV","USO","UNG","DBC","CPER","DBA",
  "^VIX","^VIX3M","^TNX","^IRX","^FVX","^TYX","DX-Y.NYB","^GSPC","^IXIC","^RUT",
  // international
  "EFA","EEM","EWJ","EWY","EWT","FXI","KWEB","EWG","EWZ","INDA",
];
const SYMBOLS = [...new Set([...TICKERS, ...EXTRA])];
const FRED = [
  "DFF","DGS3MO","DGS2","DGS5","DGS10","DGS30","T10Y2Y","T10Y3M","DFII10","T5YIE","T10YIE",
  "BAMLH0A0HYM2","BAMLC0A0CM","STLFSI4","NFCI","ANFCI",
  "CPIAUCSL","CPILFESL","PCEPILFE","UNRATE","PAYEMS","ICSA","CCSA","SAHMREALTIME","RSAFS","INDPRO","UMCSENT","USREC",
  "WALCL","RRPONTSYD","WTREGEN","M2SL","DTWEXBGS","VIXCLS","DCOILWTICO",
  "DRCCLACBS","DRALACBS","TOTALSL","REVOLSL","DRTSCILM","DRTSCIS","MORTGAGE30US","HOUST","PERMIT",
];

async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bars = {}, errors = [];
await pool(SYMBOLS, 3, async (sym) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await yahoo.chart(sym, { period1: SINCE, interval: "1d" });
      const t = [], o = [], h = [], l = [], c = [], a = [], v = [];
      for (const q of res?.quotes || []) {
        if (!q?.date || q.close == null) continue;
        const adj = q.adjclose ?? q.adjClose ?? q.close;
        const k = q.close ? adj / q.close : 1;
        t.push(new Date(q.date).toISOString().slice(0, 10));
        const r = (x) => (x == null ? null : Math.round(x * k * 10000) / 10000);
        o.push(r(q.open)); h.push(r(q.high)); l.push(r(q.low)); c.push(r(q.close)); a.push(Math.round(adj * 10000) / 10000); v.push(q.volume ?? 0);
      }
      if (t.length < 20) throw new Error("too few bars");
      bars[sym] = { t, o, h, l, c, v };
      console.log(`bars ${sym}: ${t.length} (${t[0]} to ${t[t.length - 1]})`);
      return;
    } catch (err) {
      if (attempt === 3) { errors.push(`${sym}: ${err.message}`); console.log(`bars ${sym} failed: ${err.message}`); }
      else await sleep(2000 * (attempt + 1));
    }
  }
});

const fred = {};
await pool(FRED, 2, async (id) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: { accept: "text/csv" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lines = (await res.text()).trim().split(/\r?\n/).slice(1);
      const t = [], v = [];
      for (const line of lines) { const [d, x] = line.split(","); const n = Number(x); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(n) && x !== ".") { t.push(d); v.push(n); } }
      if (!t.length) throw new Error("empty");
      fred[id] = { t, v };
      console.log(`fred ${id}: ${t.length} (${t[0]} to ${t[t.length - 1]})`);
      return;
    } catch (err) {
      if (attempt === 3) { errors.push(`FRED ${id}: ${err.message}`); console.log(`fred ${id} failed: ${err.message}`); }
      else await sleep(3000 * (attempt + 1));
    }
  }
});

await mkdir(OUT, { recursive: true });
const meta = { builtAtIso: new Date().toISOString(), since: SINCE, symbols: Object.keys(bars).sort(), fred: Object.keys(fred).sort(), errors };
await writeFile(new URL("bars.json.gz", OUT), gzipSync(JSON.stringify(bars)));
await writeFile(new URL("fred.json.gz", OUT), gzipSync(JSON.stringify(fred)));
await writeFile(new URL("meta.json", OUT), JSON.stringify(meta, null, 2));
console.log(`done: ${meta.symbols.length} symbols, ${meta.fred.length} FRED series, ${errors.length} errors`);
