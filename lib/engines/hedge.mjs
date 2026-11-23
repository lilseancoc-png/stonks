// Strategy engines: the VIX and rates pack (2026-11-21, owner: "Build all
// five, one PR", from the rotate-out-of-tech vs hedge history test of
// 2026-11-21; docs/engines.md "VIX and rates pack").
//
// The test (2007-2026, every engine history trade, real implied volatility)
// found that buying puts or inverse funds lost money at every VIX trigger and
// option length tried, so nothing here hedges. What held up:
//
//   1. VIX-rising pause. From a VIX jump while VIX is still under 25 (up 20%+
//      in five sessions, or over 1.25x its 50-day average) until VIX closes
//      back under its 50-day average, the signal engines open no new long in
//      a tech stock or a stock-index fund. Worst drop -$64.7K -> -$51.7K,
//      Sharpe 0.85 -> 0.92 (2007-2016) and 1.00 -> 1.10 (2017-2026), at a
//      cost of $41K of the $785K total.
//   2. VIX-rollover buy (a Macro paper trial). After VIX has been 25+ and
//      closes 15% off its 10-day peak, QQQ shares held 20 sessions: 72 events,
//      +2.1% in 20 sessions (69% up) against +1.35% on any day, both halves.
//   3. Momentum's non-tech sector switch. While QQQ closes a month under its
//      10-month average (and SPY does not), the basket holds the three
//      strongest non-tech sector funds instead of ten stocks (2022: -30% ->
//      -19%, same yearly return).
//   4. Volatility target for the Momentum basket: each new monthly holding
//      is sized by min(1, 35% / the basket's trailing 126-session
//      volatility), the rest in T-bills (Sharpe 1.07 -> 1.13, the 2026 drop
//      -40% -> -23%). The rotation at 20% looked good on that test (0.79 ->
//      0.84) but lost more return than it saved inside the engines' own
//      history test, so it is left out.
//   5. Rate-hike pause. While the 2-year yield is 0.5+ points over fed funds
//      and QQQ is under its 200-day average, no new tech or index-fund longs
//      (+$12K, worst drop -$64.7K -> -$59.7K, t 0.9: weak, kept as a switch).
//
// Puts are never paused, Reversion is not paused (see PAUSE_ENGINES), paper
// trials are left alone (they are there to gather their own live record),
// and non-tech stocks, bonds, gold and other funds are untouched. Each rule is an Owner Settings switch.
//
// Pure. No network, no AI. Nothing here reads or changes a Top Picks grade.

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x) => (fin(x) ? Math.round(x * 100) / 100 : null);

export const HEDGE = Object.freeze({
  // 1. The VIX-rising pause ("early, hold till calm" in the test).
  jump5: 0.2,           // VIX up this much over 5 sessions ...
  overAvg: 1.25,        // ... or over this multiple of its 50-day average ...
  calm: 25,             // ... while still under this level, starts the pause
  avgDays: 50,          // the pause ends on a close under the 50-day average
  // 2. The VIX-rollover buy.
  rollPeak: 25,         // the 10-session VIX peak was at least this
  rollDays: 10,
  rollOff: 0.15,        // and VIX closed this far under that peak
  rollGap: 20,          // sessions between two events (one 20-session hold each)
  rollFund: "QQQ",
  rollUsd: 25000,       // the test bought $30,000; $25,000 was the Webull paper mirror's largest stock order when this was added (2026-11-21; $250,000 since 2026-11-23)
  rollSessions: 20,
  // 5. The rate-hike pause.
  hikeGap: 0.5,         // 2-year yield minus fed funds, points
  // 3. The non-tech sector funds (the Select Sector SPDRs less technology
  // and communication services), ranked like the rotation engine.
  sectorFunds: Object.freeze(["XLP", "XLV", "XLU", "XLE", "XLF", "XLI", "XLB", "XLY", "XLRE"]),
  sectorTop: 3,
  // 4. The volatility target, per engine (annualized).
  // (Rotation at 20% was tried too: 12.2% to 11.0% a year for a worst drop
  // of -34.3% to -33.5% in the engines' history test, so it is left out.)
  volTarget: Object.freeze({ momentum: 0.35 }),
  volDays: 126,
  volMinDays: 60,
});

