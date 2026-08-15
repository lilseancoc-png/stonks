# Stonks: complete product and decision-logic guide

**Code audit date:** July 26, 2026
**Authority:** current renderer, build scripts, API code, and workflow files. Where an older comment or repository guide disagrees with executable code, this document follows the code.

## 1. What the product is

Stonks is a trader-facing research and execution workstation for a curated universe of roughly 138 stocks and ETFs. It is not one model and it is not only an option grader. It combines:

- a common per-ticker market-data and research substrate;
- deterministic scores, screens, and risk gates;
- selective AI synthesis where judgment or summarization is useful;
- live request-time quote and chain overlays;
- historical ledgers that hold the models accountable;
- explicit `Buy now`, `Wait`, `Pass`, invalidation, target, and payoff states.

The basic architecture is intentionally simple:

1. Scheduled jobs fetch market, options, fundamental, event, news, and macro data.
2. `scripts/build.mjs` turns those inputs into JSON products and generates the static site.
3. `scripts/render/html.mjs`, `app-js.mjs`, `styles-css.mjs`, and `docs.mjs` are the editable UI sources.
4. The generated `index.html`, `app.js`, and `styles.css` are the files that actually ship.
5. Vercel functions provide live quotes, live option chains, macro overlays, authentication, and private-data reads.

Most important design rule: a strong observation is not automatically a trade. The site generally separates:

- **signal:** what the data says;
- **setup:** whether the signal has a coherent thesis;
- **entry:** whether price is in a sensible place now;
- **vehicle:** shares, a long option, or a defined-risk spread;
- **risk:** invalidation, stop, target, payoff, and sizing;
- **accountability:** what happened after the model officially entered.

## 2. Complete site map

| Area | Feature | What it is |
|---|---|---|
| Desk | Home | Launchpad into the main workflows; no independent trading model. |
| Owner | Brief | Hourly AI market briefing built only from deterministic evidence supplied by the system. |
| Desk | News | Straight headline triage ranked by likely trading importance and labeled for direction. |
| Owner | Market Analysis | The live multi-axis market regime and risk barometer. |
| Owner | Stock Picks | Shares-only quality-company dip screen plus the VOO/QQQ DCA dial. |
| Owner | Sector Rotation | Long-only peer-washout rebound desk with frozen-mean recovery logic. |
| Owner | Leveraged ETFs | The common grade mapped to verified listed leveraged products, with daily-reset risk. |
| Events | Calendar | Earnings, macro releases, FOMC/FedWatch, catalysts, and event history. |
| Events | Earnings Tracker | Session-aware earnings reactions, implied-versus-realized moves, and season summaries. |
| Events | Earnings Calls | Source-linked transcript briefs with outlook changes, risks, and Q&A pressure. |
| Owner | Event Spillover | Statistical read-through from an earnings reporter to same-industry followers. |
| Owner | Index Calendar | Long-history calendar returns and conditional timing statistics. |
| Desk | Heatmap | Market-cap-sized equity map, breadth, relative volume, and sector streaks. |
| Owner | Unusual Flow | Front-expiry volume-versus-open-interest scanner with tape-location context. |
| Owner | Volume | Time-of-day-adjusted stock-volume and support/resistance-break scanner. |
| Owner | Gamma Exposure | Dealer-positioning proxy, walls, net GEX, and gamma-flip estimate. |
| Owner | Trending IV | Names whose implied volatility is elevated and still accelerating versus their own history. |
| Ideas & Flow | MA Tracker | Stocks within 5% of their 20/50/100/200-day averages, ranked by crossover evidence. |
| Owner | Streaks | Noise-aware multi-day directional runs with reversal handling. |
| Macro | Overnight Markets | Global-market changes, cross-asset relationships, and beta-implied US moves. |
| Macro | Fear & Greed | CNN's seven-component 0–100 sentiment composite and history. |
| Macro | Bonds & USD | Treasury curve, dollar, inflation, labor, credit, and live cross-asset overlays. |
| Alt Data | AI CapEx | Major AI buyers' reported CapEx, run rate, management guidance, revenue burden, and supplier read-through. |
| Alt Data | RAM Prices | Wholesale DRAM plus retail DDR5 pricing and breadth. |
| Alt Data | GPU Cloud Prices | Public accelerator rental and spot rates normalized to USD per GPU-hour, with provider/model history. |
| Alt Data | Central-bank Gold | Quarterly estimated global net demand plus latest reported official holdings, reserve share, and 3/12-month changes by country. |
| Alt Data | Search Interest | Weekly Google Trends attention for curated market and technology themes, with top/rising queries and 7/30-day changes. |
| Macro | Commodities | Eleven input-cost, freight, and demand series mapped to exposed equities. |
| Macro | Capital Raises | Issuer-level equity, convertible, debt, and buyback events. |
| Macro | IPOs & Credit | IPO participation, bond issuance, bank funding, and household-credit backdrop. |
| Owner | Tickers | Curated-universe browser and entry point to a ticker's full evidence. |
| Owner | Narratives | AI-generated industry and sector story arcs with lifecycle and invalidation. |
| Research | 13F Filings | Delayed institutional holdings and quarter-over-quarter share-direction changes. |
| Owner | Top Picks | The most selective option-trade roster. |
| Owner | Track Record | Modeled option P&L, diagnostics, and strategy accountability. |
| Owner | Owner Lab | Private position/account-risk controls plus analytical statistical screens. |
| Owner | Day Trading | Current 15-minute paper-engine state, open trades, and decision queue. |
| Owner | Day Trading Track Record | Durable stock long/short paper ledger, diagnostics, and closed trades. |
| Owner | Grade a Ticker | Full company/technical/flow/narrative grade plus option-contract grading. |
| Owner | Compare Companies | Normalized multi-symbol performance comparison. |
| Owner | Strategies | Live multi-leg option payoff builder and structure guidance. |
| Tools | Buyer's Manual | Educational options reference. |
| Tools | Chart Patterns | Educational pattern reference used alongside the AI pattern detector. |
| Tools | Refresh Schedule | ET publication timeline for builds, scanners, Brief, OI, and live overlays. |
| Legal | Privacy Policy / Terms of Use | Session, privacy, membership, risk, and legal disclosures. |

## 3. The shared ticker substrate

Every major ticker workflow begins with the same baked per-symbol object. Depending on availability, it contains:

- spot, prior close, daily and intraday bars;
- option expirations, calls, puts, volume, open interest, bid/ask, and IV;
- RSI, MACD, SMA stack, support/resistance, realized volatility, volume, and 52-week position;
- fundamentals, earnings, analyst data, margins, cash flow, valuation, and next earnings date;
- recent news plus an AI ticker-specific news take;
- guidance, major-contract/deal, and capital-raise signals;
- chart-pattern classification;
- sector, industry, peer, and macro context.

Confirmed daily bars are used for decisions that must not peek at an unfinished session. Live prices may decorate the UI or recalculate an execution state, but a live quote does not silently rewrite a baked historical feature such as a z-score.

The same grade engine powers both the free all-universe grade index and Top Picks. Specialized products then add their own eligibility, execution, and diversification rules.

## 4. The common grade

For every ticker:

```text
total = Technicals + Mechanicals + Fundamentals + Narrative
        + ivCost

side       = sign(total)       positive = call bias; negative = put bias
conviction = abs(total)
entry      = entryTimingV2     execution-only Go / Wait / Avoid
```

Each of the four main pillars is clamped to `-5…+5`; IV cost is bounded to
`-2…+1`. Entry timing is separately bounded to `-8…+2` and does not alter side
or conviction.

### Technicals

- RSI movement: `±1`.
- Reversal-confirmed RSI extreme: `±3`.
- MACD: `±1`.
- Moving-average trend: `±1`.
- Price streak: `±1`.
- Confirmed support/resistance break: `±2`.
- Contrarian 52-week position: `±1`.
- Volume confirmation: `±1`.
- Confirmed chart pattern: `±1` only while the exact analyzed 30-minute bars still match. A forming or changed-bar cached pattern is context, not score.

### Mechanicals

- unusual option flow: `±1`;
- open-interest call/put skew: `±1`;
- short-interest squeeze or covering setup: `±1`;
- unusual stock volume plus direction: `±1`.

### Fundamentals

- earnings surprise: up to `±2`;
- EPS growth: `+1 / -2`;
- revenue growth: `+1 / -2`;
- target upside/downside: `±1`;
- net analyst upgrades/downgrades: up to `±2`;
- P/E versus sector: `±1`;
- guidance: raised `+3`, in line `+2`, lowered `-3`;
- major contract/deal: won `+2`, lost `-3`;
- financing/buyback event: magnitude-scaled roughly `-3…+3`;
- free cash flow: `±1`;
- margin direction: `±1`;
- forward business trajectory: up to `±2`.

