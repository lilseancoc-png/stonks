// Strategy engines (2026-11-15): the registry. Paper engines that run beside
// the flagship Top Picks, each on its own rules, its own data and its own
// track record (engines-record.json); their option trades are copied into the
// one Webull paper account. Nothing here reads or changes a Top Picks grade,
// gate or record.
//
// Since 2026-11-17 there are two kinds:
//   - signal engines (Earnings, Macro, Technicals, Fundamentals, Flow,
//     Reversion): one trade per setup, single options or a $5,000 share lot;
//   - core engines (`core: true`: Trend follower, Momentum basket): long-only
//     fund and stock holdings in shares, checked once a month and held until
//     the monthly check swaps them (lib/engines/core.mjs). They never short,
//     never learn (a fixed monthly rule) and never reach Webull.
// The Allocator (lib/engines/allocator.mjs) is not an engine with trades of
// its own: it decides which signal-engine setups may trade in today's market
// and how big each trade would be.
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
  skippedKept: 6,        // plus setups the chasing filter ruled out (shown, never traded)
  costPts: 3.5,          // round-trip cost, % of premium, used by the history test only
  // Option size (2026-11-17, owner: $2,000 of premium a trade): an option
  // trade buys the number of contracts whose cost is nearest this, at least
  // one (a contract dearer than this is bought once, up to maxCost). Until
  // then every option trade was one contract, so a $40 SPY call counted forty
  // times a $1 call in the dollar totals. Record only: the Webull paper
  // mirror still places one contract of each engine trade. Owner Settings
  // ENGINES_FIX_SIZE off goes back to one contract.
  optionUsd: 2000,
  // Share trades (2026-11-17, "fit the contract to the signal"): the call side
  // of a setup marked `calls: "shares"` buys stock instead of a call. Long
  // only: a put is always an option, so no engine ever shorts stock.
  sharesUsd: 5000,       // stock bought per share trade (at least one share)
  sharesCostPct: 0.05,   // cost each way, % of the price (0.1% a round trip)
  sharesStopAtr: 2,      // stop this many ATR under the entry (or the setup's own stock stop, whichever is higher); an engine may set its own (`sharesStopAtr`, `sharesOwnStop`)
  sharesTargetAtr: 3,    // target this many ATR over the entry (or the setup's own target, whichever is lower)
  sharesMaxSessions: 20, // sessions held at most (the setup's own thesis and event exits still apply)
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
  "rank-out": "left the top or bottom third of the rank",
  "dte-exit": "closed before expiry",
  "expired": "contract expired",
  "rotate": "swapped at the monthly check",
  "left-coverage": "name left coverage (not counted)",
});
export const NOT_COUNTED = new Set(["left-coverage"]);

const freeze = (o) => Object.freeze(o);
const setup = (label, how, extra = {}) => freeze({ label, how, ...extra });