// What counts as tech for the two pauses: the three tech sector groups
// (lib/sector-groups.mjs) plus the names the test counted with them (the tech
// and stock-index funds, Vertiv, Alibaba, SpaceX). The test paused stock-index
// fund longs too (SPY, QQQ, IWM): they fall with tech in the drops it guards.
// The engines the two pauses reach: every signal engine but Reversion, whose
// dip buys are what a VIX jump sets up (in the engines' history test pausing
// them cost about $54,000 of Reversion's $102,000 and lowered the book's
// total; with Reversion left out the pack beat the book without it in both
// halves, 2026-11-21). Downside puts buys puts only.
export const PAUSE_ENGINES = Object.freeze(["earnings", "macro", "technicals", "fundamentals", "flow"]);
export const TECH_GROUPS = Object.freeze(["Mega-cap tech", "Semis & hardware", "Software & IT services"]);
export const TECH_EXTRA = Object.freeze(["QQQ", "SMH", "KWEB", "EWY", "SPY", "IWM", "VRT", "BABA", "SPCX"]);
export function isTechName(view, sym = view?.sym) {
  return TECH_EXTRA.includes(sym) || TECH_GROUPS.includes(view?.group || "");
}

// The VIX reads over a daily close series {t, v} (oldest first), worked out
// once: the pause state after each close (on at a jump under 25, held until a
// close under the 50-day average) and the rollover events (with the 20-session
// gap). `at(i)` is the read at close i.
export function vixTrack(V) {
  const n = V?.t?.length || 0, v = V?.v || [];
  const hold = new Array(n).fill(false), since = new Array(n).fill(null), avg = new Array(n).fill(null), roll = new Array(n).fill(false), peak = new Array(n).fill(null);
  let on = false, from = null, sum = 0, last = -1e9;
  for (let i = 0; i < n; i++) {
    sum += v[i]; if (i >= HEDGE.avgDays) sum -= v[i - HEDGE.avgDays];
    if (i < HEDGE.avgDays - 1) continue;
    const a = sum / HEDGE.avgDays, x = v[i];
    avg[i] = a;
    const jump = i >= 5 && v[i - 5] > 0 && x / v[i - 5] - 1 >= HEDGE.jump5 && x < HEDGE.calm;
    const over = x > HEDGE.overAvg * a && x < HEDGE.calm;
    if (jump || over) { if (!on) from = V.t[i]; on = true; }
    else if (x < a) { on = false; from = null; }
    hold[i] = on; since[i] = on ? from : null;
    let mx = -Infinity; for (let j = Math.max(0, i - HEDGE.rollDays + 1); j <= i; j++) mx = Math.max(mx, v[j]);
    peak[i] = mx;
    if (mx >= HEDGE.rollPeak && x <= (1 - HEDGE.rollOff) * mx && i - last >= HEDGE.rollGap) { roll[i] = true; last = i; }
  }
  return {
    at(i) {
      if (!(i >= 0 && i < n) || avg[i] == null) return null;
      return { date: V.t[i], vix: r2(v[i]), avg50: r2(avg[i]), chg5: i >= 5 && v[i - 5] > 0 ? r1((v[i] / v[i - 5] - 1) * 100) : null, hold: hold[i], since: since[i], peak10: r2(peak[i]), roll: roll[i] };
    },
  };
}

