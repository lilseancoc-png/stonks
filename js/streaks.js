// Streaks tab: renders data/streaks.json -- per-ticker daily green/red
// streak runs computed at build time from Yahoo daily closes. Active runs
// share filters and sorting with a collapsible recently-snapped watchlist.

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]),
  );
}

function fmtPct(n, digits = 1) {
  if (n == null || !isFinite(n)) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

function fmtMoney(n) {
  if (n == null || !isFinite(n)) return "—";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShortDate(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
}

function dataUrl() {
  const v = window.STONKS_MANIFEST?.builtAtIso || Date.now().toString();
  return `data/streaks.json?v=${encodeURIComponent(v)}`;
}

function streaksSkeleton() {
  // Shimmering placeholder that matches the eventual two-column layout
  // so the page doesn't visually jump when streaks arrive.
  const col = (n) => `
    <div class="streaks-col">
      <span class="skel skel-line" style="width: 60%; height: 14px; margin-bottom: 12px;"></span>
      ${Array(n).fill(0).map(() => `
        <div class="streaks-row" aria-hidden="true">
          <div class="streaks-head"><span class="skel skel-line" style="width: 50%"></span></div>
          <div class="streaks-meta"><span class="skel skel-line" style="width: 80%"></span></div>
        </div>`).join("")}
    </div>`;
  return `<div class="streaks-cols">${col(3)}${col(3)}</div>`;
}

const streaksState = {
  sort: "streak",
  minStreak: 2,
  sector: "",
  query: "",
  data: null,
  sortBound: false,
  snappedCollapsed: false,
};

async function loadStreaks() {
  const root = $("streaks-root");
  const footer = $("streaks-footer");
  const eyebrow = $("streaks-eyebrow");
  if (!root) return;
  bindStreaksControls();
  root.innerHTML = streaksSkeleton();
  try {
    const r = await fetch(dataUrl(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    streaksState.data = json;
    render(root, footer, eyebrow, json);
  } catch (err) {
    root.innerHTML = `<p class="streaks-empty">Couldn't load streaks (${escapeHtml(err.message || err)}).</p>`;
  }
}

function rerender() {
  if (streaksState.data) {
    render($("streaks-root"), $("streaks-footer"), $("streaks-eyebrow"), streaksState.data);
  }
}

function bindStreaksControls() {
  if (streaksState.sortBound) return;
  const sel = $("streaks-sort-select");
  if (!sel) return;
  streaksState.sortBound = true;
  const views = V();
  sel.value = streaksState.sort;
  if (views) {
    streaksState.snappedCollapsed = views.get("streaks.snappedCollapsed", false) === true;
    streaksState.sort = views.remember(sel, "streaks.sort") || "streak";
    if (STREAK_SORTS.indexOf(streaksState.sort) === -1) streaksState.sort = "streak";
    views.attachFlip(sel, "streaks", rerender);
    const bar = sel.closest(".streaks-controls");
    if (bar && !bar.querySelector(".view-toggle")) bar.insertAdjacentHTML("beforeend", views.viewToggleHtml("streaks"));
    views.onView("streaks", rerender);
  }
  sel.addEventListener("change", () => {
    streaksState.sort = sel.value || "streak";
    rerender();
  });

  const minSel = $("streaks-min-select");
  if (minSel) {
    minSel.value = String(streaksState.minStreak);
    if (views) streaksState.minStreak = Number(views.remember(minSel, "streaks.min")) || 2;
    minSel.addEventListener("change", () => {
      streaksState.minStreak = Number(minSel.value) || 2;
      rerender();
    });
  }

  const sectorSel = $("streaks-sector-select");
  if (sectorSel) {
    sectorSel.addEventListener("change", () => {
      streaksState.sector = sectorSel.value || "";
      rerender();
    });
  }

  const search = $("streaks-search");
  if (search) {
    search.value = streaksState.query;
    search.addEventListener("input", () => {
      streaksState.query = String(search.value || "").trim().toUpperCase();
      rerender();
    });
  }
}

// Broad sector group for a symbol (lib/sector-groups.mjs, shared through
// window.STONKS_VIEWS by app.js) so the filter here lists the same handful of
// groups as the rest of the site. Falls back to the fine manifest label.
function sectorGroupFor(sectors, symbol) {
  const sym = String(symbol || "").toUpperCase();
  const views = V();
  const group = views && views.sectorGroupOf ? views.sectorGroupOf(sym) : null;
  return group || sectors[sym] || "";
}

// Fill the sector <select> once from whatever sector groups are present in the
// data (intersected with the manifest's sector map), preserving the current pick.
function populateSectorFilter(tickers, sectors) {
  const sel = $("streaks-sector-select");
  if (!sel || sel.dataset.filled) return;
  const present = new Set();
  for (const t of tickers) {
    const s = sectorGroupFor(sectors, t.symbol);
    if (s) present.add(s);
  }
  if (!present.size) return;
  const opts = ['<option value="">All sectors</option>']
    .concat([...present].sort().map((s) =>
      `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`));
  sel.innerHTML = opts.join("");
  sel.value = streaksState.sector;
  const views = V();
  if (views) streaksState.sector = views.remember(sel, "streaks.sector") || "";
  sel.dataset.filled = "1";
}

function fmtSessionsAgo(n) {
  if (n == null || !isFinite(n)) return "";
  if (n <= 0) return "today";
  if (n === 1) return "1 session ago";
  return `${n} sessions ago`;
}

function streakSignalDays(t) {
  return Number(t?.current?.sameDays ?? t?.current?.days ?? 0);
}

function streakWindowDays(t) {
  return Number(t?.current?.windowDays ?? t?.current?.days ?? streakSignalDays(t));
}

// Shared sort / view helpers from app.js (absent if app.js failed to load).
const V = () => window.STONKS_VIEWS || null;
const STREAK_SORTS = ["streak", "cum", "vol", "last", "tol", "up", "down", "grade", "sector", "alpha"];
function streakGrade(t) {
  const v = V();
  return v && v.gradeTotal ? v.gradeTotal(String(t.symbol || "").toUpperCase(), rerender) : null;
}

// Run-derived fields refer to the ended run in the snapped column.
function makeSorter(mode, runFor = (t) => t.current) {
  const days = (t) => Number(runFor(t)?.sameDays ?? runFor(t)?.days ?? 0);
  const signedCum = (t) => Number(runFor(t)?.cumulativePct) || 0;
  // Signed up/down sorts preserve direction; magnitude sorts work across
  // both colors in the snapped column as well as the active columns.
  if (mode === "up") {
    return (a, b) => signedCum(b) - signedCum(a) || days(b) - days(a);
  }
  if (mode === "down") {
    return (a, b) => signedCum(a) - signedCum(b) || days(b) - days(a);
  }
  if (mode === "grade") {
    return (a, b) => {
      const ga = streakGrade(a), gb = streakGrade(b);
      if (ga == null || gb == null) return ga == null ? (gb == null ? 0 : 1) : -1;
      return gb - ga || days(b) - days(a);
    };
  }
  if (mode === "sector") {
    const sectors = (window.STONKS_MANIFEST && window.STONKS_MANIFEST.sectors) || {};
    const sec = (t) => sectorGroupFor(sectors, t.symbol) || "~";
    return (a, b) => sec(a).localeCompare(sec(b)) || days(b) - days(a);
  }
  if (mode === "alpha") {
    return (a, b) => String(a.symbol || "").localeCompare(String(b.symbol || ""));
  }
  if (mode === "cum") {
    return (a, b) => Math.abs(runFor(b).cumulativePct || 0) - Math.abs(runFor(a).cumulativePct || 0)
      || days(b) - days(a);
  }
  if (mode === "last") {
    return (a, b) => (Number(b.lastClose) || 0) - (Number(a.lastClose) || 0);
  }
  if (mode === "vol") {
    // Strongest volume conviction first; names with no volume read sink.
    const vr = (t) => Number(runFor(t).volumeRatio) || 0;
    return (a, b) => vr(b) - vr(a)
      || days(b) - days(a);
  }
  if (mode === "tol") {
    // "Tolerance bank used" — bigger value = streak closer to breaking.
    const bank = (t) => {
      if (runFor(t).tolerancePct == null) return -1;
      const tol = Number(runFor(t).tolerancePct || 0);
      const tolBreak = Number(runFor(t).toleranceBreakPct || 1.5);
      return tolBreak > 0 ? tol / tolBreak : 0;
    };
    return (a, b) => bank(b) - bank(a)
      || (runFor(b).consecutiveCounterDays ?? runFor(b).counterDays ?? 0) - (runFor(a).consecutiveCounterDays ?? runFor(a).counterDays ?? 0)
      || days(b) - days(a);
  }
  // Default: streak length, then cumulative magnitude.
  return (a, b) => days(b) - days(a)
    || Math.abs(runFor(b).cumulativePct || 0) - Math.abs(runFor(a).cumulativePct || 0);
}

// The builder owns materiality; the UI consistently enforces its recency and
// minimum same-direction-day contract, including older cached payloads.
function hasRecentSnap(t, minDays = 3) {
  const e = t?.lastEnded;
  return !!e && (e.color === "green" || e.color === "red")
    && Number(e.sameDays ?? e.days) >= Math.max(3, minDays)
    && Number.isInteger(e.sessionsAgo) && e.sessionsAgo >= 0 && e.sessionsAgo <= 2;
}

function streakMarketDayParts(date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const out = {};
    parts.forEach((p) => {
      if (p.type !== "literal") out[p.type] = Number(p.value);
    });
    return out;
  } catch (_) {
    return null;
  }
}

function streakSessionGap(iso) {
  const scan = new Date(iso || "");
  if (!isFinite(scan.getTime())) return null;
  const from = streakMarketDayParts(scan);
  const to = streakMarketDayParts(new Date());
  if (!from || !to) return null;
  const fromDay = new Date(Date.UTC(from.year, from.month - 1, from.day, 12));
  const toDay = new Date(Date.UTC(to.year, to.month - 1, to.day, 12));
  if (toDay <= fromDay) return 0;
  let sessions = 0;
  for (let d = new Date(fromDay.getTime() + 86400000); d <= toDay; d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) sessions++;
  }
  return sessions;
}

function streakFreshnessMeta(builtAtIso) {
  const gap = streakSessionGap(builtAtIso);
  if (gap === 0) {
    return {
      current: true,
      label: "Current daily streak map",
      detail: "Latest completed daily-close build.",
    };
  }
  return {
    current: false,
    label: "Reference only · stale streaks",
    detail: gap == null
      ? "The streak snapshot date could not be verified."
      : `${gap} market session${gap === 1 ? "" : "s"} behind.`,
  };
}

function streakCandidateMeta(t) {
  const cur = t?.current || {};
  const ended = t?.lastEnded || null;
  const days = streakSignalDays(t);
  const windowDays = streakWindowDays(t);
  const cum = Number(cur.cumulativePct || 0);
  const tol = Number(cur.tolerancePct || 0);
  const tolBreak = Number(cur.toleranceBreakPct || 1.5);
  const counterDays = Number(cur.consecutiveCounterDays ?? cur.counterDays ?? 0);
  const counterBreak = Number(cur.counterDaysBreak || 4);
  const bankPct = Math.max(
    tolBreak > 0 ? (tol / tolBreak) * 100 : 0,
    counterBreak > 0 ? (counterDays / counterBreak) * 100 : 0,
  );
  const fragile = days >= 2 && bankPct >= 66;
  const volumeRatio = Number(cur.volumeRatio);
  const continuation = days >= 3
    && cur.volumeTrend === "rising"
    && isFinite(volumeRatio)
    && volumeRatio >= 1.05
    && !fragile;
  const stretched = days >= 5 || Math.abs(cum) >= 8;
  const snapped = hasRecentSnap(t);
  let rank = days * 100 + Math.abs(cum) * 20;
  if (snapped) {
    rank += 100000
      + Math.max(0, 2 - Number(ended.sessionsAgo || 0)) * 2000
      + Number(ended.days || 0) * 200
      + Math.abs(Number(ended.cumulativePct || 0)) * 30;
  } else if (fragile) {
    rank += 80000 + bankPct * 20;
  } else if (continuation) {
    rank += 60000 + volumeRatio * 100;
  } else if (stretched) {
    rank += 40000;
  }
  return {
    ticker: t,
    symbol: String(t?.symbol || "").toUpperCase(),
    days,
    windowDays,
    color: cur.color === "red" ? "red" : "green",
    cumulativePct: cum,
    lastClose: Number(t?.lastClose),
    volumeRatio,
    volumeTrend: cur.volumeTrend || "",
    bankPct,
    counterDays,
    fragile,
    continuation,
    stretched,
    snapped,
    ended,
    rank,
  };
}

function streakDecisionStats(tickers) {
  const candidates = (tickers || []).map(streakCandidateMeta).sort((a, b) => b.rank - a.rank);
  return {
    candidates,
    top: candidates[0] || null,
    fragile: candidates.filter((c) => c.fragile).length,
    continuation: candidates.filter((c) => c.continuation).length,
    stretched: candidates.filter((c) => c.stretched).length,
    snapped: candidates.filter((c) => c.snapped).length,
  };
}

function renderStreakDecision(tickers, builtAtIso, breadth, filterActive) {
  const stats = streakDecisionStats(tickers);
  const top = stats.top;
  if (!top) {
    return `
      <section class="flow-decision streaks-decision flow-decision-empty" aria-label="Streak decision desk">
        <div class="flow-decision-empty-copy">
          <span>Streak decision desk</span>
          <h3>No streak setup survives this view</h3>
          <p>The ticker, minimum-run, or sector filter removed every active or recently snapped run.</p>
        </div>
        <button type="button" class="flow-decision-action is-primary" data-streak-reset>Reset filters</button>
      </section>`;
  }
  const freshness = streakFreshnessMeta(builtAtIso);
  const anchor = isFinite(top.lastClose) ? fmtMoney(top.lastClose) : "No close";
  const ended = top.ended || {};
  const state = top.snapped
    ? "snapped"
    : top.fragile
      ? "fragile"
      : top.continuation
        ? "continuation"
        : top.stretched
          ? "stretched"
          : "context";
  const runColor = top.snapped ? (ended.color === "red" ? "red" : "green") : top.color;
  const reversal = runColor === "red" ? "bounce" : "pullback";
  const confirmAbove = state === "snapped" || state === "fragile"
    ? runColor === "red"
    : runColor === "green";
  const confirmSide = confirmAbove ? "above" : "below";
  const failSide = confirmAbove ? "below" : "above";
  let headline = "";
  let copy = "";
  let confirm = "";
  let invalidate = "";
  if (state === "snapped") {
    headline = `${top.symbol}'s ${ended.days}d ${runColor} streak snapped; the ${reversal} is on watch.`;
    copy = `The prior run moved ${fmtPct(ended.cumulativePct)} before breaking ${fmtSessionsAgo(ended.sessionsAgo)}. A snapped streak creates a mean-reversion candidate, not an automatic entry.`;
    confirm = `The next daily close holds ${confirmSide} ${anchor}, and the Grade plus Volume tabs agree with the ${reversal} direction.`;
    invalidate = `Price closes back ${failSide} ${anchor}, the old ${runColor} streak restarts, or the reversal lacks participation.`;
  } else if (state === "fragile") {
    headline = `${top.symbol}'s ${top.days}d ${top.color} run is near its break threshold.`;
    copy = `${top.bankPct.toFixed(0)}% of the tolerance tripwire is used. The fade is not active until a daily close confirms against the run.`;
    confirm = `A daily close prints ${confirmSide} ${anchor} against the ${top.color} run, then Grade and Volume confirm the reversal side.`;
    invalidate = `The next close stays ${failSide} ${anchor}, tolerance heals, or same-direction volume expands and extends the run.`;
  } else if (state === "continuation") {
    headline = `${top.symbol}'s ${top.days}d ${top.color} streak still has continuation quality.`;
    copy = `Run volume is ${top.volumeRatio.toFixed(2)}× its baseline and the tolerance bank is intact. Follow the run only after another close confirms; do not chase the cumulative move intraday.`;
    confirm = `The next daily close holds ${confirmSide} ${anchor} with run volume at or above baseline, and Grade agrees with the ${top.color} direction.`;
    invalidate = `Price closes ${failSide} ${anchor}, volume fades below baseline, or the tolerance bank moves into the fragile zone.`;
  } else if (state === "stretched") {
    headline = `${top.symbol}'s ${top.days}d ${top.color} run is stretched, not yet a fade.`;
    copy = `The move has accumulated ${fmtPct(top.cumulativePct)}. Extension raises mean-reversion risk, but length alone does not confirm a reversal.`;
    confirm = `For continuation, the next close holds ${confirmSide} ${anchor}; for a fade, wait for a close through the same anchor in the opposite direction.`;
    invalidate = `A trade taken before either daily-close condition is met has no defined streak trigger.`;
  } else {
    headline = "No streak trade is ready from this view alone.";
    copy = `${top.symbol} has the strongest remaining run, but it is neither volume-confirmed, fragile, stretched, nor freshly snapped.`;
    confirm = `A clean continuation, fragile break, or fresh snap develops and another screen supplies direction and risk levels.`;
    invalidate = `The run remains short and ordinary, or its only evidence is cumulative color without participation.`;
  }
  if (!freshness.current) {
    headline = "This streak map is reference only.";
    copy = `${top.symbol} was the strongest setup in an older daily-close snapshot. Run length and snap status must be rebuilt before using the anchor.`;
    confirm = "A current daily build reproduces the same continuation, fragility, or snap state and the live Grade tab confirms the setup.";
    invalidate = "Fresh closes change the run color, anchor, tolerance bank, or snapped status.";
  }
  const runDays = top.snapped ? Number(ended.days || 0) : top.days;
  const runCum = top.snapped ? Number(ended.cumulativePct || 0) : top.cumulativePct;
  const quality = top.snapped
    ? `Snapped ${fmtSessionsAgo(ended.sessionsAgo)}`
    : top.fragile
      ? `${top.bankPct.toFixed(0)}% tripwire used`
      : top.volumeTrend && isFinite(top.volumeRatio)
        ? `${top.volumeRatio.toFixed(2)}× volume`
        : "No volume confirmation";
  const qualitySub = top.snapped
    ? String(ended.brokeBy || "fresh reversal close")
    : top.fragile
      ? `${top.counterDays} counter day${top.counterDays === 1 ? "" : "s"}`
      : top.volumeTrend
        ? `${top.volumeTrend} run volume`
        : "use Volume before acting";
  return `
    <section class="flow-decision streaks-decision flow-decision-${freshness.current ? "mixed" : "reference"}" aria-label="Streak decision desk">
      <div class="flow-decision-main">
        <div class="flow-decision-head">
          <span>Streak decision desk${filterActive ? " · current filters" : ""}</span>
          <em>${escapeHtml(freshness.label)}</em>
        </div>
        <h3>${escapeHtml(headline)}</h3>
        <p>${escapeHtml(copy)}</p>
        <div class="flow-decision-rules">
          <div><span>Confirms when</span><b>${escapeHtml(confirm)}</b></div>
          <div><span>Invalidates when</span><b>${escapeHtml(invalidate)}</b></div>
        </div>
      </div>
      <aside class="flow-decision-side">
        <div class="flow-decision-source">
          <span>${escapeHtml(freshness.detail)}</span>
          <small>Daily closes define the streak; intraday direction must be confirmed elsewhere.</small>
        </div>
        <div class="flow-decision-metrics">
          <div><span>Top focus</span><b>${escapeHtml(top.symbol)}</b><small>${escapeHtml(state === "snapped" ? `fresh ${reversal} watch` : state)}</small></div>
          <div><span>Run</span><b>${runDays}d ${escapeHtml(runColor)}</b><small>${escapeHtml(fmtPct(runCum))} cumulative</small></div>
          <div><span>Daily anchor</span><b>${escapeHtml(anchor)}</b><small>next close must hold ${escapeHtml(confirmSide)}</small></div>
          <div><span>Run quality</span><b>${escapeHtml(quality)}</b><small>${escapeHtml(qualitySub)}</small></div>
        </div>
        <p class="flow-decision-context"><b>Desk breadth:</b> ${breadth.bull || 0} bullish · ${breadth.bear || 0} bearish · ${breadth.continuation || 0} continuation quality · ${breadth.fragile || 0} fragile · ${breadth.snapped || 0} freshly snapped.</p>
        <div class="flow-decision-actions">
          ${freshness.current ? `<button type="button" class="flow-decision-action is-primary" data-streak-focus="${escapeHtml(top.symbol)}">${state === "snapped" ? "Review" : "Focus"} ${escapeHtml(top.symbol)}${state === "snapped" ? " snap" : ""}</button>` : ""}
          <button type="button" class="flow-decision-action" data-streak-sort="tol">Sort fragile runs</button>
          <button type="button" class="flow-decision-action${freshness.current ? "" : " is-primary"}" data-grade="${escapeHtml(top.symbol)}">Open Grade</button>
          ${filterActive ? '<button type="button" class="flow-decision-action" data-streak-reset>Reset filters</button>' : ""}
        </div>
      </aside>
    </section>`;
}

function render(root, footer, eyebrow, { builtAtIso, tickers }) {
  if (!Array.isArray(tickers) || !tickers.length) {
    root.innerHTML = `<p class="streaks-empty">No streak data available.</p>`;
    return;
  }
  const sectors = (window.STONKS_MANIFEST && window.STONKS_MANIFEST.sectors) || {};
  populateSectorFilter(tickers, sectors);

  // The unfiltered flagged universe drives the summary (the day's shape), so
  // the headline counts stay meaningful even when a filter narrows the columns.
  const flagged = tickers.filter((t) => streakSignalDays(t) >= 2);
  const allGreens = flagged.filter((t) => t.current.color === "green");
  const allReds = flagged.filter((t) => t.current.color === "red");

  // Active filters: ticker search, minimum run length, sector.
  const q = streaksState.query;
  const minRun = streaksState.minStreak || 2;
  const sectorPick = streaksState.sector;
  const matchesIdentity = (t) => {
    const sym = String(t.symbol || "").toUpperCase();
    if (q && !sym.includes(q)) return false;
    if (sectorPick && sectorGroupFor(sectors, sym) !== sectorPick) return false;
    return true;
  };
  const filterActive = !!q || minRun > 2 || !!sectorPick;

  const sorter = makeSorter(streaksState.sort);
  const views = V();
  const flip = (arr, runFor = (t) => t.current) => {
    const missing = (t) => streaksState.sort === "vol" ? !(Number(runFor(t)?.volumeRatio) > 0)
      : streaksState.sort === "grade" ? streakGrade(t) == null
      : streaksState.sort === "tol" ? runFor(t)?.tolerancePct == null : false;
    return views ? views.applyDir(arr, "streaks", missing) : arr;
  };
  const passes = (t) => streakSignalDays(t) >= minRun && matchesIdentity(t);
  const greens = flip(allGreens.filter(passes).sort(sorter));
  const reds = flip(allReds.filter(passes).sort(sorter));
  const allSnapped = tickers.filter((t) => hasRecentSnap(t));
  const snapped = flip(allSnapped.filter((t) => hasRecentSnap(t, minRun) && matchesIdentity(t))
    .sort(makeSorter(streaksState.sort, (t) => t.lastEnded)), (t) => t.lastEnded);
  const asTable = !!(views && views.viewMode("streaks") === "table");
  const decisionUniverse = tickers.filter((t) => streakSignalDays(t) >= 2 || hasRecentSnap(t));
  const decisionTickers = decisionUniverse
    .filter((t) => matchesIdentity(t) && (streakSignalDays(t) >= minRun || hasRecentSnap(t, minRun)))
    .map((t) => hasRecentSnap(t, minRun) ? t : { ...t, lastEnded: null });
  const fullDecisionStats = streakDecisionStats(decisionUniverse);
  const decision = renderStreakDecision(decisionTickers, builtAtIso, {
    bull: allGreens.length,
    bear: allReds.length,
    continuation: fullDecisionStats.continuation,
    fragile: fullDecisionStats.fragile,
    snapped: fullDecisionStats.snapped,
  }, filterActive);

  if (eyebrow) {
    eyebrow.textContent = `${allGreens.length} bullish · ${allReds.length} bearish · ${allSnapped.length} snapped`;
  }

  // Section summary — shows the shape of today's streaks at a glance:
  // longest active runs on each side, a length-mix distribution, and the
  // average cumulative move. Always computed off the UNFILTERED universe so
  // the summary stays meaningful when a filter narrows the columns.
  const byLongest = makeSorter("streak");
  const longestGreen = allGreens.length ? allGreens.slice().sort(byLongest)[0] : null;
  const longestRed = allReds.length ? allReds.slice().sort(byLongest)[0] : null;
  const avg = (arr) => arr.length
    ? (arr.reduce((s, t) => s + Math.abs(Number(t.current && t.current.cumulativePct) || 0), 0) / arr.length)
    : 0;
  const summary = `
    <div class="streaks-summary">
      <div class="streaks-summary-chip">
        <span class="streaks-summary-num">${allGreens.length + allReds.length}</span>
        <span class="streaks-summary-lbl">on a run</span>
      </div>
      <div class="streaks-summary-chip streaks-summary-bull">
        <span class="streaks-summary-num">${allGreens.length}</span>
        <span class="streaks-summary-lbl">bullish</span>
      </div>
      <div class="streaks-summary-chip streaks-summary-bear">
        <span class="streaks-summary-num">${allReds.length}</span>
        <span class="streaks-summary-lbl">bearish</span>
      </div>
      ${longestGreen ? `
        <div class="streaks-summary-chip streaks-summary-best streaks-summary-bull">
          <span class="streaks-summary-num">${streakSignalDays(longestGreen)}d</span>
          <span class="streaks-summary-lbl">longest green · ${escapeHtml(String(longestGreen.symbol).toUpperCase())}</span>
        </div>` : ""}
      ${longestRed ? `
        <div class="streaks-summary-chip streaks-summary-best streaks-summary-bear">
          <span class="streaks-summary-num">${streakSignalDays(longestRed)}d</span>
          <span class="streaks-summary-lbl">longest red · ${escapeHtml(String(longestRed.symbol).toUpperCase())}</span>
        </div>` : ""}
      <div class="streaks-summary-chip">
        <span class="streaks-summary-num">${avg(allGreens).toFixed(1)}%</span>
        <span class="streaks-summary-lbl">avg bull cum</span>
      </div>
      <div class="streaks-summary-chip">
        <span class="streaks-summary-num">−${avg(allReds).toFixed(1)}%</span>
        <span class="streaks-summary-lbl">avg bear cum</span>
      </div>
    </div>
    ${distribution(flagged)}`;

  // Column headers carry an inline count, and reflect the active filter
  // ("3 of 24") so the user knows a narrowed list isn't the whole picture.
  const countLabel = (shown, total) =>
    filterActive ? `${shown} of ${total}` : `${total}`;
  const emptyCol = (side) => filterActive
    ? `<p class="streaks-empty">No ${side} streaks match this filter.</p>`
    : `<p class="streaks-empty">No active ${side} streaks today.</p>`;

  root.innerHTML = `
    ${decision}
    ${summary}
    <div class="streaks-board${streaksState.snappedCollapsed ? " is-snapped-collapsed" : ""}">
    <div class="streaks-active">
    ${asTable ? streakTableHtml(flip(greens.concat(reds).sort(sorter)), sectors, views) : `<div class="streaks-cols">
      <div class="streaks-col">
        <h3 class="streaks-col-title streaks-col-bull">
          Bullish streaks <span class="streaks-col-count">${countLabel(greens.length, allGreens.length)}</span>
        </h3>
        ${greens.length
          ? greens.map((t) => entry(t, sectors)).join("")
          : emptyCol("green")}
      </div>
      <div class="streaks-col">
        <h3 class="streaks-col-title streaks-col-bear">
          Bearish streaks <span class="streaks-col-count">${countLabel(reds.length, allReds.length)}</span>
        </h3>
        ${reds.length
          ? reds.map((t) => entry(t, sectors)).join("")
          : emptyCol("red")}
      </div>
    </div>`}
    </div>
    ${snappedPanelHtml(snapped, allSnapped.length, sectors, filterActive)}
    </div>`;

  const panel = $("streaks-snapped");
  panel.addEventListener("toggle", () => {
    if (!panel.isConnected) return;
    streaksState.snappedCollapsed = !panel.open;
    panel.closest(".streaks-board").classList.toggle("is-snapped-collapsed", !panel.open);
    if (views) views.set("streaks.snappedCollapsed", !panel.open);
  });

  if (footer && builtAtIso) {
    const d = new Date(builtAtIso);
    if (!isNaN(d.getTime())) {
      footer.textContent = `Updated ${d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET`;
    }
  }

  root.querySelectorAll("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToGrade(btn.dataset.grade));
  });
  root.querySelectorAll("[data-streak-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = String(btn.dataset.streakFocus || "").toUpperCase();
      const match = (streaksState.data?.tickers || [])
        .find((t) => String(t?.symbol || "").toUpperCase() === sym);
      if (hasRecentSnap(match, streaksState.minStreak)) {
        const panel = $("streaks-snapped");
        panel.open = true;
        const button = [...panel.querySelectorAll("[data-grade]")]
          .find((el) => el.dataset.grade === sym);
        if (button) {
          button.focus({ preventScroll: true });
          button.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      streaksState.query = sym;
      const input = $("streaks-search");
      if (input) input.value = sym;
      rerender();
      requestAnimationFrame(() => {
        const gradeButtons = root.querySelectorAll(".streaks-active [data-grade]");
        for (const gradeButton of gradeButtons) {
          if (String(gradeButton.dataset.grade || "").toUpperCase() === sym) {
            gradeButton.closest(".streaks-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      });
    });
  });
  root.querySelectorAll("[data-streak-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      streaksState.sort = btn.dataset.streakSort || "streak";
      const select = $("streaks-sort-select");
      if (select) select.value = streaksState.sort;
      rerender();
    });
  });
  root.querySelectorAll("[data-streak-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      streaksState.sort = "streak";
      streaksState.minStreak = 2;
      streaksState.sector = "";
      streaksState.query = "";
      const sortSelect = $("streaks-sort-select");
      const minSelect = $("streaks-min-select");
      const sectorSelect = $("streaks-sector-select");
      const search = $("streaks-search");
      if (sortSelect) sortSelect.value = "streak";
      if (minSelect) minSelect.value = "2";
      if (sectorSelect) sectorSelect.value = "";
      if (search) search.value = "";
      rerender();
    });
  });
}

