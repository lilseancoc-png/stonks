import assert from "node:assert/strict";
import {
  EVIDENCE_LATEST_KEY,
  addCalendarDays,
  buildEvidenceRecord,
  evidenceDayKey,
  evidenceWindowKeys,
  loadEvidenceWindow,
  ownNormalZ,
  runEvidenceRecord,
  signalFromZ,
} from "../lib/evidence-record.mjs";
import {
  isBakeOwnedKey,
  isDynamicBakeKey,
  isEvidenceRecordKey,
} from "../lib/data-ownership.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";

const BAKE = "2026-10-13";

{
  assert.equal(evidenceDayKey(BAKE), "evidence/2026-10-13.json");
  const keys = evidenceWindowKeys(BAKE);
  assert.equal(keys.length, 60);
  assert.equal(keys[0], "evidence/2026-08-15.json");
  assert.equal(keys[keys.length - 1], "evidence/2026-10-13.json");
  assert.equal(addCalendarDays(BAKE, -60), "2026-08-14");
  assert.ok(!keys.includes("evidence/2026-08-14.json"));
  assert.equal(isEvidenceRecordKey("evidence/2026-10-13.json"), true);
  assert.equal(isEvidenceRecordKey(EVIDENCE_LATEST_KEY), true);
  assert.equal(isEvidenceRecordKey("evidence/not-a-date.json"), false);
  assert.equal(isBakeOwnedKey("evidence/2026-10-13.json"), true);
  assert.equal(isBakeOwnedKey(EVIDENCE_LATEST_KEY), true);
  assert.equal(isDynamicBakeKey("evidence/2026-10-13.json"), false, "dated evidence must not be delete-staled");
  assert.equal(isDynamicBakeKey(EVIDENCE_LATEST_KEY), false);
  assert.equal(isPremiumKey("evidence/2026-10-13.json"), true);
  assert.equal(isPremiumKey(EVIDENCE_LATEST_KEY), true);
  assert.equal(isRoleRestrictedKey("evidence/2026-10-13.json"), true);
  assert.deepEqual(roleClaimForKey("evidence/2026-10-13.json"), ["tr", "tp"]);
  assert.deepEqual(roleClaimForKey(EVIDENCE_LATEST_KEY), ["tr", "tp"]);
  assert.equal(isPremiumKey("grades.json"), false);
  assert.equal(roleClaimForKey("grades.json"), null);
}

{
  const flat = [];
  for (let i = 0; i < 30; i++) flat.push(10);
  assert.equal(ownNormalZ(flat, 10), 0);
  assert.deepEqual(signalFromZ(0), { dir: "neutral", str: 0 });
  assert.equal(signalFromZ(ownNormalZ(flat, 14)).dir, "up");
  assert.equal(ownNormalZ([1, 2, 3], 100), null, "a short sample must not fire");
  const wavy = [];
  for (let i = 0; i < 20; i++) wavy.push(i % 2 === 0 ? 9 : 11);
  assert.equal(signalFromZ(ownNormalZ(wavy, 10)).dir, "neutral");
  const fired = signalFromZ(ownNormalZ(wavy, 12.2));
  assert.equal(fired.dir, "up");
  assert.ok(fired.str >= 1 && fired.str <= 3);
}

{
  const gets = [];
  const store = {
    async get(key) {
      gets.push(key);
      return null;
    },
    async put() {
      throw new Error("load must not write");
    },
  };
  const loaded = await loadEvidenceWindow(store, BAKE);
  assert.equal(loaded.records.length, 0);
  assert.equal(gets.length, 61, "60 dated keys plus evidence-latest");
  assert.ok(gets.includes(EVIDENCE_LATEST_KEY));
  assert.ok(gets.includes("evidence/2026-10-13.json"));
  assert.ok(gets.includes("evidence/2026-08-15.json"));
  assert.ok(!gets.includes("evidence/2026-08-14.json"), "the loader must not read older keys");
  assert.equal(typeof store.list, "undefined");
}

