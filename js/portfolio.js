// Portfolio tab: signed-in view with owned options + AI review.
// Loaded as <script type="module"> (uses ESM import for auth.js).

import {
  supabase,
  isConfigured,
  getSession,
  signInWithEmail,
  signInWithOAuth,
  signOut,
  onAuthChange,
} from "./auth.js";
import { greeks, yearsToExpiry } from "../lib/greeks.mjs";

// Risk-free rate baked into app.js by the daily build (fetchRiskFreeRate
// pulls the 3M T-bill rate). Mirror it here so the risk dashboard's Greeks
// match what the grader and AI review use. window.STONKS_MANIFEST.riskFreeRate
// could expose it cleanly later; for now the lib/greeks.mjs default (0.045)
// is close enough for delta-equivalents at the portfolio level.
const RISK_FREE_RATE = 0.045;

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]),
  );
}

function fmtMoney(n) {
  if (n == null || !isFinite(n)) return "—";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n, digits = 1) {
  if (n == null || !isFinite(n)) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

function fmtNum(n, d = 2) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toFixed(d);
}

function fmtExpiry(epochSec) {
  if (!epochSec) return "—";
  const d = new Date(epochSec * 1000);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Modal key handling: Escape closes, Tab cycles focus within the dialog so
// keyboard users can't tab out into the (inert, visually-blocked) page
// behind it. Returns an uninstall function the modal's closer must call.
function installModalKeyHandling(host, closeModal) {
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), ' +
    '[tabindex]:not([tabindex="-1"])';
  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab" || !host) return;
    const focusable = host.querySelectorAll(FOCUSABLE_SELECTOR);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

function fmtAge(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  if (days < 365) return Math.floor(days / 30) + "mo ago";
  return Math.floor(days / 365) + "y ago";
}

const state = {
  session: null,
  positions: [],
  review: null,
  reviewing: false,
  chainCache: Object.create(null), // symbol -> { expirations:[{sec,label}], chains:{sec:{c:[],p:[]}} }
  snapshots: [],
  snapshotRange: "1M",
  trades: [],       // closed trade history (SELL records from trades table)
  tradesRange: "ALL",
};

// --- Sign-in panel + auth wiring -----------------------------------------

function renderSignedOut() {
  const pane = $("page-pane-portfolio");
  if (!pane) return;
  if (!isConfigured()) {
    pane.innerHTML = `
      <section class="card">
        <header class="card-header"><h2 class="card-title">Portfolio</h2></header>
        <p class="hint">Sign-in is not configured for this deployment. Set
        <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> env vars,
        then rebuild. See README for setup.</p>
      </section>`;
    return;
  }
  pane.innerHTML = `
    <section class="card pf-signin-card">
      <header class="card-header"><h2 class="card-title">Sign in to track your portfolio</h2></header>
      <p class="hint">Save the options you own, then ask AI to review them — sell vs hold vs roll, P/L, theta bleed, concentration.</p>
      <form id="pf-email-form" class="pf-signin-form">
        <label class="field">
          <span class="field-label">Email</span>
          <input type="email" id="pf-email-input" required autocomplete="email" placeholder="you@example.com">
        </label>
        <button type="submit" class="pf-btn pf-btn-primary" id="pf-email-submit">Send magic link</button>
      </form>
      <div class="pf-signin-divider"><span>or</span></div>
      <div class="pf-signin-providers">
        <button type="button" class="pf-btn" data-provider="github">Continue with GitHub</button>
        <button type="button" class="pf-btn" data-provider="google">Continue with Google</button>
      </div>
      <p id="pf-signin-msg" class="pf-status" role="status" aria-live="polite"></p>
    </section>`;

  $("pf-email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("pf-email-input").value.trim();
    if (!email) return;
    const msg = $("pf-signin-msg");
    const btn = $("pf-email-submit");
    btn.disabled = true;
    msg.textContent = "Sending…";
    msg.className = "pf-status";
    try {
      await signInWithEmail(email);
      msg.textContent = "Check your inbox for a sign-in link.";
      msg.className = "pf-status pf-status-ok";
    } catch (err) {
      msg.textContent = err.message || "Couldn't send the link.";
      msg.className = "pf-status pf-status-err";
    } finally {
      btn.disabled = false;
    }
  });

  pane.querySelectorAll("[data-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await signInWithOAuth(btn.dataset.provider);
      } catch (err) {
        const msg = $("pf-signin-msg");
        msg.textContent = err.message || "Sign-in failed.";
        msg.className = "pf-status pf-status-err";
      }
    });
  });
}

// --- Signed-in shell ------------------------------------------------------

function renderSignedIn() {
  const pane = $("page-pane-portfolio");
  if (!pane) return;
  const email = state.session?.user?.email || "Signed in";
  pane.innerHTML = `
    <section class="card pf-portfolio-card">
      <header class="card-header pf-portfolio-head">
        <div>
          <h2 class="card-title">Your portfolio</h2>
          <p class="hint pf-account">${escapeHtml(email)} · <button type="button" id="pf-signout" class="pf-link">sign out</button></p>
        </div>
        <div class="pf-actions">
          <button type="button" class="pf-btn" id="pf-add-btn">+ Add position</button>
          <button type="button" class="pf-btn pf-btn-primary" id="pf-review-btn">Review portfolio</button>
        </div>
      </header>
      <div id="pf-equity" class="pf-equity" hidden></div>
      <div id="pf-risk" class="pf-risk" hidden></div>
      <div id="pf-list" class="pf-list" role="status" aria-live="polite">Loading…</div>
      <div id="pf-review" class="pf-review" hidden></div>
      <div id="pf-history" class="pf-history" hidden></div>
    </section>
    <div id="pf-modal-host"></div>`;

  $("pf-signout").addEventListener("click", () => signOut());
  $("pf-add-btn").addEventListener("click", openAddModal);
  $("pf-review-btn").addEventListener("click", runReview);

  loadPositions();
  loadSnapshots();
  loadTradeHistory();
}

// --- Positions CRUD -------------------------------------------------------

async function loadPositions() {
  const list = $("pf-list");
  if (!list) return;
  // Shimmering skeleton rows beat a static "Loading…" — gives the user the
  // sense that something is actively happening and previews row geometry so
  // the layout doesn't pop when results land.
  list.innerHTML = `
    <article class="pf-row pf-row-skel" aria-hidden="true"><div class="pf-row-main">
      <div class="pf-symbol-block"><span class="skeleton" style="width:72px;height:16px"></span><span class="skeleton" style="width:140px;height:11px;margin-top:6px"></span></div>
      <div><span class="skeleton" style="width:80px;height:13px"></span></div>
      <div><span class="skeleton" style="width:60px;height:13px"></span></div>
      <div><span class="skeleton" style="width:70px;height:13px"></span></div>
      <div><span class="skeleton" style="width:80px;height:24px;border-radius:99px"></span></div>
    </div></article>
    <article class="pf-row pf-row-skel" aria-hidden="true"><div class="pf-row-main">
      <div class="pf-symbol-block"><span class="skeleton" style="width:60px;height:16px"></span><span class="skeleton" style="width:120px;height:11px;margin-top:6px"></span></div>
      <div><span class="skeleton" style="width:80px;height:13px"></span></div>
      <div><span class="skeleton" style="width:60px;height:13px"></span></div>
      <div><span class="skeleton" style="width:70px;height:13px"></span></div>
      <div><span class="skeleton" style="width:80px;height:24px;border-radius:99px"></span></div>
    </div></article>`;
  // Only show OPEN positions (closed_at IS NULL). Closed positions still live
  // in the table as history backing the realized-PnL calculation server-side.
  const { data, error } = await supabase
    .from("positions")
    .select("*")
    .is("closed_at", null)
    .order("opened_at", { ascending: false });
  if (error) {
    list.innerHTML = `<p class="pf-status pf-status-err">Couldn't load positions: ${escapeHtml(error.message)}</p>`;
    return;
  }
  state.positions = data || [];
  renderPositions();
  // Risk dashboard runs off the same position list; fire-and-forget so
  // the position rows don't wait on chain fetches.
  loadRisk();
}

