// Gemini Batch mode for earnings-call summaries (2026-11-08).
//
// The earnings-call brief is one full-model call per name per quarter with a
// whole transcript as input, the priciest tokens on the site. Batch mode
// prices the same call at half the inline rate. The trade is latency: a
// batch job finishes when Google gets to it (minutes to hours, 24h at most).
//
// Flow, in build.mjs updateEarningsCallsData:
//   1. Any batch left pending by the previous transcript slot is checked
//      first. Finished → its briefs are written like inline ones. Failed,
//      expired or too old → dropped and the names go back to discovery.
//      Still running → carried, and its names are kept out of this run.
//   2. The names found this run are fetched and parsed as before, then sent
//      as ONE batch job instead of N inline calls. The job is polled for up
//      to TRANSCRIPT_BATCH_WAIT_MIN minutes (default 10); whatever is not
//      finished by then is stored as `pendingBatch` in earnings-calls.json
//      and collected at the next 09:00 / 19:00 ET slot.
//   3. If the batch request itself fails (quota, API shape, outage), the run
//      falls back to the inline path for the same names at once, so nothing
//      is lost and the inline fallback ladder still applies.
// TRANSCRIPT_BATCH=0 turns batch mode off. Pure helpers live here so they
// can be tested without the SDK; the SDK calls stay in build.mjs.

export const TRANSCRIPT_BATCH_MAX_AGE_HOURS = 30;
export const TRANSCRIPT_BATCH_POLL_MS = 20_000;

export function transcriptBatchEnabled(env = process.env) {
  return !/^(?:0|false|off)$/i.test(String(env.TRANSCRIPT_BATCH ?? "1"));
}

export function transcriptBatchWaitMs(env = process.env) {
  const min = Number(env.TRANSCRIPT_BATCH_WAIT_MIN);
  return Number.isFinite(min) && min >= 0 ? Math.min(45, min) * 60_000 : 10 * 60_000;
}

const DONE_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"]);

export function batchJobDone(state) { return DONE_STATES.has(String(state || "")); }
export function batchJobSucceeded(state) { return String(state || "") === "JOB_STATE_SUCCEEDED"; }

// One inlined request per transcript. `metadata.sym` lets a response be
// matched by name even if the service reorders them.
export function buildTranscriptBatchRequests(items, { model, config } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.sym === "string" && typeof it.userMessage === "string" && it.userMessage.length)
    .map((it) => ({
      ...(model ? { model } : {}),
      contents: [{ role: "user", parts: [{ text: it.userMessage }] }],
      config,
      metadata: { sym: it.sym },
    }));
}

// The compact record carried in earnings-calls.json while a job runs. The
// transcript text is NOT kept — only what the finished brief needs.
export function pendingBatchRecord({ name, model, submittedAtIso, items }) {
  if (!name || !Array.isArray(items) || !items.length) return null;
  return {
    name: String(name),
    model: model || null,
    submittedAtIso: submittedAtIso || new Date().toISOString(),
    items: items.map((it) => ({
      sym: it.sym, company: it.company || it.sym, quarter: it.quarter || null, callDate: it.callDate || null,
      published: it.published || null, url: it.url || null, source: it.source || null, textLength: it.textLength || null,
      sourceInput: it.sourceInput ? {
        coverage: it.sourceInput.coverage ?? null, originalChars: it.sourceInput.originalChars ?? null,
        suppliedChars: it.sourceInput.suppliedChars ?? null, sourceHash: it.sourceInput.sourceHash ?? null,
      } : null,
    })),
  };
}

export function pendingBatchSymbols(pending) {
  return Array.isArray(pending?.items) ? pending.items.map((it) => it?.sym).filter((s) => typeof s === "string") : [];
}

export function pendingBatchTooOld(pending, nowIso, maxAgeHours = TRANSCRIPT_BATCH_MAX_AGE_HOURS) {
  const t = Date.parse(pending?.submittedAtIso || "");
  const now = Date.parse(nowIso || "") || Date.now();
  if (!Number.isFinite(t)) return true;
  return now - t > maxAgeHours * 3_600_000;
}

// Text of a GenerateContentResponse that arrived as plain JSON (no SDK
// getters): the concatenated text parts of the first candidate.
export function batchResponseText(resp) {
  if (!resp || typeof resp !== "object") return "";
  if (typeof resp.text === "string" && resp.text) return resp.text;
  const parts = resp.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (typeof p?.text === "string" && !p.thought ? p.text : "")).join("");
}

// Align a finished job's inlined responses with the pending items: by
// metadata.sym when the service echoes it, else by position.
export function extractBatchResponses(job, items) {
  const out = (Array.isArray(items) ? items : []).map((it) => ({ sym: it?.sym, response: null, error: null }));
  const list = job?.dest?.inlinedResponses;
  if (!Array.isArray(list)) return out;
  const bySym = new Map(out.map((o, i) => [o.sym, i]));
  const used = new Set();
  list.forEach((r, i) => {
    const sym = r?.metadata?.sym;
    let idx = sym && bySym.has(sym) ? bySym.get(sym) : -1;
    if (idx < 0 && !sym && i < out.length && !used.has(i)) idx = i;
    if (idx < 0 || used.has(idx)) return;
    used.add(idx);
    if (r?.error) out[idx].error = typeof r.error === "string" ? r.error : (r.error.message || JSON.stringify(r.error).slice(0, 200));
    else out[idx].response = r?.response || null;
  });
  return out;
}

export function batchJobFailureReason(job) {
  const e = job?.error;
  if (!e) return String(job?.state || "unknown state");
  return typeof e === "string" ? e : (e.message || JSON.stringify(e).slice(0, 200));
}