ETFs suppress the entire company-fundamentals pillar. A fund does not have corporate earnings, guidance, contracts, or operating margins.

### Narrative

- ticker news: bullish `+2`, bearish `-3`;
- industry/sector narrative: up to `±2`, faded as the narrative lifecycle ages;
- social sentiment: `±1`.

The Grade tab's News pane also carries a per-ticker retail sentiment tracker.
Stocktwits is the directional source because posters self-tag messages as
Bullish or Bearish; untagged posts remain visible but do not enter the split.
Each successful bake appends the directional net, trailing-24-hour message count
and sample time to a rolling 35-day / 240-point history, then compares the new
reading with the prior successful sample. Recent message excerpts are deduped
and retained for seven days. A failed refresh carries the last reading forward
as stale and does not manufacture a new history point.

Polymarket comments are attached only when an active event safely matches the
ticker's company. They are displayed as context, linked back to the event, and
never mixed into the bullish/bearish bar: interpreting a comment's direction
would require knowing the exact market question and the poster's side. Kalshi
probabilities remain in Calendar/FedWatch; the tracker does not ingest Kalshi
comments because no documented public comments endpoint is available to this
pipeline.

### Entry timing

The timing model recomputes RSI, MACD, SMA, ATR and volume from one confirmed
OHLCV cutoff. It combines capped extension, impulse/pullback quality,
directional momentum/volume, calendar risk and level/payoff structure.

- **Avoid:** a confirmed falling knife/broken impulse, exhaustion confluence, or total score `≤-5`.
- **Wait:** hard event risk, score `-4…+1`, missing confirmation, unclear invalidation, or payoff below 1.5:1.
- **Go:** score `+2`, positive turn confirmation, two independent evidence families, invalidation within 2 ATR, and reward/risk at least 1.5:1.

Countertrend trades require a reclaim plus full confirmation. Extended
tape-aligned calls in risk-on and puts in risk-off require full confirmation
and payoff rather than receiving a blanket pro-cyclical bonus.

### IV cost

Long premium is expensive regardless of direction:

- own-history IV percentile `>=80`: `-2` conviction;
- own-history IV percentile `<=20`: `+1` conviction;
- otherwise neutral.

The contribution is multiplied by the sign of the base grade. That means rich IV reduces conviction for both calls and puts instead of accidentally strengthening bearish picks.

### Grade tiers

- `abs(total) >= 7`: Strong Call / Strong Put.
- `abs(total) >= 4`: Call / Put.
- below `4`: No Trade.

These are fixed absolute thresholds, not daily percentile cutoffs. The grade can therefore leave the board sparse when evidence is weak.

## 5. Market Analysis: the regime engine

Market Analysis is the common tape and risk overlay. It votes across 16 axes, each scored from `-2` to `+2`:

1. SPY/QQQ indexes;
2. VIX level, trend, and term structure;
3. 10Y/30Y yields;
4. DXY;
5. Fed path and nearby FOMC risk;
6. crude/gold commodity shock;
7. geopolitical and tariff headlines;
8. inflation and labor;
9. Fear & Greed;
10. global overnight tape;
11. 2Y yield;
12. MOVE;
13. breadth;
14. put/call;
15. credit;
16. defensive-versus-cyclical rotation.

Weights reflect how directly each axis prices equity risk:

- indexes `1.5`;
- Fed, credit, VIX `1.25`;
- yields, 2Y, global tape, breadth `1.0`;
- dollar, MOVE, commodity, geopolitics, put/call `0.75`;
- inflation, sentiment, rotation `0.5`.

Correlated axes are clustered so duplicated evidence does not dominate. The state is:

- **severe risk-off:** at least three effective risk-off axes and stress `<= -4`;
- **risk-off:** at least two effective risk-off axes with non-positive stress;
- **risk-on:** at least two effective risk-on axes, stress `>= +2`, no more than one off-axis, non-negative index and VIX votes;
- otherwise **neutral**.

This regime:

- changes the Top Picks side and gross-exposure rules;
- can permit reduced-size tactical puts;
- influences entry timing and strategy;
- is recomputed in the browser from live `/api/macro-live` legs where possible;
- never turns a weak ticker thesis into a good one by itself.

### Forward scenario and sensitivity layer

`lib/scenario-engine.mjs` turns the point-in-time regime into a deterministic,
conditional risk overlay. It is built into premium `data/market-analysis.json`
by both the full bake and `scripts/regen-picks.mjs`; the hourly heatmap refresh
preserves the block when it updates the same payload.

The engine has four linked layers:

1. **Catalyst queue.** The next 30 calendar days are ranked from the existing
   macro, FOMC, earnings, and market-event calendar. Each catalyst carries its
   date or window, a `1–5` importance score, transmission channels, and a
   historical reference pattern when one is appropriate.
2. **Transition monitor.** Current levels are compared with regime and macro
   history to measure all 16 regime axes plus six leading checks: curve speed,
   VIX term structure, credit, breadth/index divergence, combined dollar and
   commodity pressure, and sentiment/positioning extremes. The output is a
   five-to-ten-session risk-off shift probability, risk-on continuation versus
   exhaustion, a fragility warning, and a gross-exposure cap.
3. **Layered scenarios.** The weekly set rotates among orderly disinflation,
   sticky inflation, growth scare, geopolitical shock, AI CapEx
   acceleration/slowdown, and a liquidity melt-up. The five most relevant
   drivers are normalized to 100% total probability. Every driver has stress,
   base, and optimistic paths with probability ranges, explicit trigger
   conditions, two possible market reactions, factor-shock ranges, transmission
   channels, and a historical reference pattern. These ranges deliberately
   avoid single-point return forecasts.
4. **Sensitivity map.** Every covered ticker receives empirical market,
   10Y/2Y-rate, dollar, and oil sensitivities where history is sufficient,
   combined with sector/business-profile growth, defensive, USD, commodity,
   AI/CapEx, geopolitical, volatility, and Event Spillover exposures. Scenario
   shocks multiplied by those sensitivities produce a conditional impact range,
   factor attribution, positive/negative leader lists, and a decision overlay
   for conviction, timing, size, and vehicle.

Top Picks consumes the decision overlay twice: the global transition cap reduces
gross exposure, while each ticker's scenario multiplier redistributes weight
away from concentrated downside. Neither layer can increase the pre-existing
regime/edge budget. The Market Analysis UI also provides an equal-weight manual
basket stress test. It does not revive or read the dormant portfolio stack, so
the product does not claim to know a member's actual portfolio.

This layer is a filter, not a forecast. Its probabilities are transparent
model-assisted weights, historical analogs are reference patterns rather than
promises of repetition, and every stock impact remains conditional on the
displayed path and trigger.

### Premarket leader/laggard conviction check

The 09:00 ET market-hours workflow freezes two equal-weight baskets from the
same curated equity universe:

- the five largest positive premarket gaps;
- the five largest negative premarket gaps.

The cohort is fixed for the session and stored in premium
`data/market-analysis.json`. It never re-ranks after the bell. Every later
hourly run, including the first post-close run, marks those same names versus
the same prior-close baseline.

The deterministic read has two independent axes:

- **leader follow-through:** at least 60% of the gainer basket must hold at
  least 65% of its premarket gap, with average gap retention of at least 65%;
- **decliner recovery:** at least 60% of the decliner basket must recover at
  least half of its premarket loss, with average loss recovery of at least 50%.

The cross-check maps to four trader states:

- leaders hold + decliners recover: **Risk-on + dip buying**;
- leaders hold + decliners stay pressured: **Selective risk-on**;
- leaders fail + decliners recover: **Dip-buying rotation**, not broad bullish
  confirmation;
- leaders fail + decliners stay pressured: **Risk-off**.

Mixed participation stays explicitly unconfirmed. Before the bell the card is
only a frozen baseline and makes no sentiment call. If either basket has fewer
than two valid Yahoo premarket quotes, no cohort is minted.

### First-hour conditional event study

The Owner Index Calendar accumulates SPY, QQQ, and IWM 30-minute session
paths in `data/index-calendar.json`. Its first-hour desk is explicitly
conditional: for a selected move threshold it reports the probability and
average return from 10:30 ET to the close, plus the full-session finish, instead
of presenting an unconditional “usually rises/falls” claim.

Every session can be filtered by opening gap, prior-close VIX, and two pieces of
pre-open context:

- **morning catalyst:** major scheduled economic releases or observed Fed
  speaker headlines timestamped no later than 10:30 ET; positive labels persist
  on the accumulated session row after `calendar.json` rolls forward;
- **regime:** trending versus range-bound, high versus low volatility, and
  risk-on versus risk-off. Trend/risk use only the prior 20 SPY closes and
  volatility uses prior-close VIX, so the same day's outcome cannot classify
  its own cohort.