function renderPositions() {
  const list = $("pf-list");
  if (!list) return;
  if (!state.positions.length) {
    list.innerHTML = `<p class="pf-empty">No positions yet. Add the contracts you own to get an AI review.</p>`;
    return;
  }
  const reviewById = new Map();
  if (state.review?.perPosition) {
    for (const r of state.review.perPosition) reviewById.set(r.id, r);
  }
  const rows = state.positions.map((p) => {
    const r = reviewById.get(p.id);
    const mid = r?.currentMid;
    const pnlPct = r?.pnlPct;
    const totalPnl = r?.totalPnl;
    const action = r?.action;
    // The new "trim-to-cost" action contains a hyphen — strip it for the
    // CSS class while keeping the human label intact.
    const actionCls = action ? action.replace(/[^a-z]/gi, "-").toLowerCase() : "";
    const actionClass = action ? `pf-action pf-action-${actionCls}` : "pf-action";
    const ageLabel = fmtAge(p.opened_at || p.created_at);
    return `
      <article class="pf-row" data-id="${escapeHtml(p.id)}">
        <div class="pf-row-main">
          <div class="pf-symbol-block">
            <span class="pf-symbol">${escapeHtml(p.symbol)}</span>
            <span class="pf-leg">${escapeHtml(p.side.toUpperCase())} $${fmtNum(p.strike, 2)} · ${escapeHtml(fmtExpiry(p.expiry))}</span>
            ${ageLabel ? `<span class="pf-age" title="Opened ${escapeHtml(fmtDate(p.opened_at || p.created_at))}">opened ${escapeHtml(ageLabel)}</span>` : ""}
          </div>
          <div class="pf-qty">${p.quantity}× @ ${fmtMoney(p.entry_premium)}</div>
          <div class="pf-mark">
            <span class="pf-mark-label">Mark</span>
            <span class="pf-mark-value">${fmtMoney(mid)}</span>
          </div>
          <div class="pf-pnl ${pnlPct == null ? "" : pnlPct >= 0 ? "pf-pos" : "pf-neg"}">
            <span class="pf-pnl-pct">${fmtPct(pnlPct)}</span>
            <span class="pf-pnl-total">${totalPnl == null ? "" : (totalPnl >= 0 ? "+" : "") + fmtMoney(totalPnl).replace("$-", "-$")}</span>
          </div>
          <div class="pf-row-actions">
            ${action ? `<span class="${actionClass}">${escapeHtml(action)}</span>` : ""}
            <button type="button" class="pf-btn pf-btn-sm" data-sell="${escapeHtml(p.id)}" aria-label="Sell or close position">Sell</button>
            <button type="button" class="pf-iconbtn" data-del="${escapeHtml(p.id)}" aria-label="Delete position">✕</button>
          </div>
        </div>
        ${r && (r.headline || r.reasoning) ? `
          <div class="pf-row-rec">
            ${r.headline ? `<div class="pf-rec-headline">${escapeHtml(r.headline)}</div>` : ""}
            ${r.reasoning ? `<div class="pf-rec-reason">${escapeHtml(r.reasoning)}</div>` : ""}
            ${r.greeks ? `
              <div class="pf-rec-greeks">
                Δ ${fmtNum(r.greeks.delta, 2)} ·
                Θ ${fmtNum(r.greeks.thetaDay, 2)}/day ·
                Γ ${fmtNum(r.greeks.gamma, 3)} ·
                V ${fmtNum(r.greeks.vega, 2)}
              </div>` : ""}
          </div>` : ""}
      </article>`;
  });
  list.innerHTML = rows.join("");
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => deletePosition(btn.dataset.del));
  });
  list.querySelectorAll("[data-sell]").forEach((btn) => {
    btn.addEventListener("click", () => openSellModal(btn.dataset.sell));
  });
}

// --- Risk dashboard -------------------------------------------------------

// Pick the contract from an already-loaded chain that matches a saved
// position (same strike, same side). Returns null when the strike rolled
// off-band (Yahoo only stores ±55% of spot) so the caller can skip it
// without crashing the aggregate.
function lookupContract(chainCache, position) {
  const entry = chainCache[position.symbol];
  if (!entry) return null;
  const chain = entry.chains[position.expiry];
  if (!chain) return null;
  const rows = (position.side === "put" ? chain.p : chain.c) || [];
  // Tolerance for float-equality on strikes — Yahoo sometimes serializes
  // 7.5 as 7.5 exactly, sometimes as 7.499999998. 0.01 covers it.
  const hit = rows.find((r) => Math.abs(r.s - position.strike) < 0.01);
  return hit || null;
}

// Pre-load every symbol the user holds so renderRisk doesn't have to await
// per-row. Failed loads (delisted ticker, build skipped it) silently fall
// through — the row just contributes nothing to the aggregate.
async function preloadPositionChains() {
  const symbols = Array.from(new Set(state.positions.map((p) => p.symbol)));
  await Promise.all(symbols.map((s) => loadChain(s).catch(() => null)));
}

// Build a per-position pricing snapshot used by both the Greeks
// aggregation and the concentration / VaR computations downstream.
function buildPositionMetrics() {
  const out = [];
  for (const p of state.positions) {
    const contract = lookupContract(state.chainCache, p);
    const entry = state.chainCache[p.symbol] || {};
    const spot = entry.spot;
    const iv = contract?.iv;
    const T = yearsToExpiry(p.expiry);
    const g = (spot && iv && T && p.strike > 0)
      ? greeks(p.side, spot, p.strike, T, iv, RISK_FREE_RATE)
      : null;
    const mid = contract && contract.b != null && contract.a != null && contract.b + contract.a > 0
      ? (contract.b + contract.a) / 2
      : contract?.l ?? null;
    const qty = Math.max(0, Number(p.quantity) || 0);
    const cost = (Number(p.entry_premium) || 0) * qty * 100;
    const marketValue = mid != null ? mid * qty * 100 : null;
    const beta = entry.fundamentals?.beta;
    const sector = (window.STONKS_MANIFEST?.sectors || {})[p.symbol] || "Other";
    out.push({
      position: p,
      contract,
      spot,
      iv,
      greeks: g,
      mid,
      qty,
      cost,
      marketValue,
      beta: beta != null && isFinite(beta) ? beta : null,
      sector,
    });
  }
  return out;
}

function spyDeltaWeighted(metrics, spySpot) {
  if (!spySpot) return null;
  let acc = 0;
  let counted = 0;
  for (const m of metrics) {
    if (!m.greeks || m.spot == null || m.beta == null) continue;
    // Standard beta-weighted delta: dollar delta × beta, expressed as
    // equivalent SPY shares.
    acc += m.greeks.delta * m.qty * 100 * m.spot * m.beta / spySpot;
    counted += 1;
  }
  return counted > 0 ? acc : null;
}

function parametricVaR(metrics) {
  // 1-day, 95% VaR using a simple delta-IV-equivalent estimate. Treats the
  // portfolio's net dollar delta as a single position; not a substitute
  // for a proper Monte Carlo but gives a directional sense of overnight
  // exposure.
  let netDollarMove = 0;
  let anyCounted = false;
  for (const m of metrics) {
    if (!m.greeks || m.spot == null || !m.iv) continue;
    netDollarMove += m.greeks.delta * m.qty * 100 * m.spot * (m.iv / Math.sqrt(252));
    anyCounted = true;
  }
  if (!anyCounted) return null;
  return 1.645 * Math.abs(netDollarMove);
}

