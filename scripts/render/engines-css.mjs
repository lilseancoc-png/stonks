// Styles for engines-client.mjs (2026-11-16): the Strategy engines page, its
// tab bar and the per-engine views. Shares the ui-tabs, evb-*, slp-*,
// mm-kpi and vt-* classes; loaded after self-loop-css.mjs in styles-css.mjs.
export function renderEnginesCss() {
  return `
/* ---- Strategy engines (their own Owner page) ----------------------------- */
.eng-switch { margin: 0 0 12px; min-width: 0; }
.eng-tabs { gap: 0; }
.eng-tab { display: inline-flex; align-items: center; gap: 5px; padding-left: 10px; padding-right: 10px; font-size: 13.5px; }
.eng-tab .ui-tab-count { margin-left: 0; }
.eng-flag { font: 650 10px/1.5 var(--font-sans); letter-spacing: .05em; text-transform: uppercase; padding: 0 6px; border-radius: var(--r-pill, 999px); color: var(--accent, var(--text-strong)); background: color-mix(in srgb, var(--accent, var(--muted)) 14%, transparent); }
.eng-count { margin-left: 0; }
.eng-pane { min-width: 0; }
.eng-pane[hidden] { display: none; }
.eng-head { align-items: flex-start; flex-wrap: wrap; gap: 8px 12px; }
.eng-head-pills { display: flex; flex-wrap: wrap; gap: 4px 6px; justify-content: flex-end; }
.eng-subtabs { margin-top: 2px; }
.eng-body { min-width: 0; }
.eng-empty { padding: 8px 0 12px; }
.eng-wait { margin: 0; color: var(--muted-strong); font: 450 13px/1.5 var(--font-sans); }
/* The page header names the page; this card's title names the engine in view, so it stays. */
.page-pane.wf-merged > .card.eng-pane > .card-header .card-title { display: block; }
.eng-foot { margin-top: 14px; }
.eng-pane .evb-lead .evb-pill { margin-right: 6px; }
.eng-pane .mm-kpis { grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); }
.eng-pane .mm-kpi b { font-size: 16px; }
.eng-pane .mm-kpi b span { font: inherit; color: inherit; }
.eng-pane .mm-kpi b .sig-pos { color: var(--pos); }
.eng-pane .mm-kpi b .sig-neg { color: var(--neg); }
.eng-kpi-sub { display: block; margin-top: 2px; font: 500 11px/1.3 var(--font-sans); color: var(--muted); }
.eng-pane .slp-table th, .eng-pane .slp-table td { text-align: left; }
.eng-pane .slp-table th.num, .eng-pane .slp-table td.num { text-align: right; white-space: nowrap; }
.eng-pane .slp-table td.l { min-width: 18ch; }
.eng-pane .crd-dim { font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
.eng-pane .ln-svg { max-width: 760px; }
.eng-id { font-family: var(--font-mono); font-size: 10.5px; white-space: nowrap; }
.eng-side { display: inline-block; padding: 0 6px; border-radius: var(--r-pill, 999px); font: 650 10.5px/1.6 var(--font-sans); letter-spacing: .03em; text-transform: uppercase; }
.eng-call { color: var(--pos); background: var(--pos-soft, color-mix(in srgb, var(--pos) 14%, transparent)); }
.eng-put { color: var(--neg); background: var(--neg-soft, color-mix(in srgb, var(--neg) 14%, transparent)); }
.eng-shr { color: var(--accent, var(--pos)); background: color-mix(in srgb, var(--accent, var(--pos)) 14%, transparent); }
.eng-test { color: var(--warn, #b7791f); background: color-mix(in srgb, var(--warn, #b7791f) 14%, transparent); }
.eng-size { margin-top: 2px; font-size: 12px; color: var(--muted); }
.eng-size > summary { cursor: pointer; list-style: revert; }
.eng-size ul { margin: 4px 0 2px 16px; padding: 0; }
.eng-size li { margin: 1px 0; }
.eng-trial { color: var(--warn, var(--muted-strong)); background: color-mix(in srgb, var(--warn, var(--muted-strong)) 14%, transparent); margin-left: 4px; }
.eng-reads { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 4px 0 10px; }
.eng-reads-lbl { font: 650 11px/1.5 var(--font-sans); letter-spacing: .05em; text-transform: uppercase; color: var(--muted-strong); margin-right: 2px; }
.eng-chip { display: inline-block; padding: 2px 9px; border-radius: var(--r-pill, 999px); border: 1px solid var(--border); font: 500 12px/1.5 var(--font-sans); color: var(--text); background: var(--surface); }
.eng-chip b { font-weight: 650; color: var(--muted-strong); }
.eng-rules, .eng-notes { margin: 4px 0 8px; padding-left: 18px; max-width: 95ch; color: var(--text); font: 450 13px/1.55 var(--font-sans); }
.eng-rules li, .eng-notes li { margin: 3px 0; }
.eng-rules b, .eng-notes b { color: var(--text-strong); }
.eng-status-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 4px 0 10px; }
.eng-shared { margin-top: 3px; padding: 1px 7px; display: inline-block; border-radius: 6px; font: 600 11px/1.5 var(--font-sans); color: var(--warn); background: var(--warn-soft, color-mix(in srgb, var(--warn) 14%, transparent)); white-space: normal; }
.eng-shared-holder { color: var(--accent, var(--text-strong)); background: color-mix(in srgb, var(--accent, var(--muted)) 12%, transparent); }
.eng-shared-note { margin: 8px 0 12px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--border)); border-radius: var(--r-2, 10px); background: color-mix(in srgb, var(--warn) 7%, transparent); font: 450 13px/1.5 var(--font-sans); color: var(--text); }
.eng-shared-note ul { margin: 4px 0 0; padding-left: 18px; }
.eng-link { appearance: none; border: 0; background: none; padding: 0; margin: 0; font: inherit; color: var(--accent, var(--text-strong)); cursor: pointer; text-align: left; }
.eng-link:hover { text-decoration: underline; }
.eng-open-link { margin: 8px 0 12px; font: 450 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.eng-row-skipped td { color: var(--muted-strong); }
.eng-rank-h { margin: 14px 0 6px; font-size: 13px; font-weight: 600; color: var(--muted-strong); }
.eng-rank-held td { background: color-mix(in srgb, var(--accent, var(--muted)) 7%, transparent); }
.eng-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.eng-seg { display: inline-flex; flex-wrap: wrap; gap: 4px; margin: 12px 0 4px; padding: 3px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); background: var(--surface-2, var(--surface)); }
.eng-seg-btn { appearance: none; border: 0; background: transparent; color: var(--muted-strong); font: 600 12.5px/1 var(--font-sans); padding: 8px 14px; min-height: 32px; border-radius: var(--r-pill, 999px); cursor: pointer; }
.eng-seg-btn.is-on { background: var(--surface); color: var(--text-strong); box-shadow: 0 0 0 1px var(--border); }
.eng-seg-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.eng-details { margin: 4px 0 6px; }
.eng-details > summary { padding: 3px 0; }
.eng-cmp-name { min-width: 190px; }
.eng-cmp-name .crd-dim { white-space: nowrap; }
.eng-flag-row td { background: color-mix(in srgb, var(--accent, var(--muted)) 5%, transparent); }
.eng-total-row td { border-top: 2px solid var(--border); font-weight: 600; }
.eng-vars { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 12px; margin: 10px 0 14px; }
.eng-var { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.eng-var-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 4px; }
.eng-var .eng-notes { margin: 4px 0; }
.eng-var-trades > summary { cursor: pointer; padding: 3px 0; }
@media (max-width: 640px) {
  .eng-tab { padding-left: 10px; padding-right: 10px; }
  .eng-head-pills { justify-content: flex-start; }
  .eng-cmp-name { min-width: 150px; }
  .eng-pane .slp-table td.l { min-width: 14ch; }
  .eng-seg { border-radius: 14px; }
}
`;
}