{
  const prior = [];
  for (let ago = 2; ago <= 40; ago++) {
    const date = addCalendarDays(BAKE, -ago);
    const ats = 10 + (ago % 5) - 2;
    prior.push({
      date,
      names: {
        AAA: [{ id: "ats", src: "finra-ats", dir: "neutral", str: 0, asOf: date, firstSeen: date, v: ats }],
        BBB: [{ id: "attention", src: "stocktwits", dir: "neutral", str: 0, asOf: date, firstSeen: date, v: 0 }],
      },
    });
  }
  prior.push({
    date: "2026-10-12",
    names: {
      AAA: [
        { id: "ats", src: "finra-ats", dir: "up", str: 1, asOf: "2026-10-10", firstSeen: "2026-10-08", v: 12 },
        { id: "structure", src: "technicals", dir: "neutral", str: 0, asOf: "2026-10-12", firstSeen: "2026-12-01", v: 50 },
      ],
      BBB: [
        { id: "attention", src: "stocktwits", dir: "up", str: 2, asOf: "2026-10-12", firstSeen: "2026-10-03", v: 40 },
      ],
    },
  });
  const record = buildEvidenceRecord({
    chains: {
      AAA: { spot: 10, technicals: { sr: { s20: 9, r20: 11 }, sma: { sma20: 10 } } },
      BBB: {
        spot: 20,
        technicals: { sr: { s20: 18, r20: 22 } },
        social: { sources: { stocktwits: { bull: 70, bear: 30, sampledAt: "2026-10-13T14:00:00.000Z" } } },
      },
    },
    marketStructure: {
      bySymbol: {
        AAA: { ats: { darkPoolPct: 16, publishedDate: "2026-10-11", weekStartDate: "2026-09-28" } },
        BBB: { ats: { darkPoolPct: 10, publishedDate: "2026-10-11" } },
        CCC: { ats: { darkPoolPct: 40, publishedDate: "2026-10-20" } },
      },
    },
    unusual: {
      scannedAt: "2026-10-14T16:00:00.000Z",
      tickers: [{ symbol: "AAA", contracts: [{ side: "call", tape: "ask", flagged: true, premium: 5_000_000 }] }],
    },
  }, { bakeDate: BAKE, priorRecords: prior });

  assert.equal(record.date, BAKE);
  assert.equal(record.names.CCC, undefined, "a future publication date is not yet known");
  const ats = record.names.AAA.find((piece) => piece.id === "ats");
  assert.equal(ats.dir, "up");
  assert.ok(ats.str >= 1 && ats.str <= 3);
  assert.equal(ats.asOf, "2026-10-11");
  assert.equal(ats.firstSeen, "2026-10-08", "firstSeen carries while the direction holds");
  assert.equal(record.names.AAA.some((piece) => piece.id === "flow"), false, "a scan dated after the bake is ignored");
  const structure = record.names.AAA.find((piece) => piece.id === "structure");
  assert.equal(structure.dir, "neutral");
  assert.equal(structure.firstSeen, BAKE, "a future firstSeen cannot be carried");
  assert.ok(record.names.AAA.findIndex((piece) => piece.id === "ats") < record.names.AAA.findIndex((piece) => piece.id === "structure"));

  const attention = record.names.BBB.find((piece) => piece.id === "attention");
  const price = record.names.BBB.find((piece) => piece.id === "structure");
  assert.equal(attention.dir, "up");
  assert.equal(attention.firstSeen, "2026-10-03");
  assert.equal(price.dir, "neutral");
  assert.ok(record.names.BBB.findIndex((piece) => piece.id === "attention") < record.names.BBB.findIndex((piece) => piece.id === "structure"));
  const bbbAts = record.names.BBB.find((piece) => piece.id === "ats");
  assert.ok(ats.rk > bbbAts.rk, "the richer dark-pool share ranks higher in the universe");

  for (const pieces of Object.values(record.names)) {
    for (const piece of pieces) {
      assert.equal(typeof piece.asOf, "string");
      assert.equal(typeof piece.firstSeen, "string");
      assert.ok(piece.asOf <= BAKE, `${piece.id} asOf ${piece.asOf} is after the bake`);
      assert.ok(piece.firstSeen <= BAKE, `${piece.id} firstSeen ${piece.firstSeen} is after the bake`);
      assert.ok(piece.str >= 0 && piece.str <= 3);
      assert.ok(["up", "down", "neutral"].includes(piece.dir));
    }
  }
}