async function loadRisk() {
  const box = $("pf-risk");
  if (!box) return;
  if (!state.positions.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="pf-risk-loading"><span class="skeleton" style="width:240px;height:18px"></span></div>`;
  try {
    await preloadPositionChains();
  } catch (_) {
    // Non-fatal — renderRisk degrades gracefully on missing data.
  }
  // SPY's spot doubles as the beta-weighting denominator. Load lazily so
  // forks without SPY in the curated set still render the rest.
  try { await loadChain("SPY"); } catch (_) {}
  renderRisk();
}

function fmtBigMoney(n) {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function fmtGreek(n, digits = 2) {
  if (n == null || !isFinite(n)) return "—";
  const fixed = Number(n).toFixed(digits);
  return n >= 0 ? `+${fixed}` : fixed;
}

function renderRisk() {
  const box = $("pf-risk");
  if (!box) return;
  if (!state.positions.length) { box.hidden = true; return; }
  const metrics = buildPositionMetrics();
  // Aggregate Greeks (dollar units — multiply by qty * 100 — so the numbers
  // mean "for a $1 spot move, your portfolio moves $X"). Skipped rows are
  // those whose strike rolled off-band or whose chain failed to load.
  let delta = 0, gamma = 0, vega = 0, theta = 0;
  let countedGreeks = 0;
  for (const m of metrics) {
    if (!m.greeks) continue;
    const sign = m.qty * 100;
    delta += m.greeks.delta * sign;
    gamma += m.greeks.gamma * sign;
    vega += m.greeks.vega * sign;
    theta += m.greeks.thetaDay * sign;
    countedGreeks += 1;
  }
  // Cost-basis concentration. Per-symbol AND per-sector. Sort by descending
  // share so the top exposures are at the top of each list.
  const totalCost = metrics.reduce((acc, m) => acc + m.cost, 0);
  const bySymbol = new Map();
  const bySector = new Map();
  for (const m of metrics) {
    const sym = m.position.symbol;
    bySymbol.set(sym, (bySymbol.get(sym) || 0) + m.cost);
    bySector.set(m.sector, (bySector.get(m.sector) || 0) + m.cost);
  }
  const symbolRows = Array.from(bySymbol.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const sectorRows = Array.from(bySector.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const spySpot = state.chainCache.SPY?.spot;
  const betaDelta = spyDeltaWeighted(metrics, spySpot);
  const var95 = parametricVaR(metrics);
  const skipped = metrics.length - countedGreeks;

  const concentrationListHtml = (rows, total, formatLabel) => rows.map(([key, cost]) => {
    const pct = total > 0 ? (cost / total) * 100 : 0;
    return `<li class="pf-conc-row">
      <span class="pf-conc-label">${escapeHtml(formatLabel(key))}</span>
      <span class="pf-conc-bar"><span class="pf-conc-fill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="pf-conc-pct">${pct.toFixed(0)}%</span>
    </li>`;
  }).join("");

  box.innerHTML = `
    <header class="pf-risk-head">
      <h3 class="pf-risk-title">Portfolio risk</h3>
      <span class="pf-risk-sub">${countedGreeks} position${countedGreeks === 1 ? "" : "s"} priced${skipped > 0 ? ` · ${skipped} skipped (off-band strike or missing chain)` : ""}</span>
    </header>
    <div class="pf-risk-grid">
      <div class="pf-risk-block">
        <div class="pf-risk-block-head">Aggregate Greeks (per $1 underlying move)</div>
        <div class="pf-risk-greeks">
          <div class="pf-risk-greek"><span class="pf-greek-label">Δ Delta</span><span class="pf-greek-value ${delta >= 0 ? "pf-pos" : "pf-neg"}">${fmtGreek(delta, 1)}</span></div>
          <div class="pf-risk-greek"><span class="pf-greek-label">Γ Gamma</span><span class="pf-greek-value">${fmtGreek(gamma, 2)}</span></div>
          <div class="pf-risk-greek"><span class="pf-greek-label">V Vega</span><span class="pf-greek-value">${fmtGreek(vega, 1)}</span></div>
          <div class="pf-risk-greek"><span class="pf-greek-label">Θ Theta/day</span><span class="pf-greek-value ${theta >= 0 ? "pf-pos" : "pf-neg"}">${fmtGreek(theta, 1)}</span></div>
        </div>
        <p class="pf-risk-foot">Sum of per-contract Greeks × quantity × 100. Δ is dollars-per-$1-move on the underlying; Θ is the dollar decay you bleed per calendar day.</p>
      </div>
      <div class="pf-risk-block">
        <div class="pf-risk-block-head">Market exposure</div>
        <div class="pf-risk-kpis">
          <div class="pf-risk-kpi">
            <span class="pf-kpi-label">Beta-weighted Δ (SPY)</span>
            <span class="pf-kpi-value">${betaDelta != null ? fmtBigMoney(betaDelta) : "—"}</span>
            <span class="pf-kpi-sub">${betaDelta != null ? "Equivalent SPY-share exposure given each name's beta" : "Need SPY spot + beta on positions"}</span>
          </div>
          <div class="pf-risk-kpi">
            <span class="pf-kpi-label">1-day 95% VaR</span>
            <span class="pf-kpi-value">${var95 != null ? fmtBigMoney(var95) : "—"}</span>
            <span class="pf-kpi-sub">${var95 != null ? "Parametric, delta-IV estimate" : "Need IV on each contract"}</span>
          </div>
          <div class="pf-risk-kpi">
            <span class="pf-kpi-label">Total cost basis</span>
            <span class="pf-kpi-value">${fmtBigMoney(totalCost)}</span>
            <span class="pf-kpi-sub">Premium paid across ${state.positions.length} open position${state.positions.length === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>
      <div class="pf-risk-block">
        <div class="pf-risk-block-head">Concentration · by symbol</div>
        <ul class="pf-conc-list">${concentrationListHtml(symbolRows, totalCost, (k) => k)}</ul>
      </div>
      <div class="pf-risk-block">
        <div class="pf-risk-block-head">Concentration · by sector</div>
        <ul class="pf-conc-list">${concentrationListHtml(sectorRows, totalCost, (k) => k)}</ul>
      </div>
    </div>`;
}

async function deletePosition(id) {
  // trades.position_id has ON DELETE CASCADE, so a hard delete of a position
  // that already has SELL trades against it silently wipes the realized-P/L
  // history backing the performance tab. Check for trades first: if any
  // exist, soft-close (set closed_at) so the position drops out of the open
  // list while the trade rows — and their realized P/L — survive.
  const { count: tradeCount, error: countErr } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("position_id", id);
  if (countErr) {
    alert("Couldn't check trade history: " + countErr.message);
    return;
  }

  if (tradeCount && tradeCount > 0) {
    const msg = `This position has ${tradeCount} trade record${tradeCount === 1 ? "" : "s"} in your history. ` +
      `Archive it (keeps history, hides from open list)?`;
    if (!confirm(msg)) return;
    const { error } = await supabase
      .from("positions")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      alert("Couldn't archive position: " + error.message);
      return;
    }
  } else {
    if (!confirm("Remove this position?")) return;
    const { error } = await supabase.from("positions").delete().eq("id", id);
    if (error) {
      alert("Couldn't delete: " + error.message);
      return;
    }
  }

  state.positions = state.positions.filter((p) => p.id !== id);
  if (state.review?.perPosition) {
    state.review.perPosition = state.review.perPosition.filter((r) => r.id !== id);
  }
  renderPositions();
  renderReview();
}

// --- Add-position modal ---------------------------------------------------

function openAddModal() {
  const host = $("pf-modal-host");
  if (!host) return;
  const manifest = window.STONKS_MANIFEST || {};
  const symbols = Array.isArray(manifest.symbols) ? manifest.symbols : [];
  const sectorMap = (manifest.sectors && typeof manifest.sectors === "object") ? manifest.sectors : {};
  host.innerHTML = `
    <div class="pf-modal-backdrop" id="pf-modal-backdrop">
      <div class="pf-modal card" role="dialog" aria-modal="true" aria-labelledby="pf-modal-title">
        <header class="card-header">
          <h2 class="card-title" id="pf-modal-title">Add a position</h2>
          <button type="button" class="pf-iconbtn" id="pf-modal-close" aria-label="Close">✕</button>
        </header>
        <form id="pf-add-form" class="pf-add-form">
          <div class="field">
            <span class="field-label">Ticker</span>
            <div class="pf-combo" id="pf-symbol-combo">
              <input type="text" id="pf-symbol-input" role="combobox"
                     aria-expanded="false" aria-controls="pf-symbol-listbox"
                     aria-autocomplete="list"
                     placeholder="Search ticker or sector…"
                     autocomplete="off" spellcheck="false" required>
              <button type="button" id="pf-symbol-clear" class="pf-combo-clear" aria-label="Clear" tabindex="-1">&times;</button>
              <ul id="pf-symbol-listbox" role="listbox" hidden></ul>
              <input type="hidden" id="pf-add-symbol" name="pf-add-symbol">
            </div>
          </div>
          <div class="segmented" role="radiogroup" aria-label="Side">
            <input type="radio" name="pf-side" id="pf-side-call" value="call" checked>
            <label for="pf-side-call">Call</label>
            <input type="radio" name="pf-side" id="pf-side-put" value="put">
            <label for="pf-side-put">Put</label>
          </div>
          <label class="field">
            <span class="field-label">Expiration</span>
            <select id="pf-add-expiry" required disabled>
              <option value="">Pick a ticker first…</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Strike</span>
            <select id="pf-add-strike" required disabled>
              <option value="">Pick an expiration first…</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Contracts</span>
            <input type="number" id="pf-add-qty" min="1" step="1" value="1" required>
          </label>
          <label class="field">
            <span class="field-label">Entry premium (per contract)</span>
            <input type="number" id="pf-add-premium" min="0" step="0.01" placeholder="e.g. 4.20" required>
          </label>
          <p id="pf-add-status" class="pf-status" role="status" aria-live="polite"></p>
          <div class="pf-add-actions">
            <button type="button" class="pf-btn" id="pf-add-cancel">Cancel</button>
            <button type="submit" class="pf-btn pf-btn-primary" id="pf-add-submit">Save position</button>
          </div>
        </form>
      </div>
    </div>`;

  const opener = document.activeElement;
  let uninstallKeys = () => {};
  // Collect any document-level listeners we attach inside this modal so
  // we can detach them on close — otherwise repeated opens accumulate
  // listeners that keep firing against detached modal DOM nodes.
  const docCleanups = [];
  const closeModal = () => {
    uninstallKeys();
    for (const fn of docCleanups) { try { fn(); } catch (_) {} }
    docCleanups.length = 0;
    host.innerHTML = "";
    if (opener && document.contains(opener) && typeof opener.focus === "function") {
      try { opener.focus(); } catch (_) {}
    }
  };
  uninstallKeys = installModalKeyHandling($("pf-modal-backdrop"), closeModal);
  $("pf-modal-close").addEventListener("click", closeModal);
  $("pf-add-cancel").addEventListener("click", closeModal);
  $("pf-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "pf-modal-backdrop") closeModal();
  });

  const symbolSel = $("pf-add-symbol");          // hidden input — the canonical value
  const symbolInput = $("pf-symbol-input");       // visible text input
  const symbolListbox = $("pf-symbol-listbox");
  const symbolClear = $("pf-symbol-clear");
  const expirySel = $("pf-add-expiry");
  const strikeSel = $("pf-add-strike");
  const sideCall = $("pf-side-call");
  const sidePut = $("pf-side-put");

  // --- Searchable symbol combobox -----------------------------------------
  const comboItems = symbols.map((s) => ({ symbol: s, sector: sectorMap[s] || "" }));
  let comboFiltered = comboItems.slice();
  let comboActive = -1;

  function renderCombo() {
    if (!comboFiltered.length) {
      symbolListbox.innerHTML = `<li class="pf-combo-empty" role="option" aria-disabled="true">No matches</li>`;
      symbolInput.removeAttribute("aria-activedescendant");
      return;
    }
    symbolListbox.innerHTML = comboFiltered.map((item, idx) => `
      <li role="option"
          data-symbol="${escapeHtml(item.symbol)}"
          id="pf-combo-opt-${idx}"
          class="${idx === comboActive ? "is-active" : ""}"
          aria-selected="${idx === comboActive}">
        <span class="pf-combo-sym">${escapeHtml(item.symbol)}</span>
        ${item.sector ? `<span class="pf-combo-sector">${escapeHtml(item.sector)}</span>` : ""}
      </li>
    `).join("");
    // Announce the highlighted option to screen readers — without this, the
    // combobox advertises aria-controls but the focused row is silent.
    if (comboActive >= 0) {
      symbolInput.setAttribute("aria-activedescendant", `pf-combo-opt-${comboActive}`);
    } else {
      symbolInput.removeAttribute("aria-activedescendant");
    }
  }

  function openCombo() {
    symbolListbox.hidden = false;
    symbolInput.setAttribute("aria-expanded", "true");
  }
  function closeCombo() {
    symbolListbox.hidden = true;
    symbolInput.setAttribute("aria-expanded", "false");
    symbolInput.removeAttribute("aria-activedescendant");
    comboActive = -1;
  }

  function filterCombo(q) {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      comboFiltered = comboItems.slice();
    } else {
      // Prefix match on symbol ranks first, then substring on symbol, then sector match.
      const pre = [];
      const sub = [];
      const sec = [];
      for (const item of comboItems) {
        const sym = item.symbol.toLowerCase();
        if (sym.startsWith(needle)) pre.push(item);
        else if (sym.includes(needle)) sub.push(item);
        else if (item.sector.toLowerCase().includes(needle)) sec.push(item);
      }
      comboFiltered = pre.concat(sub, sec);
    }
    comboActive = comboFiltered.length ? 0 : -1;
    renderCombo();
  }

  function selectSymbol(symbol) {
    symbolSel.value = symbol;
    symbolInput.value = symbol;
    closeCombo();
    onSymbolPick();
  }

  symbolInput.addEventListener("focus", () => {
    filterCombo(symbolInput.value);
    openCombo();
  });
  symbolInput.addEventListener("input", () => {
    // Typing in the input invalidates any previously committed selection.
    symbolSel.value = "";
    filterCombo(symbolInput.value);
    openCombo();
  });
  symbolInput.addEventListener("keydown", (e) => {
    if (symbolListbox.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      filterCombo(symbolInput.value);
      openCombo();
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      comboActive = Math.min(comboFiltered.length - 1, comboActive + 1);
      renderCombo();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      comboActive = Math.max(0, comboActive - 1);
      renderCombo();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (comboActive >= 0 && comboFiltered[comboActive]) {
        selectSymbol(comboFiltered[comboActive].symbol);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      closeCombo();
    }
  });
  symbolListbox.addEventListener("mousedown", (e) => {
    // mousedown (not click) so the input doesn't blur before the selection commits.
    const li = e.target.closest("li[data-symbol]");
    if (!li) return;
    e.preventDefault();
    selectSymbol(li.dataset.symbol);
  });
  symbolInput.addEventListener("blur", () => {
    // Defer close to let mousedown selection fire first.
    setTimeout(closeCombo, 120);
  });
  // Touch devices don't reliably fire `blur` on outside tap (notably
  // iOS Safari), which strands the listbox open across the page. Close
  // on any pointerdown outside the combo container. Stored in
  // docCleanups so closeModal() can detach it — otherwise repeated
  // modal opens leak listeners against detached DOM.
  const symbolCombo = $("pf-symbol-combo");
  const onDocPointerdown = (e) => {
    if (symbolListbox.hidden) return;
    if (symbolCombo && symbolCombo.contains(e.target)) return;
    closeCombo();
  };
  document.addEventListener("pointerdown", onDocPointerdown);
  docCleanups.push(() => document.removeEventListener("pointerdown", onDocPointerdown));
  symbolClear.addEventListener("click", () => {
    symbolInput.value = "";
    symbolSel.value = "";
    expirySel.innerHTML = `<option value="">Pick a ticker first…</option>`;
    expirySel.disabled = true;
    strikeSel.innerHTML = `<option value="">Pick an expiration first…</option>`;
    strikeSel.disabled = true;
    filterCombo("");
    symbolInput.focus();
    openCombo();
  });
  // Seed the listbox so the dropdown isn't empty on first focus.
  filterCombo("");

  let symbolPickGen = 0;
  async function onSymbolPick() {
    const gen = ++symbolPickGen;
    const sym = symbolSel.value;
    expirySel.innerHTML = `<option value="">Loading…</option>`;
    expirySel.disabled = true;
    strikeSel.innerHTML = `<option value="">Pick an expiration first…</option>`;
    strikeSel.disabled = true;
    if (!sym) return;
    try {
      const data = await loadChain(sym);
      if (gen !== symbolPickGen) return;
      const opts = data.expirations
        .map((e) => `<option value="${e.sec}">${escapeHtml(e.label)}</option>`)
        .join("");
      expirySel.innerHTML = `<option value="">Pick an expiration…</option>` + opts;
      expirySel.disabled = false;
    } catch (err) {
      if (gen !== symbolPickGen) return;
      expirySel.innerHTML = `<option value="">Couldn't load chain</option>`;
      $("pf-add-status").textContent = err.message || "Failed to load chain.";
      $("pf-add-status").className = "pf-status pf-status-err";
    }
  }

  function onExpiryOrSideChange() {
    const sym = symbolSel.value;
    const expSec = Number(expirySel.value);
    if (!sym || !expSec) {
      strikeSel.innerHTML = `<option value="">Pick an expiration first…</option>`;
      strikeSel.disabled = true;
      return;
    }
    const side = sidePut.checked ? "put" : "call";
    const chain = state.chainCache[sym]?.chains?.[expSec];
    if (!chain) {
      strikeSel.innerHTML = `<option value="">No chain data</option>`;
      strikeSel.disabled = true;
      return;
    }
    const rows = (side === "put" ? chain.p : chain.c) || [];
    if (!rows.length) {
      strikeSel.innerHTML = `<option value="">No strikes</option>`;
      strikeSel.disabled = true;
      return;
    }
    const sorted = rows.slice().sort((a, b) => a.s - b.s);
    strikeSel.innerHTML = `<option value="">Pick a strike…</option>` +
      sorted.map((r) => {
        const mid = r.b != null && r.a != null ? ((r.b + r.a) / 2).toFixed(2) : (r.l != null ? Number(r.l).toFixed(2) : "—");
        return `<option value="${r.s}">$${fmtNum(r.s, 2)} (mid ${mid})</option>`;
      }).join("");
    strikeSel.disabled = false;
  }

  expirySel.addEventListener("change", onExpiryOrSideChange);
  sideCall.addEventListener("change", onExpiryOrSideChange);
  sidePut.addEventListener("change", onExpiryOrSideChange);

  $("pf-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("pf-add-status");
    const submit = $("pf-add-submit");
    const uid = state.session?.user?.id;
    if (!uid) {
      status.textContent = "Sign-in expired — refresh and sign in again.";
      status.className = "pf-status pf-status-err";
      return;
    }
    const payload = {
      user_id: uid,
      symbol: symbolSel.value,
      side: sidePut.checked ? "put" : "call",
      expiry: Number(expirySel.value),
      strike: Number(strikeSel.value),
      quantity: Math.max(1, Math.floor(Number($("pf-add-qty").value) || 0)),
      entry_premium: Math.max(0, Number($("pf-add-premium").value) || 0),
    };
    if (!payload.symbol || !payload.expiry || !payload.strike) {
      status.textContent = "Pick ticker, expiration, and strike.";
      status.className = "pf-status pf-status-err";
      return;
    }
    submit.disabled = true;
    status.textContent = "Saving…";
    status.className = "pf-status";
    const { data, error } = await supabase.from("positions").insert(payload).select().single();
    if (error) {
      status.textContent = "Couldn't save: " + error.message;
      status.className = "pf-status pf-status-err";
      submit.disabled = false;
      return;
    }
    state.positions = [data, ...state.positions];
    renderPositions();
    closeModal();
  });
}

