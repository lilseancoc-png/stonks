// Engine history on the site (2026-11-17): the 1971-2026 history test of the
// six strategy engines (run by hand; aggregates in
// research/engines-history/latest.json, imported by
// scripts/engines-history-import.mjs) joined to today's market cell.
//
// Public file engines-history.json. It carries averages and counts only: no
// trade, ticker or contract (the repo and the file are public). It is context,
// not a vote: nothing here reads into a pick, a grade, a gate, an engine or a
// record. No AI call, no new download: today's cell reads the shared
// long-history cache the bake already holds (S&P 500 bars, FRED VIXCLS,
// DGS10, CPIAUCSL, NFCI).
//
// Switch: ENGINES_HISTORY=0 (Owner Settings, Research) writes a stub with
// enabled: false, and every place on the site that shows it hides.

export const ENGINES_HISTORY_KEY = 'engines-history.json';
export const ENGINES_HISTORY_RESULTS = 'research/engines-history/latest.json';
export const ENGINES_HISTORY_VERSION = 1;

// Engine ids as in lib/engines/config.mjs, in the order the site lists them.
export const STYLE_IDS = Object.freeze(['reversion', 'macro', 'technicals', 'earnings', 'fundamentals', 'flow']);
// Plain names for the public pages ("strategy styles"); the engine tag in
// brackets for the Owner pages. `standIn`: tested with a price-only stand-in.
export const STYLES = Object.freeze({
  reversion: { label: 'Dip buying', engine: 'Reversion', tag: 'REV', standIn: false },
  macro: { label: 'Macro and rates', engine: 'Macro', tag: 'MAC', standIn: false },
  technicals: { label: 'Trend and chart setups', engine: 'Technicals', tag: 'TEC', standIn: false },
  earnings: { label: 'Earnings drift', engine: 'Earnings & events', tag: 'ERN', standIn: true },
  fundamentals: { label: 'Quality momentum', engine: 'Fundamentals', tag: 'FUN', standIn: true },
  flow: { label: 'Volume flow', engine: 'Flow & positioning', tag: 'FLO', standIn: true },
});

// Which history-test eras go with each case study on the site. Keys are the
// era names in the results file.
export const CASE_ERAS = Object.freeze({
  // Booms & busts case studies (lib/history-rhymes.mjs ids).
  'rhymes:telecom': ['1995-99 dot-com bubble', '2000-02 dot-com bust'],
  'rhymes:housing': ['2003-07 recovery', '2008 financial crisis', '2009-10 rebound'],
  'rhymes:ai-buildout': ['2023-24 AI rally', '2025 tariff shock', '2025-26 after tariffs'],
  // Historical Data event library (lib/historical-events.mjs ids).
  'events:oil': ['1973-74 oil shock bear', '1979-80 second oil shock + Volcker'],
  'events:pandemic': ['2020 COVID crash', '2020 COVID rebound'],
  'events:mania': ['1995-99 dot-com bubble', '2000-02 dot-com bust'],
  'events:bank-run': ['2008 financial crisis'],
  'events:crash': ['1987 crash'],
  'events:war': ['1990 Gulf War recession'],
  'events:tariffs': ['2018 Q4 sell-off', '2025 tariff shock'],
  // The five crises the Historical Data events view lists together.
  crises: ['1973-74 oil shock bear', '2000-02 dot-com bust', '2008 financial crisis', '2020 COVID crash', '2022 rate-hike bear'],
});

// The market cell, the same rules the history test used (regime.mjs in the
// research folder): trend = S&P 500 close vs its 200-day average; volatility
// = VIX under 16 calm, under 25 normal, else stressed; rates = 10-year yield
// against six months earlier (0.5 point either way); inflation = CPI up 4% or
// more on a year = high; credit = Chicago Fed financial conditions index at or
// above 0 = tight.
export const CELL_RULES = Object.freeze({ smaDays: 200, vixCalm: 16, vixStressed: 25, ratesMove: 0.5, ratesLookbackDays: 182, inflHigh: 4, nfciTight: 0 });
export const STATE_LABELS = Object.freeze({
  trend: { up: 'S&P 500 above its 200-day average', down: 'S&P 500 below its 200-day average' },
  vol: { calm: 'VIX calm (under 16)', normal: 'VIX normal (16 to 25)', stressed: 'VIX stressed (25 or more)' },
  rates: { rising: '10-year yield up 0.5 point or more in six months', falling: '10-year yield down 0.5 point or more in six months', flat: '10-year yield about flat over six months' },
  infl: { high: 'Inflation 4% or more', low: 'Inflation under 4%' },
  fc: { tight: 'Financial conditions tight (NFCI at or above 0)', loose: 'Financial conditions loose (NFCI below 0)' },
});

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v) => (num(v) == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100);
const isDate = (t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t);
const DAY = 86400000;
const minusDays = (t, days) => new Date(Date.parse(t.slice(0, 10) + 'T00:00:00Z') - days * DAY).toISOString().slice(0, 10);

