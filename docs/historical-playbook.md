# Historical Playbook — market patterns & analogs

A catalog of recurring market patterns and historical events the site's market
briefs draw on. The goal: when the current tape resembles one of these
patterns, the brief **pings it** — names the analog, summarizes how past
episodes played out, calls out what's different this time, and gives a
probabilistic (not predictive) read.

## How it's wired

- `scripts/build.mjs` holds the in-code registry (`HISTORICAL_PLAYBOOK`) — a
  compact recognition + typical-reaction line per pattern, distilled from this
  doc.
- `detectPlaybookCues` (also in `build.mjs`, exported for testing) runs
  deterministic screens over the same computed signals the brief already uses
  (macro legs, Fear & Greed, index/ticker 1-day moves, relative volume, the
  calendar date). Only patterns whose **cue fires** reach the AI prompt, so the
  model can't free-associate an analog the data doesn't support.
- The brief model (`AI_BRIEF_MODEL`) then judges whether the tape *genuinely*
  resembles an active pattern. If yes, it writes the optional `analog` block
  into `data/briefs.json` (`pattern` / `resemblance` / `history` /
  `differences` / `assessment` / `watch`); if no pattern truly fits — a cue
  alone is not a match — the field is omitted and the brief skips it.
- The Brief tab renders the analog as a "Historical playbook" panel, with the
  raw deterministic cues as chips underneath.

What the analog block must cover when it fires:

1. **Which event/pattern** the tape currently resembles and what matches.
2. **Historical outcomes** for the analog — typical short-term (days/weeks)
   and medium-term (1–3 month) reactions for the relevant indices / sectors /
   assets, statistical tendencies or probabilities where well documented, and
   common follow-through or reversals.
3. **"This time is different" factors** — policy responses available today vs
   historically, valuations, liquidity conditions, regime shifts, or unique
   catalysts that could change the outcome.
4. **Overall assessment** — likelihood of the core pattern repeating, implied
   directional bias, volatility outlook, potential magnitude, sector /
   asset-class implications.
5. **Risk management** — key levels or indicators to monitor for confirmation
   or invalidation. Probabilistic, not predictive; acknowledge uncertainty and
   data limitations.

---

## Geopolitical / macro shocks

### War
Sudden military conflict or escalation involving major economies/powers
(invasions, strikes on key regions).

- **Recognition:** news of troop movements, missile strikes, or declarations;
  spikes in geopolitical risk indices; sharp rises in oil/gold/affected
  commodities; initial broad risk-off sell-off; VIX surge.
- **Typical reaction:** short-term volatility and declines (uncertainty),
  followed by sector rotation (defense up; travel/energy-sensitive names hit).
  Markets often recover within months if the conflict stays contained. Compare
  VIX, oil, and equity drawdowns to past episodes (Gulf War 1990–91, Iraq
  2003, Ukraine 2022).

### Pandemics
Global or widespread infectious-disease outbreak causing lockdowns, supply
disruptions, or health fears.

- **Recognition:** WHO declarations, rising case/death counts, government
  restrictions (travel bans, quarantines), sharp drops in mobility data,
  initial panic selling across equities.
- **Typical reaction:** severe initial crash (COVID-19, March 2020: S&P −34%
  in ~5 weeks), then policy response (stimulus) drives recovery. Defensive
  sectors (healthcare, staples) outperform early.

### Oil disruptions
Sudden supply shocks from geopolitics, wars, embargoes, or natural events
affecting major producers (Middle East, Russia, etc.).

- **Recognition:** oil price spikes (>20–30% quick move), Strait of
  Hormuz / Russian-fields headlines, energy-sector volatility.
- **Typical reaction:** inflation fears and higher input costs pressure the
  broad market while energy stocks rally. Historical: 1973 embargo, 1990 Gulf
  War, 2022 Russia sanctions.

### Tariffs
Government-imposed import taxes, often escalating into trade wars.

- **Recognition:** official announcements from leaders, retaliatory responses,
  impacts concentrated in specific sectors (tech, autos, agriculture); rising
  uncertainty → USD moves, higher volatility.
- **Typical reaction:** initial sell-offs in affected multinationals / supply
  chains; possible inflation impulse. Markets can rebound on pauses/deals but
  with lingering effects (2018–19 US–China; 2025 episodes).

## Sentiment / technical patterns