The default review is the latest 40 sessions, with latest-month and 30-session
alternatives. A drift card compares the latest 40 completed sessions with the
preceding block once at least 30 prior observations exist, exposes the regime
mix, and keeps thin samples visibly provisional. Event labels accumulate from
the feature's release forward; the UI does not pretend to have a historical Fed
speaker database for older rows.

## 6. Top Picks: how a name becomes an actionable trade

Top Picks is not “the ten highest grades.” It is a narrowing funnel.

The complete Top Picks decision run executes twice per regular market day, at
11:00 and 15:30 ET. Those runs refresh the final roster, grounded research,
contract choice, churn, roster snapshot, and accuracy marks as one coherent
unit. Other full builds continue refreshing shared market data and grades but
carry the last Top Picks snapshot forward byte-for-byte.

### Gate 1: sufficient directional evidence

A normal candidate needs `abs(grade) >= 4`. A tactical put can enter the candidate pool during a confirmed risk-off tape.

The historical edge governor can raise the minimum bar:

- default `4`;
- `6` when the resolved option edge is `<= -8%`;
- `7` when it is `<= -15%`;
- requires at least 12 resolved observations before tightening.

### Gate 2: timing and re-entry

- `avoid` timing is excluded.
- Existing open positions suppress a duplicate entry in the same ticker.
- Hard entry vetoes bind: imminent event, wrong side of SMA20, confirmed falling knife/broken setup, or exhaustion confluence.

More than 15% past SMA20, RSI at least 80/at most 20, and a fast impulse are
extreme inputs, not automatic vetoes in isolation. A hard top guard requires
multiple extremes plus momentum rollover or a ≥1.8× volume climax, unless a
single reading reaches the catastrophic circuit breaker. Soft extension waits
for a reachable reset but may be overridden by the final AI grader.

### Gate 3: entry readiness

There is no second, duplicative readiness checklist. `computeEntrySignal`
translates the single timing-v2 result into Buy now or a specific event,
pullback, reclaim, reversal, or nearby-structure trigger. Its payload retains
the five component scores, prerequisite results, invalidation, target, and R:R.

### Gate 4: thesis quality

The deterministic thesis rubric is `0…8`:

- clear company/macro driver: `0…2`;
- technical/flow confirmation: `0…2`;
- multi-pillar alignment: `0…2`;
- tape fit: `-1…+1`;
- explicit invalidation: `0…1`.

Only Strong grade plus Strong thesis is classified as an actionable top pick. Strong grade with a weak thesis remains a visible grade-only watch idea. Moderate combinations can remain research ideas but do not get promoted merely to fill the list.

### Gate 5: AI final grader

At most ten deterministically ranked survivors receive the expensive final pass. The flow is:

1. a light model performs grounded web research for current evidence;
2. a full Flash model receives the entire deterministic evidence table;
3. it grades thesis strength, writes the desk narrative, and returns `buy-now` or `wait`;
4. deterministic hard vetoes still win.

The AI can:

- hold back a mechanically ready name;
- promote a soft-extended momentum entry;
- reject a superficially high score whose evidence is not coherent.

It cannot:

- bless a hard parabola;
- bypass imminent event risk;
- invent a contract;
- override diversification or liquidity gates.

Without an AI key, the system falls back to deterministic behavior rather than fabricating a verdict.

The final decision cache is intentionally narrower than the other AI caches.
Its key hashes the exact base message, every current headline, the complete
macro calendar, IV momentum, grounded-research query, models, prompt, and
schema. Reuse expires after 20 minutes, shorter than the 09:30-to-10:00 opening
gap, so every scheduled build refreshes live research and the full-Flash
grade/entry decision; only an exact duplicate or immediate retry can reuse.

### Gate 6: contract eligibility

The preferred contract is near the money:

- DTE `30–90`, ideal `45–75`;
- absolute delta `0.45–0.65`, target about `0.55`;
- bid/ask spread at most 12%, with a tighter 10% roster preference;
- open interest at least 100, with a 50-contract lenient fallback;
- IV below 200%;
- no crossed market;
- premium no more than the greater of `$35/share` or `12%` of spot;
- quality score at least `0.45`.

A missing liquid wing can force a structure fallback. A missing tradeable contract keeps the ticker off the actionable roster.

### Gate 7: structure selection

- weak thesis: no strategy, except a tactical risk-off put gets defined risk;
- elevated IV (`z >= 1.5` or own-history percentile `>=60`) and no event: credit vertical;
- Strong grade + Strong thesis + reasonable IV + no event: outright long call/put;
- otherwise: debit vertical.

Earnings or macro risk inside 21 days forces defined risk. A debit spread must offer at least `1:1` reward/risk. Credit is targeted near one-third of spread width. If a clean wing is unavailable, the engine falls down a defined fallback ladder and discloses it.

### Gate 8: portfolio construction

- up to 10 actionable picks;
- up to 6 watch ideas;
- no more than 3 per sector;
- no more than 5 in one common factor;
- side caps prevent an accidentally one-way book;
- if at least 60% of a factor group is below SMA20 and median five-day return is `<= -3%`, new calls in that factor are suppressed unless the setup is unusually strong and ready.

The roster is allowed to be empty. Deterministic conviction controls ordering; the AI score is explanatory, not a hidden ranking override.

### Entry, sizing, exits

The entry card states Buy now or the exact price trigger. The plan uses the underlying for structural levels and the option for P&L controls.

- Long/debit take-profit: `+20%`.
- Long/debit stop: `-50%`.
- Credit take-profit: keep 50% of received credit.
- Credit stop: lose 50% of received credit, roughly a 1.5× buyback.
- Underlying invalidation: deeper of structural support/resistance and about `2.5 ATR`, clamped to 5–12%.
- No automatic time stop and no forced pre-earnings exit.
- Non-credit positions can trigger a theta stop after at least four days when daily decay reaches about 2.5% of premium.

Sizing is risk-budget based, conviction tilted, reduced when the book is small or the market/edge governor is poor, and capped by modeled maximum loss.

## 7. Track Record

Only actionable Top Picks are enrolled.

- Maximum 20 open model positions.
- Option value is marked with Black–Scholes from the underlying path and original IV assumptions.
- Vertical spreads are marked leg by leg.
- Credit and debit structures use different P&L bases.
- Dropped market data must miss three consecutive times before a position is treated as unavailable.
- Splits and corporate actions are guarded rather than interpreted as instant wins/losses.
- Permanently unmarkable observations can be voided.
- The record never resets weekly.

The scorecard reports win rate, expectancy, option P&L, return on risk, favorable/adverse excursion, and slices by grade, side, sector, strategy, market regime, and modeled probability of profit. It also includes diagnostics such as stop share, giveback, thesis-break frequency, side imbalance, and Monte Carlo paths.

The dollar scorecard and equity curve can replay either a fixed `$10,000` per trade or a Market Analysis-sized book. Market-sized entries begin defensively at `$5,000`, return to `$10,000` only after three consecutive `risk-on` sessions, and fall back to `$5,000` after two consecutive `risk-off`/`severe-risk-off` sessions; `neutral` and missing history are always half-size. The size is frozen from the regime snapshot available on the entry date. The portfolio Simulator exposes the same hysteresis as a separate **Market environment** run mode, scaling its conviction-based risk budget to 50% or 100% while leaving the other portfolio gates unchanged.

The point is not just to display wins. The diagnostics are intended to answer whether losses came from direction, entry, structure, sizing, or exits and to tighten the engine only after enough resolved evidence exists.

## 8. Stock Picks and the DCA dial

Stock Picks is a shares-only quality-dip screen. It does not reuse option liquidity or long-premium rules.

### Quality gate

A company must have:

- positive margin or free cash flow;
- manageable debt: cash at least debt or debt/equity no more than 2×;
- no margin erosion worse than three percentage points;
- revenue growth better than `-2%` YoY.

Missing optional checks are skipped, but profitability is required. ETFs are excluded.

### Dip evidence

At least two:

- RSI below 35;
- at least 4% below SMA50;
- at least 15% below the 52-week high;
- 20-day price z-score `<= -2`;
- ten-day performance at least four points worse than SPY.

The surviving quality companies are cross-sectionally ranked by the average z-score of the available dip measures. This is one of the few intentionally relative ranks on the site. Up to eight are shown.

The Stock Picks renderer presents that roster as a two-tier decision tree: clean names in **Buy zone** first, flagged names in **Watchlist** second. Inside each tier it groups **Start small**, **Wait for turn**, then **Research first**; only candidates with the same zone and execution posture compete on the dip score, sorted from highest statistical stretch to lowest. This prevents a deeper but flagged selloff from outranking a clean actionable setup.

### Trap warnings

