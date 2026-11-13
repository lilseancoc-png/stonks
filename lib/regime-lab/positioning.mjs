// Regime Lab: the positioning and credit labeler (2026-11-12).
//
// A second, slower read of the market beside the six-cell grid and the
// hidden-Markov check. It reads only the daily market gauge row the bake
// already logs (`shadow.mkt` in grades-daily.json, lib/shadow-signals.mjs),
// so it adds no download:
//
//   crowd   who is positioned how. Fear votes: the Cboe equity put/call
//           ratio in its top fifth of the last 250 sessions, asset managers
//           light on S&P 500 futures (CFTC, z -1 or lower over three years),
//           margin debt shrinking 10%+ a year. Crowding votes: put/call in
//           its bottom fifth, asset managers heavy (z +1.5 or higher), margin
//           debt growing 25%+ a year. Two more fear votes than crowding votes
//           reads "washed out", two more crowding votes reads "crowded",
//           anything else "neutral"; fewer than two inputs present reads
//           nothing.
//   credit  how worried lenders and bettors are. The Baa corporate spread
//           over the 10-year Treasury (stressed at 3 points, watch at 2.5,
//           tight at 1.8 or under), Kalshi's US recession odds (stressed at
//           40%, watch at 25%), and the Booms & busts warning-sign count
//           (watch at 6 of 9). Any stressed vote or two watch votes reads
//           "stressed", one watch vote "watch", a tight spread with no watch
//           vote "tight", else "normal".
//
// The study joins every logged day's labels to SPY's move over the next 10
// sessions, by label, beside the all-days average. Days overlap, so a label
// shows "collecting" until it has POSITIONING_MIN_DAYS days, and even then
// it is a description, not a test. Research only: nothing here changes a
// pick, a grade, a gate or the Track Record.
//
// Pure, deterministic, no network, no AI.

export const POSITIONING_RULES_VERSION = 1;
export const POSITIONING_HORIZON = 10;
export const POSITIONING_MIN_DAYS = 20;
export const POSITIONING_HISTORY = 60;

export const POSITIONING_THRESHOLDS = Object.freeze({
  putCallFearPct: 80, putCallGreedPct: 20,
  assetMgrLightZ: -1, assetMgrHeavyZ: 1.5,
  marginDeleverYoy: -10, marginHotYoy: 25,
  baaStressed: 3, baaWatch: 2.5, baaTight: 1.8,
  recessionStressed: 40, recessionWatch: 25,
  warningSignsWatch: 6,
});

export const CROWD_LABELS = Object.freeze({ "washed-out": "Washed out", neutral: "Neutral", crowded: "Crowded" });
export const CREDIT_LABELS = Object.freeze({ stressed: "Stressed", watch: "Watch", normal: "Normal", tight: "Tight" });

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// One day's labels from its market gauge row.
export function positioningLabel(mkt, T = POSITIONING_THRESHOLDS) {
  if (!mkt || typeof mkt !== "object") return null;
  const votes = [];
  const vote = (key, value, side, why) => votes.push({ key, value: r2(value), side, why });
  let crowdInputs = 0, fear = 0, greed = 0;
  const pcp = num(mkt.pcp);
  if (pcp != null) {
    crowdInputs++;
    if (pcp >= T.putCallFearPct) { fear++; vote("pcp", pcp, "fear", `put/call in the top fifth (${Math.round(pcp)}th percentile)`); }
    else if (pcp <= T.putCallGreedPct) { greed++; vote("pcp", pcp, "crowded", `put/call in the bottom fifth (${Math.round(pcp)}th percentile)`); }
  }
  const am = num(mkt.cotEsAmZ);
  if (am != null) {
    crowdInputs++;
    if (am <= T.assetMgrLightZ) { fear++; vote("cotEsAmZ", am, "fear", "asset managers light on S&P 500 futures"); }
    else if (am >= T.assetMgrHeavyZ) { greed++; vote("cotEsAmZ", am, "crowded", "asset managers heavy on S&P 500 futures"); }
  }
  const md = num(mkt.mdYoy);
  if (md != null) {
    crowdInputs++;
    if (md <= T.marginDeleverYoy) { fear++; vote("mdYoy", md, "fear", "margin debt shrinking"); }
    else if (md >= T.marginHotYoy) { greed++; vote("mdYoy", md, "crowded", "margin debt growing fast"); }
  }
  const net = fear - greed;
  const crowd = crowdInputs < 2 ? null : net >= 2 ? "washed-out" : net <= -2 ? "crowded" : "neutral";

  let creditInputs = 0, stressed = 0, watch = 0, tight = false;
  const baa = num(mkt.baa);
  if (baa != null) {
    creditInputs++;
    if (baa >= T.baaStressed) { stressed++; vote("baa", baa, "stressed", "Baa spread 3 points or wider"); }
    else if (baa >= T.baaWatch) { watch++; vote("baa", baa, "watch", "Baa spread 2.5 points or wider"); }
    else if (baa <= T.baaTight) tight = true;
  }
  const rec = num(mkt.kxRec);
  if (rec != null) {
    creditInputs++;
    if (rec >= T.recessionStressed) { stressed++; vote("kxRec", rec, "stressed", "recession odds 40% or higher"); }
    else if (rec >= T.recessionWatch) { watch++; vote("kxRec", rec, "watch", "recession odds 25% or higher"); }
  }
  const bsl = num(mkt.bsl);
  if (bsl != null) {
    creditInputs++;
    if (bsl >= T.warningSignsWatch) { watch++; vote("bsl", bsl, "watch", `${bsl} of 9 boom-and-bust warning signs`); }
  }
  const credit = !creditInputs ? null : stressed || watch >= 2 ? "stressed" : watch === 1 ? "watch" : tight ? "tight" : "normal";
  return { crowd, credit, net, crowdInputs, creditInputs, votes };
}