{
  const puts = [];
  const store = {
    async get(key) {
      throw new Error(`run with prior records must not read ${key}`);
    },
    async put(key, body) {
      puts.push({ key, body: String(body) });
    },
  };
  const saved = await runEvidenceRecord({
    store,
    bakeDate: BAKE,
    priorRecords: [],
    sources: {
      chains: { AAA: { spot: 10, technicals: { sr: { s20: 9, r20: 11 } } } },
    },
  });
  assert.equal(saved.key, "evidence/2026-10-13.json");
  assert.deepEqual(puts.map((row) => row.key).sort(), ["evidence-latest.json", "evidence/2026-10-13.json"]);
  const latest = JSON.parse(puts.find((row) => row.key === EVIDENCE_LATEST_KEY).body);
  assert.equal(latest.key, saved.key);
  assert.equal(latest.date, BAKE);
  const day = JSON.parse(puts.find((row) => row.key === saved.key).body);
  assert.equal(day.names.AAA[0].firstSeen <= BAKE, true);
  assert.ok(!day.names.AAA[0].asOf || day.names.AAA[0].asOf <= BAKE);
}


// firstSeen carries across short gaps (<= EVIDENCE_FIRSTSEEN_MAX_GAP_TRADING_DAYS
// trading days) while the direction holds; long gaps and flips reset it.
{
  const m = await import("../lib/evidence-record.mjs");
  assert.equal(m.EVIDENCE_FIRSTSEEN_MAX_GAP_TRADING_DAYS, 5);
  const T = "2026-10-13"; // Tuesday
  const last = (date, dir = "up", firstSeen = "2026-09-01") => ({ date, piece: { id: "ats", dir, firstSeen } });
  assert.equal(m.tradingDaysBetween("2026-10-12", T), 0);
  assert.equal(m.tradingDaysBetween("2026-10-09", T), 1); // Fri -> Tue skips Sat/Sun, counts Mon
  // continuous presence keeps
  assert.equal(m.carriedFirstSeen(last("2026-10-12"), "up", T), "2026-09-01");
  // same-day earlier run keeps
  assert.equal(m.carriedFirstSeen(last(T), "up", T), "2026-09-01");
  // one-day gap keeps
  assert.equal(m.carriedFirstSeen(last("2026-10-09"), "up", T), "2026-09-01");
  // exactly 5 trading days missing keeps; 6 resets
  assert.equal(m.tradingDaysBetween("2026-10-05", T), 5);
  assert.equal(m.carriedFirstSeen(last("2026-10-05"), "up", T), "2026-09-01");
  assert.equal(m.carriedFirstSeen(last("2026-10-02"), "up", T), T);
  // long gap (15 trading days) resets
  assert.equal(m.tradingDaysBetween("2026-09-21", T), 15);
  assert.equal(m.carriedFirstSeen(last("2026-09-21"), "up", T), T);
  // direction flip resets
  assert.equal(m.carriedFirstSeen(last("2026-10-12", "down"), "up", T), T);
  // no prior / future firstSeen resets
  assert.equal(m.carriedFirstSeen(undefined, "up", T), T);
  assert.equal(m.carriedFirstSeen(last("2026-10-12", "up", "2026-12-01"), "up", T), T);

}

console.log("evidence-record smoke ok");
