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

  root.innerHTML = `
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
  const movesStr = moves.map((m) => fmtPct(m.changePct, 1)).join(", ");
  const cumCls = t.current.color === "green" ? "streaks-pos" : "streaks-neg";
  // Use a styled circle instead of an emoji — emojis render at different
  // sizes/colors across platforms and end up dominating the row.
  const dotCls = t.current.color === "green" ? "is-green" : t.current.color === "red" ? "is-red" : "is-flat";
  const dot = `<span class="streaks-dot ${dotCls}" aria-hidden="true"></span>`;
  // Tolerance badge: only show when the streak has absorbed at least one
  // counter day. Reads "tol 0.50%/1.5% · 1/4d" -- bank used / break point,
  // consecutive counter days / break point. Helps the reader see how
  // close the streak is to one of the tripwires firing.
  const tol = Number(t.current.tolerancePct || 0);
  const counterDays = Number(t.current.counterDays || 0);
  const tolBreak = Number(t.current.toleranceBreakPct || 1.5);
  const counterBreak = Number(t.current.counterDaysBreak || 4);
  // Always show the badge so the row layout is consistent. When the streak
  // hasn't absorbed any counter days yet we mark it "clean" with a muted
  // variant — same width, but visually quieter so the reader knows nothing
  // is in the bank.
  const isCounted = tol > 0 || counterDays > 0;
  const badgeCls = isCounted ? "streaks-tol streaks-tol-counter" : "streaks-tol streaks-tol-clean";
  const toleranceBadge = `<span class="${badgeCls}" title="Counter-day tolerance used / break point · consecutive counter days / break">tol ${tol.toFixed(2)}% / ${tolBreak.toFixed(1)}% · ${counterDays}/${counterBreak}d</span>`;
  // Streak-length bar: visualises how deep the run is relative to a
  // 10-day "very long streak" reference. Anything longer pegs full.
  const lengthPct = Math.min(100, (Number(t.current.days) || 0) * 10);
  const cumPct = Math.min(100, Math.abs(Number(t.current.cumulativePct) || 0) * 5);
  const cumColor = t.current.color === "green" ? "var(--pos)" : "var(--neg)";
  return `
    <article class="streaks-row">
      <div class="streaks-head">
        ${dot}
        <span class="streaks-sym">${escapeHtml(sym)}</span>
        ${sector ? `<span class="streaks-sector">${escapeHtml(sector)}</span>` : ""}
        <span class="streaks-days">${t.current.days}d</span>
        ${toleranceBadge}
      </div>
      <div class="streaks-bars" aria-hidden="true">
        <span class="streaks-bar streaks-bar-len" style="--w:${lengthPct.toFixed(0)}%" title="Streak length (10d = full)"></span>
        <span class="streaks-bar streaks-bar-cum" style="--w:${cumPct.toFixed(0)}%; --c:${cumColor}" title="Cumulative move magnitude (20% = full)"></span>
      </div>
      <div class="streaks-meta">
        <span class="streaks-cum ${cumCls}">${fmtPct(t.current.cumulativePct)} cum</span>
        <span class="streaks-moves">${escapeHtml(movesStr)}</span>
        <span class="streaks-last">last ${escapeHtml(fmtMoney(t.lastClose))}</span>
      </div>
      <div class="streaks-actions">
        <button type="button" class="streaks-btn" data-grade="${escapeHtml(sym)}">Grade ${escapeHtml(sym)}</button>
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
