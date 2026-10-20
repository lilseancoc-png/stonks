// Plain-text trade blocks for the Top Picks track record — one labeled block
// per open trade and per recent close, written so a person or an outside agent
// (e.g. ChatGPT placing orders in a Robinhood agentic account) can copy them
// without reading the cards. Used by the private picks feed
// (api/auth/[action].js, action "picks-feed"). The Open picks tab re-ports
// this file in scripts/render/app-js.mjs (its "Copy all" text is the same
// feed text; app.js is a generated IIFE and cannot import an ES module) —
// change one, change the other.
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

// Formatters are built once; Intl construction is the slow part.
const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit",
});

function etParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = {};
  for (const p of ET_PARTS.formatToParts(d)) parts[p.type] = p.value;
  return parts;
}

// Whole calendar days from today (ET) to the contract's expiration date:
// 0 = expires today, negative = already past expiry.
export function daysToExpiry(expirySec, nowMs = Date.now()) {
  const exp = num(expirySec);
  const p = etParts(new Date(nowMs).toISOString());
  if (exp == null || !p) return null;
  const todayUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return Math.round((exp * 1000 - todayUtc) / 86400000);
}

// Stable, readable trade id: SYMBOL-C|P-MM/DD/YY-HH:MM (entry time, ET,
// 24-hour). One symbol:side is open at a time, so the entry stamp makes it
// unique. Copies before 2026-10-21 wrote it SYMBOL-C|P-YYMMDD-HHMM; the feed
// header's legend explains the mapping.
export function pickTradeId(e) {
  const p = etParts(e?.entryDate);
  const side = e?.side === "put" ? "P" : "C";
  const stamp = p ? `${p.month}/${p.day}/${p.year.slice(-2)}-${p.hour}:${p.minute}` : "00/00/00-00:00";
  return `${e?.symbol || "?"}-${side}-${stamp}`;
}

export function etTimeText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return ET_TIME.format(d) + " ET";
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

function pnlText(pnl) {
  return pnl == null ? "" : ` (${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%)`;
}

// --- Block layout ------------------------------------------------------------
// Each trade is a labeled block (one field per line, a blank line between
// trades), easy to read in a browser and unambiguous for an agent.
const RULE = "=".repeat(60);
const LABEL_W = 10;

function block(kind, e, fields) {
  const rows = fields
    .filter(([, v]) => v)
    .map(([label, v]) => `  ${(label + ":").padEnd(LABEL_W)}${v}`);
  return [`${kind}  ${pickTradeId(e)}`, ...rows].join("\n");
}

