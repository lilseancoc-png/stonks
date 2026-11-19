// The names the Webull data runner covers (2026-11-19): the site's covered
// stocks and funds (TICKERS, kept equal to researchUniverse by
// `npm run test:site-catalog`) plus the funds the strategy engines trade
// (MACRO_ETFS). Read from these small modules so the Vercel function never
// imports scripts/build.mjs.
import { researchUniverse } from "../site-catalog/universe.mjs";
import { MACRO_ETFS } from "../engines/config.mjs";

export const WEBULL_DATA_TICKERS = Object.freeze([...new Set([...researchUniverse, ...MACRO_ETFS])]);
// Funds among them, for Webull's stock snapshot category (US_ETF vs
// US_STOCK). A name missing from one category is asked again in the other,
// so this list only saves calls; it never decides coverage.
export const WEBULL_DATA_FUNDS = Object.freeze(["SPY", "QQQ", "IWM", "SMH", "UVXY", "TLT", "USO", "GLD", "SLV", "KWEB", "EWY", ...MACRO_ETFS].filter((s, i, a) => a.indexOf(s) === i));
// Underlyings with options expiring every session (Mon-Fri), for the first
// run's backfill of recently expired contracts. Everything else is tried on
// Fridays (or the session before a Friday holiday) only.
export const DAILY_EXPIRY_UNDERLYINGS = Object.freeze(["SPY", "QQQ", "IWM"]);
