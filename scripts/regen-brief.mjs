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
// unusual flow). Four things a pre-market brief genuinely needs fresher than
// yesterday's 16:00 bake are fetched live, each degrading gracefully:
//   - the overnight global-markets sweep (Asia just closed, Europe mid-session,
//     US futures) via fetchAllGlobalMarkets + buildCorrelationsPayload — the
//     committed correlations.json predates the Asian session entirely
//   - CNN Fear & Greed (falls back to the committed snapshot)
//   - the macro-release rows (fetchMacroReleases) — this run races the 8:30 ET
//     prints and ForexFactory posts actuals within minutes, so a CPI that's
//     already out reaches the morning brief (falls back to the committed
//     calendar rows, in which case the next bake's re-mint picks it up)
//   - the market-wide press/wire headline slate (fetchMacroHeadlines) — the
//     overnight headlines are the brief's tape-driver input (falls back to
//     the slate committed in trends.json by yesterday's last bake)
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
  fetchMacroHeadlines,
  fetchMacroReleases,
  buildMacroReleaseReads,
  MACRO_RELEASE_LOOKBACK_DAYS,
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
function calendarForBrief(cal, todayEt, liveReports) {
  const events = Array.isArray(cal?.events) ? cal.events : [];
  const earn = events.filter((e) => e && e.type === "earnings" && e.symbol && e.date);
  // Prefer the live macro-release sweep when the caller got one — the
  // committed calendar.json predates today's 8:30 ET prints (the prior bake
  // ran ~16:00 yesterday, so today's rows still carry actual=null).
  const reports = (Array.isArray(liveReports) && liveReports.length ? liveReports : events)
    .filter((e) => e && e.type === "report" && e.title && e.date);
  const meetings = Array.isArray(cal?.fomc?.meetings) ? cal.fomc.meetings : [];
  const nextMeeting = meetings.find((m) => m && m.date && String(m.date) >= todayEt) || null;
  return {
    todayEarnings: earn.filter((e) => String(e.date) === todayEt)
      .map((e) => ({ sym: e.symbol, session: e.session || "TBD" })),
    upcomingEarn: earn.filter((e) => String(e.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 6)
      .map((e) => ({ sym: e.symbol, date: e.date, session: e.session || "TBD" })),
    todayReports: reports.filter((r) => String(r.date) === todayEt)
      .map((r) => ({ title: r.title, subtype: r.subtype || null, actual: r.actual ?? null, consensus: r.consensus ?? null, previous: r.previous ?? null })),
    upcomingReports: reports.filter((r) => String(r.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5)
      .map((r) => ({ title: r.title, date: r.date })),
    // Releases that already printed (today + trailing lookback), classified
    // actual-vs-consensus — the brief's released-data block + the morning
    // re-mint trigger in buildMarketBriefs.
    releases: buildMacroReleaseReads(reports, todayEt),
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

  // Live macro-release sweep (BLS primary + FRED fallback + ForexFactory fast
  // actuals) — a third thing a pre-market brief needs fresher than yesterday's
  // bake: this run fires ~08:30 ET, racing the 8:30 releases, and ForexFactory
  // posts actuals within minutes. Degrades to the committed calendar rows
  // (which leaves today's actuals null until the next bake re-mints).
  let liveReports = null;
  try {
    const todayMs = Date.parse(todayEt + "T00:00:00Z");
    const live = await fetchMacroReleases(
      todayMs - MACRO_RELEASE_LOOKBACK_DAYS * 86400000,
      todayMs + 35 * 86400000,
    );
    if (Array.isArray(live) && live.length) {
      liveReports = live;
      const printed = live.filter((r) => r.actual && String(r.date) === todayEt).length;
      console.log(`Live macro releases: ${live.length} rows${printed ? ` (${printed} already printed today)` : ""}.`);
    }
  } catch (err) {
    console.warn(`Live macro-release sweep failed (${String(err?.message || err).split("\n")[0]}) — using committed calendar.json rows.`);
  }

  // Live press/wire headline sweep — the overnight slate (a geopolitical
  // headline that moved futures, a pre-market policy post) is exactly what a
  // pre-market tape-driver read needs, and the committed trends.json slate is
  // from yesterday's last bake. Degrades to that committed slate.
  let headlines = [];
  try {
    headlines = await fetchMacroHeadlines();
    console.log(`Live macro headlines: ${headlines.length}.`);
  } catch (err) {
    console.warn(`Macro headline sweep failed (${String(err?.message || err).split("\n")[0]}) — using committed trends.json slate.`);
  }
  if (!headlines.length) {
    const trends = await readJson("trends.json");
    if (Array.isArray(trends?.macroHeadlines)) headlines = trends.macroHeadlines;
  }

  const res = await buildMarketBriefs({
    briefsPrev,
    builtAtIso,
    chains,
    fearGreed,
    macro,
    correlations,
    unusual,
    picks: Array.isArray(picksJson?.picks) ? picksJson.picks : [],
    calendar: calendarForBrief(calendarJson, todayEt, liveReports),
    rfr: Number.isFinite(rfrJson?.rate) ? rfrJson.rate : FALLBACK_RISK_FREE_RATE,
    // Pre-market there is no new picks churn — the prior bake already narrated
    // its own events, and today's first bake will narrate today's.
    picksChanges: [],
    headlines,
  });
  await writeAiUsageState();
  console.log(`wrote data/briefs.json — morning:${res.morning ? "yes" : "no"} afternoon:${res.afternoon ? "yes" : "no"}${res.generated ? ` (${res.generated} generated this run)` : " (carry-forward only)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
