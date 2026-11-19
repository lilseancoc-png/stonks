// Expiry saver (build B, the time-sensitive part; 2026-11-19).
//
// Webull deletes an expired contract's bars about a week after expiry (the
// 2026-11-19 probe: a weekly 6 days past still answered with all 32 daily
// bars; every contract 13+ days past returned INVALID_SYMBOL). So each day,
// for every registry contract that expired 1 to 5 sessions ago and is not
// saved yet, fetch its full daily bar history (1,200 bars per call, 20
// contracts per call) and save it once, one object per contract. The oldest
// expiry goes first (closest to deletion), at the money first within it.
import { SNAPSHOT_BATCH, DEFAULTS, chunk } from "../options.mjs";
import { runBars, saveBars } from "../bars.mjs";
import { webullDataKeys, readGz } from "../store.mjs";
import { previousTradingDate } from "../../us-equity-calendar.mjs";

// The session dates 1..n sessions before `date`, oldest first.
export function expiryWindow(date, n = DEFAULTS.expirySessions) {
  const out = [];
  let d = date;
  for (let i = 0; i < n; i++) { d = previousTradingDate(d); if (!d) break; out.push(d); }
  return out.reverse();
}

const job = {
  id: "option-expiry",
  switchKey: "WEBULL_OPTION_SAVER",
  group: "option-bars",

  async plan(state, ctx) {
    const key = `${ctx.date}:${ctx.phase}`;
    if (state.dayKey === key) return [];
    state.dayKey = key;
    state.gone = Object.fromEntries(Object.entries(state.gone || {}).filter(([e]) => e >= (expiryWindow(ctx.date, 10)[0] || "")));
    const n = Number(ctx.options?.expirySessions) >= 1 && Number(ctx.options.expirySessions) <= 6 ? Number(ctx.options.expirySessions) : DEFAULTS.expirySessions;
    const items = [];
    for (const expiry of expiryWindow(ctx.date, n)) {
      const reg = await readGz(ctx.store, webullDataKeys.registry(expiry)).catch(() => null);
      const contracts = Object.entries(reg?.contracts || {});
      if (!contracts.length) continue;
      const saved = new Set((await ctx.store.rawList(webullDataKeys.expiredDay(expiry)).catch(() => [])).map((o) => String(o.key).split("/").pop().replace(/\.json\.gz$/, "")));
      const gone = new Set(state.gone[expiry] || []);
      const todo = contracts.filter(([occ]) => !saved.has(occ) && !gone.has(occ))
        .sort((a, b) => (a[1]?.m ?? 9) - (b[1]?.m ?? 9) || a[0].localeCompare(b[0])).map(([occ]) => occ);
      ctx.count("expired-due", todo.length);
      ctx.count("expired-already", saved.size);
      for (const symbols of chunk(todo, SNAPSHOT_BATCH)) items.push({ kind: "bars", expiry, symbols });
    }
    return items;
  },

  run: (item, client) => runBars(item, client),

  async save(records, store, ctx) {
    const { gone } = await saveBars(records, store, ctx);
    if (gone.length && records?.item?.expiry) {
      const g = ctx.state.gone || (ctx.state.gone = {});
      g[records.item.expiry] = [...new Set([...(g[records.item.expiry] || []), ...gone])];
    }
    return null;
  },
};

export default job;
