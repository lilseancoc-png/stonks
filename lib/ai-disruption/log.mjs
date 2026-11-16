// AI disruption tracker, Phase 1 (2026-11-16): the live launch log.
//
// Once a trading day (the first non-Top-Picks bake after 09:00 ET) the bake
// reads every lab source (collector.mjs), tags each new post by rules
// (tagger.mjs) and keeps:
//
//   ai-disruption-state.json  Owner internal: every post already read, the
//                             collected launch rows, the review queue, the
//                             posts skipped as not-a-launch, source health.
//                             Read before the wipe; never served.
//   ai-disruption.json        public: the merged launch log (the registry's
//                             88 backfilled rows plus the collected ones, with
//                             the Owner's decisions applied), the capability
//                             board, the company map and source health. Facts
//                             about lab products only; no stock is scored.
//   ai-disruption-owner.json  Owner: the review queue, skipped posts, how
//                             often the rules were right, launch pressure per
//                             capability (and, from Phase 3, the scorecard).
//
// The Owner's decisions (review.mjs, ai-disruption-review.json) are applied on
// every bake, collecting or not, so a confirmation shows at the next update.
// Kill switch AI_DISRUPTION=0: no reads, prior files carried forward.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CAPABILITIES, LABS, LAUNCHES, COMPANIES, HOW, PLANS, AVAILABILITY, AUTONOMY,
  CAPTURE_WEIGHTS, CAPTURE_WEIGHTS_VERSION, HOW_LABEL, OUTCOME_LABEL,
  captureScore, capabilityBoard, hitsForLaunch, coverageOf, capabilityPressure,
} from "./index.mjs";
import { collectPosts, readableSources } from "./collector.mjs";
import { tagPost, launchIdFor, sameLaunch } from "./tagger.mjs";
import { readReviewDoc, AI_DISRUPTION_REVIEW_KEY } from "./review.mjs";

export const AI_DISRUPTION_KEY = "ai-disruption.json";
export const AI_DISRUPTION_OWNER_KEY = "ai-disruption-owner.json";
export const AI_DISRUPTION_STATE_KEY = "ai-disruption-state.json";
export { AI_DISRUPTION_REVIEW_KEY };

export const LOOKBACK_DAYS = 21;       // posts older than this are not read on a run
export const QUEUE_MAX_DAYS = 120;     // an unreviewed queue item is dropped after this
export const QUEUE_MAX = 150;
export const SKIPPED_MAX = 80;
export const SEEN_MAX = 3000;
export const COLLECT_MAX_MS = 45000;   // the whole read, all sources

const CAP_IDS = new Set(CAPABILITIES.map((c) => c.id));
const LAB_BY_ID = Object.fromEntries(LABS.map((l) => [l.id, l]));
const OUTCOME_RANK = { obsolescence: 4, "business-model": 3, commoditization: 2, watch: 1 };

const etParts = (ms) => {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};
export const etDate = (ms) => etParts(ms).date;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const postKey = (p) => `${p.lab}|${p.date}|${String(p.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 100)}`;

export function emptyState() {
  return { version: 1, updatedAt: null, lastRunDate: null, lastRunAt: null, seen: {}, rows: [], queue: [], skipped: [], health: [], runs: [] };
}
export function cleanState(s) {
  if (!s || typeof s !== "object" || s.version !== 1) return emptyState();
  return {
    ...emptyState(), ...s,
    seen: s.seen && typeof s.seen === "object" ? s.seen : {},
    rows: Array.isArray(s.rows) ? s.rows : [],
    queue: Array.isArray(s.queue) ? s.queue : [],
    skipped: Array.isArray(s.skipped) ? s.skipped : [],
    health: Array.isArray(s.health) ? s.health : [],
    runs: Array.isArray(s.runs) ? s.runs : [],
  };
}

// Collect once per ET trading day, on the first bake after 09:00 ET that is
// not a Top Picks run (10:00, 13:30 or 16:10 ET), so it never delays a pick.
export function collectDue(state, { nowMs = Date.now(), decisionRun = false } = {}) {
  const { date, hour } = etParts(nowMs);
  if (decisionRun) return { due: false, why: "Top Picks run" };
  if (hour < 9) return { due: false, why: "before 09:00 ET" };
  if (state?.lastRunDate === date) return { due: false, why: "already read today" };
  return { due: true, why: null, today: date };
}

