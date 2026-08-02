// Offline API/security regression checks. No network calls or store writes.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import authHandler from "../api/auth/[action].js";
import watchlistHandler from "../api/watchlist.js";
import {
  fetchChain,
  fetchContract,
  fetchQuote,
  selectYahooOptionSpot,
  selectYahooQuotePrice,
  yahooFinance,
} from "../lib/yahoo.mjs";
import { SESSION_COOKIE, signSession } from "../lib/session.mjs";

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    end(value) { this.body = value; return value; },
  };
}

// PRE/POST prices must win even though Yahoo also keeps regularMarketPrice set.
assert.deepEqual(
  selectYahooQuotePrice({ marketState: "POST", regularMarketPrice: 100, postMarketPrice: 110 }),
  { spot: 110, extended: true },
);
assert.deepEqual(
  selectYahooQuotePrice({ marketState: "PRE", regularMarketPrice: 100, preMarketPrice: 97 }),
  { spot: 97, extended: true },
);
assert.deepEqual(
  selectYahooQuotePrice({ marketState: "CLOSED", regularMarketPrice: 100, postMarketPrice: 110 }),
  { spot: 100, extended: false },
);
assert.equal(
  selectYahooOptionSpot({ marketState: "POST", regularMarketPrice: 100, postMarketPrice: 110 }),
  100,
  "option analytics must pair frozen option marks with the regular-session underlying",
);
const originalQuote = yahooFinance.quote;
try {
  yahooFinance.quote = async () => ({
    marketState: "POST",
    regularMarketPrice: 100,
    regularMarketPreviousClose: 95,
    regularMarketChange: 5,
    regularMarketChangePercent: 5.263,
    postMarketPrice: 110,
  });
  const quote = await fetchQuote("TEST");
  assert.equal(quote.spot, 110);
  assert.equal(quote.change, 15);
  assert.ok(Math.abs(quote.changePct - 15.7894736842) < 1e-6);
} finally {
  yahooFinance.quote = originalQuote;
}

const originalOptions = yahooFinance.options;
try {
  const expDate = new Date("2026-08-21T00:00:00.000Z");
  yahooFinance.options = async () => ({
    quote: { marketState: "POST", regularMarketPrice: 100, postMarketPrice: 110 },
    expirationDates: [expDate],
    options: [{
      expirationDate: expDate,
      calls: [{ strike: 100, bid: 2, ask: 2.2, lastPrice: 2.1, impliedVolatility: 0.3, openInterest: 10, volume: 2 }],
      puts: [],
    }],
  });
  assert.equal((await fetchChain("TEST")).spot, 100);
  assert.equal((await fetchContract("TEST", expDate.getTime() / 1000, "call", 100)).spot, 100);
} finally {
  yahooFinance.options = originalOptions;
}

// Logout is state-changing: GET and cross-origin POST must not clear a cookie.
let res = mockResponse();
await authHandler({
  query: { action: "logout" }, method: "GET",
  headers: { host: "example.test", "x-forwarded-proto": "https" },
}, res);
assert.equal(res.statusCode, 405);

res = mockResponse();
await authHandler({
  query: { action: "logout" }, method: "POST",
  headers: { host: "example.test", "x-forwarded-proto": "https", origin: "https://evil.test" },
}, res);
assert.equal(res.statusCode, 403);

res = mockResponse();
await authHandler({
  query: { action: "logout" }, method: "POST",
  headers: { host: "example.test", "x-forwarded-proto": "https", origin: "https://example.test" },
}, res);
assert.equal(res.statusCode, 204);
assert.match(String(res.headers["set-cookie"]), /Max-Age=0/);

// A malformed side must be rejected before it can alias to and remove a call.
const priorFlag = process.env.PRIVATE_DATA_ENABLED;
const priorSecret = process.env.SESSION_SECRET;
try {
  process.env.PRIVATE_DATA_ENABLED = "1";
  process.env.SESSION_SECRET = "offline-api-smoke-secret";
  const token = await signSession({ sub: "owner", tr: true, tp: true });
  res = mockResponse();
  await watchlistHandler({
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    body: { action: "remove", symbol: "AAPL", side: "garbage" },
  }, res);
  assert.equal(res.statusCode, 400);
} finally {
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
  if (priorSecret == null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
}

// Root output deployments must explicitly exclude local secrets/private data.
const vercelIgnore = await readFile(new URL("../.vercelignore", import.meta.url), "utf8");
for (const pattern of ["/data/", "/r2.env", "*.env", ".env*", "/ai-health.json", "/.codex/"]) {
  assert.ok(vercelIgnore.split(/\r?\n/).includes(pattern), `.vercelignore missing ${pattern}`);
}

// Sequential upstream deadlines must fit inside the configured function cap.
const fedSource = await readFile(new URL("../api/fed-rate.js", import.meta.url), "utf8");
const nyMs = Number(fedSource.match(/NYFED_TIMEOUT_MS\s*=\s*(\d+)/)?.[1]);
const fredMs = Number(fedSource.match(/FRED_TIMEOUT_MS\s*=\s*(\d+)/)?.[1]);
const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const fedBudgetMs = Number(vercelConfig.functions["api/fed-rate.js"].maxDuration) * 1000;
assert.ok(nyMs > 0 && fredMs > 0 && nyMs + fredMs + 3000 <= fedBudgetMs);

console.log("api smoke test passed");
