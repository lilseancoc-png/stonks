// Top Picks exit review (2026-11-22, the flagship review). Two things live here:
//
// 1. The HOLD exit style: a single call held a fixed number of trading
//    sessions with a wide premium stop and no take-profit and no stock stop.
//    It is frozen on a trade's exitPolicy at entry (PICKS_CALL_HOLD), and
//    resolvePickOutcome in build.mjs reads `style: "hold"`.
//
// 2. The SHADOW EXIT: every open single-option trade also runs the other exit
//    rule beside the real one, on the same marks (a trade on today's exits
//    shadows the hold rule, a hold trade shadows today's exits). The shadow
//    never closes, opens or sizes anything. When the real trade closes first,
//    the shadow keeps being marked from `shadowOpen` in picks-accuracy.json
//    until its own rule closes it, then its result is written onto the closed
//    trade. This is the live check the review asked for before the exit swap
//    goes on: the history test's option prices are modeled, so only live
//    marks can confirm it.
//
// Pure, no network, no AI.

export const EXIT_REVIEW_VERSION = 1;
// A shadow still open this long after its trade closed is closed at its last
// mark (a guard: the hold rule closes by 10 sessions, today's rule by expiry).
export const SHADOW_MAX_SESSIONS = 60;
export const SHADOW_OPEN_KEEP = 60;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 + 0 : null);

export function holdExitPolicy(sessions = 10, stopPct = 60) {
  const s = Math.max(1, Math.round(num(sessions) ?? 10));
  const st = Math.max(10, Math.min(100, num(stopPct) ?? 60));
  return { version: `2026-11-22-hold${s}-stop${st}`, style: "hold", holdSessions: s, takeProfitPct: null, stopPct: st };
}

export const isHoldPolicy = (p) => !!(p && p.style === "hold");

// The rule a trade shadows, or null (spreads are not shadowed: the hold rule
// was only tested on single options).
export function shadowPolicyFor(trade, todayPolicy, holdPolicy) {
  const structure = trade?.contract?.structure || "long";
  if (structure !== "long") return null;
  return isHoldPolicy(trade?.exitPolicy) ? todayPolicy : holdPolicy;
}

export const shadowRuleName = (policy) => (isHoldPolicy(policy) ? `hold ${policy.holdSessions} sessions, -${policy.stopPct}% stop` : `+${num(policy?.takeProfitPct) ?? 25}% / -${num(policy?.stopPct) ?? 50}% with the stock stop`);

// One step of a trade's shadow. prev: the stored shadowExit (or null); res:
// resolvePickOutcome's answer under the shadow policy (null = still open).
export function stepShadow(prev, { policy, res, pnlPct, sessions, builtAtIso }) {
  if (prev && prev.closed) return prev;
  const pnl = r1(num(pnlPct));
  const base = {
    rule: policy?.version || null, style: isHoldPolicy(policy) ? "hold" : "today",
    sessions: num(sessions), lastPnlPct: pnl,
    hiPct: r1(Math.max(num(prev?.hiPct) ?? -Infinity, pnl ?? -Infinity)) ?? null,
    loPct: r1(Math.min(num(prev?.loPct) ?? Infinity, pnl ?? Infinity)) ?? null,
  };
  if (!Number.isFinite(base.hiPct)) base.hiPct = null;
  if (!Number.isFinite(base.loPct)) base.loPct = null;
  if (res && res.status) return { ...base, closed: true, status: res.status, pnlPct: pnl, date: builtAtIso };
  return { ...base, closed: false };
}

// What rides shadowOpen once the real trade has closed: only what marking and
// the shadow rule read.
export function shadowCarry(row) {
  return {
    symbol: row.symbol, side: row.side, entryDate: row.entryDate, entrySpot: row.entrySpot ?? null,
    exitDate: row.exitDate || null, contract: row.contract, cut: row.cut ?? null, vehicleCut: row.vehicleCut ?? null,
    exitPolicy: row.exitPolicy || null, shadowExit: row.shadowExit,
  };
}

export const shadowKey = (r) => `${r?.symbol}|${r?.side}|${r?.entryDate}`;

// Write each resolved shadow onto its closed trade (the live window or the
// archive). Returns the rows still open.
export function settleShadows(shadowOpen, closedLists) {
  const byKey = new Map();
  for (const list of closedLists) for (const c of list || []) if (c) byKey.set(shadowKey(c), c);
  const still = [];
  for (const s of shadowOpen || []) {
    const row = byKey.get(shadowKey(s));
    if (s.shadowExit && s.shadowExit.closed) { if (row) row.shadowExit = s.shadowExit; continue; }
    if (row) row.shadowExit = s.shadowExit; // the latest open mark, so the page can show it
    still.push(s);
  }
  return still.slice(-SHADOW_OPEN_KEEP);
}

// The comparison: closed trades whose shadow has also closed, real result vs
// shadow result, overall and by side. `realPnl` reads the booked option P&L.
export function shadowExitStats(rows) {
  const done = (rows || []).filter((r) => r && r.shadowExit && r.shadowExit.closed
    && num(r.shadowExit.pnlPct) != null && num(r.optionPnlPct) != null
    && (r.outcome === "win" || r.outcome === "loss" || r.outcome === "flat"));
  const read = (list) => {
    if (!list.length) return { n: 0, realAvg: null, shadowAvg: null, diff: null, shadowBetter: null };
    const real = list.map((r) => num(r.optionPnlPct)), sh = list.map((r) => num(r.shadowExit.pnlPct));
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const d = list.map((_, i) => sh[i] - real[i]);
    const m = mean(d), v = d.length > 1 ? d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) : null;
    return {
      n: list.length, realAvg: r1(mean(real)), shadowAvg: r1(mean(sh)), diff: r1(m),
      t: v > 0 ? Math.round((m / Math.sqrt(v / d.length)) * 100) / 100 : null,
      shadowBetter: r1((d.filter((x) => x > 0).length / d.length) * 100),
    };
  };
  const pending = (rows || []).filter((r) => r && r.shadowExit && !r.shadowExit.closed).length;
  const style = (s) => done.filter((r) => r.shadowExit.style === s);
  return {
    v: EXIT_REVIEW_VERSION, pending,
    // Trades on today's exits, shadowing the hold rule (the swap's evidence).
    holdShadow: { all: read(style("hold")), call: read(style("hold").filter((r) => r.side === "call")), put: read(style("hold").filter((r) => r.side === "put")) },
    // Hold trades, shadowing today's exits (the swap's live check once it is on).
    todayShadow: { all: read(style("today")) },
  };
}
