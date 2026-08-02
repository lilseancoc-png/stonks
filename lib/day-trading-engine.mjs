// Deterministic intraday execution + paper-portfolio engine.
//
// This is intentionally pure: the scanner supplies live quotes, 5-minute index
// context, option marks and already-baked technical/calendar inputs. The engine
// owns scoring, entry/exit decisions, sizing and accounting. No AI, no orders.

export const DAY_TRADING_VERSION = 1;

export const DAY_TRADING_RULES = Object.freeze({
  startingEquity: 10_000,
  resetBelow: 2_000,
  maxTradesPerSession: 8,
  minTradesPerSession: 0,
  entryStartEtMin: 10 * 60 + 30,
  entryCutoffEtMin: 14 * 60 + 30,
  forceFlatEtMin: 15 * 60 + 55,
  maxHoldMinutes: 75,
  maxPositionPct: 0.25,
  baseScore: 72,
  neutralScore: 82,
  options: Object.freeze({
    dailyLossPct: -0.07,
    softLossPct: -0.035,
    profitLockPct: 0.035,
    weeklyLossPct: -0.135,
    maxConcurrentRiskPct: 0.025,
    riskMinPct: 0.005,
    riskMaxPct: 0.01,
    stopPct: 0.35,
    scalePct: 0.35,
    targetPct: 0.70,
    commissionPerContract: 0.65,
    slippagePct: 0.03,
  }),
  stock: Object.freeze({
    dailyLossPct: -0.05,
    softLossPct: -0.03,
    profitLockPct: 0.035,
    weeklyLossPct: -0.135,
    riskMinPct: 0.004,
    riskMaxPct: 0.008,
    commissionPerShare: 0.005,
    slippagePct: 0.0005,
  }),
});

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return null;
  const k = 10 ** digits;
  return Math.round(Number(value) * k) / k;
};
const sum = (rows, fn) => rows.reduce((total, row) => total + (Number(fn(row)) || 0), 0);

export function etClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    minute: hour * 60 + Number(p.minute),
  };
}

