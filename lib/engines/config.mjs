// Strategy engines (2026-11-15): the registry. Six paper engines that run
// beside the flagship Top Picks, each on its own rules, its own data and its
// own track record (engines-record.json), all copied into the one Webull paper
// account. Nothing here reads or changes a Top Picks grade, gate or record.
//
// Pure data. No network, no AI. Spec: docs/engines.md.

export const ENGINES_VERSION = "engines-1";
export const RECORD_KEY = "engines-record.json";
export const STATE_KEY = "engines-state.json";
export const VIEW_KEY = "engines.json";
// First session the engines trade on paper (a Track Record divider date).
export const ENGINES_START = "2026-11-16";
export const FLAGSHIP = Object.freeze({ id: "flagship", tag: "TOP", name: "Top Picks" });
// The funds the Macro engine trades. They are read from the build's existing
// market sweep and chains (all are covered names or sweep symbols).
export const MACRO_ETFS = Object.freeze(["SPY", "QQQ", "IWM", "TLT", "GLD", "EWY", "KWEB"]);

// Book-wide limits (every engine together, the flagship not counted).
export const BOOK = Object.freeze({
  perRunTotal: 5,        // new engine trades per decision run (keeps the mirror inside its time budget)
  maxCost: 5000,         // one contract may cost at most this (the flagship's cap)
  minMid: 0.3,           // contracts under 30 cents are not traded
  maxSpreadPct: 18,      // bid/ask spread as % of the mid
  minOi: 50,             // open interest, or
  minVol: 10,            //   today's volume
  expiryExitSessions: 2, // close at the first run this many sessions before the expiration date (the mirror's own expiry control)
  reentrySessions: 5,    // sessions before an engine re-enters a name it just lost on
  closedKept: 3000,      // closed trades kept in the record file (older ones fold into `archive` totals)
  shadowOpenMax: 12,     // open shadow trades per engine
  shadowClosedKept: 400,
  candidatesKept: 12,    // candidates shown per engine per run
  costPts: 3.5,          // round-trip cost, % of premium, used by the history test only
});

// Exit reasons an engine can close a trade with (status on the record row).
export const CLOSE_LABEL = Object.freeze({
  "take-profit": "take-profit hit",
  "stop": "premium stop hit",
  "trail": "trailing stop hit",
  "stock-stop": "stock stop hit",
  "target": "price target reached",
  "time": "time limit reached",
  "event-exit": "closed before the event",
  "signal-gone": "setup no longer valid",
  "dte-exit": "closed before expiry",
  "expired": "contract expired",
  "left-coverage": "name left coverage (not counted)",
});
export const NOT_COUNTED = new Set(["left-coverage"]);

const freeze = (o) => Object.freeze(o);
const setup = (label, how, extra = {}) => freeze({ label, how, ...extra });