// Always present, even for an empty filtered view, so collapse and counts
// remain predictable. Native details provides keyboard and screen-reader support.
function snappedPanelHtml(snapped, total, sectors, filterActive) {
  const count = filterActive ? `${snapped.length} of ${total}` : String(total);
  return `<details id="streaks-snapped" class="streaks-snapped"${streaksState.snappedCollapsed ? "" : " open"}>
    <summary class="streaks-snapped-head">
      <span class="streaks-snapped-title">Just snapped</span>
      <span class="streaks-snapped-count">${count}</span>
      <span class="streaks-snapped-toggle" aria-hidden="true"></span>
    </summary>
    <div class="streaks-snapped-body">
      <p class="streaks-snapped-sub">Material runs that broke in the latest 3 sessions. Watch for a bounce after red, or a pullback after green.</p>
      <p class="streaks-snapped-sub">Filters and sort apply here too. Run metrics describe the ended run; close and Grade use the latest data.</p>
      <div class="streaks-snapped-list" role="region" aria-label="Just snapped stocks" tabindex="0">
        ${snapped.length ? snapped.map((t) => snappedEntry(t, sectors)).join("")
          : `<p class="streaks-empty">${filterActive ? "No snapped runs match these filters." : "No material runs snapped in the latest 3 sessions."}</p>`}
      </div>
    </div>
  </details>`;
}

