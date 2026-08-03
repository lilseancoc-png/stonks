// Standalone pre-market market-brief generator.
//
// The 08:30 ET dispatch routes here instead of running the full bake. It reads
// the last verified private-store snapshot, refreshes the inputs that genuinely
// move overnight (global markets, Fear & Greed, macro releases and headlines),
// and mints the rolling morning brief about one hour before the opening bell.
//
// Writes only data/briefs.json and data/ai-usage.json. buildMarketBriefs owns
// the same-hour idempotency gate, so a retry carries the already-minted brief.

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

function etHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value);
}

// Map calendar.json into the compact fact shape buildMarketBriefs consumes.
function calendarForBrief(calendar, todayEt, liveReports) {
  const events = Array.isArray(calendar?.events) ? calendar.events : [];
  const earnings = events.filter((event) => event?.type === "earnings" && event.symbol && event.date);
  const reports = (Array.isArray(liveReports) && liveReports.length ? liveReports : events)
    .filter((event) => event?.type === "report" && event.title && event.date);
  const meetings = Array.isArray(calendar?.fomc?.meetings) ? calendar.fomc.meetings : [];
  const nextMeeting = meetings.find((meeting) => meeting?.date && String(meeting.date) >= todayEt) || null;
  return {
    todayEarnings: earnings.filter((event) => String(event.date) === todayEt)
      .map((event) => ({ sym: event.symbol, session: event.session || "TBD" })),
    upcomingEarn: earnings.filter((event) => String(event.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 6)
      .map((event) => ({ sym: event.symbol, date: event.date, session: event.session || "TBD" })),
    todayReports: reports.filter((report) => String(report.date) === todayEt)
      .map((report) => ({
        title: report.title,
        subtype: report.subtype || null,
        actual: report.actual ?? null,
        consensus: report.consensus ?? null,
        previous: report.previous ?? null,
      })),
    upcomingReports: reports.filter((report) => String(report.date) > todayEt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 5)
      .map((report) => ({ title: report.title, date: report.date })),
    releases: buildMacroReleaseReads(reports, todayEt),
    nextFomc: nextMeeting
      ? {
          date: nextMeeting.date,
          daysOut: Math.max(0, Math.round(
            (Date.parse(`${nextMeeting.date}T00:00:00Z`) - Date.parse(`${todayEt}T00:00:00Z`)) / 86400000,
          )),
        }
      : null,
  };
}

async function main() {
  const startedAt = new Date();
  const hourEt = etHour(startedAt);
  if (hourEt !== 8) {
    throw new Error(`pre-market brief must run during the 08:xx ET hour (received ${String(hourEt).padStart(2, "0")}:xx ET)`);
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required to mint the pre-market brief");
  }

  await loadAiUsageState();
  const builtAtIso = startedAt.toISOString();
  const todayEt = etDateKey(startedAt);

  const chains = {};
  for (const symbol of TICKERS) {
    const payload = await readJson(`${symbol}.json`);
    if (payload && typeof payload === "object") chains[symbol] = payload;
  }
  console.log(`Loaded ${Object.keys(chains).length}/${TICKERS.length} last-verified ticker files.`);

  const briefsPrev = await readPriorBriefs();
  const macro = await readJson("macro.json");
  const unusual = await readJson("unusual.json");
  const calendarPayload = await readJson("calendar.json");
  const priorCorrelations = await readJson("correlations.json");
  const rfrPayload = await readJson("rfr-history.json");
  const ivTrending = await readJson("iv-trending.json");

  let correlations = priorCorrelations;
  try {
    const globalMarkets = await fetchAllGlobalMarkets();
    correlations = buildCorrelationsPayload(chains, globalMarkets, builtAtIso, priorCorrelations);
    console.log(`Overnight sweep: ${Object.keys(correlations?.markets || {}).length} markets${correlations?.stale ? " (carried fallback)" : ""}.`);
  } catch (err) {
    console.warn(`Overnight sweep failed (${String(err?.message || err).split("\n")[0]}); using the prior verified snapshot.`);
  }

  let fearGreed = null;
  try {
    fearGreed = await fetchCnnFearGreed();
  } catch (_) {
    // Fall through to the last verified payload.
  }
  if (!fearGreed || !Number.isFinite(fearGreed.score)) {
    fearGreed = await readJson("fear-greed.json");
  }

  let liveReports = null;
  try {
    const todayMs = Date.parse(`${todayEt}T00:00:00Z`);
    const rows = await fetchMacroReleases(
      todayMs - MACRO_RELEASE_LOOKBACK_DAYS * 86400000,
      todayMs + 35 * 86400000,
    );
    if (Array.isArray(rows) && rows.length) {
      liveReports = rows;
      const printed = rows.filter((row) => row.actual != null && String(row.date) === todayEt).length;
      console.log(`Live macro releases: ${rows.length} rows${printed ? ` (${printed} printed today)` : ""}.`);
    }
  } catch (err) {
    console.warn(`Macro-release refresh failed (${String(err?.message || err).split("\n")[0]}); using calendar.json.`);
  }

  let headlines = [];
  try {
    headlines = await fetchMacroHeadlines();
    console.log(`Live market headlines: ${headlines.length}.`);
  } catch (err) {
    console.warn(`Headline refresh failed (${String(err?.message || err).split("\n")[0]}); using trends.json.`);
  }
  if (!headlines.length) {
    const trends = await readJson("trends.json");
    if (Array.isArray(trends?.macroHeadlines)) headlines = trends.macroHeadlines;
  }

  const result = await buildMarketBriefs({
    briefsPrev,
    builtAtIso,
    chains,
    fearGreed,
    macro,
    correlations: correlations?.stale ? null : correlations,
    unusual,
    calendar: calendarForBrief(calendarPayload, todayEt, liveReports),
    rfr: Number.isFinite(rfrPayload?.rate) ? rfrPayload.rate : FALLBACK_RISK_FREE_RATE,
    headlines,
    ivTrending,
  });
  await writeAiUsageState();

  const written = await readJson("briefs.json");
  const current = written?.current;
  if (!current || current.date !== todayEt || current.kind !== "morning" || Number(current.etHour) !== 8) {
    throw new Error("pre-market brief generation did not leave a current 08:xx ET morning brief; prior store data remains authoritative");
  }
  console.log(`wrote data/briefs.json — morning brief ${result.generated ? "freshly generated" : "already current for this hour"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
