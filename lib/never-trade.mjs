// The never-trade list (2026-11-23, owner: "VIX should not be traded at all
// but should be used as a market gauge", then "Same for USO").
//
// A hard block in code. Top Picks, every strategy engine (paper trials, core
// engines and shadow trades included) and the Webull paper mirror never open
// a trade on these names, and an open trade on one closes at the next
// decision run as "never-trade". No Owner Settings switch, Owner control,
// repo variable or Vercel value turns it off or shortens it: changing the
// list is a code change. The Owner Settings page and the Owner controls card
// show it read-only.
//
// Reading these names as gauges is untouched: their prices, VIX and its
// curve, the VIX pause, the bounce skip, the VIX-rollover trial (it buys
// QQQ), the UVXY market tile, Rotation's fund ranking and the heat maps all
// keep reading them. Only buying and holding them is blocked.
//
// Why each one: a VIX product holds VIX futures, which cost money to roll
// (contango) while VIX itself drifts back to its average after every spike,
// so a long position decays and a short one can lose many times its value in
// one day. USO holds front-month oil futures and pays the same roll cost.
// ES5-safe and self-contained (no imports), so a browser page can embed it.

export const NEVER_TRADE_VERSION = "2026-11-23";

const VIX = "Volatility (VIX) product: VIX snaps back to its average and the futures roll eats the fund; read as a market gauge only";
const OIL = "Oil futures fund: the monthly futures roll costs money in a normal oil market; read as an oil gauge only";

// [symbol, group, reason]. VIX, ^VIX and VIXW stand for the index and its
// options (an engine or broker order on the index symbol is refused too).
export const NEVER_TRADE = Object.freeze([
  ["VIX", "Volatility", VIX], ["^VIX", "Volatility", VIX], ["VIXW", "Volatility", VIX],
  ["UVXY", "Volatility", VIX], ["UVIX", "Volatility", VIX], ["VIXY", "Volatility", VIX],
  ["VXX", "Volatility", VIX], ["VIXM", "Volatility", VIX], ["VXZ", "Volatility", VIX],
  ["SVXY", "Volatility", VIX], ["SVIX", "Volatility", VIX],
  ["USO", "Oil futures", OIL],
].map(function (r) { return Object.freeze({ sym: r[0], group: r[1], why: r[2] }); }));

const SET = new Set(NEVER_TRADE.map(function (r) { return r.sym; }));

// Shares only (owner review, 2026-11-24; MRNA and SPCX keep options):
// names the engines may trade as stock but never through options. Engines buy shares on a call signal and
// skip a put (they never short); Top Picks, which buys options only, leaves
// them out; the Webull mirror refuses an option order on one.
export const SHARES_ONLY = Object.freeze([
  ["DRAM", "Memory-chip fund (Roundhill, part swaps, under a year old) that the engines would otherwise read as a company; swings over 100% a year"],
  ["KWEB", "China internet fund: its home market trades while ours is shut, so it gaps overnight"],
  ["EWY", "Korea fund: its home market trades while ours is shut, so it gaps overnight"],
].map(function (r) { return Object.freeze({ sym: r[0], why: r[1] }); }));
const SHARES_SET = new Set(SHARES_ONLY.map(function (r) { return r.sym; }));
export function isSharesOnly(sym) { return SHARES_SET.has(rootOf(sym)); }
export function sharesOnlyNote(sym) { return rootOf(sym) + " is shares only (no options)"; }

// Option symbols (OCC "UVXY  261218C00020000" or "UVXY261218C00020000")
// resolve to their underlying; anything else is upper-cased as given.
function rootOf(sym) {
  var s = String(sym == null ? "" : sym).trim().toUpperCase();
  var m = /^(\^?[A-Z.]{1,6})\s*\d{6}[CP]\d{8}$/.exec(s);
  return m ? m[1] : s;
}

export function isNeverTrade(sym) {
  return SET.has(rootOf(sym));
}

export function neverTradeReason(sym) {
  var s = rootOf(sym);
  for (var i = 0; i < NEVER_TRADE.length; i++) if (NEVER_TRADE[i].sym === s) return NEVER_TRADE[i].why;
  return null;
}

// One line for logs, skip notes and the mirror ("Not bought: ...").
export function neverTradeNote(sym) {
  return rootOf(sym) + " is on the never-trade list (read as a gauge only)";
}

// The read-only view for Owner Settings, the Owner controls card and the MCP.
export function neverTradeView() {
  return {
    version: NEVER_TRADE_VERSION,
    note: "Hard block in code: Top Picks, every engine and the Webull paper mirror never trade these names, and no setting turns it off. Their prices are still read as market gauges.",
    list: NEVER_TRADE.map(function (r) { return { sym: r.sym, group: r.group, why: r.why }; }),
    sharesOnly: SHARES_ONLY.map(function (r) { return { sym: r.sym, why: r.why }; }),
  };
}
