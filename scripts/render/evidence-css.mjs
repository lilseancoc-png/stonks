// Styles for evidence-client.mjs (2026-11-08): the Owner Lab Evidence view
// (tests-and-gates board, timeline, outcome tables). Loaded last in
// styles-css.mjs. Colors come from the shared tokens so dark mode follows.
export function renderEvidenceCss() {
  return `
/* ---- Owner Lab: Evidence ------------------------------------------------ */
.evb-root { display: block; }
.evb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 4px 0 6px; }
.evb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.evb-chip, .evb-pill {
  display: inline-block; padding: 2px 9px; border-radius: var(--r-pill, 999px);
  font: 650 11.5px/1.5 var(--font-sans); letter-spacing: .02em; white-space: nowrap;
  color: var(--muted-strong); background: color-mix(in srgb, var(--muted) 16%, transparent);
}
.evb-asof { color: var(--muted); font: 500 12px/1.4 var(--font-sans); }
.evb-lead { margin: 4px 0 10px; color: var(--text); font: 500 14px/1.5 var(--font-sans); }
.evb-s-collect { color: var(--accent, var(--text-strong)); background: color-mix(in srgb, var(--accent, var(--muted)) 14%, transparent); }
.evb-s-ready { color: var(--warn); background: var(--warn-soft, color-mix(in srgb, var(--warn) 14%, transparent)); }
.evb-s-pass { color: var(--pos); background: var(--pos-soft, color-mix(in srgb, var(--pos) 14%, transparent)); }
.evb-s-fail { color: var(--neg); background: var(--neg-soft, color-mix(in srgb, var(--neg) 14%, transparent)); }
.evb-s-unclear { color: var(--warn); background: var(--warn-soft, color-mix(in srgb, var(--warn) 14%, transparent)); }
.evb-section { margin: 14px 0 0; padding: 12px 14px 10px; border: 1px solid var(--border); border-radius: var(--r-2, 10px); background: var(--surface); }
.evb-section > h3 { margin: 0 0 6px; font: 650 15px/1.3 var(--font-sans); color: var(--text-strong); }
.evb-note { margin: 4px 0 8px; max-width: 90ch; color: var(--muted-strong); font: 450 12.5px/1.55 var(--font-sans); }
.evb-note strong { color: var(--text-strong); }
.evb-sub h4 { margin: 8px 0 2px; font: 600 12.5px/1.3 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; }
.evb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 4px 18px; }
.evb-table td { vertical-align: top; }
.evb-table .evb-q { margin-top: 2px; color: var(--muted); font: 450 11.5px/1.45 var(--font-sans); max-width: 42ch; }
.evb-prog { min-width: 140px; }
.evb-bar { display: block; height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--muted) 18%, transparent); overflow: hidden; }
.evb-bar-fill { display: block; height: 100%; background: var(--accent, var(--pos)); border-radius: 4px; }
.evb-timeline { display: block; width: 100%; height: auto; max-height: 420px; margin: 6px 0 2px; }
.evb-timeline .evb-grid { stroke: var(--border); stroke-width: 1; }
.evb-timeline .evb-axis { fill: var(--muted); font: 500 11px var(--font-sans); }
.evb-timeline .evb-lane { fill: var(--muted-strong); font: 650 11px var(--font-sans); text-transform: uppercase; letter-spacing: .04em; }
.evb-timeline .evb-label { fill: var(--text-strong); font: 600 11px var(--font-sans); pointer-events: none; }
.evb-timeline .evb-track { fill: color-mix(in srgb, var(--muted) 16%, transparent); }
.evb-timeline .evb-fill { fill: color-mix(in srgb, var(--accent, var(--pos)) 42%, transparent); }
.evb-timeline .evb-fill-pass { fill: color-mix(in srgb, var(--pos) 48%, transparent); }
.evb-timeline .evb-fill-fail { fill: color-mix(in srgb, var(--neg) 48%, transparent); }
.evb-timeline .evb-fill-ready, .evb-timeline .evb-fill-inconclusive { fill: color-mix(in srgb, var(--warn) 48%, transparent); }
.evb-timeline .evb-dot-fixed { fill: var(--text-strong); }
.evb-timeline .evb-dot-proj { fill: var(--surface); stroke: var(--text-strong); stroke-width: 1.5; }
.evb-timeline .evb-today { stroke: var(--neg); stroke-width: 1.2; stroke-dasharray: 3 3; }
.evb-timeline .evb-today-label { fill: var(--neg); }
.evb-cost .evb-cost-bar { fill: color-mix(in srgb, var(--accent, var(--pos)) 60%, transparent); }
.evb-cost .evb-cost-over { fill: color-mix(in srgb, var(--neg) 70%, transparent); }
.evb-cost .evb-cost-idle { fill: color-mix(in srgb, var(--muted) 35%, transparent); }
.evb-cost .evb-cost-target { stroke: var(--warn); stroke-width: 1.4; stroke-dasharray: 5 4; }
.evb-cost .evb-cost-target-label { fill: var(--warn); }
#cost-history-section { margin-top: 16px; }
@media (max-width: 640px) {
  .evb-section { padding: 10px 10px 8px; }
  .evb-grid { grid-template-columns: 1fr; }
  .evb-timeline { max-height: none; }
}
`;
}
