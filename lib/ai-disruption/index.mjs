// AI disruption tracker, Phase 0 (2026-11-15): the registry and the scoring
// rules. Nothing imports this module yet; no build step, page, pick or grade
// reads it. Spec: docs/ai-disruption.md.
//
// What lives here
//   capabilities.json  the fixed list of things a lab product can do
//   labs.json          the labs and the official pages their launches come from
//   launches.json      one row per launch (date, lab, plans, capabilities)
//   company-map.json   which companies sell each capability and how a launch
//                      could hurt them. Facts and descriptions only.
//
// Public / Owner split (owner decision, 2026-11-15): facts about lab products
// and descriptions of which companies a launch targets are public. Anything
// that scores, ranks or tests a stock is Owner-only and must never be written
// into this folder: the repository is public. Per-stock rubric grades live in
// the private store.
//
// Pure functions only. No network, no AI, no file writes.
import { readFileSync } from "node:fs";

const load = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
// Frozen all the way down, so a reader cannot change the registry for the next one.
const deepFreeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze); }
  return v;
};
export const CAPABILITIES = deepFreeze(load("capabilities.json").capabilities);
export const LABS = deepFreeze(load("labs.json").labs);
export const LAUNCHES = deepFreeze(load("launches.json").launches);
export const COMPANIES = deepFreeze(load("company-map.json").companies);

export const HOW = Object.freeze(["direct", "workflow", "platform"]);
export const HOW_LABEL = Object.freeze({
  direct: "Direct replacement",
  workflow: "Workflow displacement",
  platform: "Platform consolidation",
});
export const OUTCOME_LABEL = Object.freeze({
  commoditization: "Feature commoditization",
  "business-model": "Business-model disruption",
  obsolescence: "Obsolescence risk",
  watch: "Watch",
});
export const ROLES = Object.freeze(["core", "addon", "adjacent"]);
export const PLANS = Object.freeze(["free", "consumer", "business", "enterprise", "api"]);
export const AVAILABILITY = Object.freeze(["preview", "beta", "ga"]);
export const AUTONOMY = Object.freeze(["draft", "approve", "unattended"]);

// Customer-capture score: how ready one launch's capability is to pull paying
// customers away from traditional software. Seven 0-5 grades, weights sum to 1.
// Retuned 2026-11-16 (Phase 1) on the 88-launch log: reach and price gap sat
// near the top for almost every launch (averages 4.0 and 4.1 of 5) and
// integration barely moved, so they added a near-constant that bunched scores
// at 60-75. Their weight moved to availability and enterprise readiness, which
// do separate launches (a preview vs a product a company can buy). Spread of
// scores 10.8 -> 12.6 points, middle half 60-72 -> 55-72, rank order kept
// (Spearman 0.95 with the first draft). Tuned for separation only: whether the
// score predicts anything is the Phase 3 scorecard's question.
// Re-run: node scripts/ai-disruption-tune.mjs
export const CAPTURE_WEIGHTS_VERSION = "2026-11-16";
export const CAPTURE_WEIGHTS = Object.freeze({
  coverage: 0.25, reach: 0.10, autonomy: 0.15, availability: 0.20,
  enterprise: 0.20, integration: 0.05, priceGap: 0.05,
});
export const CAPTURE_WEIGHTS_DRAFT = Object.freeze({
  coverage: 0.25, reach: 0.20, autonomy: 0.15, availability: 0.10,
  enterprise: 0.10, integration: 0.10, priceGap: 0.10,
});
const PLAN_REACH = { free: 5, consumer: 4, business: 3, enterprise: 3, api: 1 };
const AVAIL_GRADE = { preview: 1, beta: 3, ga: 5 };
const AUTO_GRADE = { draft: 2, approve: 3, unattended: 5 };
const clamp5 = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? n : 0));