function movingAverageContextHtml(t) {
  const context = t.maContext;
  const levels = context?.levels || [];
  const nearest = levels.find(level => level.period === context.nearestPeriod);
  if (!nearest) return '<p class="streaks-ma-unavailable">MA context unavailable for this snapshot.</p>';
  const side = level => Math.abs(level.distancePct) < 0.005 ? "at" : level.distancePct > 0 ? "above" : "below";
  const read = level => `${Math.abs(level.distancePct).toFixed(1)}% ${side(level)} · ${level.slope || "slope unavailable"}`;
  const events = levels.filter(level => level.event).map(level => `${level.event === "reclaimed" ? "Reclaimed" : "Lost"} ${level.period}D`).join(" · ");
  return `<div class="streaks-ma-context">
    <span class="streaks-ma-label">MA context · completed close${context.asOf ? ` ${escapeHtml(fmtShortDate(context.asOf))}` : ""}</span>
    <div class="streaks-ma-nearest"><b>${nearest.period}D SMA ${fmtMoney(nearest.value)}</b><span>${escapeHtml(read(nearest))}</span></div>
    ${events ? `<p class="streaks-ma-events">${escapeHtml(events)} on the latest close</p>` : ""}
    <details><summary>All moving averages</summary>
      <ul>${levels.map(level => `<li><b>${level.period}D · ${fmtMoney(level.value)}</b><span>${escapeHtml(read(level))}</span></li>`).join("")}</ul>
      <p>Slope compares the average with five sessions earlier. Context is descriptive.</p>
    </details>
  </div>`;
}

