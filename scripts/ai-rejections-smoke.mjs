// Offline contract for the AI rejection log and its later scorecard.
// No network, no Gemini, no store credentials.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS,
  AI_REJECTION_SCORECARD_KEY,
  AI_REJECTIONS_LATEST_KEY,
  REJECT_HORIZONS,
  WAIT_BETTER_ENTRY_DAYS,
  aiRejectionDayKey,
  aiRejectionNote,
  aiRejectionPassNote,
  aiRejectionReadKeys,
  createFileAiRejectionStore,
  isCurrentAiRejectionPublishKey,
  loadAiRejectionContextFromStore,
  mergeAiRejectionDay,
  persistAiRejections,
  scoreAiRejections,
  writeAiRejectionScorecard,
} from "../lib/ai-rejections.mjs";
import {
  isAiRejectionKey,
  isBakeOwnedKey,
  isDynamicBakeKey,
} from "../lib/data-ownership.mjs";
import { isPremiumKey, isRoleRestrictedKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { serveDataKey } from "../lib/data-response.mjs";
import { store } from "../lib/datastore.mjs";

const RECORD_KEYS = ["sym", "side", "kind", "firstSeen", "asOf", "spot", "grade", "entryReason", "total", "regime"];
const root = fileURLToPath(new URL("..", import.meta.url));

assert.deepEqual(REJECT_HORIZONS, [5, 10, 20]);
assert.equal(WAIT_BETTER_ENTRY_DAYS, 5);
assert.equal(aiRejectionDayKey("2026-10-13"), "ai-rejections/2026-10-13.json");
assert.equal(AI_REJECTIONS_LATEST_KEY, "ai-rejections-latest.json");
assert.equal(AI_REJECTION_SCORECARD_KEY, "ai-rejection-scorecard.json");
assert.throws(() => aiRejectionDayKey("2026-10-13T15:00:00.000Z"), /invalid/);
assert.throws(() => aiRejectionDayKey("2026-02-31"), /invalid/);

const readKeys = aiRejectionReadKeys("2026-10-13");
assert.equal(readKeys.at(-1), AI_REJECTIONS_LATEST_KEY);
assert.equal(readKeys.at(-2), "ai-rejections/2026-10-13.json");
assert.equal(readKeys.includes("ai-rejections/2026-01-01.json"), false);
assert.equal(readKeys.filter((key) => key.startsWith("ai-rejections/")).length, AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS + 1);

for (const key of [
  "ai-rejections/2026-10-13.json",
  "ai-rejections/2020-01-02.json",
  AI_REJECTIONS_LATEST_KEY,
  AI_REJECTION_SCORECARD_KEY,
]) {
  assert.equal(isAiRejectionKey(key), true, key);
  assert.equal(isBakeOwnedKey(key), true, key);
  assert.equal(isDynamicBakeKey(key), false, `${key} must be retained, not delete-staled`);
  assert.equal(isPremiumKey(key), true, key);
  assert.equal(isRoleRestrictedKey(key), true, key);
  assert.deepEqual(roleClaimForKey(key), ["tr", "tp"], key);
}
assert.equal(isAiRejectionKey("picks.json"), false);
assert.equal(isAiRejectionKey("ai-rejections/not-a-date.json"), false);
assert.equal(isPremiumKey("briefs.json"), false);
assert.equal(roleClaimForKey("briefs.json"), null);
assert.equal(isCurrentAiRejectionPublishKey("ai-rejections/2026-10-13.json", "2026-10-13"), true);
assert.equal(isCurrentAiRejectionPublishKey("ai-rejections/2026-10-12.json", "2026-10-13"), false);
assert.equal(isCurrentAiRejectionPublishKey(AI_REJECTIONS_LATEST_KEY, "2026-10-13"), true);
assert.equal(isCurrentAiRejectionPublishKey(AI_REJECTION_SCORECARD_KEY, "2026-10-13"), true);

const remote = ["ai-rejections/2026-01-01.json", "ai-rejections/2026-10-13.json", "AAPL.json", "iv-history/AAPL.json"];
const local = new Set(["ai-rejections/2026-10-13.json", "AAPL.json"]);
const stale = remote.filter((key) => isDynamicBakeKey(key) && isBakeOwnedKey(key) && !local.has(key));
assert.deepEqual(stale, ["iv-history/AAPL.json"]);

const freshness = await readFile(resolve(root, "scripts/verify-data-freshness.mjs"), "utf8");
assert.match(freshness, /isCurrentAiRejectionPublishKey\(key, etDateKey\(now\)\)/);
assert.doesNotMatch(freshness, /BAKE_REQUIRED_REWRITTEN_FILES = \[[\s\S]*?ai-rejection/);
const buildSrc = await readFile(resolve(root, "scripts/build.mjs"), "utf8");
assert.match(buildSrc, /kind: meta\.aiEntryHeldBack\.length > heldBackBefore \? "wait-heldback" : "wait"/);
assert.match(buildSrc, /persistAiRejections\(/);
assert.match(buildSrc, /loadAiRejectionContext\(/);
const backtestSrc = await readFile(resolve(root, "scripts/backtest-picks.mjs"), "utf8");
assert.match(backtestSrc, /scoreAiRejections\(/);
assert.match(backtestSrc, /writeAiRejectionScorecard\(/);
assert.match(backtestSrc, /loadPriceSeries\(/);

const thesis = { grade: "reject", entryReason: "The case already played out." };
assert.equal(aiRejectionNote({
  tactical: true, graderActive: true, aiThesis: thesis, kind: "reject",
  sym: "AAPL", side: "call", spot: 10, total: 4, asOf: "t", regime: "neutral",
}), null);
assert.equal(aiRejectionNote({
  tactical: false, graderActive: false, aiThesis: thesis, kind: "reject",
  sym: "AAPL", side: "call", spot: 10, total: 4,
}), null);
assert.equal(aiRejectionNote({
  tactical: false, graderActive: true, aiThesis: null, kind: "reject",
  sym: "AAPL", side: "call",
}), null);
assert.equal(aiRejectionPassNote({
  tactical: true, graderActive: true, aiThesis: { grade: "strong", entryVerdict: "buy-now" },
  sym: "AAPL", side: "call", spot: 10,
}), null);

const dir = await mkdtemp(resolve(tmpdir(), "ai-rejections-"));
try {
  await mkdir(resolve(dir, "ai-rejections"), { recursive: true });
  await writeFile(resolve(dir, "ai-rejections/2026-01-01.json"), JSON.stringify({
    date: "2026-01-01",
    records: [{
      sym: "AAPL", side: "call", kind: "reject", firstSeen: "2020-01-01",
      asOf: "2026-01-01T15:00:00.000Z", spot: 1, grade: "reject", entryReason: "old",
      total: -4, regime: "neutral",
    }],
    passed: [],
  }));
  await writeFile(resolve(dir, "ai-rejections/2026-10-01.json"), JSON.stringify({
    date: "2026-10-01",
    records: [{
      sym: "MSFT", side: "put", kind: "reject", firstSeen: "2026-09-02",
      asOf: "2026-10-01T15:00:00.000Z", spot: 40, grade: "reject", entryReason: "prior",
      total: -5, regime: "risk-off",
    }],
    passed: [],
  }));
  const seen = [];
  const real = createFileAiRejectionStore(dir);
  const ctx = await loadAiRejectionContextFromStore({
    async get(key) { seen.push(key); return real.get(key); },
    async put(key, body) { return real.put(key, body); },
  }, "2026-10-13");
  assert.equal(seen.includes("ai-rejections/2026-01-01.json"), false);
  assert.equal(seen.includes("ai-rejections/2026-10-01.json"), true);
  assert.equal(seen.includes("ai-rejections/2026-10-13.json"), true);
  assert.equal(seen.includes(AI_REJECTIONS_LATEST_KEY), true);
  assert.equal(seen.length, AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS + 2);
  assert.equal(ctx.prior.some((day) => day.date === "2026-01-01"), false);
  assert.equal(ctx.prior.some((day) => day.date === "2026-10-01"), true);

  const morningNotes = [
    aiRejectionNote({
      tactical: false, graderActive: true,
      aiThesis: { grade: "reject", entryReason: "still no" },
      kind: "reject", sym: "MSFT", side: "put", spot: 42, total: -6,
      asOf: "2026-10-13T15:00:00.000Z", regime: "risk-off",
    }),
    aiRejectionNote({
      tactical: false, graderActive: true,
      aiThesis: { grade: "reject", entryReason: "new" },
      kind: "reject", sym: "AAPL", side: "call", spot: 200, total: -4,
      asOf: "2026-10-13T15:00:00.000Z", regime: "risk-off",
    }),
    aiRejectionNote({
      tactical: false, graderActive: true,
      aiThesis: { grade: "strong", entryReason: "wait for a dip" },
      kind: "wait", sym: "NVDA", side: "call", spot: 100, total: 8,
      asOf: "2026-10-13T15:00:00.000Z", regime: "risk-on",
    }),
  ];
  const morningPasses = [
    aiRejectionPassNote({
      tactical: false, graderActive: true,
      aiThesis: { grade: "strong", entryVerdict: "wait" },
      entryVerdict: "wait", sym: "NVDA", side: "call", spot: 100, total: 8,
      asOf: "2026-10-13T15:00:00.000Z",
    }),
  ];
  const morning = await persistAiRejections({
    dataDir: dir,
    bakeDate: "2026-10-13",
    capture: { notes: morningNotes, passed: morningPasses },
    context: ctx,
  });
  assert.equal(morning.key, "ai-rejections/2026-10-13.json");
  const morningDay = JSON.parse(await readFile(resolve(dir, morning.key), "utf8"));
  const msft = morningDay.records.find((row) => row.sym === "MSFT");
  const aapl = morningDay.records.find((row) => row.sym === "AAPL");
  assert.equal(msft.firstSeen, "2026-09-02");
  assert.equal(aapl.firstSeen, "2026-10-13");
  assert.deepEqual(Object.keys(msft), RECORD_KEYS);
  const latest = JSON.parse(await readFile(resolve(dir, AI_REJECTIONS_LATEST_KEY), "utf8"));
  assert.equal(latest.date, "2026-10-13");
  assert.equal(latest.key, morning.key);

  const afternoonCtx = await loadAiRejectionContextFromStore(real, "2026-10-13");
  const afternoon = mergeAiRejectionDay({
    date: "2026-10-13",
    observations: [
      aiRejectionNote({
        tactical: false, graderActive: true,
        aiThesis: { grade: "strong", entryReason: "afternoon hold" },
        kind: "wait-heldback", sym: "NVDA", side: "call", spot: 110, total: 9,
        asOf: "2026-10-13T19:30:00.000Z", regime: "risk-on",
      }),
      aiRejectionNote({
        tactical: false, graderActive: true,
        aiThesis: { grade: "reject", entryReason: "no" },
        kind: "reject", sym: "AMD", side: "put", spot: 50, total: -7,
        asOf: "2026-10-13T19:30:00.000Z", regime: "risk-on",
      }),
    ],
    passed: [aiRejectionPassNote({
      tactical: false, graderActive: true,
      aiThesis: { grade: "strong", entryVerdict: "wait" },
      entryVerdict: "wait", sym: "NVDA", side: "call", spot: 110, total: 9,
      asOf: "2026-10-13T19:30:00.000Z",
    })],
    existing: afternoonCtx.today,
    priorRecords: afternoonCtx.prior,
  });
  const nvdaRows = afternoon.records.filter((row) => row.sym === "NVDA");
  assert.equal(nvdaRows.length, 1);
  assert.equal(nvdaRows[0].kind, "wait");
  assert.equal(nvdaRows[0].spot, 100);
  assert.equal(nvdaRows[0].asOf, "2026-10-13T15:00:00.000Z");
  assert.equal(nvdaRows[0].firstSeen, "2026-10-13");
  assert.equal(afternoon.records.find((row) => row.sym === "AMD").firstSeen, "2026-10-13");
  assert.equal(afternoon.passed.find((row) => row.sym === "NVDA").spot, 100);
  assert.equal(afternoon.records.filter((row) => `${row.sym}:${row.side}`).length, new Set(afternoon.records.map((row) => `${row.sym}:${row.side}`)).size);

  const skipped = await persistAiRejections({
    dataDir: dir, bakeDate: "2026-10-13", capture: null, context: afternoonCtx,
  });
  assert.equal(skipped.skipped, "no-grader");
  const bad = await persistAiRejections({
    dataDir: dir, bakeDate: "nope", capture: { notes: [], passed: [] }, context: {},
  });
  assert.equal(typeof bad.error, "string");
  const beforeBlock = await readFile(resolve(dir, "ai-rejections/2026-10-13.json"), "utf8");
  const blocked = await persistAiRejections({
    dataDir: dir,
    bakeDate: "2026-10-13",
    capture: { notes: morningNotes, passed: [] },
    context: { today: null, prior: [], error: "read failed" },
  });
  assert.equal(blocked.skipped, "history-unavailable");
  assert.equal(await readFile(resolve(dir, "ai-rejections/2026-10-13.json"), "utf8"), beforeBlock);

  const line = (start, step, n = 21) => {
    const closes = [];
    for (let i = 0; i < n; i += 1) closes.push(start + step * i);
    return { dateIndex: new Map([["2026-01-05", 0]]), closes };
  };
  const card = scoreAiRejections({
    asOf: "2026-10-13T20:00:00.000Z",
    days: [
      {
        date: "2026-01-05",
        records: [
          { sym: "AAPL", side: "call", kind: "reject", spot: 100 },
        ],
        passed: [
          { sym: "MSFT", side: "call", spot: 100, grade: "strong", entryVerdict: "buy-now" },
          { sym: "PUTP", side: "put", spot: 20, grade: "moderate", entryVerdict: "buy-now" },
        ],
      },
      {
        date: "2026-02-02",
        records: [
          { sym: "WAIT", side: "call", kind: "wait", spot: 100 },
          { sym: "PROMO", side: "call", kind: "wait", spot: 100 },
          { sym: "LATE", side: "call", kind: "wait", spot: 100 },
          { sym: "HOLD", side: "call", kind: "wait-heldback", spot: 100 },
        ],
        passed: [
          { sym: "WAIT", side: "call", spot: 90, grade: "strong", entryVerdict: "buy-now" },
        ],
      },
      {
        date: "2026-02-04",
        records: [],
        passed: [
          { sym: "PROMO", side: "call", spot: 90, grade: "strong", entryVerdict: "buy-now" },
          { sym: "HOLD", side: "call", spot: 110, grade: "strong", entryVerdict: "buy-now" },
        ],
      },
    ],
    series: {
      AAPL: line(100, -1),
      MSFT: line(100, 1),
      PUTP: line(20, 1),
      WAIT: { dateIndex: new Map([["2026-02-02", 0]]), closes: [100, 101, 102, 103, 104, 99] },
      PROMO: { dateIndex: new Map([["2026-02-02", 0]]), closes: [100, 101, 102, 103, 104, 105, 106] },
      LATE: { dateIndex: new Map([["2026-02-02", 0]]), closes: [100, 101, 101, 101, 101, 101, 90] },
      HOLD: { dateIndex: new Map([["2026-02-02", 0]]), closes: [100, 101, 102, 103, 104, 105, 106] },
    },
  });
  assert.deepEqual(card.horizons, [5, 10, 20]);
  assert.equal(card.waitBetterEntryDays, WAIT_BETTER_ENTRY_DAYS);
  for (const horizon of [5, 10, 20]) {
    const row = card.rejects[String(horizon)];
    assert.equal(row.reject.n, 1, `reject n @ ${horizon}`);
    assert.equal(row.passed.n, 1, `pass n @ ${horizon}`);
    assert.ok(row.meanDelta < 0, `reject mean should lag passes @ ${horizon}`);
    assert.equal(row.reject.hitRate, 0);
    assert.equal(row.passed.hitRate, 1);
    assert.equal(row.hitRateDelta, -1);
    assert.equal(row.pending, 0);
  }
  assert.equal(card.rejects["5"].reject.mean, -5);
  assert.equal(card.rejects["5"].passed.mean, 5);
  assert.equal(card.waits.wait.scored, 3);
  assert.equal(card.waits.wait.right, 2);
  assert.equal(card.waits.wait.pricePath, 1);
  assert.equal(card.waits.wait.promotionPath, 1);
  assert.equal(card.waits.wait.pending, 0);
  assert.equal(card.waits["wait-heldback"].scored, 1);
  assert.equal(card.waits["wait-heldback"].right, 0);
  assert.equal(card.waits["wait-heldback"].pricePath, 0);
  assert.equal(card.waits["wait-heldback"].promotionPath, 0);

  const putCard = scoreAiRejections({
    days: [{
      date: "2026-03-02",
      records: [{ sym: "PUTW", side: "put", kind: "wait", spot: 10 }],
      passed: [],
    }],
    series: {
      PUTW: { dateIndex: new Map([["2026-03-02", 0]]), closes: [10, 10, 11, 11, 11, 11] },
    },
  });
  assert.equal(putCard.waits.wait.pricePath, 1);
  assert.equal(putCard.waits.wait.right, 1);

  await writeAiRejectionScorecard(dir, card);
  const written = JSON.parse(await readFile(resolve(dir, AI_REJECTION_SCORECARD_KEY), "utf8"));
  assert.equal(written.rejects["10"].meanDelta, card.rejects["10"].meanDelta);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const priorFlag = process.env.PRIVATE_DATA_ENABLED;
const priorGet = store.get;
let storeReads = 0;
try {
  process.env.PRIVATE_DATA_ENABLED = "1";
  store.get = async () => { storeReads += 1; return Buffer.from("{}"); };
  for (const key of ["ai-rejections/2026-10-13.json", AI_REJECTIONS_LATEST_KEY, AI_REJECTION_SCORECARD_KEY]) {
    const reads = storeReads;
    const res = {
      headers: {}, statusCode: 200, body: null,
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return value; },
      end(value) { this.body = value; return value; },
    };
    await serveDataKey({ headers: {} }, res, key);
    assert.equal(res.statusCode, 401, key);
    assert.equal(res.body.error, "auth required");
    assert.match(res.headers["cache-control"], /private, no-store/);
    assert.equal(storeReads, reads, `${key} must not be read anonymously`);
    assert.equal(String(res.headers["cache-control"]).includes("public"), false);
  }
} finally {
  store.get = priorGet;
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
}

console.log("ai-rejections smoke test passed");
