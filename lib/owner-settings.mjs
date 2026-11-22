// Owner settings (2026-11-10, owner request): the Owner Settings page lets an
// Owner change a short, fixed list of switches and numbers on the site instead
// of in the repo. Everything here is an override on top of the code default:
//
//   build  read by the bake. scripts/owner-settings-env.mjs (loaded with
//          `node --import` before scripts/build.mjs) copies the saved values
//          into process.env, so lib/top-picks-config.mjs and the other
//          switches read them exactly as if a repo variable were set. A value
//          already in the environment (a repo variable Sean set) wins and the
//          setting shows as pinned. Changes apply from the next build; Top
//          Picks changes from the next 11:00 or 15:30 ET run.
//   site   read at request time by api/auth/[action].js. These can only turn
//          a feature OFF. "On" means "follow the Vercel setting", so anything
//          switched off in Vercel stays off.
//
// The list is closed on purpose. Models, AI budgets, exits, grading weights,
// conviction bars, schedules, the stock list, secrets and Robinhood approvals
// stay in the repo; there is no track record reset here.
//
// Stored in owner-settings.json: Owner-only, request-time-owned (written only
// by api/auth/[action].js "owner-settings", never by a workflow). Shape:
//   { version, values: { KEY: value }, updatedAt, by, seq,
//     history: [{ id, at, by, kind, changes: [{ key, from, to }], undone? }] }
// A value missing from `values` is the default. from/to null = the default.

export const OWNER_SETTINGS_KEY = "owner-settings.json";
export const OWNER_SETTINGS_APPLIED_KEY = "owner-settings-applied.json";
export const OWNER_SETTINGS_HISTORY = 50;
export const OWNER_SETTINGS_VERSION = 1;

