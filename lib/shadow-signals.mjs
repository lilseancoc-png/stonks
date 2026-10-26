// Shadow signals: candidate Top Picks inputs that are logged, not scored.
//
// Each value is computed for every covered name once per ET day and stored
// next to the grade total in grades-daily.json. scripts/diagnose-grade-ic.mjs
// then measures each one against forward 5/10/14-day returns on the whole
// universe, alone and after controlling for the grade. A signal earns a place
// in the grade only after it passes that test. Nothing here changes a grade,
// a pick, a contract or the track record, and nothing calls a provider or a
// model: every input is already in memory at bake time.
//
// Keys (short on purpose; the file keeps ~120 days of rows):
//   r21  own 21-trading-day return, %              (momentum vs reversal baseline)
//   im21 same-industry peers' mean 21-day return, % (leave-one-out, >= 2 peers)
//   vrp  ATM ~30d IV minus 20-day realized vol, vol points
//   cw   largest front-expiry call-OI strike vs spot, % (+ above spot)
//   pw   largest front-expiry put-OI strike vs spot, % (+ below spot)
//   pg   latest print's guidance within 45 days: +1 raised, 0 in line, -1 lowered
//   pe14 validated peer earnings ("driver" prints) in the next 14 calendar days
//
// Insider (Form 4) buying is deliberately absent: 13f.json keeps only the
// latest 120 transactions across the universe, so a name missing from that
// list is not a measured zero.

export const SHADOW_SIGNAL_VERSION = 1;
export const SHADOW_KEYS = ['r21', 'im21', 'vrp', 'cw', 'pw', 'pg', 'pe14'];
export const SHADOW_GUIDANCE_DAYS = 45;
export const SHADOW_PEER_EVENT_DAYS = 14;

const DAY = 86400000;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// Bake-time chains carry raw daily bars (_bars); files read back by
// regen-picks carry the compact priceSeries instead.
function closesOf(data) {
  if (Array.isArray(data?._bars) && data._bars.length) return data._bars.map((b) => num(b?.c));
  const c = data?.priceSeries?.c;
  return Array.isArray(c) ? c.map(num) : [];
}

function trailingReturnPct(closes, n) {
  if (closes.length <= n) return null;
  const last = closes[closes.length - 1], base = closes[closes.length - 1 - n];
  return last > 0 && base > 0 ? (last / base - 1) * 100 : null;
}

function realizedVolPct(closes, n = 20) {
  if (closes.length <= n) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i += 1) {
    const a = closes[i - 1], b = closes[i];
    if (!(a > 0) || !(b > 0)) return null;
    rets.push(Math.log(b / a));
  }
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1);
  return Math.sqrt(v * 252) * 100;
}

function wallPct(wall, spot, side) {
  const k = num(wall?.strike);
  if (!(k > 0) || !(spot > 0)) return null;
  return side === 'call' ? (k / spot - 1) * 100 : (1 - k / spot) * 100;
}

function printGuidance(data, nowMs) {
  const events = Array.isArray(data?.earningsHx?.events) ? data.earningsHx.events : [];
  let latest = null, latestMs = -Infinity;
  for (const ev of events) {
    const ms = Date.parse(ev?.date || '');
    if (Number.isFinite(ms) && ms <= nowMs && ms > latestMs) { latest = ev; latestMs = ms; }
  }
  if (!latest || nowMs - latestMs > SHADOW_GUIDANCE_DAYS * DAY) return null;
  const g = latest.guidance;
  return g === 'raised' ? 1 : g === 'lowered' ? -1 : g === 'inline' ? 0 : null;
}

function peerEventsBySymbol(spillover, nowMs) {
  const out = {};
  for (const ev of Array.isArray(spillover?.upcoming) ? spillover.upcoming : []) {
    const ms = Date.parse(`${ev?.date || ''}T12:00:00Z`);
    if (!Number.isFinite(ms) || ms < nowMs - DAY || ms > nowMs + SHADOW_PEER_EVENT_DAYS * DAY) continue;
    for (const f of Array.isArray(ev.followers) ? ev.followers : []) {
      if (f && f.follower && f.pairQualified) out[f.follower] = (out[f.follower] || 0) + 1;
    }
  }
  return out;
}

// chains: { SYM: chain data } for the covered universe (ETFs included; the
// IC script decides what to score). opts: { builtAtIso, groupOf(sym) -> key,
// oiTracker, spillover }. Every input is optional; a
// missing input leaves that key out rather than writing a zero.
export function buildShadowSignals(chains, opts = {}) {
  const nowMs = Number.isFinite(Date.parse(opts.builtAtIso || '')) ? Date.parse(opts.builtAtIso) : Date.now();
  const syms = Object.keys(chains || {}).filter((s) => chains[s] && num(chains[s].spot) > 0);
  const oiBySym = {};
  for (const row of Array.isArray(opts.oiTracker?.tickers) ? opts.oiTracker.tickers : []) if (row?.symbol) oiBySym[row.symbol] = row;
  const peers = opts.spillover ? peerEventsBySymbol(opts.spillover, nowMs) : null;

  const r21 = {};
  for (const s of syms) r21[s] = trailingReturnPct(closesOf(chains[s]), 21);
  const groups = {};
  if (typeof opts.groupOf === 'function') {
    for (const s of syms) {
      const g = opts.groupOf(s);
      if (g && r21[s] != null) (groups[g] ||= []).push(s);
    }
  }

  const out = {};
  for (const s of syms) {
    const d = chains[s];
    const spot = num(d.spot);
    const closes = closesOf(d);
    const row = {};
    if (r21[s] != null) row.r21 = r2(r21[s]);
    const g = typeof opts.groupOf === 'function' ? opts.groupOf(s) : null;
    const peerRets = g && groups[g] ? groups[g].filter((p) => p !== s).map((p) => r21[p]) : [];
    if (peerRets.length >= 2) row.im21 = r2(peerRets.reduce((a, x) => a + x, 0) / peerRets.length);
    const iv = num(d.ivRank?.iv), rv = realizedVolPct(closes, 20);
    if (iv > 0 && rv != null) row.vrp = r2(iv * 100 - rv);
    const oi = oiBySym[s];
    if (oi) {
      const cw = wallPct(oi.callWall, spot, 'call'), pw = wallPct(oi.putWall, spot, 'put');
      if (cw != null) row.cw = r2(cw);
      if (pw != null) row.pw = r2(pw);
    }
    const pg = printGuidance(d, nowMs);
    if (pg != null) row.pg = pg;
    if (peers) row.pe14 = peers[s] || 0;
    if (Object.keys(row).length) out[s] = SHADOW_KEYS.map((k) => (k in row ? row[k] : null));
  }
  return { v: SHADOW_SIGNAL_VERSION, keys: SHADOW_KEYS.slice(), rows: out };
}
