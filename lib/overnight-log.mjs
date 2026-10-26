// The saved overnight call history (data/overnight-log.json) and its grading.
//
// One entry per US session: the pre-open call (tone, gap call, session call,
// inputs) and, once that session has closed, how SPY/QQQ actually traded:
// gap (open vs prior close), session (close vs open) and close-to-close.
// Entries are never overwritten by a later read: a live 09:00 ET call replaces
// a bake-rebuilt ("reconstructed") one for the same day, never the reverse, and
// a later live call the same morning replaces an earlier one only while both
// are pre-open.

import { OVERNIGHT_TONE } from "./overnight-tone.mjs";

export const OVERNIGHT_LOG_KEY = "overnight-log.json";
export const OVERNIGHT_PREOPEN_KEY = "overnight-preopen.json";
export const OVERNIGHT_LOG_MAX_ENTRIES = 750;

function better(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  // Live beats reconstructed.
  if (existing.reconstructed && !incoming.reconstructed) return incoming;
  if (!existing.reconstructed && incoming.reconstructed) return existing;
  // Same kind: the later pre-open capture wins (both are before 09:30 ET).
  return String(incoming.capturedAtIso || "") > String(existing.capturedAtIso || "") ? incoming : existing;
}

// Drop the heavy per-input block from entries older than ~30 sessions to keep
// the file small; the tone/buckets needed for grading stay.
function compact(entry, keepInputs) {
  if (keepInputs || !entry?.inputs) return entry;
  const { inputs: _drop, ...rest } = entry;
  return rest;
}

export function mergeOvernightLog(prior, { calls = [], spyBars = [], qqqBars = [], nowIso = new Date().toISOString() } = {}) {
  const byDate = new Map();
  for (const e of prior?.entries || []) if (e?.date) byDate.set(e.date, e);
  for (const c of calls) if (c?.date) byDate.set(c.date, better(byDate.get(c.date), c));
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-OVERNIGHT_LOG_MAX_ENTRIES);
  const graded = sorted.map((e) => (e.outcome && e.outcome.spy ? e : OVERNIGHT_TONE.gradeEntry(e, spyBars, qqqBars)));
  const entries = graded.map((e, i) => compact(e, i >= graded.length - 30));
  return {
    version: OVERNIGHT_TONE.VERSION,
    updatedAtIso: nowIso,
    entries,
    stats: OVERNIGHT_TONE.summarize(entries),
  };
}

// The tab only needs the latest call, the recent graded rows and the stats.
export function overnightLogSummary(log, recent = 15) {
  const entries = log?.entries || [];
  const last = entries[entries.length - 1] || null;
  return {
    stats: log?.stats || OVERNIGHT_TONE.summarize([]),
    latest: last,
    recent: entries.slice(-recent).reverse().map((e) => ({
      date: e.date,
      label: e.tone?.label || null,
      score: e.tone?.score ?? null,
      gap: e.tone?.gap?.call || null,
      gapMovePct: e.tone?.gap?.movePct ?? null,
      reconstructed: !!e.reconstructed,
      outcome: e.outcome ? {
        gapPct: e.outcome.spy?.gapPct ?? null,
        sessionPct: e.outcome.spy?.sessionPct ?? null,
        ccPct: e.outcome.spy?.ccPct ?? null,
        gapCallHit: e.outcome.gapCallHit,
        toneSessionHit: e.outcome.toneSessionHit,
      } : null,
    })),
    n: entries.length,
  };
}
