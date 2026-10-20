// Sector-relative growth bars for the Fundamentals pillar's revenue-growth and
// EPS-growth signals (2026-10-20, owner review "Top Picks grading by sector").
//
// A single bar for every company (revenue +1 at 8%, +2 at 20%) judged a
// warehouse retailer against a software company. Each covered name now maps to
// a growth profile whose "in line" band is that kind of business's normal
// growth, anchored to long-run industry history (Damodaran, NYU, Jan 2026
// industry dataset: 5-year revenue/net-income CAGR and expected growth) and the
// S&P 500's 10-year averages (FactSet: revenue 5.7%/yr, earnings 9.5%/yr).
// The 2020-25 industry window runs hot (post-COVID rebound, inflation), so the
// bands sit nearer the long-run and forward-expected rates. The inputs are one
// quarter vs the same quarter a year earlier, which swings more than an annual
// rate, so the bands are a little wider than the annual history.
//
// Score per signal:
//   >= wellAbove  +2 "well above norm"
//   >= above      +1 "above norm"
//   >= low         0 "in line"
//   <  low        -1 "below norm"
//   <  shrink     -2 "well below norm"
// Two guards keep a single bad print from reading as a decline:
//   - Recovery: a penalty is waived ("recovering" while the rate is still
//     negative, "improving" once it is positive) when the year-over-year rate
//     improved by >= recoveryPp points on the prior quarter's rate. Both rates
//     are year-over-year, so seasonal quarters (a holiday quarter, a 16-week
//     fiscal Q4) do not trip it. Revenue reads the accumulated quarterly revenue;
//     EPS reads quarterly GAAP net income, which is on the same basis as Yahoo's
//     EPS growth figure and is not distorted by stock splits (stored per-share
//     EPS is not split-adjusted). The history must end at the latest reported
//     quarter. Without two quarters of revenue history, consensus for the next
//     quarter stands in (>= recoveryPp points better). EPS has no consensus
//     stand-in: the estimate is adjusted EPS and the scored figure is GAAP.
//   - EPS one-off: an EPS penalty needs confirmation, either revenue is also
//     below its norm or net income growth was below the EPS norm the quarter
//     before too. A single weak quarter with healthy revenue is shown but not
//     scored.
// Names without a profile (not in the covered universe's sectors) keep the
// legacy one-size bars unchanged. Pure and deterministic: no AI, no network.

const band = (low, above, wellAbove, shrink) => ({ low, above, wellAbove, shrink });

export const GROWTH_RECOVERY_PP = 10;

export const GROWTH_PROFILES = {
  software: { label: "Software", rev: band(12, 20, 30, 0), eps: band(15, 25, 40, -20) },
  semis: { label: "Semis", rev: band(10, 20, 35, -15), eps: band(10, 25, 50, -30) },
  semiEquipment: { label: "Semi equipment", rev: band(8, 15, 25, -15), eps: band(10, 18, 35, -25) },
  // Revenue follows memory prices, so the bars are wide and recovery needs a
  // bigger swing; the band still starts at 10% (the industry's long-run pace).
  memory: { label: "Memory & storage", rev: band(10, 25, 50, -25), eps: band(10, 40, 100, -50), recoveryPp: 20 },
  megaCap: { label: "Mega-cap platforms", rev: band(8, 15, 25, -5), eps: band(10, 18, 30, -15) },
  hardware: { label: "Hardware & networking", rev: band(5, 15, 30, -15), eps: band(10, 20, 35, -20) },
  itServices: { label: "IT services", rev: band(3, 8, 15, -5), eps: band(5, 10, 18, -10) },
  banks: { label: "Banks", rev: band(3, 9, 15, -10), eps: band(5, 12, 25, -20) },
  payments: { label: "Payments", rev: band(7, 12, 18, -5), eps: band(10, 15, 25, -15) },
  brokers: { label: "Brokers", rev: band(5, 15, 30, -15), eps: band(5, 15, 35, -25) },
  pharma: { label: "Pharma", rev: band(3, 10, 20, -10), eps: band(4, 12, 25, -20) },
  managedCare: { label: "Managed care", rev: band(6, 12, 18, -5), eps: band(8, 14, 20, -10) },
  retail: { label: "Retail", rev: band(2, 7, 11, -5), eps: band(5, 10, 18, -15) },
  apparel: { label: "Apparel", rev: band(2, 8, 15, -8), eps: band(3, 10, 20, -20) },
  restaurants: { label: "Restaurants", rev: band(3, 8, 14, -5), eps: band(5, 10, 18, -15) },
  media: { label: "Media", rev: band(3, 8, 15, -8), eps: band(3, 12, 25, -20) },
  chinaInternet: { label: "China internet", rev: band(5, 12, 25, -10), eps: band(5, 15, 30, -20) },
  power: { label: "Power", rev: band(2, 10, 20, -15), eps: band(3, 12, 25, -25) },
  electrical: { label: "Electrical / data center", rev: band(10, 20, 35, -10), eps: band(12, 20, 35, -15) },
  // Growth off a tiny revenue base is not comparable (ASTS +1,952%), and EPS is
  // not meaningful while the company is still losing money: revenue only, at
  // high bars, with no "below norm" step.
  earlyStage: { label: "Early-stage", rev: band(null, 30, 60, -10), eps: null, recoveryPp: 20 },
};

