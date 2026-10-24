// Small, deterministic refresh policy. The browser embeds this factory and the
// verification script exercises the identical limits without real requests.
export function marketRefreshFactory() {
  const DAY = 24 * 60 * 60e3;
  const GAP = 15 * 60e3;
  const RETRY = 5 * 60e3;
  const LIMIT = 12;
  const validTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const token = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  function create(saved = {}, now = Date.now()) {
    return {
      attempts: (Array.isArray(saved.attempts) ? saved.attempts : []).filter((at) => validTime(at) && at > now - DAY && at <= now),
      lastCheckedAt: validTime(saved.lastCheckedAt) && saved.lastCheckedAt <= now ? saved.lastCheckedAt : 0,
      seen: (Array.isArray(saved.seen) ? saved.seen : []).map(token).filter(Boolean).slice(-32),
      pending: !!saved.pending, signalAttempts: Math.min(2, Math.max(0, Number(saved.signalAttempts) || 0)),
      retryAt: validTime(saved.retryAt) ? saved.retryAt : 0,
      inFlight: false,
    };
  }
  function observe(state, deploymentId) {
    const id = token(deploymentId);
    if (!id || state.seen.includes(id)) return;
    // The first response establishes a baseline; the initial snapshot request
    // already reads current saved data. Cached old deployment IDs cannot flap.
    if (state.seen.length) { state.pending = true; state.signalAttempts = 0; state.retryAt = 0; }
    state.seen.push(id);
    state.seen = state.seen.slice(-32);
  }
  function begin(state, { now = Date.now(), visible = false, reason = 'poll' } = {}) {
    state.attempts = state.attempts.filter((at) => at > now - DAY);
    if (!visible || state.inFlight || state.attempts.length >= LIMIT) return false;
    if (!state.pending && reason !== 'activate') return false;
    const retry = state.pending && state.signalAttempts === 1 && state.retryAt > 0;
    if (retry ? now < state.retryAt : now - state.lastCheckedAt < GAP) return false;
    state.inFlight = true;
    state.requestToken = state.seen.at(-1) || null;
    state.attempts.push(now);
    state.lastCheckedAt = now;
    state.signalAttempts = retry ? 2 : 1;
    state.retryAt = 0;
    state.pending = true;
    return true;
  }
  function finish(state, { now = Date.now(), ok = false } = {}) {
    state.inFlight = false;
    if (state.requestToken !== (state.seen.at(-1) || null)) {
      state.pending = true; state.retryAt = 0; state.signalAttempts = 0;
      return;
    }
    if (ok || state.signalAttempts >= 2) {
      state.pending = false; state.retryAt = 0; state.signalAttempts = 0;
    } else state.retryAt = now + RETRY;
  }
  function noteInitial(state, now = Date.now()) {
    state.lastCheckedAt = now;
    state.pending = false; state.retryAt = 0; state.signalAttempts = 0;
  }
  function snapshotVersion(payload, now = Date.now()) {
    const regime = payload?.macroRegime;
    const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const built = Date.parse(payload?.builtAtIso || '');
    const refreshed = payload?.refreshedAtIso ? Date.parse(payload.refreshedAtIso) : built;
    if (!object(regime) || !object(regime.axes) || !object(regime.inputs) || !object(regime.thresholds)
      || !['risk-on','neutral','risk-off','severe-risk-off','insufficient-data'].includes(regime.state)
      || !Number.isFinite(built) || !Number.isFinite(refreshed) || built > now + 5 * 60e3 || refreshed > now + 5 * 60e3) return null;
    return { built, refreshed: Math.max(built, refreshed) };
  }
  function compareSnapshot(current, candidate, now = Date.now()) {
    const next = snapshotVersion(candidate, now), previous = snapshotVersion(current, now);
    if (!next) return 'invalid';
    if (!previous) return 'newer';
    if (next.built < previous.built || (next.built === previous.built && next.refreshed < previous.refreshed)) return 'older';
    return next.built === previous.built && next.refreshed === previous.refreshed ? 'same' : 'newer';
  }
  return { create, observe, begin, finish, noteInitial, compareSnapshot, limits: { maxReads: LIMIT, windowMs: DAY, gapMs: GAP, retryMs: RETRY } };
}

export const marketRefresh = marketRefreshFactory();
