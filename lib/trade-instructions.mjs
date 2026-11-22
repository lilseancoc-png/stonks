// Structured trade instructions for an outside agent (2026-11-22).
//
// The same Top Picks opens and closes as the plain-text trade lines
// (lib/pick-trade-text.mjs), as fields an AI app holding a broker connector
// (ChatGPT or Claude with Robinhood's Trading MCP) can act on without reading
// prose: the exact contract and its OCC symbol, the action, one contract, a
// limit range around Mingstreet's price, the time an OPEN stops being valid,
// whether the feed itself is current, and whether the agent may place it at
// all (`agent_placeable`, with `blocked_by` codes). Every value is a number,
// a date or a fixed code; there is no free text to misread.
//
// Read by the Owner MCP tool `get_trade_instructions` (lib/mcp/tools.mjs) and
// the private picks feed's `?format=json` (api/auth/[action].js). Top Picks
// only: the strategy engines' trades are not here.
//
// Pure: no network, no clock reads (callers pass `nowMs`), no AI. Places
// nothing; the broker and the person stay the authority.

import { entryPrice, markPrice, pickTradeId, daysToExpiry } from "./pick-trade-text.mjs";
import { occSymbol } from "./webull-contracts.mjs";
import { etClock, sessionForDate } from "./us-equity-calendar.mjs";
import { slotsForDate } from "./top-picks-watchdog.mjs";

export const TRADE_INSTRUCTIONS_VERSION = 1;
// How far past Mingstreet's price a limit may go: the Webull paper mirror's
// highest entry ceiling (its 2% / 4% ladder ends at a 5% end-of-day try,
// lib/webull-execution-policy.mjs). Above it on an OPEN, skip the trade.
export const ALLOWANCE_PCT = 5;
// The run is late once its slot is this far behind with no new record stamp
// (the same 45 minutes as the site's run-health note).
export const RUN_DUE_MIN = 45;
// A run stamps the record as it starts, a few seconds after its slot.
const STAMP_SLACK_MS = 2 * 60 * 1000;
// An OPEN this close to expiry is not worth entering.
export const MIN_ENTRY_DTE = 3;
// A held contract this close to expiry gets an expiry warning.
export const EXPIRY_WARN_DAYS = 5;
export const QUANTITY = 1;

// Reasons an instruction is not for the agent to place, in a fixed order.
export const BLOCK_CODES = Object.freeze([
  "multi_leg", // a spread: broker agents can't place multi-leg option orders
  "expired", // the contract is past its expiration
  "expires_soon", // an OPEN within MIN_ENTRY_DTE days of expiry
  "act_by_passed", // the OPEN's session has closed
  "session_unknown", // the entry date has no known trading session
  "feed_stale", // the latest Top Picks run never published
  "run_in_progress", // a Top Picks run is due and may change this list
  "new_trades_stopped", // the Owner's Stop new trades is on
  "owner_closing", // the Owner put the stock on Avoid and its trades close next run
  "owner_avoid", // the Owner put the stock on Avoid
  "no_price", // Mingstreet has no usable price for it
]);

// Fixed rules every caller should follow, as codes.
export const RULES = Object.freeze([
  "limit_orders_only",
  "open_each_trade_id_once",
  "close_only_if_held",
  "preview_with_broker_before_placing",
  "skip_open_if_ask_above_worst",
]);

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));

// A price step valid on every US option, in and out of the penny program:
// $0.05 under $3, $0.10 at $3 and up.
export const TICK_RULE = "0.05_under_3_else_0.10";
const tickAt = (p) => (p >= 3 ? 0.1 : 0.05);
export function floorTick(x) {
  const p = num(x);
  if (p == null || !(p > 0)) return null;
  const t = tickAt(p);
  const out = Math.floor((p + 1e-9) / t) * t;
  return out > 0 ? r2(out) : null;
}
export function ceilTick(x) {
  const p = num(x);
  if (p == null || !(p > 0)) return null;
  const t = tickAt(p);
  return r2(Math.ceil((p - 1e-9) / t) * t);
}

