// AI disruption tracker, Phase 1 (2026-11-16): the Owner's review decisions.
//
// Every launch row starts "auto" (tagged by rules) and anything the rules could
// not place waits in a review queue. The Owner confirms a row, fixes its tags,
// or rejects it (not a launch, or a duplicate). Decisions are saved in
// ai-disruption-review.json: Owner-only and request-time-owned, written only by
// api/auth/[action].js "ai-disruption-review", never by a workflow. Each bake
// reads it before the wipe and applies every decision to the log, so a click
// shows on the public page from the next update.
//
// Pure functions. No network, no AI.
import { CAPABILITIES, LABS, HOW, PLANS, AVAILABILITY, AUTONOMY } from "./index.mjs";

export const AI_DISRUPTION_REVIEW_KEY = "ai-disruption-review.json";
export const REVIEW_ACTS = Object.freeze(["confirm", "edit", "reject", "undo"]);
export const REVIEW_HISTORY = 200;
const ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z]+-[a-z0-9-]{1,80}$/;
const CAP_IDS = new Set(CAPABILITIES.map((c) => c.id));
const LAB_BY_ID = Object.fromEntries(LABS.map((l) => [l.id, l]));

export function emptyReview() {
  return { version: 1, decisions: {}, history: [], updatedAt: null };
}

export function readReviewDoc(raw) {
  let doc = null;
  try { doc = raw == null ? null : JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")); } catch { doc = null; }
  if (!doc || typeof doc !== "object" || !doc.decisions || typeof doc.decisions !== "object") return emptyReview();
  const decisions = {};
  for (const [id, d] of Object.entries(doc.decisions)) {
    if (!ID_RE.test(id) || !d || !["confirm", "edit", "reject"].includes(d.act)) continue;
    const fields = d.fields ? cleanFields(d.fields, id).fields : null;
    decisions[id] = { act: d.act, ...(fields ? { fields } : {}), at: typeof d.at === "string" ? d.at : null, by: typeof d.by === "string" ? d.by.slice(0, 64) : null };
  }
  const history = Array.isArray(doc.history) ? doc.history.filter((h) => h && ID_RE.test(h.id || "") && REVIEW_ACTS.includes(h.act)).slice(0, REVIEW_HISTORY) : [];
  return { version: 1, decisions, history, updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null };
}

const labOfId = (id) => (String(id).match(/^\d{4}-\d{2}-\d{2}-([a-z]+)-/) || [])[1] || null;

// Checks the tag fields an Owner sends. Only listed fields, only known values.
// Returns { fields, error }: fields holds what was sent and valid.
export function cleanFields(input, id) {
  if (!input || typeof input !== "object") return { fields: null, error: "fields must be an object" };
  const out = {};
  const lab = LAB_BY_ID[labOfId(id)];
  if ("title" in input) {
    const t = String(input.title || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 120) return { fields: null, error: "title must be 1-120 characters" };
    out.title = t;
  }
  if ("product" in input) {
    if (!lab || !lab.products.includes(input.product)) return { fields: null, error: "unknown product for this lab" };
    out.product = input.product;
  }
  if ("capabilities" in input) {
    const caps = Array.isArray(input.capabilities) ? [...new Set(input.capabilities)] : [];
    if (!caps.length || caps.length > 6 || caps.some((c) => !CAP_IDS.has(c))) return { fields: null, error: "capabilities must be 1-6 known ids" };
    out.capabilities = caps;
  }
  if ("how" in input) {
    if (!HOW.includes(input.how)) return { fields: null, error: "bad how" };
    out.how = input.how;
  }
  if ("plans" in input) {
    const plans = Array.isArray(input.plans) ? [...new Set(input.plans)] : null;
    if (!plans || plans.some((p) => !PLANS.includes(p))) return { fields: null, error: "bad plans" };
    out.plans = plans;
  }
  if ("availability" in input) {
    if (!AVAILABILITY.includes(input.availability)) return { fields: null, error: "bad availability" };
    out.availability = input.availability;
  }
  if ("autonomy" in input) {
    if (!AUTONOMY.includes(input.autonomy)) return { fields: null, error: "bad autonomy" };
    out.autonomy = input.autonomy;
  }
  if ("coverage" in input) {
    const c = Number(input.coverage);
    if (!(Number.isInteger(c) && c >= 0 && c <= 5)) return { fields: null, error: "coverage must be 0-5" };
    out.coverage = c;
  }
  return { fields: out, error: null };
}

// One Owner click. body: { act, id, fields? }. Returns { doc, error, unchanged }.
export function applyReviewRequest(doc, body, { at = null, by = null } = {}) {
  const cur = doc || emptyReview();
  const act = body?.act;
  const id = String(body?.id || "");
  if (!REVIEW_ACTS.includes(act)) return { doc: cur, error: "bad act" };
  if (!ID_RE.test(id)) return { doc: cur, error: "bad id" };
  const decisions = { ...cur.decisions };
  if (act === "undo") {
    if (!decisions[id]) return { doc: cur, unchanged: true };
    delete decisions[id];
  } else {
    let fields = null;
    if (act === "edit" || (act === "confirm" && body?.fields)) {
      const c = cleanFields(body?.fields, id);
      if (c.error) return { doc: cur, error: c.error };
      fields = c.fields;
      if (act === "edit" && !Object.keys(fields).length) return { doc: cur, error: "nothing to change" };
    }
    const prev = decisions[id];
    if (prev && prev.act === act && JSON.stringify(prev.fields || null) === JSON.stringify(fields)) return { doc: cur, unchanged: true };
    decisions[id] = { act: act === "edit" ? "edit" : act, ...(fields ? { fields } : {}), at, by };
  }
  const history = [{ id, act, at, by }, ...(cur.history || [])].slice(0, REVIEW_HISTORY);
  return { doc: { version: 1, decisions, history, updatedAt: at }, error: null };
}