// The problems with one launch row; empty means it can go in the log.
export function rowProblems(r) {
  const errs = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.date || "")) errs.push("date");
  const lab = LAB_BY_ID[r?.lab];
  if (!lab) errs.push("lab");
  else if (!lab.products.includes(r.product)) errs.push("product");
  if (!r?.title) errs.push("title");
  if (!Array.isArray(r?.capabilities) || !r.capabilities.length || r.capabilities.some((c) => !CAP_IDS.has(c))) errs.push("capabilities");
  if (!HOW.includes(r?.how)) errs.push("how");
  if (!Array.isArray(r?.plans) || r.plans.some((p) => !PLANS.includes(p))) errs.push("plans");
  if (!AVAILABILITY.includes(r?.availability)) errs.push("availability");
  if (r?.availability === "ga" && !r?.plans?.length) errs.push("a generally available launch needs a plan");
  if (!AUTONOMY.includes(r?.autonomy)) errs.push("autonomy");
  if (!(Number.isInteger(r?.coverage) && r.coverage >= 0 && r.coverage <= 5)) errs.push("coverage");
  return errs;
}

function sourcePageFor(labId, sourceName) {
  const s = (LAB_BY_ID[labId]?.sources || []).find((x) => x.name === sourceName);
  return s ? s.url : null;
}

// Folds one run's posts into the state. Pure apart from the clock in `today`.
// `keepIds`: queue items the Owner has confirmed or edited. applyDecisions
// turns them into launch rows on every bake, so they must outlive the age
// trim and the cap, or a confirmed launch would drop out of the public log.
export function foldPosts(prior, { posts = [], health = [], today, registry = LAUNCHES, keepIds = [] } = {}) {
  const state = cleanState(prior);
  const seen = { ...state.seen };
  const rows = [...state.rows];
  const queue = [...state.queue];
  const skipped = [...state.skipped];
  const counts = { posts: posts.length, fresh: 0, logged: 0, queued: 0, skipped: 0, duplicates: 0 };
  const known = () => [...registry, ...rows, ...queue];
  const ids = new Set([...registry.map((r) => r.id), ...rows.map((r) => r.id), ...queue.map((q) => q.id)]);
  const uniqueId = (base) => {
    let id = base, n = 2;
    while (ids.has(id)) id = `${base}-${n++}`.slice(0, 110);
    ids.add(id);
    return id;
  };
  // Oldest first, so a launch read in two places keeps its first date.
  for (const p of [...posts].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = postKey(p);
    if (seen[key]) continue;
    seen[key] = today;
    counts.fresh += 1;
    const lab = LAB_BY_ID[p.lab];
    const tag = tagPost(p, lab);
    if (tag.decision === "skip") {
      skipped.unshift({ lab: p.lab, date: p.date, title: p.title, url: p.url || null, source: p.source, why: tag.reasons.join("; "), at: today });
      counts.skipped += 1;
      continue;
    }
    const probe = { lab: p.lab, date: p.date, title: tag.fields.title || p.title, url: p.url || null };
    if (known().some((r) => sameLaunch(probe, { lab: r.lab, date: r.date, title: r.title, url: r.link || r.url || null }))) {
      counts.duplicates += 1;
      continue;
    }
    const id = uniqueId(launchIdFor(p.date, p.lab, tag.fields.title || p.title));
    const page = sourcePageFor(p.lab, p.source);
    if (tag.decision === "log") {
      rows.push({
        id, date: p.date, lab: p.lab, product: tag.fields.product, title: tag.fields.title,
        capabilities: tag.fields.capabilities, how: tag.fields.how, plans: tag.fields.plans,
        availability: tag.fields.availability, autonomy: tag.fields.autonomy, coverage: tag.fields.coverage,
        source: page || p.url, link: p.url || null, sourceChecked: today, status: "auto", collected: true,
      });
      counts.logged += 1;
    } else {
      queue.push({
        id, date: p.date, lab: p.lab, source: p.source, sourcePage: page, title: String(p.title || "").slice(0, 200),
        url: p.url || null, text: String(p.text || "").slice(0, 400), suggestion: tag.fields, reasons: tag.reasons, seenAt: today,
      });
      counts.queued += 1;
    }
  }
  // Trim: old unreviewed queue items, the skipped list, the seen index.
  // Items the Owner confirmed or edited are kept whatever their age.
  const queueFloor = addDays(today, -QUEUE_MAX_DAYS);
  const keep = new Set(keepIds);
  const byDateDesc = (a, b) => b.date.localeCompare(a.date);
  const decidedQueue = queue.filter((q) => keep.has(q.id));
  const openQueue = queue.filter((q) => !keep.has(q.id) && q.date >= queueFloor).sort(byDateDesc).slice(0, QUEUE_MAX);
  const keptQueue = [...decidedQueue, ...openQueue].sort(byDateDesc);
  const seenEntries = Object.entries(seen).sort((a, b) => String(b[1]).localeCompare(String(a[1])));
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    state: {
      ...state, version: 1, updatedAt: today, lastRunDate: today,
      seen: Object.fromEntries(seenEntries.slice(0, SEEN_MAX)), rows, queue: keptQueue,
      skipped: skipped.slice(0, SKIPPED_MAX),
      health: health.length ? health.map((h) => ({ ...h, lastOk: h.ok ? today : (state.health.find((x) => x.lab === h.lab && x.source === h.source)?.lastOk || null) })) : state.health,
      runs: [{ date: today, ...counts, sourcesOk: health.filter((h) => h.ok).length, sources: health.length }, ...state.runs].slice(0, 30),
    },
    counts,
  };
}

