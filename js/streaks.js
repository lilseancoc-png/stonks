// Streaks tab: renders data/streaks.json -- per-ticker daily green/red
// streak runs computed at build time from Yahoo daily closes. Two columns,
// "Bullish streaks (>=2 green days)" and "Bearish streaks (>=2 red days)",
// sorted by streak length and cumulative move.

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
  sel.value = streaksState.sort;
  sel.addEventListener("change", () => {
    streaksState.sort = sel.value || "streak";
    rerender();
  });

  const minSel = $("streaks-min-select");
  if (minSel) {
    minSel.value = String(streaksState.minStreak);
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

// Fill the sector <select> once from whatever sectors are present in the data
// (intersected with the manifest's sector map), preserving the current pick.
function populateSectorFilter(tickers, sectors) {
  const sel = $("streaks-sector-select");
  if (!sel || sel.dataset.filled) return;
  const present = new Set();
  for (const t of tickers) {
    const s = sectors[String(t.symbol || "").toUpperCase()];
    if (s) present.add(s);
  }
  if (!present.size) return;
  const opts = ['<option value="">All sectors</option>']
    .concat([...present].sort().map((s) =>
      `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`));
  sel.innerHTML = opts.join("");
  sel.value = streaksState.sector;
  sel.dataset.filled = "1";
}

function fmtSessionsAgo(n) {
  if (n == null || !isFinite(n)) return "";
  if (n <= 0) return "today";
  if (n === 1) return "1 session ago";
  return `${n} sessions ago`;
}

function makeSorter(mode) {
  // Each column is filtered to one direction first, so secondary tiebreakers
  // can stay direction-agnostic (we just compare magnitudes).
  if (mode === "alpha") {
    return (a, b) => String(a.symbol || "").localeCompare(String(b.symbol || ""));
  }
  if (mode === "cum") {
    return (a, b) => Math.abs(b.current.cumulativePct || 0) - Math.abs(a.current.cumulativePct || 0)
      || (b.current.days || 0) - (a.current.days || 0);
  }
  if (mode === "last") {
    return (a, b) => (Number(b.lastClose) || 0) - (Number(a.lastClose) || 0);
  }
  if (mode === "vol") {
    // Strongest volume conviction first; names with no volume read sink.
    const vr = (t) => Number(t.current.volumeRatio) || 0;
    return (a, b) => vr(b) - vr(a)
      || (b.current.days || 0) - (a.current.days || 0);
  }
  if (mode === "tol") {
    // "Tolerance bank used" — bigger value = streak closer to breaking.
    const bank = (t) => {
      const tol = Number(t.current.tolerancePct || 0);
      const tolBreak = Number(t.current.toleranceBreakPct || 1.5);
      return tolBreak > 0 ? tol / tolBreak : 0;
    };
    return (a, b) => bank(b) - bank(a)
      || (b.current.counterDays || 0) - (a.current.counterDays || 0)
      || (b.current.days || 0) - (a.current.days || 0);
  }
  // Default: streak length, then cumulative magnitude.
  return (a, b) => (b.current.days || 0) - (a.current.days || 0)
    || Math.abs(b.current.cumulativePct || 0) - Math.abs(a.current.cumulativePct || 0);
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
  const flagged = tickers.filter((t) => t?.current?.days >= 2);
  const allGreens = flagged.filter((t) => t.current.color === "green");
  const allReds = flagged.filter((t) => t.current.color === "red");

  // Active filters: ticker search, minimum run length, sector.
  const q = streaksState.query;
  const minRun = streaksState.minStreak || 2;
  const sectorPick = streaksState.sector;
  const passes = (t) => {
    if (t.current.days < minRun) return false;
    const sym = String(t.symbol || "").toUpperCase();
    if (q && !sym.includes(q)) return false;
    if (sectorPick && (sectors[sym] || "") !== sectorPick) return false;
    return true;
  };
  const filterActive = !!q || minRun > 2 || !!sectorPick;

  const sorter = makeSorter(streaksState.sort);
  const greens = allGreens.filter(passes).sort(sorter);
  const reds = allReds.filter(passes).sort(sorter);

  if (eyebrow) {
    eyebrow.textContent = `${allGreens.length} bullish · ${allReds.length} bearish`;
  }

  // "Just snapped" — genuine streaks that broke within the last couple of
  // sessions (data.lastEnded). Surfaced as a mean-reversion watchlist above
  // the active columns. Independent of the active-streak filters.
  renderSnapped($("streaks-snapped"), tickers, sectors);

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
          <span class="streaks-summary-num">${longestGreen.current.days}d</span>
          <span class="streaks-summary-lbl">longest green · ${escapeHtml(String(longestGreen.symbol).toUpperCase())}</span>
        </div>` : ""}
      ${longestRed ? `
        <div class="streaks-summary-chip streaks-summary-best streaks-summary-bear">
          <span class="streaks-summary-num">${longestRed.current.days}d</span>
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
    ${summary}
    <div class="streaks-cols">
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
    </div>`;

  if (footer && builtAtIso) {
    const d = new Date(builtAtIso);
    if (!isNaN(d.getTime())) {
      footer.textContent = `Updated ${d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET`;
    }
  }

  root.querySelectorAll("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToGrade(btn.dataset.grade));
  });
}

// "Just snapped" strip — names whose genuine streak broke in the last couple
// of sessions (computeStreakForTicker stamps data.lastEnded only when recent).
// A snapped run is the classic mean-reversion setup, so it gets its own row
// above the active columns rather than being lost when the run ends.
function renderSnapped(host, tickers, sectors) {
  if (!host) return;
  const snapped = tickers
    .filter((t) => t && t.lastEnded && t.lastEnded.days >= 2)
    .sort((a, b) =>
      (a.lastEnded.sessionsAgo - b.lastEnded.sessionsAgo)
      || (Math.abs(b.lastEnded.cumulativePct) - Math.abs(a.lastEnded.cumulativePct)));
  if (!snapped.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  const chips = snapped.map((t) => {
    const sym = String(t.symbol || "?").toUpperCase();
    const e = t.lastEnded;
    const wasGreen = e.color === "green";
    const sideCls = wasGreen ? "is-green" : "is-red";
    const arrow = wasGreen ? "▲" : "▼";
    // After a green run breaks the bias is a pullback; after a red run, a bounce.
    const revert = wasGreen ? "watch pullback" : "watch bounce";
    const cum = (e.cumulativePct >= 0 ? "+" : "−") + Math.abs(e.cumulativePct).toFixed(1) + "%";
    const tip = `${sym}: ${e.days}d ${e.color} run (${cum}) snapped ${fmtSessionsAgo(e.sessionsAgo)} — ${e.brokeBy}`;
    return `
      <button type="button" class="streaks-snap-chip ${sideCls}" data-grade="${escapeHtml(sym)}" title="${escapeHtml(tip)}">
        <span class="streaks-snap-arrow" aria-hidden="true">${arrow}</span>
        <span class="streaks-snap-sym">${escapeHtml(sym)}</span>
        <span class="streaks-snap-run">${e.days}d ${escapeHtml(e.color)} · ${cum}</span>
        <span class="streaks-snap-meta">${escapeHtml(fmtSessionsAgo(e.sessionsAgo))} · ${revert}</span>
      </button>`;
  }).join("");
  host.hidden = false;
  host.innerHTML = `
    <div class="streaks-snapped-head">
      <span class="streaks-snapped-title">Just snapped</span>
      <span class="streaks-snapped-sub">genuine runs that broke in the last ${tickers.some((t)=>t.lastEnded && t.lastEnded.sessionsAgo>1)?"few":"couple of"} sessions — mean-reversion candidates</span>
      <span class="streaks-snapped-count">${snapped.length}</span>
    </div>
    <div class="streaks-snapped-strip">${chips}</div>`;
  host.querySelectorAll("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToGrade(btn.dataset.grade));
  });
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
    const d = t.current.days || 0;
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

function entry(t, sectors) {
  const sym = String(t.symbol || "?").toUpperCase();
  const sector = sectors[sym] || "";
  const isGreen = t.current.color === "green";
  // Oldest -> newest reads the way humans say streaks ("+1%, +3%, +5%").
  const moves = (t.history || []).slice(0, t.current.days).reverse();
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
  const sparkLabel = `${sym} ${t.current.days}-day ${t.current.color} streak, ${fmtPct(t.current.cumulativePct)} cumulative. Daily moves oldest to newest: ${dayReads.join("; ")}`;

  // Start date of the run (oldest day in the streak window) for temporal grounding.
  const startDate = moves.length && moves[0].date ? fmtShortDate(moves[0].date) : "";

  // Rarity: recordMax includes the current run, so days === max means this is
  // the longest run of its color in the ~3-month window. Badge it when notable.
  const ctx = t.context || {};
  const maxForColor = isGreen ? Number(ctx.maxGreenDays || 0) : Number(ctx.maxRedDays || 0);
  const isRecord = maxForColor > 0 && t.current.days >= maxForColor && t.current.days >= 4;
  const rarityBadge = isRecord
    ? `<span class="streaks-badge streaks-badge-record" title="Longest ${t.current.color} run in the ~3-month window">★ longest in 3mo</span>`
    : (maxForColor > t.current.days
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
  const counterDays = Number(t.current.counterDays || 0);
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
          <span class="streaks-stat-num">${t.current.days}<span class="streaks-stat-unit">d</span></span>
          <span class="streaks-stat-lbl">streak</span>
        </span>
      </div>
      <div class="streaks-spark" role="img" aria-label="${escapeHtml(sparkLabel)}">${spark}</div>
      ${tolMeter}
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
