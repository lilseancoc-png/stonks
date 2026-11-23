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

import { HEDGE, PAUSE_ENGINES } from "./hedge.mjs";

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
  minVol: 10,            //   today's volume (with ENGINES_FIX_LIQUIDITY on, 2026-11-24: open interest minOi AND today's volume minVol, or open interest minOiAlone)
  minOiAlone: 100,       // open interest that passes with no volume today (ENGINES_FIX_LIQUIDITY)
  fitDelta: 0.15,        // ENGINES_FIX_CONTRACT_FIT: an expiry's best strike is taken only within this of the target delta, else the best fit over the expiries looked at
  shareRiskAtr: 1,       // ENGINES_FIX_SHARE_RISK: a risk-sized share trade counts at least this many ATR of risk a share,
  shareRiskPct: 2,       //   or this % of the price, whichever is larger (the stop itself is unchanged)
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
  // times a $1 call in the dollar totals. Since 2026-11-19 the Webull
  // paper mirror places the same count (mirrorQty, capped at 25). Owner Settings
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
  // Risk sizing (2026-11-19, "make the paper record honest"; docs/engines.md
  // "Honest paper trades"). Each signal-engine trade risks about `riskUsd`
  // (Owner Settings ENGINES_RISK_USD): an option expiring within
  // `riskWholeDte` days risks its whole premium, a longer one its premium
  // times the stop times `riskStopPad`; shares risk entry minus stop per
  // share. 1 to `riskMaxQty` contracts (10 until 2026-11-20, 25 until
  // 2026-11-23, then 200; Owner Settings ENGINES_MAX_QTY sets it from 1 to
  // 200, `sizing.maxQty`), and never more than `maxPremiumUsd` of premium
  // (2026-11-23, Owner Settings ENGINES_MAX_PREMIUM_USD). A
  // contract that costs more than
  // `riskSkipX` times the budget is not bought (the call side buys shares
  // instead). A share trade is capped at `sharesMaxUsd` of stock (an account
  // cap: no leverage, and a tight stop can't buy a huge lot; $25,000 until
  // 2026-11-23, Owner Settings ENGINES_SHARES_MAX_USD).
  riskUsd: 2000,
  // 2026-11-23 (owner: "Options up to 200 contracts per trade or a limit of
  // $200,000 whichever first"): 200 contracts, $200,000 of premium.
  riskMaxQty: 200,
  maxPremiumUsd: 200000,
  // The contract cap from 2026-11-20 until 2026-11-23 (rules notes only).
  riskMaxQtyBefore23: 25,
  // The cap before 2026-11-20 (rules notes and the record split only).
  riskMaxQtyBefore: 10,
  // Puts (2026-11-20, owner: "for puts we can cap it at 10 contracts max";
  // 2026-11-23, owner: "for the puts ... 100 contracts or a limit of
  // $100,000"): a risk-sized put buys at most this many contracts (Owner
  // Settings ENGINES_PUT_MAX_QTY, 1 to riskMaxQty) and at most
  // `putMaxPremiumUsd` of premium (ENGINES_PUT_MAX_PREMIUM_USD), under the
  // caps above. Calls keep the caps above.
  putMaxQty: 100,
  putMaxQtyBefore: 10,
  putMaxPremiumUsd: 100000,
  riskWholeDte: 30,
  riskStopPad: 1.25,
  riskSkipX: 2,
  sharesMaxUsd: 250000,
  // The share cap before 2026-11-23 (rules notes only).
  sharesMaxUsdBefore: 25000,
  // Conviction sizing (2026-11-19, owner: "a real trader doesn't just buy 1
  // call or 1 put. They buy more or less based on conviction, positioning,
  // and opportunity"): the risk size times a multiplier kept inside
  // [convMin, convMax]. Every weight is in SIZE_WEIGHTS below and on the page.
  convMin: 0.5,
  convMax: 2,
  // The extreme-fear bounce test (2026-11-19): fires under this fear and
  // greed reading, and stands aside after a one-day drop of `crashDrop` or
  // worse in the prior five sessions (also Reversion's crash stand-aside).
  fearBelow: 25,
  fearMaxAgeDays: 3,
  crashDrop: -0.07,
});