// { t, c } bars or { t, v } / { date, value } rows, oldest first.
function rowsOf(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ t: r?.t ?? r?.date, v: num(r?.c ?? r?.v ?? r?.value) }))
    .filter((r) => isDate(r.t) && r.v != null).map((r) => ({ t: r.t.slice(0, 10), v: r.v }))
    .sort((a, b) => a.t.localeCompare(b.t));
}
function lastOnOrBefore(rows, t) {
  let lo = 0, hi = rows.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= t) { at = m; lo = m + 1; } else hi = m - 1; }
  return at >= 0 ? rows[at] : null;
}

// Today's market cell from the shared long-history cache. Each part is null
// when its series is missing or older than `maxAgeDays` (a stale read is not
// today's market).
export function marketCell({ spx, vix, dgs10, cpi, nfci } = {}, { maxAgeDays = { spx: 7, vix: 10, dgs10: 10, cpi: 75, nfci: 21 } } = {}) {
  const S = rowsOf(spx), V = rowsOf(vix), Y = rowsOf(dgs10), C = rowsOf(cpi), N = rowsOf(nfci);
  if (S.length < CELL_RULES.smaDays) return null;
  const last = S[S.length - 1], asOf = last.t;
  const fresh = (row, key) => row && (Date.parse(asOf) - Date.parse(row.t)) / DAY <= maxAgeDays[key];
  const sma = S.slice(-CELL_RULES.smaDays).reduce((a, r) => a + r.v, 0) / CELL_RULES.smaDays;
  const parts = {
    trend: { state: last.v > sma ? 'up' : 'down', value: r2(last.v), sma200: r2(sma), gapPct: r1((last.v / sma - 1) * 100), date: asOf },
  };
  const v = lastOnOrBefore(V, asOf);
  parts.vol = fresh(v, 'vix') ? { state: v.v < CELL_RULES.vixCalm ? 'calm' : v.v < CELL_RULES.vixStressed ? 'normal' : 'stressed', value: r2(v.v), date: v.t } : null;
  const y = lastOnOrBefore(Y, asOf), y6 = lastOnOrBefore(Y, minusDays(asOf, CELL_RULES.ratesLookbackDays));
  parts.rates = fresh(y, 'dgs10') && y6 ? (() => { const d = y.v - y6.v; return { state: d >= CELL_RULES.ratesMove ? 'rising' : d <= -CELL_RULES.ratesMove ? 'falling' : 'flat', value: r2(y.v), change6m: r2(d), date: y.t }; })() : null;
  const c = C[C.length - 1], c1 = c ? lastOnOrBefore(C, minusDays(c.t, 365)) : null;
  parts.infl = fresh(c, 'cpi') && c1 && c1.v > 0 && c1.t <= minusDays(c.t, 330) ? (() => { const yoy = (c.v / c1.v - 1) * 100; return { state: yoy >= CELL_RULES.inflHigh ? 'high' : 'low', value: r1(yoy), date: c.t }; })() : null;
  const n = lastOnOrBefore(N, asOf);
  parts.fc = fresh(n, 'nfci') ? { state: n.v >= CELL_RULES.nfciTight ? 'tight' : 'loose', value: r2(n.v), date: n.t } : null;
  return { asOf, cell: parts.vol ? parts.trend.state + '/' + parts.vol.state : null, parts };
}

// How each style did in today's cell and in each of today's single states,
// since 1971. One row per style; `stat` is { n, avg, t }.
export function regimeFit(results, cell) {
  if (!cell || !results?.regime?.byState) return null;
  const by = results.regime.byState;
  const rows = STYLE_IDS.map((id) => {
    const s = by[id] || {};
    const out = { id, label: STYLES[id].label, engine: STYLES[id].engine, standIn: STYLES[id].standIn, all: results.styles?.[id] ? { n: results.styles[id].n, avg: results.styles[id].avg } : null };
    out.cell = cell.cell && s.cell?.[cell.cell] ? s.cell[cell.cell] : null;
    for (const dim of ['trend', 'vol', 'rates', 'infl', 'fc']) {
      const st = cell.parts?.[dim]?.state;
      out[dim] = st && s[dim]?.[st] ? s[dim][st] : null;
    }
    return out;
  });
  const ranked = rows.filter((r) => r.cell && r.cell.n >= 50).sort((a, b) => b.cell.avg - a.cell.avg);
  return { cell: cell.cell, rows, best: ranked[0]?.id || null, worst: ranked.at(-1)?.id || null };
}