// ---------------------------------------------------------------------------
// The money-leak fixes (2026-11-17, owner: "build all 6 fixes", from the
// replay of every 2007-2026 history-test trade; docs/engines.md "Money-leak
// fixes"). Each one is an Owner Settings switch that is on by default; off
// puts that part back the way it was (engineSpecs below). A fix only changes
// new trades: open trades keep the exits and size they opened with.
// ---------------------------------------------------------------------------
export const ENGINE_FIXES = freeze([
  freeze({ id: "retirePuts", env: "ENGINES_FIX_RETIRE_PUTS", label: "Retire the two losing put setups", engines: ["technicals", "reversion"] }),
  freeze({ id: "bounce", env: "ENGINES_FIX_BOUNCE", label: "Washout bounce: 0.3-delta calls about 21 days out, -60% stop", engines: ["reversion"] }),
  freeze({ id: "size", env: "ENGINES_FIX_SIZE", label: "Option trades buy about $2,000 of premium", engines: ["earnings", "macro", "technicals", "fundamentals", "flow", "reversion"] }),
  freeze({ id: "stockStop", env: "ENGINES_FIX_TEC_SHARES", label: "Technicals share trades: stop 3 ATR under the entry", engines: ["technicals"] }),
]);
export const ENGINE_FIX_IDS = freeze(ENGINE_FIXES.map((f) => f.id));
const ALL_FIXES = freeze(Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, true])));
// What each fix says in an engine's rules note.
const FIX_PARTS = freeze({
  retirePuts: { technicals: "the range breakdown is retired (it lost 7.2% a trade over 88 trades in the 2007-2026 test)", reversion: "the spike-in-a-downtrend fade is retired (it lost 10.3% a trade over 284 trades in the 2007-2026 test)" },
  bounce: { reversion: "the washout bounce buys calls of about 0.3 delta, about 21 days out, with a -60% stop" },
  stockStop: { technicals: "share trades stop 3 ATR under the entry instead of at the setup's own stop or 2 ATR" },
  size: { "*": "option trades buy about $2,000 of premium instead of one contract (results in % are unchanged; the dollar totals now count every trade about the same)" },
});
// Each signal engine's rules before the fixes (rules 2).
const RULES_BEFORE = freeze({
  earnings: freeze({ n: 2, date: "2026-11-17", note: "New rules: the post-earnings drift's call side buys shares instead of a call ($5,000 of stock, stop 2 ATR under the entry, target 3 ATR over it, 20 sessions at most). Puts and the run-in stay options." }),
  macro: freeze({ n: 2, date: "2026-11-17", note: "New rules: the VIX-curve-back-to-normal setup is dropped (it lost 11.6% a trade over 128 trades in the 1971-2026 history test), and the gold and Asia-fund setups buy fund shares on the up side instead of calls." }),
  technicals: freeze({ n: 2, date: "2026-11-17", note: "New rules: the trend pullback and the range breakout buy shares instead of calls ($5,000 of stock, the setup's own stock stop or 2 ATR under the entry, 3 ATR target, 20 sessions at most). The squeeze and every put stay options." }),
  fundamentals: freeze({ n: 2, date: "2026-11-16", note: "New rules: one standing rank of every covered stock (calls on the best three, puts on the worst two, swapped only when a holding leaves the top or bottom third) replaced the three-week window after each report. Trades opened under the first rules keep their own exits." }),
  flow: freeze({ n: 2, date: "2026-11-17", note: "New rules: bullish flow, the gamma set-up and the short squeeze buy shares instead of calls ($5,000 of stock, stop 2 ATR under the entry, 3 ATR target or the call wall, 20 sessions at most). Bearish flow stays puts." }),
  reversion: freeze({ n: 2, date: "2026-11-17", note: "New rules: the capitulation-day bounce buys shares instead of a call ($5,000 of stock, the setup's own stop and 10-day target, 20 sessions at most). The washout bounce and every put stay options." }),
});
// Rules 3 when at least one fix reaches the engine, else its rules 2. The
// note lists only the fixes that are on. `before` is the rules it replaced,
// so an engine still on its first rules logs both notes in one change
// (adoptRules); `key` names the fixes that reach this engine, so switching
// one off or on in Owner Settings is logged as a rule change too (and the
// record splits there), with `switchNote` as its text.
function fixRules(id, on = ALL_FIXES) {
  const reach = ENGINE_FIX_IDS.filter((f) => on[f] && (FIX_PARTS[f][id] || FIX_PARTS[f]["*"]));
  const parts = reach.map((f) => FIX_PARTS[f][id] || FIX_PARTS[f]["*"]);
  const key = `fixes:${reach.join(",")}`;
  const switchNote = parts.length
    ? `Rule fixes switched in Owner Settings. On now: ${parts.join("; ")}.`
    : "Rule fixes switched off in Owner Settings: back to the rules before the money-leak fixes.";
  if (!parts.length) return freeze({ ...RULES_BEFORE[id], key, switchNote });
  return freeze({ n: 3, date: "2026-11-17", note: `New rules (the money-leak fixes): ${parts.join("; ")}.`, before: RULES_BEFORE[id], key, switchNote });
}

