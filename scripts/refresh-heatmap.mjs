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
import { GoogleGenAI } from "@google/genai";
import { recordAiUsage, loadAiUsageState, writeAiUsageState } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");
const HEATMAP_FILE = "heatmap.json";

// EOD recap generation — a single Gemini call per ET trading day that turns
// the day's per-sector aggregates into a one-paragraph-per-sector recap.
// Flash-Lite is plenty for a ~12-sector summary and dirt cheap on free tier.
// Override via AI_EOD_MODEL env. Without GEMINI_API_KEY the EOD step is
// silently skipped — the heatmap still renders, just without the recap.
const AI_EOD_MODEL = process.env.AI_EOD_MODEL || "gemini-2.5-flash-lite";
const AI_EOD_MAX_ATTEMPTS = 4;
const AI_EOD_RETRY_BACKOFF_MS = [3000, 8000, 20000];
// Only generate after the 16:00 ET closing bell — earlier refreshes are
// intra-session and don't yet represent "what happened today". The hourly
// cron's last fire of the day is 16:00 ET, which by the time the runner
// boots + Yahoo responds typically lands 16:01-16:05 ET (marketState=POST).
const EOD_TRIGGER_ET_HOUR = 16;
// Per-sector cap on leaders/laggards cited in the prompt. Keeps the request
// compact enough for a single Flash-Lite call regardless of sector size.
const EOD_SECTOR_PICKS = 3;

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

// YYYY-MM-DD in America/New_York. Stable across DST shifts unlike a raw
// UTC slice. Used to date-stamp the EOD summary so we generate at most once
// per ET trading day and the morning daily build can decide whether to keep
// the prior session's recap.
function etDateKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    // 2-digit day so single-digit days zero-pad (2026-05-03, not 2026-05-3) and
    // these keys compare equal to the scanners'/volume-flags' ET date keys.
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function etHour(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour");
  return h ? Number(h.value) : -1;
}

// Aggregate the refreshed tickers into the shape the EOD prompt needs:
// per-sector cap-weighted avg %, top movers, top laggards, plus a tape-wide
// up/down/flat count. Sectors are sorted descending by cap-weighted move so
// the AI's narrative reads like a market-recap (winners first).
function computeEodSectorStats(tickers) {
  const sectorMap = new Map();
  let up = 0, down = 0, flat = 0;
  let totalCh = 0;
  let weightedCh = 0;
  let totalMc = 0;
  for (const t of tickers) {
    if (!isFinite(t.ch)) continue;
    if (t.ch > 0.05) up++;
    else if (t.ch < -0.05) down++;
    else flat++;
    totalCh += t.ch;
    if (isFinite(t.mc) && t.mc > 0) {
      weightedCh += t.ch * t.mc;
      totalMc += t.mc;
    }
    const key = t.s || "Other";
    if (!sectorMap.has(key)) sectorMap.set(key, []);
    sectorMap.get(key).push(t);
  }
  const sectors = [];
  for (const [name, rows] of sectorMap.entries()) {
    const sorted = rows.slice().sort((a, b) => b.ch - a.ch);
    let sumCh = 0, sumWeighted = 0, sumMc = 0;
    for (const r of sorted) {
      sumCh += r.ch;
      if (isFinite(r.mc) && r.mc > 0) {
        sumWeighted += r.ch * r.mc;
        sumMc += r.mc;
      }
    }
    const avg = sorted.length ? sumCh / sorted.length : 0;
    const avgWeighted = sumMc > 0 ? sumWeighted / sumMc : avg;
    // Bucket by sign so a small sector (≤ 2×EOD_SECTOR_PICKS tickers) doesn't
    // have the same names show up in both rows, and so a slightly-positive
    // ticker never gets rendered as a red laggard.
    const leaders = sorted.filter((r) => r.ch > 0).slice(0, EOD_SECTOR_PICKS).map((r) => ({ t: r.t, ch: r.ch }));
    const negatives = sorted.filter((r) => r.ch < 0);
    const laggards = negatives.slice(-EOD_SECTOR_PICKS).reverse().map((r) => ({ t: r.t, ch: r.ch }));
    sectors.push({
      name,
      count: sorted.length,
      avgChange: avg,
      avgChangeWeighted: avgWeighted,
      leaders,
      laggards,
    });
  }
  sectors.sort((a, b) => b.avgChangeWeighted - a.avgChangeWeighted);
  const stats = {
    up, down, flat,
    avgChange: tickers.length ? totalCh / tickers.length : 0,
    avgChangeWeighted: totalMc > 0 ? weightedCh / totalMc : 0,
  };
  return { stats, sectors };
}

