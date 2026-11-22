// lib/mcp/valuation-tools.mjs — the Valuation lab on the Mingstreet MCP.
//
// value_stock (Owner): one stock's modeled value from the eight methods on
// valuation-lab.json (lib/valuation-lab.mjs), under a named environment
// (recession, tariffs, a party sweep, ...) and any inputs the caller
// overrides, with what today's price implies, the inputs that move the answer
// most, the range of outcomes, the then-vs-now / analysts story and the
// plain-English gap read. Same code as the page; read-only, zero AI calls, no
// live request.
import { valuationLabFactory, VALUATION_LAB_KEY } from "../valuation-lab.mjs";

const OWNER = "owner";
const r2 = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

export function valuationTools({ fail, envelope, readKey, normSymbol }) {
  const lab = valuationLabFactory();
  const inputProps = Object.fromEntries(lab.INPUTS.map((i) => [i.key, { type: "number", minimum: i.min, maximum: i.max, description: `${i.label} (${i.unit}).` }]));
  return [{
    name: "value_stock",
    title: "Value a stock (Valuation lab)",
    audience: OWNER,
    description: "Mingstreet's Valuation lab for one covered stock: eight methods (cash flow (DCF), earnings path, peer multiples, own-history multiples, growth-adjusted P/E, rate-justified earnings power, book value plus excess returns, the street target), blended by weights, against the market price. Returns what today's price implies (growth, margin, risk premium, exit P/E, PEG), the inputs that move the answer most, a rate x growth grid, a seeded range of outcomes with the chance the stock is worth more than the price, the story (last year vs analysts vs our Earnings Forecast vs the price, what analysts may be missing, what the model may be missing) and a plain-English read of the gap. Pass `scenario` for a named environment (economy, Fed, market mood, tariffs, taxes, party in power, oil, dollar) and `inputs` / `weights` to try your own assumptions. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", maxLength: 12, description: "Covered stock ticker (ETFs are not valued)." },
        scenario: { type: "string", maxLength: 24, description: "Optional named environment applied before your inputs: base, bear, bull, rates-up, rates-down, recession, soft, stagflation, boom, deflation, cuts, higher, term, euphoria, bearmkt, credit, tariffs, tradedeal, taxcut, taxhike, dsweep, rsweep, dsplit, rsplit, oilspike, oilcrash, strongusd, weakusd. The result lists the ones this stock has." },
        inputs: { type: "object", properties: inputProps, additionalProperties: false, description: "Optional overrides of the default inputs." },
        weights: {
          type: "object",
          properties: Object.fromEntries(lab.WEIGHT_KEYS.map((k) => [k, { type: "number", minimum: 0, maximum: 100 }])),
          additionalProperties: false,
          description: "Optional method weights (dcf, earnings, peers, history, peg, power, book, street); a method you leave out keeps its default weight (set it to 0 to drop it); normalized over the methods that produce a value.",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      const sym = normSymbol(args.symbol);
      const { payload } = await readKey(ctx, VALUATION_LAB_KEY);
      const stored = payload?.rows?.[sym];
      // A backup street target from Webull stays on the Owner page only (not
      // through the MCP): the method reads "No analyst target" here instead.
      const row = stored?.street?.source === "webull-backup"
        ? { ...stored, street: { mean: null, low: null, high: null, n: null, rating: stored.street.rating ?? null } }
        : stored;
      if (!row) fail("NOT_FOUND", `${sym} has no valuation row (ETFs and names without fundamentals are left out).`);
      const def = lab.defaults(row);
      const scenarios = lab.scenarios(row);
      let start = def.inputs;
      let usedScenario = null;
      const warnings = [];
      if (args.scenario != null && args.scenario !== "") {
        const applied = lab.applyScenario(row, def.inputs, String(args.scenario));
        if (applied) { start = applied; usedScenario = String(args.scenario); }
        else warnings.push(`Unknown scenario "${String(args.scenario).slice(0, 24)}" for ${sym}; defaults used.`);
      }
      const plain = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
      const inputs = { ...start, ...plain(args.inputs), weights: { ...start.weights, ...plain(args.weights) } };
      const a = lab.analyze(row, inputs);
      const rng = a.range;
      const res = a.result;
      return envelope(ctx, {
        tool: "value_stock",
        source: { key: VALUATION_LAB_KEY, page: `/?tab=valuation-lab&symbol=${sym}` },
        payload,
        owner: true,
        warnings,
        limitations: [
          "A model on reported numbers and analyst estimates; it leaves out anything not in them. Defaults are starting points, not a forecast.",
          "The 10-year yield and every other input are from the last build unless you override them.",
          "Party scenarios use the sector's past returns under each party since 2001: history, not a forecast or a cause.",
        ],
        results: {
          symbol: sym, name: row.name, market_price: row.spot,
          modeled_value: r2(res.value), gap_pct: r2(res.gapPct), before_macro: r2(res.beforeMacro), macro_adjust_pct: r2(res.macroPct),
          methods: Object.fromEntries(lab.METHODS.map((m) => [m.key, { label: m.label, value: r2(res.methods[m.key].value), weight_share: r2(res.weightShares[m.key] ?? 0), note: res.methods[m.key].reason || null }])),
          peer_parts: (res.methods.peers.parts || []).map((p) => ({ label: p.label, value: r2(p.value) })),
          rates: Object.fromEntries(Object.entries(res.rates).map(([k, v]) => [k + "_pct", r2(v)])),
          inputs: res.inputs, input_sources: def.sources,
          implied_by_price: Object.fromEntries(Object.entries(a.implied).map(([k, v]) => [k, r2(v)])),
          top_drivers: a.drivers.slice(0, 6).map((d) => ({ input: d.key, label: d.label, step: d.step, unit: d.unit, value_low: r2(d.low), value_high: r2(d.high) })),
          rate_growth_grid: { rate_shifts_bp: a.grid.shifts, rows: a.grid.rows.map((r) => ({ g1_pct: r2(r.g1), values: r.cells.map(r2) })) },
          measured_rate_response_pct: r2(res.measuredRatePct),
          macro_parts_pct: Object.fromEntries(Object.entries(res.macroParts).map(([k, v]) => [k, r2(v)])),
          policy_factors: Object.fromEntries(Object.entries(res.policy).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v])),
          range_of_outcomes: rng ? { draws: rng.n, p10: r2(rng.p10), p25: r2(rng.p25), median: r2(rng.p50), p75: r2(rng.p75), p90: r2(rng.p90), mean: r2(rng.mean), chance_above_price_pct: r2(rng.aboveShare * 100), recession_odds_pct: rng.recessionOdds, recession_draws: rng.recessionDraws } : null,
          story: { views: a.story.views, analysts_may_be_missing: a.story.analystsMiss, model_may_be_missing: a.story.modelMiss, usual_surprise_pct: a.story.beat, stats: row.story || null },
          scenario: usedScenario,
          scenarios: scenarios.map((x) => ({ id: x.id, group: x.group, label: x.label, note: x.note })),
          options_range_1y: row.optionsRange || null,
          read: a.explain,
          peers: row.peers, street: row.street, context: row.context,
        },
      });
    },
  }];
}
