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

async function loadStreaks() {
  const root = $("streaks-root");
  const footer = $("streaks-footer");
  const eyebrow = $("streaks-eyebrow");
  if (!root) return;
  root.innerHTML = streaksSkeleton();
  try {
    const r = await fetch(dataUrl(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    render(root, footer, eyebrow, json);
  } catch (err) {
    root.innerHTML = `<p class="streaks-empty">Couldn't load streaks (${escapeHtml(err.message || err)}).</p>`;
  }
}

function sortKey(a, b) {
  if (b.current.days !== a.current.days) return b.current.days - a.current.days;
  return Math.abs(b.current.cumulativePct) - Math.abs(a.current.cumulativePct);
}

function render(root, footer, eyebrow, { builtAtIso, tickers }) {
  if (!Array.isArray(tickers) || !tickers.length) {
    root.innerHTML = `<p class="streaks-empty">No streak data available.</p>`;
    return;
  }
  const sectors = (window.STONKS_MANIFEST && window.STONKS_MANIFEST.sectors) || {};
  const flagged = tickers.filter((t) => t?.current?.days >= 2);
  const greens = flagged.filter((t) => t.current.color === "green").sort(sortKey);
  const reds = flagged.filter((t) => t.current.color === "red").sort(sortKey);

  if (eyebrow) {
    eyebrow.textContent = `${greens.length} bullish · ${reds.length} bearish`;
  }

  // Section summary — shows the shape of today's streaks at a glance:
  // the longest active runs on each side and the average cumulative move
  // for streaks that made the cut, so the user can read the day's
  // character before scrolling through ~80 cards.
  const longestGreen = greens.length ? greens[0] : null;
  const longestRed = reds.length ? reds[0] : null;
  const avg = (arr) => arr.length
    ? (arr.reduce((s, t) => s + Math.abs(t.current.cumulativePct), 0) / arr.length)
    : 0;
  const summary = `
    <div class="streaks-summary">
      <div class="streaks-summary-chip">
        <span class="streaks-summary-num">${greens.length + reds.length}</span>
        <span class="streaks-summary-lbl">on a run</span>
      </div>
      <div class="streaks-summary-chip streaks-summary-bull">
        <span class="streaks-summary-num">${greens.length}</span>
        <span class="streaks-summary-lbl">bullish</span>
      </div>
      <div class="streaks-summary-chip streaks-summary-bear">
        <span class="streaks-summary-num">${reds.length}</span>
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
        <span class="streaks-summary-num">${avg(greens).toFixed(1)}%</span>
        <span class="streaks-summary-lbl">avg bull cum</span>
      </div>
      <div class="streaks-summary-chip">
        <span class="streaks-summary-num">−${avg(reds).toFixed(1)}%</span>
        <span class="streaks-summary-lbl">avg bear cum</span>
      </div>
    </div>`;

  root.innerHTML = `
    ${summary}
    <div class="streaks-cols">
      <div class="streaks-col">
        <h3 class="streaks-col-title streaks-col-bull">Bullish streaks (≥2 green days)</h3>
        ${greens.length
          ? greens.map((t) => entry(t, sectors)).join("")
          : `<p class="streaks-empty">No active green streaks today.</p>`}
      </div>
      <div class="streaks-col">
        <h3 class="streaks-col-title streaks-col-bear">Bearish streaks (≥2 red days)</h3>
        ${reds.length
          ? reds.map((t) => entry(t, sectors)).join("")
          : `<p class="streaks-empty">No active red streaks today.</p>`}
      </div>
    </div>`;

  if (footer && builtAtIso) {
    const d = new Date(builtAtIso);
    if (!isNaN(d.getTime())) {
      footer.textContent = `Updated ${d.toLocaleString()}`;
    }
  }

  root.querySelectorAll("[data-grade]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToGrade(btn.dataset.grade));
  });
}

function entry(t, sectors) {
  const sym = String(t.symbol || "?").toUpperCase();
  const sector = sectors[sym] || "";
  // Oldest -> newest reads the way humans say streaks ("+1%, +3%, +5%").
  const moves = (t.history || []).slice(0, t.current.days).reverse();
  const cumCls = t.current.color === "green" ? "streaks-pos" : "streaks-neg";
  const sideCls = t.current.color === "green" ? "is-green" : t.current.color === "red" ? "is-red" : "is-flat";
  // Sparkline — each day in the streak becomes a vertical bar with height
  // proportional to the magnitude of its move and colored by direction.
  // Replaces the comma-separated "+1.0%, +2.0%, ..." text with a single
  // visual the eye can read at a glance: how long the run is, whether it
  // accelerated or faded, and whether counter-days punctuate the run.
  const maxAbs = moves.reduce((m, x) => Math.max(m, Math.abs(Number(x.changePct) || 0)), 0.5);
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
    return `<span class="streaks-spark-bar ${cls}" style="--h:${h.toFixed(0)}%" data-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"></span>`;
  }).join("");
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
  const tolMeter = isCounted ? `
    <div class="streaks-tol-meter" title="Counter-day tolerance bank: ${tol.toFixed(2)}% used of ${tolBreak.toFixed(1)}% · ${counterDays} of ${counterBreak} counter days">
      <span class="streaks-tol-label">tol used</span>
      <span class="streaks-tol-bar"><span class="streaks-tol-fill" style="--w:${bankPct.toFixed(0)}%"></span></span>
      <span class="streaks-tol-val">${tol.toFixed(2)}% / ${tolBreak.toFixed(1)}%</span>
      <span class="streaks-tol-counter-pill">${counterDays}/${counterBreak}d</span>
    </div>` : "";

  return `
    <article class="streaks-row streaks-row-${sideCls}">
      <div class="streaks-head">
        <span class="streaks-dot ${sideCls}" aria-hidden="true"></span>
        <span class="streaks-sym">${escapeHtml(sym)}</span>
        ${sector ? `<span class="streaks-sector">${escapeHtml(sector)}</span>` : ""}
        <span class="streaks-stat-block">
          <span class="streaks-stat-num ${cumCls}">${fmtPct(t.current.cumulativePct)}</span>
          <span class="streaks-stat-lbl">cum</span>
        </span>
        <span class="streaks-stat-block">
          <span class="streaks-stat-num">${t.current.days}<span class="streaks-stat-unit">d</span></span>
          <span class="streaks-stat-lbl">streak</span>
        </span>
      </div>
      <div class="streaks-spark" aria-hidden="true" title="Daily closes that make up the streak (oldest → newest)">${spark}</div>
      ${tolMeter}
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
function jumpToGrade(symbol) {
  if (!symbol) return;
  const url = new URL(window.location.href);
  url.searchParams.set("s", symbol);
  url.searchParams.delete("exp");
  url.searchParams.delete("k");
  url.searchParams.delete("t");
  try { localStorage.setItem("stonks-page-tab", "grade"); } catch (_) {}
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
