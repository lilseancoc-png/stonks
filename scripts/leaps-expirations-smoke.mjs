#!/usr/bin/env node
// Offline checks for the LEAPS expiration tail. No network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LEAPS_EXTRA_EXPIRATIONS_CAP,
  LEAPS_EXTRA_FETCH_CAP,
  LEAPS_IV_Z_MAX,
  LEAPS_POLITENESS_MS,
  addUtcMonths,
  attachLeapsExpirations,
  expirationInLeapsWindow,
  leapsExtraFetchEnabled,
  qualifiesAsLeapsCandidate,
  selectLeapsExpirations,
  selectLeapsNames,
} from "../lib/leaps-expirations.mjs";
import { publicChainFilePayload } from "./build.mjs";

const NOW = new Date(Date.UTC(2026, 0, 15, 15, 30, 0));

function utc(y, m, d) {
  return Math.floor(Date.UTC(y, m, d) / 1000);
}

function monthsOut(n) {
  return Math.floor(addUtcMonths(new Date(Date.UTC(2026, 0, 15)), n).getTime() / 1000);
}

assert.equal(LEAPS_EXTRA_FETCH_CAP, 5);
assert.equal(LEAPS_EXTRA_EXPIRATIONS_CAP, 4);
assert.equal(LEAPS_IV_Z_MAX, 1.5);
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

