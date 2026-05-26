// Hourly refresh for data/heatmap.json.
//
// The daily build (scripts/build.mjs) bakes the full payload — names,
// sectors, industries, market caps, and the close-to-close % move. That
// % move goes stale within a single trading session, so this script runs
// hourly during US market hours, pulls live quotes for every ticker in
// one batched yahoo-finance2 call, and rewrites data/heatmap.json with
// fresh `ch` (regularMarketChangePercent) and `sp` (regularMarketPrice).
//
// Everything else — sector, industry, market cap, name — is preserved
// from the prior file. Market cap could be refreshed from the quote too
// (Yahoo returns it on most equities), but it doesn't move enough hour
// to hour to be worth the extra schema-handling complexity, and the
// nightly bake catches drift.
//
// If a quote is missing for a symbol (Yahoo flake, delisted, ticker
// renamed), that row keeps its prior `ch`/`sp` so the tile doesn't blank
// out. The next nightly bake fixes the stale row outright.
//
// Invoked by .github/workflows/heatmap.yml at the top of every market
// hour. Adds zero AI cost — quotes are a pure Yahoo call.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const HEATMAP_FILE = "heatmap.json";

// Mirror the desktop-UA shim used in lib/yahoo.mjs and scripts/build.mjs
// so the consent-cookie + crumb handshake works from a GitHub runner.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
  fetchOptions: {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  },
});

// yahoo-finance2's quote() can take a batch but starts to throttle past
// ~50–60 symbols per call. Splitting keeps each request comfortably below
// the throttle line and lets a partial failure (e.g. one bad symbol)
// drop just that chunk rather than the whole sweep.
const CHUNK_SIZE = 50;
const CHUNK_DELAY_MS = 250;

const QUOTE_FIELDS = [
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "regularMarketChangePercent",
  "marketState",
  "marketCap",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchQuotesChunked(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + CHUNK_SIZE);
    try {
      const r = await yahooFinance.quote(chunk, { fields: QUOTE_FIELDS });
      const list = Array.isArray(r) ? r : r ? [r] : [];
      for (const q of list) {
        if (!q || !q.symbol) continue;
        out[q.symbol] = q;
      }
    } catch (err) {
      console.warn(
        `[heatmap] chunk failed (${chunk[0]}…${chunk[chunk.length - 1]}): ${String(err?.message || err)}`,
      );
    }
    if (i + CHUNK_SIZE < symbols.length) await sleep(CHUNK_DELAY_MS);
  }
  return out;
}

async function main() {
  const path = resolve(DATA_DIR, HEATMAP_FILE);
  let prior;
  try {
    prior = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error(
      `[heatmap] cannot read ${HEATMAP_FILE}: ${String(err?.message || err)}`,
    );
    console.error(
      `[heatmap] this script refreshes an existing payload — run a full daily build first.`,
    );
    process.exit(1);
  }
  const priorTickers = Array.isArray(prior?.tickers) ? prior.tickers : [];
  if (!priorTickers.length) {
    console.error(`[heatmap] prior ${HEATMAP_FILE} has no tickers — nothing to refresh.`);
    process.exit(1);
  }

  const symbols = priorTickers.map((t) => t.t);
  console.log(`[heatmap] refreshing ${symbols.length} tickers via batched Yahoo quote…`);
  const quotes = await fetchQuotesChunked(symbols);
  const hitCount = Object.keys(quotes).length;
  console.log(`[heatmap] got ${hitCount}/${symbols.length} live quotes`);

  let refreshed = 0;
  let stale = 0;
  const nextTickers = priorTickers.map((row) => {
    const q = quotes[row.t];
    if (!q) {
      stale++;
      return row;
    }
    const ch = Number(q.regularMarketChangePercent);
    const sp =
      Number(q.regularMarketPrice) ||
      Number(q.postMarketPrice) ||
      Number(q.preMarketPrice);
    if (!isFinite(ch)) {
      stale++;
      return row;
    }
    refreshed++;
    const mc = Number(q.marketCap);
    return {
      ...row,
      ch: Math.round(ch * 100) / 100,
      sp: isFinite(sp) && sp > 0 ? sp : row.sp,
      mc: isFinite(mc) && mc > 0 ? mc : row.mc,
    };
  });

  // Pick the most common marketState across the batch as the headline
  // freshness label ("REGULAR" / "PRE" / "POST" / "CLOSED").
  const stateCounts = {};
  for (const q of Object.values(quotes)) {
    const s = q?.marketState;
    if (!s) continue;
    stateCounts[s] = (stateCounts[s] || 0) + 1;
  }
  const marketState = Object.keys(stateCounts).sort(
    (a, b) => stateCounts[b] - stateCounts[a],
  )[0] || null;

  const builtAtIso = new Date().toISOString();
  const payload = {
    builtAtIso,
    refreshedAtIso: builtAtIso,
    marketState,
    tickers: nextTickers,
  };
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(path, json, "utf8");
  console.log(
    `[heatmap] wrote ${HEATMAP_FILE} — ${refreshed} refreshed, ${stale} kept stale, marketState=${marketState || "—"}, ${json.length} bytes`,
  );
}

main().catch((err) => {
  console.error(`[heatmap] fatal: ${String(err?.stack || err?.message || err)}`);
  process.exit(1);
});
