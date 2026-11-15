// Winning margin: bands, Kalshi's own win-by prices and a live record.
//
//   marginBands(fc, game, sport)   the team game model's chance of each
//       winning-margin band per team (NBA 1-5, 6-10, 11-15, 16-20, 21+; NFL
//       1-6, 7-13, 14-20, 21+), a tie (NFL), the most likely result and the
//       50% / 80% ranges of the home margin. Read from the forecast's
//       whole-number margin distribution, so it agrees with winByLadder.
//   readKalshiGames(...)           the open Kalshi game-winner and spread
//       ("<team> wins by over 3.5 points") markets for one league, matched to
//       stored games by date and team codes. Free public API, no account; at
//       most four requests per league per run. Mid of bid and ask.
//   updateWinByRecord / winByRecordSummary   the live record: every
//       scheduled game's forecast is frozen before it starts (the last data
//       run before the game wins) with the Kalshi prices of that run, then
//       graded after the final. Nothing is placed and nothing feeds a model.
//
// Records: `<sport>/kalshi-games.json` (newest read only) and
// `<sport>/win-by-record/<season>.json` (lib/sports/store.mjs).
import { forecastGame, restDaysFor } from './team-model.mjs';
import { kalshiProb } from '../prediction/venues.mjs';

export const WIN_BY_RECORD_VERSION = 1;
export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
export const KALSHI_GAME_SERIES = Object.freeze({
  nfl: { winner: 'KXNFLGAME', spread: 'KXNFLSPREAD' },
  nba: { winner: 'KXNBAGAME', spread: 'KXNBASPREAD' },
});
export const MARGIN_BANDS = Object.freeze({
  nba: [[1, 5], [6, 10], [11, 15], [16, 20], [21, null]],
  nfl: [[1, 6], [7, 13], [14, 20], [21, null]],
});
const LADDER_MAX = 20;
const FREEZE_AHEAD_MS = 48 * 3600000;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const bandLabel = ([lo, hi]) => (hi == null ? `${lo}+` : `${lo}-${hi}`);

function marginPmf(fc) {
  const P = fc?.pmf?.margin;
  if (!P || !Array.isArray(P.p) || !P.p.length) return null;
  const all = P.p.reduce((a, b) => a + b, 0) || 1;
  return { start: P.start, p: P.p.map((x) => x / all) };
}
function chanceIn(pmf, lo, hi, sign) {
  let s = 0;
  for (let i = 0; i < pmf.p.length; i++) {
    const m = sign * (pmf.start + i);
    if (m >= lo && (hi == null || m <= hi)) s += pmf.p[i];
  }
  return s;
}
function quantile(pmf, q) {
  let c = 0;
  for (let i = 0; i < pmf.p.length; i++) { c += pmf.p[i]; if (c >= q - 1e-9) return pmf.start + i; }
  return pmf.start + pmf.p.length - 1;
}

export function marginBands(fc, game, sport) {
  const pmf = marginPmf(fc);
  if (!pmf || !game) return null;
  const bands = MARGIN_BANDS[sport] || MARGIN_BANDS.nba;
  const side = (sign) => bands.map((b) => ({ label: bandLabel(b), lo: b[0], hi: b[1], chance: r3(chanceIn(pmf, b[0], b[1], sign)) }));
  let best = 0;
  for (let i = 1; i < pmf.p.length; i++) if (pmf.p[i] > pmf.p[best]) best = i;
  const m = pmf.start + best;
  const team = (hm) => (hm > 0 ? game.home_team : hm < 0 ? game.away_team : null);
  const range = (lo, hi) => ({ low: quantile(pmf, lo), high: quantile(pmf, hi) });
  return {
    bands: { [game.home_team]: side(1), [game.away_team]: side(-1) },
    tie: r3(chanceIn(pmf, 0, 0, 1)),
    most_likely: { team: team(m), by: Math.abs(m), chance: r3(pmf.p[best]) },
    median_home_margin: quantile(pmf, 0.5),
    // Home margin terms: +7 is the home team by 7, -3 the away team by 3.
    range50: range(0.25, 0.75), range80: range(0.1, 0.9),
    note: 'Home margin terms in the ranges: +7 is the home team by 7, -3 the away team by 3.',
  };
}