// Unavailable Yahoo/IV fields must not spend a shortlist slot.
for (const missing of [null, undefined, "", " ", false]) {
  const valid = { spot: 100, technicals: { sma: { sma200: 90 }, rsi: 50 }, ivRank: { pctile: 20, z: null } };
  assert.equal(qualifiesAsLeapsCandidate({ ...valid, technicals: { ...valid.technicals, sma: { sma200: missing } } }), false);
  assert.equal(qualifiesAsLeapsCandidate({ ...valid, ivRank: { ...valid.ivRank, pctile: missing } }), false);
}
assert.equal(qualifiesAsLeapsCandidate({ spot: 100, technicals: { sma: { sma200: 90 }, rsi: null }, ivRank: { pctile: 0, z: null } }), true,
  "a real zero percentile is cheap premium; missing RSI is not a zero-RSI knife reading");

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
assert.equal(qualifiesAsLeapsCandidate(candidate("HIGH_Z", 9)), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("Z_AT_MAX", LEAPS_IV_Z_MAX)), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("Z_UNDER", 1.49, { ivRank: { z: 1.49, pctile: 59 } })), true);
assert.equal(qualifiesAsLeapsCandidate(candidate("Z_ONLY", 0.1, { ivRank: { z: 0.1 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("RICH_PCT", 0.1, { ivRank: { z: 0.1, pctile: 60 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("NO_IV", 0, { ivRank: null })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("PCT_ONLY", 0, { ivRank: { pctile: 59 } })), true);
assert.equal(qualifiesAsLeapsCandidate(candidate("Z_NULL_RICH", 0, { ivRank: { z: null, pctile: 60 } })), false);
assert.equal(qualifiesAsLeapsCandidate(candidate("NO_SMA", 0.2, { technicals: { rsi: 55 } })), false);

const byPercentile = selectLeapsNames([
  candidate("LOWZ", 0, { ivRank: { z: 0, pctile: 50 } }),
  candidate("HIGHZ", 1.4, { ivRank: { z: 1.4, pctile: 10 } }),
], { now: NOW, cap: 5 });
assert.deepEqual(byPercentile.map((row) => row.symbol), ["HIGHZ", "LOWZ"]);

assert.equal(leapsExtraFetchEnabled({}), false);
assert.equal(leapsExtraFetchEnabled({ LEAPS_EXTRA_FETCH: "0" }), false);
assert.equal(leapsExtraFetchEnabled({ LEAPS_EXTRA_FETCH: "true" }), false);
assert.equal(leapsExtraFetchEnabled({ LEAPS_EXTRA_FETCH: "1" }), true);

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

let offFetches = 0;
const offChains = { N0: candidate("N0", 0) };
const offExp = offChains.N0.expirations;
const offChainMap = offChains.N0.chains;
const off = await attachLeapsExpirations(offChains, {
  now: NOW,
  enabled: false,
  env: { LEAPS_EXTRA_FETCH: "1" },
  fetchExpiration: async () => {
    offFetches += 1;
    return { c: [{ s: 1 }], p: [] };
  },
});
assert.equal(offFetches, 0);
assert.equal(off.calls, 0);
assert.equal(off.attached, 0);
assert.deepEqual(off.names, []);
assert.equal(offChains.N0._leapsChains, undefined);
assert.equal(offChains.N0.expirations, offExp);
assert.equal(offChains.N0.chains, offChainMap);

const defaultOff = { N0: candidate("N0", 0) };
const defaultResult = await attachLeapsExpirations(defaultOff, {
  now: NOW,
  env: {},
  fetchExpiration: async () => {
    offFetches += 1;
    return { c: [{ s: 1 }], p: [] };
  },
});
assert.equal(offFetches, 0);
assert.equal(defaultResult.calls, 0);
assert.equal(defaultOff.N0._leapsChains, undefined);

const envOn = { N0: candidate("N0", 0) };
const envOnChains = envOn.N0.chains;
const envOnExps = envOn.N0.expirations;
const envResult = await attachLeapsExpirations(envOn, {
  now: NOW,
  env: { LEAPS_EXTRA_FETCH: "1" },
  sleep: async () => {},
  log: () => {},
  fetchExpiration: async () => ({ c: [{ s: 2 }], p: [] }),
});
assert.equal(envResult.calls, 2);
assert.ok(envOn.N0._leapsChains[inside12]);
assert.ok(envOn.N0._leapsChains[inside24]);
assert.equal(envOn.N0.chains, envOnChains);
assert.equal(envOn.N0.expirations, envOnExps);
assert.equal(envOn.N0.chains[inside12], undefined);
assert.equal(envOn.N0.chains[inside24], undefined);

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
const nearChains = Object.fromEntries(Object.entries(chains).map(([sym, row]) => [sym, row.chains]));
const nearExps = Object.fromEntries(Object.entries(chains).map(([sym, row]) => [sym, row.expirations]));
const fetched = [];
const fetchOrder = {};
const sleeps = [];
const logs = [];
const result = await attachLeapsExpirations(chains, {
  now: NOW,
  enabled: true,
  sleep: async (ms) => sleeps.push(ms),
  log: (message) => logs.push(message),
  fetchExpiration: async (symbol, expSec) => {
    fetched.push(`${symbol}:${expSec}`);
    (fetchOrder[symbol] ||= []).push(expSec);
    if (symbol === "N0" && expSec === inside12) throw new Error("yahoo rejected");
    if (symbol === "N1" && expSec === inside12) return { c: [], p: [] };
    return { c: [{ s: 100, b: 1, a: 1.2 }], p: [{ s: 100, b: 1, a: 1.2 }] };
  },
});

assert.deepEqual(result.names, ["N0", "N1", "N2", "N3", "N4"]);
assert.equal(fetched.some((row) => row.startsWith("SKIP:")), false);
assert.equal(fetched.some((row) => row.startsWith("N5:")), false);
assert.equal(chains.SKIP.expirations, skipExpirations);
assert.equal(chains.SKIP._leapsChains, undefined);
assert.equal(chains.N5._leapsChains, undefined);
for (const sym of result.names) {
  assert.equal(chains[sym].chains, nearChains[sym]);
  assert.equal(chains[sym].expirations, nearExps[sym]);
  assert.deepEqual(Object.keys(chains[sym].chains).map(Number), [keptNear]);
  assert.deepEqual(fetchOrder[sym], [inside12, inside24]);
}
assert.equal(chains.N0._leapsChains?.[inside12], undefined);
assert.ok(chains.N0._leapsChains[inside24]);
assert.equal(chains.N1._leapsChains?.[inside12], undefined);
assert.ok(chains.N1._leapsChains[inside24]);
assert.ok(chains.N2._leapsChains[inside12]);
assert.ok(chains.N2._leapsChains[inside24]);
assert.ok(logs.some((line) => /N0/.test(line) && /rejected/.test(line)));
assert.ok(logs.some((line) => /N1/.test(line) && /missing/.test(line)));
assert.equal(sleeps.length, result.names.length);
assert.ok(sleeps.length < result.calls - 1);
assert.ok(sleeps.every((ms) => ms === 150));
assert.ok(result.calls <= LEAPS_EXTRA_FETCH_CAP * LEAPS_EXTRA_EXPIRATIONS_CAP);
assert.equal(result.calls, 10);
assert.ok(result.attached >= 1);

const publicN2 = publicChainFilePayload(chains.N2);
const publicBlob = JSON.stringify(publicN2);
assert.equal(Object.hasOwn(publicN2, "_leapsChains"), false);
assert.equal(Object.hasOwn(publicN2, "_listedExpirations"), false);
assert.equal(publicBlob.includes("_leapsChains"), false);
assert.equal(publicBlob.includes("_listedExpirations"), false);
assert.equal(publicBlob.includes(`"${inside12}"`), false);
assert.equal(publicBlob.includes(`"${inside24}"`), false);
assert.deepEqual(publicN2.expirations, [keptNear]);
assert.ok(publicN2.chains[keptNear]);
assert.equal(publicN2.chains[inside12], undefined);
assert.equal(publicN2.chains[inside24], undefined);
assert.equal(publicN2.autoPick, undefined);

const stripped = publicChainFilePayload({
  spot: 10,
  expirations: [keptNear],
  chains: { [keptNear]: { c: [{ s: 1 }], p: [] } },
  _leapsChains: { [inside24]: { c: [{ s: 9 }], p: [] } },
  _listedExpirations: [keptNear, inside24],
  autoPick: { call: { strike: 11 } },
});
const strippedBlob = JSON.stringify(stripped);
assert.equal(Object.hasOwn(stripped, "_leapsChains"), false);
assert.equal(strippedBlob.includes("_leapsChains"), false);
assert.equal(strippedBlob.includes(`"${inside24}"`), false);
assert.equal(stripped.autoPick, undefined);
assert.deepEqual(stripped.expirations, [keptNear]);

const capped = {};
for (let i = 0; i < 6; i++) capped[`C${i}`] = candidate(`C${i}`, i, { ivRank: { z: i, pctile: 10 + i } });
capped.FZ = deepFreeze(candidate("FZ", 0, { ivRank: { z: 0, pctile: 11 } }));
const capFetched = [];
const capLogs = [];
const capResult = await attachLeapsExpirations(capped, {
  now: NOW,
  enabled: true,
  cap: 3,
  expirationCap: 1,
  sleep: async (ms) => capFetched.push(`sleep:${ms}`),
  log: (message) => capLogs.push(message),
  fetchExpiration: async (symbol, expSec) => {
    capFetched.push(`${symbol}:${expSec}`);
    if (symbol === "C0") throw new Error("yahoo down");
    return { c: [{ s: 1 }], p: [{ s: 1 }] };
  },
});
assert.deepEqual(capResult.names, ["C0", "C1", "FZ"]);
assert.equal(capResult.calls, 3);
assert.ok(capResult.calls <= 3 * 1);
assert.equal(capFetched.filter((row) => row.startsWith("C")).length, 2);
assert.equal(capFetched.some((row) => row.startsWith("C2:")), false);
assert.equal(capFetched.some((row) => row.startsWith("sleep:")), false);
assert.equal(capped.C0._leapsChains, undefined);
assert.equal(capped.C0.chains[inside24], undefined);
assert.ok(capped.C1._leapsChains[inside24]);
assert.equal(capped.C1._leapsChains[inside12], undefined);
assert.equal(capped.C1.chains[inside24], undefined);
assert.deepEqual(capped.C1.expirations, [keptNear]);
assert.equal(capped.FZ._leapsChains, undefined);
assert.ok(capLogs.some((line) => /C0/.test(line) && /yahoo down/.test(line)));
assert.ok(capLogs.some((line) => /FZ/.test(line)));
assert.equal(capResult.attached, 1);

const overlap = {};
for (let i = 0; i < 3; i++) overlap[`Q${i}`] = candidate(`Q${i}`, 0, { ivRank: { pctile: 20 + i } });
let arrived = 0;
let release = () => {};
const gate = new Promise((resolve) => { release = resolve; });
try {
  const overlapResult = await Promise.race([
    attachLeapsExpirations(overlap, {
      now: NOW,
      enabled: true,
      sleep: async () => {},
      log: () => {},
      fetchExpiration: async (symbol, expSec) => {
        if (expSec === inside12) {
          arrived += 1;
          if (arrived === 3) release();
          await gate;
        }
        return { c: [{ s: 1 }], p: [{ s: 1 }] };
      },
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("LEAPS names did not fetch in parallel")), 2000)),
  ]);
  assert.equal(arrived, 3);
  assert.equal(overlapResult.calls, 6);
  assert.equal(overlapResult.attached, 6);
  assert.ok(overlap.Q2._leapsChains[inside24]);
  assert.equal(overlap.Q2.chains[inside12], undefined);
  assert.deepEqual(overlap.Q2.expirations, [keptNear]);
} finally {
  release();
}

const buildSrc = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
assert.match(buildSrc, /const MAX_EXPIRATIONS = 14;/);
assert.match(buildSrc, /const LEAPS_EXTRA_FETCH_ENABLED = leapsExtraFetchEnabled\(\);/);
assert.match(buildSrc, /withYahooTimeout\(/);
assert.match(buildSrc, /_listedExpirations/);
assert.match(buildSrc, /_leapsChains/);
assert.match(buildSrc, /JSON\.stringify\(publicChainFilePayload\(data\)\)/);
assert.match(buildSrc, /await new Promise\(\(r\) => setTimeout\(r, 150\)\)/);
const gateAt = buildSrc.indexOf("if (LEAPS_EXTRA_FETCH_ENABLED)");
const gateSlice = buildSrc.slice(gateAt, gateAt + 900);
assert.ok(gateAt > 0);
assert.match(gateSlice, /attachLeapsExpirations\(/);
assert.match(gateSlice, /fetchLeapsExpirationChain/);

console.log("leaps-expirations smoke ok");
