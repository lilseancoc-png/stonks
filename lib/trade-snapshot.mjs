// Entry snapshot: everything the engine saw when a Top Picks trade opened,
// frozen on the Track Record row as `entrySnapshot` (since 2026-11-06).
//
// The Track Record is the log. Instead of a separate shadow log, each trade
// carries every signal's vote, each pillar's score, the votes the grade has
// retired (what MACD and the 52-week position WOULD have said) and the
// candidate inputs that are not scored yet. A later study can then measure
// any of them on real trades, real fills and the Webull paper mirror.
//
// Pure, no network, no AI. Keys are short on purpose: picks-accuracy.json
// keeps every trade. A missing input is left out, never written as zero.

export const ENTRY_SNAPSHOT_VERSION = 1;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const PILLARS = { fundamentals: 'f', technicals: 't', mechanicals: 'm', narrative: 'n', ivCost: 'iv', regime: 'rg', timing: 'tm' };

function barsOf(data) {
  if (Array.isArray(data?._bars) && data._bars.length) {
    return data._bars.map((b) => ({ t: b?.t ?? b?.date ?? null, c: num(b?.c), v: num(b?.v) })).filter((b) => b.c > 0);
  }
  const ps = data?.priceSeries;
  if (!ps || !Array.isArray(ps.c)) return [];
  return ps.c.map((c, i) => ({ t: ps.t?.[i] ?? null, c: num(c), v: num(ps.v?.[i]) })).filter((b) => b.c > 0);
}

function sd(xs) {
  if (xs.length < 3) return null;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

// Heavy-volume 2-sigma day (Pattern lab's big-move read) on the latest bar:
// the 1-day log return against the prior 60 sessions' spread, and log volume
// against the prior 20 sessions. heavy = +1 / -1 when |z| >= 2 and volume z >= 1.
export function heavyMoveRead(data) {
  const bars = barsOf(data);
  if (bars.length < 25) return null;
  const i = bars.length - 1;
  const rets = [];
  for (let k = Math.max(1, i - 60); k < i; k++) rets.push(Math.log(bars[k].c / bars[k - 1].c));
  const s = sd(rets);
  if (!(s > 0)) return null;
  const z = Math.log(bars[i].c / bars[i - 1].c) / s;
  const vols = bars.slice(Math.max(0, i - 20), i).map((b) => b.v).filter((v) => v > 0).map(Math.log);
  const vs = sd(vols);
  const vz = vs > 0 && bars[i].v > 0 ? (Math.log(bars[i].v) - vols.reduce((a, x) => a + x, 0) / vols.length) / vs : null;
  return { z: r2(z), vz: r2(vz), heavy: vz != null && vz >= 1 && Math.abs(z) >= 2 ? Math.sign(z) : 0 };
}

// Post-earnings drift (Owner Lab's read): the latest print within 10 sessions,
// its reaction-day move and the drift since the reaction close.
export function postEarningsRead(data, maxSessions = 10) {
  const events = (Array.isArray(data?.earningsHx?.events) ? data.earningsHx.events : [])
    .filter((e) => e?.date && num(e.movePct) != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const bars = barsOf(data);
  if (!events.length || bars.length < 2) return null;
  const last = events[events.length - 1];
  const idx = bars.findIndex((b) => String(b.t || '').slice(0, 10) >= last.date);
  if (idx < 0) return null;
  const sessions = bars.length - 1 - idx;
  if (sessions < 0 || sessions > maxSessions) return null;
  const after = num(last.closeAfter);
  const lastClose = bars[bars.length - 1].c;
  return {
    date: last.date, s: sessions, mv: r2(num(last.movePct) * 100),
    dr: after > 0 ? r2((lastClose / after - 1) * 100) : null,
    sp: num(last.surprisePct) != null ? r2(num(last.surprisePct)) : null,
  };
}

// What the two votes the grade dropped on 2026-11-06 would have said, so the
// record can still test them.
export function retiredVotes(data) {
  const t = data?.technicals || {};
  const f = data?.fundamentals || {};
  const out = {};
  const mh = num(t.macd?.hist), ml = num(t.macd?.line), ms = num(t.macd?.signal);
  if (mh != null && ml != null && ms != null) out.macd = ml > ms && mh > 0 ? 1 : ml < ms && mh < 0 ? -1 : 0;
  const spot = num(data?.spot), hi = num(f.fiftyTwoWeekHigh), lo = num(f.fiftyTwoWeekLow);
  const rsi = num(t.rsi), rsi5 = num(t.rsi5d);
  if (spot > 0 && hi > 0 && lo > 0 && hi > lo) {
    out.fw = spot >= hi * 0.95 ? -1 : (spot <= lo * 1.05 && rsi != null && rsi5 != null && rsi > rsi5) ? 1 : 0;
    out.fwPos = Math.round(((spot - lo) / (hi - lo)) * 100);
  }
  return out;
}

// pick: the picks.json row; data: that name's chain object; opts.shadow: the
// day's buildShadowSignals() result ({ keys, rows }) when the bake has one.
export function buildEntrySnapshot(pick, data, opts = {}) {
  if (!pick) return null;
  const pillars = {};
  const signals = {};
  for (const [name, p] of Object.entries(pick.pillars || {})) {
    const short = PILLARS[name];
    if (short && num(p?.score) != null) pillars[short] = r2(num(p.score));
    for (const s of Array.isArray(p?.signals) ? p.signals : []) {
      if (s && s.key && s.available !== false && num(s.score) != null) signals[s.key] = num(s.score);
    }
  }
  const t = data?.technicals || {};
  const spot = num(data?.spot);
  const ctx = {};
  if (num(t.rsi) != null) ctx.rsi = r2(num(t.rsi));
  if (num(t.macd?.hist) != null) ctx.macdHist = num(t.macd.hist);
  for (const [k, lbl] of [['sma20', 'd20'], ['sma50', 'd50'], ['sma200', 'd200']]) {
    const lv = num(t.sma?.[k]);
    if (spot > 0 && lv > 0) ctx[lbl] = r2((spot / lv - 1) * 100);
  }
  if (num(t.volume?.rvol) != null) ctx.rvol = r2(num(t.volume.rvol));
  const sr = t.srPrior || null;
  if (sr && spot > 0) {
    if (num(sr.r20) > 0) ctx.r20 = r2((spot / num(sr.r20) - 1) * 100);
    if (num(sr.s20) > 0) ctx.s20 = r2((spot / num(sr.s20) - 1) * 100);
  }
  const st = pick.streak || null;
  if (st && st.color) {
    ctx.streak = { c: st.color, d: num(st.days), cum: r2(num(st.cumulativePct)), ...(st.volumeTrend ? { vt: st.volumeTrend } : {}), ...(st.read ? { k: st.read } : {}) };
  }
  const retired = retiredVotes(data);
  const heavy = heavyMoveRead(data);
  const ped = postEarningsRead(data);
  const shadow = {};
  const sKeys = Array.isArray(opts.shadow?.keys) ? opts.shadow.keys : [];
  const sRow = opts.shadow?.rows?.[pick.symbol];
  if (Array.isArray(sRow)) sKeys.forEach((k, i) => { if (sRow[i] != null) shadow[k] = sRow[i]; });
  return {
    v: ENTRY_SNAPSHOT_VERSION,
    pillars,
    signals,
    ...(Object.keys(ctx).length ? { ctx } : {}),
    ...(Object.keys(retired).length ? { retired } : {}),
    ...(heavy ? { heavy } : {}),
    ...(ped ? { ped } : {}),
    ...(Object.keys(shadow).length ? { shadow } : {}),
  };
}
