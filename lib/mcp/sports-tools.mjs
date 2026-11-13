// lib/mcp/sports-tools.mjs — the Owner Sports tools on the Mingstreet MCP.
//
// Same rules as every MCP tool: read-only, zero AI calls, Owner only. They
// call the exact functions the Sports pages call (lib/sports/http.mjs
// leagueView, lib/sports/journal.mjs evaluateEntry / journalView), so the same
// stored games, model and seed give the same answer on the site and here.
//
// The store they get (`ctx.sportsStore`, lib/mcp/read-only-store.mjs) can only
// read Sports game, player, model, status and journal records; it cannot read
// captured lines or anything outside the Sports prefix, and it cannot write.
// There is no save tool: sports_evaluate_entry returns a Pick Builder link
// that fills the entry on the site, where the owner checks it and saves it.
// A link never carries chances.
//
// sports_evaluate_entry and sports_get_player also read two live feeds the
// Owner prop board already reads (lib/sports/prop-sources.mjs, same
// two-minute cache): the ESPN injury report, and for NBA the sportsbooks'
// no-vig prices from the read-only PropLine feed (one request per two
// minutes at most; NFL makes none). A feed that fails only leaves its part
// out.
import { SPORTS, SIDES, OPERATORS, SPORTS_STATS, statIds } from "../sports/schema.mjs";
import { leagueView, recordLoader, teamAbsenceFor } from "../sports/http.mjs";
import { evaluateEntry, journalView } from "../sports/journal.mjs";
import { gameLinesView, modelSummary, overChanceAt } from "../sports/models.mjs";
import { loadPropSources } from "../sports/prop-sources.mjs";
import { bookPriceForLine, bookVsModel, availabilityFor, BOOK_GAP } from "../sports/book-price.mjs";
import { encodePrefill } from "../sports/prefill.mjs";
import { SPORTS_TIME_ZONES } from "../sports/time.mjs";
import { propRecordView } from "../sports/prop-record.mjs";
import { storedSeasons, LEADER_WINDOWS } from "../sports/read.mjs";
import { lineMatchesGame } from "../sports/props.mjs";
import { forecastGame, priceTeamBet, teamModelSummary, TEAM_MARKETS } from "../sports/team-model.mjs";
import { findTeamGame, winByLadder } from "../sports/team-bets.mjs";