function snappedEntry(t, sectors) {
  const sym = String(t.symbol || "?").toUpperCase();
  const e = t.lastEnded;
  const days = Number(e.sameDays ?? e.days);
  const wasGreen = e.color === "green";
  const side = wasGreen ? "green" : "red";
  const sector = sectors[sym] || "";
  const volume = Number(e.volumeRatio);
  return `<article class="streaks-row streaks-row-is-${side} streaks-snap-row" data-snapped-symbol="${escapeHtml(sym)}">
    <div class="streaks-head">
      <span class="streaks-dot is-${side}" aria-hidden="true"></span>
      <span class="streaks-sym">${escapeHtml(sym)}</span>
      <span class="streaks-snap-age">${escapeHtml(fmtSessionsAgo(e.sessionsAgo))}</span>
    </div>
    ${sector ? `<div class="streaks-sector">${escapeHtml(sector)}</div>` : ""}
    <div class="streaks-snap-stats">
      <b class="streaks-${wasGreen ? "pos" : "neg"}">${days}d ${side} · ${fmtPct(e.cumulativePct)}</b>
      <span>${wasGreen ? "Watch pullback" : "Watch bounce"}</span>
    </div>
    <p class="streaks-snap-break">${escapeHtml(e.brokeBy || "Run ended")}${e.reversalPct != null ? ` · break-day move ${fmtPct(e.reversalPct)}` : ""}${e.windowDays > days ? ` · ${e.windowDays}-session run` : ""}</p>
    <div class="streaks-meta">Ended-run volume ${volume > 0 ? `${volume.toFixed(2)}×` : "unavailable"}</div>
    ${movingAverageContextHtml(t)}
    <div class="streaks-foot">
      <span class="streaks-last">last <b>${escapeHtml(fmtMoney(t.lastClose))}</b></span>
      <button type="button" class="streaks-btn" data-grade="${escapeHtml(sym)}">Grade ${escapeHtml(sym)} →</button>
    </div>
  </article>`;
}

