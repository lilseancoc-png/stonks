#!/usr/bin/env node
// Offline checks for the LEAPS expiration tail. No network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LEAPS_EXTRA_EXPIRATIONS_CAP,
  LEAPS_EXTRA_FETCH_CAP,
  LEAPS_POLITENESS_MS,
  addUtcMonths,
  attachLeapsExpirations,
  expirationInLeapsWindow,
  qualifiesAsLeapsCandidate,
  selectLeapsExpirations,
  selectLeapsNames,
} from "../lib/leaps-expirations.mjs";

const NOW = new Date(Date.UTC(2026, 0, 15, 15, 30, 0));

function utc(y, m, d) {
  return Math.floor(Date.UTC(y, m, d) / 1000);
}

function monthsOut(n) {
  return Math.floor(addUtcMonths(new Date(Date.UTC(2026, 0, 15)), n).getTime() / 1000);
}

assert.equal(LEAPS_EXTRA_FETCH_CAP, 5);
assert.equal(LEAPS_EXTRA_EXPIRATIONS_CAP, 4);
assert.equal(LEAPS_POLITENESS_MS, 150);
assert.equal(addUtcMonths(new Date(Date.UTC(2026, 0, 31)), 1).toISOString().slice(0, 10), "2026-02-28");
assert.equal(addUtcMonths(new Date(Date.UTC(2024, 0, 31)), 1).toISOString().slice(0, 10), "2024-02-29");

const inside9 = monthsOut(9);
const inside12 = monthsOut(12);
const inside18 = monthsOut(18);
const inside24 = monthsOut(24);
const before = monthsOut(8);
const after = monthsOut(25);

assert.equal(expirationInLeapsWindow(inside9, NOW), true);
assert.equal(expirationInLeapsWindow(inside24, NOW), true);
assert.equal(expirationInLeapsWindow(before, NOW), false);
assert.equal(expirationInLeapsWindow(after, NOW), false);
assert.equal(expirationInLeapsWindow(utc(2026, 9, 14), NOW), false);
assert.equal(expirationInLeapsWindow(utc(2028, 0, 16), NOW), false);

const keptNear = utc(2026, 2, 20);
const windowed = [before, inside9, inside12, inside18, inside24, after, keptNear];
assert.deepEqual(
  selectLeapsExpirations(windowed, { now: NOW, alreadyKept: [keptNear, inside9], cap: 4 }),
  [inside12, inside18, inside24],
);

const many = [];
for (let i = 0; i < 15; i++) {
  const start = Date.UTC(2026, 9, 15);
  const end = Date.UTC(2028, 0, 15);
  many.push(Math.floor((start + (i * (end - start)) / 14) / 1000));
}
const spread = selectLeapsExpirations(many, { now: NOW, alreadyKept: [], cap: 4 });
assert.equal(spread.length, 4);
assert.deepEqual(spread, [many[0], many[5], many[9], many[14]]);
assert.equal(expirationInLeapsWindow(spread[0], NOW), true);
assert.equal(expirationInLeapsWindow(spread[3], NOW), true);

function candidate(symbol, z, extras = {}) {
  return {
    symbol,
    spot: 120,
    technicals: { sma: { sma200: 100 }, rsi: 55 },
    ivRank: { z, pctile: 40 },
    expirations: [keptNear],
    chains: { [keptNear]: { c: [{ s: 100 }], p: [] } },
    _listedExpirations: [keptNear, inside12, inside24],
    ...extras,
  };
}

assert.equal(qualifiesAsLeapsCandidate(candidate("OK", 0.2)), true);
assert.equal(qualifiesAsLeapsCandidate(candidate("LOW", 0.2, { spot: 90 })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("CHASE", 0.2, { technicals: { sma: { sma200: 100 }, rsi: 80 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("KNIFE", 0.2, { technicals: { sma: { sma200: 100 }, rsi: 20 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("RICH", 1.5)), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("RICH_PCT", 0.1, { ivRank: { z: 0.1, pctile: 60 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("NO_IV", 0, { ivRank: null })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("PCT_ONLY", 0, { ivRank: { pctile: 59 } })), true);
assert.equal(qualifiesAsLeapsCandidate(candidate("NO_SMA", 0.2, { technicals: { rsi: 55 } })), false);

const names = [];
for (let i = 0; i < 6; i++) names.push(candidate(`N${i}`, i * 0.1));
const alreadyFull = candidate("FULL", -1, { _listedExpirations: [keptNear, inside12], chains: { [keptNear]: { c: [{}], p: [] }, [inside12]: { c: [{}], p: [] } }, expirations: [keptNear, inside12] });
const picked = selectLeapsNames([...names, alreadyFull], { now: NOW, cap: 5 });
assert.deepEqual(picked.map((row) => row.symbol), ["N0", "N1", "N2", "N3", "N4"]);
assert.equal(picked.some((row) => row.symbol === "N5"), false);
assert.equal(picked.some((row) => row.symbol === "FULL"), false);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const chains = {
  N0: candidate("N0", 0),
  N1: candidate("N1", 0.1),
  SKIP: deepFreeze(candidate("SKIP", 0.2, { spot: 80 })),
  N2: candidate("N2", 0.2),
  N3: candidate("N3", 0.3),
  N4: candidate("N4", 0.4),
  N5: deepFreeze(candidate("N5", 0.9)),
};
const skipExpirations = chains.SKIP.expirations;
const fetched = [];
const sleeps = [];
const logs = [];
const result = await attachLeapsExpirations(chains, {
  now: NOW,
  sleep: async (ms) => sleeps.push(ms),
  log: (message) => logs.push(message),
  fetchExpiration: async (symbol, expSec) => {
    fetched.push(`${symbol}:${expSec}`);
    if (symbol === "N0" && expSec === inside12) throw new Error("yahoo rejected");
    if (symbol === "N1" && expSec === inside12) return { c: [], p: [] };
    return { c: [{ s: 100, b: 1, a: 1.2 }], p: [{ s: 100, b: 1, a: 1.2 }] };
  },
});

assert.deepEqual(result.names, ["N0", "N1", "N2", "N3", "N4"]);
assert.equal(fetched.some((row) => row.startsWith("SKIP:")), false);
assert.equal(fetched.some((row) => row.startsWith("N5:")), false);
assert.equal(chains.SKIP.expirations, skipExpirations);
assert.equal(Object.keys(chains.N0.chains).map(Number).includes(inside12), false);
assert.equal(Object.keys(chains.N0.chains).map(Number).includes(inside24), true);
assert.equal(Object.keys(chains.N1.chains).map(Number).includes(inside12), false);
assert.ok(logs.some((line) => /N0/.test(line) && /rejected/.test(line)));
assert.ok(logs.some((line) => /N1/.test(line) && /missing/.test(line)));
assert.equal(sleeps.length, result.calls - 1);
assert.ok(sleeps.every((ms) => ms === 150));
assert.ok(result.calls <= LEAPS_EXTRA_FETCH_CAP * LEAPS_EXTRA_EXPIRATIONS_CAP);
assert.ok(result.attached >= 1);

const buildSrc = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
assert.match(buildSrc, /const MAX_EXPIRATIONS = 14;/);
assert.match(buildSrc, /attachLeapsExpirations\(/);
assert.match(buildSrc, /withYahooTimeout\(/);
assert.match(buildSrc, /_listedExpirations/);
assert.match(buildSrc, /await new Promise\(\(r\) => setTimeout\(r, 150\)\)/);

console.log("leaps-expirations smoke ok");
