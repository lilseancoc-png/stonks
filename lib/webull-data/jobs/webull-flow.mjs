// Job: Webull capital flow log (build C). One call per covered name per day
// after the close: GET /market-data/fundamentals/capital-flows/get
// (symbol, category=US_STOCK, count=5; docs:
// https://developer.webull.com/apis/docs/reference/capital-flow.md). The last
// five sessions are upserted by date into the Owner key webull-flow.json, so a
// missed day is filled by the next run. Switch WEBULL_FLOW_LOG.
import { FLOW_KEY, parseCapitalFlow, mergeFlow, noteFlowMiss, emptyFlowFile } from "../flow.mjs";
import { isRefusal, refusalReason, readKey, writeKey, planOnce, count } from "./w3-shared.mjs";

export const FLOW_PATH = "/market-data/fundamentals/capital-flows/get";

export default {
  id: "webull-flow",
  switchKey: "WEBULL_FLOW_LOG",
  group: "capital-flow",
  plan(state, ctx) {
    if (!planOnce(state, ctx)) return [];
    return (Array.isArray(ctx?.tickers) ? ctx.tickers : []).map((sym) => ({ sym: String(sym).toUpperCase() }));
  },
  async run(item, client) {
    try {
      const json = await client.get(FLOW_PATH, { symbol: item.sym, category: "US_STOCK", count: "5" });
      return [{ kind: "rows", sym: item.sym, rows: parseCapitalFlow(json) }];
    } catch (err) {
      if (isRefusal(err)) return [{ kind: "miss", sym: item.sym, reason: refusalReason(err) }];
      throw err;
    }
  },
  async save(records, store, ctx) {
    if (!records?.length) return;
    const nowIso = new Date(ctx?.nowMs || Date.now()).toISOString();
    const file = await readKey(store, FLOW_KEY, emptyFlowFile);
    let rows = 0, misses = 0;
    for (const r of records) {
      if (r?.kind === "rows" && r.rows?.length) { mergeFlow(file, r.sym, r.rows, { nowIso }); rows += 1; }
      else if (r?.kind === "miss" || (r?.kind === "rows" && !r.rows?.length)) { noteFlowMiss(file, r.sym, r.reason || "empty", nowIso); misses += 1; }
    }
    await writeKey(store, FLOW_KEY, file);
    count(ctx, "flow-names", rows);
    if (misses) count(ctx, "flow-misses", misses);
  },
};
