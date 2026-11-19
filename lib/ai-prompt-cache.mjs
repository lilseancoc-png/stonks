// Prompt caching for one shared instruction block sent with many calls
// (2026-11-19).
//
// The ticker-judgment pass sends the same ~2,900-token instruction block with
// every stock's own news. Gemini caches a repeated prefix on its own
// ("implicit" caching), but only for a request that arrives after an earlier
// one has written that prefix to the cache. The pass fires all of its calls in
// one burst (about 84 within four seconds at 600 requests a minute), so almost
// none arrived late enough: 16 of 539 calls hit the cache on 2026-11-17/18.
//
// Two fixes, both here, both pure enough to test without the network:
//   - createPrimeGate: the first call goes alone; the rest wait until it has
//     answered (plus a short settle), then go together and find the cache.
//   - createExplicitPromptCache: one explicit cache of the instruction block,
//     made at the start of the pass and deleted at the end. Its discount is
//     guaranteed rather than best effort. Google lists no minimum size for
//     Flash-Lite (it's 4,096 tokens for the 3.x Flash models), so the first
//     create is the probe: any failure turns it off for the pass and the
//     primed implicit cache carries on.
// Cached input bills at 10% of the input price (Flash-Lite: $0.025 against
// $0.25 per million tokens); explicit storage bills $1.00 per million tokens an
// hour, about $0.0007 for a 2,900-token block kept 15 minutes.

