// Fed liquidity line for the Rates page (2026-11-07).
//
// Net liquidity = Federal Reserve total assets (WALCL) minus the Treasury's
// cash account at the Fed (WTREGEN) minus overnight reverse-repo usage
// (RRPONTSYD). It is a common rough read of how much reserve cash the Fed's
// balance sheet leaves in the banking system. The three FRED series are
// already in the shared long-history cache (lib/historical-sources.mjs), so
// this adds no download. Weekly, on the Wednesday WALCL is dated; reverse
// repo uses the last daily reading on or before that Wednesday.
//
// Units: WALCL and WTREGEN are millions of dollars, RRPONTSYD billions.
// Output is billions. Pure; rides in macro-history.json as `liquidity`.

export const FED_LIQUIDITY_WEEKS = 160;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

function clean(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ date: String(r?.date || r?.t || "").slice(0, 10), value: Number(r?.value ?? r?.v) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Last value on or before `date` from ascending rows, within `maxDays`.
function asOf(rows, date, maxDays) {
  let lo = 0, hi = rows.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rows[hit].date}T00:00:00Z`)) / 86400000;
  return gap <= maxDays ? rows[hit].value : null;
}

export function buildFedLiquidity({ walcl, tga, rrp, prior = null, weeks = FED_LIQUIDITY_WEEKS } = {}) {
  const W = clean(walcl), T = clean(tga), R = clean(rrp);
  if (W.length < 8 || !T.length) return prior ? { ...prior, stale: true } : null;
  const dates = [], net = [], fed = [], cash = [], repo = [];
  for (const w of W.slice(-weeks)) {
    const t = asOf(T, w.date, 10);
    if (t == null) continue;
    // Reverse repo is daily; zero usage is a real observation.
    const r = R.length ? asOf(R, w.date, 7) : 0;
    if (r == null) continue;
    dates.push(w.date);
    fed.push(r1(w.value / 1000));
    cash.push(r1(t / 1000));
    repo.push(r1(r));
    net.push(r1(w.value / 1000 - t / 1000 - r));
  }
  if (dates.length < 8) return prior ? { ...prior, stale: true } : null;
  const last = net.length - 1;
  const change = (k) => (last - k >= 0 ? r1(net[last] - net[last - k]) : null);
  return {
    asOf: dates[last],
    unit: "billions of dollars",
    source: "FRED: WALCL (Fed total assets), WTREGEN (Treasury General Account), RRPONTSYD (overnight reverse repo)",
    dates, net, fed, tga: cash, rrp: repo,
    change4w: change(4),
    change13w: change(13),
    change52w: change(52),
    stale: false,
  };
}