// Length-mix distribution — a compact stacked bar (2d / 3d / 4d / 5d+) so the
// reader can see whether the day's runs are mostly young or stretched, in one
// glance, off the unfiltered flagged set.
function distribution(flagged) {
  if (!flagged.length) return "";
  const buckets = [
    { key: "2", lbl: "2d", n: 0 },
    { key: "3", lbl: "3d", n: 0 },
    { key: "4", lbl: "4d", n: 0 },
    { key: "5", lbl: "5d+", n: 0 },
  ];
  for (const t of flagged) {
    const d = streakSignalDays(t);
    if (d >= 5) buckets[3].n++;
    else if (d === 4) buckets[2].n++;
    else if (d === 3) buckets[1].n++;
    else if (d === 2) buckets[0].n++;
  }
  const total = flagged.length;
  const segs = buckets.map((b, i) => {
    const pct = total ? (b.n / total) * 100 : 0;
    return `<span class="streaks-dist-seg streaks-dist-${b.key}" style="--w:${pct.toFixed(1)}%" title="${b.lbl}: ${b.n}"></span>`;
  }).join("");
  const legend = buckets.map((b) =>
    `<span class="streaks-dist-key"><span class="streaks-dist-dot streaks-dist-${b.key}"></span>${b.lbl} <b>${b.n}</b></span>`
  ).join("");
  return `
    <div class="streaks-dist" role="img" aria-label="Run-length mix: ${buckets.map((b) => `${b.n} at ${b.lbl}`).join(", ")}">
      <span class="streaks-dist-label">length mix</span>
      <span class="streaks-dist-bar">${segs}</span>
      <span class="streaks-dist-legend">${legend}</span>
    </div>`;
}