These warn but do not automatically exclude:

- earnings just occurred or are within ten days;
- heavy down-volume day;
- four or more red sessions;
- net analyst cuts;
- bearish news.

No traps means a cleaner buy-zone candidate. Traps change the action to Research first.

### Execution state

- clean plus price above prior close and RSI above its five-day reading: Start small;
- otherwise: Wait for turn;
- trigger: current price or reclaim of the lower of SMA20 and the five-day high;
- review/invalidation: nearest 20-day support or 52-week low;
- target: SMA50 or nearby resistance;
- payoff and checklist completeness are shown.

### VOO/QQQ daily DCA dial

The Owner Stock Picks page publishes one uniform internal multiplier. Owner Lab can apply that multiplier to the owner's private daily base amount; the base is kept in local storage and never changes the standardized signal. The dial adds a `0…14` dip score:

- below SMA20 `+1`;
- below SMA50 `+1`;
- below SMA200 `+2`;
- drawdown from 52-week high of 3/5/10/15/20%: `+1…+5`;
- RSI below 40 `+1`, below 30 `+2`;
- z-score `<= -1.5` `+1`, `<= -2` `+2`;
- daily move `<= -1.5%` `+1`.

Multipliers:

- score 0: `1×`;
- 2: `1.5×`;
- 5: `2×`;
- 8: `3×`;
- 12: `4×`.

The 4× tier additionally requires price below SMA200 and at least 15% below the high; otherwise it is capped at 3×. The call history is retained for 120 days and carried forward on stale builds.

## 9. Sector Rotation

Sector Rotation is not the Heatmap's sector-streak feature and it is not a sector-ETF allocator. It is a **long-only peer-washout rebound model**: find a genuine group selloff, prove that an individual quality company participated for group reasons rather than company damage, then wait for a controlled recovery entry.

### Universe and episode

The engine uses explicit peer baskets such as semiconductors, mega-tech, software/cloud, retail, consumer cyclicals, banks/capital markets, payments/fintech, healthcare, industrials/logistics, power/data-center, space, and China tech. Some have benchmark ETFs such as SMH, QQQ, or KWEB.

Core parameters:

- 45-session episode lookback;
- at least 80 bars per stock;
- at least four members per group;
- group drawdown at most `-4%`;
- at least 60% of members down;
- group underperforms SPY by at least two points or trails the best group by at least four points;
- the trough must be no more than seven sessions old.

### Group phases

- **Washed out:** group-level decline qualifies.
- **First thrust:** at least 3% bounce and at least 70% breadth up.
- **Confirmed:** at least three sessions from trough, two of the last three days with at least 55% breadth up, basket above SMA10, and positive rebound relative to SPY.
- **Late:** confirmation is old/extended—generally age at least five sessions, bounce at least 15%, or at least 8% above SMA20.

First thrust is deliberately not an entry. It is evidence that selling may have exhausted, followed by a wait-for-pullback state.

### Separating peer washout from company damage

Each stock needs its own drawdown of at least 8%. The model constructs a leave-one-out peer basket and estimates the stock's beta/correlation to it.

```text
residual = stock return - clamp(beta, 0.25, 3.0) × peer return
```

The candidate is blocked when the residual loss is worse than the greater of four percentage points or 1.25 ATR. Low correlation below 0.10 plus a residual worse than two points is also a warning/block. This prevents a company-specific collapse from masquerading as rotation.

### Frozen robust mean

The rebound target is not a moving average that falls with price.

1. Use 30–60 completed observations ending before the episode peak.
2. Fit a Theil–Sen line to log prices.
3. Use the median residual and `1.4826 × MAD` for robust dispersion.
4. Floor sigma by the larger of 1% or half a pre-peak ATR.
5. Freeze the trend mean at the peak date and cap it at the observed episode peak.

The system then measures:

- trough z-score;
- current z-score;
- log-price recovery progress from trough toward the frozen mean.

The trough generally must be at least `1.5σ` below mean; `2.5σ` is a strong dislocation. Intraday lows are used for invalidation, not to rewrite the statistical mean.

### Damage and quality guards

Block or downgrade for:

- no profitability;
- excessive debt;
- eroding margins or revenue;
- weak/declining fundamental trajectory;
- fresh bad company news, lowered guidance, earnings miss, regulatory damage, lost contract, or dilutive financing;
- net analyst downgrades;
- recent earnings fall;
- earnings inside seven days;
- negative pre-drop trend;
- idiosyncratic residual loss;
- insufficient z-score dislocation;
- late/chased recovery.

Stale or ambiguous evidence warns rather than pretending to be current. A warning can demote Confirmed back to First thrust.

### Candidate score

Maximum 100:

- quality: 25;
- group rotation: 25;
- prior trend: 15;
- standardized dislocation: 15;
- mean-reversion evidence: 20.

Minimum candidate score is 55; high confidence starts at 70. The main board holds up to 18 candidates plus 14 near misses.

### Stock phases and execution

An individual first thrust needs roughly:

- bounce of at least the greater of 3% or 0.75 ATR;
- positive one-day move;
- group breadth at least 70%;
- recovery progress at least 15%.

Confirmation needs:

- confirmed group;
- age at least three sessions;
- progress 25–80%;
- current z-score still below `-0.25`;
- remaining mean distance greater than 2% or half an ATR;
- price above SMA10;
- higher closes or improving RSI at least 45.

Late/exhausted conditions include recovery at least 80%, current z near the mean, 15% three-day gain, RSI at least 70 plus large SMA20 extension, or a very large bounce.

The plan is expressed on the underlying:

- trigger: pivot/SMA10 reclaim;
- entry zone: approximately `±0.25 ATR` around the trigger, kept above the stop;
- invalidation: trough minus `0.25 ATR`;
- target: the earlier/lower of the frozen mean and nearest resistance, never above the episode peak.

`Ready` requires all of:

- Confirmed phase;
- fresh live price inside the entry zone;
- live reward/risk at least `1.5`.

Below `1.25` is a payoff-thin Pass. Above the zone is Wait for pullback; below it is Wait for reclaim. This is why a visually strong rebound can still be an honest wait.

### Accountability ledger

A displayed candidate is only an observation. An official model entry requires:

- plan state `ready`;
- regular-session quote;
- quote age no more than ten minutes;
- price inside the frozen entry zone;
- reward/risk at least `1.5`.

The ledger freezes entry, stop, target, group, model version, and signal key. It closes on target, stop, or 20-session timeout and tracks MFE, MAE, R-multiple, and SPY alpha. If target and stop both occur in the same daily bar, ordering is treated as ambiguous rather than cherry-picked.

After at least 12 resolved trades, the Entry Lab compares lower-, middle-, and upper-zone entries and early adverse/favorable excursion. Until then, entry rules remain frozen.

## 10. Leveraged ETFs

This screen takes the common ticker grades and maps them to a hand-curated registry of verified listed leveraged products.

### Signal construction

- IV cost is stripped because the vehicle is an ETF, not a purchased option.
- Single-stock underlying normally needs absolute score at least 4; a watch row can be within 1.5 points.
- A group proxy needs average score at least 2.5, at least three members, and 60% directional agreement; thin groups need score 4.
- Strong begins at 7.
- Avoid timing blocks the idea.
- Up to eight ideas ship.

The bullish/bearish grade selects the matching verified bull or inverse fund. If the desired direction has no listed product, the site emits an honest watch row instead of substituting something misleading.

### Daily-reset risk

Approximate monthly volatility drag:

```text
0.5 × k × (k - 1) × daily_variance × 21 × 100
```

The screen also estimates annual fee plus financing carry. Levered long funds include roughly `(k - 1) × risk-free rate`; inverse products show fee-only carry because the financing economics are not represented symmetrically.

Hold-horizon guidance:

- intraday when the underlying is choppy and volatile;
- weeks when modeled monthly drag is below 1%;
- otherwise days.

A 60-day simulation compounds the underlying's daily path at the stated leverage, then subtracts fees/financing. This exposes path dependence instead of multiplying the final underlying return by 2× or 3×.

Entry, stop, and target remain on the underlying. Approximate ETF moves are shown as underlying percentage move times absolute leverage for same-day planning, explicitly not as a multi-day guarantee.

The record opens ideas with a real ETF quote and always records a long position in the named bull/bear fund. Ranked-out ideas remain open; only a broken signal, direction flip, vehicle loss, or timing failure closes them.

## 11. Brief and News

### Brief

One current brief is minted at most once per ET hour:

- morning at the dedicated 08:30 ET Brief-only dispatch, using the last
  verified bake plus fresh overnight markets, headlines, Fear & Greed, and
  released macro data;
- intraday during the session;
- afternoon/closing near the close.

The pre-market route does not fetch the full ticker universe or publish any
other bake-owned payload. The 09:30 ET dispatch remains the first full build.