// The team's band for a final home margin, as its index in MARGIN_BANDS.
function bandOf(sport, homeMargin) {
  if (homeMargin === 0) return { team: null, i: -1 };
  const bands = MARGIN_BANDS[sport] || MARGIN_BANDS.nba;
  const by = Math.abs(homeMargin);
  return { team: homeMargin > 0 ? 'home' : 'away', i: bands.findIndex(([lo, hi]) => by >= lo && (hi == null || by <= hi)) };
}

// ---- Kalshi game markets ----------------------------------------------------

// Kalshi's team abbreviations where they differ from the stored codes.
const KALSHI_CODES = {
  nfl: { JAC: 'jax', LAR: 'la', LA: 'la', WSH: 'was' },
  nba: { GSW: 'gs', NOP: 'no', NYK: 'ny', SAS: 'sa', UTA: 'utah', WAS: 'wsh', BRK: 'bkn', PHO: 'phx' },
};
const NICKNAMES = {
  nba: { atl: 'hawks', bkn: 'nets', bos: 'celtics', cha: 'hornets', chi: 'bulls', cle: 'cavaliers', dal: 'mavericks', den: 'nuggets', det: 'pistons', gs: 'warriors', hou: 'rockets', ind: 'pacers', lac: 'clippers', lal: 'lakers', mem: 'grizzlies', mia: 'heat', mil: 'bucks', min: 'timberwolves', no: 'pelicans', ny: 'knicks', okc: 'thunder', orl: 'magic', phi: '76ers', phx: 'suns', por: 'trail blazers', sa: 'spurs', sac: 'kings', tor: 'raptors', utah: 'jazz', wsh: 'wizards' },
  nfl: { ari: 'cardinals', atl: 'falcons', bal: 'ravens', buf: 'bills', car: 'panthers', chi: 'bears', cin: 'bengals', cle: 'browns', dal: 'cowboys', den: 'broncos', det: 'lions', gb: 'packers', hou: 'texans', ind: 'colts', jax: 'jaguars', kc: 'chiefs', lv: 'raiders', lac: 'chargers', la: 'rams', mia: 'dolphins', min: 'vikings', ne: 'patriots', no: 'saints', nyg: 'giants', nyj: 'jets', phi: 'eagles', pit: 'steelers', sea: 'seahawks', sf: '49ers', tb: 'buccaneers', ten: 'titans', was: 'commanders' },
};
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

export function kalshiAbbrs(code, sport) {
  const c = String(code || '').toLowerCase();
  return [c.toUpperCase(), ...Object.entries(KALSHI_CODES[sport] || {}).filter(([, v]) => v === c).map(([k]) => k)];
}
// "KXNFLSPREAD-26OCT25KCSEA" → { date: "2026-10-25", teams: "KCSEA" }
export function parseKalshiGameTicker(ticker) {
  const m = /^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)\d*$/.exec(String(ticker || '').toUpperCase());
  if (!m || !MONTHS[m[2]]) return null;
  return { date: `20${m[1]}-${MONTHS[m[2]]}-${m[3]}`, teams: m[4] };
}
const dayGap = (a, b) => Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
const gameDay = (g) => g.local_date || String(g.start_utc || '').slice(0, 10);

