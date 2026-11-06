// Styles for the 2026-11-06 "what to add, fix and smooth out next" pass:
// Track Record ranges and marks, the freshness line, glossary, keyboard help,
// the close ticket, compact phone rows, the earnings week board, watchlist
// alerts, the Friday recap and the "why no picks" card. Loaded last in
// styles-css.mjs so these rules win without !important.
export function renderSiteNextCss() {
  return `
/* ---- Track Record: likely ranges on every win rate ------------------------ */
.acc-tier-row:has(.acc-tier-range) { grid-template-columns: 110px 1fr 44px 44px 128px; }
.acc-tier-range {
  font: 500 12px/1.2 var(--font-mono); font-variant-numeric: tabular-nums;
  color: var(--muted-strong); text-align: right; white-space: nowrap;
}
.acc-few {
  display: inline-block; margin-left: 4px; padding: 1px 5px; border-radius: var(--r-pill);
  font: 600 10px/1.3 var(--font-sans); letter-spacing: .02em; text-transform: uppercase;
  color: var(--warn, var(--muted-strong)); background: color-mix(in srgb, var(--warn, var(--muted)) 14%, transparent);
}
.acc-judge-chip .accuracy-chip-num { white-space: nowrap; }
.acc-judge-bar {
  display: block; height: 5px; margin-top: 6px; border-radius: var(--r-pill); overflow: hidden;
  background: color-mix(in srgb, var(--muted) 18%, var(--surface));
}
.acc-judge-bar i { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); }
.acc-regime-note { margin: 8px 0 0; font-size: 12px; }
.acc-version-table .acc-qtable { margin: 4px 0 6px; }
.acc-version-table .acc-qtable td { white-space: nowrap; }
.acc-version-table .acc-qtable td:first-child { white-space: normal; min-width: 200px; }
.acc-version-table .acc-qtable td small { display: block; color: var(--muted); font-size: 12px; }
@media (max-width: 560px) {
  .acc-tier-row:has(.acc-tier-range) {
    grid-template-columns: 92px 1fr 40px 40px;
  }
  .acc-tier-row:has(.acc-tier-range) .acc-tier-range { grid-column: 1 / -1; text-align: left; padding-left: 98px; }
}

/* ---- Track Record: took / skipped marks ----------------------------------- */
.acc-mark {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border);
  font: 400 13px/1.4 var(--font-sans); color: var(--muted-strong);
}
.acc-mark-btn {
  min-height: 32px; padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--r-pill);
  background: var(--surface); color: var(--text-strong); font: 600 13px/1 var(--font-sans); cursor: pointer;
}
.acc-mark-btn:hover:not(:disabled) { background: var(--surface-2); }
.acc-mark-btn:disabled { opacity: .55; cursor: progress; }
.acc-mark-state { font-weight: 600; }
.acc-mark-state.took { color: var(--pos); }
.acc-mark-state.skipped { color: var(--muted-strong); }
.acc-mark-reason select {
  min-height: 32px; margin-left: 4px; padding: 2px 8px; border: 1px solid var(--border);
  border-radius: var(--r-2); background: var(--surface); color: var(--text-strong); font: 400 13px/1.2 var(--font-sans);
}
.acc-mark-err { color: var(--neg); font-weight: 600; }
.acc-marks-summary { margin: 12px 0; }
.acc-marks-summary .acc-qtable { margin: 6px 0; }

/* ---- Freshness line (one per page) ---------------------------------------- */
/* The page header folds the freshness line into one quiet chip and hides its
   details; the next-update time stays visible there. */
.wf-meta .freshness .freshness-detail.freshness-next { display: inline; }

/* ---- Glossary: tap a term for its meaning --------------------------------- */
.gl-term {
  border: 0; padding: 0; margin: 0; background: none; color: inherit; font: inherit; cursor: help;
  text-decoration: underline dotted color-mix(in srgb, var(--muted) 70%, transparent); text-underline-offset: 3px;
}
.gl-term-plain { cursor: help; text-decoration: underline dotted color-mix(in srgb, var(--muted) 70%, transparent); text-underline-offset: 3px; }
.gl-pop {
  position: fixed; z-index: 1200; max-width: min(320px, calc(100vw - 32px)); padding: 10px 12px;
  border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface);
  box-shadow: 0 8px 28px rgba(0,0,0,.18); color: var(--text); font: 400 13px/1.45 var(--font-sans);
}
.gl-pop b { display: block; margin-bottom: 3px; color: var(--text-strong); font-weight: 650; }
.gl-pop a { display: inline-block; margin-top: 6px; font-size: 12px; }
.gl-list { display: grid; gap: 10px; margin: 8px 0 0; }
.gl-list dt { font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.gl-list dd { margin: 2px 0 0; font: 400 13px/1.5 var(--font-sans); color: var(--muted-strong); }

/* ---- Keyboard help overlay ------------------------------------------------ */
.kb-help-backdrop {
  position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0,0,0,.42);
}
.kb-help {
  width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 18px 20px;
  border: 1px solid var(--border); border-radius: var(--r-3, 12px); background: var(--surface); color: var(--text);
  box-shadow: 0 18px 50px rgba(0,0,0,.28);
}
.kb-help h2 { margin: 0 0 10px; font: 650 17px/1.3 var(--font-sans); color: var(--text-strong); }
.kb-help table { width: 100%; border-collapse: collapse; font: 400 13px/1.4 var(--font-sans); }
.kb-help td { padding: 7px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
.kb-help td:first-child { width: 42%; white-space: nowrap; }
.kb-help kbd {
  display: inline-block; min-width: 22px; padding: 2px 6px; margin-right: 3px; border: 1px solid var(--border);
  border-bottom-width: 2px; border-radius: 5px; background: var(--surface-2); font: 600 12px/1.2 var(--font-mono); text-align: center;
}
.kb-help-close { margin-top: 12px; }

/* ---- Two-leg close ticket (Open picks) ------------------------------------ */
.tl-ticket { margin-top: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface-2); }
.tl-ticket-head { font: 650 13px/1.3 var(--font-sans); color: var(--text-strong); cursor: pointer; }
.tl-ticket[open] .tl-ticket-head { margin-bottom: 8px; }
.tl-ticket ol { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.tl-ticket li { font: 400 13px/1.45 var(--font-sans); }
.tl-ticket code { font: 500 12px/1.4 var(--font-mono); word-break: break-word; }
.tl-ticket .tl-ticket-copy { margin-left: 6px; }
.tl-ticket p { margin: 6px 0 0; font-size: 12px; color: var(--muted); }

/* ---- Per-table "reset sort" link ------------------------------------------ */
.vt-reset {
  display: inline-block; margin: 0 0 6px; padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--accent); font: 600 12px/1.4 var(--font-sans); text-decoration: underline; text-underline-offset: 2px;
}
.vt-reset[hidden] { display: none; }

/* ---- Compact one-line phone rows ------------------------------------------ */
/* All stocks, Up/down streaks, Options walls and Moving averages open on
   phones as a table with one line per row; "Compact rows" turns it off. */
.compact-toggle {
  min-height: 30px; padding: 3px 10px; border: 1px solid var(--border); border-radius: var(--r-pill);
  background: var(--surface); color: var(--muted-strong); font: 600 12px/1 var(--font-sans); cursor: pointer;
}
.compact-toggle.is-on { background: var(--surface-2); color: var(--text-strong); border-color: var(--accent-line, var(--border)); }
.view-toggle + .compact-toggle { margin-left: 6px; }
.view-toggle:has([data-view-mode="cards"].is-on) + .compact-toggle { display: none; }
.ma-track-tools { display: none; margin: 0 0 6px; }
@media (min-width: 641px) { .compact-toggle { display: none; } }
@media (max-width: 640px) {
  .ma-track-tools { display: flex; justify-content: flex-end; }
  .is-compact .vt-table th, .is-compact .vt-table td,
  .is-compact .ma-track-table th, .is-compact .ma-track-table td { padding-top: 5px; padding-bottom: 5px; line-height: 1.3; }
  .is-compact .vt-table td, .is-compact .ma-track-table td { white-space: nowrap; font-size: 13px; }
  .is-compact .vt-table td small, .is-compact .vt-table td .vt-sub, .is-compact .vt-table td .hint,
  .is-compact .ma-track-table td small { display: none; }
  .is-compact .ma-track-table td small.ma-dir, .is-compact .ma-track-table td small.quant-pos,
  .is-compact .ma-track-table td small.quant-neg { display: inline; margin-left: 5px; font-size: 12px; }
  .is-compact .vt-table td svg { max-height: 18px; }
  .is-compact .vt-table .vt-expand { width: 24px; height: 24px; min-width: 24px; min-height: 24px; }
  .is-compact .vt-table button.vt-link { min-height: 0; line-height: 1.3; }
}

/* ---- Earnings week board -------------------------------------------------- */
.ewb-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; margin-bottom: 8px; }
.ewb-head h3 { margin: 0; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.ewb-table td { font-variant-numeric: tabular-nums; }
.ewb-move { display: inline-flex; align-items: center; gap: 6px; }
.ewb-move-bar { position: relative; display: inline-block; width: 48px; height: 7px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--muted) 18%, var(--surface)); }
.ewb-move-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--r-pill); background: var(--accent); }
.ewb-move-bar b { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--text-strong); }
.ewb-tag { display: inline-block; padding: 1px 6px; border-radius: var(--r-pill); font: 600 11px/1.4 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); }
.ewb-tag.rich { color: var(--neg); background: color-mix(in srgb, var(--neg) 12%, transparent); }
.ewb-tag.cheap { color: var(--pos); background: color-mix(in srgb, var(--pos) 12%, transparent); }
.ewb-plan { display: inline-block; min-width: 128px; font: 400 12px/1.35 var(--font-sans); color: var(--muted-strong); }
.ewb-plan b { color: var(--text-strong); font-weight: 600; }
.ewb-plan-trade-through b { color: var(--pos); }
.ewb-plan-why { margin: 6px 0 0; font: 400 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.ewb-plan-why b { color: var(--text-strong); }
.ewb-table td, .ewb-table th { white-space: nowrap; }
.ewb-table td.ewb-plan-col { white-space: normal; min-width: 120px; }
.ewb-table td.ewb-stock-col, .ewb-table td.ewb-stock-col .vt-sub { white-space: normal; }
.ewb-table td.ewb-stock-col .ewb-reported { white-space: nowrap; }
.ewb-empty { padding: 12px 0; color: var(--muted); font: 400 13px/1.5 var(--font-sans); }
.ewb-season { margin: 0 0 8px; font: 400 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.ewb-season b { color: var(--text-strong); }
.ewb-table .vt-sub { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }

/* ---- Owner watchlist alerts ----------------------------------------------- */
.wla-box { margin: 14px 0 0; }
.wla-box[hidden] { display: none; }
.wla-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
.wla-head h3 { margin: 0; font: 650 15px/1.3 var(--font-sans); color: var(--text-strong); }
.wla-box .hint { margin: 6px 0 0; }
.wla-sym { text-decoration: none; }
.wla-list { display: grid; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.wla-item { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; align-items: baseline; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface); }
.wla-sym { font: 700 14px/1.2 var(--font-mono); color: var(--text-strong); }
.wla-what { font: 400 13px/1.45 var(--font-sans); color: var(--text); }
.wla-when { font: 500 12px/1.3 var(--font-sans); color: var(--muted); white-space: nowrap; }
.wla-kind { display: inline-block; margin-right: 6px; padding: 1px 6px; border-radius: var(--r-pill); font: 600 11px/1.4 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); }
.wla-kind.up { color: var(--pos); background: color-mix(in srgb, var(--pos) 12%, transparent); }
.wla-kind.down { color: var(--neg); background: color-mix(in srgb, var(--neg) 12%, transparent); }
.wla-sync { font: 500 12px/1.4 var(--font-sans); color: var(--muted); }
.wla-sync.err { color: var(--neg); }
@media (max-width: 560px) { .wla-item { grid-template-columns: auto 1fr; } .wla-when { grid-column: 1 / -1; } }

/* ---- Calendar subscribe --------------------------------------------------- */
.ics-box { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface); }
.ics-box p { margin: 0; flex: 1 1 260px; font: 400 13px/1.45 var(--font-sans); color: var(--muted-strong); }
.ics-box .ics-btn { display: inline-flex; align-items: center; min-height: 34px; padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--r-2); background: transparent; color: var(--text); font: 600 13px/1 var(--font-sans); text-decoration: none; cursor: pointer; }
.ics-box .ics-btn:hover { background: var(--surface-2); border-color: var(--border-strong); }
.ics-box .ics-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ics-box .ics-btn.is-primary { border-color: var(--accent); color: var(--accent); }
.ics-box .ics-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ics-box .ics-wait { color: var(--muted); }

/* ---- Friday recap --------------------------------------------------------- */
.recap-week { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface); }
.recap-week h3 { margin: 0 0 4px; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.recap-week .recap-sub { margin: 0 0 10px; font: 400 12px/1.4 var(--font-sans); color: var(--muted); }
.recap-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 0 0 12px; }
.recap-kpi { padding: 8px 10px; border-radius: var(--r-2); background: var(--surface-2); }
.recap-kpi b { display: block; font: 700 18px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.recap-kpi span { font: 500 12px/1.3 var(--font-sans); color: var(--muted); }
.recap-week ul { margin: 6px 0 0; padding-left: 18px; font: 400 13px/1.5 var(--font-sans); }
.recap-week h4 { margin: 12px 0 4px; font: 650 13px/1.3 var(--font-sans); color: var(--text-strong); }
.recap-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 4px; }
.recap-nav h3 { margin: 0; text-align: center; flex: 1 1 auto; }
.recap-nav .ics-btn[disabled] { opacity: .45; cursor: default; }
.recap-line { margin: 0 0 6px; font: 400 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.recap-table th, .recap-table td:first-child { white-space: nowrap; }
.recap-table td { vertical-align: top; }
.recap-actions { margin-top: 12px; }
.recap-week .ics-btn { display: inline-flex; align-items: center; min-height: 34px; padding: 4px 12px; border: 1px solid var(--border); border-radius: var(--r-2); background: transparent; color: var(--text); font: 600 13px/1 var(--font-sans); cursor: pointer; }
.recap-week .ics-btn:hover:not([disabled]) { background: var(--surface-2); border-color: var(--border-strong); }
@media (max-width: 640px) { .recap-nav h3 { font-size: 14px; } .recap-nav .ics-btn { padding: 4px 8px; } }

/* ---- "Why no picks today" card -------------------------------------------- */
.nopick-card { grid-column: 1 / -1; max-width: 760px; margin: 10px 0 14px; padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: var(--r-2); background: var(--surface); }
.nopick-card h3 { margin: 0 0 4px; font: 650 15px/1.3 var(--font-sans); color: var(--text-strong); }
.nopick-card p { margin: 0 0 8px; font: 400 13px/1.45 var(--font-sans); color: var(--muted-strong); }
.nopick-card ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; font: 400 13px/1.45 var(--font-sans); }
.nopick-card ol b { font-family: var(--font-mono); }
.nopick-card ol li a { color: inherit; }
.nopick-card .nopick-foot { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
.nopick-gate { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: var(--r-pill); font: 600 11px/1.5 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); }

/* ---- Home-screen app: offline note ---------------------------------------- */
.pwa-offline {
  position: sticky; top: 0; z-index: 900; padding: 6px 16px; text-align: center;
  font: 600 12px/1.4 var(--font-sans); color: var(--text-strong);
  background: color-mix(in srgb, var(--warn, #c78a00) 22%, var(--surface));
}
.pwa-offline[hidden] { display: none; }
`;
}
