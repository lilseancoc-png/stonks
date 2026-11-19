// Smoke test for lib/ai-prompt-cache.mjs (2026-11-19): the primed first call,
// the explicit cache, the request shapes, and a simulated burst of judgment
// calls against a fake Gemini whose implicit cache only serves a request that
// arrives after an earlier one finished. No network.
// node scripts/ai-prompt-cache-smoke.mjs
import assert from "node:assert/strict";
import {
  createPrimeGate,
  createExplicitPromptCache,
  createCacheTally,
  isCacheRequestError,
  buildCachedRequest,
} from "../lib/ai-prompt-cache.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}\n${err.stack || err}`);
    process.exitCode = 1;
  }
}

const PROMPT = "SHARED INSTRUCTIONS ".repeat(50).trim();

// A fake Gemini. Implicit cache: a request whose contents start with PROMPT
// gets cached tokens only when an earlier request with that prefix has
// already FINISHED (the real behavior that broke the burst). Explicit cache:
// ai.caches.create / delete, and generateContent honors config.cachedContent.
function fakeAi({ createFails = null, cachedRequestFails = null, latencyMs = 20, promptTokens = 2900, msgTokens = 1500 } = {}) {
  const calls = [];
  const caches = new Map();
  let prefixWritten = false;
  const ai = {
    calls,
    caches: {
      async create({ model, config }) {
        if (createFails) { const e = new Error(createFails.message); e.status = createFails.status; throw e; }
        const name = `cachedContents/fake-${caches.size + 1}`;
        caches.set(name, { model, systemInstruction: config.systemInstruction, ttl: config.ttl });
        return { name, usageMetadata: { totalTokenCount: promptTokens } };
      },
      async delete({ name }) { caches.delete(name); return {}; },
      get size() { return caches.size; },
      has: (n) => caches.has(n),
    },
    models: {
      async generateContent(req) {
        calls.push(req);
        const startedAfterWrite = prefixWritten;
        await sleep(latencyMs);
        const name = req.config?.cachedContent;
        if (name) {
          if (cachedRequestFails) { const e = new Error(cachedRequestFails.message); e.status = cachedRequestFails.status; throw e; }
          if (!caches.has(name)) { const e = new Error("CachedContent not found (or permission denied)"); e.status = 404; throw e; }
          if (caches.get(name).model !== req.model) { const e = new Error("Model mismatch for cached content"); e.status = 400; throw e; }
          return { text: "{}", usageMetadata: { promptTokenCount: promptTokens + msgTokens, cachedContentTokenCount: promptTokens, candidatesTokenCount: 100 } };
        }
        const sharedPrefix = typeof req.contents === "string" && req.contents.startsWith(PROMPT);
        const cached = sharedPrefix && startedAfterWrite ? promptTokens : 0;
        if (sharedPrefix) prefixWritten = true;
        return { text: "{}", usageMetadata: { promptTokenCount: promptTokens + msgTokens, cachedContentTokenCount: cached, candidatesTokenCount: 100 } };
      },
    },
  };
  return ai;
}

// The call loop from scripts/build.mjs generateTickerJudgment, reduced to
// the caching parts: gate, explicit cache, request shape, cache-error retry.
async function judgmentCall(ai, pc, symbol, { model = "flash-lite", fallbackModel = "flash-lite-2", failFirstAttempt = false } = {}) {
  const ticket = pc ? await pc.gate.enter() : null;
  const releasePrime = (ok) => { if (ticket?.primer) ticket.release(ok); };
  let response;
  try {
    if (pc) await pc.explicit.ensure();
    let cacheRetried = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const m = attempt === 0 ? model : fallbackModel;
      const cacheName = pc ? pc.explicit.nameFor(m) : null;
      try {
        if (failFirstAttempt && attempt === 0) { const e = new Error("503 overloaded"); e.status = 503; throw e; }
        response = await ai.models.generateContent(buildCachedRequest({ model: m, prompt: PROMPT, message: `Ticker: ${symbol}`, cacheName, config: { temperature: 0.3 } }));
        if (pc) pc.tally.add(response.usageMetadata, { explicit: !!cacheName });
        break;
      } catch (err) {
        if (cacheName && !cacheRetried && isCacheRequestError(err)) {
          cacheRetried = true;
          pc.explicit.disable(`refused: ${err.message}`);
          attempt -= 1;
          continue;
        }
        releasePrime(false);
        if (attempt === 2) throw err;
      }
    }
  } finally {
    releasePrime(!!response);
  }
  return response;
}

