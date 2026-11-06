// Plain-English meanings for the options and market words the site uses
// (2026-11-06, UI follow-up 3). One list feeds the tap-to-define popovers in
// app.js (glTerm) and the "Words used on this site" list on Learn & help, so a
// definition is written once.
//
// key -> { term, def, tab? }. `term` is how the word appears on the page,
// `def` one or two short sentences, `tab` an optional page that explains more.
export const GLOSSARY = Object.freeze({
  oi: { term: 'Open interest (OI)', def: 'How many option contracts are still open at a strike. It updates once a day, after the exchange settles the prior session.', tab: 'oi' },
  dOi: { term: 'OI change (ΔOI)', def: 'How much open interest grew or shrank since the prior trading day. A big rise means new positions were opened at that strike.', tab: 'oi' },
  cp: { term: 'Calls per put (C/P)', def: 'Open call contracts divided by open put contracts in the near-term chain. 2:1 means twice as many calls as puts are open.', tab: 'oi' },
  volOi: { term: 'Volume ÷ OI (Vol/OI)', def: 'Contracts traded today divided by contracts already open. Above 1 means today’s trading is larger than the existing positions, often new money.', tab: 'oi' },
  callWall: { term: 'Call wall / put wall', def: 'The strike with the most open calls (or puts). Price often stalls near these strikes because dealers hedge around them. These are open-interest walls.', tab: 'oi' },
  gammaWall: { term: 'Gamma wall', def: 'The strike where dealers’ estimated hedging is largest (dealer gamma). It is worked out from open interest and each option’s gamma, so it can differ from the OI wall.', tab: 'oi' },
  squeeze: { term: 'Squeeze score (gamma squeeze score)', def: 'A 0 to 5 count of signs that call buying could push the stock up fast: heavy calls near the price, many calls per put, busy call-wall trading, a nearby call wall and buying at the ask. 4 or 5 is a setup to watch, not a reason to buy.', tab: 'oi' },
  iv: { term: 'Implied volatility (IV)', def: 'How big a yearly move option prices are paying for, in percent. Higher IV means more expensive options.', tab: 'cheatsheet' },
  ivPct: { term: 'IV percentile', def: 'The share of the stock’s own past days (about 18 months) when its IV was lower than today. 85 means options cost more today than on 85% of those days.', tab: 'iv-trend' },
  ivRank: { term: 'IV rank', def: 'Where today’s IV sits between the lowest (0) and highest (100) IV of the stock’s own saved history.', tab: 'iv-trend' },
  rv: { term: 'Realized volatility (RV30)', def: 'How much the stock actually moved over the last 30 trading days, as a yearly percent. When IV is above it, options are charging more than the stock has been moving.' },
  vrp: { term: 'Volatility premium (VRP)', def: 'IV minus realized volatility. Positive means options are priced for bigger moves than the stock has been making.' },
  dte: { term: 'Days to expiry (DTE)', def: 'Calendar days until an option expires.' },
  atm: { term: 'At the money (ATM)', def: 'The strike closest to the current stock price.' },
  delta: { term: 'Delta (Δ)', def: 'About how much an option’s price moves for a $1 move in the stock, and a rough chance it ends in the money. 0.55 Δ is a little in the money.' },
  impliedMove: { term: 'Implied move', def: 'The move, up or down, that option prices expect around an event such as earnings. It comes from the at-the-money straddle.', tab: 'earnings-week' },
  debit: { term: 'Debit spread', def: 'Buy one option and sell a further one of the same type. It costs less than buying alone, and both the gain and the loss are capped.', tab: 'strategies' },
  credit: { term: 'Credit spread', def: 'Sell one option and buy a further one as protection. You collect money up front; the most you can lose is the gap between strikes minus that credit.', tab: 'strategies' },
});

export function glossaryKeys() { return Object.keys(GLOSSARY); }
