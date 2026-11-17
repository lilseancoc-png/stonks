// lib/mcp/prediction-tools.mjs — prediction market odds on the Mingstreet MCP.
//
// Same rules as every MCP tool: read-only, zero AI calls, no live venue
// request. Both tools read what the daily build saved from the free Kalshi
// and Polymarket public APIs (lib/prediction/):
//   get_prediction_markets  public  prediction-odds.json: tracked contracts by
//                                   topic, the stocks each could move, big
//                                   moves, the market's guess for the next
//                                   CPI / jobs / Fed releases
//   get_odds_reactions      Owner   prediction-odds-owner.json: the tests of
//                                   how odds and odds jumps lined up with
//                                   stock moves, the run-up watch and the
//                                   alerts on open Top Picks trades
// The raw history file (prediction-odds-state.json) is never read here.
import { THEMES } from "../prediction/catalog.mjs";
import { PREDICTION_KEY, PREDICTION_OWNER_KEY, VERDICT_ORDER } from "../prediction/index.mjs";

const ANY = "any";
const OWNER = "owner";
const THEME_IDS = THEMES.map((t) => t.id);
const DIR = { 1: "up", "-1": "down", 0: "unknown" };

// One contract as an AI client reads it: the chance in percent, moves in
// points, the stocks it could move and which way if it resolves YES.
function contractRow(c, rules, { line = false } = {}) {
  return {
    id: c.id, venue: c.venue, topic: c.theme, title: c.title,
    chance_pct: c.p, change_1d_pts: c.ch1, change_7d_pts: c.ch7, change_30d_pts: c.ch30,
    closes: c.closeTime ? String(c.closeTime).slice(0, 10) : null, days_left: c.daysLeft,
    volume: c.volume, volume_24h: c.volume24h, thin: !!c.thin, status: c.status,
    ...(c.result ? { result: c.result, resolved_at: c.resolvedAt, chance_before_pct: c.before ?? null } : {}),
    stocks: (c.links || []).map((l) => ({ ticker: l.s, if_yes: DIR[l.g] || "unknown", why: rules?.[l.r] || l.r })),
    ...(line ? { daily_chance_30d: c.spark || [] } : {}),
    as_of: c.asOf, url: c.url,
  };
}

const wordsOf = (q) => String(q || "").toLowerCase().split(/[^a-z0-9$%.-]+/).filter((w) => w.length >= 2).slice(0, 8);
const matchesWords = (c, words) => !words.length || words.every((w) => `${c.title} ${c.question || ""} ${c.outcome || ""}`.toLowerCase().includes(w));

