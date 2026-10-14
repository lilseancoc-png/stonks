// Paper tracking for LEAPS ideas. Pure: no IO, no quotes fetch, no AI.
//
// The bake calls this only when a LEAPS picks list is non-empty. Fills,
// marks, and exits are point-in-time: a quote or stock print is used for a
// session only when it is undated (the caller asserts it is that session's
// close) or stamped with that session's YYYY-MM-DD. A later or earlier stamp
// is ignored.
//
// Enrollment fills at the idea's ask. There is no mid fill. One open or
// frozen position per underlying, and an idea id never enrolls twice. A roll
// is the only path that opens another position for an idea that already has
// one: the old position closes with reason "roll" and, when the new contract
// has a positive ask, the replacement opens the same session with rolledFrom
// set to the closed id.
//
// Exit priority on a session, first match wins:
//   expired (intrinsic from the last underlying close; the option mid is not used)
//   target, doubled, flag
//   roll
//   time (first session on or after six calendar months before expiration)
// Same-day target / doubled / flag / time therefore record target, then
// doubled, then flag, then time. A roll requested on the six-month session
// records "roll" and opens the replacement; target, doubled, and flag still
// beat that roll. Nothing here uses a +20% / -50% option exit.
//
// A missing quote, a zero bid, or a spread wider than half the mid does not
// close the position and does not become the mark. The last good mark stays.
// After five such trading sessions (sessions this function actually processed,
// not calendar gaps) the open position is flagged for review and kept open.
// The review flag stays after a later good print. The entry session does not
// count: the ask fill is that session's known price.
//
// A split, strike change, or symbol change freezes the position in place.
// Marks and P&L stay on the last good price. A frozen name still occupies
// its one open slot.

export const LEAPS_PAPER_KEY = "leaps-paper.json";
export const LEAPS_PAPER_VERSION = 1;
export const LEAPS_CONTRACT_MULTIPLIER = 100;
export const LEAPS_TIME_EXIT_MONTHS = 6;
export const LEAPS_STALE_REVIEW_DAYS = 5;
export const LEAPS_SPREAD_OF_MID = 0.5;

const CORPORATE_ACTIONS = new Set(["split", "strike-change", "symbol-change"]);

