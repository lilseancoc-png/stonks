// What the Owner's own controls and the Webull paper account say right now,
// in the compact shape the Owner Market Brief and Home "Your desk" read
// (wave-1 integration, 2026-11-19). Pure: the bake reads the request-time
// files before its data/ wipe and passes them here. Owner-only output.
//
//   deskControls(run)        the Owner controls in force at the run
//                            (readOwnerControlsForRun in build.mjs)
//   webullFillSummary(ledger) how the paper account filled the record's
//                            recent trades (webull-paper-ledger.json)
//   engineLimitHolds(engines) trades the last engine run held back at an
//                            account limit (engines.json `checks`)
import { controlsSummary, SHARES_LIMIT_DEFAULT_USD } from "./owner-controls.mjs";
import { fillOutcome } from "./webull-mirror.mjs";
import { etClock } from "./us-equity-calendar.mjs";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const iso = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

// The run's controls (Sets and Maps) -> plain JSON. null when nothing is set
// and no account limit is on. The open engine stock cap is on at $1,000,000
// unless set (2026-11-23), so at that default alone it does not count as a
// limit the Owner set (the brief stays quiet); any limit set shows them all.
export function deskControls(run) {
  if (!run || typeof run !== "object") return null;
  const L = run.limits;
  const set = !!L?.any && (["openUsd", "dayLossUsd", "nameUsd", "newPerDay"].some((k) => L[k] != null) || (L.sharesUsd != null && L.sharesUsd !== SHARES_LIMIT_DEFAULT_USD));
  const limits = set ? {
    openUsd: run.limits.openUsd ?? null, dayLossUsd: run.limits.dayLossUsd ?? null,
    nameUsd: run.limits.nameUsd ?? null, newPerDay: run.limits.newPerDay ?? null, sharesUsd: run.limits.sharesUsd ?? null,
  } : null;
  if (run.enabled === false) return { enabled: false, limits };
  if (!run.any && !limits) return null;
  const s = controlsSummary(run);
  return {
    enabled: true, stop: s.stop, stopAt: iso(run.stopAt), avoid: s.avoid, close: s.close,
    watch: s.watch, catalysts: (run.catalysts || []).slice(0, 6).map((k) => ({ sym: k.sym || null, date: k.date, text: String(k.text || "").slice(0, 140) })),
    dial: s.dial, dialUntil: iso(run.dial?.until), limits,
  };
}

const BUCKETS = ["filled", "partial", "missed", "pending", "held", "shared", "notBought"];
const empty = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));

// The paper account's last `days` calendar days of record trades, split into
// Top Picks and the strategy engines. `held` = held back by the Owner's
// controls or account limits; `shared` = the same contract is held for
// another tracked trade (bought once). The entry gap is the average % between
// Webull's fill and the record's own entry price, filled trades only.
export function webullFillSummary(ledger, { nowMs = Date.now(), days = 7 } = {}) {
  const trades = Object.values(ledger?.trades || {}).filter((t) => t && typeof t === "object");
  if (!trades.length) return null;
  const since = nowMs - days * 86400000;
  const out = { since: new Date(since).toISOString(), days, picks: empty(), engines: empty(), gap: { picks: [], engines: [] } };
  let n = 0;
  for (const t of trades) {
    const at = Date.parse(t.engineEntryIso);
    if (!Number.isFinite(at) || at < since || at > nowMs + 300000) continue;
    const side = t.engine ? "engines" : "picks";
    const o = fillOutcome(t);
    const b = t.ownerHold ? "held" : o === "not-bought" ? "notBought" : o;
    if (!(b in out[side])) continue;
    out[side][b]++;
    n++;
    if ((o === "filled" || o === "partial") && fin(t.entryDiffPct)) out.gap[side].push(t.entryDiffPct);
  }
  if (!n) return null;
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return { since: out.since, days, n, picks: out.picks, engines: out.engines, gapPct: { picks: avg(out.gap.picks), engines: avg(out.gap.engines) } };
}

// One line for a fill summary side: "9 of 12 filled, 1 partly, 1 missed, 1 held by your controls".
export function fillLine(s) {
  if (!s) return "";
  const bought = s.filled + s.partial + s.missed + s.pending;
  const parts = [`${s.filled} of ${bought} filled`];
  if (s.partial) parts.push(`${s.partial} partly`);
  if (s.missed) parts.push(`${s.missed} missed`);
  if (s.pending) parts.push(`${s.pending} still working`);
  if (s.held) parts.push(`${s.held} held by your controls or limits`);
  if (s.shared) parts.push(`${s.shared} on a contract already held`);
  if (s.notBought) parts.push(`${s.notBought} not sent`);
  return bought || s.held || s.shared || s.notBought ? parts.join(", ") : "";
}

// Trades the newest engine run held back at an account limit, when that run
// was today (ET). engines.json `checks` keeps every scored row of the last run
// with its `why`; `runs[0]` is that run.
export function engineLimitHolds(engines, nowMs = Date.now()) {
  const run = Array.isArray(engines?.runs) ? engines.runs[0] : null;
  if (!run || !iso(run.iso) || etClock(Date.parse(run.iso)).date !== etClock(nowMs).date) return null;
  const rows = [];
  for (const [sym, list] of Object.entries(engines?.checks || {})) for (const r of Array.isArray(list) ? list : []) {
    if (typeof r?.why === "string" && r.why.startsWith("account limit")) rows.push({ sym, engine: r.engine, why: r.why.slice(0, 160) });
  }
  return rows.length ? { runIso: run.iso, n: rows.length, first: rows[0].why, syms: [...new Set(rows.map((r) => r.sym))].sort().slice(0, 8) } : null;
}