const OWNER = "owner";
const ID = { type: "string", maxLength: 96, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$" };
const SPORT = { type: "string", enum: [...SPORTS], description: "nba or nfl." };
const STATS = [...new Set(SPORTS.flatMap((s) => statIds(s)))];
const MODELED = SPORTS.map((s) => s + ": " + statIds(s, { modeledOnly: true }).join(", ")).join("; ");
const STAT_HELP = "Any stat id for the pick's league, combos included (e.g. NBA pra, pts_reb, reb_ast, fantasy; NFL rush_rec_yards). Forecasts cover " + MODELED + "; other stats get history hit counts only.";
// sports_get_game keeps each player's averages small: the league's main stats
// unless the caller names others.
const GAME_MEASURES = [["last5", "last5"], ["last10", "last10"], ["average", "average"], ["median", "median"], ["low", "low"], ["high", "high"], ["games", "stat_games"]];
const mainStats = (sport) => (sport === "nba" ? ["minutes"] : []).concat(SPORTS_STATS[sport].filter((s) => s.group === "main").map((s) => s.id));

const LIMITATIONS = [
  "Private Owner research on stored box scores. Paper picks only: nothing is placed and no sportsbook or pick'em account is used; sportsbook prices come from a read-only odds feed.",
  "The model reads one thing from the injury report: for NBA, regular teammates listed Out or Doubtful raise a player's forecast by a measured share of their minutes, for the stats where that beat no adjustment in testing. It also reads the game's spread and total (and, NFL, the player's recent snap share) only for the stats where that beat no adjustment in testing (`game_lines.applied`, `snap_trend.applied`). It does not read the player's own status, rest or news; those are shown beside it. Chances are the owner's to choose; the model's and the books' chances are labeled as theirs.",
];
const DAY_MS = 86400000;
// The Player page's splits as numbers for sports_get_player: averages over
// the played games returned, overall and by place, role, result, final
// margin, rest, the spread, season and opponent (the page's Vs teams,
// Seasons, Splits and Game script views).
function playerSplits(games, sport) {
  const played = (games || []).filter((g) => g.played);
  if (!played.length) return null;
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const val = (g, st) => (st === "minutes" ? g.minutes : g.stats?.[st]);
  const stats = mainStats(sport).filter((st) => played.some((g) => num(val(g, st)) && val(g, st) !== 0)).slice(0, 7);
  const r1 = (x) => Math.round(x * 10) / 10;
  const avg = (list) => Object.fromEntries(stats.map((st) => { const v = list.map((g) => val(g, st)).filter(num); return [st, v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null]; }));
  const block = (list) => (list.length ? { games: list.length, avg: avg(list) } : null);
  const scored = played.filter((g) => num(g.team_score) && num(g.opp_score)), m = (g) => g.team_score - g.opp_score;
  const C = sport === "nfl" ? 8 : 5, B = sport === "nfl" ? 14 : 15, r = (g) => g.rest_days;
  const record = (list) => { const w = list.filter((g) => num(g.team_score) && m(g) > 0).length, l = list.filter((g) => num(g.team_score) && m(g) < 0).length; return w + l ? w + "-" + l : null; };
  const byOpp = new Map();
  for (const g of played) { if (!byOpp.has(g.opponent)) byOpp.set(g.opponent, []); byOpp.get(g.opponent).push(g); }
  const seasons = [...new Set(played.map((g) => g.season))].sort((a, b) => b - a);
  return {
    stats, games_used: played.length,
    note: "Averages over the player's stored played games (the newest " + (games || []).length + "), not only the `games` returned. Small groups swing a lot.",
    all: block(played), home: block(played.filter((g) => g.home)), away: block(played.filter((g) => !g.home)),
    ...(sport === "nba" ? { started: block(played.filter((g) => g.starter === true)), bench: block(played.filter((g) => g.starter === false)) } : {}),
    team_won: block(scored.filter((g) => m(g) > 0)), team_lost: block(scored.filter((g) => m(g) < 0)),
    ["close_" + C + "_or_fewer"]: block(scored.filter((g) => Math.abs(m(g)) <= C)), ["blowout_" + B + "_plus"]: block(scored.filter((g) => Math.abs(m(g)) >= B)),
    favored: block(played.filter((g) => num(g.line_margin) && g.line_margin > 0)), underdog: block(played.filter((g) => num(g.line_margin) && g.line_margin < 0)),
    rest: sport === "nba"
      ? { back_to_back: block(played.filter((g) => r(g) === 1)), one_day_off: block(played.filter((g) => r(g) === 2)), two_plus_days_off: block(played.filter((g) => r(g) >= 3)) }
      : { short_week_5_or_less: block(played.filter((g) => r(g) != null && r(g) <= 5)), normal_week_6_to_8: block(played.filter((g) => r(g) >= 6 && r(g) <= 8)), extra_rest_9_plus: block(played.filter((g) => r(g) >= 9)) },
    by_season: seasons.map((y) => { const list = played.filter((g) => g.season === y); return { season: y, games: list.length, avg: avg(list) }; }),
    by_opponent: [...byOpp].sort((a, b) => b[1].length - a[1].length || String(b[1][0].date).localeCompare(String(a[1][0].date))).slice(0, 15)
      .map(([opponent, list]) => ({ opponent, games: list.length, last_date: list[0].date, team_record: record(list), avg: avg(list) })),
  };
}
// How current and how clean the stored data is (the daily job's checks,
// lib/sports/ingest.mjs `integrity`).
function dataCheck(status, now) {
  if (!status) return null;
  const i = status.integrity || {};
  return {
    last_update_utc: status.last_success_utc || null, latest_game_date: status.latest_game_date || null, job_state: status.state || null,
    checked_utc: i.checked_utc || null, second_source: i.second_source ? { provider: i.second_source.provider, state: i.second_source.state, date: i.second_source.date || null,
      games_checked: i.second_source.games_checked ?? null, mismatched: i.second_source.mismatched ?? null, players_mismatched: i.second_source.players_mismatched ?? null } : null,
    ...(i.injury_report ? { official_injury_report_week: i.injury_report.week ?? null } : {}),
    notes: (i.warnings || []).slice(0, 6),
    stale: !(Date.parse(status.last_success_utc) > now - 1.5 * DAY_MS),
  };
}
const pct = (x) => (x == null ? "?" : Math.round(x * 1000) / 10 + "%");

// The live context for a set of legs: injuries per league and, for NBA, the
// sportsbook reference prices. Never throws.
// `gameLines`: also read the NBA books' game spreads, totals and moneylines
// (sports_team_odds only; a separate provider request).
async function liveSources(ctx, sports, { gameLines = false } = {}) {
  const load = ctx.loadPropSources || loadPropSources;
  const out = {};
  for (const sport of new Set(sports)) {
    try {
      out[sport] = await load({ sport, now: ctx.now(), env: ctx.env || {}, parts: sport === "nba" ? ["injuries", "reference", ...(gameLines ? ["game_lines"] : [])] : ["injuries"] });
    } catch {
      out[sport] = { injuries: { state: "unavailable", reports: [] }, reference: null };
    }
  }
  return out;
}
const gameOf = (l) => {
  const [away, home] = String(l.matchup || "").split("@");
  return { start_utc: l.game_start_utc, home_team: home, away_team: away };
};

// The injury report notes for one player: ESPN's listing, and for NFL the
// official report (game status, practice) and roster status.
function availabilityNotes(at, avail) {
  const notes = [];
  if (!avail) return notes;
  const who = at ? at + ": " : "";
  const espn = avail.state === "ok" && avail.status && avail.status !== "not listed";
  if (espn && (OUT_RE.test(avail.status) || UNSURE_RE.test(avail.status) || avail.unsure)) {
    notes.push(`INJURY: ${who}listed ${avail.status} on the latest ESPN report${avail.detail ? " (" + String(avail.detail).slice(0, 120) + ")" : ""}${avail.out ? "" : "; role may change"}.`);
  }
  const o = avail.official;
  if (o?.state === "ok" && o.game_status && o.game_status !== "not listed") notes.push(`OFFICIAL_REPORT: ${who}${o.game_status} on the NFL's week ${o.week} injury report${o.injury ? " (" + o.injury + ")" : ""}${o.practice ? "; practice: " + o.practice : ""}.`);
  else if (o?.state === "ok" && o.practice) notes.push(`OFFICIAL_REPORT: ${who}no game status on the week ${o.week} report yet; practice: ${o.practice}.`);
  const rs = avail.roster_status;
  if (rs && rs.code === "DEV") notes.push(`ROSTER: ${who}on the practice squad (DEV); he plays only if elevated for the game.`);
  else if (rs && rs.code !== "ACT") notes.push(`ROSTER: ${who}on the ${rs.label} (${rs.code}), not the active roster.`);
  return notes;
}
const OUT_RE = /^(out|doubtful|suspended|inactive|injured reserve|ir)$/i;
const UNSURE_RE = /questionable|game.time decision|day.to.day/i;

// Plain-language notes on one leg: the books against the model, the injury
// report, the early-season miss and how calls near this chance did before.
function legNotes(i, l, book, vs, avail) {
  const at = `Pick ${i + 1} (${l.player_name} ${l.side} ${l.threshold} ${l.stat})`;
  const notes = [];
  if (vs?.disagrees) {
    const bookText = book.chance != null ? pct(book.chance) : `${pct(book.low)}-${pct(book.high)}`;
    notes.push(`BOOK_DISAGREES: ${at}: the model says ${pct(l.model.probability)}, the sportsbooks' no-vig price says ${bookText} (${book.book_count} book${book.book_count === 1 ? "" : "s"}). A gap of ${Math.round(BOOK_GAP * 100)}+ points usually means the books know something the box scores do not (injury, role, news); check before trusting the model.`);
  }
  notes.push(...availabilityNotes(at, avail));
  if (avail?.teammates_out?.length) {
    const t = l.model?.teammates_out;
    const how = l.sport !== "nba" ? "the NFL model does not adjust for this"
      : t?.applied ? `the model counts ${t.minutes} regular minutes out and raised its forecast ×${t.factor}`
      : t ? `the model counts ${t.minutes} regular minutes out, but found no reliable lift for this stat in testing, so the forecast is unchanged`
      : "none is a regular the model counts, so the forecast is unchanged";
    notes.push(`TEAMMATES_OUT: ${at}: ${avail.teammates_out.join(", ")} listed out or doubtful; ${how}.`);
  }
  const lu = l.sport === "nba" ? l.model?.lineup : null;
  if (lu?.applied && lu.factor !== 1) {
    notes.push(`LINEUP: ${at}: ${lu.starting ? "starts" : "comes off the bench"} (started ${pct(lu.usual_start_share)} of the last 10 games); the model moved its forecast ×${lu.factor}.`);
  } else if (lu && lu.starting == null && lu.usual_start_share >= 0.8) {
    notes.push(`NO_LINEUP: ${at}: usually starts (${pct(lu.usual_start_share)} of the last 10 games) and no lineup was given; the forecast assumes the usual role. If the lineup is confirmed, pass starting: true or false and the model adjusts for it.`);
  }
  const es = l.model?.early_season;
  if (es && es.tested_miss != null && l.model?.mean > 0 && Math.abs(es.tested_miss) >= 0.05 * l.model.mean) {
    notes.push(`EARLY_SEASON: ${at}: ${es.games_this_season} game(s) this season; in testing, forecasts this early ran ${Math.abs(es.tested_miss)} ${es.tested_miss > 0 ? "high" : "low"} on average.`);
  }
  const t = l.model?.tested;
  if (t && Math.abs(t.said - t.hit) >= 0.05) notes.push(`MODEL_TESTED: ${at}: past calls near ${pct(t.said)} hit ${pct(t.hit)} (${t.games} games).`);
  return notes;
}

function sportsGate(ctx, fail) {
  if (!ctx.principal?.owner) fail("FORBIDDEN", "Owner sign-in required");
  if (ctx.env?.SPORTS_ENABLED === "0") fail("NOT_FOUND", "The Sports section is switched off");
  if (!ctx.sportsStore) fail("DATA_UNAVAILABLE", "Sports data is not available here");
}

// Sports errors that the owner can act on (a bad line, an unknown game) keep
// their message; anything else is a plain unavailable.
async function guarded({ fail, ToolError }, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err?.expose && err.status >= 400 && err.status < 500) fail(err.status === 404 ? "NOT_FOUND" : "INVALID_INPUT", String(err.message).slice(0, 200));
    if (err?.code === "RESOURCE_LIMIT") fail("RESOURCE_LIMIT", "A stored Sports record is too large to read");
    throw err;
  }
}