function passState(ai, { prime = true, explicit = true, model = "flash-lite", waitMs = 2000, settleMs = 5 } = {}) {
  const logs = [];
  return {
    logs,
    gate: createPrimeGate({ enabled: prime, waitMs, settleMs }),
    explicit: createExplicitPromptCache({ enabled: explicit, ai, model, systemInstruction: PROMPT, ttlSeconds: 900, log: (m) => logs.push(m) }),
    tally: createCacheTally(),
  };
}

const SYMS = Array.from({ length: 30 }, (_, i) => `T${i}`);

await test("request shapes: explicit, contents prefix, system instruction", () => {
  const base = { temperature: 0.3, responseMimeType: "application/json" };
  const a = buildCachedRequest({ model: "m", prompt: "P", message: "M", config: base, cacheName: "cachedContents/x" });
  assert.deepEqual(a, { model: "m", config: { ...base, cachedContent: "cachedContents/x" }, contents: "M" });
  assert.equal(a.config.systemInstruction, undefined, "a cached request must not also send the system instruction");
  const b = buildCachedRequest({ model: "m", prompt: "P", message: "M", config: base });
  assert.deepEqual(b, { model: "m", config: base, contents: "P\n\nM" });
  const c = buildCachedRequest({ model: "m", prompt: "P", message: "M", config: base, promptInContents: false });
  assert.deepEqual(c, { model: "m", config: { ...base, systemInstruction: "P" }, contents: "M" });
  assert.notEqual(b.config, base, "the caller's config object is not mutated or shared");
});

await test("burst with no caching help: almost nothing hits (the old behavior)", async () => {
  const ai = fakeAi();
  await Promise.all(SYMS.map((s) => judgmentCall(ai, null, s)));
  const hits = ai.calls.filter((_, i) => i > 0).length;
  assert.equal(ai.calls.length, 30);
  assert.ok(hits >= 0);
  // Reproduce the measured failure: every call started before any finished.
  const ai2 = fakeAi();
  const pc = passState(ai2, { prime: false, explicit: false });
  await Promise.all(SYMS.map((s) => judgmentCall(ai2, pc, s)));
  assert.equal(pc.tally.totals.cached, 0, "a pure burst writes the prefix too late for every call");
});

await test("primed first call: every later call hits the implicit cache", async () => {
  const ai = fakeAi();
  const pc = passState(ai, { prime: true, explicit: false });
  await Promise.all(SYMS.map((s) => judgmentCall(ai, pc, s)));
  const t = pc.tally.totals;
  assert.equal(t.calls, 30);
  assert.equal(t.cached, 29 * 2900, "all but the primer are served from cache");
  assert.equal(pc.gate.stats.primed, true);
  assert.equal(pc.gate.stats.waited, 29);
  assert.equal(pc.gate.stats.timedOut, 0);
});

await test("explicit cache: one create, every call cached, delete at the end", async () => {
  const ai = fakeAi();
  const pc = passState(ai, { prime: true, explicit: true });
  await Promise.all(SYMS.map((s) => judgmentCall(ai, pc, s)));
  const t = pc.tally.totals;
  assert.equal(t.cached, 30 * 2900);
  assert.equal(t.explicitCalls, 30);
  assert.equal(ai.caches.size, 1);
  for (const c of ai.calls) {
    assert.equal(c.contents.startsWith(PROMPT), false, "cached calls send only the message");
    assert.equal(c.config.systemInstruction, undefined);
  }
  assert.equal(await pc.explicit.drop(), true);
  assert.equal(ai.caches.size, 0);
  assert.equal(pc.explicit.status.state, "used");
});

