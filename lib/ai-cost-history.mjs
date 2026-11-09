// Daily AI cost ledger (2026-11-08).
//
// data/ai-usage.json keeps only 14 days of token buckets. This file keeps one
// compact row per day for about 400 days — calls, tokens, the estimated
// dollar cost at the paid token rates, and the cost split by call type and
// model — so the "$1 a day" goal can be read over months instead of two
// weeks. It is upserted from the usage ledger every time that ledger is
// written (build.mjs writeAiUsageState), by the same producers, and is
// Owner-only. No AI call, no network.

export const AI_COST_HISTORY_KEY = "ai-cost-history.json";
export const AI_COST_HISTORY_VERSION = 1;
export const AI_COST_HISTORY_DAYS = 400;
export const AI_COST_TARGET_USD = 1.0;

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyAiCostHistory() {
  return { v: AI_COST_HISTORY_VERSION, target: AI_COST_TARGET_USD, updatedAt: null, days: [] };
}

export function parseAiCostHistory(body) {
  if (body == null) return null;
  let parsed;
  try { parsed = typeof body === "string" ? JSON.parse(body) : body; } catch { return null; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.days)) return null;
  const out = emptyAiCostHistory();
  out.days = parsed.days.filter((d) => d && DATE_RE.test(d.d || "")).map((d) => ({ ...d }));
  return out;
}

// One day's row from the usage ledger's per-model / per-call-type buckets.
// priceFn(model, bucket) -> USD or null (build.mjs estimateAiBucketCost).
export function costRowFromUsage(date, byModel, priceFn) {
  const row = { d: date, calls: 0, in: 0, out: 0, cached: 0, thought: 0, search: 0, usd: 0, types: {}, models: {}, unpriced: [] };
  for (const [model, buckets] of Object.entries(byModel || {})) {
    if (!buckets || typeof buckets !== "object") continue;
    let modelUsd = 0;
    for (const [type, b] of Object.entries(buckets)) {
      if (!b || typeof b !== "object") continue;
      row.calls += Number(b.calls) || 0;
      row.in += Number(b.inputTokens) || 0;
      row.out += Number(b.outputTokens) || 0;
      row.cached += Number(b.cachedTokens) || 0;
      row.thought += Number(b.thoughtTokens) || 0;
      row.search += Number(b.searchQueries) || 0;
      const usd = typeof priceFn === "function" ? priceFn(model, b) : null;
      if (usd == null) { if (!row.unpriced.includes(model)) row.unpriced.push(model); continue; }
      row.usd += usd;
      modelUsd += usd;
      const t = (row.types[type] ||= { calls: 0, usd: 0 });
      t.calls += Number(b.calls) || 0;
      t.usd = r4(t.usd + usd);
    }
    if (modelUsd) row.models[model] = r4((row.models[model] || 0) + modelUsd);
  }
  row.usd = r4(row.usd);
  if (!row.unpriced.length) delete row.unpriced;
  return row;
}

// Upsert every day the usage ledger still carries, keep the newest N days.
export function upsertAiCostHistory(prev, usageState, priceFn, { now = new Date().toISOString() } = {}) {
  const hist = prev && Array.isArray(prev.days) ? { ...emptyAiCostHistory(), ...prev, days: prev.days.slice() } : emptyAiCostHistory();
  const byDate = new Map(hist.days.map((d) => [d.d, d]));
  for (const [date, byModel] of Object.entries(usageState?.dates || {})) {
    if (!DATE_RE.test(date)) continue;
    byDate.set(date, costRowFromUsage(date, byModel, priceFn));
  }
  hist.days = [...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).slice(-AI_COST_HISTORY_DAYS);
  hist.target = AI_COST_TARGET_USD;
  hist.updatedAt = now;
  return hist;
}

// Averages for the board: calendar days and the days that actually ran AI.
export function summarizeAiCost(hist, { today = null, windowDays = 30 } = {}) {
  const days = (hist?.days || []).filter((d) => !today || d.d <= today);
  if (!days.length) return { days: 0, last7: null, last30: null, activeAvg30: null, overTarget30: 0, max30: null, total30: null };
  const asOf = today || days[days.length - 1].d;
  const cut = (n) => new Date(Date.parse(`${asOf}T12:00:00Z`) - (n - 1) * 86400000).toISOString().slice(0, 10);
  const win = (n) => days.filter((d) => d.d >= cut(n));
  const avg = (list, n) => (list.length ? r4(list.reduce((a, d) => a + (d.usd || 0), 0) / n) : null);
  const w7 = win(7), w30 = win(windowDays);
  const active = w30.filter((d) => (d.calls || 0) > 0);
  return {
    days: days.length, first: days[0].d, last: days[days.length - 1].d,
    last7: avg(w7, 7), last30: avg(w30, windowDays),
    activeAvg30: active.length ? r4(active.reduce((a, d) => a + (d.usd || 0), 0) / active.length) : null,
    overTarget30: w30.filter((d) => (d.usd || 0) > (hist.target || AI_COST_TARGET_USD)).length,
    max30: w30.length ? r4(Math.max(...w30.map((d) => d.usd || 0))) : null,
    total30: w30.length ? r4(w30.reduce((a, d) => a + (d.usd || 0), 0)) : null,
    target: hist.target || AI_COST_TARGET_USD,
  };
}