async function loadChain(symbol) {
  if (state.chainCache[symbol]) return state.chainCache[symbol];
  // Use the baked per-ticker JSON — it's already in /data/<SYMBOL>.json and
  // covers all expirations the daily build snapshotted.
  const r = await fetch(`/data/${encodeURIComponent(symbol)}.json`);
  if (!r.ok) throw new Error(`No chain data for ${symbol}`);
  const j = await r.json();
  const expirations = (j.expirations || []).map((sec) => ({
    sec,
    label: new Date(sec * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
  }));
  // Spot + fundamentals are kept alongside expirations/chains so the risk
  // dashboard can read beta and the live underlying price for each holding
  // without re-fetching.
  const cached = {
    expirations,
    chains: j.chains || {},
    spot: j.spot ?? null,
    fundamentals: j.fundamentals || null,
  };
  state.chainCache[symbol] = cached;
  return cached;
}

// --- AI review ------------------------------------------------------------

async function runReview() {
  if (state.reviewing) return;
  if (!state.positions.length) {
    alert("Add at least one position first.");
    return;
  }
  state.reviewing = true;
  const btn = $("pf-review-btn");
  const reviewEl = $("pf-review");
  btn.disabled = true;
  btn.textContent = "Reviewing…";
  reviewEl.hidden = false;
  reviewEl.innerHTML = `<p class="pf-status">Pricing positions and asking AI for a strategy…</p>`;

  try {
    // Pull a fresh session straight from the SDK rather than reading the
    // cached state.session — the auto-refresh timer may have rotated the
    // access token without onAuthChange firing yet, and a stale bearer
    // turns into a generic 401 the user can't recover from.
    const session = await getSession();
    const token = session?.access_token;
    if (!token) {
      reviewEl.innerHTML = `<p class="pf-status pf-status-err">Sign-in expired — refresh and sign in again.</p>`;
      return;
    }
    const r = await fetch("/api/portfolio-review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (!r.ok) {
      reviewEl.innerHTML = `<p class="pf-status pf-status-err">${escapeHtml(j.error || "Review failed.")}</p>`;
      return;
    }
    state.review = j;
    renderReview();
    renderPositions();
    // The review endpoint upserts today's snapshot — reload so the equity
    // chart picks it up immediately.
    loadSnapshots();
  } catch (err) {
    reviewEl.innerHTML = `<p class="pf-status pf-status-err">${escapeHtml(err.message || "Review failed.")}</p>`;
  } finally {
    state.reviewing = false;
    btn.disabled = false;
    btn.textContent = "Review portfolio";
  }
}

function renderReview() {
  const el = $("pf-review");
  if (!el) return;
  if (!state.review) { el.hidden = true; return; }
  el.hidden = false;
  const p = state.review.portfolio || {};
  const aiError = p.aiError;
  el.innerHTML = `
    <div class="pf-review-card">
      <header class="pf-review-head">
        <h3>Portfolio review</h3>
        <span class="pf-review-total ${p.totalPnlPct == null ? "" : p.totalPnlPct >= 0 ? "pf-pos" : "pf-neg"}">
          Total ${fmtPct(p.totalPnlPct)}
        </span>
      </header>
      ${aiError ? `<p class="pf-status pf-status-warn">AI review unavailable (${escapeHtml(aiError)}). Live P/L and Greeks above are still accurate.</p>` : ""}
      ${p.summary ? `<p class="pf-review-summary">${escapeHtml(p.summary)}</p>` : ""}
      ${p.concentrationWarnings && p.concentrationWarnings.length ? `
        <ul class="pf-review-warnings">
          ${p.concentrationWarnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
        </ul>` : ""}
      ${p.hedgeSuggestions ? `<p class="pf-review-hedge"><strong>Hedge ideas:</strong> ${escapeHtml(p.hedgeSuggestions)}</p>` : ""}
    </div>`;
}

// --- Sell modal -----------------------------------------------------------

function openSellModal(positionId) {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) return;
  const host = $("pf-modal-host");
  if (!host) return;
  // Suggested sell price = the current AI-review mark if we have one,
  // otherwise leave blank for the user to fill in manually.
  const review = state.review?.perPosition?.find((r) => r.id === positionId);
  const suggestedPrice = review?.currentMid != null ? Number(review.currentMid).toFixed(2) : "";
  const opener = document.activeElement;
  host.innerHTML = `
    <div class="pf-modal-backdrop" id="pf-modal-backdrop">
      <div class="pf-modal card" role="dialog" aria-modal="true" aria-labelledby="pf-sell-title">
        <header class="card-header">
          <h2 class="card-title" id="pf-sell-title">Sell ${escapeHtml(pos.symbol)} ${escapeHtml(pos.side.toUpperCase())} $${fmtNum(pos.strike, 2)}</h2>
          <button type="button" class="pf-iconbtn" id="pf-modal-close" aria-label="Close">✕</button>
        </header>
        <form id="pf-sell-form" class="pf-add-form">
          <p class="hint">${pos.quantity}× contract${pos.quantity === 1 ? "" : "s"} open · entry ${fmtMoney(pos.entry_premium)} · expiry ${escapeHtml(fmtExpiry(pos.expiry))}</p>
          <label class="field">
            <span class="field-label">Contracts to sell</span>
            <input type="number" id="pf-sell-qty" min="1" max="${pos.quantity}" step="1" value="${pos.quantity}" required>
          </label>
          <label class="field">
            <span class="field-label">Sell price (per contract)</span>
            <input type="number" id="pf-sell-price" min="0" step="0.01" placeholder="e.g. 5.40" value="${suggestedPrice}" required>
          </label>
          <div id="pf-sell-preview" class="pf-sell-preview" role="status" aria-live="polite"></div>
          <p id="pf-sell-status" class="pf-status" role="status" aria-live="polite"></p>
          <div class="pf-add-actions">
            <button type="button" class="pf-btn" id="pf-sell-cancel">Cancel</button>
            <button type="submit" class="pf-btn pf-btn-primary" id="pf-sell-submit">Log sell</button>
          </div>
        </form>
      </div>
    </div>`;
  let uninstallKeys = () => {};
  const closeModal = () => {
    uninstallKeys();
    host.innerHTML = "";
    if (opener && document.contains(opener) && typeof opener.focus === "function") {
      try { opener.focus(); } catch (_) {}
    }
  };
  uninstallKeys = installModalKeyHandling($("pf-modal-backdrop"), closeModal);
  $("pf-modal-close").addEventListener("click", closeModal);
  $("pf-sell-cancel").addEventListener("click", closeModal);
  $("pf-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "pf-modal-backdrop") closeModal();
  });
  // Focus the quantity input so keyboard users can adjust immediately.
  const qtyInput = $("pf-sell-qty");
  if (qtyInput) { qtyInput.focus(); qtyInput.select?.(); }

  // Live P&L preview as the user types sell price / quantity.
  function updateSellPreview() {
    const preview = $("pf-sell-preview");
    if (!preview) return;
    const qty = Number($("pf-sell-qty")?.value);
    const price = Number($("pf-sell-price")?.value);
    if (!isFinite(qty) || qty < 1 || !isFinite(price) || price < 0) {
      preview.textContent = "";
      preview.className = "pf-sell-preview";
      return;
    }
    const pnl = (price - pos.entry_premium) * qty * 100;
    const pct = pos.entry_premium > 0 ? ((price - pos.entry_premium) / pos.entry_premium) * 100 : null;
    const sign = pnl >= 0 ? "+" : "";
    const pnlStr = sign + (pnl < 0 ? "-" : "") + "$" + Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    preview.textContent = "Realize " + pnlStr + (pct != null ? " (" + fmtPct(pct) + ")" : "");
    preview.className = "pf-sell-preview " + (pnl >= 0 ? "pf-pos" : "pf-neg");
  }
  $("pf-sell-price")?.addEventListener("input", updateSellPreview);
  $("pf-sell-qty")?.addEventListener("input", updateSellPreview);
  // Run once with pre-filled value.
  updateSellPreview();

  $("pf-sell-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("pf-sell-status");
    const submit = $("pf-sell-submit");
    const qtyRaw = Number($("pf-sell-qty").value);
    const priceRaw = Number($("pf-sell-price").value);
    if (!Number.isFinite(qtyRaw) || qtyRaw < 1) {
      status.textContent = "Enter how many contracts to sell.";
      status.className = "pf-status pf-status-err";
      return;
    }
    if (!Number.isFinite(priceRaw) || priceRaw < 0) {
      status.textContent = "Enter a non-negative sell price.";
      status.className = "pf-status pf-status-err";
      return;
    }
    const quantity = Math.floor(qtyRaw);
    const price = priceRaw;
    if (quantity > pos.quantity) {
      status.textContent = `You only have ${pos.quantity} contracts open.`;
      status.className = "pf-status pf-status-err";
      return;
    }
    submit.disabled = true;
    status.textContent = "Logging sell…";
    status.className = "pf-status";
    try {
      // Same reason as runReview: read from the SDK so an auto-refreshed
      // token isn't missed by a stale state.session.
      const session = await getSession();
      const token = session?.access_token;
      if (!token) {
        status.textContent = "Sign-in expired — refresh and sign in again.";
        status.className = "pf-status pf-status-err";
        submit.disabled = false;
        return;
      }
      const r = await fetch("/api/close-position", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify({ position_id: positionId, quantity, price }),
      });
      const j = await r.json();
      if (!r.ok) {
        status.textContent = j.error || "Couldn't log sell.";
        status.className = "pf-status pf-status-err";
        submit.disabled = false;
        return;
      }
      closeModal();
      await loadPositions();
      await loadSnapshots();
      await loadTradeHistory();
    } catch (err) {
      status.textContent = err.message || "Couldn't log sell.";
      status.className = "pf-status pf-status-err";
      submit.disabled = false;
    }
  });
}