// Conviction sizing weights (2026-11-19). Small on purpose: sizing by score
// alone cut the modeled option book 26% in the history test. Each input is a
// plain multiplier, shown on every trade; the product is clamped to
// BOOK.convMin..convMax and the result to 1..the contract cap (sizing.maxQty,
// default BOOK.riskMaxQty).
export const SIZE_WEIGHTS = Object.freeze({
  // Conviction: the score's distance over the engine's entry bar, 0.85x at
  // the bar up to 1.25x at 20+ points over it (linear).
  scoreAtBar: 0.85, scoreTop: 1.25, scoreSpan: 20,
  // The Allocator's read of the setup in today's market type: held back
  // (expected at or under zero) 0.75x; its size 1.5x or more 1.15x; 0.5x or
  // less 0.85x; too few results or no market type: 1x.
  allocHeld: 0.75, allocHigh: 1.15, allocLow: 0.85,
  // Opportunity (options): the IV band from lib/iv-richness.mjs (cheap 1.15x,
  // rich 0.85x, very rich 0.75x) and the spread (over 8% of the mid 0.9x,
  // over 12% 0.8x). Shares: 1x.
  ivCheap: 1.15, ivRich: 0.85, ivVeryRich: 0.75,
  spreadWide: 8, spreadWideX: 0.9, spreadVeryWide: 12, spreadVeryWideX: 0.8,
  // Positioning: the name already open in another engine or Top Picks 0.75x;
  // two or more open engine trades in its sector group 0.85x.
  nameHeld: 0.75, groupBusy: 2, groupBusyX: 0.85,
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
  "owner-avoid": "closed by the owner's Avoid",
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
const SIGNAL_SIX = ["earnings", "macro", "technicals", "fundamentals", "flow", "reversion"];
export const ENGINE_FIXES = freeze([
  freeze({ id: "retirePuts", env: "ENGINES_FIX_RETIRE_PUTS", step: 3, label: "Retire the two losing put setups", engines: ["technicals", "reversion"] }),
  freeze({ id: "bounce", env: "ENGINES_FIX_BOUNCE", step: 3, label: "Washout bounce: 0.3-delta calls about 21 days out, -60% stop", engines: ["reversion"] }),
  freeze({ id: "size", env: "ENGINES_FIX_SIZE", step: 3, label: "Option trades buy about $2,000 of premium (when risk sizing is off)", engines: SIGNAL_SIX }),
  freeze({ id: "stockStop", env: "ENGINES_FIX_TEC_SHARES", step: 3, label: "Technicals share trades: stop 3 ATR under the entry", engines: ["technicals"] }),
  // Honest paper trades (2026-11-19, the engine roadmap's build wave; docs/
  // engines.md "Honest paper trades"). Not picked from the history: these
  // make the record count what a real account would pay and hold.
  freeze({ id: "fillBasis", env: "ENGINES_FILL_BASIS", step: 4, label: "Option trades book the ask going in and the bid coming out", engines: SIGNAL_SIX }),
  freeze({ id: "riskSize", env: "ENGINES_RISK_SIZE", step: 4, label: "Size by risk: 1 contract up to the cap (200 contracts or $200,000 of premium unless set), about the risk budget a trade", engines: SIGNAL_SIX }),
  freeze({ id: "conviction", env: "ENGINES_SIZE_MULTIPLIER", step: 4, label: "Conviction sizing: more or fewer contracts by conviction, opportunity and positioning (0.5x to 2x)", engines: SIGNAL_SIX }),
  freeze({ id: "tecShares", env: "ENGINES_TEC_SHARES_ONLY", step: 4, label: "Technicals trades shares only (squeeze calls buy shares; squeeze and rally-fade puts retired)", engines: ["technicals"] }),
  freeze({ id: "crashStand", env: "ENGINES_CRASH_STANDASIDE", step: 4, label: "Reversion washout bounce stands aside after a 7%+ one-day drop in the prior five sessions", engines: ["reversion"] }),
  freeze({ id: "fearBounce", env: "ENGINES_FEAR_BOUNCE", step: 4, label: "Extreme-fear bounce test (one call plus a shares twin, fear and greed under 25)", engines: ["reversion"] }),
  // Live data pack (2026-11-20, owner: "anything labeled as build can be
  // built"; docs/engines.md "Live data pack"). Each one is an Owner Settings
  // switch, on by default, and the next rules number on the engines it reaches.
  freeze({ id: "convNoScore", env: "ENGINES_CONV_NO_SCORE", step: 5, label: "Conviction sizing leaves out the setup score on Reversion and Macro", engines: ["reversion", "macro"] }),
  freeze({ id: "runInShares", env: "ENGINES_RUNIN_BY_IV", step: 5, label: "Earnings run-in buys shares when its options are rich (calls when they are not)", engines: ["earnings"] }),
  // Downtrend pack (2026-11-20, owner: "We can increase fundamentals from 2
  // puts to 5 puts allowance" and "Our engines should all be news aware too
  // and adjust based on sentiment"; docs/engines.md "Downtrend pack"). Each
  // one an Owner Settings switch, on by default, and the next rules number
  // on the engines it reaches (with the put cap, BOOK.putMaxQty).
  freeze({ id: "funPuts", env: "ENGINES_FUN_PUTS5", step: 6, label: "Fundamentals holds up to 5 puts (3 calls, 8 slots)", engines: ["fundamentals"] }),
  freeze({ id: "newsGate", env: "ENGINES_NEWS_GATE", step: 6, label: "News gate: a news spike on a name with a souring tone blocks new longs there; a brightening tone blocks new puts", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "tapeSize", env: "ENGINES_TAPE_SIZE", step: 6, label: "Market-risk sizing: new longs shrink with the market tape (0.8x fragile, down to 0.6x risk-off, 0.4x severe risk-off); puts keep full size", engines: SIGNAL_SIX }),
  // Scorecard pack (2026-11-21, owner chose "Scorecard, brake, variants" on
  // the 2026-11-20 engine scorecard review; docs/engines.md "Scorecard pack").
  // Each one an Owner Settings switch, on by default, and the next rules
  // number on the engines it reaches.
  freeze({ id: "loserBrake", env: "ENGINES_LOSER_BRAKE", step: 7, label: "Loser brake: a setup whose own record (history plus live) has 30+ closes and t under -1 trades at half size (never under a quarter, never off)", engines: SIGNAL_SIX }),
  freeze({ id: "tecNoScore", env: "ENGINES_TEC_NO_SCORE", step: 7, label: "Conviction sizing leaves out the setup score on Technicals", engines: ["technicals"] }),
  // VIX and rates pack (2026-11-21, owner: "Build all five, one PR", from
  // the rotate-out-of-tech vs hedge history test; lib/engines/hedge.mjs,
  // docs/engines.md "VIX and rates pack"). Puts and inverse funds lost money
  // at every VIX trigger tested, so none of these hedges: they pause new tech
  // longs, move the Momentum basket out of tech, and size the standing
  // baskets by their volatility. The fifth rule (the VIX-rollover buy) is a
  // Macro paper trial (ENGINE_TRIALS). Each one an Owner Settings switch.
  freeze({ id: "vixPause", env: "ENGINES_VIX_PAUSE", step: 8, label: "VIX pause: no new tech or index-fund longs from a VIX jump under 25 until VIX closes back under its 50-day average", engines: PAUSE_ENGINES }),
  freeze({ id: "hikePause", env: "ENGINES_HIKE_PAUSE", step: 8, label: "Rate-hike pause: no new tech or index-fund longs while the 2-year is 0.5+ points over fed funds and QQQ is under its 200-day", engines: PAUSE_ENGINES }),
  freeze({ id: "momSectors", env: "ENGINES_MOM_SECTORS", step: 8, label: "Momentum holds the three strongest non-tech sector funds while QQQ closes a month under its 10-month average", engines: ["momentum"] }),
  freeze({ id: "volTarget", env: "ENGINES_VOL_TARGET", step: 8, label: "Volatility target: Momentum's new monthly holdings sized to 35% yearly volatility, the rest in T-bills", engines: ["momentum"] }),
  // Logic audit fixes (2026-11-21, owner: "Build all 6 fixes", from the
  // engine logic audit; docs/engines.md "Logic audit fixes"). Each one an
  // Owner Settings switch; off puts that part back the way it was.
  freeze({ id: "dearFull", env: "ENGINES_FIX_DEAR_FULL", step: 9, label: "Downside puts: the too-dear check reads the full risk budget (the half sizes only set the count)", engines: ["downside"] }),
  freeze({ id: "allocAdvise", env: "ENGINES_FIX_ALLOC_ADVISE", step: 9, label: "Allocator on advise: its read no longer moves the conviction size", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "heldSameSide", env: "ENGINES_FIX_HELD_SAME_SIDE", step: 9, label: "Name-held size cut counts only same-side trades, not the core engines' fund holdings", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "slotRetry", env: "ENGINES_FIX_SLOT_RETRY", step: 9, label: "A signal with no free slot or over the run limit can still open at a later run", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "runInEarly", env: "ENGINES_FIX_RUNIN_EARLY", step: 9, label: "Earnings run-in also closes at the 11:00 run on its last day before the report", engines: ["earnings"] }),
  // Bounce skip rules (2026-11-22, owner chose "Both skip rules, panic
  // exception" on the bounce falling-knife test; lib/engines/hedge.mjs
  // BOUNCE, docs/engines.md "Bounce skip rules").
  freeze({ id: "bounceSkip", env: "ENGINES_BOUNCE_SKIP", step: 10, label: "Bounce skip: no new washout bounce or RSI(2) dip while VIX is under 30 and the market is grinding lower", engines: ["reversion"] }),
  // Trade audit fixes (2026-11-24, owner chose "Build fixes 1-3" from the
  // 2026-11-23 engine audit; docs/engines.md "Trade audit fixes").
  freeze({ id: "contractFit", env: "ENGINES_FIX_CONTRACT_FIT", step: 11, label: "Contract choice: a strike within 0.15 of the target delta, else the best fit over the first four expiries", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "liquidAnd", env: "ENGINES_FIX_LIQUIDITY", step: 11, label: "Liquidity: open interest 50 with 10 traded today, or open interest 100", engines: [...SIGNAL_SIX, "downside"] }),
  freeze({ id: "shareRisk", env: "ENGINES_FIX_SHARE_RISK", step: 11, label: "Share sizing counts at least 1 ATR (or 2% of the price) of risk a share", engines: SIGNAL_SIX }),
]);
export const ENGINE_FIX_IDS = freeze(ENGINE_FIXES.map((f) => f.id));
const DOWNSIDE_RULES1 = freeze({ n: 1, date: "2026-11-20", note: "First rules (live test): puts on stocks that just lost their 200-day while the market tape is risk-off, half the risk budget, at most 10 contracts.", key: "downside-1" });
const FIX_STEP = freeze(Object.fromEntries(ENGINE_FIXES.map((f) => [f.id, f.step])));
const FIX_ENGINES = freeze(Object.fromEntries(ENGINE_FIXES.map((f) => [f.id, f.engines])));
const ALL_FIXES = freeze(Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, true])));
// What each fix says in an engine's rules note.
const FIX_PARTS = freeze({
  retirePuts: { technicals: "the range breakdown is retired (it lost 7.2% a trade over 88 trades in the 2007-2026 test)", reversion: "the spike-in-a-downtrend fade is retired (it lost 10.3% a trade over 284 trades in the 2007-2026 test)" },
  bounce: { reversion: "the washout bounce buys calls of about 0.3 delta, about 21 days out, with a -60% stop" },
  stockStop: { technicals: "share trades stop 3 ATR under the entry instead of at the setup's own stop or 2 ATR" },
  size: { "*": "option trades buy about $2,000 of premium instead of one contract (results in % are unchanged; the dollar totals now count every trade about the same)" },
  fillBasis: { "*": "new option trades book the ask going in and the bid coming out (they booked the mid both ways before); stops and targets still fire on the mid, only the booked result changes" },
  riskSize: { "*": "each trade is sized to risk about the budget (whole premium for options expiring within 30 days, premium x stop x 1.25 for longer ones, entry minus stop for shares), 1 to 10 contracts; a contract dearer than twice the budget is not bought, and a call side buys shares instead" },
  conviction: { "*": "the risk size is multiplied by a stated conviction read (score over the bar, the Allocator's read, the IV band, the spread, and what is already open in the name and its sector group), 0.5x to 2x; the flat risk size is kept beside it" },
  tecShares: { technicals: "shares only: the squeeze's up side buys shares, and the squeeze's down side and the downtrend rally fade (puts) are retired" },
  crashStand: { reversion: "the washout bounce stands aside when the prior five sessions include a one-day drop of 7% or more (flagged trades lost 12.6% a trade on real implied volatility, both halves)" },
  fearBounce: { reversion: "a labeled test: the extreme-fear bounce buys one call plus a shares twin when fear and greed is under 25, with the crash stand-aside built in" },
  convNoScore: { reversion: "conviction sizing leaves out the setup score (in the 2007-2026 test Reversion's 80-84 scores lost 5.2% a trade, worse than lower scores), so the size comes from the Allocator, the option price and what is already open", macro: "conviction sizing leaves out the setup score (in the 2007-2026 test Macro's 75-79 scores lost 4.1% a trade, worse than lower scores), so the size comes from the Allocator, the option price and what is already open" },
  runInShares: { earnings: "the pre-earnings run-in's up side buys shares when the stock's options are rich or very rich against its own history (it bought calls, and skipped very rich options), and calls otherwise; still closed before the report" },
  funPuts: { fundamentals: "puts on up to the five worst-ranked names (was two), calls still on the three best, eight slots in all" },
  newsGate: { "*": "a new long (call or shares) is not opened while the name's news volume is at least twice its usual with the tone souring (24-hour tone at least 1 point under the six days before), and a new put is not opened while the tone is brightening by as much; the skipped trade is tracked as a shadow trade so the gate can be scored" },
  tapeSize: { "*": "new longs (calls and shares) are sized down with the Top Picks market tape: its own de-gross multiplier (0.8x on a fragile tape, 0.6x to 1x risk-off by stress, 0.4x severe risk-off); puts keep their full size" },
  loserBrake: { "*": "the loser brake: a setup whose own record (the 2007-2026 history test on real option prices plus every live and shadow close since) has 30 or more closes and a t value under -1 trades at half size, never under a quarter of its size after the market tape and never skipped, so it keeps gathering live data; it only ever sizes down" },
  tecNoScore: { technicals: "conviction sizing leaves out the setup score (in the 2007-2026 test Technicals' 60-64 scores lost 0.84% a trade in both halves while its higher scores earned, so the score's 0.85x-1.25x step did not order results), so the size comes from the Allocator and what is already open" },
  vixPause: { "*": "no new long (call or shares) in a tech stock or a stock-index fund from a VIX jump while VIX is under 25 (up 20% in five sessions, or over 1.25x its 50-day average) until VIX closes back under its 50-day average; puts, paper trials and other names are untouched, and the skipped trade is tracked as a shadow trade" },
  hikePause: { "*": "no new long (call or shares) in a tech stock or a stock-index fund while the 2-year yield is 0.5 points or more over fed funds and QQQ is under its 200-day average (puts, paper trials and other names untouched; the skipped trade tracked as a shadow trade)" },
  momSectors: { momentum: "while QQQ closes a month under its 10-month average and SPY does not, the basket holds the three strongest non-tech sector funds (staples, health care, utilities, energy, financials, industrials, materials, consumer discretionary, real estate), ranked by their average 3, 6 and 12-month rise and each above its 10-month average and ahead of T-bills, at $10,000 each, instead of ten stocks" },
  volTarget: { momentum: "each new monthly holding is bought at min(1, 35% / the basket's trailing 126-session volatility) of its lot, the rest left in T-bills" },
  // The logic audit fixes (2026-11-21).
  dearFull: { downside: "a put is skipped as too dear only when one contract costs more than twice the full risk budget (it read the half and quarter budgets, so in extreme fear any put over $1,000 was skipped); the half sizes still set the number of contracts" },
  allocAdvise: { "*": "while the Allocator only advises, its read is recorded but no longer moves the conviction size (it sized setups up or down from the modeled-price history)" },
  heldSameSide: { "*": "the 0.75x name-held size cut counts only open trades on the same side, and not the Trend, Momentum and Rotation fund holdings" },
  slotRetry: { "*": "a signal turned away for no free slot or the run limit is still tracked as a shadow trade but can still open for real at a later run while the signal holds and room frees up (it is never shadowed twice)" },
  runInEarly: { earnings: "the pre-earnings run-in closes at whichever run comes first on its last day before the report (the 11:00 run too), so a late or missed afternoon run never holds it through the report" },
  // The bounce skip rules (2026-11-22).
  bounceSkip: { reversion: "the washout bounce and the RSI(2) dip trial open no new trade while VIX is under 30 and the market is grinding lower (SPY under its 50-day with more than 60% of covered names under theirs); with VIX at 30 or more both trade as before (in the 2007-2026 test those bounces lost money in both halves, while bounces with VIX 30+ made 2.44% a trade); a skipped washout bounce is tracked as a shadow trade" },
  // The trade audit fixes (2026-11-24).
  contractFit: { "*": "an option is taken from the expiry nearest the ideal only when its best strike is within 0.15 of the target delta; otherwise the best fit over the first four expiries in the window wins (it took the first expiry with any passing strike, so on 2026-11-23 a 0.50-delta put bought UNH at 0.70 delta with a 13.6% spread)" },
  liquidAnd: { "*": "a strike counts as liquid with open interest of 50 and at least 10 contracts traded today, or open interest of 100 (it passed with open interest of 50 or 10 traded, so one busy day let open interest of 3 or 4 through)" },
  shareRisk: { "*": "a risk-sized share trade counts at least 1 ATR, or 2% of the price, of risk a share, so a stop close to the entry cannot buy a very large position (with the $250,000 cap a 1% stop bought about $200,000 of stock, and a 5% gap through it lost about five times the budget); the stop itself is unchanged" },
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

// The rules note an engine runs under, from the fixes that reach it: rules 3
// (the money-leak fixes of 2026-11-17), the paper trials on Reversion and
// Macro (rules 4, 2026-11-19) and then the honest paper trades (2026-11-19:
// rules 5 on Reversion and Macro, rules 4 on the others), each over the rules
// it replaced. The note lists only the fixes
// that are on. `before` is the rules it replaced, so an engine a step or two
// behind logs every skipped note in one change (adoptRules); `key` names the
// fixes that reach this engine (and an Owner Settings instrument choice), so
// switching one off or on is logged as a rule change too (the record splits
// there), with `switchNote` as its text. While risk sizing is on, the $2,000
// premium size is not in force and is left out.
const INST_WORDS = freeze({ options: "options only", shares: "shares on the up side (puts stay options)", both: "an option plus a shares twin on the up side" });
function fixRules(id, on = ALL_FIXES, inst = null, trialsOn = ALL_TRIALS, maxQty = BOOK.riskMaxQty, putMaxQty = BOOK.putMaxQty, caps = null) {
  const partOf = (f) => FIX_PARTS[f][id] || FIX_PARTS[f]["*"];
  // The live data pack (step 5) and the downtrend pack (step 6) are keyed and
  // noted by their own layers (packRules).
  const reach = ENGINE_FIX_IDS.filter((f) => FIX_STEP[f] < 5 && on[f] && partOf(f) && !(f === "size" && on.riskSize) && !(f === "conviction" && !on.riskSize));
  // Rules 3 as adopted on 2026-11-17 (the $2,000 size included while its
  // switch is on, even when risk sizing has replaced it since).
  const r3 = ENGINE_FIX_IDS.filter((f) => FIX_STEP[f] === 3 && on[f] && partOf(f)), r4 = reach.filter((f) => FIX_STEP[f] === 4);
  const instPart = inst && INST_WORDS[inst] ? `the owner chose ${INST_WORDS[inst]} for every setup` : null;
  const parts = [...reach.map(partOf), ...(instPart ? [instPart] : [])];
  const key = `fixes:${reach.join(",")}${inst ? `|inst:${inst}` : ""}`;
  const switchNote = parts.length
    ? `Rule changes switched in Owner Settings. On now: ${parts.join("; ")}.`
    : "Rule changes switched off in Owner Settings: back to the rules before the money-leak fixes.";
  const rules3 = r3.length ? freeze({ n: 3, date: "2026-11-17", note: `New rules (the money-leak fixes): ${r3.map(partOf).join("; ")}.`, before: RULES_BEFORE[id] }) : RULES_BEFORE[id];
  // The paper trials (rules 4 on Reversion and Macro, #870) sit under the
  // honest paper trades, which take the next number on every engine they
  // reach (5 there, 4 elsewhere, never under 4), so the record splits on
  // their own date.
  const base = trialRules(freeze({ ...rules3, key, switchNote }), id, trialsOn, "under");
  const honest = !r4.length && !instPart ? base
    : freeze({ n: Math.max(4, (base.n || 1) + 1), date: "2026-11-19", note: `New rules (honest paper trades): ${[...r4.map(partOf), ...(instPart ? [instPart] : [])].join("; ")}.`, before: base, key: base.key, switchNote: base.switchNote });
  const live = packRules(capRules(honest, on, maxQty, caps), id, on, LIVE_PACK);
  // The downtrend pack is the newest layer, so it sits on top (a running
  // engine logs every note over the number it is on, oldest first).
  const down = packRules(trialRules(live, id, trialsOn, "top"), id, on, downPack(on, maxQty, putMaxQty, caps));
  // The scorecard pack (2026-11-21) and then the VIX and rates pack (same
  // day, merged after it) are the newest layers: the latter's paper trial
  // (the VIX-rollover buy on Macro) and then its fixes.
  const card = packRules(down, id, on, SCORE_PACK);
  const hedge = packRules(trialRules(card, id, trialsOn, "hedge"), id, on, HEDGE_PACK);
  // The logic audit fixes (2026-11-21), then the bounce skip rules
  // (2026-11-22), the newest layer.
  const bounce = packRules(packRules(hedge, id, on, AUDIT_PACK), id, on, BOUNCE_PACK);
  // The bigger size limits (2026-11-23), then the trade audit fixes
  // (2026-11-24), the newest layer.
  return packRules(sizeLimitRules(bounce, on, maxQty, putMaxQty, caps), id, on, TRADE_PACK);
}
// The bigger size limits (2026-11-23, owner: "Options up to 200 contracts
// per trade or a limit of $200,000 whichever first", puts "100 contracts or
// a limit of $100,000", shares "at most $250,000"): a dated rules step on
// every signal engine while risk sizing is on, so the record splits on the
// day the caps took effect. Its key is the layer below's (the caps are
// already in it), so a later change in Owner Settings is a rule change too.
function sizeLimitRules(base, on, maxQty, putMaxQty, caps = null) {
  if (!on.riskSize) return base;
  const cap = normalizeMaxQty(maxQty), prem = normalizePremiumUsd(caps?.maxPremiumUsd), shares = normalizeSharesMaxUsd(caps?.sharesMaxUsd);
  const putCap = Math.min(cap, normalizePutMaxQty(putMaxQty)), putPrem = Math.min(prem, normalizePutPremiumUsd(caps?.putMaxPremiumUsd));
  const puts = putCap < cap || putPrem < prem ? `; a risk-sized put 1 to ${putCap} contract${putCap === 1 ? "" : "s"} and at most ${usdWords(putPrem)} (was 1 to ${BOOK.putMaxQtyBefore})` : "";
  return freeze({
    n: (base.n || 1) + 1, date: "2026-11-23",
    note: `New rules (bigger size limits): ${capWords(cap)} and at most ${usdWords(prem)} of premium, whichever comes first (was 1 to ${BOOK.riskMaxQtyBefore23}, no premium cap)${puts}; a risk-sized share trade buys at most ${usdWords(shares)} of stock (was ${usdWords(BOOK.sharesMaxUsdBefore)}). Trades already open keep their size; the risk budget and the conviction multiplier still set most sizes.`,
    before: base, key: base.key, switchNote: base.switchNote,
  });
}
// An engine born after the fixes (Downside puts) keeps its own first rules,
// with only the logic audit fixes that reach it layered on top.
function ownRules(id, first, on = ALL_FIXES) {
  return packRules(packRules(first, id, on, AUDIT_PACK), id, on, TRADE_PACK);
}
// The core engines' rules: their first rules with the VIX and rates pack on
// top (Momentum's sector switch and volatility target; the Trend follower
// and the rotation have none).
const CORE_RULES = freeze({
  trend: freeze({ n: 1, date: "2026-11-17", note: "First rules: dual momentum with a T-bill fallback, checked once a month." }),
  momentum: freeze({ n: 1, date: "2026-11-17", note: "First rules: the ten strongest stocks by 12-1 momentum, re-picked monthly, Treasuries or T-bills while the S&P 500 is under its 10-month average." }),
  rotation: freeze({ n: 1, date: "2026-11-20", note: "First rules (a live paper test): the three strongest of ten funds by their average 3, 6 and 12-month rise, each above its 10-month average and ahead of T-bills over 12 months, re-picked monthly; an empty place stays in T-bills." }),
});
function coreRules(id, on = ALL_FIXES) {
  return packRules(CORE_RULES[id], id, on, HEDGE_PACK);
}
// A pack of fixes that came in on one day (the live data pack, step 5; the
// downtrend pack, step 6, both 2026-11-20): the pack's fixes that reach this
// engine, on top of everything above, as the next rules number dated the day
// they came in. `key` gains "|<tag>:" and the fixes that are on (plus any
// extra the pack carries, such as the put cap), so switching one in Owner
// Settings is logged as a rule change.
const LIVE_PACK = freeze({ step: 5, tag: "live", name: "live data pack", date: "2026-11-20" });
const SCORE_PACK = freeze({ step: 7, tag: "card", name: "scorecard pack", date: "2026-11-21" });
const HEDGE_PACK = freeze({ step: 8, tag: "hedge", name: "VIX and rates pack", date: "2026-11-21" });
const AUDIT_PACK = freeze({ step: 9, tag: "audit", name: "logic audit fixes", date: "2026-11-21" });
const BOUNCE_PACK = freeze({ step: 10, tag: "bounce", name: "bounce skip rules", date: "2026-11-22" });
const TRADE_PACK = freeze({ step: 11, tag: "trade", name: "trade audit fixes", date: "2026-11-24" });
// The downtrend pack also carries the put cap (BOOK.putMaxQty, Owner Settings
// ENGINES_PUT_MAX_QTY) while risk sizing is on.
function downPack(on, maxQty, putMaxQty, caps = null) {
  // A put cap at or over the calls' cap is no cap of its own.
  const all = normalizeMaxQty(maxQty), put = Math.min(all, normalizePutMaxQty(putMaxQty));
  const allPrem = normalizePremiumUsd(caps?.maxPremiumUsd), putPrem = Math.min(allPrem, normalizePutPremiumUsd(caps?.putMaxPremiumUsd));
  const cap = on.riskSize && put < all ? put : null, prem = on.riskSize && putPrem < allPrem ? putPrem : null;
  const words = [cap ? `1 to ${cap} contract${cap === 1 ? "" : "s"}` : null, prem ? `at most ${usdWords(prem)} of premium` : null].filter(Boolean);
  return freeze({ step: 6, tag: "down", name: "downtrend pack", date: "2026-11-20",
    extraKey: `${cap ? `|putcap:${cap}` : ""}${prem ? `|putprem:${prem}` : ""}`,
    extra: words.length ? `each risk-sized put buys ${words.join(", ")}${cap && prem ? ", whichever comes first" : ""} (calls keep the ${all}-contract, ${usdWords(allPrem)} caps)` : null });
}
function packRules(base, id, on, pack) {
  const partOf = (f) => FIX_PARTS[f]?.[id] || FIX_PARTS[f]?.["*"];
  const mine = ENGINE_FIX_IDS.filter((f) => FIX_STEP[f] === pack.step && partOf(f) && (FIX_ENGINES[f] || []).includes(id));
  if (!mine.length && !pack.extra) return base;
  const live = mine.filter((f) => on[f]), offLabels = mine.filter((f) => !on[f]).map((f) => `${ENGINE_FIXES.find((x) => x.id === f).label} is switched off`);
  const parts = [...live.map(partOf), ...(pack.extra ? [pack.extra] : [])];
  const key = `${base.key ?? ""}|${pack.tag}:${live.join(",")}${pack.extraKey || ""}`;
  const switchNote = `${base.switchNote || "Rules switched in Owner Settings."}${parts.length ? ` ${pack.name[0].toUpperCase()}${pack.name.slice(1)} on: ${parts.join("; ")}.` : ""}${offLabels.length ? ` ${offLabels.join("; ")}.` : ""}`;
  if (!parts.length) return freeze({ ...base, key, switchNote });
  return freeze({ n: (base.n || 1) + 1, date: pack.date, note: `New rules (${pack.name}): ${parts.join("; ")}.`, before: base, key, switchNote });
}
// The contract cap (2026-11-20, owner: "both to 25 and we can raise or lower
// in owner settings"). Under risk sizing the cap of 10 set the size of about
// two option trades in three in the history test, so the conviction
// multiplier could rarely move it. A cap other than the old 10 is the next
// rules number, dated the day it came in; the cap is in the rules `key`, so
// changing Owner Settings ENGINES_MAX_QTY later is logged as a rule change
// and the record splits there.
const capWords = (cap) => `each risk-sized option trade buys 1 to ${cap} contract${cap === 1 ? "" : "s"}`;
const usdWords = (x) => "$" + Math.round(x).toLocaleString("en-US");
// The premium and share caps (2026-11-23, owner: options "up to 200
// contracts per trade or a limit of $200,000 whichever first", shares "at
// most $250,000"): both are in the rules key, so changing either in Owner
// Settings is logged as a rule change and the record splits there.
const sizeCapWords = (cap, caps) => `${capWords(cap)} and at most ${usdWords(normalizePremiumUsd(caps?.maxPremiumUsd))} of premium, whichever comes first; a risk-sized share trade buys at most ${usdWords(normalizeSharesMaxUsd(caps?.sharesMaxUsd))} of stock`;
function capRules(honest, on, maxQty, caps = null) {
  if (!on.riskSize) return honest;
  const cap = normalizeMaxQty(maxQty), was = BOOK.riskMaxQtyBefore;
  const key = `${honest.key ?? ""}|cap:${cap}|prem:${normalizePremiumUsd(caps?.maxPremiumUsd)}|shcap:${normalizeSharesMaxUsd(caps?.sharesMaxUsd)}`;
  const switchNote = `${honest.switchNote || "Rules switched in Owner Settings."} Size range: ${sizeCapWords(cap, caps)}.`;
  if (cap === was) return freeze({ ...honest, key, switchNote });
  return freeze({
    n: (honest.n || 1) + 1, date: "2026-11-20",
    // The cap of that day (25 unless set lower; 200 since the 2026-11-23 step).
    note: `New rules (${cap > was ? "wider" : "narrower"} size range): ${capWords(Math.min(cap, BOOK.riskMaxQtyBefore23))} (was 1 to ${was})${cap > was ? ", so the risk budget and the conviction multiplier set the size instead of the cap" : ""}; the Riskier dial stops at the same cap.`,
    before: honest, key, switchNote,
  });
}
// Owner Settings ENGINES_MAX_QTY: a whole number from 1 to BOOK.riskMaxQty;
// anything else is the default.
export function normalizeMaxQty(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= BOOK.riskMaxQty ? n : BOOK.riskMaxQty;
}
// Owner Settings ENGINES_PUT_MAX_QTY (2026-11-20): a whole number from 1 to
// BOOK.riskMaxQty; anything else is the default (BOOK.putMaxQty: 100 since
// 2026-11-23, 10 before).
export function normalizePutMaxQty(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n >= 1 && n <= BOOK.riskMaxQty ? n : BOOK.putMaxQty;
}
// Owner Settings ENGINES_MAX_PREMIUM_USD (2026-11-23): dollars of premium one
// risk-sized option trade may buy, 1,000 to 1,000,000; anything else is the
// default (BOOK.maxPremiumUsd, $200,000).
export function normalizePremiumUsd(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 1000 && n <= 1000000 ? n : BOOK.maxPremiumUsd;
}
// Owner Settings ENGINES_PUT_MAX_PREMIUM_USD (2026-11-23): the premium cap
// on a put, $1,000 to $1,000,000; anything else is the default
// (BOOK.putMaxPremiumUsd, $100,000).
export function normalizePutPremiumUsd(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 1000 && n <= 1000000 ? n : BOOK.putMaxPremiumUsd;
}
// Owner Settings ENGINES_SHARES_MAX_USD (2026-11-23): dollars of stock one
// risk-sized share trade may buy, 1,000 to 1,000,000; anything else is the
// default (BOOK.sharesMaxUsd, $250,000).
export function normalizeSharesMaxUsd(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 1000 && n <= 1000000 ? n : BOOK.sharesMaxUsd;
}
// The most contracts the premium cap lets one option trade buy at `cost1`
// dollars a contract (premium x 100): at least one, so the cap never skips
// a trade the risk budget allows (a contract over the cap is already skipped
// as too dear, at twice the risk budget).
export function premiumMaxQty(cost1, maxPremiumUsd) {
  const c = Number(cost1);
  if (!(c > 0)) return Infinity;
  return Math.max(1, Math.floor(normalizePremiumUsd(maxPremiumUsd) / c + 1e-9));
}
// The news gate (downtrend pack, 2026-11-20): the bake's GDELT read for the
// name (view.live.news from lib/policy-news: `nvr` news volume over the last
// 24 hours against the six days before; `ntn` the 24-hour tone minus the six
// days before, read only on a volume spike). A spike (twice the usual
// volume, GDELT_SPIKE_RATIO) with the tone down a point or more blocks a new
// long; with the tone up a point or more it blocks a new put. A name with no
// read (not covered, or stale) is never blocked: "no read" is not "no news".
export const NEWS_GATE = Object.freeze({ ratio: 2, tone: 1 });
export function newsBlock(news, side) {
  const nvr = Number(news?.nvr), ntn = Number(news?.ntn);
  if (news?.nvr == null || news?.ntn == null || !Number.isFinite(nvr) || !Number.isFinite(ntn) || nvr < NEWS_GATE.ratio) return null;
  const read = `${Math.round(nvr * 10) / 10}x its usual news volume, tone ${ntn > 0 ? "+" : ""}${Math.round(ntn * 100) / 100}`;
  if (side !== "put" && ntn <= -NEWS_GATE.tone) return `news gate: a news spike with a souring tone (${read}) blocks new longs`;
  if (side === "put" && ntn >= NEWS_GATE.tone) return `news gate: a news spike with a brightening tone (${read}) blocks new puts`;
  return null;
}
// Market-risk sizing (downtrend pack, 2026-11-20): the Top Picks market tape
// (computeMacroRegime in scripts/build.mjs: indexes, VIX, dollar, yields,
// Fed path, credit, breadth, fear and greed, put/call and more) and its own
// de-gross multiplier. A new long is sized by it; a put is not. Missing or
// insufficient data, risk-on and a plain neutral tape are 1x.
export const TAPE_MULT = Object.freeze({ "severe-risk-off": 0.4, "risk-off": 0.6, fragile: 0.8, min: 0.4 });
export function tapeRead(state, gross) {
  if (!state || state === "insufficient-data" || state === "risk-on") return { state: state || null, mult: 1 };
  const g = Number(gross);
  const own = gross != null && Number.isFinite(g) && g > 0 && g < 1 ? Math.max(TAPE_MULT.min, Math.round(g * 100) / 100) : null;
  if (state === "severe-risk-off" || state === "risk-off") return { state, mult: own ?? TAPE_MULT[state] };
  // A neutral tape with its own multiplier under 1 is the fragile one.
  if (state === "neutral" && own != null) return { state: "fragile", mult: own };
  return { state, mult: 1 };
}
// The most contracts a risk-sized trade on this side buys: a put is held
// under both caps.
export function sideMaxQty(sizing, side) {
  const cap = normalizeMaxQty(sizing?.maxQty);
  return side === "put" ? Math.min(cap, normalizePutMaxQty(sizing?.putMaxQty)) : cap;
}
// The most premium a risk-sized trade on this side buys (2026-11-23): a put
// is held under both premium caps.
export function sideMaxPremiumUsd(sizing, side) {
  const cap = normalizePremiumUsd(sizing?.maxPremiumUsd);
  return side === "put" ? Math.min(cap, normalizePutPremiumUsd(sizing?.putMaxPremiumUsd)) : cap;
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
// `layer`: "under" = the first trials (2026-11-19), which sit under the
// honest paper trades in the rules chain; "top" = trials added later, the
// newest rules number on their engine, dated `date`.
export const ENGINE_TRIALS = freeze([
  freeze({ id: "rsi2Dip", env: "ENGINES_TRIAL_RSI2_DIP", engine: "reversion", setup: "rsi2-dip", label: "Paper trial: RSI(2) dip in an uptrend (shares)", date: "2026-11-19", layer: "under" }),
  freeze({ id: "fearIndex", env: "ENGINES_TRIAL_FEAR_INDEX", engine: "macro", setup: "fear-index", label: "Paper trial: index funds after extreme fear (shares)", date: "2026-11-19", layer: "under" }),
  // Flow trials (2026-11-20, owner: "can we try running the flow engine").
  // The Flow engine's own setups need five prints with a readable bought or
  // sold side, and most hourly prints have none (the last trade is too old
  // to sign), so it opened nothing. These two read data it does have.
  freeze({ id: "bigOrder", env: "ENGINES_TRIAL_BIG_ORDER", engine: "flow", setup: "big-order-buying", label: "Paper trial: Webull big-order buying (shares)", date: "2026-11-20", layer: "top" }),
  freeze({ id: "optionSurge", env: "ENGINES_TRIAL_OPTION_SURGE", engine: "flow", setup: "option-surge", label: "Paper trial: call volume surge with the stock rising (shares)", date: "2026-11-20", layer: "top" }),
  // The VIX and rates pack (2026-11-21): QQQ shares when VIX rolls over from
  // a spike (lib/engines/hedge.mjs), the newest layer on Macro.
  freeze({ id: "vixRollover", env: "ENGINES_TRIAL_VIX_ROLLOVER", engine: "macro", setup: "vix-rollover", label: "Paper trial: QQQ shares when VIX rolls over from a spike", date: "2026-11-21", layer: "hedge" }),
]);
export const ENGINE_TRIAL_IDS = freeze(ENGINE_TRIALS.map((t) => t.id));
const ALL_TRIALS = freeze(Object.fromEntries(ENGINE_TRIAL_IDS.map((id) => [id, true])));
const TRIAL_PARTS = freeze({
  rsi2Dip: "the RSI(2) dip in an uptrend (above the 200-day, 2-day RSI under 5) buys $5,000 of stock and sells on a close back above the 5-day average or after 10 sessions",
  fearIndex: "when Fear & Greed first closes under 25, it buys $5,000 each of SPY, QQQ and IWM and holds them 20 sessions, with no stop or target",
  bigOrder: "a stock whose large orders were net buyers over the last five sessions (at least 10% of everything traded, Webull capital flow) and on the latest session, above its 50-day, buys $5,000 of stock for up to 10 sessions with the usual 2 ATR stop and 3 ATR target",
  vixRollover: `after VIX has been 25 or higher within 10 sessions and closes 15% under that peak, it buys $${HEDGE.rollUsd.toLocaleString("en-US")} of ${HEDGE.rollFund} and holds it ${HEDGE.rollSessions} sessions, with no stop or target (at most one buy every ${HEDGE.rollGap} sessions)`,
  optionSurge: "a stock with $500k+ of flagged call volume (7+ days out) today, 70%+ of its flagged premium in calls, above its 50-day and rising today, buys $5,000 of stock for up to 10 sessions with the usual 2 ATR stop and 3 ATR target (the side of each print is often unreadable, so the stock's own move stands in)",
});
// The engine's rules with its paper trials on top. A trial that is on makes
// the next rules number (dated the day it was added); all off leaves the
// rules underneath. `key` names the trials that are on, so switching one in
// Owner Settings is logged as a rule change (adoptRules) and the record
// splits there.
function trialRules(base, id, on = ALL_TRIALS, layer = "under") {
  const mine = ENGINE_TRIALS.filter((t) => t.engine === id && (t.layer || "under") === layer);
  if (!mine.length) return base;
  const live = mine.filter((t) => on[t.id] !== false);
  const key = `${base.key ?? ""}|${layer === "top" ? "trials2" : layer === "hedge" ? "trials3" : "trials"}:${live.map((t) => t.id).join(",")}`;
  const off = mine.filter((t) => on[t.id] === false).map((t) => `${t.label} is switched off and opens nothing new`);
  if (!live.length) return freeze({ ...base, key, switchNote: `${base.switchNote || "Rules switched in Owner Settings."} ${off.join("; ")}.` });
  const parts = live.map((t) => TRIAL_PARTS[t.id]);
  return freeze({
    n: (base.n || 1) + 1, date: live.map((t) => t.date || "2026-11-19").sort().pop(),
    note: `New rules: ${parts.length > 1 ? "paper trials are" : "a paper trial is"} added, labeled unproven: ${parts.join("; ")}.`,
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
      // Live data pack (2026-11-20, ENGINES_RUNIN_BY_IV): the up side buys
      // shares when the options are rich or very rich (`ivShares`).
      "run-in": setup("Pre-earnings run-in", "A stock that rose into most of its last 8 reports, in an uptrend, 4 to 9 sessions before the next one. Calls, or shares when the stock's options are rich or very rich against its own history (since 2026-11-20). Always closed before the report.", { exits: { tp: 25, stop: -35, maxSessions: 8 }, ivShares: true }),
    }),
    test: "replay",
  }),
  macro: freeze({
    id: "macro", tag: "MAC", name: "Macro",
    idea: "Trades index, bond, gold and Asia funds only, from rates, the dollar, financial conditions, the VIX curve and the reaction to Fed, CPI and jobs days.",
    reads: ["10-year and 2-year yields", "Chicago Fed financial conditions", "VIX against 3-month VIX", "Trade-weighted dollar", "Fed, CPI and jobs dates", "Fund prices (SPY, QQQ, IWM, TLT, GLD, EWY, KWEB)"],
    universe: "etfs", slots: 3, perRun: 1,
    // Live data pack (2026-11-20, ENGINES_CONV_NO_SCORE): conviction sizing
    // leaves out the setup score.
    convScore: false,
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
    rules: fixRules("macro"),
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
      // Paper trial (2026-11-21, the VIX and rates pack; ENGINES_TRIAL_VIX_ROLLOVER).
      // In the 2007-2026 test (72 events, VIX 25+ within 10 sessions and a
      // close 15% under that peak, 20 sessions apart) QQQ rose 2.1% over the
      // next 20 sessions, 69% of the time, against 1.35% on any day, in both
      // halves; the worst was -18% and the average dip on the way was -4.5%.
      "vix-rollover": setup("QQQ when VIX rolls over (paper trial)", "Paper trial, unproven (added 2026-11-21): the session after VIX, having closed at 25 or higher within the last 10 sessions, closes 15% or more under that peak, buys $25,000 of QQQ and holds it 20 sessions, with no stop or target (as tested). At most one buy every 20 sessions.",
        { calls: "shares", trial: true, slots: 1, perRun: 1, levels: false, exits: { maxSessions: 20 } }),
    }),
    test: "history",
  }),
  technicals: freeze({
    id: "technicals", tag: "TEC", name: "Technicals",
    idea: "Price and volume only. Buys shares on pullbacks inside strong trends, on breakouts from tight ranges on heavy volume and on squeeze breaks to the upside. Shares only since 19 November 2026 (its puts are retired: the engines never short stock).",
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
    // Scorecard pack (2026-11-21, ENGINES_TEC_NO_SCORE): conviction sizing
    // leaves out the setup score.
    convScore: false,
    setups: freeze({
      "pullback": setup("Trend pullback", "An uptrend (price, 50-day and 200-day in order, 50-day still rising), a 2-day RSI washout near the 20-day, then a close back up. Buys shares.", { calls: "shares" }),
      "rally-fade": setup("Downtrend rally fade (retired)", "Retired 2026-11-19 (Technicals trades shares only, and a put can't become shares: the engines never short). It had been on shadow since it started. Was: a downtrend (price, 50-day and 200-day in order, 50-day still falling), a 2-day RSI spike near the 20-day, then a close back down. Puts.", { probation: true, retired: true }),
      "breakout": setup("Range breakout", "A close through the prior 55-day high, a move of 0.8 ATR+, volume 1.4x normal, above the 200-day. Buys shares.", { calls: "shares" }),
      "breakdown": setup("Range breakdown (retired)", "Retired 2026-11-17: lost 7.2% a trade over 88 trades in the 2007-2026 history test, in both halves, while the stocks rose 3.2% against the puts. Was: a close through the prior 55-day low, a move of 0.8 ATR+, volume 1.4x normal, under the 200-day. Puts.", { retired: true }),
      // Shares only (2026-11-19, rules 4): the up side buys shares; the down
      // side (puts) is retired, kept here so old put trades keep their checks.
      "squeeze": setup("Squeeze break", "Bollinger width in the lowest 15% of six months, then a close above the band with volume. Buys shares. (The down side, a close below the band, bought puts until 2026-11-19 and is retired.)", { calls: "shares", retiredSides: ["put"] }),
    }),
    test: "history",
  }),
  fundamentals: freeze({
    id: "fundamentals", tag: "FUN", name: "Fundamentals",
    idea: "Keeps one standing rank of every covered stock on earnings power, quality and price. Holds calls on the three best names it can buy and puts on the five worst, in longer-dated options, and swaps one only when it leaves the top or bottom third. A stock is ranked again when the month changes and after each of its reports. No chart pattern and no flow can open a trade here.",
    reads: ["EPS growth and beat record", "Estimate revisions and revenue growth", "Margins, return on equity, free cash flow, debt", "Forward P/E against its sector group", "Analyst targets"],
    universe: "stocks", slots: 8, perRun: 1,
    // Three calls and five puts at most (two puts and five slots until
    // 2026-11-20, the downtrend pack; ENGINES_FUN_PUTS5 off puts that back).
    // `standing`: a name that has no free slot today is not tracked as a
    // shadow trade, so it can still open when a slot frees up.
    sideSlots: freeze({ call: 3, put: 5 }), standing: true,
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
      // Paper trials (2026-11-20, ENGINES_TRIAL_BIG_ORDER and
      // ENGINES_TRIAL_OPTION_SURGE). Neither was in a history test (Webull
      // keeps five days of order flow, and the flagged-print log seven), so
      // they trade on paper to learn whether the signal holds up live.
      "big-order-buying": setup("Big-order buying (paper trial)", "Paper trial, untested (added 2026-11-20): Webull's capital flow shows large orders net buying over the last five sessions (at least 10% of everything traded in the stock) and on the latest session, with the stock above its 50-day. Buys $5,000 of stock and holds it up to 10 sessions, with a 2 ATR stop and a 3 ATR target.",
        { calls: "shares", trial: true, slots: 3, perRun: 1, exits: { maxSessions: 10 } }),
      "option-surge": setup("Call volume surge (paper trial)", "Paper trial, untested (added 2026-11-20): $500k+ of flagged call volume 7+ days out today, 70%+ of the stock's flagged premium in calls, the stock above its 50-day and rising today. Most prints have no readable bought or sold side, so the stock's own move stands in for it. Buys $5,000 of stock and holds it up to 10 sessions, with a 2 ATR stop and a 3 ATR target.",
        { calls: "shares", trial: true, slots: 3, perRun: 1, exits: { maxSessions: 10 } }),
    }),
    test: "forward",
  }),
  reversion: freeze({
    id: "reversion", tag: "REV", name: "Reversion",
    idea: "Bets against stretched moves. Buys washed-out stocks that are still in long-term uptrends (its fade of spikes in downtrends was retired on 17 November 2026), and stands aside after a crash day. Short holds, quick exits. Since 19 November 2026 it also runs a labeled test: the same washout bought only in extreme fear.",
    reads: ["2-day RSI and distance from the 20-day", "5-day move in ATRs", "200-day trend", "Volume on the washout day", "Earnings dates (it stands aside near a report)"],
    universe: "all", slots: 4, perRun: 2,
    convScore: false,
    contract: freeze({ dteMin: 14, dteIdeal: 25, dteMax: 45, delta: 0.6 }),
    exits: freeze({ tp: 30, stop: -35, maxSessions: 5 }),
    bar: freeze({ base: 60, min: 54, max: 78, step: 2 }),
    // Rules 2 (2026-11-17): fit the contract to the signal. Rules 3
    // (2026-11-17, the money-leak fixes): the downtrend spike fade is retired
    // and the washout bounce buys cheaper, shorter calls with a wider stop.
    rules: fixRules("reversion"),
    setups: freeze({
      // Own contract and stop (2026-11-17): 0.3-delta calls about 21 days out
      // with a -60% stop. Re-run through the whole 2007-2026 book as the
      // engine runs: +7.7% a trade over 884 trades against +0.8% over 981
      // for the engine's 0.6-delta 25-day calls, ahead in both halves (+5.3%
      // against +1.8% with every setup trading). Part of it is the option
      // price model (+3.5% against +1.2% with volatility held flat in the
      // trade-by-trade replay).
      // Crash stand-aside (2026-11-19, owner: "Yes, live with a kill
      // switch"): no bounce buy when the prior five sessions (the entry day
      // not counted) include a one-day drop of 7% or more. On real implied
      // volatility those flagged trades lost 12.6% a trade, in both halves.
      "oversold-bounce": setup("Washout in an uptrend", "Above the 200-day, 2-day RSI under 8, 1.8+ standard deviations under the 20-day after a 5-day drop of 2 ATR+. Calls of about 0.3 delta, 14 to 35 days out (ideal 21), closed when price is back at the 20-day; -60% stop. Stands aside when the prior five sessions had a one-day drop of 7% or more.",
        { contract: { dteMin: 14, dteIdeal: 21, dteMax: 35, delta: 0.3 }, exits: { stop: -60 }, crashStand: true }),
      "overbought-fade": setup("Spike in a downtrend (retired)", "Retired 2026-11-17: lost 10.3% a trade over 284 trades in the 2007-2026 history test, every year and in both halves; the stocks moved 0.0% the puts' way. Was: under the 200-day, 2-day RSI over 92, 1.8+ standard deviations over the 20-day after a 5-day rise of 2 ATR+. Puts, closed back at the 20-day.", { probation: true, retired: true }),
      "capitulation": setup("Capitulation day", "A 3-day fall of 3 ATR+ ending on 2x volume with a close in the top 40% of the day's range. Buys shares, target the 10-day.", { calls: "shares" }),
      // Paper trial (2026-11-19, ENGINES_TRIAL_RSI2_DIP). In the 2007-2026
      // test on real prices: +0.62% a trade over 4,181 trades (+0.63% /
      // +0.62% by half), ahead of the same stocks on random days (t 3.0) and
      // of SPY (t 5.1), but under the bar for 553 tries (t 3.9) and weak on
      // sector funds (+0.21%), so it is unproven: labeled, on paper only.
      "rsi2-dip": setup("RSI(2) dip in an uptrend (paper trial)", "Paper trial, unproven (added 2026-11-19): above the 200-day with a 2-day RSI under 5. Buys $5,000 of stock and sells on a close back above the 5-day average, after 10 sessions, or at the usual 2 ATR stop / 3 ATR target. Calls on these dips lost money on real option prices, so it buys shares only.",
        { calls: "shares", trial: true, slots: 4, perRun: 2, exits: { maxSessions: 10 } }),
      // The extreme-fear bounce test (2026-11-19, owner: "add an engine or a
      // strategy that does the extreme fear bounce and test it on webull").
      // The washout's own conditions while the market's fear and greed
      // reading is under 25 (CNN's, from fear-greed.json), with the crash
      // stand-aside built in. On real implied volatility these calls lost
      // 9.3% a trade in 2007-2026 (+14.4% on the old modeled prices), so it is
      // a labeled paper test, not a proven setup: one call plus a shares twin,
      // scored apart. Its own pool (`pool`: slots, run limit and the
      // one-per-name rule apart from the washout bounce), its own trade IDs
      // (suffix "-XF") and its own contract at Webull (`ownFills`: it never
      // takes a contract another trade already holds, so it is never a
      // follower and nothing is counted twice).
      "fear-bounce": setup("Extreme-fear bounce (test)", "Test since 2026-11-19. The washout in an uptrend (above the 200-day, 2-day RSI under 8, 1.8+ standard deviations under the 20-day after a 5-day drop of 2 ATR+) while CNN's fear and greed reading is under 25. Stands aside when the prior five sessions had a one-day drop of 7% or more. Buys one call of about 0.3 delta, 14 to 35 days out, plus a shares twin, scored apart; -60% stop on the call, closed back at the 20-day.",
        { test: true, instrument: "both", qty: 1, pool: "fear", slots: 3, perRun: 1, ownFills: true, idSuffix: "XF", crashStand: true,
          contract: { dteMin: 14, dteIdeal: 21, dteMax: 35, delta: 0.3 }, exits: { stop: -60 } }),
    }),
    test: "history",
  }),
  // Downside puts (2026-11-20, owner: "an engine that only fires puts but
  // under certain conditions, it checks out market risk, sentiment and odds,
  // our bubble tracker feature, and makes decisions based off stocks losing
  // 200 SMA, market news"). A live paper test at half the risk budget: in
  // the 2007-2026 history test (about 70 stocks, 1,881 first closes under
  // the 200-day after 20+ sessions above it) the stocks rose 1.6% over the
  // next 20 sessions and 45-day puts lost money under every gate the test
  // could see (best: SPY under its 200-day with hikes priced, -7.5% a trade;
  // survivorship makes puts look worse than they were). The market tape, the
  // bubble tracker and the news read have no stored history, so the live
  // record is the test (`test: "forward"`). Owner Settings ENGINES_DOWNSIDE.
  downside: freeze({
    id: "downside", tag: "DWN", name: "Downside puts",
    idea: "Buys puts only, and only while the market tape Top Picks uses reads risk-off or severe risk-off. It looks for stocks that just lost their 200-day after a run above it, with a falling 50-day and weaker than the S&P over three months, and scores them up for the bubble tracker (AI buildout and whole-market stage), rate hikes priced in, and a news spike with a souring tone. It stands aside before a report and when options are very rich, and halves its size in extreme fear. A live test at half the risk budget, held under the put contract cap (10 by default).",
    reads: ["Market tape (risk-off or severe, the Top Picks read)", "Close against the 200-day and 50-day, 3-month return against SPY", "Bubble tracker stages and the stock's AI buildout role", "2-year yield against fed funds (hikes priced)", "News volume and tone (GDELT), Federal Register notices", "Fear and greed, IV richness, report dates"],
    universe: "stocks", slots: 4, perRun: 1, liveTest: true, onlySide: "put",
    // Half the Owner's risk budget a trade (ENGINES_RISK_USD); a candidate
    // in extreme fear (fear and greed under 25) halves it again.
    budgetX: 0.5,
    contract: freeze({ dteMin: 30, dteIdeal: 45, dteMax: 70, delta: 0.5 }),
    exits: freeze({ tp: 50, stop: -40, maxSessions: 20 }),
    bar: freeze({ base: 60, min: 56, max: 76, step: 2 }),
    firstRules: DOWNSIDE_RULES1,
    rules: ownRules("downside", DOWNSIDE_RULES1),
    ownRules: true,
    forwardWhy: "This engine fires only on the live market tape (risk-off or severe), and reads the bubble tracker and the news, none of which has a stored history, so it is judged forward only: its paper record and its shadow trades are the test. The part history can see (stocks losing their 200-day, 2007-2026) lost money on 45-day puts under every gate tested.",
    setups: freeze({
      "lost-200": setup("Lost the 200-day in a risk-off market", "The market tape reads risk-off or severe risk-off; the stock closed under its 200-day within the last 10 sessions after at least 15 of the 20 sessions before closed above it; its 50-day is falling and it trails SPY over three months. Not within 6 sessions of a report, not when options are very rich. Puts of about 0.5 delta, 30 to 70 days out (ideal 45): +50% target, -40% stop, 20 sessions, or a close back 0.5 ATR over the 200-day."),
    }),
    test: "forward",
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
    rules: coreRules("trend"),
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
    // The VIX and rates pack (2026-11-21): the non-tech sector switch
    // (ENGINES_MOM_SECTORS) and the volatility target (ENGINES_VOL_TARGET).
    sectorSwitch: true, sectorFunds: HEDGE.sectorFunds, sectorTop: HEDGE.sectorTop, volTarget: HEDGE.volTarget.momentum,
    contract: freeze({ shares: true }),
    exits: freeze({}),
    bar: freeze({ base: 0, min: 0, max: 0, step: 0 }),
    rules: coreRules("momentum"),
    setups: freeze({
      "top-10": setup("Ten strongest stocks", "One of the ten covered stocks with the biggest rise from 12 months ago to 1 month ago. Held while it stays in the ten at each monthly check.", { calls: "shares" }),
      "safe": setup("Treasuries while the market is weak", "The S&P 500 closed the month under its 10-month average: the whole basket's money goes to TLT if it beat T-bills over 12 months, else stays in T-bills.", { calls: "shares" }),
      "sectors": setup("Non-tech sector funds while tech is weak", "Since 2026-11-21: QQQ closed the month under its 10-month average while SPY did not. The basket holds the three strongest of nine non-tech sector funds (XLP, XLV, XLU, XLE, XLF, XLI, XLB, XLY, XLRE) by their average 3, 6 and 12-month rise, each above its 10-month average and ahead of T-bills, $10,000 each; an empty place stays in T-bills.", { calls: "shares" }),
    }),
    test: "history",
  }),
  // Multi-asset rotation (2026-11-20, owner: "build whichever engine you
  // deem worth testing in a live market environment"). A live paper test:
  // in the 2026-11-20 review a multi-asset trend book did worse than the
  // Trend follower over 2007-2026, but it is the one engine that can own
  // gold, silver, oil, small caps and Asia when stocks are not leading, so
  // it is run live to see. Three $10,000 holdings, re-picked monthly.
  rotation: freeze({
    id: "rotation", tag: "ROT", name: "Multi-asset rotation",
    idea: "Each month it ranks ten funds (US large, tech and small caps, chips, Treasuries, gold, silver, oil, Korea and China internet) by their average rise over the last 3, 6 and 12 months and holds the three strongest that are also above their 10-month average and beat T-bills over 12 months. An empty place stays in T-bills (cash). Shares only, long only, a live paper test.",
    reads: ["Month-end closes of SPY, QQQ, IWM, SMH, TLT, GLD, SLV, USO, EWY and KWEB (13 months)", "Fed funds rate (the T-bill return)"],
    universe: "etfs", slots: 3, perRun: 3, core: true, standing: true, lotUsd: 10000, top: 3, liveTest: true,
    funds: freeze(["SPY", "QQQ", "IWM", "SMH", "TLT", "GLD", "SLV", "USO", "EWY", "KWEB"]),
    contract: freeze({ shares: true }),
    exits: freeze({}),
    bar: freeze({ base: 0, min: 0, max: 0, step: 0 }),
    rules: coreRules("rotation"),
    setups: freeze({
      "top-3": setup("Three strongest funds", "One of the three funds with the biggest average rise over 3, 6 and 12 months, above its 10-month average and ahead of T-bills over 12 months. Held while it stays in the three at each monthly check.", { calls: "shares" }),
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
  fillBasis: [],
  riskSize: [],
  conviction: [],
  tecShares: [
    ["technicals", "squeeze", setup("Squeeze break", "Bollinger width in the lowest 15% of six months, then a close outside the band with volume.")],
    ["technicals", "rally-fade", setup("Downtrend rally fade", "A downtrend (price, 50-day and 200-day in order, 50-day still falling), a 2-day RSI spike near the 20-day, then a close back down. Puts.", { probation: true })],
  ],
  crashStand: [["reversion", "oversold-bounce", null, { crashStand: false }]],
  // Switched off: the test opens nothing (open test trades run to their exits).
  fearBounce: [["reversion", "fear-bounce", null, { retired: true, switchedOff: true }]],
  convNoScore: [["reversion", null, { convScore: true }], ["macro", null, { convScore: true }]],
  runInShares: [["earnings", "run-in", null, { ivShares: false }]],
  funPuts: [["fundamentals", null, { slots: 5, sideSlots: freeze({ call: 3, put: 2 }), idea: "Keeps one standing rank of every covered stock on earnings power, quality and price. Holds calls on the three best names it can buy and puts on the two worst, in longer-dated options, and swaps one only when it leaves the top or bottom third. A stock is ranked again when the month changes and after each of its reports. No chart pattern and no flow can open a trade here." }]],
  // Switched off: the engine reads no news and sizes no long by the tape.
  newsGate: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { newsGate: false }]),
  tapeSize: SIGNAL_SIX.map((id) => [id, null, { tapeSize: false }]),
  // Switched off: no setup is braked (the brake table is still kept).
  loserBrake: SIGNAL_SIX.map((id) => [id, null, { loserBrake: false }]),
  tecNoScore: [["technicals", null, { convScore: true }]],
  // The VIX and rates pack (2026-11-21).
  vixPause: PAUSE_ENGINES.map((id) => [id, null, { vixPause: false }]),
  hikePause: PAUSE_ENGINES.map((id) => [id, null, { hikePause: false }]),
  momSectors: [["momentum", null, { sectorSwitch: false }]],
  volTarget: [["momentum", null, { volTarget: null }]],
  // The logic audit fixes (2026-11-21).
  dearFull: [["downside", null, { dearFull: false }]],
  allocAdvise: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { allocAdvise: false }]),
  heldSameSide: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { heldSameSide: false }]),
  slotRetry: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { slotRetry: false }]),
  runInEarly: [["earnings", null, { runInEarly: false }]],
  // The bounce skip rules (2026-11-22).
  bounceSkip: [["reversion", null, { bounceSkip: false }]],
  // The trade audit fixes (2026-11-24).
  contractFit: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { contractFit: false }]),
  liquidAnd: [...SIGNAL_SIX, "downside"].map((id) => [id, null, { liquidAnd: false }]),
  shareRisk: SIGNAL_SIX.map((id) => [id, null, { shareRisk: false }]),
});
// Owner Settings instrument choice per signal engine (2026-11-19):
// "default" (the registry), "options", "shares" (the up side buys shares;
// a put stays an option) or "both" (an option plus a shares twin).
export const INSTRUMENT_CHOICES = freeze(["default", "options", "shares", "both"]);
const instEnv = (id) => `ENGINES_INSTRUMENT_${id.toUpperCase()}`;
export const instrumentEnvKey = instEnv;
export function engineSpecs(fixes = ALL_FIXES, trials = ALL_TRIALS, inst = null, maxQty = BOOK.riskMaxQty, putMaxQty = BOOK.putMaxQty, caps = null) {
  const off = ENGINE_FIX_IDS.filter((id) => fixes?.[id] === false);
  const trialsOff = ENGINE_TRIALS.filter((t) => trials?.[t.id] === false);
  const instOf = (id) => (inst && INSTRUMENT_CHOICES.includes(inst[id]) && inst[id] !== "default" ? inst[id] : null);
  const cap = normalizeMaxQty(maxQty), putCap = normalizePutMaxQty(putMaxQty);
  const premCap = normalizePremiumUsd(caps?.maxPremiumUsd), shareCap = normalizeSharesMaxUsd(caps?.sharesMaxUsd), putPrem = normalizePutPremiumUsd(caps?.putMaxPremiumUsd);
  if (!off.length && !trialsOff.length && !ENGINE_IDS.some(instOf) && cap === BOOK.riskMaxQty && putCap === BOOK.putMaxQty && premCap === BOOK.maxPremiumUsd && shareCap === BOOK.sharesMaxUsd && putPrem === BOOK.putMaxPremiumUsd) return ENGINES;
  const on = Object.fromEntries(ENGINE_FIX_IDS.map((id) => [id, !off.includes(id)]));
  const trialsOn = Object.fromEntries(ENGINE_TRIAL_IDS.map((id) => [id, !trialsOff.some((t) => t.id === id)]));
  const out = {};
  for (const id of ENGINE_IDS) {
    const e = ENGINES[id];
    // A core engine takes only the VIX and rates pack's switches (2026-11-21).
    if (e.core) {
      if (!off.some((f) => (FIX_ENGINES[f] || []).includes(id))) { out[id] = e; continue; }
      let cs = { ...e, rules: coreRules(id, on) };
      for (const f of off) for (const [eid, key, patch] of UNDO[f]) if (eid === id && !key) cs = { ...cs, ...patch };
      out[id] = freeze(cs); continue;
    }
    // An engine born after the fixes (Downside puts, 2026-11-20) keeps its
    // own rules (with the logic audit fixes on top, 2026-11-21); the
    // switches that reach it still patch it below.
    let spec = { ...e, rules: e.ownRules ? (off.some((f) => (FIX_ENGINES[f] || []).includes(id)) ? ownRules(id, e.firstRules || e.rules, on) : e.rules) : fixRules(id, on, instOf(id), trialsOn, cap, putCap, { maxPremiumUsd: premCap, sharesMaxUsd: shareCap, putMaxPremiumUsd: putPrem }) }, setups = { ...e.setups };
    // A trial switched off is retired for new trades (open ones keep their exits).
    for (const t of trialsOff) if (t.engine === id && setups[t.setup]) setups[t.setup] = freeze({ ...setups[t.setup], retired: true });
    for (const f of off) for (const [eid, key, patch, merge] of UNDO[f]) {
      if (eid !== id) continue;
      if (key && merge) setups[key] = freeze({ ...setups[key], ...merge });
      else if (key) setups[key] = patch; else spec = { ...spec, ...patch };
    }
    if (instOf(id)) spec.instrument = instOf(id);
    out[id] = freeze({ ...spec, setups: freeze(setups) });
  }
  return freeze(out);
}