The deterministic packet supplied to the AI includes:

- Fear & Greed and its change;
- 2Y/10Y/30Y, curve slope, DXY, and VIX;
- significant foreign sovereign-rate moves;
- top picks and roster churn;
- today's or upcoming earnings/macro/FOMC events;
- recent market-wide headlines;
- released macro actual-versus-consensus reads;
- SPY/QQQ GEX;
- unusual-flow leaders;
- actionable Trending-IV names;
- a whole-universe event/watchlist screen;
- historical-playbook analogs only when eligible cues exist.

The model writes a headline, short summary, up to six highlights, and an optional historical analog. It is prohibited from inventing an analog when no matching playbook cue was provided. Failed generation carries the last good same-day brief.

The ticker watchlist ranks concrete events: fresh earnings/guidance, unusual flow, strong moves/volume, analyst or capital events, 52-week extremes, and picks-bar churn. It is not simply the Top Picks roster.

### News

The news desk is deterministic triage over public stock and macro headlines:

- category base scores put earnings/M&A, regulatory/clinical, risk, financing, inflation, Fed/rates, and labor above routine coverage;
- recency contributes up to 20 points;
- source quality contributes up to 10;
- multiple independent sources contribute up to 8;
- numbers add specificity;
- rumors, clickbait, and stale/undated items are penalized;
- observed market reaction can add weight.

High impact begins at 70; Notable at 45. Undated items cannot be labeled High. The macro lane classifies Fed/rates, inflation, labor, growth, policy/trade, and energy/geopolitics separately from generic market coverage. It also imports the calendar's published actual-versus-consensus releases as date-labeled ECON DATA rows and retains each row's BLS, FRED, ISM, or ForexFactory source attribution. Their hotter/cooler/stronger/weaker surprise read is shown as evidence while the directional chip remains Unclear, because one print is not universally bullish or bearish for risk assets.

The feed keeps seven days, caps at 500 rows, validates links, and carries prior valid coverage through temporary source failures. The UI can isolate Macro, covered stocks, or general market pulse without creating a separate news surface.

## 12. Event workflows

### Calendar

The unified calendar covers the rest of the year with at least a 30-day useful horizon:

- earnings dates and AM/PM/TBD sessions;
- ticker-specific catalysts;
- CPI, PPI, payrolls, unemployment, JOLTS, and other macro releases;
- FOMC schedule;
- EFFR and Fed Funds futures probabilities;
- prediction-market context from Kalshi/Polymarket when available;
- actual, consensus, previous, and forecast fields;
- report history.

BLS is primary for major labor/inflation series, with FRED fallback. The FOMC schedule has a hardcoded rolling baseline merged with a live Fed scrape. FedWatch-style probabilities are inferred from ZQ Fed Funds futures and accumulated meeting by meeting in the UI. Source failures carry the last good section and mark it stale.

### Earnings Tracker

- accumulates event history;
- sources dates/results from Yahoo and Nasdaq;
- measures AM reports from prior close to same-day close;
- measures PM/TBD reports from report-day close to next close;
- tracks gap, day, week-one, pre-10/pre-15-session drift, implied move, and realized move;
- labels beat-but-down and miss-but-up;
- tracks guidance up/inline/down;
- shows upcoming events inside 21 days;
- can generate one season-level AI summary after at least five reports; the
  summary is reused only while the complete evidence prompt and model are
  unchanged, and changed evidence ships without old prose if AI is unavailable.

The reaction direction is the market's actual response, not an assumption that a beat must be bullish.

The tab and `data/earnings-tracker.json` are public and require no session.

### Earnings Calls

Motley Fool is the primary transcript source and MarketBeat the fallback. The system discovers new transcripts, generates a structured full-transcript brief, and writes both an index and per-ticker detail files.

The decision queue prioritizes:

- changed outlook;
- raised/lowered guidance;
- management caution;
- misses;
- analyst skepticism or probing Q&A.

Source links remain visible because transcript discovery and AI extraction can fail. Earnings Calls is research context, not a direct entry model.

### Event Spillover

This is analytical only. It estimates same-sector earnings read-through from a reporting **driver** to a **follower**.

Event windows:

- AM: prior close to event-day close;
- PM/TBD: event-day close to next close.

Pairs stay within industry groups, with special mappings such as NVDA/semiconductors. Two engines are compared:

1. **ETF bridge:** follower-to-sector beta × sector-to-driver beta, estimated over roughly 63–126 sessions with Newey–West errors.
2. **Direct event beta:** historical follower-versus-driver event reactions, shrunk toward the pooled sector beta, with lagged and SPY-residual variants.

The research edge is historical aligned spillover minus the follower's currently priced move. Reliability gates include:

- R² generally above 0.25–0.30;
- Newey–West `p < 0.05`;
- direction consistency at least 60%;
- false-discovery or split-sample checks.

FOMC/NFP windows are excluded from estimation. A follower's own earnings event is excluded. CPI/PPI/shared-print contamination is flagged. The screen stores forecasts and later realized results, hit rate, and MAE, but it does not provide a direction, contract, or size recommendation.

### Index Calendar

The index calendar accumulates up to roughly 800 sessions for SPY, QQQ, IWM, SMH, DIA, VXUS, TLT, GLD, and VIX. It presents month/day return patterns and historical context. It is descriptive seasonality, not a causal forecast.

## 13. Flow and positioning

### Heatmap

- tile size is market capitalization;
- color is current change or time-adjusted relative volume;
- breadth summarizes advancing/declining participation;
- sector streak requires at least 70% of members moving in one direction for at least two days;
- hourly refresh replaces price/change and market cap from a batched quote call;
- after the close, one AI sector recap may be generated once per ET day.

Heatmap sector streak is a breadth visualization. It is not the Sector Rotation model.

### Unusual Flow

The scanner checks the front two expirations and contracts roughly 5–50% out of the money.

Baseline flag:

- volume greater than open interest;
- volume increase versus the prior hourly snapshot;
- increase at least 4,000 for DTE up to 14, otherwise 2,000.

The first scan of a day cannot produce an hourly delta because there is no prior snapshot. Last-trade location is labeled at ask, above mid, mid, below mid, or bid. Same-day observations accumulate, and a seven-day repeat log marks recurring contracts after at least two appearances. Each explanation is deterministic prose rebuilt from that observation's current volume, open interest, hourly delta, tape, DTE, moneyness, IV, and premium. It makes no unsupported catalyst or direction claim and has no AI cost or stale contract-note cache.

The UI's decision queue is stricter than raw detection. It favors aggressive ask/above-mid prints, usually at least $100K premium, or $50K when repeated, or $25K across multiple strikes, with spread at most 35% and extra skepticism for penny-priced/far-OTM contracts. Stale or closed-session flow remains evidence, not an executable order.

### Volume

Expected intraday volume follows a U-shaped session curve:

```text
25% / 14% / 11% / 11% / 14% / 25%
```

- hourly watch: at least 1.2× expected volume;
- stronger flag: at least 1.5×;
- end of day: at least 1.3× 20-day average;
- price-move floor: about 0.5 ATR, bounded around 0.6–2%;
- support/resistance proximity and break strength are ATR-scaled;
- strong breaks score at least 1.5, watch 0.8–1.5, below 0.8 is treated as a likely fakeout.

The scanner adjusts for early closes.

### Gamma Exposure

Per contract:

```text
GEX proxy = gamma × open interest × 100 × spot² × 1%
```

Calls are assumed positive dealer gamma and puts negative. This is a convention, not known dealer inventory. Net GEX is swept from 80% to 120% of spot over 80 steps; the closest zero crossing is the gamma-flip estimate. The largest positive/negative strike concentrations become walls.

### Near-term OI tracker

Twice daily, the tracker scans the front two expirations and a strike band within about ±60% of spot, retaining the top 12 OI strikes.

Large OI begins around 1,000 contracts; daily changes are highlighted around +30%/+100%.

Gamma-squeeze score `0…5`, one point each:

1. concentrated call OI within 10% OTM, at least 1.5× average and at least 1,000;
2. call/put OI ratio at least 2;
3. call-wall volume/OI at least 1.5;
4. overhead call wall within 7.5%;
5. aggressive unusual call flow within 3% of that wall and same expiry.

Score 4 or 5 is a setup flag, not an entry.

### Trending IV

Requires at least 20 daily ATM-near-30D samples. It compares current IV with the ticker's own history using both classical z-score and robust MAD z-score; when they agree, the more conservative magnitude is used. Histories below 60 samples face stricter provisional thresholds.

```text
score =
  1.6 × clamp(z, -1, 3)
  + clamp(5d_change / 10, -1.25, 2)
  + clamp(20d_change / 25, -1, 1.5)
  + 0.15 × min(rising_streak, 4)
```