function sentenceCase(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function expiryField(e, nowMs) {
  const d = daysToExpiry(e?.contract?.expiry, nowMs);
  if (d == null || d > 5) return null;
  const date = expiryText(e.contract.expiry);
  if (d < 0) return `Expired on ${date}. Mingstreet closes it at the next Top Picks run.`;
  const when = d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  return `Expires ${when} (${date}). Mingstreet doesn't close it before expiry, so sell before the 4:00 PM ET close on ${date} if you don't want it exercised or to expire.`;
}

export function pickOpenBlock(e, nowMs = Date.now()) {
  const c = e?.contract || {};
  const px = entryPrice(e);
  const mark = markPrice(e);
  const credit = c.structure === "credit_vertical";
  const spread = c.structure === "debit_vertical" || credit;
  const priceWord = credit ? "Net credit of about " : spread ? "Net debit of about " : "About ";
  return block("OPEN", e, [
    ["Action", credit ? "Sell to open" : "Buy to open"],
    ["Contract", contractText(e)],
    ["Entry", `${priceWord}${money(px)} per share${perContract(px)}`],
    ["Latest", mark == null ? null : `${money(mark)}${pnlText(num(e?.optionPnlPct))}, Mingstreet model`],
    ["Opened", etTimeText(e.entryDate)],
    ["Order", "Use a limit order near the current mid. Mingstreet's prices are model mids, not fills."],
    ["Expiry", expiryField(e, nowMs)],
    ["Note", spread ? "2-leg spread. Robinhood agents can't place multi-leg orders, so place it by hand or skip it." : null],
  ]);
}

export function pickCloseBlock(e) {
  const c = e?.contract || {};
  const credit = c.structure === "credit_vertical";
  const spread = c.structure === "debit_vertical" || credit;
  const px = markPrice(e);
  const pnl = num(e?.optionPnlPct);
  const pnlPart = pnl == null ? "" : `, ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`;
  if (e?.status === "expired") {
    return block("CLOSE", e, [
      ["Action", "Nothing to sell"],
      ["Contract", contractText(e)],
      ["Reason", `Expired on ${expiryText(c.expiry)}${pnlPart}`],
      ["Booked", `${etTimeText(e.exitDate)}, after the contract was gone`],
      ["Note", "If you still held it at expiry, Robinhood closed, exercised or expired it. Check your account."],
    ]);
  }
  const reason = sentenceCase(CLOSE_REASON[e?.status] || e?.status || "closed");
  return block("CLOSE", e, [
    ["Action", credit ? "Buy to close" : "Sell to close"],
    ["Contract", contractText(e)],
    ["Reason", `${reason}${pnlPart}`],
    ["Price", `${money(px)} per share${perContract(px)}, Mingstreet model`],
    ["Closed", etTimeText(e.exitDate)],
    ["Order", "Use a limit order near the current mid."],
    ["Note", spread ? "2-leg spread. Robinhood agents can't place multi-leg orders, so close it by hand." : null],
  ]);
}

function section(title, blocks, empty) {
  return [RULE, title, RULE, "", ...(blocks.length ? [blocks.join("\n\n")] : [empty])];
}

// The whole feed as plain text: header, open trades (newest first), then the
// closes from the last `closeDays` days (newest first).
export function buildPicksFeedText(acc, { nowMs = Date.now(), closeDays = 7 } = {}) {
  const open = (Array.isArray(acc?.open) ? acc.open : []).filter((e) => e && e.contract);
  const closed = Array.isArray(acc?.closed) ? acc.closed : [];
  const byDateDesc = (k) => (a, b) => (Date.parse(b?.[k]) || 0) - (Date.parse(a?.[k]) || 0);
  open.sort(byDateDesc("entryDate"));
  const cutoff = nowMs - closeDays * 86400000;
  const recent = closed.filter((c) => c && c.contract && (Date.parse(c.exitDate) || 0) >= cutoff).sort(byDateDesc("exitDate"));
  const lines = [
    "MINGSTREET TOP PICKS: TRADE LINES",
    "",
    `  ${"Updated:".padEnd(LABEL_W)}${acc?.builtAtIso ? etTimeText(acc.builtAtIso) : "unknown"}`,
    `  ${"Runs:".padEnd(LABEL_W)}11:00 and 15:30 ET on trading days`,
    `  ${"Prices:".padEnd(LABEL_W)}Per share. 1 contract = 100 shares.`,
    `  ${"Rule:".padEnd(LABEL_W)}Open each trade once. Close it only when its CLOSE entry appears.`,
    `  ${"ID:".padEnd(LABEL_W)}TICKER-C/P-MM/DD/YY-HH:MM. C = call, P = put. The date and time are when Mingstreet opened the trade (ET, 24-hour). A CLOSE uses the same ID as its OPEN.`,
    `  ${"Old IDs:".padEnd(LABEL_W)}Copies from before Oct 21, 2026 wrote the same ID as TICKER-C/P-YYMMDD-HHMM, so SPOT-C-261009-1532 is SPOT-C-10/09/26-15:32.`,
    "",
    ...section(`OPEN TRADES (${open.length})`, open.map((e) => pickOpenBlock(e, nowMs)), "None open right now."),
    "",
    ...section(`CLOSED IN THE LAST ${closeDays} DAYS (${recent.length})`, recent.map(pickCloseBlock), "None."),
  ];
  return lines.join("\n") + "\n";
}