// Table layout: bullish and bearish runs in one list, every column sortable.
function streakTableHtml(list, sectors, views) {
  const pct = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return "";
    return `<span class="${n >= 0 ? "pos" : "neg"}">${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%</span>`;
  };
  const cols = [
    { label: "Ticker", cell: (t) => `<button type="button" class="vt-link" data-grade="${escapeHtml(String(t.symbol || "").toUpperCase())}">${escapeHtml(String(t.symbol || "").toUpperCase())}</button>`, sort: (t) => String(t.symbol || "") || null },
    { label: "Direction", cell: (t) => t.current.color === "green" ? '<span class="vt-tag call">Up</span>' : '<span class="vt-tag put">Down</span>', sort: (t) => t.current.color === "green" ? "up" : "down" },
    { label: "Days", num: true, cell: (t) => String(streakSignalDays(t)), sort: (t) => streakSignalDays(t) },
    { label: "Cumulative", num: true, cell: (t) => pct(t.current.cumulativePct), sort: (t) => { const n = Number(t.current.cumulativePct); return isFinite(n) ? n : null; } },
    { label: "Nearest MA", cell: (t) => { const m = t.maContext?.levels?.find(x => x.period === t.maContext.nearestPeriod); return m ? `${m.period}D · ${fmtPct(m.distancePct)} · ${escapeHtml(m.slope || "slope unavailable")}` : "Unavailable"; } },
    { label: "Last close", num: true, cell: (t) => isFinite(Number(t.lastClose)) ? fmtMoney(Number(t.lastClose)) : "", sort: (t) => { const n = Number(t.lastClose); return isFinite(n) ? n : null; } },
    { label: "Volume trend", num: true, title: "Volume during the run vs normal", cell: (t) => isFinite(Number(t.current.volumeRatio)) && Number(t.current.volumeRatio) > 0 ? Number(t.current.volumeRatio).toFixed(2) + "×" : "", sort: (t) => { const n = Number(t.current.volumeRatio); return isFinite(n) && n > 0 ? n : null; } },
    { label: "Break risk", num: true, title: "Share of the counter-move tolerance already used", cell: (t) => { const tb = Number(t.current.toleranceBreakPct || 1.5); const n = tb > 0 ? Number(t.current.tolerancePct || 0) / tb * 100 : null; return n == null ? "" : Math.round(n) + "%"; }, sort: (t) => { const tb = Number(t.current.toleranceBreakPct || 1.5); return tb > 0 ? Number(t.current.tolerancePct || 0) / tb : null; } },
    { label: "Sector", cell: (t) => escapeHtml(sectors[String(t.symbol || "").toUpperCase()] || ""), sort: (t) => sectors[String(t.symbol || "").toUpperCase()] || null },
    { label: "Grade", num: true, cell: (t) => { const g = streakGrade(t); return g == null ? "" : (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g).toFixed(1); }, sort: streakGrade },
  ];
  return views.tableHtml(cols, list, { key: "streaks-table", empty: "No streaks match this filter." });
}

