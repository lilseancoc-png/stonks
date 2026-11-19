// Job: Webull as a backup source (build E). After the close: each covered
// stock's earnings calendar (every day), analyst rating counts and price
// target (a fifth of the names each day, so every name refreshes weekly),
// Webull's Fear & Greed reading and the US economic calendar for the next 30
// days. Owner key webull-backup.json. Switch WEBULL_BACKUPS.
import { BACKUP_KEY, parseEarningsCalendar, parseRating, parseTarget, parseFearGreed, parseEconPage, applyBackupRecord, emptyBackupFile } from "../backup.mjs";
import { FUND_SYMBOLS, isRefusal, refusalReason, readKey, writeKey, planOnce, count } from "./w3-shared.mjs";

export const PATHS = Object.freeze({
  earn: "/market-data/fundamentals/earnings-calendars/list",
  rating: "/market-data/fundamentals/analysis/ratings/get",
  target: "/market-data/fundamentals/analysis/target-prices/get",
  fg: "/market-data/screeners/fear-greed-indexes/get",
  econ: "/market-data/fundamentals/economic-calendars/list",
});
export const ROTATION = 5;

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// The day's slice of names for the weekly rotation (stable by name order).
export function rotationSlice(names, date, parts = ROTATION) {
  const day = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86400000);
  const k = ((day % parts) + parts) % parts;
  return names.filter((_, i) => i % parts === k);
}

export default {
  id: "webull-backup",
  switchKey: "WEBULL_BACKUPS",
  group: "fundamentals",
  plan(state, ctx) {
    if (!planOnce(state, ctx)) return [];
    const stocks = (Array.isArray(ctx?.tickers) ? ctx.tickers : []).map((s) => String(s).toUpperCase()).filter((s) => !FUND_SYMBOLS.includes(s));
    const slice = rotationSlice(stocks, ctx.date);
    return [
      { k: "fg", group: "screeners" },
      { k: "econ", first: true, from: ctx.date, to: addDays(ctx.date, 30), page: 0 },
      ...stocks.map((sym) => ({ k: "earn", sym })),
      ...slice.map((sym) => ({ k: "rating", sym })),
      ...slice.map((sym) => ({ k: "target", sym })),
    ];
  },
  async run(item, client, ctx) {
    try {
      if (item.k === "earn") {
        const v = parseEarningsCalendar(await client.get(PATHS.earn, { symbol: item.sym, category: "US_STOCK" }), ctx?.date);
        return v.quarters.length ? [{ kind: "earnings", sym: item.sym, value: v }] : [{ kind: "miss", part: "earnings", sym: item.sym, reason: "EMPTY" }];
      }
      if (item.k === "rating") {
        const v = parseRating(await client.get(PATHS.rating, { symbol: item.sym, category: "US_STOCK" }));
        return v ? [{ kind: "rating", sym: item.sym, value: v }] : [{ kind: "miss", part: "rating", sym: item.sym, reason: "EMPTY" }];
      }
      if (item.k === "target") {
        const v = parseTarget(await client.get(PATHS.target, { symbol: item.sym, category: "US_STOCK" }));
        return v ? [{ kind: "target", sym: item.sym, value: v }] : [{ kind: "miss", part: "target", sym: item.sym, reason: "EMPTY" }];
      }
      if (item.k === "fg") {
        const points = parseFearGreed(await client.get(PATHS.fg, {}));
        return points.length ? [{ kind: "fearGreed", points }] : [{ kind: "miss", part: "fear-greed", reason: "EMPTY" }];
      }
      if (item.k === "econ") {
        const q = { region: "US", start_date: item.from, end_date: item.to };
        if (item.key) q.pagination_key = item.key;
        const p = parseEconPage(await client.get(PATHS.econ, q));
        const follow = p.next && item.page < 30;
        return {
          records: [{ kind: "econ", first: !!item.first, from: item.from, to: item.to, events: p.events, last: !p.next }],
          more: follow ? [{ k: "econ", from: item.from, to: item.to, page: item.page + 1, key: p.next }] : [],
        };
      }
      return [];
    } catch (err) {
      if (isRefusal(err)) return [{ kind: "miss", part: item.k, sym: item.sym || null, reason: refusalReason(err) }];
      throw err;
    }
  },
  async save(records, store, ctx) {
    if (!records?.length) return;
    const nowIso = new Date(ctx?.nowMs || Date.now()).toISOString();
    const file = await readKey(store, BACKUP_KEY, emptyBackupFile);
    for (const r of records) applyBackupRecord(file, r, { nowIso });
    await writeKey(store, BACKUP_KEY, file);
    count(ctx, "backup-records", records.length);
  },
};