const EOD_SYSTEM_PROMPT = (
  "You are a markets analyst writing a one-shot EOD recap of a single US trading session. " +
  "You receive per-sector aggregate stats (ticker counts, cap-weighted avg % change, top movers, top laggards). " +
  "Produce a 1-sentence headline capturing the day's broad-tape story, then a 1-2 sentence summary per sector that describes the move and cites the most notable tickers by symbol. " +
  "Order the sector summaries in the EXACT order provided. " +
  "Tone: factual, terse, trader-friendly. Cite magnitudes (e.g. \"up ~1.5%\") and call out divergences inside a sector when leaders and laggards diverge sharply. " +
  "Where a sector move plausibly maps to a well-known macro driver active around this date you may add a brief causal hint, but never invent specific news, earnings, or analyst actions. " +
  "If a sector's move is muted or mixed, say so directly. No emojis, no markdown, no quotes around tickers."
);

const EOD_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    sectors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          summary: { type: "string" },
        },
        required: ["name", "summary"],
      },
    },
  },
  required: ["headline", "sectors"],
};

function eodUserMessage(dateKey, stats, sectors) {
  const fmtPct = (p) => (p >= 0 ? "+" : "") + p.toFixed(2) + "%";
  const fmtNamed = (rows) => rows.length
    ? rows.map((r) => `${r.t} (${fmtPct(r.ch)})`).join(", ")
    : "none";
  const sectorBlock = sectors.map((s) => (
    `- ${s.name}: ${s.count} tickers, cap-weighted avg ${fmtPct(s.avgChangeWeighted)} ` +
    `(simple avg ${fmtPct(s.avgChange)}); ` +
    `top movers: ${fmtNamed(s.leaders)}; ` +
    `top laggards: ${fmtNamed(s.laggards)}`
  )).join("\n");
  return (
    `Date (ET close): ${dateKey}\n` +
    `Tape: ${stats.up} up, ${stats.down} down, ${stats.flat} flat; cap-weighted ${fmtPct(stats.avgChangeWeighted)} (simple avg ${fmtPct(stats.avgChange)}).\n\n` +
    `Sectors (descending by cap-weighted avg change):\n${sectorBlock}\n\n` +
    `Return JSON matching the schema. Use the EXACT sector names listed above as the \"name\" field, in the same order.`
  );
}