// ---------------------------------------------------------------------------
// Paper trials (2026-11-19, the strategy test series; docs/engines.md "Paper
// trials"). A trial is a setup that did well in the 2007-2026 test but has
// not proven itself (it did not clear every bar), so it trades on paper,
// labeled, to show whether it holds up live. Each one is an Owner Settings
// switch that is on by default; off retires the setup for new trades (open
// trades keep their exits). A trial buys shares only: with ENGINES_SHARES
// off it opens nothing (engineSwitches).
// ---------------------------------------------------------------------------
export const ENGINE_TRIALS = freeze([
  freeze({ id: "rsi2Dip", env: "ENGINES_TRIAL_RSI2_DIP", engine: "reversion", setup: "rsi2-dip", label: "Paper trial: RSI(2) dip in an uptrend (shares)" }),
  freeze({ id: "fearIndex", env: "ENGINES_TRIAL_FEAR_INDEX", engine: "macro", setup: "fear-index", label: "Paper trial: index funds after extreme fear (shares)" }),
]);
export const ENGINE_TRIAL_IDS = freeze(ENGINE_TRIALS.map((t) => t.id));
const ALL_TRIALS = freeze(Object.fromEntries(ENGINE_TRIAL_IDS.map((id) => [id, true])));
const TRIAL_PARTS = freeze({
  rsi2Dip: "the RSI(2) dip in an uptrend (above the 200-day, 2-day RSI under 5) buys $5,000 of stock and sells on a close back above the 5-day average or after 10 sessions",
  fearIndex: "when Fear & Greed first closes under 25, it buys $5,000 each of SPY, QQQ and IWM and holds them 20 sessions, with no stop or target",
});
// The engine's rules with its paper trials on top. A trial that is on makes
// the next rules number (dated the day it was added); all off leaves the
// rules underneath. `key` names the trials that are on, so switching one in
// Owner Settings is logged as a rule change (adoptRules) and the record
// splits there.
function trialRules(base, id, on = ALL_TRIALS) {
  const mine = ENGINE_TRIALS.filter((t) => t.engine === id);
  if (!mine.length) return base;
  const live = mine.filter((t) => on[t.id] !== false);
  const key = `${base.key ?? ""}|trials:${live.map((t) => t.id).join(",")}`;
  const off = mine.filter((t) => on[t.id] === false).map((t) => `${t.label} is switched off and opens nothing new`);
  if (!live.length) return freeze({ ...base, key, switchNote: `${base.switchNote || "Rules switched in Owner Settings."} ${off.join("; ")}.` });
  const parts = live.map((t) => TRIAL_PARTS[t.id]);
  return freeze({
    n: (base.n || 1) + 1, date: "2026-11-19",
    note: `New rules: a paper trial is added, labeled unproven: ${parts.join("; ")}.`,
    before: base, key,
    switchNote: `${base.switchNote || "Rules switched in Owner Settings."} Paper trial on: ${parts.join("; ")}.${off.length ? ` ${off.join("; ")}.` : ""}`,
  });
}