// What a candidate buys: "shares" for the call side of a setup marked
// `calls: "shares"` (unless ENGINES_SHARES=0), else "option". A put is always
// an option: the engines never short stock.
// A core engine always buys shares (ENGINES_SHARES only moves the signal
// engines' setups).
// Since 2026-11-19 it can also be "both" (an option trade plus a shares twin,
// scored apart): a setup's own `instrument` (the extreme-fear bounce test)
// wins, then the Owner Settings choice for the engine (`spec.instrument`:
// "options", "shares" or "both"), then the setup's `calls`. ENGINES_SHARES=0
// only moves the registry's own share setups back to options.
export function instrumentFor(spec, setupKey, side, { shares = true } = {}) {
  if (spec?.core) return "shares";
  if (side === "put") return "option";
  const s = spec?.setups?.[setupKey] || {};
  if (s.instrument === "both" || s.instrument === "shares" || s.instrument === "options") return s.instrument === "options" ? "option" : s.instrument;
  if (spec?.instrument === "options") return "option";
  if (spec?.instrument === "shares" || spec?.instrument === "both") return spec.instrument;
  return shares && s.calls === "shares" ? "shares" : "option";
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
// (2026-11-17), and ENGINES_FILL_BASIS, ENGINES_RISK_SIZE,
// ENGINES_SIZE_MULTIPLIER, ENGINES_TEC_SHARES_ONLY, ENGINES_CRASH_STANDASIDE,
// ENGINES_FEAR_BOUNCE: honest paper trades (2026-11-19). Each on unless set
// to "0" / "off" (Owner Settings; no repo variable). `fixes` is { id: bool };
// `optionUsd` is the $2,000 premium size (null = one contract), used only
// while risk sizing is off. ENGINES_RISK_USD is the risk budget (default
// BOOK.riskUsd). ENGINES_INSTRUMENT_EARNINGS, _MACRO, _TECHNICALS,
// _FUNDAMENTALS, _FLOW, _REVERSION: "default" | "options" | "shares" |
// "both" (`inst`). ENGINES_MAX_QTY: the most contracts a risk-sized option
// trade buys, 1 to 200 (default 200 since 2026-11-23; 25 from 2026-11-20).
// ENGINES_MAX_PREMIUM_USD: the most premium one risk-sized option trade
// buys, $1,000 to $1,000,000 (default $200,000, since 2026-11-23).
// ENGINES_SHARES_MAX_USD: the most stock one risk-sized share trade buys,
// $1,000 to $1,000,000 (default $250,000 since 2026-11-23; $25,000 before).
// ENGINES_PUT_MAX_QTY: the most contracts a risk-sized put buys, 1 to 200
// (default 100 since 2026-11-23, 10 from 2026-11-20; under ENGINES_MAX_QTY
// too). ENGINES_PUT_MAX_PREMIUM_USD: the most premium a risk-sized put buys,
// $1,000 to $1,000,000 (default $100,000, since 2026-11-23; under
// ENGINES_MAX_PREMIUM_USD too).
// ENGINES_FUN_PUTS5, ENGINES_NEWS_GATE, ENGINES_TAPE_SIZE: the downtrend pack
// (2026-11-20), each on unless "0" / "off". ENGINES_LOSER_BRAKE,
// ENGINES_TEC_NO_SCORE: the scorecard pack (2026-11-21), the same.
// ENGINES_VARIANTS: the variant shadows, on unless "0" / "off".
// ENGINES_VIX_PAUSE, ENGINES_HIKE_PAUSE, ENGINES_MOM_SECTORS, ENGINES_VOL_TARGET
// and the paper trial ENGINES_TRIAL_VIX_ROLLOVER: the VIX and rates pack
// (2026-11-21), the same way, except ENGINES_HIKE_PAUSE: off by default since
// 2026-11-22 (owner), on only with "1" / "on".
// { mode: "risk", budget, conviction, maxQty, putMaxQty, maxPremiumUsd, putMaxPremiumUsd, sharesMaxUsd } or
// { mode: "premium" | "one", optionUsd }.
export function engineSwitches(env = process.env) {
  const raw = String(env.ENGINES ?? "").trim().toLowerCase();
  const mode = /^(0|off|false|no)$/.test(raw) ? "off" : raw === "pause" ? "pause" : "on";
  const isOff = (v) => /^(0|off|false|no)$/.test(String(v ?? "").trim().toLowerCase());
  const isOn = (v) => /^(1|on|true|yes)$/.test(String(v ?? "").trim().toLowerCase());
  // Each key is read by name (the Owner Settings smoke checks every key is
  // really read); ENGINE_FIXES carries the same names for the page.
  const fixes = {
    retirePuts: !isOff(env.ENGINES_FIX_RETIRE_PUTS),
    bounce: !isOff(env.ENGINES_FIX_BOUNCE),
    size: !isOff(env.ENGINES_FIX_SIZE),
    stockStop: !isOff(env.ENGINES_FIX_TEC_SHARES),
    fillBasis: !isOff(env.ENGINES_FILL_BASIS),
    riskSize: !isOff(env.ENGINES_RISK_SIZE),
    conviction: !isOff(env.ENGINES_SIZE_MULTIPLIER),
    tecShares: !isOff(env.ENGINES_TEC_SHARES_ONLY),
    crashStand: !isOff(env.ENGINES_CRASH_STANDASIDE),
    fearBounce: !isOff(env.ENGINES_FEAR_BOUNCE),
    convNoScore: !isOff(env.ENGINES_CONV_NO_SCORE),
    runInShares: !isOff(env.ENGINES_RUNIN_BY_IV),
    funPuts: !isOff(env.ENGINES_FUN_PUTS5),
    newsGate: !isOff(env.ENGINES_NEWS_GATE),
    tapeSize: !isOff(env.ENGINES_TAPE_SIZE),
    loserBrake: !isOff(env.ENGINES_LOSER_BRAKE),
    tecNoScore: !isOff(env.ENGINES_TEC_NO_SCORE),
    vixPause: !isOff(env.ENGINES_VIX_PAUSE),
    hikePause: isOn(env.ENGINES_HIKE_PAUSE),
    momSectors: !isOff(env.ENGINES_MOM_SECTORS),
    volTarget: !isOff(env.ENGINES_VOL_TARGET),
    dearFull: !isOff(env.ENGINES_FIX_DEAR_FULL),
    allocAdvise: !isOff(env.ENGINES_FIX_ALLOC_ADVISE),
    heldSameSide: !isOff(env.ENGINES_FIX_HELD_SAME_SIDE),
    slotRetry: !isOff(env.ENGINES_FIX_SLOT_RETRY),
    runInEarly: !isOff(env.ENGINES_FIX_RUNIN_EARLY),
    bounceSkip: !isOff(env.ENGINES_BOUNCE_SKIP),
    contractFit: !isOff(env.ENGINES_FIX_CONTRACT_FIT),
    liquidAnd: !isOff(env.ENGINES_FIX_LIQUIDITY),
    shareRisk: !isOff(env.ENGINES_FIX_SHARE_RISK),
  };
  const optionUsd = fixes.size ? BOOK.optionUsd : null;
  // Risk sizing (2026-11-19): the budget is an Owner Settings number; an
  // unreadable or out-of-range value falls back to the default.
  const rawRisk = Number(String(env.ENGINES_RISK_USD ?? "").trim());
  const riskUsd = String(env.ENGINES_RISK_USD ?? "").trim() !== "" && Number.isFinite(rawRisk) && rawRisk >= 500 && rawRisk <= 10000 ? rawRisk : BOOK.riskUsd;
  // The contract cap (2026-11-20): Owner Settings number, 1 to 200 (default
  // 200 since 2026-11-23; 25 before).
  const maxQty = normalizeMaxQty(String(env.ENGINES_MAX_QTY ?? "").trim() === "" ? null : Number(String(env.ENGINES_MAX_QTY).trim()));
  // The put cap (2026-11-20): Owner Settings number, 1 to 200 (default 100
  // since 2026-11-23; 10 before).
  const putMaxQty = normalizePutMaxQty(String(env.ENGINES_PUT_MAX_QTY ?? "").trim() === "" ? null : Number(String(env.ENGINES_PUT_MAX_QTY).trim()));
  // The premium cap and the share cap (2026-11-23): Owner Settings numbers.
  const maxPremiumUsd = normalizePremiumUsd(String(env.ENGINES_MAX_PREMIUM_USD ?? "").trim() === "" ? null : Number(String(env.ENGINES_MAX_PREMIUM_USD).trim()));
  const sharesMaxUsd = normalizeSharesMaxUsd(String(env.ENGINES_SHARES_MAX_USD ?? "").trim() === "" ? null : Number(String(env.ENGINES_SHARES_MAX_USD).trim()));
  const putMaxPremiumUsd = normalizePutPremiumUsd(String(env.ENGINES_PUT_MAX_PREMIUM_USD ?? "").trim() === "" ? null : Number(String(env.ENGINES_PUT_MAX_PREMIUM_USD).trim()));
  const sizing = fixes.riskSize ? { mode: "risk", budget: riskUsd, conviction: !!fixes.conviction, maxQty, putMaxQty, maxPremiumUsd, putMaxPremiumUsd, sharesMaxUsd } : { mode: optionUsd ? "premium" : "one", optionUsd };
  const instRaw = {
    earnings: env.ENGINES_INSTRUMENT_EARNINGS, macro: env.ENGINES_INSTRUMENT_MACRO, technicals: env.ENGINES_INSTRUMENT_TECHNICALS,
    fundamentals: env.ENGINES_INSTRUMENT_FUNDAMENTALS, flow: env.ENGINES_INSTRUMENT_FLOW, reversion: env.ENGINES_INSTRUMENT_REVERSION,
  };
  const inst = {};
  for (const id of ENGINE_IDS) {
    if (ENGINES[id].core) continue;
    const v = String(instRaw[id] ?? env[instEnv(id)] ?? "").trim().toLowerCase();
    inst[id] = INSTRUMENT_CHOICES.includes(v) ? v : "default";
  }
  const shares = !/^(0|off|false|no)$/.test(String(env.ENGINES_SHARES ?? "").trim().toLowerCase());
  // A paper trial buys shares only, so it is off while share trades are off.
  const trials = {
    rsi2Dip: shares && !isOff(env.ENGINES_TRIAL_RSI2_DIP), fearIndex: shares && !isOff(env.ENGINES_TRIAL_FEAR_INDEX),
    bigOrder: shares && !isOff(env.ENGINES_TRIAL_BIG_ORDER), optionSurge: shares && !isOff(env.ENGINES_TRIAL_OPTION_SURGE),
    vixRollover: shares && !isOff(env.ENGINES_TRIAL_VIX_ROLLOVER),
  };
  const a = String(env.ENGINES_ALLOCATOR ?? "").trim().toLowerCase();
  const allocator = /^(0|off|false|no)$/.test(a) ? "off" : /^(on|1|true|yes)$/.test(a) ? "on" : "advise";
  const off = new Set();
  for (const part of String(env.ENGINES_OFF ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const id = ENGINE_IDS.find((k) => k === part.toLowerCase() || ENGINES[k].tag === part.toUpperCase());
    if (id) off.add(id);
  }
  // The multi-asset rotation (2026-11-20, a live paper test) has its own
  // Owner Settings switch: off opens no new holdings.
  if (isOff(env.ENGINES_ROTATION)) off.add("rotation");
  // Downside puts (2026-11-20, a live paper test) the same way.
  if (isOff(env.ENGINES_DOWNSIDE)) off.add("downside");
  // Variant shadows (2026-11-21, lib/engines/variants.mjs): paper copies of
  // an engine with one variable changed. Off runs none (their books are kept).
  const variants = !isOff(env.ENGINES_VARIANTS);
  // Live VIX (2026-11-22, owner): on a decision run the VIX and VIX3M reads use
  // the bake's own quote for today instead of the prior close. Off = prior
  // close, the history test's rule. An input read, not a rule step.
  const liveVix = !isOff(env.ENGINES_LIVE_VIX);
  return { mode, off, shares, allocator, fixes, trials, optionUsd, sizing, inst, maxQty, putMaxQty, caps: { maxPremiumUsd, sharesMaxUsd, putMaxPremiumUsd }, variants, liveVix };
}