async function generateEodSummary(ai, dateKey, stats, sectors) {
  const userMessage = eodUserMessage(dateKey, stats, sectors);
  let response;
  let lastErr;
  for (let attempt = 0; attempt < AI_EOD_MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: AI_EOD_MODEL,
        config: {
          systemInstruction: EOD_SYSTEM_PROMPT,
          temperature: 0.35,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: EOD_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
        contents: userMessage,
      });
      recordAiUsage({
        model: AI_EOD_MODEL,
        callType: "heatmap-eod",
        usage: response?.usageMetadata,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === AI_EOD_MAX_ATTEMPTS - 1) throw err;
      const wait = AI_EOD_RETRY_BACKOFF_MS[attempt] ?? 30000;
      const msg = String(err?.message || err).split("\n")[0].slice(0, 120);
      console.log(`[heatmap] EOD AI attempt ${attempt + 1}/${AI_EOD_MAX_ATTEMPTS} failed (${msg}) — retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
  if (!response) throw lastErr ?? new Error("no response from Gemini");
  const text = response.text;
  if (!text) throw new Error("empty Gemini response");
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  const parsed = JSON.parse(jsonText);
  const headline = String(parsed?.headline || "").trim();
  if (!headline) throw new Error("empty headline in EOD response");
  const aiSectors = Array.isArray(parsed?.sectors) ? parsed.sectors : [];
  // Re-attach AI narrative onto our deterministic per-sector stats. The
  // numeric aggregates + ordering are computed in code; the model is only
  // trusted with the prose. A sector the model dropped renders with an
  // empty summary so the tile still appears with its stats.
  const summaryByName = new Map();
  for (const s of aiSectors) {
    if (!s || typeof s !== "object") continue;
    const name = String(s.name || "").trim();
    const summary = String(s.summary || "").replace(/\s+/g, " ").trim();
    if (name && summary) summaryByName.set(name, summary);
  }
  const mergedSectors = sectors.map((s) => ({
    name: s.name,
    count: s.count,
    avgChange: Math.round(s.avgChange * 100) / 100,
    avgChangeWeighted: Math.round(s.avgChangeWeighted * 100) / 100,
    leaders: s.leaders.map((r) => ({ t: r.t, ch: Math.round(r.ch * 100) / 100 })),
    laggards: s.laggards.map((r) => ({ t: r.t, ch: Math.round(r.ch * 100) / 100 })),
    summary: summaryByName.get(s.name) || "",
  }));
  return { headline, sectors: mergedSectors };
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
  const now = new Date();
  const todayEt = etDateKey(now);
  const hourEt = etHour(now);

  // EOD summary: carry forward whatever the prior file had if it's still
  // for today's session; otherwise drop it. Then, if it's after the close
  // and we don't have today's recap yet, generate one. Earlier-in-day runs
  // skip the AI call entirely.
  let eodSummary = prior?.eodSummary && prior.eodSummary.date === todayEt
    ? prior.eodSummary
    : null;
  const shouldGenerate =
    !eodSummary &&
    hourEt >= EOD_TRIGGER_ET_HOUR &&
    !!process.env.GEMINI_API_KEY;

  if (shouldGenerate) {
    console.log(`[heatmap] generating EOD summary for ${todayEt} (ET hour=${hourEt})…`);
    try {
      await loadAiUsageState();
      const { stats, sectors } = computeEodSectorStats(nextTickers);
      if (!sectors.length) {
        console.warn(`[heatmap] no sectors to summarize — skipping EOD generation`);
      } else {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const { headline, sectors: mergedSectors } = await generateEodSummary(ai, todayEt, stats, sectors);
        eodSummary = {
          date: todayEt,
          generatedAtIso: builtAtIso,
          model: AI_EOD_MODEL,
          headline,
          stats: {
            up: stats.up,
            down: stats.down,
            flat: stats.flat,
            avgChange: Math.round(stats.avgChange * 100) / 100,
            avgChangeWeighted: Math.round(stats.avgChangeWeighted * 100) / 100,
          },
          sectors: mergedSectors,
        };
        await writeAiUsageState();
        console.log(`[heatmap] EOD summary written — ${mergedSectors.length} sectors`);
      }
    } catch (err) {
      console.warn(`[heatmap] EOD summary generation failed: ${String(err?.message || err)}`);
      // Leave eodSummary as-is (null). The next hourly run can retry; if
      // all retries fail the heatmap renders without the recap section.
    }
  } else if (eodSummary) {
    console.log(`[heatmap] reusing existing EOD summary from ${eodSummary.date}`);
  } else if (hourEt < EOD_TRIGGER_ET_HOUR) {
    console.log(`[heatmap] skipping EOD generation (ET hour=${hourEt} < ${EOD_TRIGGER_ET_HOUR})`);
  } else {
    console.log(`[heatmap] skipping EOD generation (no GEMINI_API_KEY)`);
  }

  const payload = {
    builtAtIso,
    refreshedAtIso: builtAtIso,
    marketState,
    tickers: nextTickers,
    ...(eodSummary ? { eodSummary } : {}),
  };
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(path, json, "utf8");
  console.log(
    `[heatmap] wrote ${HEATMAP_FILE} — ${refreshed} refreshed, ${stale} kept stale, marketState=${marketState || "—"}, eod=${eodSummary ? eodSummary.date : "—"}, ${json.length} bytes`,
  );
}

main().catch((err) => {
  console.error(`[heatmap] fatal: ${String(err?.stack || err?.message || err)}`);
  process.exit(1);
});