// SPY's close on or before a date, and h sessions later, as a percent move.
function forwardPct(cal, closes, date, h) {
  let i = -1;
  for (let k = cal.length - 1; k >= 0; k--) { if (cal[k] <= date) { i = k; break; } }
  if (i < 0 || i + h >= cal.length) return null;
  const a = num(closes[i]), b = num(closes[i + h]);
  return a && b ? ((b / a) - 1) * 100 : null;
}

function groupStats(rows, key, labels) {
  const out = {};
  for (const id of Object.keys(labels)) {
    const xs = rows.filter((r) => r[key] === id && r.fwd != null).map((r) => r.fwd);
    const n = xs.length;
    out[id] = {
      days: rows.filter((r) => r[key] === id).length,
      n,
      avgPct: n ? r2(xs.reduce((a, b) => a + b, 0) / n) : null,
      upPct: n ? Math.round((xs.filter((v) => v > 0).length / n) * 100) : null,
      status: n >= POSITIONING_MIN_DAYS ? "enough" : n > 0 ? "collecting" : "none",
    };
  }
  return out;
}

// days: grades-daily.json `days`; cal / spyCloses: SPY's session dates and
// closes (same length).
export function buildPositioning({ days = [], cal = [], spyCloses = [], horizon = POSITIONING_HORIZON } = {}) {
  const rows = [];
  for (const d of Array.isArray(days) ? days : []) {
    const date = typeof d?.date === "string" ? d.date.slice(0, 10) : null;
    const mkt = d?.shadow?.mkt;
    if (!date || !mkt) continue;
    const lab = positioningLabel(mkt);
    if (!lab || (lab.crowd == null && lab.credit == null)) continue;
    rows.push({ d: date, crowd: lab.crowd, credit: lab.credit, net: lab.net, fwd: cal.length === spyCloses.length ? forwardPct(cal, spyCloses, date, horizon) : null, lab });
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const last = rows[rows.length - 1] || null;
  const scored = rows.filter((r) => r.fwd != null);
  const all = scored.map((r) => r.fwd);
  return {
    v: POSITIONING_RULES_VERSION,
    horizon,
    minDays: POSITIONING_MIN_DAYS,
    thresholds: { ...POSITIONING_THRESHOLDS },
    labels: { crowd: CROWD_LABELS, credit: CREDIT_LABELS },
    today: last ? { d: last.d, crowd: last.crowd, credit: last.credit, net: last.net, crowdInputs: last.lab.crowdInputs, creditInputs: last.lab.creditInputs, votes: last.lab.votes } : null,
    days: rows.length,
    base: { n: all.length, avgPct: all.length ? r2(all.reduce((a, b) => a + b, 0) / all.length) : null, upPct: all.length ? Math.round((all.filter((v) => v > 0).length / all.length) * 100) : null },
    byCrowd: groupStats(rows, "crowd", CROWD_LABELS),
    byCredit: groupStats(rows, "credit", CREDIT_LABELS),
    history: rows.slice(-POSITIONING_HISTORY).map((r) => ({ d: r.d, crowd: r.crowd, credit: r.credit, net: r.net })),
    note: "Research only. Labels come from the daily market gauges the bake already logs; SPY's next-10-session move by label overlaps day to day, so it describes, it does not test. Nothing here changes a pick, a grade, a gate or the Track Record.",
  };
}
