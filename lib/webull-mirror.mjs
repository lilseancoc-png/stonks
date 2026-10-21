// Webull paper mirror: copies the Top Picks engine's option trades into the
// Owner's Webull PaperTrade account and logs every outcome by trade ID.
//
// The engine stays the source of truth. The mirror never decides anything on
// its own: when the record opens a trade (picks-accuracy.json `open`), the
// mirror buys 1 contract (spreads as one multi-leg order); when the record
// closes it (`closed`), the mirror sells. Run from api/auth/[action].js
// "webull-mirror" after every full bake.
//
// Price rule (Owner's spec, 2026-10-21):
//   - Entry: limit at the engine's entry price. If that hasn't filled by the
//     next run, cancel and re-price once to the current mid, but only while the
//     mid is within ±10% of the engine's price. Otherwise the trade is logged
//     as missed, with how far the price had moved. Never chases past the band.
//   - Exit: limit at the engine's exit price; if unfilled by the next run, the
//     current mid; after that the bid (ask when buying back a credit spread),
//     every run until it fills, so no paper position outlives the engine's.
//   - Every fill is labeled with its % difference from the engine, e.g. "Paper
//     bought 4.0% above engine" / "Paper sold 7.0% below engine".
//
// Only trades the engine opens after the mirror's first run (goLiveIso) are
// copied. Orders are DAY limit orders, placed only during regular hours.
//
// The planner is pure apart from the injected Webull client and quote
// function, so scripts/webull-mirror-smoke.mjs drives it with fakes.

import { createHash, createHmac } from "node:crypto";
import { pickTradeId, entryPrice, markPrice } from "./pick-trade-text.mjs";
import { fillPnlPct, entrySlippagePct, FILL_COLUMNS } from "./track-record-fills.mjs";

export const LEDGER_KEY = "webull-paper-ledger.json";
export const BAND_PCT = 10;
export const ACCOUNT_LABEL = "Webull paper";
const ENTRY_MAX_ATTEMPTS = 2;
const EXIT_MAX_ATTEMPTS = 12;
const MIN_RUN_GAP_MS = 60 * 1000;
const RUNS_KEPT = 60;
const GO_LIVE_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const MAX_CANCEL_FAILS = 3;
const CANCEL_CONFIRM_TRIES = 3;
const CANCEL_CONFIRM_WAIT_MS = 1500;
// Webull's order statuses: SUBMITTED, CANCELLED, FAILED, FILLED, PARTIAL_FILLED
// ("PARTIAL FILLED" in the SDK's labels). Anything not known to be final
// counts as still working, so an unfamiliar status can never let a second
// order go out next to a live one. CANCEL_FAILED is the mirror's own marker.
const FINAL = new Set(["FILLED", "CANCELLED", "FAILED", "REJECTED", "EXPIRED"]);
const isWorking = (status) => !!status && !FINAL.has(status) && status !== "CANCEL_FAILED";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

// Bearer token the build workflow sends to trigger a run. Derived from a
// secret both Vercel and GitHub already hold (R2_SECRET_ACCESS_KEY), so no new
// shared secret is needed and the token itself never appears in a log.
export function mirrorTriggerToken(secret) {
  return createHmac("sha256", String(secret)).update("webull-mirror-trigger:v1").digest("hex");
}

// --- Contract description ----------------------------------------------------