// A setup marked `probation: true` starts on shadow (tracked, not traded): it
// lost more than 3% a trade in BOTH halves of the first history test
// (2007-2016 and 2017-2026). It starts trading when 40+ shadow trades average
// +5% or better, clearly above zero (lib/engines/learn.mjs).
//
// One entry per engine. `bar` is the entry score (0-100 scale, the engine's
// own); the learning layer may move it inside [min, max]. `exits` are % of
// the entry premium. `contract` is what the engine buys: one single long call
// or put, except that a setup marked `calls: "shares"` buys $5,000 of stock on
// its call side (BOOK.shares*; its exits are then stock levels and a session
// limit, not premium %).
export const ENGINES = freeze({
  earnings: freeze({
    id: "earnings", tag: "ERN", name: "Earnings & events",
    idea: "Trades the days around a company's own earnings report: the drift after a real surprise, and the run-in before a report for stocks that usually climb into it. Never holds a run-in trade through the report.",
    reads: ["Earnings dates and sessions", "EPS surprise and guidance", "Each stock's past reactions and run-ins", "Options-implied move vs past moves", "Daily prices and volume"],
    universe: "stocks", slots: 5, perRun: 2,
    contract: freeze({ dteMin: 21, dteIdeal: 35, dteMax: 60, delta: 0.55 }),
    exits: freeze({ tp: 30, stop: -40, maxSessions: 10 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    // Rules 2 (2026-11-17): fit the contract to the signal.
    // Rules 3 (2026-11-17): option trades sized in dollars (BOOK.optionUsd).
    rules: fixRules("earnings"),
    setups: freeze({
      "drift": setup("Post-earnings drift", "A beat (or miss) of 5%+ with a gap of 3%+ the same way that held. Enters 1 to 3 sessions after the report. Calls side buys shares (up to 20 sessions); puts ride up to 10 sessions.", { calls: "shares" }),
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
    // Rules 2 (2026-11-17): fit the contract to the signal. Rules 3
    // (2026-11-17, the money-leak fixes): option trades sized in dollars.
    // The yields-falling TLT calls keep their +30% take-profit: dropping it
    // looked better trade by trade (+29.3% against +11.8% on the same 115
    // entries) but lost money in the full book (72 trades and $17,356
    // against 115 and $27,060), because a call held 12 sessions blocks the
    // next TLT signal that the take-profit would have let in.
    rules: trialRules(fixRules("macro"), "macro"),
    setups: freeze({
      "stress-on": setup("Conditions tightening", "Financial conditions tightened over four weeks, the VIX curve is flat or inverted and SPY is under its 50-day. Puts on the weaker index fund.", { modelGain: true }),
      "stress-off": setup("Conditions easing", "Financial conditions eased over four weeks from a tight level, the VIX curve is back to normal and SPY is rising. Calls on the stronger index fund.", { probation: true }),
      "rates-fall": setup("Yields falling", "The 10-year yield fell 25bp+ in a month and TLT is above its 50-day. TLT calls."),
      "rates-rise": setup("Yields rising", "The 10-year yield rose 25bp+ in a month and TLT is under its 50-day. TLT puts.", { modelGain: true }),
      "vol-inverted": setup("VIX curve inverted", "VIX above 3-month VIX for two sessions with SPY under its 20-day. SPY puts.", { modelGain: true }),
      "vol-normal": setup("VIX curve back to normal (dropped)", "Retired 2026-11-17: lost 11.6% a trade over 128 trades in the 1971-2026 history test, the worst Macro setup. Was: the VIX curve inverted in the last 10 sessions and normal again with SPY above its 10-day, SPY calls.", { retired: true }),
      "event-drift": setup("After a Fed, CPI or jobs day", "A move of 1 ATR+ on the event day, followed the next session in QQQ or TLT for up to 5 sessions.", { exits: { tp: 25, stop: -35, maxSessions: 5 }, modelGain: true }),
      "gold-rates": setup("Gold with yields and the dollar", "Yields and the dollar both falling with GLD breaking a 20-day high (buys GLD shares), or both rising with GLD breaking a 20-day low (puts).", { probation: true, calls: "shares" }),
      "dollar-asia": setup("Dollar against Asia funds", "The dollar moved 1.5%+ in a month and EWY or KWEB is on the matching side of its 50-day (buys the fund's shares on the up side, puts on the down side).", { probation: true, calls: "shares" }),
      // Paper trial (2026-11-19, ENGINES_TRIAL_FEAR_INDEX). In the 2007-2026
      // test (our rebuild of Fear & Greed crossing under 25, SPY/QQQ/IWM held
      // 20 sessions): +1.26% a trade over 162 trades but -0.06% in 2007-2016
      // (+2.49% after), t 1.0 against random days, so it is unproven. Through
      // the engine code (entry at the next open): 162 trades, +1.3%, 62% wins,
      // +0.3% in 2007-2016 and +2.2% after. The owner asked for it on paper
      // anyway (2026-11-19).
      "fear-index": setup("Index funds after extreme fear (paper trial)", "Paper trial, unproven (added 2026-11-19): the day after CNN Fear & Greed first closes under 25, buys $5,000 each of SPY, QQQ and IWM and holds them 20 sessions, with no stop or target (as tested). It made money over 2007-2026 but little or nothing in 2007-2016, so it is on paper to see how it does live.",
        { calls: "shares", trial: true, slots: 3, perRun: 3, levels: false, exits: { maxSessions: 20 } }),
    }),
    test: "history",
  }),
  technicals: freeze({
    id: "technicals", tag: "TEC", name: "Technicals",
    idea: "Price and volume only. Buys pullbacks inside strong trends and breakouts from tight ranges on heavy volume, buys puts on rallies that fail inside downtrends, and trades squeeze breaks either way.",
    reads: ["Daily open, high, low, close and volume", "Moving averages, ATR, RSI, Bollinger width", "55-day and 52-week highs and lows", "Strength against SPY"],
    universe: "all", slots: 5, perRun: 2,
    // Deeper in the money and longer dated than the other engines: a trend
    // needs time, and the history test lost less this way in both halves.
    contract: freeze({ dteMin: 30, dteIdeal: 60, dteMax: 90, delta: 0.7 }),
    exits: freeze({ tp: 30, stop: -40, maxSessions: 15 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    // Rules 2 (2026-11-17): fit the contract to the signal. Rules 3
    // (2026-11-17, the money-leak fixes): the range breakdown is retired and
    // the share trades' stop is 3 ATR under the entry.
    rules: fixRules("technicals"),
    // Share trades' stock stop (2026-11-17): 3 ATR under the entry, in place
    // of the setup's own tighter stop and the book's 2 ATR. Re-run through
    // the whole 2007-2026 book as the engine runs: +0.9% a trade over 1,158
    // share trades against +0.5% over 1,454 with the earlier stop.
    sharesStopAtr: 3, sharesOwnStop: false,
    setups: freeze({
      "pullback": setup("Trend pullback", "An uptrend (price, 50-day and 200-day in order, 50-day still rising), a 2-day RSI washout near the 20-day, then a close back up. Buys shares.", { calls: "shares" }),
      "rally-fade": setup("Downtrend rally fade", "A downtrend (price, 50-day and 200-day in order, 50-day still falling), a 2-day RSI spike near the 20-day, then a close back down. Puts.", { probation: true }),
      "breakout": setup("Range breakout", "A close through the prior 55-day high, a move of 0.8 ATR+, volume 1.4x normal, above the 200-day. Buys shares.", { calls: "shares" }),
      "breakdown": setup("Range breakdown (retired)", "Retired 2026-11-17: lost 7.2% a trade over 88 trades in the 2007-2026 history test, in both halves, while the stocks rose 3.2% against the puts. Was: a close through the prior 55-day low, a move of 0.8 ATR+, volume 1.4x normal, under the 200-day. Puts.", { retired: true }),
      "squeeze": setup("Squeeze break", "Bollinger width in the lowest 15% of six months, then a close outside the band with volume."),
    }),
    test: "history",
  }),
  fundamentals: freeze({
    id: "fundamentals", tag: "FUN", name: "Fundamentals",
    idea: "Keeps one standing rank of every covered stock on earnings power, quality and price. Holds calls on the three best names it can buy and puts on the two worst, in longer-dated options, and swaps one only when it leaves the top or bottom third. A stock is ranked again when the month changes and after each of its reports. No chart pattern and no flow can open a trade here.",
    reads: ["EPS growth and beat record", "Estimate revisions and revenue growth", "Margins, return on equity, free cash flow, debt", "Forward P/E against its sector group", "Analyst targets"],
    universe: "stocks", slots: 5, perRun: 1,
    // Three calls and two puts at most. `standing`: a name that has no free
    // slot today is not tracked as a shadow trade, so it can still open when
    // a slot frees up.
    sideSlots: freeze({ call: 3, put: 2 }), standing: true,
    contract: freeze({ dteMin: 75, dteIdeal: 120, dteMax: 200, delta: 0.62 }),
    exits: freeze({ tp: 50, stop: -40, maxSessions: 60 }),
    bar: freeze({ base: 62, min: 56, max: 80, step: 2 }),
    // Rules 2 (2026-11-16): the standing rank replaced the post-report window.
    // Rules 3 (2026-11-17): option trades sized in dollars (BOOK.optionUsd).
    rules: fixRules("fundamentals"),
    setups: freeze({
      "rank-top": setup("Top of the rank", "One of the 8 best-ranked stocks, not inside six sessions of its report, not far under its 200-day. Calls, held while the stock stays in the top third."),
      "rank-bottom": setup("Bottom of the rank", "One of the 8 worst-ranked stocks, not inside six sessions of its report, not far above its 200-day. Puts, held while the stock stays in the bottom third."),
      "compounder": setup("Growing and beating (first rules)", "Retired 2026-11-16. EPS up on the year with 3+ beats in the last 4 reports, scored in the three weeks after a report. Trades already open keep their 45-session limit.", { retired: true }),
      "deteriorating": setup("Shrinking and missing (first rules)", "Retired 2026-11-16. EPS down on the year with 2+ misses in the last 4 reports, scored in the three weeks after a report. Trades already open keep their 45-session limit.", { retired: true }),
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
    // Rules 2 (2026-11-17): fit the contract to the signal.
    // Rules 3 (2026-11-17): option trades sized in dollars (BOOK.optionUsd).
    rules: fixRules("flow"),
    setups: freeze({
      "aggressive-flow": setup("Aggressive option buying", "Five or more flagged trades today with a readable side, 70%+ of their delta dollars on one side ($250k+ of premium), the week's signed flow not against it and the stock moving with it today. Bullish flow buys shares; bearish flow buys puts.", { calls: "shares" }),
      "gamma-wall": setup("Gamma set-up", "A high gamma score with price within 4% under the call wall and bullish flow today (calls bought or puts sold). Buys shares, target the call wall.", { calls: "shares" }),
      "short-squeeze": setup("Short squeeze", "15%+ of the float short, shorts covering, and price up 5%+ in five sessions on heavy volume. Buys shares.", { calls: "shares" }),
    }),
    test: "forward",
  }),
  reversion: freeze({
    id: "reversion", tag: "REV", name: "Reversion",
    idea: "Bets against stretched moves. Buys washed-out stocks that are still in long-term uptrends (its fade of spikes in downtrends was retired on 17 November 2026). Short holds, quick exits.",
    reads: ["2-day RSI and distance from the 20-day", "5-day move in ATRs", "200-day trend", "Volume on the washout day", "Earnings dates (it stands aside near a report)"],
    universe: "all", slots: 4, perRun: 2,
    contract: freeze({ dteMin: 14, dteIdeal: 25, dteMax: 45, delta: 0.6 }),
    exits: freeze({ tp: 30, stop: -35, maxSessions: 5 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    // Rules 2 (2026-11-17): fit the contract to the signal. Rules 3
    // (2026-11-17, the money-leak fixes): the downtrend spike fade is retired
    // and the washout bounce buys cheaper, shorter calls with a wider stop.
    rules: trialRules(fixRules("reversion"), "reversion"),
    setups: freeze({
      // Own contract and stop (2026-11-17): 0.3-delta calls about 21 days out
      // with a -60% stop. Re-run through the whole 2007-2026 book as the
      // engine runs: +7.7% a trade over 884 trades against +0.8% over 981
      // for the engine's 0.6-delta 25-day calls, ahead in both halves (+5.3%
      // against +1.8% with every setup trading). Part of it is the option
      // price model (+3.5% against +1.2% with volatility held flat in the
      // trade-by-trade replay).
      "oversold-bounce": setup("Washout in an uptrend", "Above the 200-day, 2-day RSI under 8, 1.8+ standard deviations under the 20-day after a 5-day drop of 2 ATR+. Calls of about 0.3 delta, 14 to 35 days out (ideal 21), closed when price is back at the 20-day; -60% stop.",
        { contract: { dteMin: 14, dteIdeal: 21, dteMax: 35, delta: 0.3 }, exits: { stop: -60 } }),
      "overbought-fade": setup("Spike in a downtrend (retired)", "Retired 2026-11-17: lost 10.3% a trade over 284 trades in the 2007-2026 history test, every year and in both halves; the stocks moved 0.0% the puts' way. Was: under the 200-day, 2-day RSI over 92, 1.8+ standard deviations over the 20-day after a 5-day rise of 2 ATR+. Puts, closed back at the 20-day.", { probation: true, retired: true }),
      "capitulation": setup("Capitulation day", "A 3-day fall of 3 ATR+ ending on 2x volume with a close in the top 40% of the day's range. Buys shares, target the 10-day.", { calls: "shares" }),
      // Paper trial (2026-11-19, ENGINES_TRIAL_RSI2_DIP). In the 2007-2026
      // test on real prices: +0.62% a trade over 4,181 trades (+0.63% /
      // +0.62% by half), ahead of the same stocks on random days (t 3.0) and
      // of SPY (t 5.1), but under the bar for 553 tries (t 3.9) and weak on
      // sector funds (+0.21%), so it is unproven: labeled, on paper only.
      "rsi2-dip": setup("RSI(2) dip in an uptrend (paper trial)", "Paper trial, unproven (added 2026-11-19): above the 200-day with a 2-day RSI under 5. Buys $5,000 of stock and sells on a close back above the 5-day average, after 10 sessions, or at the usual 2 ATR stop / 3 ATR target. Calls on these dips lost money on real option prices, so it buys shares only.",
        { calls: "shares", trial: true, slots: 4, perRun: 2, exits: { maxSessions: 10 } }),
    }),
    test: "history",
  }),
  // Core engines (2026-11-17, "beat the S&P" plan: owner chose Trend follower,
  // Momentum basket and the Allocator). Long-only, shares only, one check a
  // month at the first decision run of a new month, read from month-end
  // closes. `lotUsd` is the stock bought per holding: the trend follower is
  // one $50,000 holding and the basket ten $3,000 holdings (about half and a
  // third of a $100,000 account; the option engines are the rest).
  trend: freeze({
    id: "trend", tag: "TRD", name: "Trend follower",
    idea: "Holds one index fund while its trend is up and steps aside when it turns. Each month it compares the last 12 months of the S&P 500 (SPY) and the Nasdaq-100 (QQQ) and holds the stronger one if it beat T-bills; otherwise it holds Treasuries (TLT), or T-bills (cash) when Treasuries are falling too. Shares only, long only, a few trades a year.",
    reads: ["SPY, QQQ and TLT month-end closes (12 months)", "Fed funds rate (the T-bill return)"],
    universe: "etfs", slots: 1, perRun: 1, core: true, standing: true, lotUsd: 50000,
    contract: freeze({ shares: true }),
    exits: freeze({}),
    bar: freeze({ base: 0, min: 0, max: 0, step: 0 }),
    rules: freeze({ n: 1, date: "2026-11-17", note: "First rules: dual momentum with a T-bill fallback, checked once a month." }),
    setups: freeze({
      "index": setup("Stronger index fund", "SPY or QQQ, whichever rose more over the last 12 months, while that rise beat T-bills. Held until a monthly check picks something else.", { calls: "shares" }),
      "bonds": setup("Treasuries", "TLT when neither index fund beat T-bills over 12 months and TLT did. Held until a monthly check picks something else.", { calls: "shares" }),
    }),
    test: "history",
  }),
  momentum: freeze({
    id: "momentum", tag: "MOM", name: "Momentum basket",
    idea: "Owns the ten covered stocks that rose the most over the last 12 months (leaving out the latest month), equal weight in shares, and re-picks them once a month. While the S&P 500 is under its 10-month average it holds Treasuries (TLT) instead, or T-bills when Treasuries are falling too. Long only.",
    reads: ["Month-end closes of every covered stock (13 months)", "SPY against its 10-month average", "TLT and the fed funds rate"],
    universe: "stocks", slots: 10, perRun: 10, core: true, standing: true, lotUsd: 3000, top: 10,
    contract: freeze({ shares: true }),
    exits: freeze({}),
    bar: freeze({ base: 0, min: 0, max: 0, step: 0 }),
    rules: freeze({ n: 1, date: "2026-11-17", note: "First rules: the ten strongest stocks by 12-1 momentum, re-picked monthly, Treasuries or T-bills while the S&P 500 is under its 10-month average." }),
    setups: freeze({
      "top-10": setup("Ten strongest stocks", "One of the ten covered stocks with the biggest rise from 12 months ago to 1 month ago. Held while it stays in the ten at each monthly check.", { calls: "shares" }),
      "safe": setup("Treasuries while the market is weak", "The S&P 500 closed the month under its 10-month average: the whole basket's money goes to TLT if it beat T-bills over 12 months, else stays in T-bills.", { calls: "shares" }),
    }),
    test: "history",
  }),
});

export const ENGINE_IDS = freeze(Object.keys(ENGINES));
export const engineByTag = (tag) => ENGINE_IDS.map((id) => ENGINES[id]).find((e) => e.tag === tag) || null;
export const engineName = (id) => (id === FLAGSHIP.id ? FLAGSHIP.name : id === "allocator" ? "Allocator" : ENGINES[id]?.name || id);
// The signal engines (one trade per setup) and the core engines (monthly holdings).
export const isCoreEngine = (id) => !!ENGINES[id]?.core;
export const SIGNAL_IDS = freeze(ENGINE_IDS.filter((id) => !ENGINES[id].core));
export const CORE_IDS = freeze(ENGINE_IDS.filter((id) => ENGINES[id].core));

// Exits for one trade: the setup's own when it has them, else the engine's.
export function exitsFor(engineId, setupKey, specs = ENGINES) {
  const e = specs[engineId];
  return { ...(e?.exits || {}), ...(e?.setups?.[setupKey]?.exits || {}) };
}
// The option a setup buys: its own window and delta where it has them
// (Reversion's washout bounce since 2026-11-17), else the engine's.
export function contractFor(spec, setupKey) {
  return { ...(spec?.contract || {}), ...(spec?.setups?.[setupKey]?.contract || {}) };
}

// The registry with some money-leak fixes switched off (`fixes`: { id: bool },
// a missing id counts as on). All on returns ENGINES itself. Off puts the
// setup, the engine's share stop and the rules note back as they were; the
// option size is the book's (engineSwitches().optionUsd).
const UNDO = freeze({
  retirePuts: [
    ["technicals", "breakdown", setup("Range breakdown", "A close through the prior 55-day low, a move of 0.8 ATR+, volume 1.4x normal, under the 200-day. Puts.")],
    ["reversion", "overbought-fade", setup("Spike in a downtrend", "Under the 200-day, 2-day RSI over 92, 1.8+ standard deviations over the 20-day after a 5-day rise of 2 ATR+. Puts, closed back at the 20-day.", { probation: true })],
  ],
  bounce: [["reversion", "oversold-bounce", setup("Washout in an uptrend", "Above the 200-day, 2-day RSI under 8, 1.8+ standard deviations under the 20-day after a 5-day drop of 2 ATR+. Calls, closed when price is back at the 20-day.")]],
  stockStop: [["technicals", null, { sharesStopAtr: null, sharesOwnStop: true }]],
  size: [],
});
export function engineSpecs(fixes = ALL_FIXES, trials = ALL_TRIALS) {
  const off = ENGINE_FIX_IDS.filter((id) => fixes?.[id] === false);
  const trialsOff = ENGINE_TRIALS.filter((t) => trials?.[t.id] === false);
  if (!off.length && !trialsOff.length) return ENGINES;
  const on = Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, !off.includes(id)]));
  const trialsOn = Object.fromEntries(ENGINE_TRIAL_IDS.map((id) => [id, !trialsOff.some((t) => t.id === id)]));
  const out = {};
  for (const id of ENGINE_IDS) {
    const e = ENGINES[id];
    if (e.core) { out[id] = e; continue; }
    let spec = { ...e, rules: trialRules(fixRules(id, on), id, trialsOn) }, setups = { ...e.setups };
    // A trial switched off is retired for new trades (open ones keep their exits).
    for (const t of trialsOff) if (t.engine === id && setups[t.setup]) setups[t.setup] = freeze({ ...setups[t.setup], retired: true });
    for (const f of off) for (const [eid, key, patch] of UNDO[f]) {
      if (eid !== id) continue;
      if (key) setups[key] = patch; else spec = { ...spec, ...patch };
    }
    out[id] = freeze({ ...spec, setups: freeze(setups) });
  }
  return freeze(out);
}

// What a candidate buys: "shares" for the call side of a setup marked
// `calls: "shares"` (unless ENGINES_SHARES=0), else "option". A put is always
// an option: the engines never short stock.
// A core engine always buys shares (ENGINES_SHARES only moves the signal
// engines' setups).
export function instrumentFor(spec, setupKey, side, { shares = true } = {}) {
  if (spec?.core) return "shares";
  return shares && side !== "put" && spec?.setups?.[setupKey]?.calls === "shares" ? "shares" : "option";
}
export const isSharesTrade = (t) => t?.contract?.structure === "shares";

// ENGINES env: unset / "on" = run; "pause" = manage open trades, open none;
// "0" / "off" / "false" = freeze (files carried forward untouched).
// ENGINES_OFF: comma list of engine ids or tags that open no new trades.
// ENGINES_SHARES: "0" / "off" puts every setup back on options (open share
// trades are still managed to their exits).
// ENGINES_ALLOCATOR: unset / "advise" = the Allocator records its read on
// every signal trade and holds nothing back (the default since 2026-11-17:
// holding back lowered the dollar total in both history runs); "on" = it
// holds back setups expected to lose in today's market; "0" / "off" = not run.
// ENGINES_FIX_RETIRE_PUTS, ENGINES_FIX_BOUNCE,
// ENGINES_FIX_SIZE, ENGINES_FIX_TEC_SHARES: the money-leak fixes
// (2026-11-17), each on unless set to "0" / "off" (Owner Settings; no repo
// variable). `fixes` is { id: bool }; `optionUsd` is the option size (null =
// one contract, the size before the fixes).
export function engineSwitches(env = process.env) {
  const raw = String(env.ENGINES ?? "").trim().toLowerCase();
  const mode = /^(0|off|false|no)$/.test(raw) ? "off" : raw === "pause" ? "pause" : "on";
  const isOff = (v) => /^(0|off|false|no)$/.test(String(v ?? "").trim().toLowerCase());
  const fixes = {
    retirePuts: !isOff(env.ENGINES_FIX_RETIRE_PUTS),
    bounce: !isOff(env.ENGINES_FIX_BOUNCE),
    size: !isOff(env.ENGINES_FIX_SIZE),
    stockStop: !isOff(env.ENGINES_FIX_TEC_SHARES),
  };
  const optionUsd = fixes.size ? BOOK.optionUsd : null;
  const shares = !/^(0|off|false|no)$/.test(String(env.ENGINES_SHARES ?? "").trim().toLowerCase());
  // A paper trial buys shares only, so it is off while share trades are off.
  const trials = { rsi2Dip: shares && !isOff(env.ENGINES_TRIAL_RSI2_DIP), fearIndex: shares && !isOff(env.ENGINES_TRIAL_FEAR_INDEX) };
  const a = String(env.ENGINES_ALLOCATOR ?? "").trim().toLowerCase();
  const allocator = /^(0|off|false|no)$/.test(a) ? "off" : /^(on|1|true|yes)$/.test(a) ? "on" : "advise";
  const off = new Set();
  for (const part of String(env.ENGINES_OFF ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const id = ENGINE_IDS.find((k) => k === part.toLowerCase() || ENGINES[k].tag === part.toUpperCase());
    if (id) off.add(id);
  }
  return { mode, off, shares, allocator, fixes, trials, optionUsd };
}