export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addCalendarMonths(iso, months) {
  if (!isIsoDate(iso) || !Number.isInteger(months)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(monthIndex / 12);
  const month0 = monthIndex - nextYear * 12;
  const lastDay = new Date(Date.UTC(nextYear, month0 + 1, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  return `${nextYear}-${String(month0 + 1).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

export function calendarDaysBetween(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function leapsTimeExitDate(expiration) {
  return addCalendarMonths(expiration, -LEAPS_TIME_EXIT_MONTHS);
}

export function leapsContractKey({ symbol, side = "call", strike, expiration }) {
  const name = String(symbol || "").toUpperCase();
  const right = side === "put" ? "put" : "call";
  return `${name}|${right}|${strike}|${expiration}`;
}

export function shouldWriteLeapsPaper(ideas) {
  return Array.isArray(ideas) && ideas.length > 0;
}

export function emptyLeapsPaperBook() {
  return {
    version: LEAPS_PAPER_VERSION,
    key: LEAPS_PAPER_KEY,
    asOf: null,
    lastProcessedDate: null,
    nextId: 1,
    positions: [],
    ideas: {},
    summary: { open: 0, closed: 0, frozen: 0, review: 0 },
  };
}

function roundCents(value) {
  return Math.round(value * 100) / 100;
}

function roundMark(value) {
  return Math.round(value * 10000) / 10000;
}

function contractPnl(entryAsk, price, quantity) {
  return roundCents((price - entryAsk) * LEAPS_CONTRACT_MULTIPLIER * quantity);
}

function validAsk(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function validTarget(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validQuantity(value) {
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function addFlag(position, flag) {
  if (!position.flags.includes(flag)) position.flags.push(flag);
}

function explicitAction(value) {
  if (value === "strike") return "strike-change";
  if (value === "symbol") return "symbol-change";
  return CORPORATE_ACTIONS.has(value) ? value : null;
}

export function advanceLeapsPaperTrack({ book = null, asOf, ideas = [], quotes = {}, stocks = {} } = {}) {
  if (!isIsoDate(asOf)) throw new TypeError("leaps paper asOf must be YYYY-MM-DD");
  const next = cloneBook(book);
  if (next.lastProcessedDate && asOf <= next.lastProcessedDate) return finalize(next);

  const ideaById = new Map();
  const list = Array.isArray(ideas) ? ideas : [];
  for (const idea of list) {
    if (idea && idea.id != null && idea.id !== "") ideaById.set(String(idea.id), idea);
  }
  const ctx = { asOf, ideaById, quotes: quotes && typeof quotes === "object" ? quotes : {}, stocks: stocks && typeof stocks === "object" ? stocks : {} };

  const pending = next.positions.filter((position) => position.status === "open" || position.status === "frozen");
  for (const position of pending) processPosition(position, ctx, next);

  const enrollable = list
    .filter((idea) => idea && idea.id != null)
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const idea of enrollable) {
    if (!canEnroll(idea, next)) continue;
    processPosition(createPosition(next, idea, asOf, { rolledFrom: null }), ctx, next);
  }

  next.lastProcessedDate = asOf;
  next.asOf = asOf;
  return finalize(next);
}

function cloneBook(book) {
  const next = emptyLeapsPaperBook();
  if (book == null) return next;
  if (typeof book !== "object" || Array.isArray(book)) throw new TypeError("leaps paper book must be an object");
  if (book.version != null && book.version !== LEAPS_PAPER_VERSION) {
    throw new Error(`unsupported leaps paper version: ${book.version}`);
  }
  next.nextId = Number.isInteger(book.nextId) && book.nextId >= 1 ? book.nextId : 1;
  next.lastProcessedDate = isIsoDate(book.lastProcessedDate) ? book.lastProcessedDate : null;
  next.asOf = next.lastProcessedDate;
  next.positions = (Array.isArray(book.positions) ? book.positions : []).map((position) => structuredClone(position));
  return next;
}

function finalize(book) {
  book.version = LEAPS_PAPER_VERSION;
  book.key = LEAPS_PAPER_KEY;
  book.ideas = ideaRollups(book.positions);
  book.summary = {
    open: book.positions.filter((position) => position.status === "open").length,
    closed: book.positions.filter((position) => position.status === "closed").length,
    frozen: book.positions.filter((position) => position.status === "frozen").length,
    review: book.positions.filter((position) => position.review === true && position.status !== "closed").length,
  };
  return book;
}

function ideaRollups(positions) {
  const byId = new Map();
  for (const position of positions) {
    let row = byId.get(position.ideaId);
    if (!row) {
      row = {
        id: position.ideaId,
        symbol: position.symbol,
        pnl: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        positionIds: [],
      };
      byId.set(position.ideaId, row);
    }
    row.positionIds.push(position.id);
    const pnl = typeof position.pnl === "number" && Number.isFinite(position.pnl) ? position.pnl : 0;
    if (position.status === "closed") row.realizedPnl = roundCents(row.realizedPnl + pnl);
    else row.unrealizedPnl = roundCents(row.unrealizedPnl + pnl);
  }
  const ideas = {};
  for (const id of [...byId.keys()].sort()) {
    const row = byId.get(id);
    row.pnl = roundCents(row.realizedPnl + row.unrealizedPnl);
    ideas[id] = row;
  }
  return ideas;
}

function canEnroll(idea, book) {
  if (!idea || typeof idea !== "object" || idea.active === false) return false;
  if (idea.id == null || idea.id === "") return false;
  if (typeof idea.symbol !== "string" || !idea.symbol.trim()) return false;
  if (idea.side != null && idea.side !== "call" && idea.side !== "put") return false;
  if (typeof idea.strike !== "number" || !Number.isFinite(idea.strike) || idea.strike <= 0) return false;
  if (!isIsoDate(idea.expiration)) return false;
  if (validAsk(idea.ask) == null) return false;
  const ideaId = String(idea.id);
  if (book.positions.some((position) => position.ideaId === ideaId)) return false;
  const symbol = idea.symbol.toUpperCase();
  return !book.positions.some((position) => position.symbol === symbol && (position.status === "open" || position.status === "frozen"));
}

function createPosition(book, idea, asOf, { rolledFrom }) {
  const id = `lp-${book.nextId}`;
  book.nextId += 1;
  const position = {
    id,
    ideaId: String(idea.id),
    symbol: String(idea.symbol).toUpperCase(),
    side: idea.side === "put" ? "put" : "call",
    strike: idea.strike,
    expiration: idea.expiration,
    target: validTarget(idea.target),
    quantity: validQuantity(idea.quantity),
    entryDate: asOf,
    entryAsk: validAsk(idea.ask),
    rolledFrom: rolledFrom || null,
    status: "open",
    lastProcessedDate: null,
    lastGoodMark: validAsk(idea.ask),
    lastGoodMarkDate: asOf,
    lastStockClose: null,
    lastStockCloseDate: null,
    stale: false,
    staleTradingDays: 0,
    review: false,
    frozen: false,
    freezeReason: null,
    flags: [],
    lastQuote: "entry",
    mark: validAsk(idea.ask),
    markDate: asOf,
    exit: null,
    pnl: 0,
  };
  book.positions.push(position);
  return position;
}

function processPosition(position, ctx, book) {
  if (position.status === "closed") return;
  if (position.lastProcessedDate === ctx.asOf) return;
  if (position.status === "frozen") {
    position.lastProcessedDate = ctx.asOf;
    return;
  }

  const idea = ctx.ideaById.get(position.ideaId) || null;
  const assessed = assessQuote(lookupQuote(ctx.quotes, position), ctx.asOf);
  const action = detectCorporateAction(position, idea, assessed);
  if (action) {
    freezePosition(position, action, ctx.asOf);
    return;
  }

  const stock = assessStock(lookupStock(ctx.stocks, position.symbol), ctx.asOf);
  if (stock.state === "good") {
    position.lastStockClose = stock.close;
    position.lastStockCloseDate = ctx.asOf;
  }

  if (ctx.asOf >= position.expiration) {
    const price = intrinsicValue(position);
    if (price == null) addFlag(position, "expired-unpriced");
    closePosition(position, "expired", price, ctx.asOf);
    return;
  }

  const rollTo = rollRequest(idea, position);
  const reason = exitReason(position, idea, assessed, stock, ctx.asOf, rollTo);
  if (reason === "roll") {
    const opened = applyRoll(position, rollTo, assessed, ctx.asOf, book);
    if (opened) processPosition(opened, ctx, book);
    return;
  }
  if (reason) {
    closePosition(position, reason, exitPrice(reason, position, assessed), ctx.asOf);
    return;
  }
  markPosition(position, assessed, ctx.asOf);
}

function lookupQuote(quotes, position) {
  return quotes[leapsContractKey(position)] || null;
}

function lookupStock(stocks, symbol) {
  if (!stocks) return null;
  if (Object.prototype.hasOwnProperty.call(stocks, symbol)) return stocks[symbol];
  const upper = String(symbol || "").toUpperCase();
  if (Object.prototype.hasOwnProperty.call(stocks, upper)) return stocks[upper];
  return null;
}

function assessQuote(quote, asOf) {
  if (quote == null || typeof quote !== "object" || Array.isArray(quote)) return { state: "missing", quote: null };
  const stamp = quote.asOf ?? quote.date ?? null;
  if (stamp != null && (!isIsoDate(stamp) || stamp !== asOf)) return { state: "off-session", quote: null };
  const { bid, ask } = quote;
  if (typeof bid !== "number" || typeof ask !== "number" || !Number.isFinite(bid) || !Number.isFinite(ask)) {
    return { state: "missing", quote };
  }
  if (bid === 0) return { state: "bid-zero", quote };
  if (bid < 0 || ask <= 0 || ask < bid) return { state: "bad", quote };
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  if (!(mid > 0) || spread > mid * LEAPS_SPREAD_OF_MID) return { state: "wide-spread", quote };
  return { state: "good", mid: roundMark(mid), quote };
}

function assessStock(stock, asOf) {
  if (typeof stock === "number") {
    return Number.isFinite(stock) && stock > 0 ? { state: "good", close: stock } : { state: "missing" };
  }
  if (stock == null || typeof stock !== "object" || Array.isArray(stock)) return { state: "missing" };
  const stamp = stock.asOf ?? stock.date ?? null;
  if (stamp != null && (!isIsoDate(stamp) || stamp !== asOf)) return { state: "off-session" };
  const close = stock.close;
  if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return { state: "missing" };
  return { state: "good", close };
}

function detectCorporateAction(position, idea, assessed) {
  const quote = assessed.quote;
  const fromQuote = quote ? explicitAction(quote.corporateAction) : null;
  if (fromQuote) return fromQuote;
  const fromIdea = explicitAction(idea?.corporateAction);
  if (fromIdea) return fromIdea;
  if (quote) {
    if (typeof quote.symbol === "string" && quote.symbol.trim() && quote.symbol.toUpperCase() !== position.symbol) return "symbol-change";
    if (typeof quote.strike === "number" && Number.isFinite(quote.strike) && quote.strike !== position.strike) return "strike-change";
  }
  // The replacement opened by a roll keeps the idea's previous strike until the
  // desk publishes the new contract as the idea itself. That is not a split.
  if (matchesRollDestination(position, idea?.rollTo)) return null;
  if (rollRequest(idea, position)) return null;
  if (idea && idea.active !== false) {
    if (typeof idea.symbol === "string" && idea.symbol.trim() && idea.symbol.toUpperCase() !== position.symbol) return "symbol-change";
    if (typeof idea.strike === "number" && Number.isFinite(idea.strike) && idea.strike !== position.strike) return "strike-change";
  }
  return null;
}

function matchesRollDestination(position, rollTo) {
  if (!rollTo || typeof rollTo !== "object") return false;
  const symbol = String(rollTo.symbol || position.symbol).toUpperCase();
  const side = rollTo.side || position.side;
  return position.symbol === symbol
    && position.side === side
    && position.strike === rollTo.strike
    && position.expiration === rollTo.expiration;
}

function rollRequest(idea, position) {
  if (!idea || idea.active === false) return null;
  const rollTo = idea.rollTo;
  if (!matchesRollDestination(position, rollTo) && rollTo) return rollTo;
  return null;
}

function exitReason(position, idea, assessed, stock, asOf, rollTo) {
  if (targetHit(position, stock)) return "target";
  if (assessed.state === "good" && assessed.mid >= position.entryAsk * 2) return "doubled";
  if (idea?.exitFlag === true) return "flag";
  if (rollTo) return "roll";
  const threshold = leapsTimeExitDate(position.expiration);
  if (threshold && asOf >= threshold) return "time";
  return null;
}

function targetHit(position, stock) {
  if (stock.state !== "good" || position.target == null) return false;
  if (position.side === "put") return stock.close <= position.target;
  return stock.close >= position.target;
}

function exitPrice(reason, position, assessed) {
  if (reason === "doubled") return assessed.mid;
  if (assessed.state === "good") return assessed.mid;
  return position.lastGoodMark;
}

function intrinsicValue(position) {
  const close = position.lastStockClose;
  if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return null;
  if (position.side === "put") return roundMark(Math.max(0, position.strike - close));
  return roundMark(Math.max(0, close - position.strike));
}

function closePosition(position, reason, price, asOf) {
  const priced = typeof price === "number" && Number.isFinite(price);
  const pnl = priced ? contractPnl(position.entryAsk, price, position.quantity) : null;
  position.status = "closed";
  position.frozen = false;
  position.stale = false;
  position.lastProcessedDate = asOf;
  position.markDate = asOf;
  if (priced) position.mark = price;
  position.exit = { date: asOf, reason, price: priced ? price : null, pnl };
  position.pnl = pnl;
}

function applyRoll(position, rollTo, assessed, asOf, book) {
  const price = assessed.state === "good" ? assessed.mid : position.lastGoodMark;
  closePosition(position, "roll", price, asOf);
  const ask = validAsk(rollTo.ask);
  const symbol = String(rollTo.symbol || position.symbol).toUpperCase();
  const side = rollTo.side || position.side;
  const strike = rollTo.strike;
  const expiration = rollTo.expiration;
  if (ask == null || !symbol || (side !== "call" && side !== "put")) return null;
  if (typeof strike !== "number" || !Number.isFinite(strike) || strike <= 0 || !isIsoDate(expiration)) return null;
  return createPosition(book, {
    id: position.ideaId,
    symbol,
    side,
    strike,
    expiration,
    ask,
    target: typeof rollTo.target === "number" && Number.isFinite(rollTo.target) ? rollTo.target : position.target,
    quantity: position.quantity,
  }, asOf, { rolledFrom: position.id });
}

function freezePosition(position, kind, asOf) {
  position.status = "frozen";
  position.frozen = true;
  position.freezeReason = kind;
  position.lastProcessedDate = asOf;
  addFlag(position, kind);
  position.pnl = contractPnl(position.entryAsk, position.lastGoodMark, position.quantity);
}

function markPosition(position, assessed, asOf) {
  position.lastQuote = assessed.state;
  if (assessed.state === "good") {
    position.lastGoodMark = assessed.mid;
    position.lastGoodMarkDate = asOf;
    position.mark = assessed.mid;
    position.stale = false;
    position.staleTradingDays = 0;
  } else if (position.entryDate === asOf) {
    position.mark = position.lastGoodMark;
    position.stale = false;
  } else {
    position.mark = position.lastGoodMark;
    position.stale = true;
    position.staleTradingDays = (position.staleTradingDays || 0) + 1;
    if (position.staleTradingDays >= LEAPS_STALE_REVIEW_DAYS) {
      position.review = true;
      addFlag(position, "review");
    }
  }
  position.markDate = asOf;
  position.lastProcessedDate = asOf;
  position.pnl = contractPnl(position.entryAsk, position.mark, position.quantity);
}
