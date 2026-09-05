// Exercise emitted browser functions with deterministic clocks and transport.
import assert from "node:assert/strict";
import vm from "node:vm";

export async function verifyLiveRefresh(appJs) {
  function section(start, end) {
    const i = appJs.indexOf(start);
    const j = appJs.indexOf(end, i + start.length);
    assert(i >= 0 && j > i, `browser section: ${start}`);
    return appJs.slice(i, j);
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  let now = 100_000;
  let session = "PRE";
  let failQuote = false;
  let quoteRequests = 0;
  let chainRequests = 0;
  let timerId = 0;
  const timers = new Map();
  const pane = { hidden: false };
  const grade = {
    state: { symbol: "AAPL", currentExp: 1800000000, spot: 100 },
    LIVE_CACHE: { AAPL: { q: { spot: 100, marketState: "PRE" }, at: now } },
    LIVE_TTL_MS: 30000, CHAIN_POLL_MS: 30000,
    livePollTimer: null, livePollRequest: null, livePollQueued: null,
    Date: { now: () => now },
    document: { hidden: false, getElementById: () => pane },
    $: () => null,
    setInterval: fn => { timers.set(++timerId, fn); return timerId; },
    clearInterval: id => timers.delete(id),
    renderLiveRefreshIndicator: () => {}, renderLiveQuote: () => {}, evaluate: () => {},
    refreshLiveChain: () => { chainRequests++; },
    fetch: async () => {
      quoteRequests++;
      if (failQuote) throw new Error("offline");
      return { ok: true, json: async () => ({ spot: 100, marketState: session }) };
    },
  };
  vm.createContext(grade);
  vm.runInContext(section("  function refreshLiveQuote(", "  // Silent variant"), grade);
  vm.runInContext(section("  function applyLiveQuote(", "  // --- Live chain polling"), grade);
  vm.runInContext(section("  function currentMarketState(", "  // Pause when the tab is hidden"), grade);
  const tick = async () => {
    now += 30001;
    for (const fn of [...timers.values()]) fn();
    await settle();
  };
  grade.startLivePolling();
  assert.equal(timers.size, 1, "pre-market retains a session recheck timer");
  await tick();
  assert.equal(chainRequests, 0, "pre-market does not poll frozen option marks");
  failQuote = true;
  await tick();
  assert.equal(timers.size, 1, "failed session quote keeps a retry scheduled");
  failQuote = false;
  session = "REGULAR";
  await tick();
  assert.equal(grade.LIVE_CACHE.AAPL.q.marketState, "REGULAR");
  assert.equal(chainRequests, 1, "opening bell triggers an immediate chain refresh");
  assert.equal(timers.size, 1, "session transition does not duplicate timers");
  await tick();
  assert.equal(chainRequests, 2, "regular session continues chain polling");
  grade.document.hidden = true;
  grade.startLivePolling();
  assert.equal(timers.size, 0, "hidden browser pauses polling");
  const beforeResume = quoteRequests;
  now += 86400000;
  session = "PRE";
  grade.document.hidden = false;
  grade.startLivePolling();
  await settle();
  assert.equal(quoteRequests, beforeResume + 1, "resume refreshes yesterday's cached session");
  assert.equal(grade.LIVE_CACHE.AAPL.q.marketState, "PRE");
  pane.hidden = true;
  grade.startLivePolling();
  assert.equal(timers.size, 0, "leaving Grade pauses polling");

  const row = { t: "AAPL", ch: 1, sp: 100, av20: 1000, perf: { "1w": 5 } };
  const label = {};
  let failHeatmap = false;
  let paintedReturn;
  let breadthReturn;
  const heatmap = {
    heatmapState: { data: { tickers: [row] }, period: "1d", live: true, liveOverlay: {} },
    $: () => label,
    fetch: async () => {
      if (failHeatmap) throw new Error("offline");
      return { ok: true, json: async () => ({ quotes: [{ symbol: "AAPL", spot: 108, changePct: 8, marketState: "REGULAR", dayVolume: 2000 }] }) };
    },
    marketStateOfQuotes: () => "REGULAR", isRegularMarketQuote: () => true,
    execCumFracExpected: () => 1, execEtMinutesSinceOpen: () => 390,
    formatDisplayInstant: () => "test time", stopHeatmapLivePolling: () => {},
    renderHeatmapDecision: () => {},
    applyHeatmapLiveOverlay: () => { paintedReturn = heatmap.heatmapEffectiveCh(row); },
    renderHeatmapBreadth: () => { breadthReturn = heatmap.heatmapEffectiveCh(row); },
    renderHeatmap: () => { heatmap.applyHeatmapLiveOverlay(); heatmap.renderHeatmapBreadth(); },
  };
  vm.createContext(heatmap);
  vm.runInContext(section("  function heatmapBakedReturn(", "  function heatmapEffectiveRvol("), heatmap);
  vm.runInContext(section("  function pollHeatmapLiveOnce(", "  function applyHeatmapLiveOverlay("), heatmap);
  heatmap.pollHeatmapLiveOnce();
  await settle();
  assert.equal(paintedReturn, 8);
  assert.equal(breadthReturn, 8);
  failHeatmap = true;
  heatmap.pollHeatmapLiveOnce();
  await settle();
  assert.equal(paintedReturn, 1, "failed poll repaints baked tile returns");
  assert.equal(breadthReturn, 1, "failed poll restores baked breadth inputs");
  assert.equal(Object.keys(heatmap.heatmapState.liveOverlay).length, 0);
  heatmap.heatmapState.period = "1w";
  assert.equal(heatmap.heatmapEffectiveCh(row), 5, "long horizons also drop the stale live spot");
  assert.match(label.textContent, /showing baked close/);
  failHeatmap = false;
  heatmap.heatmapState.period = "1d";
  heatmap.pollHeatmapLiveOnce();
  await settle();
  assert.equal(paintedReturn, 8, "next successful poll restores live values");
}
