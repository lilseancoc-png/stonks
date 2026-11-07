// Similar-setup odds for Top Picks (2026-11-07).
//
// For each pick on the roster and each open trade: how did past closed Top
// Picks trades with a similar setup turn out? "Similar" is the same side, the
// same grade band and the same market type at entry, loosened one step at a
// time until enough trades match:
//   1. side + grade band + market type
//   2. side + grade band
//   3. side + market type
//   4. side
// A level needs SETUP_MIN_N decided trades to be used; if none has that many,
// the side-only level is shown and flagged as too few.
//
// Source: the Track Record's closed trades plus its archive (every rule set;
// "left coverage" and flat closes do not count). Written into picks-open.json
// and picks-accuracy.json as `setupOdds`, keyed "SYMBOL|side", so the Top
// Picks cards and the Open picks page read it without loading the whole
// record. Pure: no network, no AI, no clock.

export const SETUP_ODDS_VERSION = 1;
export const SETUP_MIN_N = 8;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function gradeBand(score) {
  const s = num(score);
  if (s == null) return null;
  const a = Math.abs(s);
  return a >= 9 ? "9+" : a >= 8 ? "8" : a >= 7 ? "7" : "under 7";
}

// Severe and risk-off pool together: there are too few severe days to stand
// on their own.
export function marketType(regime) {
  const r = String(regime || "").toLowerCase();
  if (r === "risk-on") return "risk-on";
  if (r === "risk-off" || r === "severe") return "risk-off";
  if (r === "neutral") return "neutral";
  return null;
}

export function setupOf(trade, regimeFallback = null) {
  if (!trade) return null;
  const side = trade.side === "put" ? "put" : trade.side === "call" ? "call" : null;
  if (!side) return null;
  // Roster rows carry the grade as `total`; Track Record trades store it as
  // `score` (the total at entry).
  return { side, band: gradeBand(trade.total ?? trade.score), market: marketType(trade.entryRegime ?? regimeFallback) };
}

export function decidedTrades(closed) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(closed) ? closed : []) {
    if (!c || (c.outcome !== "win" && c.outcome !== "loss") || c.counted === false) continue;
    const pnl = num(c.optionPnlPct);
    if (pnl == null) continue;
    const key = `${c.symbol}:${c.side}:${c.entryDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ setup: setupOf(c), win: c.outcome === "win", pnl, real: num(c.realFillPnlPct) });
  }
  return out.filter((t) => t.setup);
}

function wilson(w, n) {
  if (!(n > 0)) return null;
  const z = 1.96, p = w / n, z2 = z * z, d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return [Math.round(Math.max(0, c - h) * 100), Math.round(Math.min(1, c + h) * 100)];
}

function summarize(list) {
  const n = list.length;
  const wins = list.filter((t) => t.win).length;
  const pnl = list.reduce((s, t) => s + t.pnl, 0);
  const real = list.filter((t) => t.real != null);
  return {
    n, wins, winPct: n ? Math.round((wins / n) * 100) : null, range: wilson(wins, n),
    avgPnlPct: n ? r1(pnl / n) : null,
    ...(real.length >= 3 ? { realN: real.length, avgRealPct: r1(real.reduce((s, t) => s + t.real, 0) / real.length) } : {}),
  };
}

const LEVELS = [
  { key: "side-band-market", needs: ["band", "market"] },
  { key: "side-band", needs: ["band"] },
  { key: "side-market", needs: ["market"] },
  { key: "side", needs: [] },
];

// The odds for one setup against the decided trades.
export function oddsFor(setup, decided, minN = SETUP_MIN_N) {
  if (!setup || !setup.side) return null;
  let fallback = null;
  for (const level of LEVELS) {
    if (level.needs.some((k) => !setup[k])) continue;
    const list = decided.filter((t) => t.setup.side === setup.side && level.needs.every((k) => t.setup[k] === setup[k]));
    const s = summarize(list);
    const row = { level: level.key, side: setup.side, ...(level.needs.includes("band") ? { band: setup.band } : {}), ...(level.needs.includes("market") ? { market: setup.market } : {}), ...s };
    if (s.n >= minN) return row;
    if (level.key === "side") fallback = { ...row, few: true };
  }
  return fallback;
}

// roster: picks.json picks (live setup, today's market type); open: open
// trades (setup frozen at entry). An open trade wins when both exist.
export function buildSetupOdds({ closed = [], archive = [], roster = [], rosterRegime = null, open = [], builtAtIso = null } = {}) {
  const decided = decidedTrades([...(closed || []), ...(archive || [])]);
  const byKey = {};
  for (const p of Array.isArray(roster) ? roster : []) {
    const setup = setupOf(p, rosterRegime);
    if (!setup || !p.symbol) continue;
    const odds = oddsFor(setup, decided);
    if (odds) byKey[`${p.symbol}|${setup.side}`] = odds;
  }
  for (const o of Array.isArray(open) ? open : []) {
    const setup = setupOf(o);
    if (!setup || !o.symbol) continue;
    const odds = oddsFor(setup, decided);
    if (odds) byKey[`${o.symbol}|${setup.side}`] = odds;
  }
  return { v: SETUP_ODDS_VERSION, builtAtIso, minN: SETUP_MIN_N, all: summarize(decided), picks: byKey };
}