// kind: switch (true/false), number, choice. env(v) is the environment string
// for a non-default value. picks: changes which Top Picks trades open, so new
// trades are stamped and the Track Record draws a dated divider.
// tab + group: where the page shows it (a tab, then a section inside it).
// Every key here must be read from process.env at bake or request time.
const tape = (key, label, help) => ({ key, scope: "build", tab: "Market tape", group: "Inputs the tape reads", kind: "switch", default: true, picks: true, label, help });
export const OWNER_SETTINGS_TABS = Object.freeze(["Top Picks", "Market tape", "AI & cost", "Data & desks", "Research", "Engine hooks", "Account limits", "Live site"]);
export const OWNER_SETTINGS = Object.freeze([
  // --- Top Picks: engine ----------------------------------------------------
  { key: "PICKS_EVENT_AWARE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Changes which trades open around Fed days, CPI and jobs reports, and earnings. Off makes the engine wait out every event and stops post-shock puts, so far fewer trades open in event weeks.",
    label: "Event plays", help: "Trades through macro events and earnings when the evidence agrees, and post-shock puts. Off = the engine waits out events." },
  { key: "PICKS_MARKET_SIDE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off goes back to one bar of 7 for both sides, skips the AI grader when nothing clears that bar, and lets the macro block stop trades on the market's side too, so far fewer trades open.",
    label: "Market-side lanes", help: "On the side the market favors (puts in risk-off, calls in risk-on) a pick opens from a score of 5; against it, from 8. The AI grader runs every run, and the macro block applies only against the market. Off = the earlier rules." },
  { key: "PICKS_MACRO_CONTEXT", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the guard that keeps calls and puts from fighting the rates, credit and rotation backdrop, so trades can open against the market's direction.",
    label: "Macro context block", help: "Keeps calls and puts off when they fight the rates, credit and rotation backdrop." },
  { key: "FLOW_SIGNED", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off brings back the older Unusual flow vote, which counts every flagged call as bullish and every put as bearish even when the trade was a sale. It changes grades and the Flow engine's trades.",
    label: "Signed option flow", help: "The Unusual flow vote and the Flow engine read whether each flagged trade was bought or sold, in delta dollars, confirmed by the next morning's open interest. Off = the older call vs put count." },
  { key: "FLOW_OPEN_WINDOW", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off stops the unusual-flow scan from counting the first half hour after the open, so flags from 9:30 to 10:00 ET disappear again. It changes the Unusual flow vote in grades and the Flow engine's inputs.",
    label: "Flow scan: count the opening half hour", help: "The first scan after the 9:30 open counts each contract's volume since the open (the 9:00 scan is before the open, so there was nothing to compare with). Off = the first in-session scan flags nothing." },
  { key: "FLOW_STOCK_BARS", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off goes back to one 4,000 / 2,000 contract bar for every stock, so mostly NVDA, SPY and MU flag. It changes the Unusual flow vote in grades and the Flow engine's inputs.",
    label: "Flow scan: a bar per stock", help: "Each stock's hourly volume bar is 1% (0.5% past 14 days) of its normal full-day option volume, between 500 and 4,000 contracts, so smaller names can flag. Off = the same 4,000 / 2,000 bar for every stock." },
  { key: "VOLUME_MEASURED_CURVE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off brings back the fixed hour-by-hour volume curve, which expects too little volume in the first hour and too much in the afternoon. Morning volume then reads heavy, which changes the Unusual volume vote, the Volume page and the heatmap.",
    label: "Measured intraday volume curve", help: "What counts as normal volume by each time of day is measured from these stocks' own last 20 sessions. Off = the fixed 25/14/11/11/14/25% hour curve." },
  { key: "VOLUME_SESSION_READ", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off brings back the busiest-single-window read, which gives about half of all names an Unusual volume vote on an ordinary day. It changes grades and the strategy engines' relative volume.",
    label: "Session-so-far volume vote", help: "The Unusual volume vote reads all of today's volume against a normal day by this time, with the move since yesterday's close. Off = the busiest single hour of the day." },
  { key: "PICKS_MACRO_BLOCK_PTS", scope: "build", tab: "Top Picks", group: "Engine", kind: "number", default: 0.5, min: 0.25, max: 1.5, step: 0.25, picks: true,
    label: "Macro block strength", help: "How strongly the macro read must lean against a trade to block it. Lower blocks more trades." },
  { key: "PICKS_SINGLES_DEFAULT", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Changes the structure of every new trade. Off brings back the spread-heavy mix that lost to single options in the 2026 backtest.",
    label: "Single options by default", help: "Single calls and puts unless earnings fall inside the hold or a contract costs more than the cap. Off = the older spread-heavy mix." },
  { key: "PICKS_STRATEGY_AUTO", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off makes every new trade a plain single call or put, including into earnings and when options are very expensive. No debit or credit spreads open at all.",
    label: "Pick the option structure", help: "Chooses single, debit spread or credit spread from the IV level and events. Off = always a single call or put." },
  { key: "PICKS_EDGE_GATE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the brake that raises the bar while the recent record is losing money. In a losing streak the engine keeps opening normal trades.",
    label: "Raise the bar after losses", help: "When the recent record is losing money, only the highest-conviction names may open. Relaxes as the record recovers." },
  // --- Top Picks: book and sizes --------------------------------------------
  { key: "PICKS_COUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 6, min: 1, max: 6, step: 1, picks: true,
    label: "Most picks per run", help: "How many actionable picks a run can ship. Capped at 6 so the AI grader never reads more names than today." },
  { key: "PICKS_MAX_OPEN_POSITIONS", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 20, min: 5, max: 30, step: 1, picks: true,
    impact: "high", warn: "Sets how many trades can be open at the same time. Higher means more money at risk at once; lower means new picks wait until trades close.",
    label: "Most open trades", help: "The book's limit. Once this many trades are open, new picks wait for a slot. Open trades are never closed by this." },
  { key: "PICKS_MAX_NEW_PER_FACTOR_RUN", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 2, min: 1, max: 4, step: 1, picks: true,
    impact: "high", warn: "Higher lets one run open more trades in the same kind of stock (for example four tech names at once), so one bad day for that group hits the book harder. Lower can leave good picks waiting.",
    label: "New trades per stock group per run", help: "At most this many new trades from one group (such as tech/AI) in a single run." },
  { key: "PICKS_WATCH_COUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 6, min: 0, max: 10, step: 1,
    label: "Most watch ideas", help: "How many watch ideas show under the picks. Display only; no AI." },
  { key: "PICKS_SINGLE_MAX_COST", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 5000, min: 1000, max: 10000, step: 500, unit: "$", picks: true,
    impact: "high", warn: "Changes which picks are single options and which become spreads. Higher lets one contract cost up to this much, so a single losing trade can lose more money; lower turns more picks into debit spreads.",
    label: "Single option cost cap", help: "One contract of a single costing more than this becomes a debit spread." },
  { key: "PICKS_DISPLAY_ACCOUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 25000, min: 1000, max: 1000000, step: 1000, unit: "$",
    label: "Display account size", help: "The account size used for the suggested position sizes on cards. Display only." },
  // --- Top Picks: events ----------------------------------------------------
  { key: "PICKS_FOMC_ALWAYS_DEFER", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off lets single options open right before Fed decisions and CPI, PPI and jobs reports whenever prediction markets look sure. That is where IV crush and surprises do the most damage.",
    label: "Wait out Fed, CPI, PPI and jobs days", help: "Treats those releases as event risk inside the window however sure the odds look. Off = only coin-flip events count." },
  { key: "PICKS_EVENT_RISK", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off turns off the whole event check: entries are no longer delayed or limited before big scheduled releases.",
    label: "Event risk check", help: "Looks for big scheduled releases inside the entry window and lowers or defers entries before them." },
  { key: "PICKS_STRATEGY_EARNINGS_DAYS", scope: "build", tab: "Top Picks", group: "Events", kind: "number", default: 14, min: 0, max: 30, step: 1, unit: "days", picks: true,
    label: "Earnings window for spreads", help: "Earnings this many days out or fewer counts as inside the hold, so the pick becomes a debit spread." },
  { key: "PICKS_CREDIT_INTO_MACRO_EVENT", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: false, picks: true,
    impact: "high", warn: "On lets credit spreads (which sell options) open with a Fed day or CPI inside the hold. A big move after the release can hit the spread's full loss.",
    label: "Credit spreads into macro events", help: "Lets a credit spread open when a macro release is inside the hold. Off keeps credit spreads out of event windows." },
  // --- Market tape ------------------------------------------------------------
  { key: "PICKS_MACRO_REGIME", scope: "build", tab: "Market tape", group: "Overall", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off makes every pick ignore the market tape: no bearish tilt, no size cut and no change to the put bar, even in a risk-off or severe market.",
    label: "Market tape on the picks", help: "The risk-on / risk-off read that tilts the book, cuts size and changes the put bar. Off = picks ignore the tape." },
  tape("PICKS_MACRO_INDEX", "Indexes (SPY and QQQ)", "The overall market's 1-day and 5-day moves."),
  tape("PICKS_MACRO_CREDIT", "Credit spreads", "High-yield spreads and the HYG/LQD ratio."),
  tape("PICKS_MACRO_BREADTH", "Breadth", "Share of covered stocks above their 50 and 200-day averages, and new highs minus new lows."),
  tape("PICKS_MACRO_PUTCALL", "Put/call", "The put/call read from covered stocks' options (or Cboe, see Engine hooks)."),
  tape("PICKS_MACRO_BONDVOL", "Bond volatility (MOVE)", "How much the bond market expects rates to swing."),
  tape("PICKS_MACRO_SENTIMENT", "Fear & Greed", "CNN's Fear & Greed index and its trend."),
  tape("PICKS_MACRO_INFLATION", "Inflation and jobs", "CPI and the unemployment trend."),
  tape("PICKS_MACRO_COMMODITY", "Oil and gold shocks", "Big moves in crude and gold."),
  tape("PICKS_MACRO_NEWS", "War, tariff and Iran headlines", "Geopolitical headlines from the last day."),
  tape("PICKS_MACRO_GLOBAL", "Overnight markets", "Asian and European sessions before the US open."),
  tape("PICKS_MACRO_ROTATION", "Sector rotation", "Defensive versus growth leadership over the past month."),
  // --- AI & cost (each can only lower AI spend; the explicit cache switch is
  // off by default and lowers spend when on) ----------------------------------
  { key: "AI_THESIS", scope: "build", tab: "AI & cost", group: "AI final grader", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the AI's final grade and buy-now/wait call on every pick. The AI can no longer veto a weak thesis, and trades open on the rules alone, which have not been tested without it.",
    label: "AI final grader", help: "The AI grade and buy-now/wait call on the top names. Off saves its AI cost; grades and exits are unchanged and trades are stamped grader off." },
  { key: "AI_THESIS_SEARCH", scope: "build", tab: "AI & cost", group: "AI final grader", kind: "switch", default: true, picks: true,
    label: "Web search before grading", help: "A short Google-grounded search for fresh facts before the grader decides. Off saves that call; the grader judges the site's own data." },
  { key: "CORP_STRUCTURE_AI", scope: "build", tab: "AI & cost", group: "Stock data", kind: "switch", default: true,
    label: "Leadership document reads", help: "One Flash-Lite read of a company's proxy or annual report when a new one is filed (about once a year per company). Off keeps the last read; insider filings still update." },
  { key: "AI_TICKER_EXPLICIT_CACHE", scope: "build", tab: "AI & cost", group: "Stock news read", kind: "switch", default: false, picks: true,
    impact: "high", warn: "On moves the stock news read's instructions from the top of each stock's message into Gemini's system instruction slot. The words are the same, but the AI's news and fundamentals read can shift slightly, and that read feeds every grade and Top Picks.",
    label: "Explicit prompt cache", help: "Keeps the stock news read's shared instructions (about 2,900 of the 4,400 tokens in each call) in Gemini's cache during each build, billed at a tenth of the price: about $0.10 to $0.17 a trading day saved if Google accepts it. If Google refuses, that build runs as before. The build log's \"Ticker-judgment prompt cache\" line shows what it saved." },
  // --- Data & desks -----------------------------------------------------------
  { key: "VOLUME_CLOSE_REREAD", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Closing auction volume", help: "The scan just after 16:00 ET waits about six minutes and reads every stock's day volume again, so the closing auction counts. One extra free quote call. Off keeps the 16:00 reading." },
  { key: "PREDICTION_MARKETS", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true, picks: true,
    label: "Prediction-market odds", help: "Kalshi and Polymarket odds for macro releases and earnings. The event risk check uses them. Off skips the fetch." },
  { key: "CROWD", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    impact: "high", warn: "Off stops new crowd readings. The crowd test that judges the Engine hooks gets no new days while it is off.",
    label: "Crowd & positioning data", help: "The free crowd sources. Off carries the last files forward." },
  { key: "PREDICTION_TRACKER", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Prediction market tracker", help: "Tracks about 160 Kalshi and Polymarket contracts (Fed, economy, policy, politics, geopolitics, commodities, crypto, companies) for the Prediction odds page, and tests them against stock moves. Free public reads, no AI. Off keeps the last files." },
  { key: "AI_DISRUPTION", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "AI launch tracker", help: "Reads the six AI labs' official release notes and news once a trading day and adds each new launch to the AI disruption log, tagged by rules. Free, no AI. Off keeps the last log." },
  { key: "FEDERAL_REGISTER", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Federal Register rules and orders", help: "Reads the Federal Register once a trading day (rules, proposed rules, presidential documents, and notices that name a covered company or topic, plus tomorrow's filings) and tags each to the stocks it reaches by agency, topic words or company name. Free, no key, no AI; logged for later tests, nothing scores it. Off keeps the last read." },
  { key: "GDELT_NEWS", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "News volume and tone (GDELT)", help: "Counts each covered company's news articles over the last day against its usual, once a trading day, and reads the tone when the count spikes. About 80 free requests, one every 5.5 seconds, while the option chains load. No AI; logged for later tests, nothing scores it. Off keeps the last read." },
  { key: "CROWD_BORROW", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: false,
    label: "Borrow fees (IBKR)", help: "Interactive Brokers' daily borrow-fee file for the crowd page. Off by default: the build machines cannot reach it, and the Market map's option-implied borrow covers each name. On tries the read again." },
  { key: "CORP_STRUCTURE", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Leadership data (SEC)", help: "Board, officers, stakes and votes from SEC filings for each stock's Leadership tab. Free. Off keeps the last data." },
  { key: "QUANT_LABS_TEXT", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Annual report text (SEC)", help: "Reads each company's newest annual report from the SEC and compares its risk section with last year's, a few companies per build. Free, no AI. Off keeps the comparisons already made." },
  { key: "WIDE_TIER", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Wide tier (market-wide heat map)", help: "Watches the S&P 500 and Nasdaq-100 (about 530 names) with rules only: the Heatmap's Wide view, the sector table, the worth-a-look list and wide breadth on Market map. Free Yahoo reads, no AI, no trades. Off hides the Wide view from the next build (the hourly refresh then leaves it alone) and keeps the stored prices." },
  { key: "LEAPS_SCORE", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "switch", default: true,
    label: "LEAPS desk", help: "Scores names for a one- to two-year hold. No AI. Off keeps the last scores." },
  { key: "STOCK_PICKS_MAX", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "number", default: 8, min: 1, max: 24, step: 1,
    label: "Stock picks shown", help: "How many quality-dip names the Stock picks desk lists. No AI." },
  { key: "EARNINGS_FORECAST_ENABLED", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "switch", default: true,
    label: "Earnings Forecast refresh", help: "Refreshes the Earnings Forecast desk. Off keeps the last snapshot." },
  { key: "EARNINGS_FORECAST_WINNER", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "switch", default: true,
    label: "Earnings Forecast: use the history test winner", help: "When a forecast rule beats the current one in both halves of the stored history, by more than chance allows, the Earnings Forecast page uses it. Off keeps the current rule; the history test still runs. The Top Picks grader reads the current rule either way." },
  // --- Strategy engines (lib/engines/) ---------------------------------------
  { key: "ENGINES", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "on",
    options: [["on", "On"], ["pause", "Manage open trades only"], ["off", "Frozen"]],
    impact: "high", warn: "Frozen stops the engines marking and closing their open paper trades, so open positions stay open until it is back on. Use Manage open trades only to stop new trades and keep the exits working.",
    label: "Strategy engines", help: "The nine rules-only paper engines beside Top Picks: six signal engines and three core engines (Trend follower, Momentum basket, Multi-asset rotation) that hold stock month to month. Manage open trades only opens no new engine trades; Frozen carries their files forward untouched. Changes no Top Pick." },
  { key: "ENGINES_SHARES", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engines buy shares for slow setups", help: "The call side of the setups that moved the stock too little for an option to pay in the long history test (Technicals pullback and breakout, Reversion capitulation, Earnings drift, the Flow setups, Macro's gold and Asia-fund setups) buys $5,000 of stock instead, as a paper record line that is not placed in Webull. Off puts them back on calls; open share trades still run to their exits. Puts are always options. Changes no Top Pick." },
  { key: "ENGINES_ALLOCATOR", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "advise",
    options: [["advise", "Advise only"], ["on", "On (holds back)"], ["off", "Off"]],
    label: "Engine Allocator", help: "Reads each signal-engine setup's record in today's market type (its own results plus the 2007-2026 history test). Advise only (the default) records its read on every signal trade, holds nothing back, and counts what the trades it would have held back made. On holds back a setup expected to lose there, tracking it as a shadow trade instead (in the history test this lowered the dollar total in both runs). Both record the size it would give a trade (0.1x to 2x, a dollar line only; no lot is resized). Off does not run it. The Trend follower and Momentum basket are not allocated. Changes no Top Pick." },
  // The money-leak fixes (2026-11-17, docs/engines.md "Money-leak fixes"): on
  // by default; off puts that part back for new engine trades. Each is an
  // on/off return to one fixed earlier rule, not an exit or size number.
  { key: "ENGINES_FIX_RETIRE_PUTS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine fix: retire the two losing put setups", help: "Reversion's spike-in-a-downtrend puts (-10.3% a trade over 284 trades in the 2007-2026 history test) and Technicals' range-breakdown puts (-7.2% over 88) open nothing. Off brings them back for new trades. Changes no Top Pick." },
  { key: "ENGINES_FIX_BOUNCE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine fix: cheaper, shorter washout-bounce calls", help: "Reversion's washout bounce buys calls of about 0.3 delta, 14 to 35 days out, with a -60% stop (+7.7% a trade over 884 trades against +0.8% over 981 in the 2007-2026 history test, both halves ahead). Off goes back to the engine's 0.6-delta calls about 25 days out with a -35% stop. Changes no Top Pick." },
  { key: "ENGINES_FIX_SIZE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine fix: option trades buy about $2,000 of premium", help: "Each engine option trade records the number of contracts nearest $2,000 of premium (at least one), so a dear SPY contract no longer outweighs a cheap one in the dollar totals. Results in % are unchanged; the Webull paper account buys the same count (Webull quantities switch). Off goes back to one contract per trade. Changes no Top Pick." },
  { key: "ENGINES_FIX_TEC_SHARES", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine fix: 3 ATR stop on Technicals share trades", help: "Technicals' share trades stop 3 ATR under the entry instead of at the setup's own tighter stop or 2 ATR (+0.9% a trade over 1,158 trades against +0.5% over 1,454 in the 2007-2026 history test). Off goes back to the earlier stop for new trades. Changes no Top Pick." },
  // Honest paper trades (2026-11-19, docs/engines.md "Honest paper trades"):
  // on by default; off puts that part back for new engine trades.
  { key: "ENGINES_FILL_BASIS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine trades book the ask and the bid", help: "A new engine option trade records what it would have cost at the ask and what it would have fetched at the bid, so the record counts the spread a real account pays. Stops and targets still fire on the mid. When the chain has no two-sided quote for the held strike, the exit uses the mid less half the spread the contract had at entry, marked as an estimate. Off books the mid both ways, as before. Changes no Top Pick." },
  { key: "ENGINES_SPLIT_GUARD", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine trades follow stock splits", help: "When a held stock splits (Sandisk 8-for-1 on 2026-11-20), the engine trade's entry, stop, target and strike are divided by the split ratio and its share or contract count multiplied by it, the way the broker and the OCC adjust a real position, so the split never reads as a loss or trips a stop. A split is read from the price gap since the last mark, checked against Yahoo's split-adjusted history. Off marks the old prices against the new tape, as before. Changes no Top Pick (Top Picks has its own split guard)." },
  { key: "ENGINES_RISK_SIZE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Size engine trades by risk (1 contract up to the cap)", help: "Each new engine option trade buys 1 contract up to the contract cap below (25 unless set) so that it risks about the risk budget below: the whole premium for an option expiring within 30 days, the premium times the stop times 1.25 for a longer one. Share trades buy the budget divided by entry minus stop (at most $25,000 of stock). A contract dearer than twice the budget is not bought; a call signal buys shares instead. The Webull paper account buys the same count (Webull quantities switch). Off goes back to about $2,000 of premium a trade. Changes no Top Pick." },
  { key: "ENGINES_RISK_USD", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "number", default: 2000, min: 500, max: 10000, step: 250,
    label: "Engine risk budget per trade ($)", help: "What one engine trade may lose at its stop (or its whole premium for a short-dated option), before the conviction multiplier. Used only while sizing by risk is on. Applies to new trades. Changes no Top Pick." },
  // The contract cap (2026-11-20, owner: "both to 25 and we can raise or
  // lower in owner settings"; 10 before). Read by engineSwitches in
  // lib/engines/config.mjs. A cap other than 10 is a new dated rules version
  // on each signal engine, and changing it later is logged as a rule change.
  { key: "ENGINES_MAX_QTY", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "number", default: 25, min: 1, max: 25, step: 1, unit: "contracts",
    impact: "high", warn: "Changes how many contracts every new engine option trade can buy, in the record and in the Webull paper account. A higher cap lets a cheap contract or a high-conviction trade buy more, so a loss costs more dollars; the engine record splits at a new rules version.",
    label: "Most contracts an engine trade buys", help: "The cap on risk sizing: each new engine option trade buys 1 contract up to this many. Under the old cap of 10 the cap, not the budget or the conviction multiplier, set the size of about two option trades in three, so the multiplier could rarely move it. Every trade records the cap and whether the cap set its size. The Riskier dial stops here too. Used only while sizing by risk is on. Changes no Top Pick." },
  { key: "ENGINES_SIZE_MULTIPLIER", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine conviction multiplier (0.5x to 2x)", help: "Scales the risk size up or down from a stated read: how far the score clears the bar, the Allocator's read for the setup in today's market type, whether the stock's options are cheap or rich against its own history, the spread, and how many trades are already open in the name and its sector group. Every trade shows each part and the flat size beside it, and the engines page shows both records. Off keeps the flat risk size. Changes no Top Pick." },
  { key: "ENGINES_TEC_SHARES_ONLY", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Technicals trades shares only", help: "The squeeze's up side buys shares instead of calls, and the squeeze's down side and the downtrend rally fade (both puts) open nothing; they stay listed as retired. Off brings the squeeze calls and puts and the rally fade back for new trades. Changes no Top Pick." },
  { key: "ENGINES_CRASH_STANDASIDE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Reversion stands aside after a crash day", help: "Reversion's washout bounce opens nothing when the stock fell 7% or more in one day during the five sessions before the signal (flagged trades lost 12.6% a trade on real option prices, in both halves of 2007-2026). The skip is listed with its reason. Off takes those trades again. Changes no Top Pick." },
  { key: "ENGINES_FEAR_BOUNCE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Extreme-fear bounce test", help: "A labeled test on the Reversion engine: when the fear and greed index is under 25, a washout buys one call and a shares twin, each with its own Webull fills and its own record line, and stands aside after a 7% one-day drop. It never shares a contract with another trade, and it leaves a name the RSI(2) dip paper trial holds. On real option prices this lost 9.3% a trade in 2007-2026, so it is here to measure, not to trust. Off opens no new test trades. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_EARNINGS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Earnings & events: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_MACRO", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Macro: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_TECHNICALS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Technicals: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_FUNDAMENTALS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Fundamentals: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_FLOW", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Flow: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_INSTRUMENT_REVERSION", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "choice", default: "default",
    options: [["default", "Each setup's own"], ["options", "Options only"], ["shares", "Shares on the up side"], ["both", "Both: an option and a shares twin"]],
    label: "Reversion: what its trades buy", help: "Each setup's own (the default) keeps the setup's choice: options, or shares on the up side where the history test showed the stock moves too little for an option. Options only buys a call or put for every trade. Shares on the up side buys stock for every call signal. Both buys the option and a shares twin, each scored on its own line. Puts are always options: the engines never short stock. Applies to new trades; open trades keep what they bought. Changes no Top Pick." },
  { key: "ENGINES_TRIAL_RSI2_DIP", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine paper trial: RSI(2) dip in an uptrend (shares)", help: "Unproven, on paper to prove itself. Reversion buys $5,000 of a stock above its 200-day when its 2-day RSI is under 5 and sells on a close back above the 5-day average or after 10 sessions. In the 2007-2026 test it made +0.62% a trade over 4,181 trades in both halves, ahead of random days on the same stocks, but not by enough to clear the bar for the number of ideas tried. Off retires it for new trades. Needs engine share trades on. Changes no Top Pick." },
  { key: "ENGINES_TRIAL_FEAR_INDEX", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine paper trial: index funds after extreme fear (shares)", help: "Unproven, on paper to see how it does live. The day after CNN Fear & Greed first closes under 25, Macro buys $5,000 each of SPY, QQQ and IWM and holds them 20 sessions, with no stop or target. In the engines' 2007-2026 history test on our rebuild of Fear & Greed it made +1.0% a trade over 216 trades (63% wins) but lost in 2008, 2020 and 2022, so it is not proven. Off retires it for new trades. Needs engine share trades on. Changes no Top Pick." },
  { key: "ENGINES_TRIAL_BIG_ORDER", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine paper trial: Webull big-order buying (shares)", help: "Untested, on paper to learn from live data (added 2026-11-20). The Flow engine buys $5,000 of a stock above its 50-day when Webull's capital flow shows large orders net buying at least 10% of everything traded over the last five sessions and net buying on the latest one, and holds it up to 10 sessions with a 2 ATR stop and a 3 ATR target. Webull keeps only five days of order flow, so it has no history test. Off retires it for new trades. Needs engine share trades on and the Webull order flow log. Changes no Top Pick." },
  { key: "ENGINES_TRIAL_OPTION_SURGE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine paper trial: call volume surge (shares)", help: "Untested, on paper to learn from live data (added 2026-11-20). The Flow engine buys $5,000 of a stock above its 50-day and rising today when today's flagged option volume 7+ days out holds $500k+ of call premium and 70%+ of the flagged premium is in calls. Most hourly prints have no readable bought or sold side, so the stock's own move stands in for it. Holds up to 10 sessions with a 2 ATR stop and a 3 ATR target. Off retires it for new trades. Needs engine share trades on. Changes no Top Pick." },
  { key: "ENGINES_ROTATION", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Multi-asset rotation engine (live paper test)", help: "Added 2026-11-20. Each month it holds up to three of ten funds (SPY, QQQ, IWM, SMH, TLT, GLD, SLV, USO, EWY, KWEB), the strongest by their average 3, 6 and 12-month rise, each only while above its 10-month average and ahead of T-bills; $10,000 each in shares, bought in the Webull paper account too. A multi-asset trend book did worse than the Trend follower in the 2007-2026 review, so this is a live test. Off opens no new holdings (open ones stay until you close them or switch it back on). Changes no Top Pick." },
  { key: "ENGINES_CONV_NO_SCORE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Reversion and Macro: conviction size leaves out the score", help: "Added 2026-11-20. In the 2007-2026 history test Reversion's 80-84 scores lost 5.2% a trade and Macro's 75-79 scores lost 4.1%, worse than their lower scores, so on these two engines the conviction multiplier leaves the setup score out and sizes from the Allocator, the option price and what is already open. Other engines keep it. Off puts the score back. Changes no Top Pick." },
  { key: "ENGINES_RUNIN_BY_IV", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Earnings run-in buys shares when options are rich", help: "Added 2026-11-20. The pre-earnings run-in's up side buys shares when the stock's options are rich or very rich against its own history (before, it bought calls and skipped very rich options) and calls otherwise; either way it is closed before the report. Off goes back to calls only. Needs engine share trades on. Changes no Top Pick." },
  // Downtrend pack (2026-11-20, owner: "We can increase fundamentals from 2
  // puts to 5 puts allowance", "Our engines should all be news aware too and
  // adjust based on sentiment", "for puts we can cap it at 10 contracts
  // max"). Read by engineSwitches in lib/engines/config.mjs; each is a new
  // dated rules version on the engines it reaches.
  { key: "ENGINES_DOWNSIDE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Downside puts engine (live paper test)", help: "Added 2026-11-20. Buys puts only, and only while the market tape Top Picks uses reads risk-off or severe risk-off: on stocks that just lost their 200-day after a run above it, with a falling 50-day and weaker than the S&P over three months. The bubble tracker, hikes priced and a news spike with a souring tone raise its score; it stands aside before a report and when options are very rich. Half the risk budget a trade (half again in extreme fear), at most 10 contracts, 4 open at most. In the 2007-2026 history test puts on stocks losing their 200-day lost money under every market gate that could be tested, so this is a live test. Off opens no new puts (open ones run to their exits). Changes no Top Pick." },
  { key: "ENGINES_PUT_MAX_QTY", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "number", default: 10, min: 1, max: 25, step: 1, unit: "contracts",
    impact: "high", warn: "Changes how many contracts every new engine put can buy, in the record and in the Webull paper account; the engine record splits at a new rules version.",
    label: "Most contracts an engine put buys", help: "Added 2026-11-20. A risk-sized engine put buys 1 contract up to this many (and never more than the cap above, which calls keep). The Riskier dial stops here too for puts. Used only while sizing by risk is on. Changes no Top Pick." },
  { key: "ENGINES_FUN_PUTS5", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Fundamentals holds up to 5 puts", help: "Added 2026-11-20. The Fundamentals engine holds puts on up to the five worst-ranked names (was two) and calls on the three best, eight trades in all, still one new trade a run. Off goes back to two puts and five slots; open puts run to their exits. Changes no Top Pick." },
  { key: "ENGINES_NEWS_GATE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engines read the news before a new trade", help: "Added 2026-11-20. When a stock's news volume (GDELT) is at least twice its usual and the tone of that news turned down by a point or more against the six days before, the signal engines open no new call or share trade on it; when the tone turned up as much, no new put. The held-back trade is tracked as a shadow trade, so the gate gets its own record. A stock with no news read is never blocked. Core engines are not gated (they check their holdings monthly). Off: no news gate. Changes no Top Pick." },
  { key: "ENGINES_TAPE_SIZE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine longs shrink with market risk", help: "Added 2026-11-20. New signal-engine calls and share trades are sized by the market tape Top Picks uses (indexes, VIX, dollar, yields, the Fed path, credit, breadth, fear and greed and more), with its own multiplier: 0.8x on a fragile tape, 0.6x to 1x risk-off by stress, 0.4x severe risk-off. Puts keep their full size; paper trials keep their fixed lot. Every trade records the tape and the multiplier. Off: longs keep their full size. Changes no Top Pick." },
  // Scorecard pack (2026-11-21, owner chose "Scorecard, brake, variants" on
  // the 2026-11-20 engine scorecard review). Read by engineSwitches in
  // lib/engines/config.mjs; the first two are a new dated rules version.
  { key: "ENGINES_LOSER_BRAKE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine loser brake (half size for a losing setup)", help: "Added 2026-11-21. A setup whose own record (the 2007-2026 history test on real option prices plus every live and shadow close since) has 30 or more closes and a t value under -1 is sized at half, never under a quarter after the market-risk step and never skipped, so it keeps gathering live data instead of being retired. It only ever sizes down, and a setup that recovers is back to full size at the next run. On 2026-11-21 it brakes Reversion's washout bounce calls, the extreme-fear bounce calls (already one contract) and Macro's yields-rising TLT puts. Off: no setup is braked. Changes no Top Pick." },
  { key: "ENGINES_TEC_NO_SCORE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Technicals: conviction size leaves out the score", help: "Added 2026-11-21. In the 2007-2026 history test Technicals' 60-64 scores lost 0.84% a trade in both halves while higher scores earned, and sizing by the score cost the engine about $29,000, so its conviction multiplier leaves the score out (as on Reversion and Macro) and sizes from the Allocator and what is already open. Off puts the score back. Changes no Top Pick." },
  { key: "ENGINES_VARIANTS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine variant shadows (one changed variable each)", help: "Added 2026-11-21. Paper copies of an engine with exactly one variable changed (an entry bar, a stop, options or shares, a contract window, a budget), each with a stated hypothesis, run on the same data in the same runs, so the paired difference is the change. Nine to start, at most three an engine. They never send an order to Webull and never touch Top Picks, the Allocator, engine learning or the live record; a variant needs 30 paired closes and a t value of 2.4 before it is called ahead, and promoting one is your call. Shown on the Strategy engines page, Experiments. Off: no variant runs (their books are kept). Changes no Top Pick." },
  // VIX and rates pack (2026-11-21, owner: "Build all five, one PR"), from
  // the rotate-out-of-tech vs hedge test. Read by engineSwitches in
  // lib/engines/config.mjs; each is a dated rules version on its engines.
  { key: "ENGINES_VIX_PAUSE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Pause new tech longs while the VIX is rising", help: "Added 2026-11-21. When the VIX jumps while still under 25 (up 20% in five sessions, or 25% above its 50-day average), the signal engines open no new call or share trade on tech stocks or index funds (SPY, QQQ, IWM and the like) until the VIX closes back under its 50-day average. Puts, paper trials, non-tech stocks and Reversion (whose dip buys are what a VIX jump sets up; pausing them cost about half its profit in the history test) are not paused; the held-back trades are tracked as shadow trades. On a list of every engine trade the pause cut the worst drawdown by about a fifth for about 5% less profit; inside the engines' own 2007-2026 history test it was about even and trimmed drawdowns a little. Off: no VIX pause. Changes no Top Pick." },
  { key: "ENGINES_HIKE_PAUSE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: false,
    label: "Pause new tech longs while hikes are priced", help: "Added 2026-11-21. While the 2-year Treasury yield is at least 0.5 points over fed funds (the market pricing rate hikes) and QQQ closes under its 200-day average, the signal engines open no new call or share trade on tech stocks or index funds. Puts, paper trials, non-tech stocks and Reversion are not paused; held-back trades are tracked as shadow trades. A weak result in the test (about even). Off by default since 2026-11-22 (owner). Off: no rate pause. Changes no Top Pick." },
  { key: "ENGINES_MOM_SECTORS", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Momentum moves to non-tech sectors when tech breaks down", help: "Added 2026-11-21. At the monthly check, when QQQ closes a month under its 10-month average while SPY does not, the Momentum basket holds the three strongest of nine non-tech sector funds (XLP, XLV, XLU, XLE, XLF, XLI, XLB, XLY, XLRE) instead of tech stocks, $10,000 each, ranked like the rotation engine and only while above their own 10-month average and ahead of T-bills. Bought in the Webull paper account too. Uses the wide tier's stored closes; with the wide tier off it stays on stocks. With the volatility target below, Momentum's worst drop in the 2007-2026 history test went from -40.8% to -29.5% for 0.6 points a year less. Off: Momentum always holds stocks (or TLT when SPY breaks). Changes no Top Pick." },
  { key: "ENGINES_VOL_TARGET", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Momentum sizes new lots to a volatility target", help: "Added 2026-11-21. Each new monthly Momentum lot is sized so the basket's past six months of daily swings point to about 35% a year; when the basket swings more, each lot is cut down (never below a tenth, never above full size) and the rest stays in cash. Holdings already open keep their size. The rotation engine was tried at 20% and is left out (it lost more return than it saved in drawdown). Off: full lots. Changes no Top Pick." },
  { key: "ENGINES_TRIAL_VIX_ROLLOVER", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Engine paper trial: buy QQQ when a VIX spike rolls over (shares)", help: "Added 2026-11-21. Unproven, on paper to prove itself. After the VIX has closed at 25 or more within ten sessions and then closes 15% under that peak, Macro buys $25,000 of QQQ (the Webull stock order cap) and holds it 20 sessions with no stop or target. In the engines' 2007-2026 history test: 72 trades, 69% up, +2.0% a trade and about $35,000 in all, though random entries in the same fund made +1.3%, so most of it is QQQ's own rise. Off retires it for new trades. Needs engine share trades on. Changes no Top Pick." },
  // Logic audit fixes (2026-11-21, owner: "Build all 6 fixes" on the engine
  // logic audit). Read by engineSwitches in lib/engines/config.mjs; together
  // they are one dated rules version on each engine they reach.
  { key: "ENGINES_FIX_DEAR_FULL", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Downside puts: too-dear check reads the full budget", help: "Added 2026-11-21. Downside puts trade at half the risk budget, and in extreme fear at half again, so the check that skips a contract costing more than twice the budget was skipping any put over $1,000 or $2,000 (PLTR and UNH were skipped on Nov 20). The check now reads the full $2,000 budget, so one put up to $4,000 can open; the half budgets still set how many contracts are bought. Off: the check reads the halved budget again. Changes no Top Pick." },
  { key: "ENGINES_FIX_ALLOC_ADVISE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Allocator on advise leaves trade sizes alone", help: "Added 2026-11-21. With the Allocator on advise (the default) it should only record its read, but its view of each setup still moved the conviction size up or down (0.75x to 1.15x), from a record built on modeled option prices that the loser brake's real-price record disagrees with. Now the Allocator's read moves the size only when the Allocator is switched on. Off: its read moves the size again. Changes no Top Pick." },
  { key: "ENGINES_FIX_HELD_SAME_SIDE", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Name-held size cut counts only same-side trades", help: "Added 2026-11-21. A new engine trade is sized down when the stock is already held. That check also counted the Trend, Momentum and rotation holdings and trades on the other side (a put next to a call), so a QQQ call was cut because Trend owns QQQ. Now it counts only other signal-engine and Top Picks trades on the same side. Off: every holding counts again. Changes no Top Pick." },
  { key: "ENGINES_FIX_SLOT_RETRY", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "A signal blocked by a full engine can open later", help: "Added 2026-11-21. When a signal is turned away only because its engine had no free slot or had used its new trades for that run, it was marked as done for good, so the 15:30 run could never take it (an earnings run-in signal keeps the same name all week). Now it is tracked once as a shadow trade and can still open for real at a later run while the signal holds. Off: it is marked done, as before. Changes no Top Pick." },
  { key: "ENGINES_FIX_RUNIN_EARLY", scope: "build", tab: "Data & desks", group: "Strategy engines", kind: "switch", default: true,
    label: "Earnings run-in also closes at the 11:00 run", help: "Added 2026-11-21. An earnings run-in trade must be out before the report. It closed only at the 15:30 run of its last day, so a missed or late 15:30 run left it held through the report. It now closes at whichever run comes first that day, 11:00 or 15:30. Off: 15:30 only. Changes no Top Pick." },
  // --- Research and measurement ---------------------------------------------
  { key: "PICKS_RUN_ARCHIVE", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Runs made while it is off are never saved and can't be rebuilt later, so the engine review and later backtests have a hole for those days.",
    label: "Top Picks run archive", help: "Saves every decision run's scored universe for later tests. Measurement only." },
  { key: "REGIME_LAB", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Days while it is off are missing from the Regime Lab paper books and can't be filled in later.",
    label: "Regime Lab", help: "The Owner Lab regime paper books. Changes no pick." },
  { key: "LOOP", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Off stops the prediction ledger. Chances not written on those days can't be added later, so the loop's record and the tuning check lose those days.",
    label: "Self-improving loop", help: "Prediction ledger, diagnosis and challengers. Off stops the measurement and keeps the prior files." },
  { key: "QUANT_LABS", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Days while it is off are missing from the log of stated market odds and the weekly factor panel, and can't be filled in later.",
    label: "Quant labs", help: "Market fall and recovery odds, the calibration lab, factor and volatility reads and the research registry (the Quant labs page). No AI. Changes no pick." },
  { key: "VALUATION_LAB", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    label: "Valuation lab", help: "Saves each stock's valuation inputs (cash flow, earnings, peers, rates, analyst targets) for the Valuation lab page and the MCP value_stock tool. No AI, no download. Off keeps the last saved inputs. Changes no pick." },
  { key: "ENGINES_HISTORY", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    label: "Engine history on the site", help: "Shows the 1971-2026 engine history test across the site: Pattern lab's styles by era, today's regime fit in the Regime Lab and Owner brief, the style strips on Booms & busts and Historical Data, and the MCP dataset. Aggregates only, no AI. Off hides them all. Changes no pick." },
  // --- Engine hooks (off by default; each needs a confirm) --------------------
  // These were locked until 2026-12-07. The Owner lifted the lock on
  // 2026-11-16, so each can be switched on now. None is switched on here.
  { key: "PICKS_CROWD_SQUEEZE_VETO", scope: "build", tab: "Engine hooks", group: "Crowd hooks", kind: "switch", default: false, picks: true, confirm: true,
    impact: "high", warn: "Blocks new puts on hard-to-borrow names, so it changes which puts open. Turn it on only if the Evidence board shows it passing.",
    label: "Crowd squeeze veto", help: "No new puts on hard-to-borrow names. Turn on only after the Evidence table shows it clearing the bar." },
  { key: "PICKS_CROWD_GRADER", scope: "build", tab: "Engine hooks", group: "Crowd hooks", kind: "switch", default: false, picks: true, confirm: true,
    impact: "high", warn: "Changes what the AI grader reads, so its grades and buy-now calls can change on every pick.",
    label: "Crowd lines in the AI grader", help: "Adds the crowd facts to the AI grader's prompt." },
  { key: "PICKS_ODDS_GRADER", scope: "build", tab: "Engine hooks", group: "Prediction odds hooks", kind: "switch", default: false, picks: true, confirm: true,
    impact: "high", warn: "Changes what the AI grader reads, so its grades and buy-now calls can change on every pick that has linked prediction markets.",
    label: "Prediction odds in the AI grader", help: "Adds the name's linked prediction-market odds and their weekly moves to the AI grader's prompt. Turn on only if the Prediction odds tests show the odds lead stock moves." },
  { key: "PICKS_MACRO_PUTCALL_SRC", scope: "build", tab: "Engine hooks", group: "Crowd hooks", kind: "choice", default: "universe", picks: true, confirm: true,
    options: [["universe", "Covered stocks"], ["cboe", "Cboe equity put/call"]],
    impact: "high", warn: "Changes one of the market tape's votes, which can move the tape between neutral and risk-off and with it the whole book's tilt.",
    label: "Put/call source for the market tape", help: "Which put/call reading votes on the market tape." },
  { key: "SELF_TUNE", scope: "build", tab: "Engine hooks", group: "Self-tuning", kind: "choice", default: "shadow", picks: true, confirm: true,
    options: [["shadow", "Shadow (proposals only)"], ["off", "Off (frozen base)"], ["on", "On (applies inside the limits)"]],
    impact: "high", warn: "On lets the loop change input weights by itself every week (up to 2 points per name, never flipping a side). Off freezes the loop's tuning.",
    label: "Self-tuning", help: "Shadow shows proposals and changes nothing. On applies the tuned weights inside the loop's limits from the next Top Picks run." },
  // --- Account limits (2026-11-19, lib/owner-controls.mjs) --------------------
  // All 0 = off until the Owner sets them. Read by the bake (the strategy
  // engines) and at request time by the Webull paper mirror (the saved value,
  // unless Vercel sets one). The "Stop new trades" switch itself lives on the
  // Strategy engines page controls (and its banner on Top Picks and Open picks).
  { key: "OWNER_CONTROLS", scope: "build", tab: "Account limits", group: "Owner controls", kind: "switch", default: true,
    impact: "high", warn: "Off ignores Stop new trades, Avoid, Watch closely, catalyst stamps and the risk dial everywhere: Top Picks, the engines and the Webull paper mirror trade as if none were set.",
    label: "Owner controls", help: "The kill switch for the quick controls on the Strategy engines page. Off keeps what you saved but nothing applies; the account limits below still apply." },
  { key: "ACCOUNT_LIMIT_OPEN_USD", scope: "build", tab: "Account limits", group: "Engines and Webull paper", kind: "number", default: 0, min: 0, max: 5000000, step: 500, unit: "$",
    impact: "high", warn: "Once set, new strategy-engine option trades and new Webull paper opens that would push open premium past this cap are not opened. Open trades are never closed by it.",
    label: "Cap on open option premium", help: "Most option premium open at once across the engines (and, in the Webull paper account, across both records). 0 = off." },
  { key: "ACCOUNT_LIMIT_DAY_LOSS_USD", scope: "build", tab: "Account limits", group: "Engines and Webull paper", kind: "number", default: 0, min: 0, max: 1000000, step: 250, unit: "$",
    impact: "high", warn: "Once set, a day down this much stops new strategy-engine trades and new Webull paper opens until the next day. Exits keep running.",
    label: "Daily loss stop", help: "Engines: closed results today plus the open book's move since the day's first run. Webull paper: today's closed fills. 0 = off." },
  { key: "ACCOUNT_LIMIT_NAME_USD", scope: "build", tab: "Account limits", group: "Engines and Webull paper", kind: "number", default: 0, min: 0, max: 1000000, step: 250, unit: "$",
    impact: "high", warn: "Once set, a new trade that would put more than this into one stock across all engines (or the Webull paper account) is not opened.",
    label: "Cap per stock across engines", help: "Most money in one stock across every engine's open trades, options and shares at cost. 0 = off." },
  { key: "ACCOUNT_LIMIT_NEW_PER_DAY", scope: "build", tab: "Account limits", group: "Engines and Webull paper", kind: "number", default: 0, min: 0, max: 100, step: 1,
    impact: "high", warn: "Once set, the strategy engines and the Webull paper account open no more than this many new trades in a day. Later setups that day are skipped.",
    label: "Most new trades a day", help: "New signal-engine trades a day (core engines' monthly holdings not counted there), and new Webull paper opens a day (every paper order counts, core engine share lots included). 0 = off." },
  // Engine stock orders at Webull (2026-11-19, Owner rule): read at request
  // time by the Webull paper mirror (stockRangeFromSettings in
  // lib/webull-mirror.mjs; a Vercel value wins). The engine records keep
  // their own share counts.
  { key: "WEBULL_STOCK_MIN_USD", scope: "build", tab: "Account limits", group: "Webull paper stock orders", kind: "number", default: 2000, min: 0, max: 100000, step: 100, unit: "$",
    impact: "high", warn: "Changes how many shares the Webull paper account buys for every new engine share trade and core holding. A smaller engine lot is bought up to this much; the engine records keep their own share counts.",
    label: "Smallest engine stock order", help: "Each new engine stock order at Webull buys at least this much stock at the engine's price: a smaller lot is raised to the fewest whole shares that reach it. 0 = no minimum. Above the largest order, the largest wins." },
  { key: "WEBULL_STOCK_MAX_USD", scope: "build", tab: "Account limits", group: "Webull paper stock orders", kind: "number", default: 25000, min: 1000, max: 250000, step: 500, unit: "$",
    impact: "high", warn: "Changes how many shares the Webull paper account buys for every new engine share trade and core holding. A bigger engine lot is cut to this much, and a stock whose single share costs more is not bought.",
    label: "Largest engine stock order", help: "Each new engine stock order at Webull buys at most this much stock at the engine's price: a bigger lot (the Trend follower's $50,000 lot, for one) is cut to the most whole shares that fit. Shares already bought keep their size." },
  // Top Picks option orders at Webull (2026-11-20, owner: "both to 25 and we
  // can raise or lower in owner settings"; 10 before): read at request time
  // by the mirror (picksCapFromSettings in lib/webull-mirror.mjs; a Vercel
  // value wins). The Top Picks record stays in percent per contract.
  { key: "WEBULL_PICKS_MAX_QTY", scope: "build", tab: "Account limits", group: "Webull paper option orders", kind: "number", default: 25, min: 1, max: 25, step: 1, unit: "contracts",
    impact: "high", warn: "Changes how many contracts the Webull paper account buys for every new Top Picks trade. A higher cap lets a cheap contract buy more, so a loss costs more dollars; trades already sent keep their size.",
    label: "Most contracts a Top Pick buys at Webull", help: "Top Picks orders at Webull are sized by risk (the engines' risk budget over one contract's risk) from 1 contract up to this many. Each order records the cap and the count the budget asked for when the cap set it. Needs Webull quantities above one and Top Picks risk sizing on (Live site). The Top Picks record is in percent per contract either way." },
  // --- Live site switches (request time, can only turn off) -------------------
  { key: "CONTACT_ENABLED", scope: "site", tab: "Live site", group: "Public", kind: "switch", default: true,
    impact: "high", warn: "Off hides the public message form for every visitor. Nobody can send a message until it is back on.",
    label: "Message box", help: "The public Send us a message form. Off stops new messages; the inbox keeps every message." },
  { key: "MCP_PUBLIC_ACCESS", scope: "site", tab: "Live site", group: "Public", kind: "switch", default: true,
    impact: "high", warn: "Off cuts off everyone who uses the MCP tools without signing in, at once.",
    label: "Public MCP tools", help: "The MCP tools anyone can use without signing in, when Vercel allows them. Off = the MCP is Owner-only." },
  { key: "SPORTS_ENABLED", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    label: "Sports section", help: "The Owner NBA, NFL and Pick Builder pages and their MCP tools." },
  { key: "MCP_ENABLED", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off disconnects ChatGPT, Claude and every other AI client from the site at once, for both owners.",
    label: "MCP server", help: "The read-only research server for ChatGPT, Claude and other AI clients." },
  { key: "WEBULL_MIRROR", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Trades that open or close while it is off are not copied when they happen, so the Webull paper record gets gaps or late fills.",
    label: "Webull paper mirror", help: "Copies Top Picks trades into the Webull paper account. Off pauses it. It only runs when Vercel has it on." },
  // Webull paper sizing (2026-11-19). Each can only turn its part off; trades
  // already in the paper account keep being managed and closed either way.
  { key: "WEBULL_SHARES", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off stops new share orders reaching the Webull paper account: engine share trades and the Trend, Momentum and Multi-asset rotation holdings stay on their own records only. Shares already bought keep being sold when their trades close.",
    label: "Webull share orders", help: "Engine share trades and the Trend follower, Momentum basket and Multi-asset rotation holdings are bought and sold as stock in the Webull paper account." },
  { key: "WEBULL_QTY", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off sends one contract per option trade to Webull again, whatever size the record or the risk budget asks for. Trades already sent keep their size.",
    label: "Webull quantities above one", help: "Option orders send each trade's size (1 to 25 contracts): an engine trade's own quantity, a Top Pick's risk size up to the Top Picks cap (Account limits). Off = one contract per trade." },
  { key: "WEBULL_PICKS_SIZING", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off sends one contract per Top Picks trade to Webull. The Top Picks record is in percent per contract either way.",
    label: "Webull Top Picks risk sizing", help: "Top Picks orders at Webull are sized by risk (the engines' risk budget, $2,000 unless set): the whole premium under a month to expiry, else premium x stop x 1.25. 1 contract up to the Top Picks cap (Account limits, 25 unless set). Needs quantities above one on." },
  // Webull's own data in the mirror (2026-11-19, wave 2 build A). Each can
  // only turn its part off; trades already sent are untouched.
  { key: "WEBULL_CONTRACT_CHECK", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off sends option orders without checking Webull's contract list first, so an order for a contract Webull won't trade is sent and rejected, and limits use the old price step.",
    label: "Webull contract check", help: "Before the first order of an option trade, the mirror looks the contract up in Webull's own contract list. Not listed or not tradable: no order, logged as missed (Not tradable at Webull). Also uses Webull's Penny Pilot flag for the price step." },
  { key: "WEBULL_REAL_FEES", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    label: "Webull real fees", help: "After each mirror run, reads the real commission and fees of filled orders from Webull's order history (last 7 days). Off keeps the order preview's estimate where the order record had no fee." },
  { key: "WEBULL_STOCK_QUOTES", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off prices share orders off Yahoo's quote again, not Webull's own real-time quote.",
    label: "Webull stock quotes for share orders", help: "Share orders are priced off Webull's real-time stock quote. Yahoo is the backup when Webull fails, is stale (no trade in 5 minutes) or differs from Yahoo by over 1%. Option orders keep Yahoo either way." },
  // The daily Webull data runner (2026-11-19, docs/webull-data.md): read-only
  // Webull data saved after the close. Each can only turn its part off.
  { key: "WEBULL_DATA", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off stops every daily Webull data save. Days missed while it is off are not saved later, and expired option contracts whose prices Webull deletes in the meantime are lost for good.",
    label: "Webull daily data", help: "After the close, saves read-only Webull data for research: option prices, and the other daily Webull logs. Never shown on public pages." },
  { key: "WEBULL_OPTION_SAVER", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off stops saving option prices. Expired contracts' price histories that Webull deletes about a week after expiry are lost for good while it is off.",
    label: "Webull option price saver", help: "Saves bid, ask, IV, Greeks and open interest for our names' near-the-money options every day, and each expired contract's full daily price history before Webull deletes it." },
  // Webull data logs (W3, lib/webull-data/, 2026-11-19). Each stops both the
  // daily save (the Vercel webull-data runner reads the same switch) and the
  // bake's use of what is saved. Owner pages only.
  { key: "WEBULL_FLOW_LOG", scope: "site", tab: "Live site", group: "Webull data", kind: "switch", default: true,
    label: "Webull order flow log", help: "Saves Webull's large, medium and small money in and out for every covered stock once a day (Webull keeps only 5 days). Shown on the stock page's Owner tab and logged as shadow inputs; never a vote." },
  { key: "WEBULL_BREADTH_LOG", scope: "site", tab: "Live site", group: "Webull data", kind: "switch", default: true,
    label: "Webull market breadth log", help: "Saves Webull's market sectors (up, down, flat), the spread of every US stock's daily move, 52-week highs and lows, top gainers, losers and most active once a day. Shown on Market analysis and the Bottom tracker; never a vote." },
  { key: "WEBULL_BACKUPS", scope: "site", tab: "Live site", group: "Webull data", kind: "switch", default: true,
    impact: "high", warn: "Off stops Webull's earnings dates from filling in for a missing Yahoo or Nasdaq date in the Top Picks decision, which can change whether earnings fall inside a trade and so its structure.",
    label: "Webull backups", help: "Saves Webull's earnings calendar, analyst ratings and targets, Fear & Greed and the economic calendar. The bake uses a value only when our main source has none, labels it backup source, and lists every disagreement on Market analysis." },
]);

const BY_KEY = new Map(OWNER_SETTINGS.map((d) => [d.key, d]));
export const ownerSettingDef = (key) => BY_KEY.get(key) || null;

// The environment value that means "off" for each site switch.
const SITE_OFF = { CONTACT_ENABLED: "0", SPORTS_ENABLED: "0", MCP_ENABLED: "0", MCP_PUBLIC_ACCESS: "0", WEBULL_MIRROR: "off",
  WEBULL_SHARES: "0", WEBULL_QTY: "0", WEBULL_PICKS_SIZING: "0", WEBULL_CONTRACT_CHECK: "0", WEBULL_REAL_FEES: "0", WEBULL_STOCK_QUOTES: "0",
  WEBULL_DATA: "0", WEBULL_OPTION_SAVER: "0", WEBULL_FLOW_LOG: "0", WEBULL_BREADTH_LOG: "0", WEBULL_BACKUPS: "0" };

export function etDate(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// True when this value may not be set yet (before the lock date).
export function isLocked(def, value, today = etDate()) {
  if (!def || !def.lockedUntil || today >= def.lockedUntil) return false;
  if (sameValue(value, def.default)) return false;
  if (Array.isArray(def.lockedValues)) return def.lockedValues.includes(value);
  return true;
}

function sameValue(a, b) { return a === b; }

// True when a change away from the default needs an "are you sure".
export const needsConfirm = (def) => !!(def && (def.confirm || def.impact === "high"));

// Clean one value for a setting; undefined when it is not allowed.
export function cleanValue(def, raw) {
  if (!def) return undefined;
  if (def.kind === "switch") {
    if (raw === true || raw === "on" || raw === "1" || raw === 1) return true;
    if (raw === false || raw === "off" || raw === "0" || raw === 0) return false;
    return undefined;
  }
  if (def.kind === "number") {
    if (raw === "" || raw == null || typeof raw === "boolean") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < def.min || n > def.max) return undefined;
    const steps = Math.round((n - def.min) / def.step);
    if (Math.abs(def.min + steps * def.step - n) > 1e-9) return undefined;
    return Math.round(n * 1e6) / 1e6;
  }
  if (def.kind === "choice") {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return def.options.some((o) => o[0] === v) ? v : undefined;
  }
  return undefined;
}

// The environment string for a value.
export function envValue(def, value) {
  if (def.kind === "switch") {
    if (def.scope === "site") return value ? null : SITE_OFF[def.key];
    return value ? "1" : "0";
  }
  return String(value);
}

function emptyDoc() {
  return { version: OWNER_SETTINGS_VERSION, values: {}, updatedAt: null, by: null, seq: 0, history: [] };
}

function cleanChange(c) {
  const def = c && ownerSettingDef(c.key);
  if (!def) return null;
  const v = (x) => (x == null ? null : cleanValue(def, x) ?? null);
  return { key: def.key, from: v(c.from), to: v(c.to) };
}

// Read the stored record. A missing, unreadable or unknown record reads as
// every default, and unknown keys or out-of-range values are dropped, so a bad
// file can never push a setting outside its range.
export function readOwnerSettingsDoc(raw) {
  let doc = null;
  try {
    if (raw == null) doc = null;
    else if (typeof raw === "string") doc = JSON.parse(raw);
    else if (raw instanceof Uint8Array) doc = JSON.parse(Buffer.from(raw).toString("utf8"));
    else doc = raw;
  } catch { doc = null; }
  if (!doc || typeof doc !== "object") return emptyDoc();
  const values = {};
  const src = doc.values && typeof doc.values === "object" ? doc.values : {};
  for (const def of OWNER_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(src, def.key)) continue;
    const v = cleanValue(def, src[def.key]);
    if (v !== undefined && !sameValue(v, def.default)) values[def.key] = v;
  }
  const history = (Array.isArray(doc.history) ? doc.history : []).filter((h) => h && typeof h === "object").slice(0, OWNER_SETTINGS_HISTORY).map((h) => ({
    id: Number.isFinite(Number(h.id)) ? Number(h.id) : 0,
    at: typeof h.at === "string" ? h.at : null,
    by: typeof h.by === "string" ? h.by.slice(0, 64) : null,
    kind: ["set", "reset", "reset-all", "undo"].includes(h.kind) ? h.kind : "set",
    changes: (Array.isArray(h.changes) ? h.changes : []).map(cleanChange).filter(Boolean),
    ...(h.undone ? { undone: true } : {}),
    ...(Number.isFinite(Number(h.of)) ? { of: Number(h.of) } : {}),
  }));
  return {
    version: OWNER_SETTINGS_VERSION,
    values,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    by: typeof doc.by === "string" ? doc.by.slice(0, 64) : null,
    seq: Number.isFinite(Number(doc.seq)) ? Number(doc.seq) : history.reduce((m, h) => Math.max(m, h.id), 0),
    history,
  };
}

export const currentValue = (doc, def) => (Object.prototype.hasOwnProperty.call(doc.values, def.key) ? doc.values[def.key] : def.default);

// Apply one Owner request:
//   { act: "set", values: { KEY: value, ... }, confirm? }
//   { act: "reset", key }        one setting back to its default
//   { act: "reset-all" }         every setting back to its default
//   { act: "undo" }              reverse the newest change not yet undone
// Returns { doc } | { doc, unchanged: true } | { error }.
export function applyOwnerSettingsRequest(current, body, { at = new Date().toISOString(), by = null } = {}) {
  const cur = readOwnerSettingsDoc(current);
  const who = typeof by === "string" && by ? by.slice(0, 64) : null;
  const today = etDate(at);
  const act = body && typeof body === "object" ? body.act : null;
  let target = null; // { KEY: value|null(default) }
  let kind = act;
  let undoOf = null;
  if (act === "set") {
    const vals = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : null;
    const keys = vals ? Object.keys(vals) : [];
    if (!keys.length || keys.length > OWNER_SETTINGS.length) return { error: "nothing to change" };
    target = {};
    for (const k of keys) {
      const def = ownerSettingDef(k);
      if (!def) return { error: `unknown setting ${String(k).slice(0, 40)}` };
      const v = cleanValue(def, vals[k]);
      if (v === undefined) return { error: `${def.label}: value out of range` };
      if (isLocked(def, v, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      target[k] = sameValue(v, def.default) ? null : v;
    }
  } else if (act === "reset") {
    const def = ownerSettingDef(body.key);
    if (!def) return { error: "unknown setting" };
    target = { [def.key]: null };
  } else if (act === "reset-all") {
    target = Object.fromEntries(OWNER_SETTINGS.map((d) => [d.key, null]));
  } else if (act === "undo") {
    const last = cur.history.find((h) => h.kind !== "undo" && !h.undone);
    if (!last) return { error: "nothing to undo" };
    target = {};
    for (const c of last.changes) {
      const def = ownerSettingDef(c.key);
      // An undo may never turn a locked value back on early.
      if (c.from != null && isLocked(def, c.from, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      target[c.key] = c.from;
    }
    undoOf = last.id;
  } else return { error: "bad request" };

  const changes = [];
  const values = { ...cur.values };
  for (const [k, v] of Object.entries(target)) {
    const def = ownerSettingDef(k);
    const from = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
    if (sameValue(from, v)) continue;
    if (v == null) delete values[k]; else values[k] = v;
    changes.push({ key: def.key, from, to: v });
  }
  if (!changes.length && undoOf == null) return { doc: cur, unchanged: true };
  // Moving a big-impact or locked-hook setting off its default needs an
  // explicit "are you sure" (body.confirm), whether by a set or an undo.
  // Going back to the default (reset, reset all) never does.
  const needs = changes.filter((c) => c.to != null && needsConfirm(ownerSettingDef(c.key)));
  if (needs.length && body.confirm !== true) return { error: `${needs.map((c) => ownerSettingDef(c.key).label).join(", ")}: needs confirmation`, needsConfirm: true };
  const id = cur.seq + 1;
  const history = cur.history.map((h) => (undoOf != null && h.id === undoOf ? { ...h, undone: true } : h));
  const entry = { id, at, by: who, kind, changes, ...(undoOf != null ? { of: undoOf } : {}) };
  return { doc: { version: OWNER_SETTINGS_VERSION, values, updatedAt: at, by: who, seq: id, history: [entry, ...history].slice(0, OWNER_SETTINGS_HISTORY) } };
}

// What the page shows: the catalog with each setting's value.
export function ownerSettingsView(doc, { today = etDate(), applied = null, env = null } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const pinned = new Set(Array.isArray(applied?.pinned) ? applied.pinned : []);
  return {
    version: d.version,
    updatedAt: d.updatedAt,
    by: d.by,
    today,
    settings: OWNER_SETTINGS.map((def) => {
      const value = currentValue(d, def);
      // A site switch is held off by Vercel when its env already says off.
      const vercelOff = def.scope === "site" && env ? siteEnvOff(def.key, env) : false;
      return {
        key: def.key, scope: def.scope, tab: def.tab, group: def.group, kind: def.kind, label: def.label, help: def.help,
        default: def.default, value, changed: !sameValue(value, def.default),
        ...(def.kind === "number" ? { min: def.min, max: def.max, step: def.step, unit: def.unit || null } : {}),
        ...(def.kind === "choice" ? { options: def.options } : {}),
        ...(def.picks ? { picks: true } : {}),
        ...(needsConfirm(def) ? { confirm: true } : {}),
        ...(def.impact === "high" ? { impact: "high", warn: def.warn } : {}),
        ...(def.lockedUntil && today < def.lockedUntil ? { lockedUntil: def.lockedUntil, lockedValues: def.lockedValues || null } : {}),
        ...(pinned.has(def.key) ? { pinned: true } : {}),
        ...(vercelOff ? { vercelOff: true } : {}),
      };
    }),
    history: d.history,
    applied: applied || null,
  };
}

function siteEnvOff(key, env) {
  const v = String(env[key] ?? "").trim().toLowerCase();
  if (key === "WEBULL_MIRROR") return v !== "on";
  if (key === "MCP_PUBLIC_ACCESS") return v !== "1";
  return v === "0";
}

// --- build side ---------------------------------------------------------------
// Copy saved build values into env. A key already set (non-empty) in env is a
// repo variable and wins (pinned). Locked values are skipped again here, so a
// hand-edited file can't switch one on early. Returns the report the build
// writes to owner-settings-applied.json and stamps on new trades.
export function applyOwnerSettingsToEnv(doc, env = process.env, { at = new Date() } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const today = etDate(at);
  const applied = {}, pinned = [], skipped = [];
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "build") continue;
    const envNow = env[def.key];
    const has = envNow != null && String(envNow).trim() !== "";
    if (has) pinned.push(def.key);
    if (!Object.prototype.hasOwnProperty.call(d.values, def.key)) continue;
    const value = d.values[def.key];
    if (has) { skipped.push({ key: def.key, reason: "repo variable" }); continue; }
    if (isLocked(def, value, today)) { skipped.push({ key: def.key, reason: `locked until ${def.lockedUntil}` }); continue; }
    env[def.key] = envValue(def, value);
    applied[def.key] = value;
  }
  // Once a Top Picks setting has ever been changed here, trades opened back on
  // the defaults are stamped "default", so the Track Record starts a new
  // segment when the Owner reverts instead of folding those trades in with
  // the ones from before the Settings page existed.
  const everPicks = d.history.some((h) => h.changes.some((c) => ownerSettingDef(c.key)?.picks));
  const tag = picksTag(applied) || (everPicks ? "default" : "");
  return { appliedAt: new Date(at).toISOString(), settingsUpdatedAt: d.updatedAt, seq: d.seq, applied, pinned, skipped, picksTag: tag };
}

// Short stable tag of the applied Top Picks settings, e.g.
// "PICKS_COUNT=4,PICKS_EVENT_AWARE=off". Empty when every one is the default.
export function picksTag(applied) {
  return Object.keys(applied || {}).filter((k) => ownerSettingDef(k)?.picks).sort().map((k) => {
    const v = applied[k];
    return `${k}=${v === true ? "on" : v === false ? "off" : v}`;
  }).join(",");
}

// Plain words for a tag, for the Track Record divider.
export function describePicksTag(tag) {
  if (!tag) return "";
  if (tag === "default") return "back on the defaults";
  return String(tag).split(",").map((part) => {
    const [k, v] = part.split("=");
    const def = ownerSettingDef(k);
    return def ? `${def.label} ${v}` : part;
  }).join("; ");
}

// --- request side ---------------------------------------------------------------
// Site switches the Owner turned off, as env overrides for this request.
export function runtimeEnvOverrides(doc) {
  const d = readOwnerSettingsDoc(doc);
  const out = {};
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "site") continue;
    if (Object.prototype.hasOwnProperty.call(d.values, def.key) && d.values[def.key] === false) out[def.key] = SITE_OFF[def.key];
  }
  return out;
}
