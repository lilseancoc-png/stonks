// What the bake does with the W3 Webull files (2026-11-19).
//
// The three Owner keys are written by Vercel (the webull-data runner jobs)
// and are request-time-exclusive: `sync-data.mjs pull` hydrates them into
// data/, the bake reads them BEFORE writeChainFiles wipes data/, and no
// workflow pushes or deletes them. This module reads them and turns them into
// what the bake consumes; every consumer is Owner-only:
//   - shadow inputs (lib/shadow-signals.mjs, version 8): per-name flow keys
//     wfl / wft / wfl5 and market gauges wbAdv / wbHL / wbUp5. Logged, never
//     scored.
//   - a Bottom tracker context row (never a gate or a vote)
//   - backups: earnings dates for the Top Picks decision when Yahoo/Nasdaq
//     have none, the Valuation lab street target when Yahoo has none, and
//     (only if Webull's index proves to be CNN's) Fear & Greed for the
//     engines' fear trial and fear test when CNN fails.
//   - the Owner report webull-backup-check.json (what was filled, where the
//     sources disagree).
// Switches (Owner Settings live switches, read here from the saved settings
// file as well as the environment; "0" = off): WEBULL_FLOW_LOG,
// WEBULL_BREADTH_LOG, WEBULL_BACKUPS. Off stops both the daily save (the
// runner reads the same switch) and the bake's use of what is saved.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FLOW_KEY, flowShadowRows, flowSummary } from "./flow.mjs";
import { BREADTH_KEY, breadthGauges, breadthContextRow, breadthSummary } from "./breadth.mjs";
import {
  BACKUP_KEY, BACKUP_CHECK_KEY, chainsWithEarningsBackup, earningsBackupMap, earningsDisagreements, streetTargetBackup,
  fearGreedCheck, fearGreedStandIn, econDisagreements, backupSummary,
} from "./backup.mjs";

export const W3_SWITCHES = Object.freeze(["WEBULL_FLOW_LOG", "WEBULL_BREADTH_LOG", "WEBULL_BACKUPS"]);
const OWNER_SETTINGS_KEY = "owner-settings.json";

const isOff = (v) => /^(?:0|off|false|no)$/i.test(String(v ?? "").trim());

// { WEBULL_FLOW_LOG: true|false, ... }. Off when the environment says so or
// the Owner switched it off on Owner Settings (saved value false).
export function w3Switches(env = process.env, settingsDoc = null) {
  const saved = settingsDoc && typeof settingsDoc === "object" && settingsDoc.values && typeof settingsDoc.values === "object" ? settingsDoc.values : {};
  const fromEnv = { WEBULL_FLOW_LOG: env?.WEBULL_FLOW_LOG, WEBULL_BREADTH_LOG: env?.WEBULL_BREADTH_LOG, WEBULL_BACKUPS: env?.WEBULL_BACKUPS };
  const out = {};
  for (const k of W3_SWITCHES) out[k] = !isOff(fromEnv[k]) && saved[k] !== false;
  return out;
}

async function readJson(dataDir, key) {
  try { return JSON.parse(await readFile(resolve(dataDir, key), "utf8")); } catch { return null; }
}

// Read before the wipe. Each file is null when missing, unreadable or
// switched off.
export async function readWebullW3(dataDir, env = process.env) {
  const settings = await readJson(dataDir, OWNER_SETTINGS_KEY);
  const on = w3Switches(env, settings);
  const [flow, breadth, backup] = await Promise.all([
    on.WEBULL_FLOW_LOG ? readJson(dataDir, FLOW_KEY) : null,
    on.WEBULL_BREADTH_LOG ? readJson(dataDir, BREADTH_KEY) : null,
    on.WEBULL_BACKUPS ? readJson(dataDir, BACKUP_KEY) : null,
  ]);
  return { on, flow: flow?.rows ? flow : null, breadth: Array.isArray(breadth?.history) ? breadth : null, backup: backup?.earnings ? backup : null };
}