export function matchKalshiEvent(evt, games, sport) {
  const t = parseKalshiGameTicker(evt?.event_ticker);
  if (!t) return null;
  for (const g of games) {
    if (g.status !== 'scheduled' || dayGap(gameDay(g), t.date) > 1) continue;
    for (const a of kalshiAbbrs(g.away_team, sport)) for (const h of kalshiAbbrs(g.home_team, sport)) {
      if (t.teams === a + h || t.teams === h + a) return g;
    }
  }
  return null;
}
// Which of the game's two teams a market is about: the nickname or
// abbreviation in its label, else the letters of its ticker's last part.
export function kalshiMarketTeam(m, game, sport) {
  const text = ` ${String(m?.yes_sub_title || m?.subtitle || m?.title || '').toLowerCase()} `;
  const hits = [game.home_team, game.away_team].filter((code) => {
    const nick = NICKNAMES[sport]?.[code];
    return (nick && text.includes(nick)) || kalshiAbbrs(code, sport).some((a) => new RegExp(`(^|[^a-z])${a.toLowerCase()}([^a-z]|$)`).test(text.slice(0, 12)));
  });
  if (hits.length === 1) return hits[0];
  const tail = /([A-Z]+)\d*$/.exec(String(m?.ticker || '').split('-').pop() || '');
  if (tail) for (const code of [game.home_team, game.away_team]) if (kalshiAbbrs(code, sport).includes(tail[1])) return code;
  return null;
}
// "wins by over 3.5 points" → 4 (wins by 4+).
export function kalshiWinByX(m) {
  let floor = Number(m?.floor_strike);
  if (!Number.isFinite(floor)) {
    const t = /over\s+(\d+(?:\.\d+)?)\s*(?:points?|pts)?/i.exec(String(m?.yes_sub_title || m?.title || ''));
    floor = t ? Number(t[1]) : NaN;
  }
  return Number.isFinite(floor) && floor >= 0 && floor < 80 ? { floor, x: Math.floor(floor) + 1 } : null;
}
const isTie = (m) => /\b(tie|draw)\b/i.test(String(m?.yes_sub_title || m?.subtitle || ''));

export async function readKalshiGames({ fetchText, sport, games, now = Date.now(), log = () => {} }) {
  const series = KALSHI_GAME_SERIES[sport];
  const out = { fetched_utc: new Date(now).toISOString(), sport, ok: false, series: {}, games: {} };
  if (!series) return out;
  const upcoming = (games || []).filter((g) => g.status === 'scheduled' && Date.parse(g.start_utc) > now - 3 * 3600000);
  for (const [kind, ticker] of Object.entries(series)) {
    const st = { ok: false, events: 0, matched: 0, error: null };
    out.series[ticker] = st;
    try {
      let cursor = '', pages = 0;
      do {
        const url = `${KALSHI_BASE}/events?series_ticker=${ticker}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const text = await fetchText(url);
        if (text == null) break;
        const data = JSON.parse(text);
        st.ok = true;
        for (const evt of Array.isArray(data?.events) ? data.events : []) {
          st.events += 1;
          const g = matchKalshiEvent(evt, upcoming, sport);
          if (!g) continue;
          st.matched += 1;
          const row = (out.games[g.game_id] ||= { home: g.home_team, away: g.away_team, start_utc: g.start_utc, winner: null, win_by: {}, events: {}, url: `https://kalshi.com/markets/${ticker.toLowerCase()}` });
          row.events[kind] = evt.event_ticker;
          for (const m of Array.isArray(evt.markets) ? evt.markets : []) {
            const p = kalshiProb(m);
            if (p == null) continue;
            const vol = Number(m.volume_fp ?? m.volume);
            if (kind === 'winner') {
              const who = isTie(m) ? 'tie' : kalshiMarketTeam(m, g, sport);
              if (who) (row.winner ||= {})[who] = p;
              if (Number.isFinite(vol)) row.volume_winner = (row.volume_winner || 0) + vol;
            } else {
              const who = kalshiMarketTeam(m, g, sport), wx = kalshiWinByX(m);
              if (who && wx) (row.win_by[who] ||= {})[`${wx.x}+`] = p;
              if (Number.isFinite(vol)) row.volume_spread = (row.volume_spread || 0) + vol;
            }
          }
        }
        cursor = data?.cursor || '';
        pages += 1;
      } while (cursor && pages < 2);
    } catch (err) {
      st.error = String(err?.message || err).split('\n')[0].slice(0, 120);
    }
    log(`${sport} Kalshi ${ticker}: ${st.ok ? `${st.events} open events, ${st.matched} matched to stored games` : `unavailable${st.error ? ' (' + st.error + ')' : ''}`}`);
  }
  // The winner pair (and a tie) as chances that sum to 1: the raw mids of
  // two separate contracts usually sum a little over 1.
  for (const row of Object.values(out.games)) {
    const w = row.winner;
    if (!w) continue;
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    row.winner_raw = { ...w };
    if (sum > 0.85 && sum < 1.2 && w[row.home] != null && w[row.away] != null) row.winner = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, r3(v / sum)]));
  }
  out.ok = Object.values(out.series).some((s) => s.ok);
  return out;
}