export function predictionTools({ fail, envelope, boundedJson, readKey, normSymbol }) {
  return [
    {
      name: "get_prediction_markets",
      title: "Prediction market odds",
      audience: ANY,
      description:
        "What traders on Kalshi and Polymarket are betting on, saved once a day: contracts on the Fed, the economy, policy and trade, politics and elections, geopolitics, commodities, crypto, companies and markets. Each shows the chance (price), its 1/7/30-day move and the covered stocks it could move (and which way if YES). Filter by `topic`, `ticker`, `query` or one `contract_id` (adds its 30-day line). `view`: contracts (default), moves (10-point daily jumps), resolved (last 30 days), releases (the market's guess for the next CPI, jobs and Fed releases, and how recent ones compared). Traded prices, not the site's forecast.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", enum: ["contracts", "moves", "resolved", "releases"], description: "Default contracts." },
          topic: { type: "string", enum: THEME_IDS, description: "Only this topic." },
          ticker: { type: "string", maxLength: 8, description: "Only contracts linked to this stock or ETF, e.g. NVDA, TLT." },
          query: { type: "string", maxLength: 120, description: "Words that must all appear in the title, e.g. 'tariff china'." },
          contract_id: { type: "string", maxLength: 120, pattern: "^[KP]:[A-Za-z0-9._-]{1,110}$", description: "One contract id (K:… Kalshi, P:… Polymarket) from an earlier result." },
          include_thin: { type: "boolean", description: "Include thinly traded contracts (default true; they are marked thin)." },
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Rows per list (default 25)." },
        },
        additionalProperties: false,
      },
      async run(ctx, args) {
        const { payload: pub } = await readKey(ctx, PREDICTION_KEY);
        const rules = pub.rules || {};
        const limit = Math.min(Number(args.limit) || 25, 60);
        const sym = args.ticker ? normSymbol(args.ticker) : null;
        const words = wordsOf(args.query);
        const view = args.view || "contracts";
        const warnings = [];
        if (pub.stale) warnings.push("STALE: neither venue answered on the last build; these are the last saved prices.");
        for (const [v, st] of Object.entries(pub.venues || {})) if (st && st.ok === false) warnings.push(`VENUE_DOWN: ${v} did not answer on the last build (${st.error || "error"}); its prices are from ${st.asOf || "an earlier build"}.`);
        const all = (pub.themes || []).flatMap((t) => t.contracts || []);
        const common = {
          as_of: pub.builtAt, venues: pub.venues, counts: pub.counts,
          gauges: { chance_of_cut_next_fed_pct: pub.gauges?.cutNext ?? null, chance_of_hike_next_fed_pct: pub.gauges?.hikeNext ?? null, chance_of_hold_next_fed_pct: pub.gauges?.holdNext ?? null, next_fed_meeting: pub.gauges?.fedMeeting ?? null, next_fed_source: pub.gauges?.fedVenue ?? null, policy_politics_churn_pts: pub.gauges?.policyChurn ?? null, contracts_jumped_10pts_today: pub.gauges?.jumps ?? null },
          how_to_read: pub.note,
        };
        let results;
        if (args.contract_id) {
          const c = [...all, ...(pub.resolved || [])].find((x) => x.id === args.contract_id);
          if (!c) fail("NOT_FOUND", `No tracked contract ${args.contract_id}. Search with topic, ticker or query.`);
          const jumps = (pub.jumps || []).filter((j) => j.id === c.id);
          results = { ...common, contract: contractRow(c, rules, { line: true }), moves: jumps };
        } else if (view === "moves") {
          let jumps = pub.jumps || [];
          if (args.topic) jumps = jumps.filter((j) => j.theme === args.topic);
          if (sym) jumps = jumps.filter((j) => (j.links || []).includes(sym));
          if (words.length) jumps = jumps.filter((j) => matchesWords(j, words));
          results = { ...common, note: "Moves of 10 points or more between two daily closes (16:00 ET) in the last 14 days. Owner tests of how stocks reacted are in get_odds_reactions.", moves: jumps.slice(0, limit).map((j) => ({ id: j.id, date: j.date, from_pct: j.from, to_pct: j.to, change_pts: j.change, title: j.title, topic: j.theme, stocks: j.links, url: j.url })) };
        } else if (view === "resolved") {
          let list = pub.resolved || [];
          if (args.topic) list = list.filter((c) => c.theme === args.topic);
          if (sym) list = list.filter((c) => (c.links || []).some((l) => l.s === sym));
          if (words.length) list = list.filter((c) => matchesWords(c, words));
          results = { ...common, resolved: list.slice(0, limit).map((c) => contractRow(c, rules)) };
        } else if (view === "releases") {
          const cons = pub.consensus || {};
          results = {
            ...common,
            note: "The market's guess is the middle of Kalshi's level ladder, the last reading at least 30 minutes before the release (for the Fed: the summed chance of a cut and of a hike). Surprise = actual minus that guess.",
            upcoming: cons.upcoming || [], recent: (cons.recent || []).slice(0, limit),
          };
        } else {
          let list = all;
          if (args.topic) list = list.filter((c) => c.theme === args.topic);
          if (sym) {
            const ids = new Set((pub.bySymbol?.[sym] || []).map((x) => x.id));
            list = list.filter((c) => ids.has(c.id) || (c.links || []).some((l) => l.s === sym));
            if (!list.length) warnings.push(`NO_LINKED_CONTRACTS: no tracked contract is linked to ${sym} today.`);
          }
          if (words.length) list = list.filter((c) => matchesWords(c, words));
          if (args.include_thin === false) list = list.filter((c) => !c.thin);
          const topics = (pub.themes || []).map((t) => ({ id: t.id, label: t.label, contracts: (t.contracts || []).length }));
          results = { ...common, topics, contracts: list.slice(0, limit).map((c) => contractRow(c, rules)), more: Math.max(0, list.length - limit) };
        }
        const bounded = boundedJson(results, { maxItems: 60 });
        if (bounded.reduced) warnings.push("TRIMMED: long lists were shortened; narrow with topic, ticker, query or limit.");
        return envelope(ctx, {
          tool: "get_prediction_markets",
          source: { key: PREDICTION_KEY, page: "/?tab=prediction-markets" },
          payload: { builtAtIso: pub.builtAt },
          owner: false,
          warnings,
          limitations: [
            "Kalshi and Polymarket prices read from their free public APIs once per site build; the 30-day line is one price per day at 16:00 ET.",
            "A price is the market's chance, not the site's forecast. A link with direction unknown has no direction set in advance; the Owner tests learn it from the data.",
          ],
          results: bounded.value,
        });
      },
    },
    {
      name: "get_odds_reactions",
      title: "How odds moves lined up with stocks",
      audience: OWNER,
      description:
        "Owner tests of whether prediction market odds help read stock moves: for each link rule and stock, do 10-point odds jumps move the stock the same day or after (and did the stock move first), do daily odds changes lead or echo stock returns, and do stocks run up into a contract's close. Also the run-up watch (contracts closing within 90 days that are moving, with each linked stock's 10-day move), alerts on open Top Picks trades whose linked contract moved 5+ points in a day, how stocks reacted to CPI / jobs / Fed surprises, and the shadow inputs logged for the engine. Measurement only: nothing here changes a pick.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", enum: ["summary", "tests", "runup", "alerts", "moves", "releases", "shadow"], description: "Default summary." },
          ticker: { type: "string", maxLength: 8, description: "Only rows for this stock or ETF." },
          limit: { type: "integer", minimum: 1, maximum: 80, description: "Rows per list (default 20)." },
        },
        additionalProperties: false,
      },
      async run(ctx, args) {
        if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
        const { payload: o } = await readKey(ctx, PREDICTION_OWNER_KEY);
        const sym = args.ticker ? normSymbol(args.ticker) : null;
        const limit = Math.min(Number(args.limit) || 20, 80);
        const view = args.view || "summary";
        const bySym = (rows, key = "sym") => (sym ? rows.filter((r) => r[key] === sym || (Array.isArray(r.stocks) && r.stocks.some((s) => s.sym === sym))) : rows);
        const fams = bySym(o.families || []);
        // A learned direction counts only once a held-out test passed (the
        // same rule as provenSign in lib/prediction/index.mjs).
        const passed1 = (f) => [f.jumps?.verdict, f.flow?.verdict, f.runup?.verdict].some((v) => (VERDICT_ORDER[v] ?? 3) <= 1);
        const passed = (v) => ["holds", "odds-lead", "run-up-follows", "odds-echo", "moves-together", "same-day", "echo"].includes(v);
        const famRow = (f) => ({
          rule: f.rule, ticker: f.sym, if_yes: DIR[f.sign] || "unknown", sign_set_in_advance: !f.learned, direction_proven: !f.learned || passed1(f), contracts: f.contracts,
          jumps: { verdict: f.jumps?.verdict, events: f.jumps?.n, test_events: f.jumps?.nTest, same_day: f.jumps?.same, next_day: f.jumps?.next1, next_3d: f.jumps?.next3, stock_moved_first_3d: f.jumps?.prev3, q: f.jumps?.q },
          daily_flow: { verdict: f.flow?.verdict, days: f.flow?.n, same_day: f.flow?.same, odds_lead: f.flow?.lead, odds_echo: f.flow?.echo, q_lead: f.flow?.qLead, q_echo: f.flow?.qEcho },
          run_up: { verdict: f.runup?.verdict, days: f.runup?.n, together: f.runup?.concurrent, forward: f.runup?.forward, q: f.runup?.qFwd },
        });
        let results;
        if (view === "tests") results = { families: fams.slice(0, limit).map(famRow), more: Math.max(0, fams.length - limit) };
        else if (view === "runup") results = { run_up: bySym(o.runUp || []).slice(0, limit) };
        else if (view === "alerts") results = { alerts: bySym(o.alerts || [], "symbol").slice(0, limit) };
        else if (view === "moves") results = { moves: bySym(o.jumps || []).slice(0, limit) };
        else if (view === "releases") results = { tests: (o.consensus?.tests || []).filter((t) => !sym || t.sym === sym), releases: (o.consensus?.rows || []).slice(0, limit) };
        else if (view === "shadow") results = { market: o.shadow?.mkt || {}, by_stock: sym ? { [sym]: o.shadow?.rows?.[sym] || null } : o.shadow?.rows || {}, note: "Logged beside each grade (pmn: linked open contracts; pmo: sum of sign x 7-day odds change in points). Nothing scores until the Owner turns it on in Settings (off by default)." };
        else {
          results = {
            verdict_counts: o.verdictCounts || {},
            passing: fams.filter((f) => passed(f.jumps?.verdict) || passed(f.flow?.verdict) || passed(f.runup?.verdict)).slice(0, limit).map(famRow),
            alerts: bySym(o.alerts || [], "symbol").slice(0, 10),
            run_up: bySym(o.runUp || []).slice(0, 10),
            release_tests: (o.consensus?.tests || []).filter((t) => passed(t.verdict) && (!sym || t.sym === sym)),
            tracked: o.tracked, last_run: o.run,
          };
        }
        const bounded = boundedJson({ as_of: o.builtAt, method: o.rules, ...results }, { maxItems: 80 });
        return envelope(ctx, {
          tool: "get_odds_reactions",
          source: { key: PREDICTION_OWNER_KEY, page: "/?tab=prediction-markets&view=tests" },
          payload: { builtAtIso: o.builtAt },
          owner: true,
          warnings: bounded.reduced ? ["TRIMMED: long lists were shortened; narrow with ticker, view or limit."] : [],
          limitations: [
            "Private Owner research. Verdicts read only the held-out last third of each family's dates; most families say collecting until 30+ events exist.",
            "A learned direction is acted on (helps / hurts) only after a held-out test passes; until then it reads unknown with `pending` set.",
          ],
          results: bounded.value,
        });
      },
    },
  ];
}