// The timers below are deliberately NOT unref'd: while callers wait on the
// gate nothing else may be holding the event loop open, and an unref'd timer
// would let Node exit with the waiters still pending. Both are short and
// cleared or finished when the gate opens.
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve `promise`, or give up after `ms` — whichever comes first. The timer
// is cleared when the promise wins so nothing lingers.
function raceTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((r) => { timer = setTimeout(r, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The first caller to enter() is the primer and gets `release()`; every later
// caller waits until the primer releases (plus `settleMs`), or `waitMs` at
// most. A disabled gate lets everyone through at once. release() is safe to
// call more than once and from a failed call.
export function createPrimeGate({ enabled = true, waitMs = 45000, settleMs = 1500, sleep = realSleep } = {}) {
  let state = null;
  const stats = { primed: false, waited: 0, timedOut: 0 };
  return {
    async enter() {
      if (!enabled) return { primer: false, release() {} };
      if (!state) {
        let resolve;
        const done = new Promise((r) => { resolve = r; });
        state = { done, resolve, releasing: false, open: false };
        const st = state;
        return {
          primer: true,
          release() {
            if (st.releasing) return;
            st.releasing = true;
            stats.primed = true;
            Promise.resolve(settleMs > 0 ? sleep(settleMs) : null).then(() => { st.open = true; st.resolve(); });
          },
        };
      }
      if (!state.open) {
        stats.waited += 1;
        const st = state;
        await raceTimeout(st.done, waitMs);
        if (!st.open) stats.timedOut += 1;
      }
      return { primer: false, release() {} };
    },
    get stats() { return { ...stats, started: !!state }; },
  };
}

// True for a request error that a bad or missing cache can cause: a 400
// (invalid argument), 403 (permission) or 404 (not found / expired) from the
// API, or an error message that names the cache. Rate limits and server
// errors are not cache errors and keep their normal retry path.
export function isCacheRequestError(err) {
  const status = Number(err?.status ?? err?.code ?? err?.response?.status);
  if ([400, 403, 404].includes(status)) return true;
  const msg = String(err?.message || err || "");
  return /cached ?content|cache[ds]? (?:not found|expired|is too small)|cachedContents\//i.test(msg)
    || /\b(?:INVALID_ARGUMENT|NOT_FOUND|PERMISSION_DENIED)\b/.test(msg) && /cache/i.test(msg);
}

// One explicit cache of a system instruction for one model, made on first
// use. `ensure()` returns the cache name or null; `nameFor(model)` gives the
// name only for the model it was made for (a retry on a fallback model must
// not send another model's cache); `disable(reason)` turns it off for the rest
// of the pass; `drop()` deletes it. Every failure is logged and turns it off —
// it never throws.
export function createExplicitPromptCache({
  enabled = true,
  ai,
  model,
  systemInstruction,
  ttlSeconds = 900,
  displayName = "prompt-cache",
  beforeCreate = null,
  onCreated = null,
  log = () => {},
} = {}) {
  const st = { name: null, disabled: !enabled || !ai?.caches?.create, reason: enabled ? null : "switched off", creating: null, tokens: null, created: false };
  if (enabled && !ai?.caches?.create) st.reason = "client has no caches API";
  return {
    async ensure() {
      if (st.disabled) return null;
      if (st.name) return st.name;
      if (!st.creating) {
        st.creating = (async () => {
          try {
            if (beforeCreate) await beforeCreate();
            const cache = await ai.caches.create({
              model,
              config: { systemInstruction, ttl: `${Math.max(60, Math.round(ttlSeconds))}s`, displayName },
            });
            if (!cache?.name) throw new Error("the API returned no cache name");
            st.name = cache.name;
            st.created = true;
            st.tokens = Number(cache?.usageMetadata?.totalTokenCount) || null;
            log(`explicit prompt cache ready (${st.tokens ?? "?"} tokens, ${ttlSeconds}s)`);
            if (onCreated) {
              try { onCreated(cache); } catch { /* accounting only */ }
            }
          } catch (err) {
            st.disabled = true;
            st.reason = String(err?.message || err).split("\n")[0].slice(0, 160);
            log(`explicit prompt cache off for this pass: ${st.reason}`);
          }
        })();
      }
      await st.creating;
      return st.disabled ? null : st.name;
    },
    nameFor(attemptModel) {
      return !st.disabled && st.name && attemptModel === model ? st.name : null;
    },
    disable(reason) {
      if (st.disabled) return;
      st.disabled = true;
      st.reason = String(reason || "disabled").slice(0, 160);
      log(`explicit prompt cache off for this pass: ${st.reason}`);
    },
    async drop() {
      const name = st.name;
      st.name = null;
      st.disabled = true;
      if (!st.reason) st.reason = "pass finished";
      if (!name || !ai?.caches?.delete) return false;
      try {
        await ai.caches.delete({ name });
        return true;
      } catch (err) {
        log(`explicit prompt cache delete failed (it expires on its own): ${String(err?.message || err).split("\n")[0].slice(0, 120)}`);
        return false;
      }
    },
    get status() {
      // state: "used" (made, and still on when the pass ended), "off" (switched
      // off, refused or dropped after an error), or "not needed" (no call
      // asked for it, e.g. every judgment came from the cross-build cache).
      const state = st.created && (st.reason == null || st.reason === "pass finished") ? "used"
        : st.reason && st.reason !== "pass finished" ? "off" : "not needed";
      return { on: !st.disabled && !!st.name, name: st.name, reason: st.reason, tokens: st.tokens, created: st.created, state };
    },
  };
}

// Running totals for one pass: calls, input tokens, cached tokens.
export function createCacheTally() {
  const t = { calls: 0, input: 0, cached: 0, explicitCalls: 0 };
  return {
    add(usage, { explicit = false } = {}) {
      t.calls += 1;
      t.input += Number(usage?.promptTokenCount) || 0;
      t.cached += Number(usage?.cachedContentTokenCount) || 0;
      if (explicit) t.explicitCalls += 1;
    },
    get totals() { return { ...t, cachedShare: t.input > 0 ? t.cached / t.input : 0 }; },
    summary(label = "prompt cache") {
      const pct = t.input > 0 ? ((t.cached / t.input) * 100).toFixed(1) : "0.0";
      return `${label}: ${t.calls} call(s), ${t.cached.toLocaleString("en-US")} of ${t.input.toLocaleString("en-US")} input tokens cached (${pct}%), ${t.explicitCalls} via the explicit cache`;
    },
  };
}

// The request for one call. With an explicit cache the cached block stands in
// as the system instruction and only the per-call message is sent; without one
// the block leads `contents` (so the implicit cache sees one long shared
// prefix) or rides as the system instruction when `promptInContents` is off.
export function buildCachedRequest({ model, prompt, message, config = {}, cacheName = null, promptInContents = true }) {
  if (cacheName) return { model, config: { ...config, cachedContent: cacheName }, contents: message };
  if (!promptInContents) return { model, config: { ...config, systemInstruction: prompt }, contents: message };
  return { model, config: { ...config }, contents: `${prompt}\n\n${message}` };
}
