// Pre-open overnight call (overnight review, 2026-10-26).
//
// Runs before the US open (the 09:00 ET transcript dispatch, then the
// overnight-preopen.yml schedule at about 09:05 and 09:20 ET). Reads every
// overnight input from the prior US close to now, scores it with the shared
// scorer (lib/overnight-tone.mjs) and writes data/overnight-preopen.json. The
// next bake folds it into the saved, graded log (data/overnight-log.json).
// Free Yahoo data only; no AI calls.
//
// Usage: node scripts/overnight-preopen.mjs [--force] [--now=ISO]
//   --force  run outside the 08:00-09:29 ET weekday window (testing only; the
//            entry is marked forced and the bake never uses it as the day's call)

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";
import { fetchOvernightSeries } from "../lib/overnight-fetch.mjs";
import { buildOvernightCall, etParts } from "../lib/overnight-inputs.mjs";
import { OVERNIGHT_PREOPEN_KEY, OVERNIGHT_LOG_KEY } from "../lib/overnight-log.mjs";
import { buildBriefExtendedHours } from "../lib/brief-extended-hours.mjs";
import { fetchBriefExtendedQuotes, TICKERS } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
export const PREOPEN_WINDOW_ET = { fromMin: 8 * 60, toMin: 9 * 60 + 30 };

export function inPreopenWindow(ms) {
  const p = etParts(ms);
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  return p.minutes >= PREOPEN_WINDOW_ET.fromMin && p.minutes < PREOPEN_WINDOW_ET.toMin;
}

async function readJson(name) {
  try { return JSON.parse(await readFile(resolve(DATA_DIR, name), "utf8")); } catch { return null; }
}

async function readChains() {
  const out = {};
  let names = [];
  try { names = await readdir(DATA_DIR); } catch { return out; }
  for (const sym of TICKERS) {
    if (!names.includes(`${sym}.json`)) continue;
    const d = await readJson(`${sym}.json`);
    if (d) out[sym] = d;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const nowArg = args.find((a) => a.startsWith("--now="));
  const nowMs = nowArg ? Date.parse(nowArg.slice(6)) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("invalid --now");
  if (!force && !inPreopenWindow(nowMs)) {
    console.log(`overnight pre-open: ${new Date(nowMs).toISOString()} is outside 08:00-09:29 ET on a weekday; nothing written.`);
    return;
  }
  const callDate = etParts(nowMs).date;
  const yahooFinance = new YahooFinance({
    suppressNotices: ["yahooSurvey"],
    validation: { logErrors: false },
    fetchOptions: { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" } },
  });
  const { series, failed } = await fetchOvernightSeries(yahooFinance, { nowMs, intradayDays: 6 });
  const calendar = await readJson("calendar.json");
  const log = await readJson(OVERNIGHT_LOG_KEY);
  // Pre-market movers and earnings around the bell across the covered names.
  let premarket = null;
  try {
    const chains = await readChains();
    const quotes = await fetchBriefExtendedQuotes(Object.keys(chains));
    const ext = buildBriefExtendedHours({ kind: "morning", quotes, chains, todayEt: callDate, asOfIso: new Date(nowMs).toISOString() });
    if (ext) premarket = { movers: ext.movers, earnings: ext.earnings.filter((e) => e.chPct != null).slice(0, 6) };
  } catch (err) {
    console.log(`    ⚠ pre-market movers skipped: ${String(err?.message || err).split("\n")[0]}`);
  }
  const call = buildOvernightCall({
    series, callDate, cutoffMs: nowMs, calendar, stats: log?.stats || null,
    capturedAtIso: new Date(nowMs).toISOString(), reconstructed: false, premarket,
  });
  if (!call) throw new Error("overnight pre-open: no prior US session in SPY history; nothing written");
  if (force && !inPreopenWindow(nowMs)) call.forced = true;
  call.fetchFailures = failed.length;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(resolve(DATA_DIR, OVERNIGHT_PREOPEN_KEY), JSON.stringify({ builtAtIso: new Date().toISOString(), call }), "utf8");
  const t = call.tone;
  console.log(`overnight pre-open ${callDate}: ${t.label} (score ${t.score}, ${t.present}/5 groups), gap call ${t.gap.call} ${t.gap.movePct ?? ""}%, session ${call.session.call}; ${t.excluded.length} stale input(s); ${call.events.length} event flag(s)`);
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