function ymd(expirySec) {
  const n = num(expirySec);
  if (n == null) return null;
  const d = new Date(n * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// The UTC ms of an ET wall-clock minute on an ET date (EDT or EST).
export function etMinuteMs(date, minute) {
  const base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  for (const off of [4, 5]) {
    const ms = base + (minute + off * 60) * 60000;
    const c = etClock(ms);
    if (c.date === date && c.minute === minute) return ms;
  }
  return null;
}

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// Is the record current? Looks at the latest Top Picks slot that has started
// (11:00 / 15:30 ET on trading days; no 15:30 on a 13:00 early close):
//   fresh            the record was stamped at or after that slot
//   run_in_progress  not yet, and the slot is under RUN_DUE_MIN old
//   missed           not yet, and the slot is older than that (stale)
//   unknown          no stamp, or a date outside the known calendar (stale)
export function feedStatus(builtAtIso, nowMs) {
  const last = Date.parse(builtAtIso || "");
  const today = etClock(nowMs).date;
  const out = { status: "unknown", stale: true, last_slot: null, last_slot_date: null, check_again_at: null, next_run_at: nextRunAt(nowMs) };
  if (!Number.isFinite(last)) return out;
  for (let back = 0; back < 12; back++) {
    const date = addDays(today, -back);
    if (!sessionForDate(date)) return out;
    const slots = slotsForDate(date);
    for (let i = slots.length - 1; i >= 0; i--) {
      const start = etMinuteMs(date, slots[i].minute);
      if (start == null) return out;
      if (start > nowMs) continue;
      out.last_slot = slots[i].key;
      out.last_slot_date = date;
      const due = start + RUN_DUE_MIN * 60000;
      if (last >= start - STAMP_SLACK_MS) return { ...out, status: "fresh", stale: false };
      if (nowMs < due) return { ...out, status: "run_in_progress", stale: false, check_again_at: iso(Math.min(nowMs + 5 * 60000, due)) };
      return { ...out, status: "missed", stale: true };
    }
  }
  return out;
}

// The next Top Picks slot after now, or null past the known calendar.
export function nextRunAt(nowMs) {
  const today = etClock(nowMs).date;
  for (let ahead = 0; ahead < 12; ahead++) {
    const date = addDays(today, ahead);
    if (!sessionForDate(date)) return null;
    for (const slot of slotsForDate(date)) {
      const start = etMinuteMs(date, slot.minute);
      if (start != null && start > nowMs) return iso(start);
    }
  }
  return null;
}

// The close of the trading session an OPEN was made in (16:00 ET, or 13:00
// on an early close). null when that date is not a known trading session.
export function sessionCloseMs(entryIso) {
  const ms = Date.parse(entryIso || "");
  if (!Number.isFinite(ms)) return null;
  const date = etClock(ms).date;
  const s = sessionForDate(date);
  if (!s || !s.open) return null;
  return etMinuteMs(date, s.closeMinute);
}

// Legs in opening direction: a single is one bought leg; a debit vertical
// buys the long strike and sells the short; a credit vertical sells the short
// strike and buys the long (protection) strike.
function legsOf(e) {
  const c = e?.contract || {};
  const type = (c.optionType || e?.side) === "put" ? "put" : "call";
  const expiry = ymd(c.expiry);
  const leg = (side, strike) => ({ side, option_type: type, expiry, strike: num(strike), occ_symbol: occSymbol(e.symbol, expiry, type, strike) });
  if (c.structure === "debit_vertical") return [leg("buy", c.longStrike), leg("sell", c.shortStrike)];
  if (c.structure === "credit_vertical") return [leg("sell", c.shortStrike), leg("buy", c.longStrike)];
  return [leg("buy", c.strike)];
}

// The limit range around Mingstreet's per-share price. A buy starts at the
// price (rounded down to a valid step) and may go up to ALLOWANCE_PCT over
// it; a sell starts at the price (rounded up) and may go down as far.
function priceBlock(engine, buying) {
  const p = num(engine);
  if (p == null || !(p > 0)) return null;
  const start = buying ? floorTick(p) : ceilTick(p);
  let worst = buying ? floorTick(p * (1 + ALLOWANCE_PCT / 100)) : ceilTick(p * (1 - ALLOWANCE_PCT / 100));
  if (start == null || worst == null) return null;
  if (buying ? worst < start : worst > start) worst = start;
  return { engine: r2(p), start, worst, worst_is: buying ? "max" : "min", allowance_pct: ALLOWANCE_PCT, per_contract_usd: Math.round(p * 100) };
}

function structureOf(e) {
  const s = e?.contract?.structure;
  return s === "debit_vertical" || s === "credit_vertical" ? s : "single";
}

function base(e, kind) {
  const c = e.contract || {};
  const structure = structureOf(e);
  const legs = legsOf(e);
  return {
    kind,
    trade_id: pickTradeId(e),
    symbol: e.symbol,
    side: e.side === "put" ? "put" : "call",
    structure,
    option_type: legs[0].option_type,
    expiry: legs[0].expiry,
    strike: structure === "single" ? num(c.strike) : null,
    long_strike: structure === "single" ? null : num(c.longStrike),
    short_strike: structure === "single" ? null : num(c.shortStrike),
    occ_symbol: structure === "single" ? legs[0].occ_symbol : null,
    legs,
    quantity: QUANTITY,
  };
}

const sortBlocks = (set) => BLOCK_CODES.filter((b) => set.has(b));

// One held trade as an OPEN instruction.
export function openInstruction(e, { nowMs, feed, controls = null } = {}) {
  const out = base(e, "OPEN");
  const credit = out.structure === "credit_vertical";
  const blocked = new Set();
  const dte = daysToExpiry(e.contract?.expiry, nowMs);
  const actBy = sessionCloseMs(e.entryDate);
  const price = priceBlock(entryPrice(e), !credit);
  if (out.structure !== "single") blocked.add("multi_leg");
  if (dte != null && dte < 0) blocked.add("expired");
  else if (dte != null && dte < MIN_ENTRY_DTE) blocked.add("expires_soon");
  if (actBy == null) blocked.add("session_unknown");
  else if (nowMs >= actBy) blocked.add("act_by_passed");
  if (feed?.status === "run_in_progress") blocked.add("run_in_progress");
  else if (feed?.stale) blocked.add("feed_stale");
  if (controls?.stop) blocked.add("new_trades_stopped");
  if (Array.isArray(controls?.close) && controls.close.includes(e.symbol)) blocked.add("owner_closing");
  else if (Array.isArray(controls?.avoid) && controls.avoid.includes(e.symbol)) blocked.add("owner_avoid");
  if (!price || out.legs.some((l) => !l.occ_symbol)) blocked.add("no_price");
  const mark = markPrice(e);
  const pnl = num(e.markPnlPct ?? e.optionPnlPct);
  return {
    ...out,
    action: credit ? "sell_to_open" : "buy_to_open",
    order_type: "limit",
    time_in_force: "day",
    price,
    if_unfilled: "skip",
    opened_at: e.entryDate || null,
    act_by: iso(actBy),
    days_to_expiry: dte,
    expiry_warning: dte != null && dte >= 0 && dte <= EXPIRY_WARN_DAYS ? "sell_before_close_on_expiry" : null,
    model_mark: r2(mark),
    model_pnl_pct: pnl == null ? null : Number(pnl.toFixed(1)),
    agent_placeable: blocked.size === 0,
    blocked_by: sortBlocks(blocked),
  };
}

// One recent close as a CLOSE instruction. A close never goes stale while it
// is listed: if the position is still held, it should be closed.
export function closeInstruction(e, { nowMs } = {}) {
  const out = base(e, "CLOSE");
  const credit = out.structure === "credit_vertical";
  const blocked = new Set();
  const dte = daysToExpiry(e.contract?.expiry, nowMs);
  const expired = e.status === "expired" || (dte != null && dte < 0);
  if (out.structure !== "single") blocked.add("multi_leg");
  if (expired) blocked.add("expired");
  if (out.legs.some((l) => !l.occ_symbol)) blocked.add("no_price");
  const pnl = num(e.markPnlPct ?? e.optionPnlPct);
  return {
    ...out,
    action: expired ? "none" : credit ? "buy_to_close" : "sell_to_close",
    order_type: expired ? null : "limit",
    time_in_force: expired ? null : "day",
    // No usable model price still closes: start at the mid, then the bid.
    price: expired ? null : priceBlock(markPrice(e), credit),
    if_unfilled: expired ? null : credit ? "raise_to_ask_before_close" : "lower_to_bid_before_close",
    reason: e.status || "closed",
    opened_at: e.entryDate || null,
    closed_at: e.exitDate || null,
    act_by: null,
    days_to_expiry: dte,
    model_pnl_pct: pnl == null ? null : Number(pnl.toFixed(1)),
    agent_placeable: blocked.size === 0,
    blocked_by: sortBlocks(blocked),
  };
}

const byDesc = (k) => (a, b) => (Date.parse(b?.[k]) || 0) - (Date.parse(a?.[k]) || 0);

// The whole answer. `acc` is picks-accuracy.json; `controls` the Owner
// controls in force ({ stop, avoid: [...], close: [...] }, or null).
//   kind: "all" (default), "open" or "close"
//   since: an ISO time; only instructions opened (OPEN) or closed (CLOSE)
//          after it
//   placeableOnly: drop the ones the agent may not place
// Closes come first (newest first), then opens (newest first).
export function buildTradeInstructions(acc, { nowMs, closeDays = 7, controls = null, kind = "all", since = null, placeableOnly = false } = {}) {
  if (!Number.isFinite(nowMs)) throw new Error("nowMs is required");
  const feed = feedStatus(acc?.builtAtIso, nowMs);
  const sinceMs = since == null ? null : Date.parse(since);
  if (since != null && !Number.isFinite(sinceMs)) throw new Error("since must be an ISO time");
  const after = (t) => sinceMs == null || (Date.parse(t || "") || 0) > sinceMs;
  const open = (Array.isArray(acc?.open) ? acc.open : []).filter((e) => e && e.contract && e.symbol).sort(byDesc("entryDate"));
  const cutoff = nowMs - closeDays * 86400000;
  const closed = (Array.isArray(acc?.closed) ? acc.closed : [])
    .filter((e) => e && e.contract && e.symbol && (Date.parse(e.exitDate) || 0) >= cutoff)
    .sort(byDesc("exitDate"));
  const ctl = controls && typeof controls === "object" ? { stop: !!controls.stop, avoid: Array.isArray(controls.avoid) ? controls.avoid : [], close: Array.isArray(controls.close) ? controls.close : [] } : null;
  let list = [
    ...(kind === "open" ? [] : closed.filter((e) => after(e.exitDate)).map((e) => closeInstruction(e, { nowMs }))),
    ...(kind === "close" ? [] : open.filter((e) => after(e.entryDate)).map((e) => openInstruction(e, { nowMs, feed, controls: ctl }))),
  ];
  const total = list.length;
  if (placeableOnly) list = list.filter((x) => x.agent_placeable);
  return {
    version: TRADE_INSTRUCTIONS_VERSION,
    source: "top_picks",
    as_of: acc?.builtAtIso || null,
    generated_at: iso(nowMs),
    feed,
    new_trades_stopped: !!ctl?.stop,
    rules: RULES,
    tick_rule: TICK_RULE,
    quantity_rule: "one_contract",
    close_days: closeDays,
    counts: {
      listed: list.length,
      matched: total,
      placeable: list.filter((x) => x.agent_placeable).length,
      open: list.filter((x) => x.kind === "OPEN").length,
      close: list.filter((x) => x.kind === "CLOSE").length,
    },
    instructions: list,
  };
}