function weekKey(date = new Date()) {
  const d = new Date(`${etClock(date).date}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function newBook(kind) {
  return {
    kind,
    startingEquity: DAY_TRADING_RULES.startingEquity,
    resetEquity: DAY_TRADING_RULES.startingEquity,
    trueEquity: DAY_TRADING_RULES.startingEquity,
    highWaterMark: DAY_TRADING_RULES.startingEquity,
    weekKey: null,
    weekStartEquity: DAY_TRADING_RULES.startingEquity,
    dayKey: null,
    dayStartEquity: DAY_TRADING_RULES.startingEquity,
    dayRealized: 0,
    tradesToday: 0,
    dailyStopHits: 0,
    lastDailyStopDay: null,
    resets: [],
    open: [],
    closed: [],
    equityCurve: [],
  };
}

export function emptyDayTradingHistory() {
  return {
    version: DAY_TRADING_VERSION,
    updatedAt: null,
    portfolios: { options: newBook("options"), stock: newBook("stock") },
    sessions: [],
  };
}

export function normalizeHistory(raw) {
  const base = emptyDayTradingHistory();
  const out = raw && typeof raw === "object" ? raw : base;
  out.version = DAY_TRADING_VERSION;
  out.portfolios ||= {};
  for (const kind of ["options", "stock"]) {
    out.portfolios[kind] = { ...newBook(kind), ...(out.portfolios[kind] || {}) };
    const book = out.portfolios[kind];
    for (const key of ["open", "closed", "resets", "equityCurve"]) {
      if (!Array.isArray(book[key])) book[key] = [];
    }
  }
  if (!Array.isArray(out.sessions)) out.sessions = [];
  return out;
}

function rollBook(book, now) {
  const clock = etClock(now);
  const wk = weekKey(now);
  if (book.weekKey !== wk) {
    book.weekKey = wk;
    book.weekStartEquity = book.resetEquity;
  }
  if (book.dayKey !== clock.date) {
    book.dayKey = clock.date;
    book.dayStartEquity = book.resetEquity;
    book.dayRealized = 0;
    book.tradesToday = 0;
  }
}

function bookPolicy(book) {
  const rules = DAY_TRADING_RULES[book.kind];
  const dayPct = book.dayStartEquity > 0 ? book.dayRealized / book.dayStartEquity : 0;
  const weekPct = book.weekStartEquity > 0 ? (book.resetEquity - book.weekStartEquity) / book.weekStartEquity : 0;
  const drawdownPct = book.highWaterMark > 0 ? (book.resetEquity - book.highWaterMark) / book.highWaterMark : 0;
  const hardStopped = dayPct <= rules.dailyLossPct;
  const weeklyCut = weekPct <= rules.weeklyLossPct;
  const profitLocked = dayPct >= rules.profitLockPct;
  const softWarning = dayPct <= rules.softLossPct;
  const highWaterCut = drawdownPct <= -0.10;
  return {
    dayPct,
    weekPct,
    drawdownPct,
    hardStopped,
    weeklyCut,
    profitLocked,
    softWarning,
    sizeMultiplier: hardStopped || weeklyCut ? 0 : (profitLocked || softWarning || highWaterCut ? 0.5 : 1),
    thresholdAdd: softWarning ? 8 : weeklyCut ? 99 : 0,
  };
}

function applyPnl(book, dollars, now, reason) {
  if (!Number.isFinite(dollars)) return;
  book.resetEquity = round(book.resetEquity + dollars, 2);
  book.trueEquity = round(book.trueEquity + dollars, 2);
  book.dayRealized = round(book.dayRealized + dollars, 2);
  book.highWaterMark = Math.max(book.highWaterMark, book.resetEquity);
  book.equityCurve.push({ at: now.toISOString(), reset: book.resetEquity, true: book.trueEquity, reason });
  book.equityCurve = book.equityCurve.slice(-2500);
  if (book.resetEquity < DAY_TRADING_RULES.resetBelow) {
    book.resets.push({ at: now.toISOString(), from: book.resetEquity, to: DAY_TRADING_RULES.startingEquity });
    book.resetEquity = DAY_TRADING_RULES.startingEquity;
    book.dayStartEquity = book.resetEquity;
    book.highWaterMark = Math.max(book.highWaterMark, book.resetEquity);
    book.equityCurve.push({ at: now.toISOString(), reset: book.resetEquity, true: book.trueEquity, reason: "reset" });
  }
}

function optionExitUnit(mark) {
  const bid = Number(mark?.bid ?? mark?.last);
  if (!(bid >= 0)) return null;
  const fill = Math.max(0, bid * (1 - DAY_TRADING_RULES.options.slippagePct));
  return fill * 100 - DAY_TRADING_RULES.options.commissionPerContract;
}

function forcedFallbackMark(trade) {
  if (trade.book === "options") {
    const prior = Number(trade.lastMark);
    if (prior >= 0) return { bid: prior, _fallbackSource: "last-mark" };
    const entry = Number(trade.entryFill);
    return entry >= 0 ? { bid: entry, _fallbackSource: "entry-fill" } : null;
  }
  const prior = Number(trade.lastMark);
  if (prior > 0) return { spot: prior, _fallbackSource: "last-mark" };
  const entry = Number(trade.entrySpot);
  return entry > 0 ? { spot: entry, _fallbackSource: "entry-spot" } : null;
}

function stockExitUnit(trade, spot) {
  if (!(spot > 0)) return null;
  const slip = DAY_TRADING_RULES.stock.slippagePct;
  const fill = trade.direction === "long" ? spot * (1 - slip) : spot * (1 + slip);
  return fill;
}

function unrealizedPnl(trade, mark) {
  if (trade.book === "options") {
    const unit = optionExitUnit(mark);
    return unit == null ? null : (unit - trade.entryUnitCash) * trade.quantity;
  }
  const exit = stockExitUnit(trade, Number(mark?.spot));
  if (exit == null) return null;
  const gross = trade.direction === "long" ? exit - trade.entryFill : trade.entryFill - exit;
  return (gross - DAY_TRADING_RULES.stock.commissionPerShare) * trade.quantity;
}

function closeQuantity(book, trade, quantity, mark, now, outcome) {
  const qty = Math.min(trade.quantity, Math.max(0, Math.floor(quantity)));
  if (!qty) return 0;
  let pnl = 0;
  let exit = null;
  if (trade.book === "options") {
    const unit = optionExitUnit(mark);
    if (unit == null) return 0;
    pnl = (unit - trade.entryUnitCash) * qty;
    exit = unit / 100;
  } else {
    exit = stockExitUnit(trade, Number(mark?.spot));
    if (exit == null) return 0;
    const gross = trade.direction === "long" ? exit - trade.entryFill : trade.entryFill - exit;
    pnl = (gross - DAY_TRADING_RULES.stock.commissionPerShare) * qty;
  }
  trade.quantity -= qty;
  trade.realizedPnl = round((trade.realizedPnl || 0) + pnl, 2);
  trade.exits ||= [];
  const exitRow = { at: now.toISOString(), quantity: qty, fill: round(exit, 4), pnl: round(pnl, 2), outcome };
  if (mark?._fallbackSource) exitRow.markFallback = mark._fallbackSource;
  trade.exits.push(exitRow);
  applyPnl(book, pnl, now, outcome);
  return qty;
}

function finalizeTrade(book, trade, mark, now, outcome) {
  const qty = trade.quantity;
  if (qty > 0 && !closeQuantity(book, trade, qty, mark, now, outcome)) return false;
  trade.closedAt = now.toISOString();
  trade.outcome = outcome;
  trade.pnl = round(trade.realizedPnl || 0, 2);
  trade.pnlPctOfEntry = trade.initialCash > 0 ? round((trade.pnl / trade.initialCash) * 100, 2) : null;
  trade.holdMinutes = Math.round((now.getTime() - Date.parse(trade.openedAt)) / 60000);
  book.closed.push(trade);
  book.closed = book.closed.slice(-5000);
  return true;
}

function markBook(book, marks, now, forceReason = null) {
  const keep = [];
  for (const trade of book.open) {
    let mark = marks.get(trade.id) || marks.get(trade.symbol);
    if (!mark && forceReason) mark = forcedFallbackMark(trade);
    if (!mark) { keep.push(trade); continue; }
    let pnl = unrealizedPnl(trade, mark);
    if (pnl == null && forceReason) {
      mark = forcedFallbackMark(trade);
      pnl = unrealizedPnl(trade, mark);
    }
    if (pnl == null) { keep.push(trade); continue; }
    // Exit triggers are contract-return thresholds, independent of how much
    // was already scaled. Using the original whole-position cash after a 50%
    // scale would silently turn a +70% target into +140% on the remainder.
    const basis = trade.book === "options"
      ? Math.max(1, trade.entryUnitCash * trade.quantity)
      : (trade.initialCash || 1);
    const ret = pnl / basis;
    const held = (now.getTime() - Date.parse(trade.openedAt)) / 60000;
    trade.lastMark = book.kind === "options" ? round(Number(mark.bid ?? mark.last), 3) : round(Number(mark.spot), 3);
    trade.lastMarkedAt = now.toISOString();
    trade.maePct = round(Math.min(trade.maePct ?? 0, ret * 100), 2);
    trade.mfePct = round(Math.max(trade.mfePct ?? 0, ret * 100), 2);

    let outcome = forceReason;
    if (!outcome && book.kind === "options") {
      if (ret <= -DAY_TRADING_RULES.options.stopPct) outcome = "hard-stop";
      else if (ret >= DAY_TRADING_RULES.options.targetPct) outcome = "profit-target";
      else if (held >= DAY_TRADING_RULES.maxHoldMinutes) outcome = "time-stop";
      else if (!trade.scaled && ret >= DAY_TRADING_RULES.options.scalePct && trade.quantity >= 2) {
        closeQuantity(book, trade, Math.floor(trade.quantity / 2), mark, now, "scale-out");
        trade.scaled = true;
        trade.stopReturnPct = 0;
      } else if (trade.scaled && ret <= (trade.stopReturnPct || 0)) outcome = "trailing-stop";
    } else if (!outcome) {
      const spot = Number(mark.spot);
      const adverse = trade.direction === "long" ? spot <= trade.stop : spot >= trade.stop;
      const target = trade.direction === "long" ? spot >= trade.target : spot <= trade.target;
      const rNow = trade.riskPerShare > 0
        ? (trade.direction === "long" ? spot - trade.entrySpot : trade.entrySpot - spot) / trade.riskPerShare
        : 0;
      if (adverse) outcome = trade.scaled ? "trailing-stop" : "hard-stop";
      else if (target) outcome = "profit-target";
      else if (held >= DAY_TRADING_RULES.maxHoldMinutes) outcome = "time-stop";
      else if (!trade.scaled && rNow >= 1 && trade.quantity >= 2) {
        closeQuantity(book, trade, Math.floor(trade.quantity / 2), mark, now, "scale-out");
        trade.scaled = true;
        trade.stop = trade.direction === "long"
          ? Math.max(trade.stop, trade.entrySpot + trade.riskPerShare * 0.1)
          : Math.min(trade.stop, trade.entrySpot - trade.riskPerShare * 0.1);
      }
    }
    if (outcome && finalizeTrade(book, trade, mark, now, outcome)) continue;
    keep.push(trade);
  }
  book.open = keep;
}

function component(label, points, max, detail) {
  return { label, points: round(points, 1), max, detail };
}

export function scoreDayTradeCandidate(candidate, market) {
  const direction = candidate.direction;
  const sign = direction === "long" ? 1 : -1;
  const marketSign = market.bias === "long" ? 1 : market.bias === "short" ? -1 : 0;
  const components = [];

  const marketPts = marketSign === sign ? 20 : marketSign === 0 ? 8 : 0;
  components.push(component("Market bias", marketPts, 20, `${market.bias} (${market.biasScore ?? 0})`));

  const first = market.firstHour || {};
  const fhVals = [first.spyRetPct, first.qqqRetPct].filter(Number.isFinite);
  const fhAvg = fhVals.length ? sum(fhVals, (v) => v) / fhVals.length : 0;
  const fhPts = first.complete ? (Math.sign(fhAvg) === sign ? 15 : Math.abs(fhAvg) < 0.15 ? 7 : 0) : 0;
  components.push(component("First hour", fhPts, 15, first.complete ? `${round(fhAvg, 2)}% average` : "not locked"));

  const prior = Number(market.priorContextPct || 0);
  const priorPts = Math.sign(prior) === sign ? 10 : Math.abs(prior) < 0.2 ? 5 : 0;
  components.push(component("Index context", priorPts, 10, `${round(prior, 2)}% recent composite`));

  const gex = candidate.gex || {};
  const net = Number(gex.net);
  let gexPts = Number.isFinite(net) && net < 0 ? 8 : Number.isFinite(net) ? 5 : 3;
  const wall = direction === "long" ? Number(gex.callWall?.strike) : Number(gex.putWall?.strike);
  if (wall > 0 && ((direction === "long" && wall > candidate.spot) || (direction === "short" && wall < candidate.spot))) gexPts += 4;
  components.push(component("Gamma / positioning", Math.min(12, gexPts), 12, Number.isFinite(net) ? `${net < 0 ? "negative" : "positive"} net GEX` : "limited map"));

  const volRatio = Number(candidate.volumeRatio || 0);
  const srAligned = candidate.srBreak && ((candidate.srBreak.type === "upper" && sign > 0) || (candidate.srBreak.type === "lower" && sign < 0));
  const volumePts = clamp((volRatio - 1) * 7, 0, 10) + (srAligned ? 5 : 0);
  components.push(component("Volume trigger", Math.min(15, volumePts), 15, `${round(volRatio, 2)}× expected${srAligned ? " + S/R break" : ""}`));

  const tech = candidate.technicals || {};
  const rsi = Number(tech.rsi);
  const macd = Number(tech.macd?.hist);
  const sma20 = Number(tech.sma?.sma20);
  let techPts = 0;
  if (Number.isFinite(macd) && Math.sign(macd) === sign) techPts += 6;
  if (sma20 > 0 && Math.sign(candidate.spot - sma20) === sign) techPts += 5;
  if (Number.isFinite(rsi) && ((sign > 0 && rsi >= 45 && rsi <= 72) || (sign < 0 && rsi >= 28 && rsi <= 55))) techPts += 4;
  components.push(component("Technicals", techPts, 15, `RSI ${Number.isFinite(rsi) ? round(rsi, 1) : "—"}`));

  const grade = Number(candidate.grade || 0);
  const gradePts = Math.sign(grade) === sign ? clamp(Math.abs(grade) / 2, 2, 8) : 0;
  components.push(component("Cross-check", gradePts, 8, `Grade ${Number.isFinite(grade) ? grade : "—"}`));

  const total = round(sum(components, (row) => row.points), 1);
  const threshold = (market.bias === "neutral" ? DAY_TRADING_RULES.neutralScore : DAY_TRADING_RULES.baseScore) + (market.thresholdAdd || 0);
  const blocked = [];
  if (!market.firstHour?.complete) blocked.push("first hour not locked");
  if (market.event?.block) blocked.push(market.event.reason || "high-impact event window");
  if (market.marketOpen === false) blocked.push("regular session is not open");
  if (market.clock.minute < DAY_TRADING_RULES.entryStartEtMin) blocked.push("before 10:30 ET");
  if (market.clock.minute > DAY_TRADING_RULES.entryCutoffEtMin) blocked.push("new-entry cutoff passed");
  if (["Sat", "Sun"].includes(market.clock.weekday)) blocked.push("market closed");
  return { total, threshold, pass: total >= threshold && !blocked.length, components, blocked };
}

function stockLevels(candidate) {
  const spot = Number(candidate.spot);
  const tech = candidate.technicals || {};
  const atr = Number(candidate.atr) || spot * 0.012;
  const sr = tech.sr || {};
  const structure = candidate.direction === "long" ? Number(sr.s20) : Number(sr.r20);
  const rawRisk = clamp(atr, spot * 0.004, spot * 0.025);
  let stop = candidate.direction === "long" ? spot - rawRisk : spot + rawRisk;
  if (structure > 0) {
    if (candidate.direction === "long" && structure < spot && spot - structure <= spot * 0.025) stop = structure;
    if (candidate.direction === "short" && structure > spot && structure - spot <= spot * 0.025) stop = structure;
  }
  const risk = Math.abs(spot - stop);
  const target = candidate.direction === "long" ? spot + risk * 1.8 : spot - risk * 1.8;
  return { stop: round(stop, 2), target: round(target, 2), risk: round(risk, 4) };
}

function openStock(book, candidate, score, market, now) {
  const policy = bookPolicy(book);
  if (!policy.sizeMultiplier || book.tradesToday >= DAY_TRADING_RULES.maxTradesPerSession) return null;
  if (book.open.some((trade) => trade.symbol === candidate.symbol)) return null;
  const levels = stockLevels(candidate);
  if (!(levels.risk > 0)) return null;
  const confidence = clamp((score.total - score.threshold) / 20, 0, 1);
  const riskPct = DAY_TRADING_RULES.stock.riskMinPct + confidence * (DAY_TRADING_RULES.stock.riskMaxPct - DAY_TRADING_RULES.stock.riskMinPct);
  const sizeMult = policy.sizeMultiplier * (market.sizeMultiplier || 1);
  const riskBudget = book.resetEquity * riskPct * sizeMult;
  const slip = DAY_TRADING_RULES.stock.slippagePct;
  const entryFill = candidate.direction === "long" ? candidate.spot * (1 + slip) : candidate.spot * (1 - slip);
  // Cap against the cost-aware entry fill, not the unadjusted quote; otherwise
  // long-side slippage can push a nominal 25% allocation just over the hard cap.
  const capShares = Math.floor((book.resetEquity * DAY_TRADING_RULES.maxPositionPct * sizeMult) / entryFill);
  const quantity = Math.max(0, Math.min(capShares, Math.floor(riskBudget / levels.risk)));
  if (!quantity) return null;
  return {
    id: `${market.clock.date}|stock|${candidate.symbol}|${now.getTime()}`,
    book: "stock", symbol: candidate.symbol, sector: candidate.sector || "Unknown",
    direction: candidate.direction, openedAt: now.toISOString(), session: market.clock.date,
    entrySpot: round(candidate.spot, 4), entryFill: round(entryFill, 4), quantity, initialQuantity: quantity,
    initialCash: round(quantity * entryFill, 2), riskPerShare: levels.risk,
    stop: levels.stop, target: levels.target, scaled: false, realizedPnl: 0,
    confidence: score.total, threshold: score.threshold, confluence: score.components,
    invalidation: candidate.direction === "long" ? `Underlying trades at or below $${levels.stop}` : `Underlying trades at or above $${levels.stop}`,
    timeExit: "75 minutes or 15:55 ET, whichever comes first",
    entryWindow: market.timeBucket,
    sizeMode: policy.sizeMultiplier * (market.sizeMultiplier || 1) < 0.75 ? "half" : "full",
  };
}

function openOption(book, candidate, score, market, now) {
  const opt = candidate.option;
  if (!opt || !(Number(opt.ask) > 0)) return null;
  const policy = bookPolicy(book);
  if (!policy.sizeMultiplier || book.tradesToday >= DAY_TRADING_RULES.maxTradesPerSession) return null;
  if (book.open.some((trade) => trade.symbol === candidate.symbol)) return null;
  const confidence = clamp((score.total - score.threshold) / 20, 0, 1);
  const riskPct = DAY_TRADING_RULES.options.riskMinPct + confidence * (DAY_TRADING_RULES.options.riskMaxPct - DAY_TRADING_RULES.options.riskMinPct);
  const sizeMult = policy.sizeMultiplier * (market.sizeMultiplier || 1);
  const entryFill = Number(opt.ask) * (1 + DAY_TRADING_RULES.options.slippagePct);
  const entryUnitCash = entryFill * 100 + DAY_TRADING_RULES.options.commissionPerContract;
  const riskPerContract = entryUnitCash * DAY_TRADING_RULES.options.stopPct;
  const riskBudget = book.resetEquity * riskPct * sizeMult;
  const capContracts = Math.floor((book.resetEquity * DAY_TRADING_RULES.maxPositionPct * sizeMult) / entryUnitCash);
  const heatUsed = sum(book.open, (trade) => trade.entryUnitCash * trade.quantity * DAY_TRADING_RULES.options.stopPct);
  const heatLeft = Math.max(0, book.resetEquity * DAY_TRADING_RULES.options.maxConcurrentRiskPct - heatUsed);
  const quantity = Math.max(0, Math.min(capContracts, Math.floor(riskBudget / riskPerContract), Math.floor(heatLeft / riskPerContract)));
  if (!quantity) return null;
  return {
    id: `${market.clock.date}|options|${candidate.symbol}|${now.getTime()}`,
    book: "options", symbol: candidate.symbol, sector: candidate.sector || "Unknown",
    direction: candidate.direction, optionSide: opt.side, expiry: opt.expiry, strike: opt.strike,
    openedAt: now.toISOString(), session: market.clock.date, entrySpot: round(candidate.spot, 4),
    entryFill: round(entryFill, 4), entryUnitCash: round(entryUnitCash, 4), quantity, initialQuantity: quantity,
    initialCash: round(entryUnitCash * quantity, 2), scaled: false, stopReturnPct: -DAY_TRADING_RULES.options.stopPct,
    realizedPnl: 0, confidence: score.total, threshold: score.threshold, confluence: score.components,
    invalidation: `${opt.side.toUpperCase()} premium falls 35% or the underlying thesis invalidates`,
    profitPlan: "Scale 50% at +35%; trail the rest; final target +70%",
    timeExit: "75 minutes or 15:55 ET, whichever comes first",
    entryWindow: market.timeBucket,
    sizeMode: policy.sizeMultiplier * (market.sizeMultiplier || 1) < 0.75 ? "half" : "full",
  };
}

function correlationBlocked(book, candidate) {
  const aligned = book.open.filter((trade) => trade.direction === candidate.direction);
  const sectorAligned = aligned.filter((trade) => trade.sector === candidate.sector);
  return aligned.length >= 3 || sectorAligned.length >= 2;
}

function flattenOnRisk(book, marks, now) {
  const policy = bookPolicy(book);
  const openPnl = sum(book.open, (trade) => unrealizedPnl(trade, marks.get(trade.id) || marks.get(trade.symbol)) || 0);
  const rules = DAY_TRADING_RULES[book.kind];
  const totalDayPct = book.dayStartEquity > 0 ? (book.dayRealized + openPnl) / book.dayStartEquity : 0;
  if (!policy.hardStopped && totalDayPct > rules.dailyLossPct) return false;
  if (book.lastDailyStopDay !== book.dayKey) {
    book.dailyStopHits += 1;
    book.lastDailyStopDay = book.dayKey;
  }
  markBook(book, marks, now, "daily-loss-stop");
  return true;
}

function bookSummary(book, marks, now) {
  const openPnl = sum(book.open, (trade) => unrealizedPnl(trade, marks.get(trade.id) || marks.get(trade.symbol)) || 0);
  const policy = bookPolicy(book);
  const closed = book.closed;
  const wins = closed.filter((trade) => trade.pnl > 0);
  const losses = closed.filter((trade) => trade.pnl < 0);
  const grossWin = sum(wins, (trade) => trade.pnl);
  const grossLoss = Math.abs(sum(losses, (trade) => trade.pnl));
  let truePeak = book.startingEquity;
  let trueMaxDrawdown = 0;
  let drawdownStartedAt = null;
  let longestRecoveryHours = 0;
  for (const point of book.equityCurve) {
    const equity = Number(point.true);
    if (!Number.isFinite(equity)) continue;
    if (equity >= truePeak) {
      if (drawdownStartedAt != null) {
        longestRecoveryHours = Math.max(longestRecoveryHours, (Date.parse(point.at) - drawdownStartedAt) / 36e5);
        drawdownStartedAt = null;
      }
      truePeak = equity;
    } else {
      if (drawdownStartedAt == null) drawdownStartedAt = Date.parse(point.at);
      trueMaxDrawdown = Math.min(trueMaxDrawdown, (equity - truePeak) / truePeak);
    }
  }
  if (drawdownStartedAt != null) {
    longestRecoveryHours = Math.max(longestRecoveryHours, (now.getTime() - drawdownStartedAt) / 36e5);
  }
  return {
    resetEquity: book.resetEquity,
    trueEquity: book.trueEquity,
    openPnl: round(openPnl, 2),
    dayRealized: book.dayRealized,
    dayPct: round(policy.dayPct * 100, 2),
    weekPct: round(policy.weekPct * 100, 2),
    drawdownPct: round(policy.drawdownPct * 100, 2),
    tradesToday: book.tradesToday,
    openCount: book.open.length,
    closedCount: closed.length,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avgWin: wins.length ? round(grossWin / wins.length, 2) : null,
    avgLoss: losses.length ? round(-grossLoss / losses.length, 2) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    averageMaePct: closed.length ? round(sum(closed, (trade) => trade.maePct || 0) / closed.length, 2) : null,
    trueMaxDrawdownPct: round(trueMaxDrawdown * 100, 2),
    longestRecoveryHours: round(longestRecoveryHours, 1),
    dailyStopHits: book.dailyStopHits,
    resets: book.resets.length,
    policy,
  };
}

export function runDayTradingEngine({ history: rawHistory, candidates = [], market, marks = new Map(), now = new Date() }) {
  const history = normalizeHistory(rawHistory);
  history.updatedAt = now.toISOString();
  market.clock ||= etClock(now);
  market.timeBucket = market.clock.minute < 11 * 60 + 30 ? "first-hour-follow-through"
    : market.clock.minute >= 15 * 60 ? "last-hour" : "mid-day";

  for (const book of Object.values(history.portfolios)) {
    rollBook(book, now);
    const force = market.clock.minute >= DAY_TRADING_RULES.forceFlatEtMin ? "session-close" : null;
    markBook(book, marks, now, force);
    flattenOnRisk(book, marks, now);
  }

  const decisions = [];
  const ranked = candidates.map((candidate) => ({ candidate, score: scoreDayTradeCandidate(candidate, market) }))
    .sort((a, b) => b.score.total - a.score.total);
  for (const row of ranked) {
    const { candidate, score } = row;
    const reasons = [...score.blocked];
    if (!score.pass) reasons.push(score.total < score.threshold ? `score ${score.total} below ${score.threshold}` : "risk gate");
    const opened = [];
    if (score.pass) {
      for (const kind of ["options", "stock"]) {
        const book = history.portfolios[kind];
        const policy = bookPolicy(book);
        if (correlationBlocked(book, candidate)) { reasons.push(`${kind}: correlation/heat cap`); continue; }
        if (!policy.sizeMultiplier) { reasons.push(`${kind}: daily/weekly stop`); continue; }
        if (score.total < score.threshold + policy.thresholdAdd) {
          reasons.push(`${kind}: soft-loss score bar ${score.threshold + policy.thresholdAdd}`);
          continue;
        }
        const trade = kind === "options"
          ? openOption(book, candidate, score, market, now)
          : openStock(book, candidate, score, market, now);
        if (!trade) { reasons.push(`${kind}: sizing/liquidity cap`); continue; }
        book.open.push(trade);
        book.tradesToday += 1;
        opened.push(kind);
      }
    }
    decisions.push({
      symbol: candidate.symbol, direction: candidate.direction, score: score.total,
      threshold: score.threshold, status: opened.length ? "opened" : score.pass ? "blocked" : "rejected",
      opened, reasons: [...new Set(reasons)], components: score.components,
    });
  }

  const summaries = {
    options: bookSummary(history.portfolios.options, marks, now),
    stock: bookSummary(history.portfolios.stock, marks, now),
  };
  const session = history.sessions.find((row) => row.date === market.clock.date) || { date: market.clock.date };
  Object.assign(session, {
    updatedAt: now.toISOString(), bias: market.bias, firstHour: market.firstHour,
    optionsPnl: summaries.options.dayRealized, stockPnl: summaries.stock.dayRealized,
    optionsTrades: history.portfolios.options.tradesToday, stockTrades: history.portfolios.stock.tradesToday,
  });
  history.sessions = history.sessions.filter((row) => row.date !== market.clock.date).concat(session).slice(-260);

  return {
    history,
    snapshot: {
      version: DAY_TRADING_VERSION,
      updatedAt: now.toISOString(),
      etDate: market.clock.date,
      status: market.clock.minute < DAY_TRADING_RULES.entryStartEtMin ? "waiting-first-hour"
        : market.clock.minute > DAY_TRADING_RULES.entryCutoffEtMin ? "entries-closed" : "scanning",
      market,
      rules: DAY_TRADING_RULES,
      portfolios: summaries,
      open: {
        options: history.portfolios.options.open,
        stock: history.portfolios.stock.open,
      },
      decisions: decisions.slice(0, 20),
    },
  };
}