// The bake step: read the sources (when due) and fold the posts in.
export async function updateDisruptionState({ prior, review = null, nowMs = Date.now(), decisionRun = false, fetchImpl, log = () => {}, force = false } = {}) {
  const state = cleanState(prior);
  const due = force ? { due: true, today: etDate(nowMs) } : collectDue(state, { nowMs, decisionRun });
  if (!due.due) return { state, collected: false, why: due.why, counts: null };
  const since = addDays(due.today, -LOOKBACK_DAYS);
  const timer = new Promise((res) => setTimeout(() => res({ posts: [], health: readableSources(LABS).map((s) => ({ lab: s.lab, source: s.name, url: s.url, ok: false, status: 0, posts: 0, recent: 0, error: "whole read timed out" })) }), COLLECT_MAX_MS).unref?.());
  const got = await Promise.race([collectPosts({ labs: LABS, since, fetchImpl, log }), timer]);
  const { state: next, counts } = foldPosts(state, { posts: got.posts, health: got.health, today: due.today, keepIds: keptDecisionIds(review) });
  next.lastRunAt = new Date(nowMs).toISOString();
  return { state: next, collected: true, why: null, counts };
}

// Ids the Owner confirmed or edited (not rejected): their queue items stay.
export function keptDecisionIds(review) {
  const rv = readReviewDoc(review ? JSON.stringify(review) : null);
  return Object.entries(rv.decisions).filter(([, d]) => d.act !== "reject").map(([id]) => id);
}