function ymd(expirySec) {
  const n = num(expirySec);
  if (n == null) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

// Legs as Webull wants them, opening direction. Null when the record entry
// can't be described (no contract, missing strikes).
export function mirrorLegs(e) {
  const c = e?.contract;
  if (!c) return null;
  const structure = c.structure || "long";
  if (structure === "debit_vertical" || structure === "credit_vertical") {
    if (!Array.isArray(c.legs) || c.legs.length !== 2) return null;
    const legs = c.legs.map((l) => ({
      side: (num(l.qty) || 0) > 0 ? "BUY" : "SELL",
      type: String(l.type || c.optionType || e.side) === "put" ? "PUT" : "CALL",
      strike: num(l.strike),
      expiry: ymd(l.expiry ?? c.expiry),
      expirySec: num(l.expiry ?? c.expiry),
    }));
    return legs.every((l) => l.strike != null && l.expiry) ? legs : null;
  }
  const strike = num(c.strike), expiry = ymd(c.expiry);
  if (strike == null || !expiry) return null;
  return [{ side: "BUY", type: e.side === "put" ? "PUT" : "CALL", strike, expiry, expirySec: num(c.expiry) }];
}

export function isCredit(structure) {
  return structure === "credit_vertical";
}

// Option ticks: $0.01 under $3, $0.05 at $3 and up (penny-pilot names quote
// tighter, but a nickel is always a valid price). Spreads trade in pennies.
export function roundTick(price, { spread = false, nickel = false } = {}) {
  const p = num(price);
  if (p == null || !(p > 0)) return null;
  const tick = nickel ? 0.05 : spread || p < 3 ? 0.01 : 0.05;
  return Math.max(tick, Math.round(p / tick) * tick);
}

function priceText(p) {
  return Number(p).toFixed(2);
}

// Deterministic client_order_id (Webull caps it at 32 chars, unique per
// account): a rerun of the same attempt reuses the same id, so a crash between
// placing and saving can't double-buy.
export function clientOrderId(tradeId, phase, attempt) {
  return "ms" + createHash("sha256").update(`${tradeId}|${phase}|${attempt}`).digest("hex").slice(0, 28);
}

// One Webull order body. phase "entry" opens, "exit" closes.
export function buildOrder(t, phase, limit, coid) {
  const spread = t.legs.length > 1;
  const credit = isCredit(t.structure);
  const opening = phase === "entry";
  // Order-level side: buying the position (long / debit spread open, credit
  // spread close) is BUY; the reverse is SELL.
  const buying = opening ? !credit : credit;
  const flip = (s) => (s === "BUY" ? "SELL" : "BUY");
  const legs = t.legs.map((l) => ({
    side: opening ? l.side : flip(l.side),
    quantity: "1",
    symbol: t.symbol,
    strike_price: String(l.strike),
    option_expire_date: l.expiry,
    instrument_type: "OPTION",
    option_type: l.type,
    market: "US",
  }));
  const order = {
    client_order_id: coid,
    combo_type: "NORMAL",
    order_type: "LIMIT",
    quantity: "1",
    limit_price: priceText(limit),
    option_strategy: spread ? "VERTICAL" : "SINGLE",
    side: buying ? "BUY" : "SELL",
    time_in_force: "DAY",
    entrust_type: "QTY",
    legs,
  };
  if (!spread) order.position_intent = opening ? "BUY_TO_OPEN" : "SELL_TO_CLOSE";
  return order;
}

// --- Labels ------------------------------------------------------------------

// + = the paper price is above the engine's.
export function diffPct(paper, engine) {
  const p = num(paper), e = num(engine);
  if (p == null || e == null || !(e > 0)) return null;
  return r1((p / e - 1) * 100);
}

function relWord(pct) {
  if (pct == null) return "";
  if (Math.abs(pct) < 0.05) return "at the engine's price";
  return `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? "above" : "below"} engine`;
}

export function entryLabel(t) {
  const d = t.entryDiffPct;
  if (d == null) return null;
  return isCredit(t.structure) ? `Paper sold to open ${relWord(d)}` : `Paper bought ${relWord(d)}`;
}

export function exitLabel(t) {
  const d = t.exitDiffPct;
  if (d == null) return null;
  return isCredit(t.structure) ? `Paper bought back ${relWord(d)}` : `Paper sold ${relWord(d)}`;
}

export function paperPnlPct(t) {
  const open = num(t.fillPrice), close = num(t.closeFillPrice);
  if (open == null || close == null || !(open > 0)) return null;
  return r1(isCredit(t.structure) ? (open - close) / open * 100 : (close / open - 1) * 100);
}

// --- Market hours ------------------------------------------------------------

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Regular session, Mon-Fri 9:30-16:00 ET. Holidays and early closes aren't
// modeled: Webull refuses the order (isMarketClosedError) and the next run
// retries it without counting a try.
export function isRegularSession(nowMs) {
  const p = {};
  for (const x of ET_PARTS.formatToParts(new Date(nowMs))) p[x.type] = x.value;
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

// Webull refuses option orders outside 9:30-16:00 ET with HTTP 417
// OPENAPI_OPTION_ONLY_SUPPORT_MARKET_IN_CORE_TIME, paper accounts included.
export function isOrderNotFoundError(err) {
  return /not present|not exist|not found/i.test(String(err?.message || ""));
}

export function isMarketClosedError(err) {
  return /CORE_TIME/i.test(String(err?.code || "")) || /available trading hours/i.test(String(err?.message || ""));
}

// Preview -> estimated fee in $ for the whole order (Webull answers
// { estimated_cost, estimated_transaction_fee, currency }).
export function parsePreviewFee(resp) {
  const body = Array.isArray(resp) ? resp[0] : resp?.data && typeof resp.data === "object" ? resp.data : resp;
  const fee = num(body?.estimated_transaction_fee ?? body?.estimated_fee ?? body?.fee);
  return fee != null && fee >= 0 ? fee : null;
}

// --- Ledger ------------------------------------------------------------------

export function emptyLedger() {
  return { version: 1, goLiveIso: null, lastRunIso: null, accountId: null, trades: {}, runs: [] };
}

function engineIndex(acc) {
  const map = new Map();
  for (const e of Array.isArray(acc?.open) ? acc.open : []) if (e?.symbol && e.entryDate) map.set(pickTradeId(e), { e, closed: false });
  for (const e of Array.isArray(acc?.closed) ? acc.closed : []) if (e?.symbol && e.entryDate) map.set(pickTradeId(e), { e, closed: true });
  return map;
}

function newTrade(e, id) {
  const structure = e.contract?.structure || "long";
  return {
    tradeId: id,
    symbol: e.symbol,
    side: e.side === "put" ? "put" : "call",
    structure,
    legs: mirrorLegs(e),
    engineEntryPrice: r2(entryPrice(e)),
    engineEntryIso: e.entryDate,
    state: "entering",
    entryAttempts: [],
    exitAttempts: [],
    fillPrice: null, fillIso: null, entryDiffPct: null,
    engineExitPrice: null, engineExitIso: null, engineCloseReason: null, enginePnlPct: null,
    closeFillPrice: null, closeFillIso: null, exitDiffPct: null,
    paperPnlPct: null, labels: [], note: null,
  };
}

function lastAttempt(t, phase) {
  const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
  return list.length ? list[list.length - 1] : null;
}

// Order detail -> { status, filledPrice, filledIso }. Webull nests the order
// under `orders[]` for a client_order_id lookup; tolerate a bare order too.
export function parseOrderDetail(resp) {
  const body = resp?.data && typeof resp.data === "object" ? resp.data : resp;
  const o = Array.isArray(body?.orders) ? body.orders[0] : Array.isArray(body) ? body[0] : body?.order || body;
  if (!o || typeof o !== "object") return null;
  const status = String(o.status || o.order_status || "").trim().toUpperCase().replace(/[\s-]+/g, "_") || null;
  const filledQty = num(o.filled_quantity);
  const filledPrice = num(o.filled_price) ?? num(o.avg_filled_price);
  let filledIso = o.filled_time_at || null;
  if (!filledIso && num(o.filled_time)) filledIso = new Date(num(o.filled_time)).toISOString();
  return { status, filledQty, filledPrice: filledPrice && filledPrice > 0 ? filledPrice : null, filledIso };
}

// --- Runner ------------------------------------------------------------------

// quoteFn(trade) -> { bid, ask } for the whole position per share in its
// opening direction (a spread's net debit / credit), or null.
export async function runWebullMirror({ client, accountId, acc, ledger, nowMs = Date.now(), quoteFn = async () => null, placeOrders = true, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const L = ledger && typeof ledger === "object" ? ledger : emptyLedger();
  L.trades = L.trades || {};
  L.runs = Array.isArray(L.runs) ? L.runs : [];
  const nowIso = new Date(nowMs).toISOString();
  const log = [];
  const summary = { at: nowIso, placed: 0, filled: 0, cancelled: 0, missed: 0, closed: 0, errors: 0, skipped: null, note: null };

  // Without a readable record every live trade would look closed and the
  // mirror would sell the whole book: refuse instead.
  if (!Array.isArray(acc?.open) || !Array.isArray(acc?.closed)) {
    return { ledger: L, summary: { ...summary, skipped: "track record unavailable" }, log };
  }
  if (L.lastRunIso && nowMs - Date.parse(L.lastRunIso) < MIN_RUN_GAP_MS) {
    return { ledger: L, summary: { ...summary, skipped: "ran less than a minute ago" }, log };
  }

  // Fail closed: the configured account must be one the keys can see.
  const listed = await client.accountList();
  const accounts = Array.isArray(listed) ? listed : Array.isArray(listed?.accounts) ? listed.accounts : Array.isArray(listed?.data) ? listed.data : [];
  if (!accounts.some((a) => String(a?.account_id ?? a?.accountId ?? a?.id) === String(accountId))) {
    throw Object.assign(new Error("configured Webull paper account is not in this key's account list"), { code: "ACCOUNT_NOT_FOUND" });
  }
  L.accountId = String(accountId);
  // Go-live is the bake this first run follows, so the trades it just opened
  // are copied too; anything opened earlier is left alone.
  if (!L.goLiveIso) {
    const built = Date.parse(acc?.builtAtIso);
    // Never reach back more than a few hours: a stale record's opens are
    // not "from go-live".
    const floor = nowMs - GO_LIVE_LOOKBACK_MS;
    L.goLiveIso = new Date(Number.isFinite(built) && built <= nowMs ? Math.max(built - 30 * 60 * 1000, floor) : nowMs).toISOString();
  }
  const goLiveMs = Date.parse(L.goLiveIso);
  const session = isRegularSession(nowMs);
  const canTrade = placeOrders && session;
  // Set when Webull answers "outside trading hours" (a holiday or an early
  // close the session clock doesn't know): nothing more is sent this run and
  // the order doesn't count as a try.
  let marketShut = false;
  const engine = engineIndex(acc);

  async function refresh(t, phase) {
    const a = lastAttempt(t, phase);
    if (!a || !(isWorking(a.status) || a.status === "CANCEL_FAILED")) return;
    try {
      const d = parseOrderDetail(await client.orderDetail(accountId, a.clientOrderId));
      if (!d) return;
      if (d.status) a.status = d.status;
      if (d.status === "FILLED" || (d.filledQty && d.filledQty >= 1)) {
        a.status = "FILLED";
        a.filledPrice = d.filledPrice;
        a.filledIso = d.filledIso || nowIso;
      }
    } catch (err) {
      // Webull answers "Order not present" for an order it never accepted:
      // safe to send a new one, and it doesn't count as a try.
      if (isOrderNotFoundError(err)) { a.status = "REJECTED"; a.error = "Webull has no record of this order"; return; }
      log.push(`${t.tradeId}: order lookup failed (${err.message})`);
    }
  }

  // While an earlier order's cancel hasn't been confirmed it may still fill,
  // so no new order is sent (that could double the position). After a few
  // runs the trade is flagged for a hand check.
  async function blockedByUnconfirmedCancel(t, phase) {
    const a = lastAttempt(t, phase);
    if (a?.status !== "CANCEL_FAILED") return false;
    await cancel(t, a);
    if (a.status !== "CANCEL_FAILED") return false;
    a.cancelFails = (a.cancelFails || 0) + 1;
    if (a.cancelFails >= MAX_CANCEL_FAILS) {
      t.state = "error";
      t.note = `couldn't confirm the ${phase} order was cancelled; check Webull by hand`;
      t.labels = [phase === "exit" ? entryLabel(t) : null, "Order stuck: check Webull by hand"].filter(Boolean);
    }
    return true;
  }

  // Webull accepting a cancel isn't the order being cancelled: it can still
  // fill in between. Read the status back (a few short tries) and only call
  // it cancelled once Webull says so; otherwise no new order goes out.
  async function cancel(t, a) {
    try {
      await client.cancelOrder(accountId, a.clientOrderId);
      for (let i = 0; i < CANCEL_CONFIRM_TRIES; i++) {
        if (i) await sleep(CANCEL_CONFIRM_WAIT_MS);
        await refresh(t, a.phase);
        if (!isWorking(a.status)) break;
      }
      if (a.status === "CANCELLED") summary.cancelled++;
      else if (isWorking(a.status)) a.status = "CANCEL_FAILED";
    } catch (err) {
      // Most often the order already filled or expired: look again.
      await refresh(t, a.phase);
      if (isWorking(a.status) || a.status === "CANCEL_FAILED") { a.status = "CANCEL_FAILED"; a.error = err.message; summary.errors++; }
    }
  }

  // `quote` is the bid/ask the price was chosen from, when the caller already
  // has it; otherwise one is fetched so every order records the market it met.
  async function place(t, phase, limit, why, quote) {
    if (marketShut) return null;
    const q = quote !== undefined ? quote : await quoteFn(t).catch(() => null);
    const list = phase === "entry" ? t.entryAttempts : t.exitAttempts;
    const n = list.length + 1;
    const coid = clientOrderId(t.tradeId, phase, n);
    // Some names trade in nickels even under $3: after Webull rejects a
    // price, round to $0.05 instead.
    const rejected = list.some((x) => x.status === "REJECTED" && x.error !== "Webull has no record of this order");
    const px = roundTick(limit, { spread: t.legs.length > 1, nickel: rejected });
    const a = { phase, n, clientOrderId: coid, limit: px, why, sentIso: nowIso, status: "SENT", filledPrice: null, filledIso: null,
      bid: num(q?.bid), ask: num(q?.ask), spot: num(q?.spot) };
    list.push(a);
    if (px == null) { a.status = "REJECTED"; a.error = "no usable price"; summary.errors++; return a; }
    const order = buildOrder(t, phase, px, coid);
    // Webull's own fee estimate for this order (a preview places nothing), so
    // the test section can net fees out of the paper P&L.
    if (client.previewOrder) {
      try { a.feeEst = parsePreviewFee(await client.previewOrder(accountId, [order])); } catch { /* fee stays unknown */ }
    }
    try {
      await client.placeOrder(accountId, [order]);
      summary.placed++;
    } catch (err) {
      if (isMarketClosedError(err)) {
        list.pop();
        marketShut = true;
        summary.note = "Webull says the options market is closed";
        return null;
      }
      // A duplicate id means an earlier run placed it and crashed before
      // saving: adopt that order instead of failing.
      try {
        const d = parseOrderDetail(await client.orderDetail(accountId, coid));
        if (d?.status) { a.status = d.status; if (d.filledPrice) { a.filledPrice = d.filledPrice; a.filledIso = d.filledIso || nowIso; } return a; }
      } catch { /* not found: a real rejection */ }
      a.status = "REJECTED";
      a.error = err.message;
      summary.errors++;
    }
    return a;
  }

  function settleEntry(t) {
    const a = lastAttempt(t, "entry");
    if (a?.status !== "FILLED") return false;
    t.fillPrice = a.filledPrice ?? a.limit;
    t.fillIso = a.filledIso;
    t.fees = r2((t.fees || 0) + (a.feeEst || 0));
    t.entryDiffPct = diffPct(t.fillPrice, t.engineEntryPrice);
    t.state = "open";
    t.labels = [entryLabel(t)].filter(Boolean);
    summary.filled++;
    return true;
  }

  function settleExit(t) {
    const a = lastAttempt(t, "exit");
    if (a?.status !== "FILLED") return false;
    t.closeFillPrice = a.filledPrice ?? a.limit;
    t.closeFillIso = a.filledIso;
    t.fees = r2((t.fees || 0) + (a.feeEst || 0));
    t.exitDiffPct = diffPct(t.closeFillPrice, t.engineExitPrice);
    t.paperPnlPct = paperPnlPct(t);
    t.state = "closed";
    t.labels = [entryLabel(t), exitLabel(t)].filter(Boolean);
    summary.closed++;
    return true;
  }

  function miss(t, reason) {
    t.state = "missed";
    t.note = reason;
    t.labels = [`Missed: ${reason}`];
    summary.missed++;
  }

  // 1. New engine opens since go-live.
  for (const [id, { e, closed }] of engine) {
    if (L.trades[id] || !e.contract) continue;
    if ((Date.parse(e.entryDate) || 0) < goLiveMs) continue;
    const t = newTrade(e, id);
    if (!t.legs || t.engineEntryPrice == null) {
      t.state = "skipped";
      t.note = "the record's contract can't be described as a Webull order";
      t.labels = ["Skipped: contract details missing"];
    } else if (closed) {
      t.state = "missed";
      t.note = "the engine opened and closed it before the mirror ran";
      t.labels = ["Missed: opened and closed between mirror runs"];
    }
    L.trades[id] = t;
  }

  // 2. Advance every live trade.
  for (const t of Object.values(L.trades)) {
    if (!["entering", "open", "exiting"].includes(t.state)) continue;
    const eng = engine.get(t.tradeId);
    const engineClosed = !eng || eng.closed;
    if (engineClosed && t.engineExitIso == null) {
      const e = eng?.e;
      t.engineExitIso = e?.exitDate || nowIso;
      t.engineCloseReason = e?.status || "removed from the record";
      t.engineExitPrice = e ? r2(markPrice(e)) : null;
      t.enginePnlPct = e ? r1(num(e.optionPnlPct)) : null;
    }

    if (t.state === "entering") {
      await refresh(t, "entry");
      if (settleEntry(t)) {
        if (!engineClosed) continue;
      } else {
        const a = lastAttempt(t, "entry");
        if (engineClosed) {
          if (a && isWorking(a.status)) await cancel(t, a);
          if (!settleEntry(t)) {
            if (canTrade && await blockedByUnconfirmedCancel(t, "entry")) continue;
            if (lastAttempt(t, "entry")?.status === "CANCEL_FAILED") continue;
            miss(t, "the engine closed it before the paper order filled");
            continue;
          }
        } else if (canTrade) {
          if (a && isWorking(a.status)) await cancel(t, a);
          if (settleEntry(t)) continue;
          if (await blockedByUnconfirmedCancel(t, "entry")) continue;
          const tries = t.entryAttempts.filter((x) => x.status !== "REJECTED").length;
          const rejects = t.entryAttempts.length - tries;
          if (rejects >= 3) {
            t.state = "error";
            t.note = `Webull rejected the entry ${rejects} times: ${lastAttempt(t, "entry")?.error || "unknown reason"}`;
            t.labels = ["Entry rejected by Webull"];
            summary.errors++;
          } else if (tries === 0) {
            await place(t, "entry", t.engineEntryPrice, "engine entry price");
          } else if (tries >= ENTRY_MAX_ATTEMPTS) {
            miss(t, `not filled within ${BAND_PCT}% of the engine's price after ${tries} tries`);
          } else {
            const q = await quoteFn(t).catch(() => null);
            const mid = q && num(q.bid) != null && num(q.ask) != null ? (num(q.bid) + num(q.ask)) / 2 : null;
            const d = diffPct(mid, t.engineEntryPrice);
            if (mid == null) await place(t, "entry", t.engineEntryPrice, "engine entry price (no quote for a re-price)", q);
            else if (Math.abs(d) > BAND_PCT) miss(t, `price was ${Math.abs(d).toFixed(1)}% ${d > 0 ? "above" : "below"} the engine's when paper re-tried`);
            else await place(t, "entry", mid, "current mid, within the band", q);
          }
          continue;
        } else continue;
      }
    }

    if (t.state === "open" && engineClosed) {
      if (t.engineCloseReason === "expired") {
        t.state = "expired";
        t.note = "the contract expired; check the Webull paper account for how it settled";
        t.labels = [entryLabel(t), "Expired, as in the record"].filter(Boolean);
        summary.closed++;
        continue;
      }
      t.state = "exiting";
    }

    if (t.state === "exiting") {
      await refresh(t, "exit");
      if (settleExit(t) || !canTrade) continue;
      const a = lastAttempt(t, "exit");
      if (a && isWorking(a.status)) await cancel(t, a);
      if (settleExit(t)) continue;
      if (await blockedByUnconfirmedCancel(t, "exit")) continue;
      const n = t.exitAttempts.length;
      if (n >= EXIT_MAX_ATTEMPTS) {
        t.state = "error";
        t.note = `exit not filled after ${n} tries; close it by hand in Webull`;
        t.labels = [entryLabel(t), "Exit stuck: close by hand"].filter(Boolean);
        summary.errors++;
        continue;
      }
      if (n === 0 && t.engineExitPrice != null && t.engineExitPrice > 0) {
        await place(t, "exit", t.engineExitPrice, "engine exit price");
        continue;
      }
      const q = await quoteFn(t).catch(() => null);
      const bid = num(q?.bid), ask = num(q?.ask);
      const credit = isCredit(t.structure);
      let px = null, why = null;
      if (n <= 1 && bid != null && ask != null) { px = (bid + ask) / 2; why = "current mid"; }
      else if (credit ? ask != null : bid != null) { px = credit ? ask : bid; why = credit ? "current ask, to make sure it closes" : "current bid, to make sure it closes"; }
      else if (t.engineExitPrice != null) { px = t.engineExitPrice; why = "engine exit price (no quote)"; }
      // A worthless long can't be sold for $0: leave it to expire.
      if (!(px > 0)) { px = 0.01; why = "minimum price, nearly worthless"; }
      await place(t, "exit", px, why, q);
    }
  }

  L.lastRunIso = nowIso;
  L.runs = [{ ...summary, session }, ...L.runs].slice(0, RUNS_KEPT);
  return { ledger: L, summary: { ...summary, session }, log };
}

// --- Rows for "Your fills vs the record" ---------------------------------------

const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function etStamp(iso) {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? ET_TIME.format(d).replace(",", "") : "";
}

// Ledger trades -> rows in the picks-fills shape (lib/track-record-fills.mjs
// FILL_COLUMNS), account "Webull paper". Trades still waiting on their first
// order are left out.
export function ledgerToFillRows(ledger) {
  const rows = [];
  for (const t of Object.values(ledger?.trades || {})) {
    if (t.state === "entering" && !t.entryAttempts?.length) continue;
    const missed = t.state === "missed" || t.state === "skipped";
    const entryA = (t.entryAttempts || []).filter((a) => a.status !== "REJECTED");
    const exitA = t.exitAttempts || [];
    const row = {
      trade_id: t.tradeId,
      account: ACCOUNT_LABEL,
      symbol: t.symbol,
      side: t.side,
      structure: t.structure,
      legs: (t.legs || []).map((l) => `${l.side} ${l.expiry} ${l.strike} ${l.type}`).join(" / "),
      qty: 1,
      mingstreet_run_time_et: etStamp(t.engineEntryIso),
      mingstreet_entry_mid: t.engineEntryPrice,
      order_sent_time_et: etStamp(entryA[0]?.sentIso),
      stock_price_at_order: entryA[0]?.spot ?? null,
      bid_at_order: entryA[0]?.bid ?? null,
      ask_at_order: entryA[0]?.ask ?? null,
      order_type: "LIMIT",
      limit_steps: entryA.length || null,
      fill_price: t.fillPrice,
      fill_time_et: etStamp(t.fillIso),
      skipped: missed ? "yes" : "",
      skip_reason: missed ? (t.note || "") : "",
      close_reason_feed: t.engineCloseReason || "",
      feed_exit_pnl_pct: t.enginePnlPct,
      close_order_time_et: etStamp(exitA[0]?.sentIso),
      bid_at_close: exitA[0]?.bid ?? null,
      ask_at_close: exitA[0]?.ask ?? null,
      close_fill_price: t.closeFillPrice,
      close_fill_time_et: etStamp(t.closeFillIso),
      fees: t.fees ?? null,
      close_trigger: exitA.length ? exitA[exitA.length - 1].why || "" : "",
      notes: [...(t.labels || []), `state: ${t.state}`].join("; "),
    };
    row.your_pnl_pct = fillPnlPct(row);
    row.entry_slippage_pct = entrySlippagePct(row);
    rows.push(row);
  }
  rows.sort((a, b) => String(b.mingstreet_run_time_et).localeCompare(String(a.mingstreet_run_time_et)));
  return rows;
}

// Ledger -> one compact object per mirrored trade for the Track Record's
// "Webull test" view (Owner-only GET). Everything the panels need, nothing
// about the account itself.
export function ledgerToTestTrades(ledger) {
  const out = [];
  for (const t of Object.values(ledger?.trades || {})) {
    const entryA = (t.entryAttempts || []).filter((a) => a.status !== "REJECTED");
    const exitA = (t.exitAttempts || []).filter((a) => a.status !== "REJECTED");
    const filledEntry = entryA.find((a) => a.status === "FILLED") || null;
    const filledExit = exitA.find((a) => a.status === "FILLED") || null;
    out.push({
      tradeId: t.tradeId, symbol: t.symbol, side: t.side, structure: t.structure, state: t.state,
      legs: (t.legs || []).map((l) => `${l.side} ${l.expiry} ${l.strike} ${l.type}`).join(" / "),
      engineEntryPrice: t.engineEntryPrice, engineEntryIso: t.engineEntryIso,
      entrySentIso: entryA[0]?.sentIso || null, entryTries: entryA.length,
      entryHow: filledEntry ? (filledEntry.n === entryA[0]?.n ? "first" : "reprice") : null,
      entryBid: entryA[0]?.bid ?? null, entryAsk: entryA[0]?.ask ?? null, entrySpot: entryA[0]?.spot ?? null,
      fillPrice: t.fillPrice, fillIso: t.fillIso, entryDiffPct: t.entryDiffPct,
      engineExitPrice: t.engineExitPrice, engineExitIso: t.engineExitIso,
      engineCloseReason: t.engineCloseReason, enginePnlPct: t.enginePnlPct,
      exitSentIso: exitA[0]?.sentIso || null, exitTries: exitA.length,
      exitBid: exitA[0]?.bid ?? null, exitAsk: exitA[0]?.ask ?? null,
      closeFillPrice: t.closeFillPrice, closeFillIso: t.closeFillIso, exitDiffPct: t.exitDiffPct,
      exitHow: filledExit?.why || null,
      paperPnlPct: t.paperPnlPct, fees: t.fees ?? null,
      labels: t.labels || [], note: t.note || null,
    });
  }
  out.sort((a, b) => String(b.engineEntryIso || "").localeCompare(String(a.engineEntryIso || "")));
  return out;
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// The rows as a CSV with the trade-log template's columns, plus the mirror's
// computed P&L and entry gap.
export function fillRowsToCsv(rows) {
  const cols = [...FILL_COLUMNS, "your_pnl_pct", "entry_slippage_pct"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

// --- Live quotes ----------------------------------------------------------------

// quoteFn for runWebullMirror from lib/yahoo.mjs fetchContract: one Yahoo call
// per leg. Returns the position's bid/ask per share in its opening direction:
// a long's own quote, a debit spread's net debit, a credit spread's net credit.
export function makeQuoteFn(fetchContract) {
  return async function quote(t) {
    const legs = t?.legs || [];
    if (!legs.length) return null;
    const quotes = [];
    for (const l of legs) {
      if (l.expirySec == null) return null;
      const c = await fetchContract(t.symbol, l.expirySec, l.type === "PUT" ? "put" : "call", l.strike);
      const b = num(c?.b), a = num(c?.a);
      if (b == null || a == null || a <= 0 || b > a) return null;
      quotes.push({ side: l.side, bid: b, ask: a, spot: num(c?.spot) });
    }
    const spot = quotes[0].spot;
    if (quotes.length === 1) return { bid: quotes[0].bid, ask: quotes[0].ask, spot };
    const long = quotes.find((q) => q.side === "BUY"), short = quotes.find((q) => q.side === "SELL");
    if (!long || !short) return null;
    if (isCredit(t.structure)) return { bid: r2(Math.max(0, short.bid - long.ask)), ask: r2(Math.max(0, short.ask - long.bid)), spot };
    return { bid: r2(Math.max(0, long.bid - short.ask)), ask: r2(Math.max(0, long.ask - short.bid)), spot };
  };
}