// The five grades the launch row does not carry are derived from its facts; a
// row may override any of them with a 0-5 number of the same name. A launch
// that bundles several capabilities has one `coverage`; `coverageBy` lowers or
// raises it for a single capability (pass that capability to read it).
export function captureGrades(launch, capability = null) {
  const plans = (launch.plans || []).filter((p) => PLANS.includes(p));
  const caps = launch.capabilities || [];
  const derived = {
    coverage: (capability && launch.coverageBy?.[capability]) ?? launch.coverage,
    reach: plans.length ? Math.max(...plans.map((p) => PLAN_REACH[p] ?? 0)) : 0,
    autonomy: AUTO_GRADE[launch.autonomy] ?? 0,
    availability: AVAIL_GRADE[launch.availability] ?? 0,
    // No plan listed = shown or announced only: nobody can buy it yet, so the
    // three plan-based grades are 0.
    enterprise: plans.includes("enterprise") ? 4 : plans.includes("business") ? 3 : plans.length ? 1 : 0,
    integration: caps.includes("connectors_platform") ? 4 : launch.how === "platform" ? 3 : 2,
    // Shipped inside a plan people already pay for (or free) = a wide price gap
    // against a separate seat licence. API-only means the buyer still builds.
    priceGap: plans.some((p) => p === "free") ? 5 : plans.some((p) => p !== "api") ? 4 : plans.length ? 1 : 0,
  };
  const out = {};
  for (const key of Object.keys(CAPTURE_WEIGHTS)) {
    out[key] = clamp5(typeof launch.grades?.[key] === "number" ? launch.grades[key] : derived[key]);
  }
  return out;
}

export function captureScore(launch, capability = null, weights = CAPTURE_WEIGHTS) {
  const g = captureGrades(launch, capability);
  let total = 0;
  for (const [key, w] of Object.entries(weights)) total += w * (g[key] / 5);
  return Math.round(total * 100);
}

// Capability board: for each capability and lab, the best score shipped on or
// before `asOf`, with the launch that set it and the score it replaced.
export function capabilityBoard(launches = LAUNCHES, asOf = "9999-12-31") {
  const board = {};
  const rows = launches.filter((l) => l.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const l of rows) {
    for (const cap of l.capabilities) {
      const score = captureScore(l, cap);
      const cell = ((board[cap] ||= {})[l.lab] ||= { score: 0, prior: 0, launch: null, date: null, launches: 0 });
      cell.launches += 1;
      if (score > cell.score) Object.assign(cell, { prior: cell.score, score, launch: l.id, date: l.date });
    }
  }
  return board;
}

// What a hit does to one company. The launch says HOW it hits; the company's
// role for that capability decides the outcome. Obsolescence needs the owner's
// own judgment on revenue share, so the rule only goes as far as the facts in
// this folder allow: a direct hit on a core product is flagged for review.
export function outcomeFor(how, role) {
  if (!HOW.includes(how) || !ROLES.includes(role)) return null;
  if (role === "adjacent") return "watch";
  if (role === "addon") return "commoditization";
  if (how === "direct") return "obsolescence";
  return "business-model";
}

// Every company a launch touches, with the reason. Descriptive: no score.
export function hitsForLaunch(launch, companies = COMPANIES) {
  const hits = [];
  for (const c of companies) {
    for (const ex of c.exposures) {
      if (!launch.capabilities.includes(ex.capability)) continue;
      hits.push({
        company: c.id, name: c.name, public: c.public, capability: ex.capability,
        role: ex.role, how: launch.how, outcome: outcomeFor(launch.how, ex.role),
        why: ex.how, defense: c.defense,
      });
    }
  }
  return hits;
}