// Why a new trade is held back by one of the pauses, or null. Signal engines
// only, longs only (calls and shares), tech and stock-index names only, never
// a paper trial. `spec.vixPause` / `spec.hikePause` false = switched off.
export function hedgePauseWhy(ctx, view, c, spec, sdef = {}) {
  if (!ctx || spec?.core || !PAUSE_ENGINES.includes(spec?.id) || sdef?.trial || c?.side === "put" || !isTechName(view, c?.symbol)) return null;
  const m = ctx.macro || {};
  if (spec?.vixPause !== false && m.vixHold) {
    return `VIX pause: VIX ${m.vix} jumped while under ${HEDGE.calm}${m.vixHoldSince ? ` on ${m.vixHoldSince}` : ""} and has not closed back under its 50-day average (${m.vixAvg50}) yet, so no new tech or index-fund longs`;
  }
  const q = ctx.byId?.QQQ?.f;
  if (spec?.hikePause !== false && fin(m.hikeGap) && m.hikeGap >= HEDGE.hikeGap - 1e-9 && q && fin(q.c) && fin(q.sma200) && q.c < q.sma200) {
    return `Rate-hike pause: the 2-year yield is ${r2(m.hikeGap)} points over fed funds and QQQ is under its 200-day average, so no new tech or index-fund longs`;
  }
  return null;
}

// The bounce skip rule (2026-11-22, owner: "make sure we aren't catching a
// falling knife", chose "Both skip rules, panic exception" on the
// 2026-11-22 bounce test, then "Keep sell-off rule only" the same day;
// docs/engines.md "Bounce skip rules"). Reversion's washout bounce and its
// RSI(2) dip trial open no new trade while VIX is under 30 and the market is
// grinding lower: SPY under its 50-day with more than 60% of covered names
// under their own 50-day. The first version also skipped them whenever hikes
// were priced (the 2-year yield 0.5+ points over fed funds); that read was
// true every session from July 2026, so it worked as a standing off switch
// under VIX 30, and the bench re-test found the grind rule alone keeps most of
// the protection (+$843K, worst drop -$58K, against +$835K / -$52K with both
// and -$64K with neither), so the hike part was dropped before its first run.
// The 2007-2026 test (stock returns, 76 covered names): washout bounces with
// hikes priced and VIX under 30 lost 0.50% a trade (n 623, 44% won), in a
// grind with VIX under 30 lost 0.16% (n 918), both negative in both halves;
// with VIX at 30 or more they made 2.44% (n 234, 72% won). Both rules kept
// 1,657 trades at +0.80% and removed 1,297 at -0.10%; on the RSI(2) dip kept
// +0.60% against removed +0.09%. So a panic (VIX 30+) is left to trade: the
// knife is the slow grind, not the panic. Breadth reads the prior close; VIX
// is today's quote on the run day (ENGINES_LIVE_VIX), else the prior close.
export const BOUNCE = Object.freeze({
  setups: Object.freeze(["oversold-bounce", "rsi2-dip"]),
  panicVix: 30,        // VIX at or over this: neither rule applies
  grindShare: 0.6,     // more than this share of covered names under their 50-day
  minNames: 20,        // fewer names with a 50-day: no breadth read
});
// The share of covered names (not the sector funds) closing under their
// 50-day average, through the prior close, worked out once per run.
const breadthMemo = new WeakMap();
export function breadthUnder50(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  if (breadthMemo.has(ctx)) return breadthMemo.get(ctx);
  let n = 0, under = 0;
  for (const v of Object.values(ctx.byId || {})) {
    const f = v?.f;
    if (!v || v.aux || !f || !fin(f.c) || !fin(f.sma50)) continue;
    n++; if (f.c < f.sma50) under++;
  }
  const out = n >= BOUNCE.minNames ? { share: under / n, n } : null;
  breadthMemo.set(ctx, out);
  return out;
}
// Why a new washout bounce or RSI(2) dip is skipped, or null.
// `spec.bounceSkip` false = switched off. A missing VIX read gives no panic
// exception; a missing breadth read gives no skip.
export function bounceSkipWhy(ctx, c, spec) {
  if (!ctx || spec?.bounceSkip === false || spec?.id !== "reversion" || c?.side !== "call" || !BOUNCE.setups.includes(c?.setup)) return null;
  const m = ctx.macro || {}, vix = fin(m.vix) ? m.vix : null;
  if (vix != null && vix >= BOUNCE.panicVix - 1e-9) return null;
  const vixTxt = vix != null ? `VIX is ${r1(vix)}, under ${BOUNCE.panicVix}` : "no VIX reading";
  const s = ctx.spy, b = breadthUnder50(ctx);
  if (s && fin(s.c) && fin(s.sma50) && s.c < s.sma50 && b && b.share > BOUNCE.grindShare) {
    return `Bounce skip: the market is grinding lower (SPY under its 50-day, ${Math.round(b.share * 100)}% of covered names under theirs) and ${vixTxt}; bounces in that market lost money in both halves of 2007-2026`;
  }
  return null;
}