Tiers:

- **Surging:** score `>=4.5`, z `>=1.5`, relative lift `>=15%`, percentile `>=90`, positive five-day change.
- **Trending:** score `>=3`, z `>=0.75`, relative lift `>=8%`, percentile `>=75`, positive trend.
- **Building:** score `>=2`, non-negative z, relative lift `>=3%`, percentile `>=60`, positive 5d and 20d changes.

“Elevated” is a separate state from “trending”: roughly z `>=1`, relative lift `>=8%`, percentile `>=75`. Standout tags identify extremes, falling IV, rapid ramps, unexplained ramps without nearby earnings, and five-day-or-longer streaks.

### Streaks

Streaks use a ticker-specific daily noise floor derived from median absolute movement and bounded near `0.08–0.35%`. Small counter-days do not automatically reset a meaningful run. A streak only snaps after a material reversal, and the UI emphasizes runs of at least three days. The point is to distinguish persistent order flow from a sequence of statistically meaningless tiny closes.

### Moving-average crossover tracker

The full bake writes public `data/ma-tracker.json` from the same confirmed daily
price series used by the ticker technicals. ETFs are excluded. The payload
contains every tracked stock's 20/50/100/200-day SMA levels so the browser can
re-evaluate the 5% band against regular-session `/api/quotes` while the tab is
open.

Each stock/average pair inside the band receives a capped 0–100 priority score:

- proximity to the average: up to 50 points;
- contraction of the gap since the prior confirmed close: up to 25;
- 1-day and 5-day movement toward the level: up to 20;
- relative-volume confirmation: up to 5;
- another monitored average within 1% of the same level: up to 5.

`Likely` requires a score of at least 70, a contracting gap and aligned
five-session momentum. `Building` requires at least 55 and a contracting gap;
everything else remains `Watch`. These labels rank approach evidence and are
not calibrated crossing probabilities. The desk separates cross-above and
cross-below queues, shows estimated sessions at the recent gap-closing rate
when one exists, and requires close/volume confirmation before use.

## 14. Macro and capital-cycle research

### Overnight Markets

The overnight board joins futures, Asia/Europe, rates, FX, commodities, and risk assets. It computes up to 150 overlapping daily-return observations for correlation and beta. A rough US implication is:

```text
peer move × historical beta
```

That is a sensitivity estimate, not a forecast. Foreign-market timing and lag are disclosed.

### Fear & Greed

The site presents CNN's seven equally weighted components on a 0–100 scale with history and prior-close comparison. It acts as a confirming sentiment axis in Market Analysis. It is not treated as a causal buy/sell signal.

### Bonds & USD

The desk combines:

- 2Y, 10Y, and 30Y Treasury yields;
- 2s10s curve;
- DXY;
- VIX/MOVE and credit where available;
- CPI trend;
- unemployment and Sahm context;
- live request-time macro overlays.

The interpretations are deterministic: rates, curve, dollar, and labor/inflation are mapped to equity, international, duration, and credit implications with notable-move bands.

### Alt Data

This free navigation section groups nontraditional demand, participation, and semiconductor-cycle datasets while keeping each as its own directly linkable page.

#### AI CapEx

Tracked companies: MSFT, GOOGL, AMZN, META, ORCL, TSM, NVDA, MU, AAPL, TSLA.

Reported data comes from SEC company-concept cash-flow facts. US filers use
`us-gaap` concepts; TSMC uses its `ifrs-full` PP&E-purchase and revenue concepts:

- full fiscal years;
- YoY change;
- trailing-12-month run rate;
- CapEx as a share of revenue;
- aggregate spend and concentration.

TTM is either a true reported trailing window or:

```text
prior FY + current YTD - prior-year comparable YTD
```

Management's current full-year guidance is a separate manually maintained primary-source layer because company definitions differ. Guidance is never added to audited reported CapEx.

Decision posture:

- **accelerating:** CapEx growth outruns revenue by at least about ten points and the run rate is not falling;
- **cooling:** reported growth is negative or run rate is more than 5% below latest FY;
- otherwise **elevated/selective**.

The trade interpretation is two-sided: more spending may support GPUs, networking, power, and data centers while harming spender free cash flow or margins. Confirmation requires supplier backlog/guidance and relative strength, not aggregate spending alone.

#### Search Interest

`scripts/refresh-search-interest.mjs` runs Friday at 11:30 ET and writes
`data/search-interest.json`. Coverage is theme-only: no individual stock
tickers are collected. The curated set includes AI labs and assistants
(OpenAI, Anthropic, Claude, DeepSeek, Kimi), AI agents and adoption, compute
infrastructure, autonomy and robotics, energy, macro, geopolitics, healthcare,
political figures, and other market-relevant themes.

The job uses SerpApi's Google Trends endpoint (`SERPAPI_KEY`) because Google's
official programmatic API is still alpha-only. Four theme queries share one
comparison request with a fifth `stock market` anchor. This makes the displayed
relative-interest ratio comparable across batches while keeping the Google
Trends 0-100 time series intact for each query. It stores:

- trailing 90-day interest history;
- current 7-day average relative to the shared anchor;
- current 7-day average versus the preceding seven days;
- current 30-day average versus the preceding 30 days;
- top associated queries;
- rising associated queries and explicit Breakout flags.

Google's Breakout label means growth above 5,000%. Search attention is a
participation/discovery signal, not absolute search volume, sentiment, causality,
or a directional trade call. The UI asks for price, volume, catalyst, and
fundamental confirmation in the assets exposed to each theme.

#### RAM Prices

Two independent layers:

- wholesale DRAM spot from TrendForce, with DRAMeXchange fallback;
- US retail DDR5-kit pricing from WhereIsMyRam.

Wholesale history is accumulated once each Friday; retail arrives with deeper source history. The retail composite is the median across at least three categories so one scarce kit cannot dominate.

Cycle states:

- confirmed tightening when 30-day wholesale is at least +5%, retail median at least +3%, and breadth supports it;
- upstream lead when wholesale is at least +5% but retail has not confirmed;
- confirmed easing when wholesale is at most -5% and retail at most -3%;
- otherwise mixed.

The equity lens is again two-sided: rising memory can benefit suppliers but hurt system builders; falling prices can relieve buyer costs but pressure supplier pricing.

#### GPU Cloud Prices

The Friday 11:30 ET weekly Alt Data workflow collects four provider-published public surfaces:

- Vast.ai verified rentable marketplace offers in interruptible-bid and on-demand lanes;
- CoreWeave's public whole-instance spot and on-demand table;
- Runpod Community and Secure Cloud public rental rates;
- Lambda public on-demand per-GPU rates.

Every quote is normalized to USD per GPU-hour while preserving provider, market
type, whole-instance price, GPU count, VRAM, source link, and marketplace offer
range/count. Vast rows use the median and full range of verified rentable offers
with at least 98% reliability so one unusually cheap host does not become the
headline price.

`data/accelerator-prices.json` accumulates one weekly point per
provider/model/market series. Each provider degrades independently: a failed
page carries only that provider's last-good rows as stale and does not append a
new history point. The UI compares spot and on-demand lanes, plots selectable
model histories, and leads with H100 when available.

The price read is a conditional capacity/utilization overlay. A higher rental
rate can reflect scarce capacity, but posted price does not prove availability
or chip demand; a lower rate can reflect supply growth, hardware-mix changes,
competition, or softer utilization. Confirm with provider guidance, backlog,
availability, and equity price action.

#### Central-bank Gold

The full bake writes `data/central-bank-gold.json` from two World Gold Council
public chart surfaces:

- quarterly global net purchases from Gold Demand Trends (Metals Focus and WGC);
- quarterly official holdings compiled from IMF IFS, central banks, and WGC.

These are separate measures. Global demand is estimated, can include activity
not yet publicly disclosed, and is revised. Country holdings are reported data
with country-specific publication lags. Summed country changes therefore do not
need to equal the global demand estimate.

For every reporting country the payload keeps latest holdings in tonnes, gold
as a percentage of total reserves, the actual country data date, three-month
and twelve-month changes in both tonnes and percent, and six years of quarterly
history. The UI adds the global demand history, trailing-four-quarter total,
buyer/seller leaderboards, a country history selector, and a searchable/sortable
all-country table. Holdings and demand sources carry last-good independently;
source failures are disclosed and never silently presented as fresh.

### Commodities

Eleven trackers cover cocoa, cotton, coffee, sugar, palm oil, lumber, potash, lithium, container freight, Baltic Dry, and used vehicles. Reliable base series come from Yahoo futures/ETF proxies or FRED. Bot-wall/native series may add best-effort overlays.

Decision horizons:

- 30 days for market series;
- month over month for monthly series.