// Applies the Owner's decisions to the registry rows and the collected rows.
export function applyDecisions({ registry = LAUNCHES, rows = [], queue = [], review }) {
  const decisions = review?.decisions || {};
  const out = [];
  const rejected = [];
  const problems = [];
  let confirmedAsIs = 0, edited = 0;
  for (const base of [...registry, ...rows]) {
    const d = decisions[base.id];
    if (!d) { out.push({ ...base }); continue; }
    if (d.act === "reject") { rejected.push(base.id); continue; }
    const next = { ...base, ...(d.fields || {}), status: "confirmed", reviewedAt: d.at || null };
    const errs = rowProblems(next);
    if (errs.length) { out.push({ ...base }); problems.push({ id: base.id, errs }); continue; }
    if (d.act === "edit" || (d.fields && Object.keys(d.fields).length)) { next.edited = true; edited += 1; } else confirmedAsIs += 1;
    out.push(next);
  }
  const openQueue = [];
  for (const q of queue) {
    const d = decisions[q.id];
    if (!d) { openQueue.push(q); continue; }
    if (d.act === "reject") { rejected.push(q.id); continue; }
    const next = {
      id: q.id, date: q.date, lab: q.lab, ...(q.suggestion || {}), ...(d.fields || {}),
      source: q.sourcePage || q.url, link: q.url || null, sourceChecked: q.seenAt || q.date,
      status: "confirmed", reviewedAt: d.at || null, collected: true, fromQueue: true,
    };
    const errs = rowProblems(next);
    if (errs.length) { openQueue.push({ ...q, needs: errs }); problems.push({ id: q.id, errs }); continue; }
    if (d.act === "edit" || (d.fields && Object.keys(d.fields).length)) { next.edited = true; edited += 1; } else confirmedAsIs += 1;
    out.push(next);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { launches: out, queue: openQueue, rejected, problems, confirmedAsIs, edited };
}

const PUBLIC_ROW_KEYS = ["id", "date", "lab", "product", "title", "capabilities", "how", "plans", "availability", "autonomy", "coverage", "coverageBy", "grades", "source", "link", "sourceChecked", "status", "collected", "edited", "reviewedAt"];
function targetsFor(launch, tickers) {
  const best = new Map();
  for (const h of hitsForLaunch(launch)) {
    const prev = best.get(h.company);
    if (!prev || (OUTCOME_RANK[h.outcome] || 0) > (OUTCOME_RANK[prev.outcome] || 0)) {
      best.set(h.company, { company: h.company, name: h.name, coverage: coverageOf({ id: h.company, public: h.public }, tickers), capability: h.capability, role: h.role, outcome: h.outcome });
    }
  }
  return [...best.values()].sort((a, b) => (OUTCOME_RANK[b.outcome] || 0) - (OUTCOME_RANK[a.outcome] || 0) || a.name.localeCompare(b.name));
}

// The public file and the Owner file from the state and the decisions.
export function buildDisruptionFiles({ state, review, tickers = [], builtAt = new Date().toISOString(), collected = false, stale = false } = {}) {
  const st = cleanState(state);
  const rv = readReviewDoc(review ? JSON.stringify(review) : null);
  const applied = applyDecisions({ registry: LAUNCHES, rows: st.rows, queue: st.queue, review: rv });
  const launches = applied.launches.map((l) => {
    const row = {};
    for (const k of PUBLIC_ROW_KEYS) if (l[k] !== undefined) row[k] = l[k];
    row.score = captureScore(l);
    row.targets = targetsFor(l, tickers);
    return row;
  });
  const today = builtAt.slice(0, 10);
  const last30 = addDays(today, -30);
  const board = capabilityBoard(applied.launches);
  const pub = {
    version: 1, builtAt, weightsVersion: CAPTURE_WEIGHTS_VERSION, weights: CAPTURE_WEIGHTS,
    lastCollected: st.lastRunAt || st.lastRunDate || null, collectedThisBuild: !!collected, ...(stale ? { stale: true } : {}),
    counts: {
      launches: launches.length,
      auto: launches.filter((l) => l.status === "auto").length,
      confirmed: launches.filter((l) => l.status === "confirmed").length,
      collected: launches.filter((l) => l.collected).length,
      last30: launches.filter((l) => l.date >= last30).length,
    },
    labels: { how: HOW_LABEL, outcome: OUTCOME_LABEL },
    capabilities: CAPABILITIES,
    labs: LABS.map((l) => ({ id: l.id, name: l.name, ticker: l.ticker, products: l.products, sources: l.sources.map((s) => ({ name: s.name, url: s.url })) })),
    companies: COMPANIES.map((c) => ({ id: c.id, name: c.name, coverage: coverageOf(c, tickers), exposures: c.exposures, defense: c.defense })),
    launches: launches.slice().reverse(),
    board,
    sources: (st.health || []).map((h) => ({ lab: h.lab, source: h.source, url: h.url, ok: !!h.ok, lastOk: h.lastOk || null })),
  };
  const capsWithLaunches = CAPABILITIES.filter((c) => board[c.id]).map((c) => c.id);
  const decided = applied.confirmedAsIs + applied.edited;
  const owner = {
    version: 1, builtAt,
    queue: applied.queue,
    skipped: st.skipped.slice(0, 40),
    health: st.health,
    runs: st.runs.slice(0, 14),
    review: {
      decisions: Object.keys(rv.decisions).length,
      confirmedAsIs: applied.confirmedAsIs, edited: applied.edited, rejected: applied.rejected.length,
      // How often the rules' tags were kept as they were: the answer to "is
      // rules-only tagging good enough?" once the Owner has reviewed rows.
      rulesKept: decided ? Math.round((100 * applied.confirmedAsIs) / decided) : null,
      problems: applied.problems,
      history: rv.history.slice(0, 30),
    },
    pressure: Object.fromEntries(capsWithLaunches.map((c) => [c, capabilityPressure(c, today, applied.launches)])),
  };
  return { pub, owner, launches: applied.launches };
}

async function readJson(dataDir, key) {
  try { return JSON.parse(await readFile(resolve(dataDir, key), "utf8")); } catch { return null; }
}
export async function readDisruptionPrior(dataDir) {
  const [state, pub, owner, review] = await Promise.all([
    readJson(dataDir, AI_DISRUPTION_STATE_KEY), readJson(dataDir, AI_DISRUPTION_KEY),
    readJson(dataDir, AI_DISRUPTION_OWNER_KEY), readJson(dataDir, AI_DISRUPTION_REVIEW_KEY),
  ]);
  return { state: state ? cleanState(state) : null, pub, owner, review };
}
export async function writeDisruptionFiles(dataDir, { state, pub, owner }) {
  const writes = [];
  if (state) writes.push(writeFile(resolve(dataDir, AI_DISRUPTION_STATE_KEY), JSON.stringify(state), "utf8"));
  if (pub) writes.push(writeFile(resolve(dataDir, AI_DISRUPTION_KEY), JSON.stringify(pub), "utf8"));
  if (owner) writes.push(writeFile(resolve(dataDir, AI_DISRUPTION_OWNER_KEY), JSON.stringify(owner), "utf8"));
  await Promise.all(writes);
}