// --- Equity chart ---------------------------------------------------------

function isMissingTableError(err) {
  if (!err) return false;
  // PostgREST surfaces "42P01" (Postgres "undefined_table") and its own
  // "PGRST205" for missing relation/schema cache miss.
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("not found in schema cache");
}

async function loadSnapshots() {
  // Reads via Supabase JS client; the snapshots_select_own RLS policy
  // ensures we only see the signed-in user's rows.
  state.snapshotsError = null;
  try {
    const { data, error } = await supabase
      .from("portfolio_snapshots")
      .select("date, equity, realized_pnl, unrealized_pnl, open_positions")
      .order("date", { ascending: true });
    if (error) {
      if (!isMissingTableError(error)) {
        // Real failure (auth, network, RLS) — surface it via the equity card
        // instead of silently hiding the chart and leaving the user wondering.
        console.error("loadSnapshots failed", error);
        state.snapshotsError = error.message || "Couldn't load equity history.";
      }
      state.snapshots = [];
    } else {
      state.snapshots = data || [];
    }
  } catch (err) {
    console.error("loadSnapshots threw", err);
    state.snapshotsError = err?.message || "Couldn't load equity history.";
    state.snapshots = [];
  }
  renderEquityChart();
}

const RANGE_DAYS = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "YTD": null, "1Y": 365, "ALL": null };

