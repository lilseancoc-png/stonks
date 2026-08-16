# Day Trading Engine — owner-only stock paper portfolio

**Status: live implementation.** Current feed: `data/day-trading.json`; durable
ledger: `data/day-trading-history.json`. Both are private, no-store, and require
the Owner claims. Current state and the durable record render in separate Day
Trading tabs. The scanner is `scripts/scan-day-trading.mjs`, the pure
decision/risk/accounting core is `lib/day-trading-engine.mjs`, and
`.github/workflows/day-trading.yml` runs the pass every 15 minutes during the
regular ET session. It is a stock-only simulator: no code path submits an
order, and the retired 1DTE options book is not generated or retained.

## Decision stack

The scanner supplies live underlying quotes, SPY/QQQ five-minute opening bars,
the prior index calendar, VIX/term structure, scheduled macro events, the volume
board, per-name technicals/ATR, grades and GEX. The engine scores seven auditable
components:

1. market bias;
2. the completed 9:30–10:00 ET opening-range direction;
3. recent SPY/QQQ close context;
4. dealer gamma and wall placement;
5. relative-volume and support/resistance trigger;
6. RSI/MACD/SMA technical confirmation;
7. the existing Grade as a cross-check.

The normal entry bar is 70/100. A neutral tape raises it to 82; high/crisis
volatility, scheduled-event risk and a portfolio soft-loss warning raise it
again. Missing opening-range bars score zero for that component but do not
silently extend the time gate beyond 10:00 ET. Scheduled high-impact windows
block entries; a high-impact day outside the immediate release window halves
size.

## Time and risk authority

- No entry before 10:00 ET. New entries may occur throughout the rest of the
  regular session until the mandatory 16:00 ET close flatten begins.
- Maximum eight entries per session and 25% of current reset equity in any
  position.
- Same-direction heat is capped at three positions and same-sector/same-side
  heat at two positions.
- Stock risk targets 0.4–0.8% per entry.
- Each position uses an ATR/nearby-structure stop, 1.8R target, scales half at
  +1R and trails the rest above breakeven; modeled execution uses 5 bp slippage
  and $0.005/share costs.
- Positions time out after 120 minutes even if neither price level traded.
- A forced 16:00 close or daily-stop exit still closes when the final live
  lookup is missing: it uses the last observed raw mark, or the entry reference
  when no mark was recorded, applies normal exit costs, and records
  `markFallback` for auditability.
- Daily hard stop: −5%; soft warning: −3%; profit lock: +3.5%; weekly reduction
  or pause: −13.5%. A 10% high-water drawdown temporarily halves size.

## Accounting and track record

The stock book starts at $10,000 and keeps `resetEquity` and `trueEquity`:
realized dollars hit both, but only the reset curve jumps back to $10,000 below
$2,000. The reset event is logged; the never-reset curve remains untouched for
honest drawdown measurement.

Every trade freezes its score components, size mode, entry window, invalidation,
cost-aware fill, stop/target, time exit, MFE and MAE. The tracker derives daily
P&L distribution, hard-stop frequency, win/payoff/profit factor, MAE,
opening-follow-through versus mid-day/last-hour contribution, rally versus
sell-off conditioning, full-size versus half-size results, resets, true maximum
drawdown, recovery time and first-half versus later-half stability.

Version 2 of the history schema removes `portfolios.options` and the related
session aggregates during normalization. The stock ledger remains intact.

## Verification

```bash
npm run test:day-trading
npm run verify:freshness
node scripts/regen-static.mjs
```

The workflow verifies both files were written inside the current run before
uploading only the `daytrading` ownership set to the private store.
