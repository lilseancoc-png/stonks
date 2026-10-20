// Plain-text trade lines for the Top Picks track record — one line per open
// trade and per recent close, written so a person or an outside agent (e.g.
// ChatGPT placing orders in a Robinhood agentic account) can copy them without
// reading the cards. Used by the private picks feed (api/auth/[action].js,
// action "picks-feed"). The Open picks tab re-ports pickOpenLine/pickCloseLine
// in scripts/render/app-js.mjs (app.js is a generated IIFE and cannot import
// an ES module) — change one, change the other.
//
// Pure, no network, no AI.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CLOSE_REASON = {
  "hit-tp-prem": "take-profit hit",
  "trail-stop": "trail stop",
  "hit-stop-prem": "premium stop hit",
  "hit-stop-under": "stock stop hit",
  "thesis-broken": "thesis broken",
  "theta-stop": "theta stop",
  "expired": "contract expired",
  "dropped": "name left the universe",
  "left-coverage": "name left coverage (not counted in the record)",
};

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  const n = num(v);
  return n == null ? "?" : "$" + n.toFixed(2);
}

function strikeText(v) {
  const n = num(v);
  if (n == null) return "$?";
  return "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
}

// Contract expiries are epoch seconds at the expiration date (UTC midnight).
export function expiryText(sec) {
  const n = num(sec);
  if (n == null) return "?";
  const d = new Date(n * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

function etParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d)) parts[p.type] = p.value;
  return parts;
}

// Stable, readable trade id: SYMBOL-C|P-YYMMDD-HHMM (entry time, ET). One
// symbol:side is open at a time, so the entry stamp makes it unique.
export function pickTradeId(e) {
  const p = etParts(e?.entryDate);
  const side = e?.side === "put" ? "P" : "C";
  const stamp = p ? `${p.year}${p.month}${p.day}-${p.hour}${p.minute}` : "000000-0000";
  return `${e?.symbol || "?"}-${side}-${stamp}`;
}

export function etTimeText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(d) + " ET";
}

// "NOW Dec 18 2026 $450 call", or the two strikes for a vertical.
function contractText(e) {
  const c = e?.contract || {};
  const type = (c.optionType || e?.side) === "put" ? "put" : "call";
  const exp = expiryText(c.expiry);
  if (c.structure === "debit_vertical" || c.structure === "credit_vertical") {
    const kind = c.structure === "credit_vertical" ? "credit" : "debit";
    return `${e.symbol} ${exp} ${strikeText(c.longStrike)}/${strikeText(c.shortStrike)} ${type} ${kind} spread (long ${strikeText(c.longStrike)}, short ${strikeText(c.shortStrike)})`;
  }
  return `${e.symbol} ${exp} ${strikeText(c.strike)} ${type}`;
}

// Entry price per share: the long mid, or the spread's net debit/credit.
function entryPrice(e) {
  const c = e?.contract || {};
  if (c.structure === "debit_vertical") return num(c.netDebit) ?? num(c.mid);
  if (c.structure === "credit_vertical") return num(c.netCredit) ?? num(c.mid);
  return num(c.mid);
}

// Modeled price per share now (open) or at close, from the entry price and
// the record's option P&L %. A credit spread's P&L is measured on the credit,
// so its price is the cost to buy the spread back.
function markPrice(e) {
  const entry = entryPrice(e);
  const pnl = num(e?.optionPnlPct);
  if (entry == null || pnl == null) return null;
  const px = e?.contract?.structure === "credit_vertical" ? entry * (1 - pnl / 100) : entry * (1 + pnl / 100);
  return Math.max(0, px);
}

function perContract(px) {
  return px == null ? "" : ` ($${Math.round(px * 100).toLocaleString("en-US")} per contract)`;
}

const MULTI_LEG_NOTE = " This is a 2-leg spread: Robinhood agents can't place multi-leg orders, so place it by hand or skip it.";

export function pickOpenLine(e) {
  const c = e?.contract || {};
  const px = entryPrice(e);
  const credit = c.structure === "credit_vertical";
  const spread = c.structure === "debit_vertical" || credit;
  const verb = credit ? "sell to open" : "buy to open";
  const priceWord = credit ? "a net credit of about" : spread ? "a net debit of about" : "about";
  return `OPEN ${pickTradeId(e)}: ${verb} ${contractText(e)} at ${priceWord} ${money(px)} per share${perContract(px)}. `
    + `Opened ${etTimeText(e.entryDate)}. Mingstreet's price is a model mid, not a fill, so use a limit order near it.`
    + (spread ? MULTI_LEG_NOTE : "");
}

export function pickCloseLine(e) {
  const c = e?.contract || {};
  const credit = c.structure === "credit_vertical";
  const px = markPrice(e);
  const pnl = num(e?.optionPnlPct);
  const reason = CLOSE_REASON[e?.status] || e?.status || "closed";
  const verb = credit ? "buy to close" : "sell to close";
  const pnlText = pnl == null ? "" : ` (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%)`;
  return `CLOSE ${pickTradeId(e)}: ${verb} ${contractText(e)}. Reason: ${reason}${pnlText}. `
    + `Mingstreet's model price ${money(px)} per share${perContract(px)}. Closed ${etTimeText(e.exitDate)}. Use a limit order near the current mid.`;
}

// The whole feed as plain text: header, open trades (newest first), then the
// closes from the last `closeDays` days (newest first).
export function buildPicksFeedText(acc, { nowMs = Date.now(), closeDays = 7 } = {}) {
  const open = Array.isArray(acc?.open) ? acc.open.slice() : [];
  const closed = Array.isArray(acc?.closed) ? acc.closed : [];
  const byDateDesc = (k) => (a, b) => (Date.parse(b?.[k]) || 0) - (Date.parse(a?.[k]) || 0);
  open.sort(byDateDesc("entryDate"));
  const cutoff = nowMs - closeDays * 86400000;
  const recent = closed.filter((c) => c && c.contract && (Date.parse(c.exitDate) || 0) >= cutoff).sort(byDateDesc("exitDate"));
  const lines = [
    "Mingstreet Top Picks: trade lines",
    `Updated ${acc?.builtAtIso ? etTimeText(acc.builtAtIso) : "unknown"}. Top Picks runs at 11:00 and 15:30 ET on trading days.`,
    "Prices are per share; one contract is 100 shares. Each trade has a stable id: open a trade once, and close it only when its CLOSE line appears.",
    "",
    `OPEN TRADES (${open.length})`,
    ...(open.length ? open.filter((e) => e && e.contract).map(pickOpenLine) : ["None open right now."]),
    "",
    `CLOSED IN THE LAST ${closeDays} DAYS (${recent.length})`,
    ...(recent.length ? recent.map(pickCloseLine) : ["None."]),
  ];
  return lines.join("\n") + "\n";
}
