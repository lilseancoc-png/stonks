// Saving an expired (or about to roll off) option contract's whole life of
// daily bars, shared by the expiry saver and the first run's backfill.
// Webull answers 417 INVALID_SYMBOL for a contract whose history it has
// deleted (about a week after expiry) or one that never listed; a batch with
// one such symbol is split in two and retried, down to single symbols.
import { OPTION_BARS_PATH, BARS_COUNT, barsBySymbol, parseOcc, isInvalidSymbol } from "./options.mjs";
import { webullDataKeys, writeGz } from "./store.mjs";

export async function runBars(item, client) {
  const symbols = item.symbols || [];
  if (!symbols.length) return { records: null };
  let body;
  try {
    body = await client.get(OPTION_BARS_PATH, { category: "US_OPTION", symbols: symbols.join(","), timespan: "D", count: String(BARS_COUNT) });
  } catch (err) {
    if (!isInvalidSymbol(err)) throw err;
    if (symbols.length > 1) return { records: null, more: halves(item) };
    return { records: { kind: "bars", gone: symbols, item } };
  }
  const by = barsBySymbol(body);
  // If the 1,200-bar cap is shared by the batch and was reached, a contract's
  // early life may be cut: ask again in halves.
  const total = [...by.values()].reduce((a, x) => a + x.bars.length, 0);
  if (symbols.length > 1 && total >= BARS_COUNT) return { records: null, more: halves(item) };
  return { records: { kind: "bars", by, item, missing: symbols.filter((s) => !by.has(s)) } };
}

function halves(item) {
  const s = item.symbols, mid = Math.ceil(s.length / 2);
  return [{ ...item, symbols: s.slice(0, mid), attempts: 0 }, { ...item, symbols: s.slice(mid), attempts: 0 }];
}

// Writes one object per contract. Returns { saved, gone } symbol lists.
export async function saveBars(records, store, ctx) {
  const out = { saved: [], gone: [] };
  if (!records || records.kind !== "bars") return out;
  for (const sym of records.gone || []) out.gone.push(sym);
  const writes = [];
  for (const [sym, x] of records.by || []) {
    const occ = parseOcc(sym);
    if (!occ) continue;
    if (!x.bars.length) { out.gone.push(sym); continue; }
    const doc = { v: 1, symbol: sym, underlying: occ.root, expiry: occ.expiry, strike: occ.strike, right: occ.right,
      savedAtIso: new Date(ctx.nowMs).toISOString(), savedOn: ctx.date, delay_min: x.delay_min, instrument_id: x.instrument_id,
      first: x.bars[0].date, last: x.bars[x.bars.length - 1].date, bars: x.bars, source: "webull-bars" };
    writes.push(writeGz(store, webullDataKeys.expired(occ.expiry, sym), doc).then((bytes) => { out.saved.push(sym); ctx.count("bytes", bytes); }));
  }
  await Promise.all(writes);
  // A symbol Webull did not return at all is not counted gone: it is asked
  // again on a later day while it is still inside the saving window.
  ctx.count("expired-saved", out.saved.length);
  ctx.count("expired-gone", out.gone.length);
  return out;
}