function entry(t, sectors) {
  const sym = String(t.symbol || "?").toUpperCase();
  const sector = sectors[sym] || "";
  const isGreen = t.current.color === "green";
  const signalDays = streakSignalDays(t);
  const windowDays = streakWindowDays(t);
  // Oldest -> newest reads the way humans say streaks ("+1%, +3%, +5%").
  const moves = (t.history || []).slice(0, windowDays).reverse();
  const cumCls = isGreen ? "streaks-pos" : "streaks-neg";
  const sideCls = isGreen ? "is-green" : t.current.color === "red" ? "is-red" : "is-flat";
  // Sparkline — each day in the streak becomes a vertical bar with height
  // proportional to the magnitude of its move and colored by direction.
  // Replaces the comma-separated "+1.0%, +2.0%, ..." text with a single
  // visual the eye can read at a glance: how long the run is, whether it
  // accelerated or faded, and whether counter-days punctuate the run.
  const maxAbs = moves.reduce((m, x) => Math.max(m, Math.abs(Number(x.changePct) || 0)), 0.5);
  const dayReads = [];
  const spark = moves.map((m) => {
    const v = Number(m.changePct) || 0;
    const h = Math.max(8, (Math.abs(v) / maxAbs) * 100);
    const cls = v > 0 ? "is-pos" : v < 0 ? "is-neg" : "is-flat";
    const close = Number(m.close);
    const prevClose = isFinite(close) && (1 + v / 100) !== 0 ? close / (1 + v / 100) : null;
    const dollarChg = isFinite(close) && prevClose != null ? close - prevClose : null;
    const dateLabel = m.date ? fmtShortDate(m.date) : "";
    const closeLabel = isFinite(close) ? fmtMoney(close) : "—";
    const dollarLabel = dollarChg != null
      ? (dollarChg >= 0 ? "+" : "−") + "$" + Math.abs(dollarChg).toFixed(2)
      : null;
    const tip = `${dateLabel} · close ${closeLabel}${dollarLabel ? " · " + dollarLabel : ""} · ${fmtPct(v, 2)}`;
    dayReads.push(tip);
    // Bars are decorative; the parent .streaks-spark is the labeled role="img"
    // (so assistive tech reads one coherent summary, not N redundant labels —
    // an aria-hidden parent would have masked per-bar aria-labels anyway).
    return `<span class="streaks-spark-bar ${cls}" style="--h:${h.toFixed(0)}%" data-tip="${escapeHtml(tip)}"></span>`;
  }).join("");
  // One coherent label for the whole sparkline (fixes the prior aria-hidden +
  // per-bar-aria-label conflict, and gives touch/AT users the full per-day read
  // the hover tooltips can't).
  const windowRead = windowDays > signalDays
    ? `${signalDays} same-direction days across a ${windowDays}-session run`
    : `${signalDays}-day run`;
  const sparkLabel = `${sym} ${windowRead}, ${t.current.color}, ${fmtPct(t.current.cumulativePct)} compounded. Daily moves oldest to newest: ${dayReads.join("; ")}`;

  // Start date of the run (oldest day in the streak window) for temporal grounding.
  const startDate = moves.length && moves[0].date ? fmtShortDate(moves[0].date) : "";

  // Rarity: recordMax includes the current run, so days === max means this is
  // the longest run of its color in the ~3-month window. Badge it when notable.
  const ctx = t.context || {};
  const maxForColor = isGreen ? Number(ctx.maxGreenDays || 0) : Number(ctx.maxRedDays || 0);
  const isRecord = maxForColor > 0 && signalDays >= maxForColor && signalDays >= 4;
  const rarityBadge = isRecord
    ? `<span class="streaks-badge streaks-badge-record" title="Longest ${t.current.color} run in the ~3-month window">★ longest in 3mo</span>`
    : (maxForColor > signalDays
        ? `<span class="streaks-badge streaks-badge-ctx" title="Longest ${t.current.color} run seen in the ~3-month window">3mo high ${maxForColor}d</span>`
        : "");

  // Volume trend — average run volume vs the ~20 sessions before it began.
  // Rising volume = conviction (colored to the side); falling = fading (warn).
  const vTrend = t.current.volumeTrend;
  const vRatio = Number(t.current.volumeRatio);
  let volChip = "";
  if (vTrend && isFinite(vRatio)) {
    const arrow = vTrend === "rising" ? "↑" : vTrend === "falling" ? "↓" : "→";
    const cls = vTrend === "rising" ? "is-rising" : vTrend === "falling" ? "is-falling" : "is-flat";
    volChip = `<span class="streaks-vol ${cls}" title="Avg volume during the run vs the 20 sessions before it: ${vRatio.toFixed(2)}× (${vTrend})">${arrow} vol ${vRatio.toFixed(2)}×</span>`;
  }

  // Tolerance: how much the run has eaten into its counter-day "bank". Only
  // shown when actually in use (tol > 0 or one or more consecutive counter
  // days). Clean streaks just hide it — the absence is its own signal.
  const tol = Number(t.current.tolerancePct || 0);
  const counterDays = Number(t.current.consecutiveCounterDays ?? t.current.counterDays ?? 0);
  const tolBreak = Number(t.current.toleranceBreakPct || 1.5);
  const counterBreak = Number(t.current.counterDaysBreak || 4);
  const isCounted = tol > 0 || counterDays > 0;
  // The bank-used pct is what tells the user how close the streak is to
  // tripping; render that as a tiny meter on top of the readable label.
  const bankPct = tolBreak > 0 ? Math.min(100, (tol / tolBreak) * 100) : 0;
  const counterPct = counterBreak > 0 ? Math.min(100, (counterDays / counterBreak) * 100) : 0;
  // "At risk" = the run has burned most of either tripwire's headroom, so the
  // card gets a fragile flag and the eye catches it without reading the meter.
  const atRisk = isCounted && Math.max(bankPct, counterPct) >= 66;
  const tolMeter = isCounted ? `
    <div class="streaks-tol-meter${atRisk ? " is-at-risk" : ""}" title="Counter-day tolerance bank: ${tol.toFixed(2)}% used of ${tolBreak.toFixed(1)}% · ${counterDays} of ${counterBreak} counter days">
      <span class="streaks-tol-label">${atRisk ? "fragile" : "tol used"}</span>
      <span class="streaks-tol-bar"><span class="streaks-tol-fill" style="--w:${bankPct.toFixed(0)}%"></span></span>
      <span class="streaks-tol-val">${tol.toFixed(2)}% / ${tolBreak.toFixed(1)}%</span>
      <span class="streaks-tol-counter-pill">${counterDays}/${counterBreak}d</span>
    </div>` : "";

  return `
    <article class="streaks-row streaks-row-${sideCls}${atRisk ? " is-at-risk" : ""}">
      <div class="streaks-head">
        <span class="streaks-dot ${sideCls}" aria-hidden="true"></span>
        <span class="streaks-sym">${escapeHtml(sym)}</span>
        ${sector ? `<span class="streaks-sector">${escapeHtml(sector)}</span>` : ""}
        ${rarityBadge}
        <span class="streaks-stat-block">
          <span class="streaks-stat-num ${cumCls}">${fmtPct(t.current.cumulativePct)}</span>
          <span class="streaks-stat-lbl">cum</span>
        </span>
        <span class="streaks-stat-block">
          <span class="streaks-stat-num">${signalDays}<span class="streaks-stat-unit">d</span></span>
          <span class="streaks-stat-lbl">${windowDays > signalDays ? `green/red in ${windowDays}` : "streak"}</span>
        </span>
      </div>
      <div class="streaks-spark" role="img" aria-label="${escapeHtml(sparkLabel)}">${spark}</div>
      ${tolMeter}
      ${movingAverageContextHtml(t)}
      <div class="streaks-meta">
        ${startDate ? `<span class="streaks-since" title="First session of the current run">since ${escapeHtml(startDate)}</span>` : ""}
        ${volChip}
      </div>
      <div class="streaks-foot">
        <span class="streaks-last">last <b>${escapeHtml(fmtMoney(t.lastClose))}</b></span>
        <button type="button" class="streaks-btn" data-grade="${escapeHtml(sym)}">Grade ${escapeHtml(sym)} →</button>
      </div>
    </article>`;
}