function clipSnapshotsToRange(rows, range) {
  if (!rows || !rows.length) return [];
  const now = new Date();
  if (range === "YTD") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return rows.filter((r) => new Date(r.date) >= start);
  }
  if (range === "ALL") return rows;
  const days = RANGE_DAYS[range];
  if (!days) return rows;
  const cutoff = Date.now() - days * 86400000;
  return rows.filter((r) => new Date(r.date).getTime() >= cutoff);
}

function renderEquityChart() {
  const box = $("pf-equity");
  if (!box) return;
  const rows = state.snapshots || [];
  if (state.snapshotsError) {
    box.hidden = false;
    box.innerHTML = `<p class="pf-status pf-status-err">Couldn't load equity history: ${escapeHtml(state.snapshotsError)}</p>`;
    return;
  }
  if (rows.length < 2) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  const range = state.snapshotRange || "1M";
  const clipped = clipSnapshotsToRange(rows, range);
  const data = clipped.length >= 2 ? clipped : rows.slice(-2);
  const W = 640, H = 180, padL = 8, padR = 8, padT = 20, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = data.map((r) => Number(r.equity));
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  let range1 = hi - lo;
  if (range1 === 0) range1 = Math.max(1, Math.abs(hi) * 0.2);
  const yMin = lo - range1 * 0.1;
  const yMax = hi + range1 * 0.1;
  const yFor = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xFor = (i) => padL + (plotW * i) / Math.max(1, data.length - 1);

  const first = vals[0];
  const last = vals[vals.length - 1];
  const chg = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const up = last >= first;

  let path = "";
  data.forEach((r, i) => {
    const x = xFor(i).toFixed(2);
    const y = yFor(Number(r.equity)).toFixed(2);
    path += (i === 0 ? "M" : " L") + x + "," + y;
  });
  const areaPath = path +
    ` L${xFor(data.length - 1).toFixed(2)},${(padT + plotH).toFixed(2)}` +
    ` L${xFor(0).toFixed(2)},${(padT + plotH).toFixed(2)} Z`;

  const ranges = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];
  const buttons = ranges.map((r) =>
    `<button type="button" class="pf-range-btn ${r === range ? "is-active" : ""}" data-range="${r}">${r}</button>`,
  ).join("");

  const lastDate = data[data.length - 1].date;
  const realized = data[data.length - 1].realized_pnl;
  const unrealized = data[data.length - 1].unrealized_pnl;

  box.innerHTML = `
    <div class="pf-equity-head">
      <div class="pf-equity-titles">
        <div class="pf-equity-title">Equity</div>
        <div class="pf-equity-value">
          <span class="pf-equity-now">${fmtMoney(last)}</span>
          <span class="pf-equity-chg ${up ? "pf-pos" : "pf-neg"}">${fmtPct(chg)}</span>
        </div>
        <div class="pf-equity-sub">As of ${escapeHtml(lastDate)} · realized ${fmtMoney(realized)} · unrealized ${fmtMoney(unrealized)}</div>
      </div>
      <div class="pf-equity-ranges" role="tablist">${buttons}</div>
    </div>
    <svg class="pf-equity-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Equity history">
      <path class="pf-equity-area ${up ? "up" : "down"}" d="${areaPath}" />
      <path class="pf-equity-line ${up ? "up" : "down"}" d="${path}" />
    </svg>`;

  box.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.snapshotRange = btn.dataset.range;
      renderEquityChart();
    });
  });
}

