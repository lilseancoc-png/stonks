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
      <div id="pf-list" class="pf-list" role="status" aria-live="polite">Loading…</div>
      <div id="pf-review" class="pf-review" hidden></div>
    </section>
    <div id="pf-modal-host"></div>`;

  $("pf-signout").addEventListener("click", () => signOut());
  $("pf-add-btn").addEventListener("click", openAddModal);
  $("pf-review-btn").addEventListener("click", runReview);

  loadPositions();
  loadSnapshots();
}

// --- Positions CRUD -------------------------------------------------------

async function loadPositions() {
  const list = $("pf-list");
  if (!list) return;
  list.textContent = "Loading…";
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

async function deletePosition(id) {
  if (!confirm("Remove this position?")) return;
  const { error } = await supabase.from("positions").delete().eq("id", id);
  if (error) {
    alert("Couldn't delete: " + error.message);
    return;
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

  const closeModal = () => { host.innerHTML = ""; };
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
  }

  function openCombo() {
    symbolListbox.hidden = false;
    symbolInput.setAttribute("aria-expanded", "true");
  }
  function closeCombo() {
    symbolListbox.hidden = true;
    symbolInput.setAttribute("aria-expanded", "false");
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

  async function onSymbolPick() {
    const sym = symbolSel.value;
    expirySel.innerHTML = `<option value="">Loading…</option>`;
    expirySel.disabled = true;
    strikeSel.innerHTML = `<option value="">Pick an expiration first…</option>`;
    strikeSel.disabled = true;
    if (!sym) return;
    try {
      const data = await loadChain(sym);
      const opts = data.expirations
        .map((e) => `<option value="${e.sec}">${escapeHtml(e.label)}</option>`)
        .join("");
      expirySel.innerHTML = `<option value="">Pick expiration…</option>` + opts;
      expirySel.disabled = false;
    } catch (err) {
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
    strikeSel.innerHTML = `<option value="">Pick strike…</option>` +
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
    const payload = {
      user_id: state.session.user.id,
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
  const cached = { expirations, chains: j.chains || {} };
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
    const token = state.session?.access_token;
    const r = await fetch("/api/portfolio-review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify({ positions: state.positions }),
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
          <p id="pf-sell-status" class="pf-status" role="status" aria-live="polite"></p>
          <div class="pf-add-actions">
            <button type="button" class="pf-btn" id="pf-sell-cancel">Cancel</button>
            <button type="submit" class="pf-btn pf-btn-primary" id="pf-sell-submit">Log sell</button>
          </div>
        </form>
      </div>
    </div>`;
  const closeModal = () => { host.innerHTML = ""; };
  $("pf-modal-close").addEventListener("click", closeModal);
  $("pf-sell-cancel").addEventListener("click", closeModal);
  $("pf-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "pf-modal-backdrop") closeModal();
  });
  $("pf-sell-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = $("pf-sell-status");
    const submit = $("pf-sell-submit");
    const quantity = Math.max(1, Math.floor(Number($("pf-sell-qty").value) || 0));
    const price = Math.max(0, Number($("pf-sell-price").value) || 0);
    if (quantity > pos.quantity) {
      status.textContent = `You only have ${pos.quantity} contracts open.`;
      status.className = "pf-status pf-status-err";
      return;
    }
    submit.disabled = true;
    status.textContent = "Logging sell…";
    status.className = "pf-status";
    try {
      const token = state.session?.access_token;
      const r = await fetch("/api/close-position", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
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
    } catch (err) {
      status.textContent = err.message || "Couldn't log sell.";
      status.className = "pf-status pf-status-err";
      submit.disabled = false;
    }
  });
}

// --- Equity chart ---------------------------------------------------------

async function loadSnapshots() {
  // Reads via Supabase JS client; the snapshots_select_own RLS policy
  // ensures we only see the signed-in user's rows.
  try {
    const { data, error } = await supabase
      .from("portfolio_snapshots")
      .select("date, equity, realized_pnl, unrealized_pnl, open_positions")
      .order("date", { ascending: true });
    if (error) {
      // Table doesn't exist yet (older deployment) — silently hide the chart.
      state.snapshots = [];
    } else {
      state.snapshots = data || [];
    }
  } catch (_) {
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

// --- Bootstrap ------------------------------------------------------------

async function refreshFromSession() {
  state.session = await getSession();
  if (state.session) renderSignedIn();
  else renderSignedOut();
}

function init() {
  if (!isConfigured()) {
    renderSignedOut();
    return;
  }
  onAuthChange((session) => {
    state.session = session;
    if (session) renderSignedIn();
    else renderSignedOut();
  });
  refreshFromSession();
}

// The pane lives inside #page-pane-portfolio. Initialize once the DOM is up.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