Stale observations remain visible but are excluded from the ranked decision desk. Each sleeve is summarized by its median move and strongest current driver. Rising softs are a buyer-margin warning; industrial/freight rises can instead indicate demand. The related equities must confirm through margins, guidance, volume, or relative strength.

### Capital Raises

A deterministic headline classifier identifies:

- common-equity issuance / secondaries / ATM programs;
- convertibles;
- straight debt/notes;
- buybacks.

The headline supplies timeliness and disclosed transaction size; recent SEC facts provide balance-sheet context. Only issuer-explicit transactions enter the verified risk totals. Ambiguous ticker associations, insider sales, and generic market commentary remain in a review bucket.

Trade posture prioritizes dilution first, then debt/refinancing, then buyback support. A buyback authorization is not treated as completed repurchases.

### IPOs & Credit

The composite combines:

- current and prior IPO quarters plus upcoming calendar;
- quarter run-rate and SPAC share;
- SEC market-wide filing counts;
- SIFMA investment-grade/high-yield bond issuance;
- tracked-universe financing events;
- revolving consumer credit;
- commercial-bank deposits;
- NY Fed household-debt context.

The funding window is **Open** only when debt participation is broad, the IPO pace/composition is healthy, and bank deposits are stable. It becomes **Tightening** when bond sales fall more than about 10%, equity participation is weak, and deposits contract more than 0.5%. An incomplete or older-than-72-hour composite is Reference only.

## 15. Narratives and 13F

### Narratives

The narrative engine receives validated ticker headlines, market-wide headlines, macro release reads, and ticker/fundamental context. It builds:

- sector and industry thesis;
- bull/base/bear framing;
- lifecycle: building, active, fading, and a six-stage arc;
- fundamentals-versus-hype assessment;
- confirmation/watch/invalidation;
- linked long/short beneficiaries;
- conflict flags and exact validated sources.

Ticker symbols, industries, and links are sanitized against the supplied universe/source pool. The AI cannot cite a source it was not given. Sector stance and strength are deterministic two-level averages of the industry narrative grades rather than a free-form model score. Consecutive-day lifecycle and recently ended narratives are retained for 90 days.

After extraction, a deterministic adversarial overlay prevents a dominant bullish theme from remaining clean when the supplied evidence turns against it. Explicit rate-hike, persistent-inflation, or AI-capex-friction language must come from a named high-influence source (Citadel Securities, a listed major-bank strategy desk, a key Fed speaker, or an official inflation release). Current-only unusual flow, confirmed volume/S&amp;R breaks, front-expiry OI/gamma crowding, and current FINRA short-interest changes receive higher lifecycle weight when their direction conflicts with a linked long/short role; quarantined scanner rows remain neutral.

Linked earnings are importance-weighted checkpoints inside the same Watch/conflict/lifecycle model. A core imminent print forces Watch. Recent reported outcomes use validated EPS surprise plus official earnings-call guidance only: weighted confirmation can move an early story toward Validation and lower the hype score; a keystone hard miss plus guidance cut forces Risk Rising; only critical-mass failure can collapse the broad story, so one peripheral miss cannot. Validated forced-liquidation or violent long/short reversal evidence raises hype/unwind risk and carries a sticky conflict for several days through the 90-day history. This overlay never changes narrative sentiment, strength, ticker membership, or the deterministic sector-grade score.

The expensive cross-universe extraction may reuse a recent result for up to six
hours only when a SHA-256 signature of the exact model, system prompt, validated
ticker/news context, macro headlines, and published macro reads is unchanged.
Any evidence change invalidates immediately, and an explicitly stale fallback is
never eligible for reuse. Lifespan/history annotations are still recomputed on
every bake.

Display fallback and decision input are separate contracts. Stale narratives
may remain on the Narratives tab with a visible stale label, but they are removed
before regime, grade, Top Picks, scenario, and 13F-theme calculations. The same
quarantine applies to stale Fear & Greed, correlations, Event Spillover, and
social sentiment, FINRA short-interest settlements older than 45 days, and
out-of-cadence unusual/volume/OI scans; those sources contribute a neutral/no-data
read until their owner publishes a current sample.

### 13F

The system tracks selected mid-sized institutional filers, intentionally excluding giant index-complex firms whose passive books would swamp the analysis.

For each manager:

1. fetch the latest two 13F-HR filings from SEC EDGAR;
2. parse equity holdings and exclude principal-amount debt;
3. map CUSIPs to tickers with known mappings and OpenFIGI;
4. compare shares and value quarter over quarter;
5. aggregate share-direction breadth across managers.

Share-direction breadth is more informative than dollar change because value change includes market-price movement. The data can be 45 days late and excludes shorts, cash, non-13F assets, and the manager's current-quarter activity. It is a delayed research lead, never an entry trigger.

## 16. Owner Lab

The Owner section contains Market Analysis, Top Picks, Stock Picks, Sector Rotation, Leveraged ETFs, Top Picks Track Record, Day Trading, Day Trading Track Record, and Owner Lab. Owner Lab contains the analytical Quant Lab screens plus the held-position checker and personal dollar/account-risk controls; the current paper engine and its durable ledger have their own tabs. The section's signed session is minted only for holders of the pre-existing Top Picks owner role; all other research surfaces are public.

### Regimes

- volatility: VIX, term structure, and realized volatility;
- trend: 60-day Kaufman efficiency ratio at least 0.35 or monotone thirds;
- risk: common macro state;
- earnings-heavy: at least 20% of names report inside 14 days.

Regime changes badges and ordering but never hides results.

### Screens

- **Confluence:** joins unusual flow, abnormal volume, fresh streak, and rising IV; at least two source families and generally three qualified signals, with directional lean only when all agree.
- **Sigma:** only absolute 3-sigma 20-day price or daily-return deviations ship, alongside expected-move cones; the earnings cone uses about `0.85 × straddle`.
- **Volatility risk premium:** ATM IV minus realized 30-day volatility, with z-score/percentile after at least 60 observations.
- **Pairs:** same-industry candidates, 120-day correlation at least 0.60, log-price OLS over about 252 days, Engle–Granger/ADF threshold around `-3.34`, positive hedge beta, z-score, half-life, beta drift, stability, and factor-match checks.
- **Surface:** ATM 90D minus ATM 30D term slope and 25-delta put-call skew, standardized after sufficient history and marked for earnings context.
- **Dispersion:** implied-correlation proxy from SPY IV versus a cap-weighted top-50 tracked-name IV basket; explicitly not the full S&P 500.
- **Post-earnings drift:** reactions within ten sessions after reports.

History is retained for roughly 500 days.

## 17. Ticker, contract, comparison, and strategy tools

### Grade a Ticker

The ticker page exposes every common-grade signal and the underlying price structure. It also picks and grades a candidate option.

Black–Scholes provides delta, theta, gamma, and vega using current or fallback risk-free rate.

Contract-quality rules:

- spread: very tight in absolute cents or `<=5%`; moderate through 15%; above 15% wide;
- OI below 10 is poor, below 100 light, at least 100 liquid;
- absolute delta 0.40–0.70 is balanced, 0.30–0.40 or 0.15–0.30 increasingly OTM, above 0.70 deep ITM, below 0.15 far OTM;
- daily theta below 1% of premium is good, 1–3% fair, above 3% poor;
- two or more bad mechanics means Poor; one bad means Mixed; two or more good means Good; otherwise Acceptable.

Directional “should buy?” hard failures include:

- wide live spread;
- far OTM;
- theta above 3%;
- DTE at most three;
- more than 80% extrinsic value with DTE below 14.

The directional score is framed from the contract's side: news up to `±2`, RSI/MACD/volume/fundamentals/macro `±1`, then side-adjusted, with a short-DTE penalty. A score at least 3 is strong alignment; at least 2 moderate; below zero No. In between, the answer is tentative only if mechanics are good and no major input opposes.

The page also shows:

- intrinsic/extrinsic value;
- expiry breakeven and move from spot;
- probability ITM approximated by `abs(delta)`;
- expected earnings move `spot × IV × sqrt(days/365)`;
- realized-volatility regime;
- max pain, defined as the strike minimizing aggregate OI-weighted intrinsic payout.

Live quote and chain calls can regrade the contract. Manual broker inputs work without IV, but Greeks then remain unavailable.

### Compare Companies

Up to four symbols are aligned by timestamp. Each series is rebased to the first shared close:

```text
normalized performance = close / first shared close - 1
```

This avoids comparing dollar price levels. Range changes rebuild the common interval. Tooltips are body-level/fixed so transformed chart containers do not break mobile positioning.

### Strategies

Templates:

- long call / long put;
- bull call / bear put debit spreads;
- bull put / bear call credit spreads;
- long straddle / long strangle;
- short straddle;
- iron condor;
- long call butterfly;
- call calendar.