// One sentence for the Owner brief and the Regime Lab: today's cell and how
// the styles did in it, best first, with trade counts.
export function fitLine(cell, fit) {
  if (!cell || !fit) return null;
  const p = cell.parts || {};
  const desc = [p.trend && (p.trend.state === 'up' ? 'S&P 500 above its 200-day' : 'S&P 500 below its 200-day'),
    p.vol && `VIX ${p.vol.state} (${p.vol.value})`, p.infl && `inflation ${p.infl.state} (${p.infl.value}%)`,
    p.fc && `financial conditions ${p.fc.state}`].filter(Boolean).join(', ');
  const fmt = (x) => (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  const cellRows = fit.rows.filter((r) => r.cell && r.cell.n >= 30).sort((a, b) => b.cell.avg - a.cell.avg);
  const inCell = cellRows.length ? `Since 1971 in this cell (${cell.cell}), average option profit per trade after costs: ${cellRows.map((r) => `${r.engine}${r.standIn ? '*' : ''} ${fmt(r.cell.avg)} (${r.cell.n.toLocaleString('en-US')} trades)`).join(', ')}.` : 'No style has 30 or more past trades in this cell.';
  const infl = fit.rows.filter((r) => r.infl && r.infl.n >= 30 && !r.standIn).sort((a, b) => b.infl.avg - a.infl.avg)[0];
  const fc = fit.rows.filter((r) => r.fc && r.fc.n >= 30 && !r.standIn).sort((a, b) => b.fc.avg - a.fc.avg)[0];
  const extra = [infl && p.infl ? `with inflation ${p.infl.state}, ${infl.engine} did best (${fmt(infl.infl.avg)}, ${infl.infl.n.toLocaleString('en-US')} trades)` : '',
    fc && p.fc ? `with conditions ${p.fc.state}, ${fc.engine} (${fmt(fc.fc.avg)}, ${fc.fc.n.toLocaleString('en-US')} trades)` : ''].filter(Boolean);
  return `Today (${cell.asOf}): ${desc || 'market cell unknown'}. ${inCell}${extra.length ? ' In any cell, ' + extra.join('; ') + '.' : ''} * = price-only stand-in. Context, not a vote.`;
}

// Public payload. `results` is the committed aggregates file; `inputs` are the
// series for today's cell.
export function buildEnginesHistory({ builtAtIso, results, inputs = {}, enabled = true } = {}) {
  if (!enabled) return { version: ENGINES_HISTORY_VERSION, builtAtIso, enabled: false };
  const check = validateEnginesHistory(results);
  if (!check.ok) throw new Error('engines history results invalid: ' + check.errors.join('; '));
  const cell = marketCell(inputs);
  const fit = regimeFit(results, cell);
  return {
    version: ENGINES_HISTORY_VERSION, builtAtIso, enabled: true,
    asOf: cell?.asOf || null,
    styles: STYLE_IDS.map((id) => ({ id, ...STYLES[id] })),
    results,
    caseEras: CASE_ERAS,
    rules: CELL_RULES, stateLabels: STATE_LABELS,
    today: cell ? { ...cell, fit, line: fitLine(cell, fit) } : null,
    note: 'History test of the six strategy engines, 1971-2026: averages and counts only. Context, not a vote: nothing here changes a pick, a grade, an engine or a record.',
  };
}

// The results file must stay aggregates only (the repo is public): no field
// that names a ticker, contract or single trade, and every list bounded.
const FORBIDDEN_KEYS = /^(symbol|symbols|ticker|tickers|contract|contracts|trade|trades|tradeId|occ|strike|expiry|expiration|d0|d1|p0|p1|pnl)$/i;
export function validateEnginesHistory(results) {
  const errors = [];
  if (!results || typeof results !== 'object') return { ok: false, errors: ['missing'] };
  if (!Array.isArray(results.eras) || !results.eras.length) errors.push('eras missing');
  if (!results.styles || STYLE_IDS.some((id) => !results.styles[id])) errors.push('styles missing');
  if (!results.regime?.byState) errors.push('regime missing');
  const walk = (v, path, depth) => {
    if (depth > 8) { errors.push('too deep at ' + path); return; }
    if (Array.isArray(v)) { if (v.length > 120) errors.push('list too long at ' + path); v.forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEYS.test(k)) errors.push('forbidden field ' + path + '.' + k); walk(x, path + '.' + k, depth + 1); }
  };
  walk(results, 'results', 0);
  return { ok: errors.length === 0, errors };
}