// Model vs Kalshi for one game's view: the winner and each win-by market.
export function kalshiVsModel(fc, game, kg) {
  const pmf = marginPmf(fc);
  if (!pmf || !kg) return null;
  const rows = [];
  for (const [team, ladder] of Object.entries(kg.win_by || {})) {
    const sign = team === game.home_team ? 1 : team === game.away_team ? -1 : 0;
    if (!sign) continue;
    for (const [k, p] of Object.entries(ladder)) {
      const x = Number.parseInt(k, 10);
      const model = chanceIn(pmf, x, null, sign);
      rows.push({ team, wins_by: k, kalshi: p, model: r3(model), gap: r3(model - p) });
    }
  }
  rows.sort((a, b) => (a.team === b.team ? Number.parseInt(a.wins_by, 10) - Number.parseInt(b.wins_by, 10) : a.team === game.away_team ? -1 : 1));
  const win = kg.winner && fc.win ? { [game.home_team]: { kalshi: kg.winner[game.home_team] ?? null, model: r3(fc.win.home) }, [game.away_team]: { kalshi: kg.winner[game.away_team] ?? null, model: r3(fc.win.away) } } : null;
  return { as_of: kg.as_of || null, url: kg.url, winner: win, win_by: rows, volume: { winner: kg.volume_winner ?? null, spread: kg.volume_spread ?? null } };
}

// ---- live record -------------------------------------------------------------

function freezeEntry(g, fc, sport, kg, nowIso) {
  const pmf = marginPmf(fc);
  const mb = marginBands(fc, g, sport);
  const ladder = (sign) => Array.from({ length: LADDER_MAX }, (_, i) => r3(chanceIn(pmf, i + 1, null, sign)));
  return {
    game_id: g.game_id, date: gameDay(g), start_utc: g.start_utc, home: g.home_team, away: g.away_team,
    frozen_utc: nowIso, mode: fc.mode || null,
    expected: { margin: r1(fc.expected?.home_margin), total: r1(fc.expected?.total) },
    win: { home: r3(fc.win?.home), away: r3(fc.win?.away), tie: r3(fc.win?.tie || 0) },
    bands: { home: mb.bands[g.home_team].map((b) => b.chance), away: mb.bands[g.away_team].map((b) => b.chance) },
    tie: mb.tie, range50: mb.range50, range80: mb.range80,
    ladder: { home: ladder(1), away: ladder(-1) },
    line: fc.market && Number.isFinite(fc.market.home_margin) ? { home_margin: fc.market.home_margin, total: fc.market.total ?? null } : null,
    kalshi: kg ? { winner: kg.winner || null, win_by: kg.win_by || {} } : null,
  };
}