// --- Trade history & performance analytics --------------------------------

async function loadTradeHistory() {
  try {
    const { data, error } = await supabase
      .from("trades")
      .select(`
        id, quantity, price, traded_at,
        positions!inner (
          symbol, side, strike, expiry, entry_premium, opened_at, created_at
        )
      `)
      .eq("side", "SELL")
      .order("traded_at", { ascending: false });
    if (error) {
      state.trades = [];
    } else {
      state.trades = (data || []).map((t) => {
        const pos = t.positions || {};
        const entry = Number(pos.entry_premium ?? 0);
        const exit = Number(t.price);
        const qty = Number(t.quantity);
        const realizedPnl = (exit - entry) * qty * 100;
        const pnlPct = entry > 0 ? ((exit - entry) / entry) * 100 : null;
        const openedAt = pos.opened_at || pos.created_at || null;
        const holdMs = openedAt ? new Date(t.traded_at).getTime() - new Date(openedAt).getTime() : null;
        const holdDays = holdMs != null ? Math.max(0, Math.round(holdMs / 86400000)) : null;
        return {
          id: t.id,
          symbol: String(pos.symbol || "?").toUpperCase(),
          side: String(pos.side || "?"),
          strike: Number(pos.strike) || 0,
          expiry: Number(pos.expiry) || 0,
          quantity: qty,
          entryPremium: entry,
          exitPrice: exit,
          openedAt,
          closedAt: t.traded_at,
          holdDays,
          realizedPnl,
          pnlPct,
          isWin: realizedPnl > 0,
        };
      });
    }
  } catch (_) {
    state.trades = [];
  }
  renderPerformance();
}

function filterTradesByRange(trades, range) {
  if (!range || range === "ALL") return trades;
  const now = new Date();
  let cutoff;
  if (range === "YTD") {
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else {
    const days = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365 }[range];
    if (!days) return trades;
    cutoff = new Date(Date.now() - days * 86400000);
  }
  return trades.filter((t) => t.closedAt && new Date(t.closedAt) >= cutoff);
}

function computeTradeAnalytics(trades) {
  if (!trades.length) return null;
  const totalPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);
  const wins = trades.filter((t) => t.isWin);
  const losses = trades.filter((t) => !t.isWin);
  const winRate = (wins.length / trades.length) * 100;
  const holdArr = trades.filter((t) => t.holdDays != null).map((t) => t.holdDays);
  const avgHold = holdArr.length ? holdArr.reduce((s, d) => s + d, 0) / holdArr.length : null;
  const sorted = trades.slice().sort((a, b) => b.realizedPnl - a.realizedPnl);
  const topWins = sorted.filter((t) => t.realizedPnl > 0).slice(0, 5);
  const topLosses = sorted.filter((t) => t.realizedPnl < 0).reverse().slice(0, 5);
  const calls = trades.filter((t) => t.side === "call");
  const puts = trades.filter((t) => t.side === "put");
  const callWinRate = calls.length ? (calls.filter((t) => t.isWin).length / calls.length) * 100 : null;
  const putWinRate = puts.length ? (puts.filter((t) => t.isWin).length / puts.length) * 100 : null;
  const bySymbol = {};
  for (const t of trades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { symbol: t.symbol, pnl: 0, count: 0, wins: 0 };
    bySymbol[t.symbol].pnl += t.realizedPnl;
    bySymbol[t.symbol].count++;
    if (t.isWin) bySymbol[t.symbol].wins++;
  }
  const symbolList = Object.values(bySymbol).sort((a, b) => b.pnl - a.pnl).slice(0, 12);
  return {
    totalPnl,
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    avgHold,
    topWins,
    topLosses,
    callCount: calls.length,
    putCount: puts.length,
    callWinRate,
    putWinRate,
    symbolList,
  };
}

// Build cumulative realized P&L chart from individual trades (more accurate
// than snapshots since it uses actual trade timestamps, not daily rollups).
function buildPnlChartSvg(trades) {
  const sorted = trades.slice().sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  if (sorted.length < 1) return "";
  // Build cumulative curve: start at 0, add each trade in time order.
  let cum = 0;
  const points = [{ t: new Date(sorted[0].closedAt).getTime() - 1, v: 0 }];
  for (const t of sorted) {
    cum += t.realizedPnl;
    points.push({ t: new Date(t.closedAt).getTime(), v: cum });
  }
  if (points.length < 2) return "";

  const W = 640, H = 140, padL = 8, padR = 8, padT = 12, padB = 16;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = points.map((p) => p.v);
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tRange = Math.max(tMax - tMin, 1);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  let vRange = hi - lo;
  if (vRange === 0) vRange = Math.max(1, Math.abs(hi) * 0.2, 10);
  const yMin = lo - vRange * 0.1;
  const yMax = hi + vRange * 0.1;
  const yFor = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xFor = (t) => padL + ((t - tMin) / tRange) * plotW;
  const lastVal = vals[vals.length - 1];
  const up = lastVal >= 0;
  const zeroY = yFor(0).toFixed(2);

  let path = "";
  points.forEach((p, i) => {
    path += (i === 0 ? "M" : " L") + xFor(p.t).toFixed(2) + "," + yFor(p.v).toFixed(2);
  });
  const areaPath = path +
    ` L${xFor(tMax).toFixed(2)},${zeroY} L${xFor(tMin).toFixed(2)},${zeroY} Z`;

  return `<svg class="pf-equity-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cumulative realized P&L">
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="4,3"/>
    <path class="pf-equity-area ${up ? "up" : "down"}" d="${areaPath}" />
    <path class="pf-equity-line ${up ? "up" : "down"}" d="${path}" />
  </svg>`;
}

