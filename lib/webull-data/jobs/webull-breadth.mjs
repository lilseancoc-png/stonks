// Job: Webull whole-market breadth log (build D). After the close: the market
// sectors list (advancers / decliners / flat per sector), every sector's
// detail pages (each stock's change, bucketed for the breadth chart), and the
// seven screener lists (gainers, losers, most active, new and near 52-week
// highs and lows). One Webull call per item; pages follow as `more` items.
// Owner key webull-breadth.json. Switch WEBULL_BREADTH_LOG.
//
// WEBULL_BREADTH_PAGES (default 40) caps the detail pages read per sector; a
// sector cut short leaves the day's buckets marked incomplete (shown, and
// never logged as a shadow gauge).
import { BREADTH_KEY, LISTS, SECTORS_PATH, SECTOR_DETAIL_PATH, parseSectors, parseSectorPage, parseList, applyBreadthRecord, emptyBreadthFile } from "../breadth.mjs";
import { isRefusal, refusalReason, readKey, writeKey, planOnce, count } from "./w3-shared.mjs";

export function pagesPerSector(env = process.env) {
  const n = Number(env.WEBULL_BREADTH_PAGES);
  return Number.isFinite(n) && n >= 0 ? Math.min(200, Math.floor(n)) : 40;
}

export default {
  id: "webull-breadth",
  switchKey: "WEBULL_BREADTH_LOG",
  group: "screeners",
  plan(state, ctx) {
    if (!planOnce(state, ctx)) return [];
    return [{ k: "sectors", page: 0 }, ...Object.keys(LISTS).map((list) => ({ k: "list", list }))];
  },
  async run(item, client, ctx) {
    const date = ctx?.date;
    try {
      if (item.k === "sectors") {
        const q = { category: "US_STOCK", period: "D1" };
        if (item.key) q.pagination_key = item.key;
        const { sectors, next } = parseSectors(await client.get(SECTORS_PATH, q));
        const more = pagesPerSector() > 0 ? sectors.map((s) => ({ k: "detail", id: s.id, page: 0 })) : [];
        if (next && item.page < 20) more.push({ k: "sectors", page: item.page + 1, key: next });
        return { records: [{ kind: "sectors", date, sectors }], more };
      }
      if (item.k === "detail") {
        const q = { sector_id: item.id, category: "US_STOCK", period: "D1", sort_by: "CHANGE_RATIO", direction: "DESC" };
        if (item.key) q.pagination_key = item.key;
        const p = parseSectorPage(await client.get(SECTOR_DETAIL_PATH, q));
        const canFollow = p.next && p.rows > 0 && item.page + 1 < pagesPerSector();
        return {
          records: [{ kind: "sector-page", date, sectorId: item.id, page: item.page, counts: p.counts, n: p.n, last: !p.next }],
          more: canFollow ? [{ k: "detail", id: item.id, page: item.page + 1, key: p.next }] : [],
        };
      }
      if (item.k === "list" && LISTS[item.list]) {
        const def = LISTS[item.list];
        const l = parseList(await client.get(def.path, { ...def.query }));
        return [{ kind: "list", date, list: item.list, n: l.n, capped: l.capped, rows: l.rows }];
      }
      return [];
    } catch (err) {
      if (isRefusal(err)) return [{ kind: "error", date, part: item.k === "list" ? item.list : item.k, reason: refusalReason(err) }];
      throw err;
    }
  },
  async save(records, store, ctx) {
    if (!records?.length) return;
    const nowIso = new Date(ctx?.nowMs || Date.now()).toISOString();
    const file = await readKey(store, BREADTH_KEY, emptyBreadthFile);
    for (const r of records) applyBreadthRecord(file, r, { nowIso });
    await writeKey(store, BREADTH_KEY, file);
    count(ctx, "breadth-records", records.length);
  },
};