// One status line for the bake log: counts and dates only.
export function w3LogLine(w3) {
  const f = w3?.flow ? flowSummary(w3.flow) : null, b = w3?.breadth ? breadthSummary(w3.breadth) : null, k = w3?.backup ? backupSummary(w3.backup) : null;
  const off = W3_SWITCHES.filter((s) => w3?.on && !w3.on[s]);
  return `Webull data (W3): flow ${f ? `${f.names} names, ${f.sessions} sessions to ${f.lastDate || "—"}` : "none"}; breadth ${b ? `${b.sessions} sessions to ${b.lastDate || "—"}` : "none"}; backups ${k ? `${k.earnings} earnings, ${k.targets} targets` : "none"}${off.length ? `; off: ${off.join(", ")}` : ""}`;
}

// Shadow inputs for the grade row dated `todayEt` (sessions before it only).
export function w3ShadowInputs(w3, todayEt) {
  return {
    flow: w3?.flow ? flowShadowRows(w3.flow, todayEt) : null,
    market: w3?.breadth ? breadthGauges(w3.breadth, todayEt) : {},
  };
}

// Evidence board rows: the flow keys and breadth gauges are logged only, and
// tested after about three months (63 sessions) of rows.
export const W3_EVIDENCE_SESSIONS = 63;
export function w3EvidenceTests(w3, todayEt) {
  const out = [];
  const add = (id, name, question, have, first, on) => {
    const status = !on ? "waiting" : have >= W3_EVIDENCE_SESSIONS ? "ready" : have > 0 ? "collecting" : "waiting";
    let projected = null;
    if (on && todayEt) {
      const left = Math.max(0, W3_EVIDENCE_SESSIONS - have);
      const ms = Date.parse(`${todayEt}T12:00:00Z`) + Math.ceil(left * 7 / 5) * 86400000;
      projected = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
    }
    out.push({
      id, name, lane: "signals", question,
      start: first || null, due: null, projected,
      progress: { have, need: W3_EVIDENCE_SESSIONS, unit: "sessions logged" },
      read: null,
      rule: "Logging only, never a vote. Test after about three months of sessions with the shadow-signal bar (10-day rank correlation 0.03+, same sign in both halves and after the grade).",
      status, verdict: null,
    });
  };
  const f = w3?.flow ? flowSummary(w3.flow) : null;
  const firstFlow = w3?.flow ? Object.values(w3.flow.rows || {}).map((r) => r?.[0]?.[0]).filter(Boolean).sort()[0] : null;
  add("webull-flow", "Webull order flow: logging, test after about 3 months",
    "Does large-order net buying (Webull capital flow) lead the stock over the next two weeks?",
    f?.sessions || 0, firstFlow, !!w3?.on?.WEBULL_FLOW_LOG);
  const b = w3?.breadth ? breadthSummary(w3.breadth) : null;
  const firstB = w3?.breadth?.history?.[0]?.date || null;
  add("webull-breadth", "Webull market breadth: logging, test after about 3 months",
    "Do whole-market advancers, 52-week highs minus lows and big movers lead SPY?",
    b?.sessions || 0, firstB, !!w3?.on?.WEBULL_BREADTH_LOG);
  return out;
}

export function w3BottomContextRow(w3, asOf) {
  return w3?.breadth ? breadthContextRow(w3.breadth, asOf) : null;
}

// The Owner report: what the backup filled and where the sources disagree.
export function buildBackupCheck({ w3, chains, todayEt, isEtf, earningsFilled = [], targetsFilled = [], fearGreed = null, ourReports = [], builtAtIso }) {
  const backup = w3?.backup || null;
  return {
    v: 1, key: BACKUP_CHECK_KEY, builtAt: builtAtIso, asOf: todayEt, on: w3?.on || null,
    source: "Webull OpenAPI (paper keys), Owner only",
    summary: backup ? backupSummary(backup) : null,
    earnings: { filled: earningsFilled, disagree: backup ? earningsDisagreements(chains, backup, todayEt, { isEtf }) : [] },
    targets: { filled: targetsFilled },
    fearGreed,
    econ: { disagree: backup ? econDisagreements(ourReports, backup) : [] },
  };
}

export async function writeBackupCheck(dataDir, check) {
  const body = JSON.stringify(check);
  await writeFile(resolve(dataDir, BACKUP_CHECK_KEY), body, "utf8");
  return { key: BACKUP_CHECK_KEY, bytes: body.length };
}

export {
  chainsWithEarningsBackup, earningsBackupMap, streetTargetBackup, fearGreedCheck, fearGreedStandIn,
  FLOW_KEY, BREADTH_KEY, BACKUP_KEY, BACKUP_CHECK_KEY,
};