// The legacy one-size bars, kept for any name without a profile.
export const LEGACY_GROWTH_BARS = {
  rev: band(null, 8, 20, -20),
  eps: band(null, 10, 30, -25),
};

// Curated SECTORS label -> profile. Labels not listed keep the legacy bars.
const PROFILE_BY_SECTOR_LABEL = {
  "Software": "software",
  "Semis": "semis",
  "Storage": "memory",
  "Mega-cap tech": "megaCap",
  "Hardware": "hardware",
  "Networking": "hardware",
  "IT services": "itServices",
  "Tech services": "itServices",
  "Bank": "banks",
  "Payments": "payments",
  "Broker": "brokers",
  "Pharma": "pharma",
  "Insurance": "managedCare",
  "Retail": "retail",
  "Apparel": "apparel",
  "Restaurants": "restaurants",
  "Media": "media",
  "China tech": "chinaInternet",
  "Power": "power",
  "Data center": "electrical",
  "Clean energy": "electrical",
  "Space": "earlyStage",
};

// Names whose display sector is not their growth peer group.
const PROFILE_BY_SYMBOL = {
  NVDA: "semis",          // filed under mega-cap tech, grows like a chip company
  MU: "memory", DRAM: "memory", SNDK: "memory", WDC: "memory", STX: "memory",
  ASML: "semiEquipment", AMAT: "semiEquipment", LRCX: "semiEquipment",
  SMCI: "hardware",       // server maker filed under semis
  CBRS: "earlyStage",     // newly public, growth off a small base
};

export function growthProfileKeyFor(sym, sectorLabel) {
  if (sym && PROFILE_BY_SYMBOL[sym]) return PROFILE_BY_SYMBOL[sym];
  return (sectorLabel && PROFILE_BY_SECTOR_LABEL[sectorLabel]) || null;
}

const DAY_MS = 86400000;
const num = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r1 = (x) => Math.round(x * 10) / 10;
const fmtPct = (x) => `${r1(x)}%`;

// Year-over-year rate for every quarter that has a comparable quarter
// 335-395 days earlier with a positive base (a growth rate off a zero or
// negative base is undefined). rows: [{ date, value }].
export function quarterlyYoySeries(rows) {
  const pts = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ date: r?.date, t: Date.parse(r?.date), v: num(r?.value) }))
    .filter((p) => p.date && Number.isFinite(p.t) && p.v != null)
    .sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of pts) {
    let base = null, bestGap = Infinity;
    for (const q of pts) {
      const days = (p.t - q.t) / DAY_MS;
      if (days < 335 || days > 395) continue;
      const gap = Math.abs(days - 365);
      if (gap < bestGap) { bestGap = gap; base = q; }
    }
    if (!base || !(base.v > 0)) continue;
    out.push({ date: p.date, t: p.t, yoy: (p.v / base.v - 1) * 100 });
  }
  return out;
}

