// Styles for regime-lab-client.mjs (2026-11-09): the Owner Lab Regime Lab
// view (six-cell grid, label history strip, risk scores, catalog). Shares the
// evb-* classes from evidence-css.mjs; loaded right after it in
// styles-css.mjs. Colors come from the shared tokens so dark mode follows.
export function renderRegimeLabCss() {
  return `
/* ---- Owner Lab: Regime Lab ---------------------------------------------- */
.rgl-nav { display: flex; flex-wrap: wrap; gap: 6px 10px; margin: 4px 0 2px; }
.rgl-nav a { font: 600 12px/1.6 var(--font-sans); color: var(--muted-strong); text-decoration: none; padding: 1px 9px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); }
.rgl-nav a:hover { color: var(--text-strong); border-color: var(--text-strong); }
.rgl-grid { display: grid; grid-template-columns: 110px 1fr 1fr; gap: 6px; margin: 8px 0 10px; }
.rgl-grid-head, .rgl-grid-row { display: contents; }
.rgl-grid-head span { font: 650 11.5px/1.4 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; padding: 0 2px 2px; }
.rgl-grid-label { align-self: center; font: 650 12px/1.3 var(--font-sans); color: var(--muted-strong); }
.rgl-cell { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-2, 10px); background: var(--surface-2, var(--surface)); min-height: 72px; }
.rgl-cell.is-now { border-color: var(--accent, var(--pos)); box-shadow: inset 0 0 0 1px var(--accent, var(--pos)); background: color-mix(in srgb, var(--accent, var(--pos)) 9%, var(--surface)); }
.rgl-cell.is-next { border-style: dashed; }
.rgl-cell-name { font: 650 13px/1.3 var(--font-sans); color: var(--text-strong); margin-bottom: 3px; }
.rgl-cell-meta { font: 450 11.5px/1.45 var(--font-sans); color: var(--muted-strong); }
.rgl-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 4px 18px; margin: 6px 0 0; }
.rgl-facts > div { display: grid; grid-template-columns: 128px 1fr; gap: 0 10px; padding: 4px 0; border-bottom: 1px solid var(--border); }
.rgl-facts dt { font: 600 11.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.rgl-facts dd { margin: 0; font: 450 12.5px/1.5 var(--font-sans); color: var(--text); }
.rgl-strip { display: block; width: 100%; height: 112px; margin: 4px 0 2px; }
.rgl-strip rect.is-tr { opacity: .55; }
.rgl-e-calm { fill: color-mix(in srgb, var(--pos) 38%, transparent); }
.rgl-e-normal { fill: color-mix(in srgb, var(--muted) 45%, transparent); }
.rgl-e-elevated { fill: color-mix(in srgb, var(--warn) 65%, transparent); }
.rgl-e-crisis { fill: color-mix(in srgb, var(--neg) 75%, transparent); }
.rgl-c-up { fill: color-mix(in srgb, var(--pos) 70%, transparent); }
.rgl-c-chop { fill: color-mix(in srgb, var(--muted) 40%, transparent); }
.rgl-c-down { fill: color-mix(in srgb, var(--neg) 70%, transparent); }
.rgl-strip .rgl-sw { stroke: var(--text-strong); stroke-width: 1; opacity: .7; }
.rgl-strip .rgl-vix { fill: none; stroke: var(--text-strong); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.rgl-strip .rgl-axis { fill: var(--muted); font: 500 10px var(--font-sans); }
.rgl-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 2px 0 6px; font: 500 11.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.rgl-legend i { display: inline-block; width: 12px; height: 10px; margin-right: 4px; border-radius: 2px; vertical-align: -1px; }
.rgl-legend i.rgl-e-calm { background: color-mix(in srgb, var(--pos) 38%, transparent); }
.rgl-legend i.rgl-e-normal { background: color-mix(in srgb, var(--muted) 45%, transparent); }
.rgl-legend i.rgl-e-elevated { background: color-mix(in srgb, var(--warn) 65%, transparent); }
.rgl-legend i.rgl-e-crisis { background: color-mix(in srgb, var(--neg) 75%, transparent); }
.rgl-legend i.rgl-c-up { background: color-mix(in srgb, var(--pos) 70%, transparent); }
.rgl-legend i.rgl-c-chop { background: color-mix(in srgb, var(--muted) 40%, transparent); }
.rgl-legend i.rgl-c-down { background: color-mix(in srgb, var(--neg) 70%, transparent); }
.rgl-legend i.rgl-sw-i { width: 2px; background: var(--text-strong); }
.rgl-legend-gap { width: 8px; }
.rgl-ladder { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.rgl-ladder-step { padding: 4px 10px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); font: 500 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.rgl-ladder-step b { color: var(--text-strong); font-weight: 650; margin-right: 4px; }
.rgl-ladder-step.is-now { border-color: var(--accent, var(--pos)); color: var(--text-strong); background: color-mix(in srgb, var(--accent, var(--pos)) 10%, transparent); }
.rgl-risk { display: inline-block; min-width: 34px; padding: 1px 7px; border-radius: var(--r-pill, 999px); font: 650 12px/1.5 var(--font-sans); text-align: center; color: var(--text-strong); background: color-mix(in srgb, var(--muted) 18%, transparent); }
.rgl-risk-7, .rgl-risk-8 { color: var(--warn); background: var(--warn-soft, color-mix(in srgb, var(--warn) 16%, transparent)); }
.rgl-risk-9, .rgl-risk-10 { color: var(--neg); background: var(--neg-soft, color-mix(in srgb, var(--neg) 16%, transparent)); }
.rgl-risk-1, .rgl-risk-2, .rgl-risk-3 { color: var(--pos); background: var(--pos-soft, color-mix(in srgb, var(--pos) 14%, transparent)); }
.rgl-row-strong td { font-weight: 600; }
.rgl-details { margin: 6px 0 0; }
.rgl-details > summary { cursor: pointer; font: 600 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.rgl-lines { margin: 2px 0 8px 18px; padding: 0; font: 450 12.5px/1.55 var(--font-sans); color: var(--text); }
.rgl-catalog td code { font-size: 11px; }
@media (max-width: 640px) {
  .rgl-grid { grid-template-columns: 1fr 1fr; }
  .rgl-grid-head span:first-child, .rgl-grid-label { display: none; }
  .rgl-cell { min-height: 0; }
  .rgl-facts > div { grid-template-columns: 1fr; }
  .rgl-strip { height: 96px; }
}
`;
}