function viewOrFail(view, fail, what) {
  if (!view || view.error === 404) fail("NOT_FOUND", `No stored ${what} with that id`);
  if (view.error) fail("INVALID_INPUT", `That ${what} id is not valid`);
  return view;
}

// One issued prop as a list row; the full pick (evidence, history, features,
// availability) comes back with sports_get_prop_record `prop_id`.
function compactProp(p) {
  return {
    prop_id: p.prop_id, issued_utc: p.issued_utc, game_id: p.game_id, game_start_utc: p.game_start_utc ?? null,
    player_id: p.player_id, player_name: p.player_name ?? null, team: p.team ?? null, opponent: p.opponent ?? null,
    stat: p.stat, side: p.side, threshold: p.threshold, rank_score: p.rank_score ?? null, basis: p.basis ?? null,
    model_probability: typeof p.model?.probability === "number" ? p.model.probability : null,
    result: p.result, actual: p.actual ?? null, game_status: p.game_status ?? null,
    closing_line: p.clv ? { line: p.clv.line, points: p.clv.points, beat: p.clv.beat, stale: p.clv.stale } : null,
  };
}

export function sportsTools({ fail, envelope, boundedJson, ToolError }) {
  const g = { fail, ToolError };
  const loadStatus = async (ctx, sport) => recordLoader(ctx.sportsStore)("status", { sport }).catch(() => null);
  const asOf = (status) => ({ updatedAt: status?.last_success_utc || null });
  const done = (ctx, tool, source, status, results, warnings = [], limitations = [], { updatedAt } = {}) => {
    const bounded = boundedJson(results);
    return envelope(ctx, {
      tool, source, payload: updatedAt ? { updatedAt } : asOf(status), owner: true,
      warnings: [...warnings, ...(status ? [] : ["NOT_CONNECTED: this league's data job has not written a status record yet."]),
        ...(status && !(Date.parse(status.last_success_utc) > ctx.now() - 1.5 * DAY_MS) ? [`STALE_DATA: the ${status.sport || "league"} data job last finished at ${status.last_success_utc || "an unknown time"}; recent games may be missing.`] : []),
        ...(bounded.reduced ? ["TRIMMED: long lists were shortened."] : [])],
      limitations: [...LIMITATIONS, ...limitations],
      results: bounded.value,
    });
  };

  return [
    {
      name: "sports_list_games",
      title: "Sports: today's and tomorrow's games",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: NBA or NFL games starting today and tomorrow (Pacific time unless a time zone is given), with game ids, teams, start times and status, each upcoming game's spread and total when stored (`game_lines`: NFL from the schedule, NBA from the sportsbooks' median the props scan records), the team model's win chance for each (`team_win`), plus the next game when none are scheduled. Game ids feed sports_get_game, sports_team_odds and sports_evaluate_entry.",
      inputSchema: {
        type: "object",
        properties: { sport: SPORT, time_zone: { type: "string", enum: SPORTS_TIME_ZONES.map(([id]) => id), description: "Day boundary. Default America/Los_Angeles." } },
        required: ["sport"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const view = await guarded(g, () => leagueView("board", { store: ctx.sportsStore, sport: args.sport, query: { tz: args.time_zone }, now: ctx.now() }));
        return done(ctx, "sports_list_games", { page: `/?tab=sports-${args.sport}` }, status, view);
      },
    },
    {
      name: "sports_find_players",
      title: "Sports: find a player",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: find NBA or NFL players by name (2+ letters; accents and punctuation ignored). Returns player ids, team and position. Use the id with sports_get_player and sports_evaluate_entry.",
      inputSchema: {
        type: "object",
        properties: { sport: SPORT, name: { type: "string", maxLength: 60, description: "Name or part of it, e.g. 'lebron' or 'j allen'." } },
        required: ["sport", "name"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const view = await guarded(g, () => leagueView("players", { store: ctx.sportsStore, sport: args.sport, query: { q: args.name }, now: ctx.now() }));
        return done(ctx, "sports_find_players", { page: `/?tab=sports-${args.sport}` }, status, view, view.players?.length ? [] : ["NO_MATCH: no stored player matches that name."]);
      },
    },
    {
      name: "sports_get_game",
      title: "Sports: one game",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: one stored game: teams, start, status or final score, and the players each team used in its last three games with their averages this season before the game: last5, last10, average, median, low, high and stat_games, each keyed by stat (the league's main stats, or the stats you name, combos included), plus each player's average against this opponent (vs_opp_avg, this season and last). `matchup` has both teams' records and scoring with league ranks, each stat scored and allowed overall and to each position group with ranks (1 = most scored, or FEWEST allowed: the toughest defense), league averages, and the stored meetings between the two teams.",
      inputSchema: {
        type: "object",
        properties: {
          sport: SPORT, game_id: ID,
          stats: { type: "array", maxItems: 12, items: { type: "string", enum: ["minutes", ...STATS] }, description: "Optional stat ids to average (default: the league's main stats)." },
        },
        required: ["sport", "game_id"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const view = viewOrFail(await guarded(g, () => leagueView("game", { store: ctx.sportsStore, sport: args.sport, query: { id: args.game_id }, now: ctx.now() })), fail, "game");
        // The page's per-player chart values stay on the page; averages of the
        // asked-for stats are enough here.
        const known = new Set(["minutes", ...statIds(args.sport)]);
        const want = (args.stats?.length ? args.stats : mainStats(args.sport)).filter((st) => known.has(st));
        if (!want.length) fail("INVALID_INPUT", "None of those stats belong to " + args.sport);
        // One map per measure, keyed by stat (last5.points, average.pra, ...):
        // a stat-then-measure nesting sits deeper than the MCP's size limit
        // keeps, which turned every average into "{object with 7 keys}".
        const byMeasure = (summaries) => Object.fromEntries(GAME_MEASURES.map(([m, key]) => [key, Object.fromEntries(want.filter((st) => summaries?.[st]).map((st) => [st, summaries[st][m] ?? null]))]));
        const only = (o) => Object.fromEntries(want.filter((st) => o && st in o).map((st) => [st, o[st]]));
        const eachTeam = (o, fn) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, fn(v)]));
        const teams = eachTeam(view.teams, (v) => ({
          ...v,
          players: (v.players || []).map(({ recent, summaries, vs_opp, ...p }) => ({ ...p, ...byMeasure(summaries), vs_opp_games: vs_opp?.games || 0, vs_opp_avg: only(vs_opp?.values) })),
        }));
        const M = view.matchup;
        const matchup = M && {
          ...M,
          stats: eachTeam(M.stats, (x) => eachTeam(x, only)),
          allowed_by: eachTeam(M.allowed_by, (x) => eachTeam(x, only)),
          allowed_by_rank: eachTeam(M.allowed_by_rank, (x) => eachTeam(x, only)),
          league: { ...M.league, for: only(M.league.for), allowed: only(M.league.allowed), allowed_by: eachTeam(M.league.allowed_by, only) },
        };
        // Team bets in short (sports_team_odds has the full ladder and pricing).
        const TB = view.team_bets || {};
        const team_bets = TB.forecast ? { status: TB.status, expected: TB.forecast.expected, win: TB.forecast.win, mode: TB.forecast.mode, book: TB.forecast.book, see: "sports_team_odds" } : { status: TB.status || "not_fitted", see: "sports_team_odds" };
        return done(ctx, "sports_get_game", { page: `/?tab=sports-${args.sport}` }, status, { ...view, teams, matchup, team_bets, shown_stats: want });
      },
    },
    {
      name: "sports_team_odds",
      title: "Sports: team vs team odds",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: the team game model for one NBA or NFL game: each team's chance to win, to win by X+ points (`win_by_ladder`, 1-30), to cover a spread, and the game total and team totals going over or under, with fair American odds. Pass `game_id`, or `team` (and `opponent`) for their next stored game. Price your own bets with `bets` (moneyline / spread / win_by / total / team_total, team, line, side for totals and for win_by (under = no), optional American `price` for breakeven and EV per $1). Margins and totals start from the sportsbooks' spread and total when stored and move toward team ratings only as far as that helped on earlier games. `check`: how each market held up on held-out games (validated = 300+ results, calibration error within 0.03 or what luck gives). `book_chance`: the books' no-vig chance where prices exist. `teams`: against-the-spread and over/under records, margins, close games, rest, ratings and (NBA) pace. Read-only research.",
      inputSchema: {
        type: "object",
        properties: {
          sport: SPORT, game_id: ID,
          team: { type: "string", pattern: "^[A-Za-z]{2,4}$", description: "Team code (e.g. NBA bos, tor; NFL kc, buf) when no game_id is given: that team's next stored game (with `opponent`, their next meeting)." },
          opponent: { type: "string", pattern: "^[A-Za-z]{2,4}$" },
          bets: {
            type: "array", maxItems: 12,
            items: {
              type: "object",
              properties: {
                market: { type: "string", enum: [...TEAM_MARKETS], description: "moneyline, spread (line −7.5 = favored by 7.5), win_by (line = points, e.g. 20 for 'win by 20+'), total, team_total." },
                team: { type: "string", maxLength: 8, description: "Team code, or home / away. Not needed for the game total." },
                line: { type: "number", minimum: -60, maximum: 400 },
                side: { type: "string", enum: ["over", "under"], description: "For total and team_total." },
                price: { type: "number", minimum: -100000, maximum: 100000, description: "Optional American odds, e.g. -110 or +450." },
              },
              required: ["market"],
              additionalProperties: false,
            },
          },
        },
        required: ["sport"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const load = recordLoader(ctx.sportsStore);
        let gameId = args.game_id ? String(args.game_id).toLowerCase() : null;
        const warnings = [];
        if (!gameId) {
          if (!args.team) fail("INVALID_INPUT", "Pass game_id, or team (and opponent)");
          const seasons = storedSeasons(status, args.sport, ctx.now());
          const found = await guarded(g, () => findTeamGame({ load, sport: args.sport, seasons, team: args.team, opponent: args.opponent, nowMs: ctx.now() }));
          if (!found) fail("NOT_FOUND", "No upcoming stored game for " + String(args.team).toUpperCase() + (args.opponent ? " and " + String(args.opponent).toUpperCase() : ""));
          gameId = found.game_id;
          warnings.push(`GAME_FROM_SCHEDULE: using ${found.away_team} at ${found.home_team}, ${found.start_utc}. Check it is the game you mean.`);
        }
        // NBA: the books' live spread and total (and no-vig chances) when the
        // feed answers; else the stored archive.
        const live = args.sport === "nba" ? (await liveSources(ctx, ["nba"], { gameLines: true })).nba?.reference : null;
        const liveLines = live?.game_lines?.length ? (game) => {
          const l = live.game_lines.find((x) => lineMatchesGame(x, game, "nba"));
          return l && Number.isFinite(l.total) && Number.isFinite(l.home_margin) ? { total: l.total, home_margin: l.home_margin, source: "sportsbooks", books: l.books, observed_utc: l.observed_utc, ...(l.book ? { book: l.book } : {}) } : null;
        } : null;
        const view = viewOrFail(await guarded(g, () => leagueView("game", { store: ctx.sportsStore, sport: args.sport, query: { id: gameId }, now: ctx.now(), liveLines, load })), fail, "game");
        const TB = view.team_bets || {};
        const game = view.game;
        const fc = TB.forecast || null;
        if (!fc) warnings.push(TB.status === "played" ? "PLAYED: this game is over; only the team numbers and the final score are shown." : `NO_FORECAST: the team model has no forecast for this game (${TB.status || "not fitted"}).`);
        const gameForPricing = { ...game };
        const priced = fc ? (args.bets || []).map((b) => priceTeamBet(fc, gameForPricing, b)) : [];
        for (const [i, p] of priced.entries()) if (p.error) warnings.push(`BET_${i + 1}: ${p.error}`);
        for (const p of [...priced, ...(TB.ladder || [])]) if (p.gap != null && Math.abs(p.gap) >= BOOK_GAP) warnings.push(`BOOK_DISAGREES: ${p.label}: model ${pct(p.chance)}, books ${pct(p.book_chance)} (no-vig).`);
        const check = TB.check?.markets ? Object.fromEntries(Object.entries(TB.check.markets).map(([k, v]) => [k, { status: v.status, n: v.n, ece: v.ece, ece_luck: v.ece_luck, slope: v.slope, brier: v.brier, baseline_brier: v.baseline?.baseline ?? null, baseline: v.baseline?.name ?? null }])) : null;
        if (check) for (const [k, v] of Object.entries(check)) if (v.status !== "validated") warnings.push(`NOT_VALIDATED: ${k} chances are ${v.status.replace("_", " ")} (${v.n} held-out results).`);
        if (fc?.mode === "market" && TB.check?.sd?.market?.borrowed) warnings.push("WIDTH_UNTESTED: NBA games with a market line use the ratings' wider miss until about 200 archived NBA lines exist, so these chances lean toward 50%.");
        if (args.sport === "nba" && fc && !fc.market) warnings.push("NO_MARKET_LINE: no sportsbook spread or total for this game yet; the chances come from the team ratings alone.");
        const strip = ({ pmf, ...rest }) => rest;
        const results = {
          game, game_lines: view.game_lines || null, status: TB.status,
          forecast: fc ? strip(fc) : null,
          ladder: (TB.ladder || []).map(({ market, label, line, side, chance, push, fair_american, book_chance, gap }) => ({ market, label, line, side, chance, push, fair_american, book_chance: book_chance ?? null, gap: gap ?? null })),
          win_by_ladder: fc ? winByLadder(fc, game) : null,
          bets: priced,
          teams: TB.teams || null, final: TB.final || null,
          check, model: TB.check ? { version: TB.check.version, fitted_utc: TB.check.fitted_utc, games: TB.check.games, blend: TB.check.blend, held_out: TB.check.held_out } : null,
          book_feed: args.sport === "nba" ? live?.state || "unavailable" : "nflverse schedule",
        };
        results.data_check = dataCheck(status, ctx.now());
        return done(ctx, "sports_team_odds", { page: `/?tab=sports-${args.sport}` }, status, results, warnings,
          ["Team bets cover full-game results only: no halves, quarters, first-to-score or player-led bets.", "A chance is a forecast for research, not a promise; markets are hard to beat and the ratings rarely add much to the books' own numbers."]);
      },
    },
    {
      name: "sports_get_player",
      title: "Sports: one player",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: one player's stored game log (newest first: final score, rest days, spread and total from the player's team side; NFL snaps), averages, next game and the stat model's forecast (expected value, 80% range, over chance at five lines, whether the stat passed its check), injury report (NFL: official report and roster status), `next_game_lines`, the team's next five games (`upcoming`: opponent record and what its defense allows to the player's position with ranks, last season's before its first game; the player's averages against them; spread, total and the team model's win chance), `splits` (averages by home/away, role, team result, margin, rest, favored/underdog, season, opponent), `data_check`, and for NBA every sportsbook line for that game with the books' no-vig over chance beside the model's.",
      inputSchema: {
        type: "object",
        properties: { sport: SPORT, player_id: ID, games: { type: "integer", minimum: 1, maximum: 40, description: "How many recent games to return (default 15)." },
          starting: { type: "boolean", description: "NBA: true / false when it is known (a confirmed lineup) whether he starts the next game; the model then adjusts for a usual starter coming off the bench or a bench player starting. Leave out when unknown." } },
        required: ["sport", "player_id"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const playerView = (absence) => guarded(g, () => leagueView("player", { store: ctx.sportsStore, sport: args.sport, query: { id: args.player_id, starting: args.starting }, now: ctx.now(), absence }));
        let view = viewOrFail(await playerView(null), fail, "player");
        const warnings = [];
        const next = view.next_game;
        const upcoming = next && Date.parse(next.start_utc) > ctx.now();
        const src = upcoming ? (await liveSources(ctx, [args.sport]))[args.sport] || {} : {};
        const team = upcoming ? (view.forecast ? (view.forecast.home ? next.home_team : next.away_team) : view.player?.team) : null;
        // NBA: regular teammates listed out raise the forecast by the measured
        // share of their minutes (the model's teammates-out adjustment).
        if (upcoming && args.sport === "nba" && view.forecast) {
          const absence = await guarded(g, () => teamAbsenceFor({ store: ctx.sportsStore, sport: "nba", team, date: next.local_date, injuries: src.injuries, now: ctx.now(), exclude: view.player?.player_id || args.player_id }));
          if (absence.minutes > 0) view = viewOrFail(await playerView(absence), fail, "player");
        }
        const n = args.games || 15;
        const results = { ...view, games: view.games.slice(0, n), splits: playerSplits(view.games, args.sport) };
        if (upcoming) {
          const players = (await recordLoader(ctx.sportsStore)("players", { sport: args.sport }).catch(() => null))?.players || [];
          const person = players.find((p) => p.player_id === view.player?.player_id) || view.player;
          const official = args.sport === "nfl" ? { record: await recordLoader(ctx.sportsStore)("injuries", { sport: "nfl" }).catch(() => null), week: next.week ?? null } : null;
          results.availability = availabilityFor(person, team, src.injuries, args.sport, official);
          warnings.push(...availabilityNotes(null, results.availability));
          if (next.lines) results.next_game_lines = gameLinesView(next);
          if (args.sport === "nba") {
            const model = await recordLoader(ctx.sportsStore)("model", { sport: args.sport }).catch(() => null);
            const quotesFor = (stat) => bookPriceForLine({ sport: "nba", player_name: view.player?.name, stat, side: "over", threshold: 0.5 }, next, src.reference, ctx.now()).lines;
            const stats = [...new Set((src.reference?.quotes || []).map((q) => q.stat))];
            const book_lines = [];
            for (const stat of stats) {
              for (const line of quotesFor(stat)) {
                const fc = view.forecast?.forecasts?.[stat];
                const model_over = fc?.status === "ok" ? overChanceAt(model, "nba", stat, fc.mean, line.threshold) : null;
                book_lines.push({ stat, threshold: line.threshold, book_over: line.over, books: line.books, model_over,
                  gap: model_over != null && line.over != null ? Math.round((model_over - line.over) * 10000) / 10000 : null });
              }
            }
            results.book_lines = book_lines;
            results.book_feed = src.reference?.state || "unavailable";
            for (const b of book_lines) if (b.gap != null && Math.abs(b.gap) >= BOOK_GAP) warnings.push(`BOOK_DISAGREES: ${b.stat} over ${b.threshold}: model ${pct(b.model_over)}, books ${pct(b.book_over)} (no-vig).`);
          }
        }
        if (results.player?.team && view.games[0] && view.games[0].team !== results.player.team && args.sport === "nfl") warnings.push(`TEAM_CHANGED: the roster file lists ${String(results.player.team).toUpperCase()}, but the last stored game was with ${String(view.games[0].team).toUpperCase()}; the forecast has no games with the new team yet.`);
        results.data_check = dataCheck(status, ctx.now());
        return done(ctx, "sports_get_player", { page: `/?tab=sports-${args.sport}&player=${encodeURIComponent(view.player?.player_id || args.player_id)}` }, status, results, warnings);
      },
    },
    {
      name: "sports_evaluate_entry",
      title: "Sports: check a pick'em entry",
      audience: OWNER,
      sports: true,
      description:
        "Owner Sports: check a 1-6 pick entry exactly as the Pick Builder does (read-only; nothing is saved). A pick is a player line or a game bet (kind team: moneyline, spread, win_by, total, team_total). Formats: power or flex pick'em payouts, or parlay (sportsbook or Kalshi odds: each pick's `price`, or one combined price in payouts). Each pick gets its game, hit counts, the model's chance, fair odds and, with a price, its edge; NBA player lines also get the books' no-vig price (`book`), flagged at a 5+ point gap. The entry gets the breakeven, the chance all win (same-game picks priced with measured links; picks on one number exactly), fair odds and the expected value. Pass `chance` only when the owner gave one; `use_model_chances` / `use_book_chances` copy one in, as the owner's choice. Always returns `pick_builder_link` to fill the entry on the site and save it as a paper pick; it never carries chances.",
      inputSchema: {
        type: "object",
        properties: {
          legs: {
            type: "array", minItems: 1, maxItems: 6,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["player", "team"], description: "player (default): a player's stat line. team: a game bet." },
                sport: SPORT,
                player_id: ID,
                game_id: { ...ID, description: "The stored game id. Player picks may leave it out (the player's next scheduled game is used); game bets need it (sports_list_games)." },
                stat: { type: "string", enum: STATS, description: STAT_HELP },
                side: { type: "string", enum: [...SIDES], description: "over / under. Game bets: totals over / under; win_by over = yes, under = no." },
                threshold: { type: "number", minimum: 0, maximum: 1000, description: "Player picks: the line, a whole or half number (a Kalshi '25+' is over 24.5)." },
                market: { type: "string", enum: ["moneyline", "spread", "win_by", "total", "team_total"], description: "Game bets: moneyline (team wins), spread (team covers line; -5.5 = favored by 5.5), win_by (team wins by line or more), total (game total), team_total (team's points)." },
                team: { type: "string", pattern: "^[a-z0-9]{2,5}$", description: "Game bets except total: the team id (lowercase, as in sports_list_games)." },
                line: { type: "number", minimum: -60, maximum: 400, description: "Game bets: the spread, the win-by points (whole), or the total." },
                price: { type: "string", maxLength: 12, description: "Optional odds for this pick as shown by the app: American (-110, +150), decimal (1.91) or cents (62c). Used by parlay entries." },
                chance: { type: "number", minimum: 0.0001, maximum: 0.9999, description: "Optional owner's chance this pick wins (0-1). Never invent one." },
                starting: { type: "boolean", description: "NBA player picks: true / false only when it is known (a confirmed lineup or the owner said so) whether he starts; the model then adjusts for a usual starter coming off the bench or a bench player starting. Leave out when unknown." },
              },
              required: ["sport"],
              additionalProperties: false,
            },
          },
          operator: { type: "string", enum: [...OPERATORS] },
          format: { type: "string", enum: ["power", "flex", "parlay"], description: "power: every pick must hit; flex: pays with some misses; parlay: sportsbook or Kalshi odds (each pick's price, or one combined price in payouts as the decimal multiplier)." },
          stake: { type: "number", minimum: 0.01, maximum: 100000, description: "Paper stake in dollars." },
          payouts: { type: "object", maxProperties: 7, propertyNames: { pattern: "^[0-6]$" }, additionalProperties: { type: "number", minimum: 0, maximum: 100000 }, description: "Gross multiplier by number of picks that hit, e.g. {\"3\": 6} for a 3-pick power play paying 6×. A parlay without per-pick prices: {\"<picks>\": decimal odds of the whole parlay}." },
          use_model_chances: { type: "boolean", description: "Copy the model's chance into each pick without one (only if the owner asked)." },
          use_book_chances: { type: "boolean", description: "Copy the sportsbooks' no-vig chance into each pick without one (NBA player lines at the exact line; game bets at the market's own moneyline, spread or total), only if the owner asked. Applied before use_model_chances." },
        },
        required: ["legs"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const now = ctx.now();
        const load = recordLoader(ctx.sportsStore);
        const warnings = [];
        // Picks without a game id go to that player's next scheduled game.
        const legs = [];
        for (const [i, l] of args.legs.entries()) {
          if (l.kind === "team") {
            if (!l.game_id) fail("INVALID_INPUT", `Pick ${i + 1}: a game bet needs game_id (see sports_list_games)`);
            legs.push({ kind: "team", sport: l.sport, game_id: String(l.game_id).toLowerCase(), market: l.market, team: l.team ? String(l.team).toLowerCase() : null, side: l.side ?? null, line: l.line ?? null, price: l.price ?? null, probability: l.chance ?? null, probability_source: l.chance != null ? "owner" : null });
            continue;
          }
          if (!l.player_id || !l.stat || !l.side || l.threshold == null) fail("INVALID_INPUT", `Pick ${i + 1}: a player pick needs player_id, stat, side and threshold`);
          let game_id = l.game_id ? String(l.game_id).toLowerCase() : null;
          if (!game_id) {
            const view = viewOrFail(await guarded(g, () => leagueView("player", { store: ctx.sportsStore, sport: l.sport, query: { id: l.player_id }, now })), fail, "player");
            if (!view.next_game?.game_id) fail("NOT_FOUND", `Pick ${i + 1}: no scheduled game is stored for that player; pass game_id`);
            game_id = view.next_game.game_id;
            warnings.push(`GAME_FROM_SCHEDULE: pick ${i + 1} uses the player's next stored game (${view.next_game.away_team} at ${view.next_game.home_team}, ${view.next_game.start_utc}). Check it is the game on the slip.`);
          }
          legs.push({ sport: l.sport, player_id: String(l.player_id).toLowerCase(), game_id, stat: l.stat, side: l.side, threshold: l.threshold, ...(typeof l.starting === "boolean" ? { starting: l.starting } : {}), price: l.price ?? null, probability: l.chance ?? null, probability_source: l.chance != null ? "owner" : null });
        }
        const body = { legs, operator: args.operator, format: args.format || "power", stake: args.stake, payouts: args.payouts || {} };
        // Live context: injuries (NBA forecasts count regular teammates listed
        // out), and the books' price for NBA lines.
        const live = await liveSources(ctx, legs.map((l) => l.sport));
        const injuries = { nba: live.nba?.injuries || null, nfl: live.nfl?.injuries || null };
        let ev = await guarded(g, () => evaluateEntry({ load, body, now, injuries }));
        const people = {};
        for (const sport of new Set(ev.legs.map((l) => l.sport))) people[sport] = (await load("players", { sport }).catch(() => null))?.players || [];
        const nflReport = ev.legs.some((l) => l.sport === "nfl") ? await load("injuries", { sport: "nfl" }).catch(() => null) : null;
        const weekOf = async (l) => {
          if (l.sport !== "nfl") return null;
          for (const season of [new Date(now).getUTCFullYear(), new Date(now).getUTCFullYear() - 1]) {
            const game = ((await load("games", { sport: "nfl", season }).catch(() => null))?.games || []).find((x) => x.game_id === l.game_id);
            if (game) return game.week ?? null;
          }
          return null;
        };
        const context = [];
        for (const l of ev.legs) {
          if (l.kind === "team") {
            // The books' no-vig chance for a game bet is the team model's
            // market read (push left out); as a win chance it carries the push.
            const bc = l.model?.status === "ok" && l.model.book_chance != null ? Math.round(l.model.book_chance * (1 - (l.model.push || 0)) * 10000) / 10000 : null;
            context.push({ book: { chance: bc, source: bc != null ? "game line" : null }, vs: null, availability: null });
            continue;
          }
          const src = live[l.sport] || {};
          const book = bookPriceForLine(l, gameOf(l), src.reference, now);
          const player = people[l.sport].find((p) => p.player_id === l.player_id) || { name: l.player_name };
          const official = l.sport === "nfl" ? { record: nflReport, week: await weekOf(l) } : null;
          context.push({ book, vs: bookVsModel(book, l.model?.status === "ok" ? l.model.probability : null), availability: availabilityFor(player, l.team, src.injuries, l.sport, official) });
        }
        let filled = legs;
        if (args.use_book_chances) {
          filled = filled.map((l, i) => (l.probability == null && context[i].book.chance != null ? { ...l, probability: context[i].book.chance, probability_source: "book" } : l));
        }
        if (args.use_model_chances) {
          filled = filled.map((l, i) => (l.probability == null && ev.legs[i].model?.status === "ok" ? { ...l, probability: ev.legs[i].model.probability, probability_source: "model" } : l));
        }
        if (filled.some((l, i) => l !== legs[i])) ev = await guarded(g, () => evaluateEntry({ load, body: { ...body, legs: filled }, now, injuries }));
        if (args.use_book_chances || args.use_model_chances) {
          const missing = filled.filter((l) => l.probability == null).length;
          if (missing) warnings.push(`NO_CHANCE: ${missing} pick(s) have no ${args.use_book_chances ? "book or " : ""}model chance; the owner must enter those on the site.`);
        }
        ev.legs.forEach((l, i) => { if (l.kind !== "team") warnings.push(...legNotes(i, l, context[i].book, context[i].vs, context[i].availability)); });
        const refStates = Object.entries(live).filter(([sport]) => sport === "nba").map(([, s]) => s.reference?.state).filter(Boolean);
        if (refStates.length && refStates.every((st) => st !== "ok")) warnings.push("NO_BOOK_PRICES: the sportsbook price feed is not available right now; the model's chance stands alone.");
        const link = `${ctx.origin || ""}/?tab=sports-pick-builder&entry=${encodePrefill({ operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts, legs: ev.legs })}`;
        const results = {
          pick_builder_link: link,
          operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts,
          legs: ev.legs.map((l, i) => l.kind === "team" ? ({
            kind: "team", sport: l.sport, game_id: l.game_id, matchup: l.matchup, game_start_utc: l.game_start_utc, game_status: l.game_status,
            market: l.market, team: l.team, side: l.side, line: l.line, label: l.label,
            chance: l.probability, chance_source: l.probability_source, price: l.price, odds: l.odds,
            hit_history: l.history, recent: l.recent, model: l.model, game_lines: l.game_lines || null, book: context[i].book,
          }) : ({
            kind: "player", price: l.price, odds: l.odds,
            sport: l.sport, player_id: l.player_id, player_name: l.player_name, team: l.team, opponent: l.opponent, game_id: l.game_id, matchup: l.matchup,
            game_start_utc: l.game_start_utc, game_status: l.game_status, stat: l.stat, side: l.side, threshold: l.threshold,
            chance: l.probability, chance_source: l.probability_source,
            // Not "history": the MCP's size limit drops any key by that name as a long series.
            hit_history: l.history, model: l.model, game_lines: l.game_lines || null,
            book: context[i].book, book_vs_model: context[i].vs, availability: context[i].availability,
          })),
          same_game: ev.same_game,
          evaluation: ev.evaluation,
          started: ev.locked,
          warnings: ev.warnings,
        };
        if (ev.locked) warnings.push("STARTED: a game in this entry has started; the site saves paper picks only before the games.");
        ev.legs.forEach((l, i) => { if (l.model?.reason === "team_changed") warnings.push(`TEAM_CHANGED: pick ${i + 1} (${l.player_name}): the player has moved teams since the last stored game, so the model has no measured role with the new team.`); });
        const sports = [...new Set(legs.map((l) => l.sport))];
        const status = await loadStatus(ctx, sports[0]);
        results.data_check = Object.fromEntries(await Promise.all(sports.map(async (sp) => [sp, dataCheck(await loadStatus(ctx, sp), now)])));
        return done(ctx, "sports_evaluate_entry", { page: "/?tab=sports-pick-builder", saves: false }, status, results, warnings, [
          "Payouts and odds must be exactly what the app shows for this entry. Same-game picks are priced only with measured links; otherwise no combined chance is given (the any-link range and the 'if unrelated' chance are).",
          "breakeven_per_pick assumes every pick has the same chance and they are independent. Sportsbook prices have the margin removed (Shin method) and are a market read, not a win guarantee.",
        ]);
      },
    },
    {
      name: "sports_get_prop_record",
      title: "Sports: prop picks record",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: the win/bust record of the props the Sports pages issued (first pick per team before each game, lines and analysis frozen when issued): totals and win rate, splits by stat, basis, rank and closing-line move, and the most recent picks as compact rows with their result and actual stat. Pass `prop_id` for one pick in full (its evidence, history and features). Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          sport: SPORT,
          recent: { type: "integer", minimum: 0, maximum: 50, description: "How many most recent picks to list (default 20)." },
          offset: { type: "integer", minimum: 0, maximum: 10000, description: "Skip this many of the newest picks (paging)." },
          prop_id: { ...ID, description: "One issued pick in full, by its prop_id from the list." },
        },
        required: ["sport"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const load = recordLoader(ctx.sportsStore);
        const status = await loadStatus(ctx, args.sport);
        const seasons = storedSeasons(status, args.sport, ctx.now());
        // Dated by the record itself (the props scan writes it), not the league data run.
        const saved = await Promise.all(seasons.map((season) => load("prop-record", { sport: args.sport, season }).catch(() => null)));
        const updatedAt = saved.map((r) => r?.updated_utc).filter((t) => typeof t === "string" && Number.isFinite(Date.parse(t))).sort().pop() || null;
        const source = { page: `/?tab=sports-${args.sport}` };
        const limits = ["Win rate leaves out pushes, voids, NFL picks with no stat line (no_stats) and picks still waiting for stats. Operator reboot and payout rules are not modeled."];
        if (args.prop_id) {
          // Page through the graded record until the pick turns up.
          for (let offset = 0; ; ) {
            const page = await guarded(g, () => propRecordView({ load, sport: args.sport, seasons, now: ctx.now(), all: true, offset }));
            const hit = page.records.find((r) => r.prop_id === args.prop_id);
            if (hit) return done(ctx, "sports_get_prop_record", source, status, { sport: args.sport, pick: hit }, [], limits, { updatedAt });
            if (page.next_offset == null) fail("NOT_FOUND", `No issued ${args.sport} pick with prop_id ${args.prop_id}`);
            offset = page.next_offset;
          }
        }
        const limit = args.recent ?? 20;
        const view = await guarded(g, () => propRecordView({ load, sport: args.sport, seasons, now: ctx.now(), offset: args.offset ?? 0, limit: Math.max(limit, 1) }));
        const { records, snapshot, ...rest } = view;
        return done(ctx, "sports_get_prop_record", source, status, { ...rest, records: limit ? records.map(compactProp) : [] }, view.total ? [] : ["NO_PICKS: no props have been issued for this league yet."], limits, { updatedAt });
      },
    },
    {
      name: "sports_get_league_stats",
      title: "Sports: player leaders and team stats",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: the Leaders view (every player's per-game averages over the season, last 10 or last 5 games, sortable by any shown stat) or the Teams view (records, points for and against, each stat scored and allowed, by position group) for one stored season.",
      inputSchema: {
        type: "object",
        properties: {
          sport: SPORT,
          view: { type: "string", enum: ["leaders", "teams"], description: "Default leaders." },
          window: { type: "string", enum: [...LEADER_WINDOWS], description: "Leaders only: season (default), last10 or last5." },
          sort_by: { type: "string", enum: STATS, description: "Leaders only: stat to rank by (default the league's first main stat)." },
          team: { type: "string", maxLength: 8, pattern: "^[A-Za-z]{2,5}$", description: "Keep one team (e.g. lal): its players, or its row in the Teams view." },
          limit: { type: "integer", minimum: 1, maximum: 100, description: "How many rows (default 25 players, or 8 teams)." },
          offset: { type: "integer", minimum: 0, maximum: 1000, description: "Skip this many rows (paging)." },
          min_games: { type: "integer", minimum: 0, maximum: 200, description: "Leaders only: keep players with at least this many games played." },
          season: { type: "integer", minimum: 1946, maximum: 2100, description: "Stored season (default the current one)." },
        },
        required: ["sport"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const op = args.view === "teams" ? "teams" : "leaders";
        const query = { window: args.window || "season", ...(args.season ? { season: String(args.season) } : {}) };
        const view = await guarded(g, () => leagueView(op, { store: ctx.sportsStore, sport: args.sport, query, now: ctx.now() }));
        viewOrFail(view, fail, "season");
        // The page falls back to the newest stored season; a caller asking for
        // a specific one is told instead of silently getting another.
        if (args.season && view.season !== args.season) fail("NOT_FOUND", `Season ${args.season} is not stored for ${args.sport}. Stored: ${(view.seasons || []).join(", ") || "none"}`);
        let results = view;
        if (op === "leaders") {
          const stat = args.sort_by && (view.stats || []).includes(args.sort_by) ? args.sort_by : (view.stats || []).find((x) => x !== "minutes") || (view.stats || [])[0];
          if (args.sort_by && stat !== args.sort_by) fail("INVALID_INPUT", `"${args.sort_by}" is not a Leaders stat for ${args.sport}. Options: ${(view.stats || []).join(", ")}`);
          let players = (view.players || []).filter((p) => (!args.team || String(p.team).toLowerCase() === args.team.toLowerCase()) && (p.games ?? 0) >= (args.min_games ?? 0));
          players = players.sort((a, b) => (b.values?.[stat] ?? -Infinity) - (a.values?.[stat] ?? -Infinity));
          const offset = args.offset ?? 0, rows = players.slice(offset, offset + (args.limit ?? 25));
          results = { sport: view.sport, season: view.season, seasons: view.seasons, window: view.window, sorted_by: stat, stats: view.stats, teams: view.teams,
            total: players.length, offset, next_offset: offset + rows.length < players.length ? offset + rows.length : null, players: rows };
        } else {
          // Each team row carries every stat by position group, so page them.
          const all = (view.teams || []).filter((t) => !args.team || String(t.team).toLowerCase() === args.team.toLowerCase());
          const offset = args.offset ?? 0, rows = all.slice(offset, offset + (args.limit ?? 8));
          results = { ...view, total: all.length, offset, next_offset: offset + rows.length < all.length ? offset + rows.length : null, teams: rows };
        }
        return done(ctx, "sports_get_league_stats", { page: `/?tab=sports-${args.sport}` }, status, results);
      },
    },
    {
      name: "sports_get_model_check",
      title: "Sports: model check and paper results",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: how the stat model and the same-game links scored on later games they never saw (validated or experimental, with the reason), the seasons fitted, the team game model's check per kind of bet (`team_model`: moneyline, spread, win by X, game total, team total; validated = 300+ held-out results with calibration error within 0.03 or what luck gives, plus the blend toward the books and how far results land from their lines), and the paper journal's totals plus how the model's and the used chances held up on settled picks.",
      inputSchema: {
        type: "object",
        properties: { sport: SPORT },
        required: ["sport"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const load = recordLoader(ctx.sportsStore);
        const status = await loadStatus(ctx, args.sport);
        const model = await guarded(g, () => load("model", { sport: args.sport }));
        const journal = await guarded(g, () => journalView({ load, now: ctx.now(), sub: ctx.principal.sub }));
        const summary = model ? modelSummary(model) : null;
        const teamModel = await load("team-model", { sport: args.sport }).catch(() => null);
        const tm = teamModel ? teamModelSummary(teamModel) : null;
        return done(ctx, "sports_get_model_check", { page: `/?tab=sports-${args.sport}` }, status, {
          sport: args.sport,
          model: summary ? { ...summary, line_proxy: model.line_proxy || null, scored: model.scored || null } : null,
          team_model: tm ? { ...tm, see: "sports_team_odds" } : { status: "not_fitted" },
          journal: { note: "Paper journal, both leagues.", summary: journal.summary, calibration: journal.calibration },
        }, summary ? [] : ["NO_MODEL: the model has not been fitted yet; the next daily data run fits it."]);
      },
    },
  ];
}