function renderPerformance() {
  const box = $("pf-history");
  if (!box) return;

  const allTrades = state.trades;
  const range = state.tradesRange;
  const filtered = filterTradesByRange(allTrades, range);
  const analytics = computeTradeAnalytics(filtered);

  if (!allTrades.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const ranges = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];
  const rangeBtns = ranges.map((r) =>
    `<button type="button" class="pf-range-btn ${r === range ? "is-active" : ""}" data-hist-range="${r}">${r}</button>`
  ).join("");

  const chartSvg = buildPnlChartSvg(filtered.length ? filtered : allTrades);

  // Big P&L number for the period
  const periodPnl = analytics ? analytics.totalPnl : null;
  const periodPnlHtml = periodPnl != null ? `
    <div class="pf-perf-pnl">
      <div class="pf-perf-pnl-label">Realized P&amp;L · ${escapeHtml(range)}</div>
      <div class="pf-perf-pnl-value ${periodPnl >= 0 ? "pf-pos" : "pf-neg"}">
        ${periodPnl >= 0 ? "+" : ""}${periodPnl < 0 ? "-$" : "$"}${Math.abs(periodPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
    </div>` : "";

  // 4-card stats grid
  let statsHtml = "";
  if (analytics) {
    const holdStr = analytics.avgHold != null
      ? (analytics.avgHold < 1 ? "<1d" : Math.round(analytics.avgHold) + "d")
      : "—";
    const sideStr = [
      analytics.callCount ? analytics.callCount + "C" : "",
      analytics.putCount ? analytics.putCount + "P" : "",
    ].filter(Boolean).join(" · ") || "—";
    const callWinStr = analytics.callWinRate != null ? analytics.callWinRate.toFixed(0) + "%" : "—";
    const putWinStr = analytics.putWinRate != null ? analytics.putWinRate.toFixed(0) + "%" : "—";
    statsHtml = `
      <div class="pf-perf-stats">
        <div class="pf-stat-card">
          <div class="pf-stat-label">Win Rate</div>
          <div class="pf-stat-value">${analytics.winRate.toFixed(0)}%</div>
          <div class="pf-stat-sub">${analytics.winCount}W · ${analytics.lossCount}L · ${analytics.tradeCount} total</div>
        </div>
        <div class="pf-stat-card">
          <div class="pf-stat-label">Avg Hold</div>
          <div class="pf-stat-value">${holdStr}</div>
          <div class="pf-stat-sub">${sideStr}</div>
        </div>
        <div class="pf-stat-card">
          <div class="pf-stat-label">Call Win %</div>
          <div class="pf-stat-value">${callWinStr}</div>
          <div class="pf-stat-sub">${analytics.callCount} call trade${analytics.callCount !== 1 ? "s" : ""}</div>
        </div>
        <div class="pf-stat-card">
          <div class="pf-stat-label">Put Win %</div>
          <div class="pf-stat-value">${putWinStr}</div>
          <div class="pf-stat-sub">${analytics.putCount} put trade${analytics.putCount !== 1 ? "s" : ""}</div>
        </div>
      </div>`;
  }

  // Top winners / biggest losses
  let winsLossesHtml = "";
  if (analytics && (analytics.topWins.length || analytics.topLosses.length)) {
    const tradeCard = (t) => {
      const pnlStr = (t.realizedPnl >= 0 ? "+" : "-") + "$" +
        Math.abs(t.realizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `
        <div class="pf-trade-item">
          <div class="pf-trade-item-info">
            <span class="pf-symbol">${escapeHtml(t.symbol)}</span>
            <span class="pf-leg">${escapeHtml(t.side.toUpperCase())} $${fmtNum(t.strike, 0)} · ${t.quantity}×</span>
            ${t.holdDays != null ? `<span class="pf-age">${t.holdDays === 0 ? "<1d" : t.holdDays + "d hold"}</span>` : ""}
          </div>
          <div class="pf-trade-item-pnl ${t.realizedPnl >= 0 ? "pf-pos" : "pf-neg"}">
            <span class="pf-trade-item-amt">${pnlStr}</span>
            ${t.pnlPct != null ? `<span class="pf-trade-item-pct">${fmtPct(t.pnlPct)}</span>` : ""}
          </div>
        </div>`;
    };
    winsLossesHtml = `
      <div class="pf-perf-wl">
        ${analytics.topWins.length ? `
          <div class="pf-perf-col">
            <div class="pf-perf-col-head">Top Winners</div>
            ${analytics.topWins.map(tradeCard).join("")}
          </div>` : ""}
        ${analytics.topLosses.length ? `
          <div class="pf-perf-col">
            <div class="pf-perf-col-head pf-perf-col-head-loss">Biggest Losses</div>
            ${analytics.topLosses.map(tradeCard).join("")}
          </div>` : ""}
      </div>`;
  }

  // Symbol breakdown chips
  let symbolHtml = "";
  if (analytics && analytics.symbolList.length > 1) {
    symbolHtml = `
      <div class="pf-perf-symbols">
        <div class="pf-perf-section-head">By Ticker</div>
        <div class="pf-symbol-chips">
          ${analytics.symbolList.map((s) => {
            const pnlStr = (s.pnl >= 0 ? "+" : "-") + "$" +
              Math.abs(s.pnl).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            const winPct = s.count ? Math.round((s.wins / s.count) * 100) : 0;
            return `
              <div class="pf-sym-chip ${s.pnl >= 0 ? "pos" : "neg"}">
                <span class="pf-sym-chip-sym">${escapeHtml(s.symbol)}</span>
                <span class="pf-sym-chip-pnl">${pnlStr}</span>
                <span class="pf-sym-chip-meta">${winPct}% · ${s.count}t</span>
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }

  // Trade log table
  let logHtml = "";
  if (filtered.length) {
    const rows = filtered.map((t) => {
      const pnlStr = (t.realizedPnl >= 0 ? "+" : "-") + "$" +
        Math.abs(t.realizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `
        <tr>
          <td>
            <span class="pf-symbol">${escapeHtml(t.symbol)}</span>
            <span class="pf-leg">${escapeHtml(t.side.toUpperCase())}</span>
          </td>
          <td class="pf-mono">$${fmtNum(t.strike, 0)}</td>
          <td class="pf-mono">${fmtMoney(t.entryPremium)}</td>
          <td class="pf-mono">${fmtMoney(t.exitPrice)}</td>
          <td class="pf-mono">${t.quantity}×</td>
          <td class="pf-mono ${t.realizedPnl >= 0 ? "pf-pos" : "pf-neg"}">${pnlStr}</td>
          <td class="pf-mono ${t.pnlPct != null ? (t.pnlPct >= 0 ? "pf-pos" : "pf-neg") : ""}">${t.pnlPct != null ? fmtPct(t.pnlPct) : "—"}</td>
          <td class="pf-muted">${t.holdDays != null ? (t.holdDays === 0 ? "<1d" : t.holdDays + "d") : "—"}</td>
          <td class="pf-muted">${escapeHtml(fmtDate(t.closedAt))}</td>
          <td class="pf-cell-actions">
            <button type="button" class="pf-iconbtn" data-del-trade="${escapeHtml(t.id)}" aria-label="Delete trade" title="Delete trade">✕</button>
          </td>
        </tr>`;
    }).join("");
    logHtml = `
      <div class="pf-trade-log">
        <div class="pf-perf-section-head">Trade History (${filtered.length})</div>
        <div class="pf-table-scroll">
          <table class="pf-trade-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Strike</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Qty</th>
                <th>P&amp;L $</th>
                <th>P&amp;L %</th>
                <th>Hold</th>
                <th>Closed</th>
                <th aria-label="Delete"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } else {
    logHtml = `<p class="pf-empty pf-perf-empty">No trades in this period.</p>`;
  }

  box.innerHTML = `
    <div class="pf-perf">
      <div class="pf-perf-header">
        <h3 class="pf-perf-title">Performance</h3>
        <div class="pf-equity-ranges" role="tablist">${rangeBtns}</div>
      </div>
      ${periodPnlHtml}
      ${chartSvg ? `<div class="pf-perf-chart">${chartSvg}</div>` : ""}
      ${statsHtml}
      ${winsLossesHtml}
      ${symbolHtml}
      ${logHtml}
    </div>`;

  box.querySelectorAll("[data-hist-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tradesRange = btn.dataset.histRange;
      renderPerformance();
    });
  });
  box.querySelectorAll("[data-del-trade]").forEach((btn) => {
    btn.addEventListener("click", () => deleteTrade(btn.dataset.delTrade));
  });
}

// Reverses a SELL trade: re-opens the position (or restores quantity for a
// partial close) and removes the trade row. Server-side RPC keeps the two
// mutations atomic, so we just refresh both the open list and the history.
async function deleteTrade(id) {
  if (!id) return;
  if (!confirm("Delete this trade? The position will be restored to its prior state.")) return;
  try {
    // Read from the SDK rather than the cached state.session — the auto-
    // refresh timer can rotate the access token without onAuthChange firing
    // yet, and a stale bearer turns into an unrecoverable 401. Matches
    // runReview / the sell handler.
    const session = await getSession();
    const token = session?.access_token;
    if (!token) {
      alert("Sign-in expired — refresh and sign in again.");
      return;
    }
    const r = await fetch("/api/delete-trade", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({ trade_id: id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j.error || "Couldn't delete trade.");
      return;
    }
    await loadTradeHistory();
    await loadPositions();
  } catch (err) {
    alert(err.message || "Couldn't delete trade.");
  }
}

// --- Bootstrap ------------------------------------------------------------

function init() {
  if (!isConfigured()) {
    renderSignedOut();
    return;
  }
  // Supabase fires onAuthStateChange on token refresh (~hourly) and on tab
  // focus. Re-rendering on every event wipes any open modal and double-
  // fetches — only re-mount the pane when the user identity actually changes.
  let mounted = false;
  let lastUserId = null;
  function applyAuth(session) {
    const nextUserId = session?.user?.id || null;
    state.session = session;
    if (mounted && nextUserId === lastUserId) return;
    mounted = true;
    lastUserId = nextUserId;
    if (session) renderSignedIn();
    else renderSignedOut();
  }
  onAuthChange(applyAuth);
  getSession().then(applyAuth);
}

// The pane lives inside #page-pane-portfolio. Initialize once the DOM is up.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
