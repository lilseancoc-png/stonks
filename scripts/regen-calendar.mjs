// One-shot helper to regenerate data/calendar.json with the extended
// schema (earnings AM/PM session, structured macro reports, FOMC widget
// data, CME FedWatch snapshots) without re-running the full Yahoo +
// Gemini pipeline. Reads the existing per-ticker chain JSON files to
// pick up nextEarningsDate / nextEarningsSession, then calls the new
// fetchers in scripts/build.mjs for the rest.
//
// Usage: node scripts/regen-calendar.mjs

import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");

// Re-import the build module to reuse its fetchers and payload builder.
const build = await import("./build.mjs");

async function loadChains() {
  const files = await readdir(DATA_DIR);
  const chains = {};
  for (const file of files) {
    if (!/^[A-Z][A-Z0-9.\-]*\.json$/.test(file)) continue;
    if (file === "calendar.json" || file === "picks.json" || file === "trends.json" ||
        file === "fedwatch-history.json" || file === "ai-usage.json" ||
        file === "trends-history.json" || file === "streaks.json") continue;
    try {
      const raw = await readFile(resolve(DATA_DIR, file), "utf8");
      const data = JSON.parse(raw);
      const sym = file.replace(/\.json$/, "");
      chains[sym] = data;
    } catch (_) { /* skip malformed */ }
  }
  return chains;
}

async function main() {
  const chains = await loadChains();
  console.log(`loaded ${Object.keys(chains).length} ticker chains`);

  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const cutoffMs = todayMs + 30 * 86400000;

  console.log("Fetching macro report releases (FRED)…");
  const reportEvents = await build.fetchMacroReleases(todayMs, cutoffMs);
  console.log(`  · ${reportEvents.length} report rows`);

  console.log("Fetching effective Fed Funds rate (FRED:DFF)…");
  const fedRate = await build.fetchEffectiveFedFundsRate();
  if (fedRate) console.log(`  · ${fedRate.rate}% as of ${fedRate.asOf}`);
  else console.log("  · unavailable");

  console.log("Snapshotting CME FedWatch probabilities…");
  const fedwatchHistory = await build.readFedwatchHistory();
  const upcomingMeetings = build.FOMC_MEETINGS_BASELINE.filter((m) => {
    const ms = Date.UTC(
      Number(m.date.slice(0, 4)),
      Number(m.date.slice(5, 7)) - 1,
      Number(m.date.slice(8, 10)),
    );
    return ms >= todayMs;
  });
  const todayIso = new Date(todayMs).toISOString().slice(0, 10);
  const snapshot = await build.fetchFedwatchSnapshot(upcomingMeetings, fedRate?.rate);
  let snapshotCount = 0;
  for (const [meetingDate, buckets] of Object.entries(snapshot)) {
    if (!buckets?.now) continue;
    if (!fedwatchHistory.meetings[meetingDate]) fedwatchHistory.meetings[meetingDate] = {};
    fedwatchHistory.meetings[meetingDate][todayIso] = buckets.now;
    snapshotCount++;
  }
  await build.writeFedwatchHistory(fedwatchHistory);
  console.log(`  · ${snapshotCount} meeting snapshots`);

  const fedwatch = {};
  for (const m of upcomingMeetings) {
    const fresh = snapshot[m.date];
    if (fresh && (fresh.now || fresh.day || fresh.week || fresh.month)) {
      fedwatch[m.date] = fresh;
    } else {
      fedwatch[m.date] = build.pickFedwatchBuckets(fedwatchHistory, m.date, todayIso);
    }
  }

  console.log("Fetching earnings AM/PM sessions (Nasdaq)…");
  const sessionMap = await build.fetchNasdaqEarningsSessions(todayMs, 30);
  console.log(`  · ${sessionMap.size} session entries`);

  // Read existing macro headlines so calendar continues to surface them.
  let macroHeadlines = [];
  try {
    const trendsRaw = await readFile(resolve(DATA_DIR, "trends.json"), "utf8");
    const trends = JSON.parse(trendsRaw);
    if (Array.isArray(trends.macroHeadlines)) macroHeadlines = trends.macroHeadlines;
  } catch (_) { /* no trends.json yet — ok */ }

  const info = await build.writeCalendarFile(chains, macroHeadlines, new Date().toISOString(), {
    reportEvents,
    fomcMeetings: upcomingMeetings,
    fedRate,
    fedwatch,
    sessionMap,
  });
  console.log(`wrote data/calendar.json — ${info.count} events, ${info.bytes} bytes`);
}

main().catch((e) => { console.error(e); process.exit(1); });