// `games`: the season's stored games (finals and scheduled); `model`: the
// freshly fitted team model; `kalshi`: readKalshiGames' result (or null).
export function updateWinByRecord(prior, { sport, season, games, model, now = Date.now(), kalshi = null, allGames = null }) {
  const rec = prior && prior.version === WIN_BY_RECORD_VERSION && prior.season === season && prior.sport === sport
    ? { ...prior, entries: { ...prior.entries } }
    : { version: WIN_BY_RECORD_VERSION, sport, season, started_utc: new Date(now).toISOString(), entries: {} };
  const nowIso = new Date(now).toISOString();
  let frozen = 0, graded = 0;
  const byId = new Map((games || []).map((g) => [g.game_id, g]));
  if (model && model.status === 'ok') {
    for (const g of games || []) {
      const start = Date.parse(g.start_utc);
      if (g.status !== 'scheduled' || !(start > now) || start > now + FREEZE_AHEAD_MS) continue;
      const fc = forecastGame(model, g, { rest: restDaysFor(allGames || games, g) });
      if (!fc?.pmf?.margin) continue;
      rec.entries[g.game_id] = freezeEntry(g, fc, sport, kalshi?.games?.[g.game_id] || null, nowIso);
      frozen += 1;
    }
  }
  for (const [id, e] of Object.entries(rec.entries)) {
    if (e.final) continue;
    const g = byId.get(id);
    if (!g) continue;
    if (g.status === 'canceled' || g.status === 'postponed') { delete rec.entries[id]; continue; }
    if (g.status === 'final' && Number.isInteger(g.home_score) && Number.isInteger(g.away_score)) {
      e.final = { home_score: g.home_score, away_score: g.away_score, margin: g.home_score - g.away_score, graded_utc: nowIso };
      graded += 1;
    }
  }
  // One season per file; cap it in case of a very long schedule.
  const ids = Object.keys(rec.entries);
  if (ids.length > 2500) for (const id of ids.sort((a, b) => String(rec.entries[a].start_utc).localeCompare(String(rec.entries[b].start_utc))).slice(0, ids.length - 2500)) delete rec.entries[id];
  rec.updated_utc = nowIso;
  rec.last_run = { frozen, graded };
  return rec;
}

const LADDER_CHECK = [1, 3, 5, 7, 10, 14, 20];
const WIN_BUCKETS = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];