// The basket's trailing volatility, annualized: the equal-weight average of
// its holdings' daily returns over the last `days` sessions (closes from each
// view's `closes(n)`, aligned from the newest bar). Null under volMinDays.
export function basketVol(views, syms, days = HEDGE.volDays) {
  const cols = [];
  for (const s of syms || []) {
    const c = typeof views?.[s]?.closes === "function" ? views[s].closes(days + 1) : null;
    if (Array.isArray(c) && c.length >= HEDGE.volMinDays + 1) cols.push(c);
  }
  if (!cols.length) return null;
  const len = Math.min(...cols.map((c) => c.length)) - 1, R = [];
  for (let k = 1; k <= len; k++) {
    let sum = 0, n = 0;
    for (const c of cols) { const a = c[c.length - 1 - k], b = c[c.length - k]; if (a > 0 && b > 0) { sum += b / a - 1; n++; } }
    if (n) R.push(sum / n);
  }
  if (R.length < HEDGE.volMinDays) return null;
  const mean = R.reduce((a, b) => a + b, 0) / R.length;
  const sd = Math.sqrt(R.reduce((a, b) => a + (b - mean) ** 2, 0) / R.length);
  return sd > 0 ? sd * Math.sqrt(252) : null;
}
// The size a new monthly holding is bought at: min(1, target / volatility).
export function volScale(views, syms, target) {
  if (!fin(target) || !(target > 0) || !(syms || []).length) return null;
  const vol = basketVol(views, syms);
  if (!fin(vol)) return null;
  return { vol: r1(vol * 100), target: r1(target * 100), scale: Math.round(Math.min(1, target / vol) * 100) / 100 };
}

// A view for a fund the engines do not cover (the sector funds), from daily
// closes [{ t, c }] and the run's price: month-end closes for the monthly
// check and the last closes for the volatility read. `aux: true` keeps every
// signal engine off it; it has no `f` (no daily features).
export function auxView(sym, rows, today, spot) {
  const bars = (Array.isArray(rows) ? rows : []).map((r) => ({ t: String(r?.t ?? r?.date ?? "").slice(0, 10), c: Number(r?.c ?? r?.close) }))
    .filter((r) => r.t && r.t < String(today) && r.c > 0).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (bars.length < 30) return null;
  const mo = [];
  for (let j = 0; j < bars.length; j++) {
    const next = bars[j + 1]?.t || String(today);
    if (bars[j].t.slice(0, 7) !== next.slice(0, 7)) mo.push({ m: bars[j].t.slice(0, 7), d: bars[j].t, c: bars[j].c });
  }
  const c = bars.map((b) => b.c), px = Number(spot) > 0 ? Number(spot) : c[c.length - 1];
  const view = { sym, isEtf: true, aux: true, spot: px, mo: mo.slice(-14), group: "ETF", lastClose: { date: bars[bars.length - 1].t, c: c[c.length - 1] } };
  Object.defineProperty(view, "closes", { value: (n) => c.slice(Math.max(0, c.length - n)), enumerable: false });
  return view;
}