The guidance model reads:

- tape direction from RSI, MACD, and SMA20;
- confirmed/forming chart-pattern agreement or conflict;
- IV percentile: rich at `>=65`, cheap at `<=35`;
- earnings inside ten days.

It generally recommends:

- directional defined risk when tape is clear;
- credit spreads instead of naked long premium when IV is rich;
- long volatility only when IV is cheap and the user actually has a break/catalyst thesis;
- iron condor/butterfly when direction is mixed and IV rich;
- no forced structure when neither direction nor volatility offers an edge.

The tool builds legs from the live chain, lets the user replace chain mids with actual fills, and computes combined Greeks, entry debit/credit, payoff across an underlying-price sweep, breakeven crossings, max profit/loss, unlimited-risk flags, payoff chart, and risk-budget contract cap. A template is a payoff model, not an entry signal.

### Chart-pattern detector

The build renders roughly one month of intraday price action and asks a vision-capable full Flash model to classify one of eight named classic patterns or None. It must return:

- forming or confirmed;
- confidence;
- neckline;
- confirmation;
- invalidation;
- target;
- explanation and signal.

Only confirmed patterns whose exact analyzed bar window still matches can score or enter a decision path. Forming patterns can change Strategies timing guidance while current. To hold the full-quality vision pass to roughly two reads per ticker per trading day, results are cached by AM/PM bucket plus bar-series signature. If a new bar arrives inside the same bucket, the old read is labeled `Stale context` and becomes display-only: it cannot alter the grade, Top Picks prompt, entry veto, strategy direction, or position advice. Frozen charts reuse across buckets, model/prompt/schema changes invalidate automatically, and the system retries text-only if the image call fails.

## 18. Data freshness, live behavior, and access control

### Refresh cadence

- Full build: 9:30 ET and hourly 10:00–16:00 ET on weekdays.
- Unusual flow and heatmap: hourly 9:00–16:00 ET.
- OI tracker: about 08:30 ET and 19:00 ET on weekdays.

The workflows share one concurrency group so data-generating jobs queue instead of racing.

### Live APIs

- `/api/quote`: one Yahoo quote;
- `/api/quotes`: batched quotes;
- `/api/chain`: live expirations and contracts;
- `/api/contract`: contract-specific lookup;
- `/api/macro-live`: live rate/index/cross-asset legs;
- `/api/fed-rate` and `/api/fed-futures`: current rate/futures helpers;
- `/api/watchlist`: authenticated shared Top-Picks watchlist;
- `/api/auth/*`: Discord OAuth/session;
- `/api/data/*`: tiered private-store reader.

Live polling is generally active only while the relevant tab is visible. Failures preserve baked values rather than clearing the page.

### Current tier logic

When `PRIVATE_DATA_ENABLED` is off, the deployment behaves as legacy public data. When on:

**Public:** every user-facing tab except the Owner destinations, including ticker chains, grades, briefs, narratives, flow, gamma/OI, IV, earnings, macro/alternative-data desks, live market-data proxies, and reference/legal pages.

**Owner:** Market Analysis, Top Picks, Stock Picks, Sector Rotation, Leveraged ETFs, Top Picks Track Record, Day Trading, Day Trading Track Record, Owner Lab, every payload/raw log backing those tabs (including the private exact-contract `auto-picks.json` sidecar), the shared owner watchlist, and internal cache/accounting payloads. OAuth verifies the existing `DISCORD_TOPPICKS_ROLE_ID(S)` owner role and then mints both signed compatibility claims (`tp` + `tr`) expected by the private APIs. Missing Top Picks role configuration fails closed; `DISCORD_TRACKRECORD_ROLE_ID(S)` is no longer read. Public Brief generation excludes facts from the Owner-only desks, and the response boundary strips legacy Top-Picks contract/lean fields from otherwise-public store objects.

Unauthorized Owner features are hidden rather than upsold. Owner data uses `private, no-store`; public data uses a short public edge cache.

### Private data

`data/*.json` is gitignored and hydrated from private object storage. `lib/datastore.mjs` chooses:

1. Cloudflare R2 when all four R2 credentials exist;
2. otherwise Vercel Blob.

Scheduled jobs:

1. pull the private store;
2. run their owner-specific build/scan;
3. regenerate static artifacts;
4. push only their owned data families.

The daily build owns normal bake output; the Friday weekly Alt Data workflow owns Search Interest, RAM prices, and GPU-cloud prices; unusual/OI scanners own their histories; co-owned files are regenerated deterministically; the request-time watchlist is excluded from every workflow push. This prevents one job from deleting or overwriting another job's accumulating ledger.

## 19. Where AI is and is not allowed to decide

AI is used for:

- ticker news synthesis;
- structured guidance/contract/capital-event extraction;
- narratives;
- chart-pattern vision;
- Top Picks web research and final thesis/entry judgment;
- Brief;
- earnings-season and transcript summaries;
- post-close heatmap recap.

Deterministic code controls:

- every numeric grade contribution;
- thresholds and eligibility;
- unusual-flow mechanical explanations;
- market-regime arithmetic;
- contract liquidity and payoff;
- portfolio caps;
- Sector Rotation statistics and official enrollment;
- Stock Picks quality/dip screen;
- Leveraged ETF mappings and drag math;
- flow/volume/GEX/OI detection;
- Trending-IV tiers;
- all historical record calculations;
- server access control.

Model resilience includes per-call model defaults, retry ladders, dead-model detection on 404, overload cooldown after repeated 5xx/network failures, HTTP timeouts, token budgeting, and an AI-health report. Most text work uses Flash-Lite; chart vision, transcripts, and Top Picks final judgment use full Flash. If AI fails, the site carries last-good prose or falls back to deterministic behavior rather than failing the build.

## 20. Audit findings and interpretation cautions

1. **Current code and older repository guidance can differ on tiering.** The current `OWNER_TABS` and `lib/premium-keys.mjs` are the authority. Market Analysis, Top Picks, Stock Picks, Sector Rotation, Leveraged ETFs, Top Picks Track Record, Day Trading, Day Trading Track Record, and Owner Lab require the signed session minted from the existing Top Picks owner role; all other tabs are public.
2. **One UI help string overstates the IV-cost range.** The executable grade code and canonical Top Picks document use `-2…+1`; a tooltip in the generated app source still describes a broader `-3…+1.5` idea. This is copy drift, not scoring behavior.
3. **“Sector rotation” names two different concepts.** Heatmap sector streaks measure breadth persistence. The Sector Rotation tab is the robust peer-washout rebound model.
4. **Live price does not make every derived field live.** Entry zone and quote state may update, while a baked z-score, frozen mean, or historical volatility statistic remains anchored to its named build.
5. **Options positioning is inferential.** OI does not disclose who is long or short; the GEX sign convention is a proxy.
6. **AI prose is downstream of structured evidence but still fallible.** Source links, extraction labels, and stale badges remain essential.
7. **Backtests and ledgers answer different questions.** A displayed screen can contain candidates that were never officially entered. Only the specific enrollment rules define model performance.
8. **“No trade,” “Wait,” and “Pass” are intended outputs.** They are not missing-data states unless the UI explicitly says data is stale or unavailable.

## 21. Code source map

| Logic | Primary source |
|---|---|
| Shared build, grades, Top Picks, Stock Picks, Sector Rotation, Leveraged ETFs, calendars, research payloads | `scripts/build.mjs` |
| Canonical Top Picks explanation | `docs/top-picks.md` |
| Owner Lab / Quant screens | `docs/quant-lab.md` |
| Day Trading engine and paper record | `docs/day-trading-engine.md`, `lib/day-trading-engine.mjs` |
| Event Spillover | `docs/event-spillover.md` |
| Navigation and per-tab explanatory copy | `scripts/render/html.mjs` |
| Client decisions, live overlays, contract grader, Strategies, render logic | `scripts/render/app-js.mjs` |
| Reference/legal pages | `scripts/render/docs.mjs` |
| Unusual flow and volume | `scripts/scan-unusual.mjs`, `lib/volume-flags.mjs` |
| OI tracker | `scripts/scan-oi.mjs` |
| GEX math | `lib/gex.mjs` |
| Greeks | `lib/greeks.mjs` |
| News triage | `lib/news-feed.mjs` |
| Data tiers | `lib/premium-keys.mjs` |
| Private storage | `lib/datastore.mjs`, `scripts/sync-data.mjs` |
| Sessions and OAuth | `lib/session.mjs`, `api/auth/[action].js` |
| Tiered data response | `api/data/[...path].js`, `lib/data-response.mjs`, `middleware.js` |
| Refresh cadence | `.github/workflows/daily.yml`, `search-interest.yml`, `unusual-flow.yml`, `oi-tracker.yml` |