export function winByRecordSummary(rec) {
  if (!rec || !rec.entries) return null;
  const sport = rec.sport;
  const all = Object.values(rec.entries);
  const done = all.filter((e) => e.final).sort((a, b) => String(a.start_utc).localeCompare(String(b.start_utc)));
  const pending = all.length - done.length;
  if (!done.length) return { sport, season: rec.season, graded: 0, pending, since: null, status: 'collecting', note: 'Forecasts are frozen before each game and graded after the final; nothing is graded yet.' };
  const decided = done.filter((e) => e.final.margin !== 0);
  const homeWon = (e) => (e.final.margin > 0 ? 1 : 0);
  const favChance = (e) => Math.max(e.win.home, e.win.away);
  const favWon = (e) => (e.win.home >= e.win.away ? e.final.margin > 0 : e.final.margin < 0);
  const brier = mean(decided.map((e) => (e.win.home / ((e.win.home + e.win.away) || 1) - homeWon(e)) ** 2));
  const buckets = WIN_BUCKETS.map(([lo, hi]) => {
    const xs = decided.filter((e) => favChance(e) >= lo && favChance(e) < hi);
    return { chance: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: xs.length, model: r3(mean(xs.map(favChance))), actual: r3(mean(xs.map((e) => (favWon(e) ? 1 : 0)))) };
  }).filter((b) => b.n);
  const bandsN = (MARGIN_BANDS[sport] || MARGIN_BANDS.nba).length;
  const onActual = done.map((e) => {
    const b = bandOf(sport, e.final.margin);
    return b.team ? e.bands[b.team][b.i] ?? 0 : e.tie ?? 0;
  });
  const topHit = done.map((e) => {
    const b = bandOf(sport, e.final.margin);
    const flat = [...e.bands.home.map((p, i) => ['home', i, p]), ...e.bands.away.map((p, i) => ['away', i, p])].sort((x, y) => y[2] - x[2]);
    return b.team && flat[0][0] === b.team && flat[0][1] === b.i ? 1 : 0;
  });
  const within = (e, r) => r && e.final.margin >= r.low && e.final.margin <= r.high;
  const ladder = LADDER_CHECK.map((x) => {
    const preds = [], hits = [];
    for (const e of done) {
      preds.push(e.ladder.home[x - 1], e.ladder.away[x - 1]);
      hits.push(e.final.margin >= x ? 1 : 0, -e.final.margin >= x ? 1 : 0);
    }
    return { wins_by: `${x}+`, n: preds.length, model: r3(mean(preds)), actual: r3(mean(hits)) };
  });
  // Kalshi beside the model on the same frozen games and markets.
  const kW = decided.filter((e) => e.kalshi?.winner?.[e.home] != null);
  const kRows = [];
  for (const e of done) for (const [team, lad] of Object.entries(e.kalshi?.win_by || {})) {
    const sign = team === e.home ? 1 : team === e.away ? -1 : 0;
    if (!sign) continue;
    for (const [k, p] of Object.entries(lad)) {
      const x = Number.parseInt(k, 10);
      if (!(x >= 1 && x <= LADDER_MAX)) continue;
      const y = sign * e.final.margin >= x ? 1 : 0;
      kRows.push({ model: (sign > 0 ? e.ladder.home : e.ladder.away)[x - 1], kalshi: p, y });
    }
  }
  const kalshi = kW.length || kRows.length ? {
    winner: kW.length ? { n: kW.length, model_brier: r3(mean(kW.map((e) => (e.win.home / ((e.win.home + e.win.away) || 1) - homeWon(e)) ** 2))), kalshi_brier: r3(mean(kW.map((e) => (e.kalshi.winner[e.home] - homeWon(e)) ** 2))) } : null,
    win_by: kRows.length ? { n: kRows.length, model_brier: r3(mean(kRows.map((r) => (r.model - r.y) ** 2))), kalshi_brier: r3(mean(kRows.map((r) => (r.kalshi - r.y) ** 2))) } : null,
    note: 'Lower is better. Same games, same markets, both prices frozen at the same data run before the game.',
  } : null;
  const n = done.length;
  const beatsCoin = brier != null && brier < 0.25;
  const bandEdge = mean(onActual) > 1 / (bandsN * 2);
  return {
    sport, season: rec.season, since: done[0].date, graded: n, pending,
    status: n < 100 ? 'collecting' : beatsCoin && bandEdge ? 'beats_chance' : 'no_edge',
    winner: { n: decided.length, favorite_won: r3(mean(decided.map((e) => (favWon(e) ? 1 : 0)))), favorite_chance: r3(mean(decided.map(favChance))), brier: r3(brier), coin_brier: 0.25, buckets },
    bands: { n, chance_on_actual: r3(mean(onActual)), even_split: r3(1 / (bandsN * 2)), top_band_hit: r3(mean(topHit)) },
    ranges: { in50: r3(mean(done.map((e) => (within(e, e.range50) ? 1 : 0)))), in80: r3(mean(done.map((e) => (within(e, e.range80) ? 1 : 0)))) },
    margin_miss: r1(mean(done.map((e) => Math.abs(e.final.margin - (e.expected.margin ?? 0))))),
    line_miss: (() => { const xs = done.filter((e) => e.line); return xs.length ? r1(mean(xs.map((e) => Math.abs(e.final.margin - e.line.home_margin)))) : null; })(),
    ladder, kalshi,
    recent: done.slice(-15).reverse().map((e) => ({
      date: e.date, home: e.home, away: e.away, final_margin: e.final.margin, expected_margin: e.expected.margin,
      winner_chance: r3(e.final.margin > 0 ? e.win.home : e.final.margin < 0 ? e.win.away : e.win.tie),
      band_chance: (() => { const b = bandOf(sport, e.final.margin); return r3(b.team ? e.bands[b.team][b.i] : e.tie); })(),
      in80: within(e, e.range80),
      kalshi_winner_chance: e.kalshi?.winner ? r3(e.final.margin > 0 ? e.kalshi.winner[e.home] : e.final.margin < 0 ? e.kalshi.winner[e.away] : e.kalshi.winner.tie ?? null) : null,
    })),
    note: 'Each forecast is the last one made before the game (data runs at 13:20 and 22:30 UTC), graded after the final. Brier: lower is better; 0.25 is a coin flip. Chance on the actual band: the share the model put on the band that happened; an even split puts the same on every band. A range is well sized when about 50% / 80% of finals land inside it.',
  };
}