// Launch pressure on one capability at a date: each launch's score, weighted by
// how it hits, halving every 60 days and dropped after 180. Owner-side input.
export const HOW_WEIGHT = Object.freeze({ direct: 3, workflow: 2, platform: 1 });
export const PRESSURE_HALF_LIFE_DAYS = 60;
export const PRESSURE_WINDOW_DAYS = 180;
export function capabilityPressure(capability, asOf, launches = LAUNCHES) {
  const t = Date.parse(asOf);
  let sum = 0;
  for (const l of launches) {
    if (!l.capabilities.includes(capability) || !HOW_WEIGHT[l.how]) continue;
    const age = (t - Date.parse(l.date)) / 86400000;
    if (!(age >= 0 && age <= PRESSURE_WINDOW_DAYS)) continue;
    sum += captureScore(l, capability) * HOW_WEIGHT[l.how] * 0.5 ** (age / PRESSURE_HALF_LIFE_DAYS);
  }
  return Math.round(sum);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const LAUNCH_KEYS = new Set(["id", "date", "lab", "product", "title", "capabilities", "how", "plans", "availability", "autonomy", "coverage", "coverageBy", "grades", "source", "sourceChecked", "status"]);
// Allow-lists: a company row can only hold facts and descriptions.
const COMPANY_KEYS = new Set(["id", "name", "public", "exposures", "defense"]);
const EXPOSURE_KEYS = new Set(["capability", "role", "how"]);
const hostOf = (url) => { try { return new URL(url).host; } catch { return ""; } };
const realDate = (d) => DATE_RE.test(d || "") && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const SCORE_KEY_RE = /^(?:score|grade|grades|tier|rank|rating|risk|riskScore|obsolescence)$/i;

// Returns a list of problems; empty means the registry is consistent.
// `tickers` is the covered list (TICKERS in scripts/build.mjs).
// `today` (YYYY-MM-DD) turns on the no-future-dates check.
export function validateRegistry({ tickers = null, adviceCheck = null, today = null } = {}) {
  const errs = [];
  const capIds = new Set(CAPABILITIES.map((c) => c.id));
  const labIds = new Set(LABS.map((l) => l.id));
  if (capIds.size !== CAPABILITIES.length) errs.push("duplicate capability id");
  for (const c of CAPABILITIES) {
    if (!/^[a-z][a-z0-9_]*$/.test(c.id || "") || !c.name || !c.does) errs.push(`capability ${c.id}: needs an id, a name and a "does" sentence`);
  }
  if (labIds.size !== LABS.length) errs.push("duplicate lab id");
  const labHosts = {};
  const labProducts = {};
  for (const lab of LABS) {
    if (!lab.name || !lab.products?.length || !lab.sources?.length) errs.push(`lab ${lab.id}: needs a name, products and sources`);
    for (const s of lab.sources || []) if (!/^https:\/\//.test(s.url)) errs.push(`lab ${lab.id}: source must be https`);
    if (lab.ticker !== null && !TICKER_RE.test(lab.ticker || "")) errs.push(`lab ${lab.id}: bad ticker`);
    labHosts[lab.id] = new Set((lab.sources || []).map((s) => hostOf(s.url)));
    labProducts[lab.id] = new Set(lab.products || []);
  }
  const seen = new Set();
  let last = "";
  for (const l of LAUNCHES) {
    const at = `launch ${l.id}`;
    if (seen.has(l.id)) errs.push(`${at}: duplicate id`);
    seen.add(l.id);
    for (const key of Object.keys(l)) if (!LAUNCH_KEYS.has(key)) errs.push(`${at}: unknown field "${key}"`);
    if (!realDate(l.date)) errs.push(`${at}: bad date`);
    if (today && l.date > today) errs.push(`${at}: dated in the future`);
    if (!String(l.id || "").startsWith(`${l.date}-${l.lab}-`)) errs.push(`${at}: id must start with its date and lab`);
    if (!l.title || !l.product) errs.push(`${at}: needs a product and a title`);
    if (labIds.has(l.lab) && !labProducts[l.lab].has(l.product)) errs.push(`${at}: product "${l.product}" is not listed for ${l.lab}`);
    if (new Set(l.capabilities || []).size !== (l.capabilities || []).length) errs.push(`${at}: repeated capability`);
    if (!Array.isArray(l.plans)) errs.push(`${at}: plans must be a list`);
    else if (new Set(l.plans).size !== l.plans.length) errs.push(`${at}: repeated plan`);
    if (l.availability === "ga" && !l.plans?.length) errs.push(`${at}: a generally available launch needs a plan`);
    for (const [key, v] of Object.entries(l.coverageBy || {})) {
      if (!(l.capabilities || []).includes(key) || !(Number.isInteger(v) && v >= 0 && v <= 5)) errs.push(`${at}: bad coverageBy "${key}"`);
    }
    for (const [key, v] of Object.entries(l.grades || {})) {
      if (!(key in CAPTURE_WEIGHTS) || !(typeof v === "number" && v >= 0 && v <= 5)) errs.push(`${at}: bad grade override "${key}"`);
    }
    if (labIds.has(l.lab) && !labHosts[l.lab].has(hostOf(l.source))) errs.push(`${at}: source is not one of ${l.lab}'s listed pages`);
    if (l.sourceChecked && (l.sourceChecked < l.date || (today && l.sourceChecked > today))) errs.push(`${at}: sourceChecked is outside the possible dates`);
    if (l.date < last) errs.push(`${at}: out of date order`);
    last = l.date;
    if (!labIds.has(l.lab)) errs.push(`${at}: unknown lab ${l.lab}`);
    if (!l.capabilities?.length) errs.push(`${at}: no capabilities`);
    for (const c of l.capabilities || []) if (!capIds.has(c)) errs.push(`${at}: unknown capability ${c}`);
    if (!HOW.includes(l.how)) errs.push(`${at}: bad how`);
    for (const p of l.plans || []) if (!PLANS.includes(p)) errs.push(`${at}: bad plan ${p}`);
    if (!AVAILABILITY.includes(l.availability)) errs.push(`${at}: bad availability`);
    if (!AUTONOMY.includes(l.autonomy)) errs.push(`${at}: bad autonomy`);
    if (!(Number.isInteger(l.coverage) && l.coverage >= 0 && l.coverage <= 5)) errs.push(`${at}: coverage must be 0-5`);
    if (!/^https:\/\//.test(l.source || "")) errs.push(`${at}: source must be https`);
    if (l.sourceChecked !== null && !realDate(l.sourceChecked)) errs.push(`${at}: bad sourceChecked`);
    if (!["auto", "confirmed"].includes(l.status)) errs.push(`${at}: bad status`);
    const s = captureScore(l);
    if (!(s >= 0 && s <= 100)) errs.push(`${at}: score out of range`);
    if (adviceCheck?.(l.title)) errs.push(`${at}: title reads as investment advice`);
  }
  const ids = new Set();
  for (const c of COMPANIES) {
    const at = `company ${c.id}`;
    if (ids.has(c.id)) errs.push(`${at}: duplicate`);
    ids.add(c.id);
    for (const key of Object.keys(c)) {
      if (SCORE_KEY_RE.test(key)) errs.push(`${at}: "${key}" is a stock judgment and cannot live in the public repo`);
      else if (!COMPANY_KEYS.has(key)) errs.push(`${at}: unknown field "${key}"`);
    }
    if (!c.name || typeof c.public !== "boolean" || !c.defense) errs.push(`${at}: needs a name, public true/false and a defense sentence`);
    if (c.public === true && !TICKER_RE.test(c.id || "")) errs.push(`${at}: a public company's id must be its ticker`);
    if (!c.exposures?.length) errs.push(`${at}: no exposures`);
    const exCaps = (c.exposures || []).map((ex) => ex.capability);
    if (new Set(exCaps).size !== exCaps.length) errs.push(`${at}: the same capability is listed twice`);
    for (const ex of c.exposures || []) {
      for (const key of Object.keys(ex)) {
        if (SCORE_KEY_RE.test(key)) errs.push(`${at}: "${key}" cannot live in the public repo`);
        else if (!EXPOSURE_KEYS.has(key)) errs.push(`${at}: unknown exposure field "${key}"`);
      }
      if (!capIds.has(ex.capability)) errs.push(`${at}: unknown capability ${ex.capability}`);
      if (!ROLES.includes(ex.role)) errs.push(`${at}: bad role ${ex.role}`);
      if (!ex.how) errs.push(`${at}: exposure needs a how sentence`);
      if (adviceCheck?.(ex.how)) errs.push(`${at}: "${ex.how}" reads as investment advice`);
    }
    if (adviceCheck?.(c.defense)) errs.push(`${at}: defense reads as investment advice`);
  }
  // Every capability is shipped by some launch and sold by some company, and
  // every lab has a launch; otherwise the row is dead weight on the board.
  const launched = new Set(LAUNCHES.flatMap((l) => l.capabilities || []));
  const sold = new Set(COMPANIES.flatMap((c) => (c.exposures || []).map((ex) => ex.capability)));
  for (const id of capIds) {
    if (!launched.has(id)) errs.push(`capability ${id}: no launch uses it`);
    if (!sold.has(id)) errs.push(`capability ${id}: no company sells it`);
  }
  const labsUsed = new Set(LAUNCHES.map((l) => l.lab));
  for (const id of labIds) if (!labsUsed.has(id)) errs.push(`lab ${id}: no launches`);
  for (const lab of LABS) {
    if (lab.ticker && tickers && !tickers.includes(lab.ticker)) errs.push(`lab ${lab.id}: ticker ${lab.ticker} is not covered`);
  }
  return errs;
}

// Covered = in the site's TICKERS. Everything else is mention-only: named in
// the launch log with how it could be hurt, never priced, scored or tested.
export function coverageOf(company, tickers) {
  if (!company.public) return "private";
  return (tickers || []).includes(company.id) ? "covered" : "mention";
}
