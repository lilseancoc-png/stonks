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
import { SPORTS, SIDES, OPERATORS, SPORTS_STATS, statIds } from "../sports/schema.mjs";
import { leagueView, recordLoader } from "../sports/http.mjs";
import { evaluateEntry, journalView } from "../sports/journal.mjs";
import { modelSummary } from "../sports/models.mjs";
import { encodePrefill } from "../sports/prefill.mjs";
import { SPORTS_TIME_ZONES } from "../sports/time.mjs";

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
  "Private Owner research on stored box scores. Paper picks only: no sportsbook or pick'em app is contacted and nothing is placed.",
  "Forecasts know nothing about injuries, rest or news. Chances are the owner's to choose; the model's chances are labeled as the model's.",
];

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

export function sportsTools({ fail, envelope, boundedJson, ToolError }) {
  const g = { fail, ToolError };
  const loadStatus = async (ctx, sport) => recordLoader(ctx.sportsStore)("status", { sport }).catch(() => null);
  const asOf = (status) => ({ updatedAt: status?.last_success_utc || null });
  const done = (ctx, tool, source, status, results, warnings = [], limitations = []) => {
    const bounded = boundedJson(results);
    return envelope(ctx, {
      tool, source, payload: asOf(status), owner: true,
      warnings: [...warnings, ...(status ? [] : ["NOT_CONNECTED: this league's data job has not written a status record yet."]), ...(bounded.reduced ? ["TRIMMED: long lists were shortened."] : [])],
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
      description: "Owner Sports: NBA or NFL games starting today and tomorrow (Pacific time unless a time zone is given), with game ids, teams, start times and status, plus the next game when none are scheduled. Game ids feed sports_get_game and sports_evaluate_entry.",
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
        return done(ctx, "sports_get_game", { page: `/?tab=sports-${args.sport}` }, status, { ...view, teams, matchup, shown_stats: want });
      },
    },
    {
      name: "sports_get_player",
      title: "Sports: one player",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: one player's stored game log (newest first), averages, next scheduled game and the stat model's forecast for it (expected value, 80% range, chance of the over at five lines, and whether that stat passed its check on later games).",
      inputSchema: {
        type: "object",
        properties: { sport: SPORT, player_id: ID, games: { type: "integer", minimum: 1, maximum: 40, description: "How many recent games to return (default 15)." } },
        required: ["sport", "player_id"],
        additionalProperties: false,
      },
      async run(ctx, args) {
        sportsGate(ctx, fail);
        const status = await loadStatus(ctx, args.sport);
        const view = viewOrFail(await guarded(g, () => leagueView("player", { store: ctx.sportsStore, sport: args.sport, query: { id: args.player_id }, now: ctx.now() })), fail, "player");
        const n = args.games || 15;
        return done(ctx, "sports_get_player", { page: `/?tab=sports-${args.sport}` }, status, { ...view, games: view.games.slice(0, n) });
      },
    },
    {
      name: "sports_evaluate_entry",
      title: "Sports: check a pick'em entry",
      audience: OWNER,
      sports: true,
      description:
        "Owner Sports: check a 1-6 pick entry exactly as the Pick Builder does (read-only; nothing is saved). Each pick gets its stored game, history hit counts and the stat model's chance for the line. With the app (operator), entry type, paper stake and the payout from the app (gross multiplier, stake included) it returns the breakeven, the chance of all hitting (independent picks, or the measured same-game links for picks from one game) and the expected value. Pass `chance` only when the owner gave one; `use_model_chances` copies the model's chance into every pick it covers, as the owner's choice. Always returns `pick_builder_link`: open it to fill the entry on the site, check it there and save it as a paper pick. The link never carries chances.",
      inputSchema: {
        type: "object",
        properties: {
          legs: {
            type: "array", minItems: 1, maxItems: 6,
            items: {
              type: "object",
              properties: {
                sport: SPORT,
                player_id: ID,
                game_id: { ...ID, description: "Optional: the stored game id. Left out, the player's next scheduled game is used." },
                stat: { type: "string", enum: STATS, description: STAT_HELP },
                side: { type: "string", enum: [...SIDES] },
                threshold: { type: "number", minimum: 0, maximum: 1000, description: "The line, a whole or half number." },
                chance: { type: "number", minimum: 0.0001, maximum: 0.9999, description: "Optional owner's chance this pick hits (0-1). Never invent one." },
              },
              required: ["sport", "player_id", "stat", "side", "threshold"],
              additionalProperties: false,
            },
          },
          operator: { type: "string", enum: [...OPERATORS] },
          format: { type: "string", enum: ["power", "flex"], description: "power: every pick must hit; flex: pays with some misses." },
          stake: { type: "number", minimum: 0.01, maximum: 100000, description: "Paper stake in dollars." },
          payouts: { type: "object", maxProperties: 7, propertyNames: { pattern: "^[0-6]$" }, additionalProperties: { type: "number", minimum: 0, maximum: 100000 }, description: "Gross multiplier by number of picks that hit, e.g. {\"3\": 6} for a 3-pick power play paying 6×." },
          use_model_chances: { type: "boolean", description: "Copy the model's chance into each pick without one (only if the owner asked)." },
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
          let game_id = l.game_id ? String(l.game_id).toLowerCase() : null;
          if (!game_id) {
            const view = viewOrFail(await guarded(g, () => leagueView("player", { store: ctx.sportsStore, sport: l.sport, query: { id: l.player_id }, now })), fail, "player");
            if (!view.next_game?.game_id) fail("NOT_FOUND", `Pick ${i + 1}: no scheduled game is stored for that player; pass game_id`);
            game_id = view.next_game.game_id;
            warnings.push(`GAME_FROM_SCHEDULE: pick ${i + 1} uses the player's next stored game (${view.next_game.away_team} at ${view.next_game.home_team}, ${view.next_game.start_utc}). Check it is the game on the slip.`);
          }
          legs.push({ sport: l.sport, player_id: String(l.player_id).toLowerCase(), game_id, stat: l.stat, side: l.side, threshold: l.threshold, probability: l.chance ?? null, probability_source: l.chance != null ? "owner" : null });
        }
        const body = { legs, operator: args.operator, format: args.format || "power", stake: args.stake, payouts: args.payouts || {} };
        let ev = await guarded(g, () => evaluateEntry({ load, body, now }));
        if (args.use_model_chances) {
          const filled = ev.legs.map((l, i) => (legs[i].probability == null && l.model?.status === "ok" ? { ...legs[i], probability: l.model.probability, probability_source: "model" } : legs[i]));
          if (filled.some((l, i) => l !== legs[i])) ev = await guarded(g, () => evaluateEntry({ load, body: { ...body, legs: filled }, now }));
          const missing = filled.filter((l) => l.probability == null).length;
          if (missing) warnings.push(`NO_MODEL_CHANCE: ${missing} pick(s) have no model chance; the owner must enter those on the site.`);
        }
        const link = `${ctx.origin || ""}/?tab=sports-pick-builder&entry=${encodePrefill({ operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts, legs })}`;
        const results = {
          pick_builder_link: link,
          operator: ev.operator, format: ev.format, stake: ev.stake, payouts: ev.payouts,
          legs: ev.legs.map((l) => ({
            sport: l.sport, player_id: l.player_id, player_name: l.player_name, team: l.team, opponent: l.opponent, game_id: l.game_id, matchup: l.matchup,
            game_start_utc: l.game_start_utc, game_status: l.game_status, stat: l.stat, side: l.side, threshold: l.threshold,
            chance: l.probability, chance_source: l.probability_source,
            // Not "history": the MCP's size limit drops any key by that name as a long series.
            hit_history: l.history, model: l.model,
          })),
          same_game: ev.same_game,
          evaluation: ev.evaluation,
          started: ev.locked,
          warnings: ev.warnings,
        };
        if (ev.locked) warnings.push("STARTED: a game in this entry has started; the site saves paper picks only before the games.");
        const sports = [...new Set(legs.map((l) => l.sport))];
        const status = await loadStatus(ctx, sports[0]);
        return done(ctx, "sports_evaluate_entry", { page: "/?tab=sports-pick-builder", saves: false }, status, results, warnings, [
          "Payouts must be the exact multipliers the app shows for this entry. Same-game picks are priced only with measured links; otherwise no combined chance is given.",
        ]);
      },
    },
    {
      name: "sports_get_model_check",
      title: "Sports: model check and paper results",
      audience: OWNER,
      sports: true,
      description: "Owner Sports: how the stat model and the same-game links scored on later games they never saw (validated or experimental, with the reason), the seasons fitted, and the paper journal's totals plus how the model's and the used chances held up on settled picks.",
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
        return done(ctx, "sports_get_model_check", { page: `/?tab=sports-${args.sport}` }, status, {
          sport: args.sport,
          model: summary ? { ...summary, line_proxy: model.line_proxy || null, scored: model.scored || null } : null,
          journal: { note: "Paper journal, both leagues.", summary: journal.summary, calibration: journal.calibration },
        }, summary ? [] : ["NO_MODEL: the model has not been fitted yet; the next daily data run fits it."]);
      },
    },
  ];
}
