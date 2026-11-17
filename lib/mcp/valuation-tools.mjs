// lib/mcp/valuation-tools.mjs — the Valuation lab on the Mingstreet MCP.
//
// value_stock (Owner): one stock's modeled value from the five methods on
// valuation-lab.json (lib/valuation-lab.mjs), with any inputs the caller
// overrides, what today's price implies, the inputs that move the answer most
// and the plain-English gap read. Same code as the page; read-only, zero AI
// calls, no live request.
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
    description: "Mingstreet's Valuation lab for one covered stock: cash flow (DCF), earnings path, peer multiples, rate-justified earnings power and the street target, blended by weights, against the market price, with what today's price implies (growth, margin, risk premium, exit P/E), the inputs that move the answer most, a rate x growth grid and a plain-English read of the gap. Pass `inputs` and `weights` to try your own assumptions. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", maxLength: 12, description: "Covered stock ticker (ETFs are not valued)." },
        inputs: { type: "object", properties: inputProps, additionalProperties: false, description: "Optional overrides of the default inputs." },
        weights: {
          type: "object",
          properties: Object.fromEntries(lab.WEIGHT_KEYS.map((k) => [k, { type: "number", minimum: 0, maximum: 100 }])),
          additionalProperties: false,
          description: "Optional method weights (dcf, earnings, peers, power, street); normalized over the methods that produce a value.",
        },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      const sym = normSymbol(args.symbol);
      const { payload } = await readKey(ctx, VALUATION_LAB_KEY);
      const row = payload?.rows?.[sym];
      if (!row) fail("NOT_FOUND", `${sym} has no valuation row (ETFs and names without fundamentals are left out).`);
      const def = lab.defaults(row);
      const inputs = { ...def.inputs, ...(args.inputs || {}), weights: { ...def.inputs.weights, ...(args.weights || {}) } };
      const a = lab.analyze(row, inputs);
      const res = a.result;
      return envelope(ctx, {
        tool: "value_stock",
        source: { key: VALUATION_LAB_KEY, page: `/?tab=valuation-lab&symbol=${sym}` },
        payload,
        owner: true,
        warnings: [],
        limitations: [
          "A model on reported numbers and analyst estimates; it leaves out anything not in them. Defaults are starting points, not a forecast.",
          "The 10-year yield and every other input are from the last build unless you override them.",
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
          read: a.explain,
          peers: row.peers, street: row.street, context: row.context,
        },
      });
    },
  }];
}
