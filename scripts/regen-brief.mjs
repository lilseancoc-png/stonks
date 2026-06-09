// Standalone market-brief generator — mints the MORNING brief pre-market.
//
// The daily bake's first run of the day is the 9:30 ET open, which is too late
// for a pre-market read; this script lets the oi-tracker workflow's ~08:30 ET
// dispatch mint the morning brief about an hour before the bell (its ~19:00 ET
// dispatch can also backfill a missing afternoon brief). buildMarketBriefs owns
// the once-per-ET-window gating + carry-forward and self-skips without
// GEMINI_API_KEY, so re-running this script is always safe — at worst it
// rewrites data/briefs.json with the carried-forward content.
//
// Everything deterministic is assembled from the committed artifacts of the
// most recent bake (per-ticker chains/technicals, macro, calendar, picks,
// unusual flow). Two things a pre-market brief genuinely needs fresher than
// yesterday's 16:00 bake are fetched live, each degrading gracefully:
//   - the overnight global-markets sweep (Asia just closed, Europe mid-session,
//     US futures) via fetchAllGlobalMarkets + buildCorrelationsPayload — the
//     committed correlations.json predates the Asian session entirely
//   - CNN Fear & Greed (falls back to the committed snapshot)
//
// Writes data/briefs.json and data/ai-usage.json (the shared AI budget — the
// brief call is recorded against the same per-day Gemini totals as the bake).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TICKERS,
  FALLBACK_RISK_FREE_RATE,
  buildMarketBriefs,
  readPriorBriefs,
  fetchAllGlobalMarkets,
  buildCorrelationsPayload,
  fetchCnnFearGreed,
  loadAiUsageState,
  writeAiUsageState,
} from "./build.mjs";
import { etDateKey } from "../lib/volume-flags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

async function readJson(name) {
  try {
    return JSON.parse(await readFile(resolve(DATA_DIR, name), "utf8"));
  } catch (_) {
    return null;
  }
}

// Map the committed data/calendar.json into the calForBrief shape main() builds
// in-memory (todayEarnings / upcomingEarn / todayReports / upcomingReports /
// nextFomc). Calendar `report` events are the BLS/FRED macro releases; the
// `macro`/`cpi` types are news headlines and deliberately excluded, matching
// the bake's reportEvents.
function calendarForBrief(cal, todayEt) {
  const events = Array.isArray(cal?.events) ? cal.events : [];
  const earn = events.filter((e) => e && e.type === "earnings" && e.symbol && e.date);
  const reports = events.filter((e) => e && e.type === "report" && e.title && e.date);
  const meetings = Array.isArray(cal?.fomc?.meetings) ? cal.fomc.meetings : [];
  const nextMeeting = meetings.find((m) => m && m.date && String(m.date) >= todayEt) || null;
  return {
    todayEarnings: earn.filter((e) => String(e.date) === todayEt)
      .map((e) => ({ sym: e.symbol, session: e.session || "TBD" })),
    upcomingEarn: earn.filter((e) => String(e.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 6)
      .map((e) => ({ sym: e.symbol, date: e.date, session: e.session || "TBD" })),
    todayReports: reports.filter((r) => String(r.date) === todayEt).map((r) => ({ title: r.title })),
    upcomingReports: reports.filter((r) => String(r.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5)
      .map((r) => ({ title: r.title, date: r.date })),
    nextFomc: nextMeeting
      ? {
        date: nextMeeting.date,
        daysOut: Math.max(0, Math.round((Date.parse(nextMeeting.date + "T00:00:00Z") - Date.parse(todayEt + "T00:00:00Z")) / 86400000)),
      }
      : null,
  };
}

async function main() {
  await loadAiUsageState();
  const builtAtIso = new Date().toISOString();
  const todayEt = etDateKey(new Date());

  // Committed per-ticker chains — GEX needs SPY/QQQ, the recap/extremes/volume
  // signals sweep the whole map. A missing file just drops that name.
  const chains = {};
  for (const sym of TICKERS) {
    const d = await readJson(`${sym}.json`);
    if (d && typeof d === "object") chains[sym] = d;
  }
  console.log(`Loaded ${Object.keys(chains).length} / ${TICKERS.length} committed ticker files.`);

  const briefsPrev = await readPriorBriefs();
  const macro = await readJson("macro.json");
  const unusual = await readJson("unusual.json");
  const picksJson = await readJson("picks.json");
  const calendarJson = await readJson("calendar.json");
  const priorCorrelations = await readJson("correlations.json");
  const rfrJson = await readJson("rfr-history.json");

  // Fresh overnight sweep. buildCorrelationsPayload falls back to the prior
  // committed payload when the sweep comes back too thin (or fails outright).
  let correlations = priorCorrelations;
  try {
    const globalMarkets = await fetchAllGlobalMarkets();
    correlations = buildCorrelationsPayload(chains, globalMarkets, builtAtIso, priorCorrelations);
    console.log(`Overnight sweep: ${Object.keys(correlations.markets || {}).length} markets${correlations.stale ? " (stale — fell back to prior)" : ""}.`);
  } catch (err) {
    console.warn(`Overnight sweep failed (${String(err?.message || err).split("\n")[0]}) — using committed correlations.json.`);
  }

  // Fear & Greed — CNN updates continuously; fall back to the committed snapshot.
  let fearGreed = null;
  try { fearGreed = await fetchCnnFearGreed(); } catch (_) { /* fall through */ }
  if (!fearGreed || !Number.isFinite(fearGreed.score)) fearGreed = await readJson("fear-greed.json");

  const res = await buildMarketBriefs({
    briefsPrev,
    builtAtIso,
    chains,
    fearGreed,
    macro,
    correlations,
    unusual,
    picks: Array.isArray(picksJson?.picks) ? picksJson.picks : [],
    calendar: calendarForBrief(calendarJson, todayEt),
    rfr: Number.isFinite(rfrJson?.rate) ? rfrJson.rate : FALLBACK_RISK_FREE_RATE,
    // Pre-market there is no new picks churn — the prior bake already narrated
    // its own events, and today's first bake will narrate today's.
    picksChanges: [],
  });
  await writeAiUsageState();
  console.log(`wrote data/briefs.json — morning:${res.morning ? "yes" : "no"} afternoon:${res.afternoon ? "yes" : "no"}${res.generated ? ` (${res.generated} generated this run)` : " (carry-forward only)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