await test("explicit cache refused at create (too small): falls back to the primed implicit cache", async () => {
  const ai = fakeAi({ createFails: { status: 400, message: "Cached content is too small. total_token_count=2900, min_total_token_count=4096" } });
  const pc = passState(ai, { prime: true, explicit: true });
  await Promise.all(SYMS.map((s) => judgmentCall(ai, pc, s)));
  const t = pc.tally.totals;
  assert.equal(t.explicitCalls, 0);
  assert.equal(t.cached, 29 * 2900);
  assert.equal(pc.explicit.status.state, "off");
  assert.match(pc.explicit.status.reason, /too small/);
  assert.equal(await pc.explicit.drop(), false);
});

await test("explicit cache refused on use: turns off once, the same attempt reruns without it", async () => {
  const ai = fakeAi({ cachedRequestFails: { status: 400, message: "INVALID_ARGUMENT: cachedContent can not be used with this request" } });
  const pc = passState(ai, { prime: true, explicit: true });
  const results = await Promise.all(SYMS.map((s) => judgmentCall(ai, pc, s)));
  assert.equal(results.filter(Boolean).length, 30, "every call still answers");
  assert.equal(pc.explicit.status.state, "off");
  assert.equal(pc.tally.totals.explicitCalls, 0);
  // Only the primer saw the cache error; it reran in the normal shape before
  // the others went, so they still find the implicit cache.
  const cachedTries = ai.calls.filter((c) => c.config.cachedContent).length;
  assert.equal(cachedTries, 1, "only the primer tried the refused cache");
  assert.equal(pc.tally.totals.cached, 29 * 2900, "the rest still hit the primed implicit cache");
});

await test("a fallback model never gets another model's cache", async () => {
  const ai = fakeAi();
  const pc = passState(ai, { prime: true, explicit: true });
  await judgmentCall(ai, pc, "AAA", { failFirstAttempt: true });
  const sent = ai.calls[ai.calls.length - 1];
  assert.equal(sent.model, "flash-lite-2");
  assert.equal(sent.config.cachedContent, undefined);
  assert.equal(pc.explicit.nameFor("flash-lite"), ai.calls.length ? pc.explicit.status.name : null);
  assert.equal(pc.explicit.nameFor("flash-lite-2"), null);
});

await test("a failed primer still opens the gate (no one waits for the timeout)", async () => {
  const gate = createPrimeGate({ enabled: true, waitMs: 5000, settleMs: 0 });
  const p = await gate.enter();
  assert.equal(p.primer, true);
  const t0 = Date.now();
  const waiter = gate.enter();
  setTimeout(() => p.release(), 30);
  await waiter;
  assert.ok(Date.now() - t0 < 1000, "released promptly");
  p.release(); // safe twice
  assert.equal(gate.stats.timedOut, 0);
});

await test("a primer that fails reports primed: no and opens the gate without the settle wait", async () => {
  const gate = createPrimeGate({ enabled: true, waitMs: 5000, settleMs: 400 });
  const p = await gate.enter();
  const t0 = Date.now();
  const waiter = gate.enter();
  p.release(false);
  await waiter;
  assert.ok(Date.now() - t0 < 300, "no settle wait after a failed primer");
  assert.equal(gate.stats.primed, false);
  // A primer whose first attempt fails and whose retry succeeds still counts as failed:
  // the waiters went ahead without a cached prefix.
  const ai = fakeAi();
  const pc = passState(ai, { prime: true, explicit: false });
  await Promise.all(SYMS.slice(0, 5).map((s, i) => judgmentCall(ai, pc, s, { failFirstAttempt: i === 0 })));
  assert.equal(pc.gate.stats.primed, false);
  assert.equal(pc.tally.totals.calls, 5, "every call still answers");
});

