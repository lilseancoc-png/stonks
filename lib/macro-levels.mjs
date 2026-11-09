// Daily macro levels for macro-history.json (2026-11-08).
//
// The site used to keep only five closes per day (2Y, 10Y, 30Y, DXY, VIX) for
// 90 days, and the market tape's inputs were recomputed every build and lost.
// These helpers add the LEVELS the regime reads, one small row per ET day,
// so a later study can ask "what did the tape look like on the day of each
// pick?" without rebuilding it: the VIX curve (9-day, 30-day, 3-month, VVIX),
// crude, gold, MOVE, the high-yield spread, the universe put/call ratios,
// Fear & Greed, and the regime's own verdict. Pure; no fetch.

export const MACRO_HISTORY_KEEP = 260;
// The VIX percentile shown on Market Analysis keeps reading the trailing 90
// sessions even though the file now holds a year.
export const VIX_RANK_WINDOW = 90;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const leg = (l) => num(l?.value);

// Fields known at the first (pre-fetch) upsert: everything on macroBackdrop.
export const MACRO_LEVEL_LEG_KEYS = ["twoY", "tenY", "thirtyY", "dxy", "vix"];
export function macroLevelsFromBackdrop(macroBackdrop) {
  const m = macroBackdrop || {};
  const out = {};
  const vt = m.vixTerm || null;
  if (num(vt?.short) != null) out.vix9d = r2(vt.short);
  if (num(vt?.mid) != null) out.vix3m = r2(vt.mid);
  if (num(vt?.ratio) != null) out.vixRatio = Math.round(vt.ratio * 1000) / 1000;
  if (leg(m.crude) != null) out.crude = r2(leg(m.crude));
  if (leg(m.gold) != null) out.gold = r2(leg(m.gold));
  if (leg(m.move) != null) out.move = r2(leg(m.move));
  if (leg(m.credit) != null) out.hy = r2(leg(m.credit));
  return out;
}

// Fields known only after the chains and the tape are in: VVIX (overnight
// sweep), put/call, Fear & Greed and the regime verdict.
export function macroLevelsLate({ globalMarkets = null, putCall = null, fearGreed = null, macroRegime = null } = {}) {
  const out = {};
  const bars = globalMarkets?.["^VVIX"]?.bars;
  if (Array.isArray(bars) && bars.length) {
    const last = [...bars].reverse().find((b) => num(b?.c) != null);
    if (last) out.vvix = r2(last.c);
  }
  if (num(putCall?.oiRatio) != null) out.pcOi = r2(putCall.oiRatio);
  if (num(putCall?.volRatio) != null) out.pcVol = r2(putCall.volRatio);
  const fg = num(fearGreed?.score ?? fearGreed?.value ?? fearGreed?.now?.value);
  if (fg != null) out.fg = Math.round(fg);
  if (typeof macroRegime?.state === "string") out.regime = macroRegime.state;
  if (num(macroRegime?.stress) != null) out.stress = r2(macroRegime.stress);
  return out;
}

// Merge `levels` into today's entry without clobbering a value an earlier
// same-day build already recorded (a later flaked leg must not blank it).
export function mergeMacroLevels(history, today, levels) {
  if (!history || !Array.isArray(history.entries) || !today || !levels) return history;
  const entries = history.entries.slice();
  let idx = entries.findIndex((e) => e && e.date === today);
  if (idx < 0) { entries.push({ date: today }); idx = entries.length - 1; }
  const next = { ...entries[idx] };
  for (const [k, v] of Object.entries(levels)) {
    if (v == null) continue;
    next[k] = v;
  }
  entries[idx] = next;
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { ...history, entries: entries.slice(-MACRO_HISTORY_KEEP) };
}
