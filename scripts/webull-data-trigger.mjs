// Pings the daily Webull data runner (api/auth/[action].js "webull-data")
// until today's work is done or 50 minutes pass. Run by
// .github/workflows/webull-data.yml after the close. The repo is public, so
// this prints only HTTP statuses, counts and fixed labels: never a ticker,
// price, contract or account detail. The bearer token is derived from
// R2_SECRET_ACCESS_KEY (lib/webull-data/trigger.mjs), like the mirror's.
//
// Env: R2_SECRET_ACCESS_KEY (required), WEBULL_DATA_URL (default the site),
// WEBULL_DATA_MINUTES (default 50), WEBULL_DATA_BACKFILL (0 / 1 / empty),
// EVENT_NAME + TRIGGER_SCHEDULE (the workflow's event and cron line, for the
// daylight-saving route), WEBULL_DATA_STRICT=1 (fail the job when the day
// did not finish or the runner kept failing).
import { webullDataTriggerToken } from "../lib/webull-data/trigger.mjs";
import { sessionForDate, etClock } from "../lib/us-equity-calendar.mjs";

// The two UTC crons cover 16:40 ET in both daylight and standard time; only
// the one that matches today's offset runs. A late GitHub start keeps its
// routed slot (the cron line, not the runner's clock, decides). A market
// holiday or weekend skips.
export function routeRun({ eventName, schedule, nowMs = Date.now() }) {
  if (eventName !== "schedule") return { run: true, why: "manual run" };
  const hour = Number(String(schedule || "").trim().split(/\s+/)[1]);
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date(nowMs)));
  const utcHour = new Date(nowMs).getUTCHours();
  const offset = ((utcHour - etHour) + 24) % 24; // 4 in daylight time, 5 in standard
  const expected = offset === 4 ? 20 : offset === 5 ? 21 : null;
  if (expected == null) return { run: false, why: "unexpected New York offset" };
  if (hour !== expected) return { run: false, why: "companion UTC slot, no-op" };
  // The session the slot belongs to: today in ET, or yesterday when GitHub
  // started the run after midnight ET.
  const clock = etClock(nowMs);
  let date = clock.date;
  if (clock.minute < 6 * 60) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); date = d.toISOString().slice(0, 10); }
  const s = sessionForDate(date);
  if (s && !s.open) return { run: false, why: "market closed today" };
  return { run: true, why: "scheduled after the close" };
}

const LABELS = ["calls", "snapshot-names", "snapshot-contracts", "snapshot-wide", "snapshot-stale", "expired-due", "expired-saved", "expired-gone", "backfill-none", "registry-writes", "rate-limited", "errors", "misses", "bytes"];
const fmtCounts = (c = {}) => LABELS.filter((k) => c[k]).map((k) => `${k} ${Number(c[k]) || 0}`).join(", ") || "none";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const route = routeRun({ eventName: process.env.EVENT_NAME || "workflow_dispatch", schedule: process.env.TRIGGER_SCHEDULE });
  console.log(`Webull data: ${route.why}.`);
  if (!route.run) return;
  const secret = process.env.R2_SECRET_ACCESS_KEY || "";
  const strict = process.env.WEBULL_DATA_STRICT === "1";
  if (!secret) { console.log("Webull data: no store secret, skipped."); if (strict) process.exitCode = 1; return; }
  const base = process.env.WEBULL_DATA_URL || "https://mingstreet.app/api/auth/webull-data";
  const backfill = ["0", "1"].includes(process.env.WEBULL_DATA_BACKFILL) ? process.env.WEBULL_DATA_BACKFILL : "";
  const url = backfill ? `${base}?backfill=${backfill}` : base;
  const deadline = Date.now() + Math.max(1, Math.min(55, Number(process.env.WEBULL_DATA_MINUTES) || 50)) * 60000;
  const token = webullDataTriggerToken(secret);
  let pings = 0, failures = 0, last = null, done = false;
  while (Date.now() < deadline) {
    pings++;
    let res, body = null;
    try {
      res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(75000) });
      body = await res.json().catch(() => null);
    } catch (err) {
      failures++;
      console.log(`Webull data: ping ${pings} failed (${err?.name || "error"}).`);
      if (failures >= 5) break;
      await sleep(15000);
      continue;
    }
    if (!res.ok) {
      failures++;
      const why = body?.error ? `${String(body.error).slice(0, 40)}${body.code ? `, code ${String(body.code).slice(0, 40)}` : ""}${body.status ? `, status ${body.status}` : ""}${body.kind ? `, ${String(body.kind).slice(0, 30)}` : ""}` : "no body";
      console.log(`Webull data: ping ${pings} HTTP ${res.status} (${why}).`);
      if (failures >= 5) break;
      await sleep(20000);
      continue;
    }
    failures = 0;
    if (body?.ran === false && body?.more !== true) { console.log(`Webull data: not run (${String(body.reason || "unknown").slice(0, 60)}).`); done = true; break; }
    if (body?.ran) last = body;
    if (body?.ran && pings % 5 === 1) console.log(`Webull data: ping ${pings}, ${body.date || "?"} ${body.phase || ""}: ${fmtCounts(body.counts)}.`);
    if (body?.more === false) { done = true; break; }
    await sleep(Math.max(2000, Math.min(60000, Number(body?.waitMs) || 2000)));
  }
  const day = last?.day || {};
  console.log(`Webull data: ${done ? "done" : "stopped before done"} after ${pings} pings. Day ${last?.date || "?"} ${last?.phase || ""}: ${fmtCounts(day.counts)}; runner calls ${day.invocations ?? "?"}, runner time ${Math.round((day.msUsed || 0) / 1000)} s.`);
  const missLabels = Object.entries(day.misses || {}).map(([k, v]) => `${String(k).slice(0, 50)} ${Number(v) || 0}`).join(", ");
  if (missLabels) console.log(`Webull data: misses (${missLabels}).`);
  if (strict && (!done || failures)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