// A setup marked `probation: true` starts on shadow (tracked, not traded): it
// lost more than 3% a trade in BOTH halves of the first history test
// (2007-2016 and 2017-2026). It starts trading when 40+ shadow trades average
// +5% or better, clearly above zero (lib/engines/learn.mjs).
//
// One entry per engine. `bar` is the entry score (0-100 scale, the engine's
// own); the learning layer may move it inside [min, max]. `exits` are % of
// the entry premium. `contract` is what the engine buys: always one single
// long call or put.
export const ENGINES = freeze({
  earnings: freeze({
    id: "earnings", tag: "ERN", name: "Earnings & events",
    idea: "Trades the days around a company's own earnings report: the drift after a real surprise, and the run-in before a report for stocks that usually climb into it. Never holds a run-in trade through the report.",
    reads: ["Earnings dates and sessions", "EPS surprise and guidance", "Each stock's past reactions and run-ins", "Options-implied move vs past moves", "Daily prices and volume"],
    universe: "stocks", slots: 5, perRun: 2,
    contract: freeze({ dteMin: 21, dteIdeal: 35, dteMax: 60, delta: 0.55 }),
    exits: freeze({ tp: 30, stop: -40, maxSessions: 10 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    setups: freeze({
      "drift": setup("Post-earnings drift", "A beat (or miss) of 5%+ with a gap of 3%+ the same way that held. Enters 1 to 3 sessions after the report and rides up to 10 sessions."),
      "run-in": setup("Pre-earnings run-in", "A stock that rose into most of its last 8 reports, in an uptrend, 4 to 9 sessions before the next one. Always closed before the report.", { exits: { tp: 25, stop: -35, maxSessions: 8 } }),
    }),
    test: "replay",
  }),
  macro: freeze({
    id: "macro", tag: "MAC", name: "Macro",
    idea: "Trades index, bond, gold and Asia funds only, from rates, the dollar, financial conditions, the VIX curve and the reaction to Fed, CPI and jobs days.",
    reads: ["10-year and 2-year yields", "Chicago Fed financial conditions", "VIX against 3-month VIX", "Trade-weighted dollar", "Fed, CPI and jobs dates", "Fund prices (SPY, QQQ, IWM, TLT, GLD, EWY, KWEB)"],
    universe: "etfs", slots: 3, perRun: 1,
    contract: freeze({ dteMin: 21, dteIdeal: 40, dteMax: 70, delta: 0.5 }),
    exits: freeze({ tp: 30, stop: -40, maxSessions: 12 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    setups: freeze({
      "stress-on": setup("Conditions tightening", "Financial conditions tightened over four weeks, the VIX curve is flat or inverted and SPY is under its 50-day. Puts on the weaker index fund."),
      "stress-off": setup("Conditions easing", "Financial conditions eased over four weeks from a tight level, the VIX curve is back to normal and SPY is rising. Calls on the stronger index fund.", { probation: true }),
      "rates-fall": setup("Yields falling", "The 10-year yield fell 25bp+ in a month and TLT is above its 50-day. TLT calls."),
      "rates-rise": setup("Yields rising", "The 10-year yield rose 25bp+ in a month and TLT is under its 50-day. TLT puts."),
      "vol-inverted": setup("VIX curve inverted", "VIX above 3-month VIX for two sessions with SPY under its 20-day. SPY puts."),
      "vol-normal": setup("VIX curve back to normal", "The VIX curve was inverted in the last 10 sessions and is normal again with SPY above its 10-day. SPY calls.", { probation: true }),
      "event-drift": setup("After a Fed, CPI or jobs day", "A move of 1 ATR+ on the event day, followed the next session in QQQ or TLT for up to 5 sessions.", { exits: { tp: 25, stop: -35, maxSessions: 5 } }),
      "gold-rates": setup("Gold with yields and the dollar", "Yields and the dollar both falling with GLD breaking a 20-day high (calls), or both rising with GLD breaking a 20-day low (puts).", { probation: true }),
      "dollar-asia": setup("Dollar against Asia funds", "The dollar moved 1.5%+ in a month and EWY or KWEB is on the matching side of its 50-day.", { probation: true }),
    }),
    test: "history",
  }),
  technicals: freeze({
    id: "technicals", tag: "TEC", name: "Technicals",
    idea: "Price and volume only. Buys pullbacks inside strong trends, breakouts from tight ranges on heavy volume, and the mirror images for puts.",
    reads: ["Daily open, high, low, close and volume", "Moving averages, ATR, RSI, Bollinger width", "55-day and 52-week highs and lows", "Strength against SPY"],
    universe: "all", slots: 5, perRun: 2,
    // Deeper in the money and longer dated than the other engines: a trend
    // needs time, and the history test lost less this way in both halves.
    contract: freeze({ dteMin: 30, dteIdeal: 60, dteMax: 90, delta: 0.7 }),
    exits: freeze({ tp: 30, stop: -40, maxSessions: 15 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    setups: freeze({
      "pullback": setup("Trend pullback", "An uptrend (price, 50-day and 200-day in order, 50-day still rising), a 2-day RSI washout near the 20-day, then a close back up. Calls."),
      "rally-fade": setup("Downtrend rally fade", "A downtrend (price, 50-day and 200-day in order, 50-day still falling), a 2-day RSI spike near the 20-day, then a close back down. Puts.", { probation: true }),
      "breakout": setup("Range breakout", "A close through the prior 55-day high, a move of 0.8 ATR+, volume 1.4x normal, above the 200-day. Calls."),
      "breakdown": setup("Range breakdown", "A close through the prior 55-day low, a move of 0.8 ATR+, volume 1.4x normal, under the 200-day. Puts."),
      "squeeze": setup("Squeeze break", "Bollinger width in the lowest 15% of six months, then a close outside the band with volume."),
    }),
    test: "history",
  }),
  fundamentals: freeze({
    id: "fundamentals", tag: "FUN", name: "Fundamentals",
    idea: "Ranks companies on earnings power, quality and price, and holds the best and worst for weeks, in longer-dated options. No chart pattern and no flow can open a trade here.",
    reads: ["EPS growth and beat record", "Estimate revisions", "Margins, return on equity, free cash flow", "Forward P/E against its sector group", "Debt and analyst targets"],
    universe: "stocks", slots: 5, perRun: 1,
    contract: freeze({ dteMin: 75, dteIdeal: 120, dteMax: 200, delta: 0.62 }),
    exits: freeze({ tp: 50, stop: -40, maxSessions: 45 }),
    bar: freeze({ base: 62, min: 56, max: 80, step: 2 }),
    setups: freeze({
      "compounder": setup("Growing and beating", "EPS up on the year, at least 3 beats in the last 4 reports, estimates rising, sound margins and balance sheet, not priced far above its sector group. Calls."),
      "deteriorating": setup("Shrinking and missing", "EPS down on the year, 2+ misses in the last 4 reports, estimates being cut, weak margins or heavy debt. Puts."),
    }),
    test: "replay",
  }),
  flow: freeze({
    id: "flow", tag: "FLO", name: "Flow & positioning",
    idea: "Follows where option money is actually going: flagged trades signed by whether they were bought or sold (calls bought or puts sold read bullish), a week of one-sided flow, gamma set-ups near a call wall and short squeezes.",
    reads: ["Unusual options prints and their premium", "7-day flow balance", "Open-interest walls and gamma score", "Short interest, short-sale volume and borrow", "Today's volume and move"],
    universe: "all", slots: 4, perRun: 1,
    contract: freeze({ dteMin: 14, dteIdeal: 28, dteMax: 50, delta: 0.5 }),
    exits: freeze({ tp: 35, stop: -40, maxSessions: 7 }),
    bar: freeze({ base: 62, min: 56, max: 80, step: 2 }),
    setups: freeze({
      "aggressive-flow": setup("Aggressive option buying", "Five or more flagged trades today with a readable side, 70%+ of their delta dollars on one side ($250k+ of premium), the week's signed flow not against it and the stock moving with it today."),
      "gamma-wall": setup("Gamma set-up", "A high gamma score with price within 4% under the call wall and bullish flow today (calls bought or puts sold). Calls."),
      "short-squeeze": setup("Short squeeze", "15%+ of the float short, shorts covering, and price up 5%+ in five sessions on heavy volume. Calls."),
    }),
    test: "forward",
  }),
  reversion: freeze({
    id: "reversion", tag: "REV", name: "Reversion",
    idea: "Bets against stretched moves. Buys washed-out stocks that are still in long-term uptrends and fades spikes in long-term downtrends. Short holds, quick exits.",
    reads: ["2-day RSI and distance from the 20-day", "5-day move in ATRs", "200-day trend", "Volume on the washout day", "Earnings dates (it stands aside near a report)"],
    universe: "all", slots: 4, perRun: 2,
    contract: freeze({ dteMin: 14, dteIdeal: 25, dteMax: 45, delta: 0.6 }),
    exits: freeze({ tp: 30, stop: -35, maxSessions: 5 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    setups: freeze({
      "oversold-bounce": setup("Washout in an uptrend", "Above the 200-day, 2-day RSI under 8, 1.8+ standard deviations under the 20-day after a 5-day drop of 2 ATR+. Calls, closed when price is back at the 20-day."),
      "overbought-fade": setup("Spike in a downtrend", "Under the 200-day, 2-day RSI over 92, 1.8+ standard deviations over the 20-day after a 5-day rise of 2 ATR+. Puts, closed back at the 20-day.", { probation: true }),
      "capitulation": setup("Capitulation day", "A 3-day fall of 3 ATR+ ending on 2x volume with a close in the top 40% of the day's range. Calls."),
    }),
    test: "history",
  }),
});

export const ENGINE_IDS = freeze(Object.keys(ENGINES));
export const engineByTag = (tag) => ENGINE_IDS.map((id) => ENGINES[id]).find((e) => e.tag === tag) || null;
export const engineName = (id) => (id === FLAGSHIP.id ? FLAGSHIP.name : ENGINES[id]?.name || id);

// Exits for one trade: the setup's own when it has them, else the engine's.
export function exitsFor(engineId, setupKey) {
  const e = ENGINES[engineId];
  return { ...(e?.exits || {}), ...(e?.setups?.[setupKey]?.exits || {}) };
}

// ENGINES env: unset / "on" = run; "pause" = manage open trades, open none;
// "0" / "off" / "false" = freeze (files carried forward untouched).
// ENGINES_OFF: comma list of engine ids or tags that open no new trades.
export function engineSwitches(env = process.env) {
  const raw = String(env.ENGINES ?? "").trim().toLowerCase();
  const mode = /^(0|off|false|no)$/.test(raw) ? "off" : raw === "pause" ? "pause" : "on";
  const off = new Set();
  for (const part of String(env.ENGINES_OFF ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const id = ENGINE_IDS.find((k) => k === part.toLowerCase() || ENGINES[k].tag === part.toUpperCase());
    if (id) off.add(id);
  }
  return { mode, off };
}
