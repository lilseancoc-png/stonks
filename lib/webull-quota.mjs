// Webull paper call limits (2026-11-23). Webull counts calls per app key and
// per endpoint, and its sandbox host (the only one the mirror may use) allows
// 30 calls a minute on each trading endpoint the mirror uses: place, preview,
// cancel, order detail, balance and positions
// (developer.webull.com/apis/docs/rate-limits, "Sandbox"). A call over the
// limit is answered 429 and not processed. With up to 15 new engine trades a
// run (5 before) plus Top Picks and exits, one run could pass it, and a 429
// on an order or an order read leaves the order unconfirmed, which pauses
// every entry until a person checks it.
//
// So the mirror keeps its own count: each call is logged in the ledger
// (`webullCalls`, epoch ms per endpoint, the last minute only), across runs,
// and a run that would pass `limit` calls in any minute stops before the
// call, the way it stops at its time budget (code RUN_BUDGET): what is left
// waits for the next run, the build window's two-minute follow-ups. Pure; the
// clock is passed in.

export const QUOTA_WINDOW_MS = 60000;
// 30 a minute at Webull's sandbox; three spare for clock skew between our
// log and Webull's counter.
export const QUOTA_PER_WINDOW = 27;
// Calls an entry leaves for the run's exits and cancels (exits never wait).
export const EXIT_RESERVE = 4;
export const QUOTA_ENDPOINTS = Object.freeze(["placeOrder", "previewOrder", "cancelOrder", "orderDetail", "balance", "positions"]);

export function quotaStop(endpoint) {
  return Object.assign(new Error(`Webull call limit reached (${endpoint})`), { code: "RUN_BUDGET", quota: endpoint });
}

// log: { endpoint: [ms, ...] } (mutated in place, kept to the last window).
export function makeCallQuota(log, { now = Date.now, limit = QUOTA_PER_WINDOW, windowMs = QUOTA_WINDOW_MS } = {}) {
  const L = log && typeof log === "object" ? log : {};
  const recent = (ep) => {
    const t = now(), keep = (Array.isArray(L[ep]) ? L[ep] : []).filter((ms) => Number.isFinite(ms) && ms > t - windowMs && ms <= t + windowMs);
    L[ep] = keep;
    return keep;
  };
  const used = {};
  return {
    log: L,
    left: (ep) => Math.max(0, limit - recent(ep).length),
    // need: { endpoint: calls }. True when every endpoint has that many left.
    fits(need) { return Object.entries(need || {}).every(([ep, n]) => !(n > 0) || limit - recent(ep).length >= n); },
    take(ep) {
      const list = recent(ep);
      if (list.length >= limit) return false;
      list.push(now()); used[ep] = (used[ep] || 0) + 1;
      return true;
    },
    used: () => ({ ...used }),
  };
}

// The client with each limited call counted first. A call with no room left
// throws quotaStop(endpoint) before anything is sent.
export function quotaClient(client, quota) {
  if (!client || !quota) return client;
  // Unlimited calls (accountList, optionContracts, ...) pass straight through.
  const wrapped = Object.create(client);
  for (const ep of QUOTA_ENDPOINTS) {
    if (typeof client[ep] !== "function") continue;
    wrapped[ep] = (...args) => {
      if (!quota.take(ep)) return Promise.reject(quotaStop(ep));
      return client[ep](...args);
    };
  }
  return wrapped;
}