### Manias (bubbles)
Rapid, unsustainable price rises driven by speculation, euphoria, and leverage
rather than fundamentals.

- **Recognition:** extreme valuations (P/E, price/sales), surging retail
  participation (search trends, social volume), explosive volume/issuance,
  FOMO narratives, compressed risk premia. Minsky stages: displacement → boom
  → euphoria → panic.
- **Typical reaction:** sharp rises followed by crashes (1999–2000 dot-com,
  2021 meme/SPAC). Spot via low expected returns vs history plus quantity
  signals (IPO waves, margin debt).

### Short squeezes
Rapid price rise forces short sellers to buy back shares, accelerating the
upside.

- **Recognition:** high short interest (>20–30% of float, ideally >50%), high
  days-to-cover (>5–10), low float, a positive catalyst; sudden volume surge +
  price acceleration from oversold levels.
- **Typical reaction:** explosive short-term gains (days–weeks), then a
  potential sharp reversal (GME/AMC Jan 2021, VW 2008). Confirm with short
  interest data, RSI, and volume.

### Bank runs
Mass withdrawals from banks/financial institutions on solvency fears, leading
to liquidity crises.

- **Recognition:** rumors/news of bank weakness, deposit outflows, widening
  credit spreads, falling bank stocks, contagion to broader financials.
- **Typical reaction:** sector crash; broader market hit if systemic (2008
  GFC, March 2023 regional banks). Watch deposit data, bond yields, VIX, and
  the policy response (backstops have historically arrested contagion fast).

## Seasonal / event-driven

### WWDC sell-the-news
Apple's Worldwide Developers Conference (usually June) with big AI/product
announcements, followed by profit-taking.

- **Recognition:** pre-event hype in AAPL and suppliers (semis, tech);
  post-keynote reversal or stall despite positive news.
- **Typical reaction:** "buy the rumor, sell the news" — run-up into the
  event, then a fade or consolidation. Common in tech-heavy markets.

### Santa Claus rally
Seasonal strength in stocks during the holiday period.

- **Recognition:** last 5 trading days of December + first 2 of January.
- **Typical reaction:** positive bias (S&P 500 avg ~+1.3%, positive ~75–80% of
  years). Stronger as year-end tax-loss selling fades. Not guaranteed — a
  *failed* Santa rally is itself a warning sign some years.

### Sell in May and go away (September weakest)
Seasonal weakness May–October, with September historically the weakest month.

- **Recognition:** calendar-based; May–Oct performance has lagged Nov–Apr
  historically.
- **Typical reaction:** summer/fall underperformance (lower volume,
  vacations); September often sees net selling pressure. A bias, not a rule.

## Historical / volatility events

### 1987 Black Monday
Extreme single-day crash (Dow −22.6% on Oct 19, 1987).

- **Recognition (analog):** preceded by a strong bull run plus rising rates /
  trade-deficit concerns; program trading / portfolio insurance amplified
  selling; triple-witching overlap. Modern tells: leverage, derivatives
  illiquidity, dealer short gamma, circuit-breaker proximity.
- **Typical reaction:** panic selling, then a quick policy response (Fed
  liquidity). Rare, but signals systemic risk; markets recovered the 1987
  losses within ~2 years.

### Triple witching
Quarterly expiration of stock options, index options, and index futures (third
Friday of Mar/Jun/Sep/Dec).

- **Recognition:** the calendar; volume often ~2× normal, volatility elevated
  especially in the final hour as positions square/roll.
- **Typical reaction:** erratic swings with **no directional bias**; larger
  impact when it overlaps index rebalances or news.

### Nasdaq −4% day (slight rebound, then continued weakness)
Major Nasdaq/NDX single-day drop, a minor next-day recovery, then further
lows.

- **Recognition:** >4% one-day Nasdaq loss; check whether that day's low is
  breached over the next ~5 sessions; combine with high VIX and tech
  concentration.
- **Typical reaction:** high probability (~90% per some studies) the crash-day
  low gets tested or breached soon — follow-through selling rather than a
  V-bottom.

### Market reactions to economic events
Scheduled releases — CPI, jobs report, FOMC, GDP.

- **Recognition:** the economic calendar; the *surprise* (actual vs consensus)
  is what moves markets, not the level.
- **Typical reaction:** volatility spike around the print; "good news is bad
  news" in rate-sensitive regimes (strong data delays cuts). Event studies
  show average post-event drifts vary by release and regime.
