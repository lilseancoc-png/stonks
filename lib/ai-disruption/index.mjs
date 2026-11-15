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
export const CAPABILITIES = Object.freeze(load("capabilities.json").capabilities);
export const LABS = Object.freeze(load("labs.json").labs);
export const LAUNCHES = Object.freeze(load("launches.json").launches);
export const COMPANIES = Object.freeze(load("company-map.json").companies);

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
export const CAPTURE_WEIGHTS = Object.freeze({
  coverage: 0.25, reach: 0.20, autonomy: 0.15, availability: 0.10,
  enterprise: 0.10, integration: 0.10, priceGap: 0.10,
});
const PLAN_REACH = { free: 5, consumer: 4, business: 3, enterprise: 3, api: 1 };
const AVAIL_GRADE = { preview: 1, beta: 3, ga: 5 };
const AUTO_GRADE = { draft: 2, approve: 3, unattended: 5 };
const clamp5 = (n) => Math.max(0, Math.min(5, Number.isFinite(n) ? n : 0));

// The five grades the launch row does not carry are derived from its facts; a
// row may override any of them with a 0-5 number of the same name.
export function captureGrades(launch) {
  const plans = launch.plans || [];
  const caps = launch.capabilities || [];
  const derived = {
    coverage: launch.coverage,
    reach: plans.length ? Math.max(...plans.map((p) => PLAN_REACH[p] ?? 0)) : 0,
    autonomy: AUTO_GRADE[launch.autonomy] ?? 0,
    availability: AVAIL_GRADE[launch.availability] ?? 0,
    enterprise: plans.includes("enterprise") ? 4 : plans.includes("business") ? 3 : 1,
    integration: caps.includes("connectors_platform") ? 4 : launch.how === "platform" ? 3 : 2,
    // Shipped inside a plan people already pay for (or free) = a wide price gap
    // against a separate seat licence. API-only means the buyer still builds.
    priceGap: plans.some((p) => p === "free") ? 5 : plans.some((p) => p !== "api") ? 4 : 1,
  };
  const out = {};
  for (const key of Object.keys(CAPTURE_WEIGHTS)) {
    out[key] = clamp5(typeof launch.grades?.[key] === "number" ? launch.grades[key] : derived[key]);
  }
  return out;
}

export function captureScore(launch) {
  const g = captureGrades(launch);
  let total = 0;
  for (const [key, w] of Object.entries(CAPTURE_WEIGHTS)) total += w * (g[key] / 5);
  return Math.round(total * 100);
}

// Capability board: for each capability and lab, the best score shipped on or
// before `asOf`, with the launch that set it and the score it replaced.
export function capabilityBoard(launches = LAUNCHES, asOf = "9999-12-31") {
  const board = {};
  const rows = launches.filter((l) => l.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const l of rows) {
    const score = captureScore(l);
    for (const cap of l.capabilities) {
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
    if (!l.capabilities.includes(capability)) continue;
    const age = (t - Date.parse(l.date)) / 86400000;
    if (!(age >= 0 && age <= PRESSURE_WINDOW_DAYS)) continue;
    sum += captureScore(l) * HOW_WEIGHT[l.how] * 0.5 ** (age / PRESSURE_HALF_LIFE_DAYS);
  }
  return Math.round(sum);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCORE_KEY_RE = /^(?:score|grade|grades|tier|rank|rating|risk|riskScore|obsolescence)$/i;

// Returns a list of problems; empty means the registry is consistent.
// `tickers` is the covered list (TICKERS in scripts/build.mjs).
export function validateRegistry({ tickers = null, adviceCheck = null } = {}) {
  const errs = [];
  const capIds = new Set(CAPABILITIES.map((c) => c.id));
  const labIds = new Set(LABS.map((l) => l.id));
  if (capIds.size !== CAPABILITIES.length) errs.push("duplicate capability id");
  for (const lab of LABS) {
    for (const s of lab.sources) if (!/^https:\/\//.test(s.url)) errs.push(`lab ${lab.id}: source must be https`);
  }
  const seen = new Set();
  let last = "";
  for (const l of LAUNCHES) {
    const at = `launch ${l.id}`;
    if (seen.has(l.id)) errs.push(`${at}: duplicate id`);
    seen.add(l.id);
    if (!DATE_RE.test(l.date) || Number.isNaN(Date.parse(l.date))) errs.push(`${at}: bad date`);
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
    if (l.sourceChecked !== null && !DATE_RE.test(l.sourceChecked || "")) errs.push(`${at}: bad sourceChecked`);
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
    for (const key of Object.keys(c)) if (SCORE_KEY_RE.test(key)) errs.push(`${at}: "${key}" is a stock judgment and cannot live in the public repo`);
    if (!c.exposures?.length) errs.push(`${at}: no exposures`);
    for (const ex of c.exposures || []) {
      for (const key of Object.keys(ex)) if (SCORE_KEY_RE.test(key)) errs.push(`${at}: "${key}" cannot live in the public repo`);
      if (!capIds.has(ex.capability)) errs.push(`${at}: unknown capability ${ex.capability}`);
      if (!ROLES.includes(ex.role)) errs.push(`${at}: bad role ${ex.role}`);
      if (!ex.how) errs.push(`${at}: exposure needs a how sentence`);
      if (adviceCheck?.(ex.how)) errs.push(`${at}: "${ex.how}" reads as investment advice`);
    }
    if (adviceCheck?.(c.defense)) errs.push(`${at}: defense reads as investment advice`);
  }
  for (const lab of LABS) {
    if (lab.ticker && tickers && !tickers.includes(lab.ticker)) errs.push(`lab ${lab.id}: ticker ${lab.ticker} is not covered`);
  }
  return errs;
}

// Covered = in the site's TICKERS. Everything else is mention-only: named in
// the launch log with how it could be hurt, never priced, scored or tested.
export function coverageOf(company, tickers) {
  if (!company.public) return "private";
  return tickers.includes(company.id) ? "covered" : "mention";
}