// The latest quarter's YoY rate and the one before it, when the latest is
// recent (<= 200 days old), matches the latest reported quarter when that is
// known (within 45 days, so a history that lags a new print is not used), and
// the two quarters are consecutive (60-120 days apart).
export function latestTwoYoy(series, asOfMs = Date.now(), anchorMs = null) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const latest = series[series.length - 1];
  if (!(asOfMs - latest.t <= 200 * DAY_MS)) return null;
  if (Number.isFinite(anchorMs) && Math.abs(latest.t - anchorMs) > 45 * DAY_MS) return null;
  let prev = null;
  for (let i = series.length - 2; i >= 0; i--) {
    const gap = (latest.t - series[i].t) / DAY_MS;
    if (gap >= 60 && gap <= 120) { prev = series[i]; break; }
    if (gap > 120) break;
  }
  if (!prev) return null;
  return { latest: latest.yoy, prev: prev.yoy, deltaPp: latest.yoy - prev.yoy, date: latest.date };
}

// Consensus YoY for the next quarter: its revenue estimate against the same
// quarter a year earlier.
function forwardRevenueYoy(f) {
  const est = (Array.isArray(f?.revenueForwardEstimates) ? f.revenueForwardEstimates : [])
    .find((e) => e?.period === "0q" && num(e?.value) != null && e?.date);
  if (!est) return null;
  const t = Date.parse(est.date);
  if (!Number.isFinite(t)) return null;
  let base = null, bestGap = Infinity;
  for (const r of Array.isArray(f?.revenueHistory) ? f.revenueHistory : []) {
    const rt = Date.parse(r?.date), v = num(r?.value);
    if (!Number.isFinite(rt) || v == null) continue;
    const days = (t - rt) / DAY_MS;
    if (days < 335 || days > 395) continue;
    if (Math.abs(days - 365) < bestGap) { bestGap = Math.abs(days - 365); base = v; }
  }
  return base > 0 ? (num(est.value) / base - 1) * 100 : null;
}

export function growthBarScore(x, b) {
  if (x == null || !b) return { score: 0, verdict: null };
  if (x >= b.wellAbove) return { score: 2, verdict: "well above norm" };
  if (x >= b.above) return { score: 1, verdict: "above norm" };
  if (x < b.shrink) return { score: -2, verdict: "well below norm" };
  if (b.low != null && x < b.low) return { score: -1, verdict: "below norm" };
  return { score: 0, verdict: b.low != null ? "in line" : "below the +1 bar" };
}

function barsNote(profile, b) {
  return b.low != null
    ? `${profile.label} norm ${b.low}–${b.above}% · +1 at ${b.above}%, +2 at ${b.wellAbove}%`
    : `${profile.label}: +1 at ${b.above}%, +2 at ${b.wellAbove}%, −2 below ${b.shrink}%`;
}

// Verdict and note for a waived penalty. A negative rate that is climbing is
// "recovering"; a positive one that is below the norm but climbing is
// "improving".
function recoveryText(rec, current, profile, b, metric) {
  const lead = rec.source === "history"
    ? `${metric} growth went from ${fmtPct(rec.prior)} to ${fmtPct(rec.latest)} over the last two quarters (+${r1(rec.deltaPp)} pts)`
    : `Consensus sees next quarter at ${fmtPct(rec.forward)} (+${r1(rec.deltaPp)} pts)`;
  return {
    verdict: current < 0 ? "recovering" : "improving",
    note: `${lead}, so the shortfall is not penalized · ${barsNote(profile, b)}`,
  };
}

// Recovery read for one metric. History (two consecutive YoY rates) wins;
// consensus is the fallback only when history is too short.
function recoveryRead(trend, current, forwardYoy, thresholdPp) {
  if (trend) {
    return { source: "history", prior: trend.prev, latest: trend.latest, deltaPp: trend.deltaPp, recovering: trend.deltaPp >= thresholdPp };
  }
  if (forwardYoy != null && current != null) {
    const d = forwardYoy - current;
    return { source: "consensus", forward: forwardYoy, deltaPp: d, recovering: d >= thresholdPp };
  }
  return null;
}