// Deep-link into the Grade tab the same way the existing ?s=SYM URL state
// does (app.js parseUrlState/initial path). A full navigation is simpler
// than calling the IIFE-scoped combo.commit() from this module and the
// existing auto-load handler picks the symbol up on the next page render.
// ?tab= must be forced to grade: the Streaks tab mirrors itself into the
// URL (?tab=streaks) and app.js gives ?tab= priority over ?s= when it
// resolves the initial tab, so a stale tab param would land the reload
// right back on Streaks. (localStorage no longer drives tab restore.)
function jumpToGrade(symbol) {
  if (!symbol) return;
  const url = new URL(window.location.href);
  url.searchParams.set("s", symbol);
  url.searchParams.set("tab", "grade");
  url.searchParams.delete("exp");
  url.searchParams.delete("k");
  url.searchParams.delete("t");
  window.location.assign(url.toString());
}

// Lazy-load: streaks.json is ~60KB and most visits never open this tab.
// app.js page-tab activation calls window.stonksLoadStreaks() on first
// open. We also load on DOMContentLoaded if the saved tab is "streaks"
// so a return visit lands on populated data instead of "Loading…".
let streaksLoaded = false;
function loadStreaksOnce() {
  if (streaksLoaded) return;
  streaksLoaded = true;
  loadStreaks();
}
window.stonksLoadStreaks = loadStreaksOnce;

function bootstrap() {
  let saved = null;
  try { saved = localStorage.getItem("stonks-page-tab"); } catch (_) {}
  if (saved === "streaks") loadStreaksOnce();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