await test("a primer that never releases: waiters give up after waitMs", async () => {
  const gate = createPrimeGate({ enabled: true, waitMs: 60, settleMs: 0 });
  await gate.enter();
  const t0 = Date.now();
  const w = await gate.enter();
  assert.equal(w.primer, false);
  assert.ok(Date.now() - t0 >= 50);
  assert.equal(gate.stats.timedOut, 1);
});

await test("a disabled gate lets everyone through at once", async () => {
  const gate = createPrimeGate({ enabled: false });
  const a = await gate.enter();
  const b = await gate.enter();
  assert.equal(a.primer, false);
  assert.equal(b.primer, false);
  assert.equal(gate.stats.started, false);
});

await test("concurrent ensure() makes one cache", async () => {
  const ai = fakeAi();
  const ex = createExplicitPromptCache({ enabled: true, ai, model: "m", systemInstruction: PROMPT });
  const names = await Promise.all([ex.ensure(), ex.ensure(), ex.ensure()]);
  assert.equal(new Set(names).size, 1);
  assert.equal(ai.caches.size, 1);
});

await test("beforeCreate refusal (daily budget) turns the explicit cache off without throwing", async () => {
  const ai = fakeAi();
  const ex = createExplicitPromptCache({ enabled: true, ai, model: "m", systemInstruction: PROMPT, beforeCreate: async () => { throw new Error("AI daily call cap exceeded"); } });
  assert.equal(await ex.ensure(), null);
  assert.equal(ex.status.state, "off");
  assert.equal(ai.caches.size, 0);
});

await test("switched off, or a client with no caches API: never creates", async () => {
  const ai = fakeAi();
  const off = createExplicitPromptCache({ enabled: false, ai, model: "m", systemInstruction: PROMPT });
  assert.equal(await off.ensure(), null);
  assert.equal(off.status.state, "off");
  const bare = createExplicitPromptCache({ enabled: true, ai: { models: ai.models }, model: "m", systemInstruction: PROMPT });
  assert.equal(await bare.ensure(), null);
  assert.equal(ai.caches.size, 0);
});

await test("not needed: no call asked for the cache", async () => {
  const ai = fakeAi();
  const ex = createExplicitPromptCache({ enabled: true, ai, model: "m", systemInstruction: PROMPT });
  await ex.drop();
  assert.equal(ex.status.state, "not needed");
});

await test("cache-error classifier", () => {
  const e = (status, message) => Object.assign(new Error(message), { status });
  assert.equal(isCacheRequestError(e(404, "not found")), true);
  assert.equal(isCacheRequestError(e(400, "bad")), true);
  assert.equal(isCacheRequestError(e(403, "denied")), true);
  assert.equal(isCacheRequestError(e(429, "RESOURCE_EXHAUSTED")), false);
  assert.equal(isCacheRequestError(e(503, "overloaded")), false);
  assert.equal(isCacheRequestError(new Error("CachedContent not found")), true);
  assert.equal(isCacheRequestError(new Error("socket hang up")), false);
});

await test("tally summary", () => {
  const t = createCacheTally();
  t.add({ promptTokenCount: 4000, cachedContentTokenCount: 2900 }, { explicit: true });
  t.add({ promptTokenCount: 4000, cachedContentTokenCount: 0 });
  t.add(undefined);
  assert.equal(t.totals.calls, 3);
  assert.equal(t.totals.cached, 2900);
  assert.equal(t.totals.explicitCalls, 1);
  assert.match(t.summary("x"), /^x: 3 call\(s\), 2,900 of 8,000 input tokens cached \(36\.3%\), 1 via the explicit cache$/);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