// Sector-relative revenue and EPS growth signals for one name. Returns null
// when the name has no profile (the caller keeps the legacy bars).
export function scoreSectorGrowth({ sym, sectorLabel, revYoy, epsYoy, fundamentals, asOfMs = Date.now() }) {
  const key = growthProfileKeyFor(sym, sectorLabel);
  const profile = key ? GROWTH_PROFILES[key] : null;
  if (!profile) return null;
  const f = fundamentals || {};
  const thresholdPp = profile.recoveryPp ?? GROWTH_RECOVERY_PP;
  const rev = num(revYoy), eps = num(epsYoy);
  // The latest reported quarter, so a history that lags a new print is not
  // read as this quarter's trend.
  const anchorMs = f.lastQuarter?.date ? Date.parse(f.lastQuarter.date) : null;

  // Revenue.
  const revOut = { score: 0, verdict: null, value: null, note: null, available: rev != null };
  let revBelowNorm = false;
  if (rev != null) {
    const raw = growthBarScore(rev, profile.rev);
    revBelowNorm = raw.score < 0;
    revOut.score = raw.score;
    revOut.verdict = raw.verdict;
    revOut.note = barsNote(profile, profile.rev);
    if (raw.score < 0) {
      const trend = latestTwoYoy(quarterlyYoySeries(f.revenueHistory), asOfMs, anchorMs);
      const rec = recoveryRead(trend, rev, forwardRevenueYoy(f), thresholdPp);
      revOut.recovery = rec;
      if (rec?.recovering) {
        const t = recoveryText(rec, rev, profile, profile.rev, "Revenue");
        revOut.score = 0;
        revOut.verdict = t.verdict;
        revOut.note = t.note;
      }
    }
    revOut.value = `${fmtPct(rev)} · ${revOut.verdict}`;
  }

  // EPS.
  const epsOut = { score: 0, verdict: null, value: null, note: null, available: eps != null };
  if (!profile.eps) {
    epsOut.value = eps != null ? `${fmtPct(eps)} · not scored` : null;
    epsOut.note = `${profile.label}: EPS growth is not scored while profits are not yet established`;
  } else if (eps != null) {
    const raw = growthBarScore(eps, profile.eps);
    epsOut.score = raw.score;
    epsOut.verdict = raw.verdict;
    epsOut.note = barsNote(profile, profile.eps);
    if (raw.score < 0) {
      const trend = latestTwoYoy(quarterlyYoySeries(f.netIncomeHistory), asOfMs, anchorMs);
      const rec = recoveryRead(trend, eps, null, thresholdPp);
      epsOut.recovery = rec;
      if (rec?.recovering) {
        const t = recoveryText(rec, eps, profile, profile.eps, "Net income");
        epsOut.score = 0;
        epsOut.verdict = t.verdict;
        epsOut.note = t.note;
      } else {
        // One-off guard: a single weak EPS quarter with healthy revenue is
        // usually a charge, not a business in decline. Revenue below its norm
        // (even while improving) or a second weak quarter confirms the penalty.
        const priorBelow = trend != null && trend.prev < profile.eps.low;
        if (rev != null && !revBelowNorm && !priorBelow) {
          epsOut.score = 0;
          epsOut.verdict = `${raw.verdict}, one quarter`;
          epsOut.note = (trend != null
            ? `Not scored: revenue is not below its norm and net income grew ${fmtPct(trend.prev)} the quarter before, so this reads as a one-off`
            : `Not scored: revenue is not below its norm, so one weak EPS quarter reads as a one-off`)
            + ` · ${barsNote(profile, profile.eps)}`;
        }
      }
    }
    epsOut.value = `${fmtPct(eps)} · ${epsOut.verdict}`;
  }

  return { profileKey: key, profile, rev: revOut, eps: epsOut };
}
