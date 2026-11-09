// Styles for crowd-client.mjs (2026-11-09): the public Crowd & positioning
// page and the Owner Lab crowd section. Shares the mm-* KPI tiles from
// views-next-css.mjs and the vt-* tables; loaded after them in styles-css.mjs.
export function renderCrowdCss() {
  return `
/* ---- Crowd & positioning ------------------------------------------------- */
.crd-body { display: grid; gap: 14px; margin-top: 10px; }
.crd-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin: 10px 0 4px; }
.crd-head h3 { margin: 0; font: 650 15px/1.3 var(--font-sans); color: var(--text-strong); }
.crd-h4 { margin: 12px 0 4px; font: 650 13px/1.3 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; }
.crd-src { display: inline-block; padding: 1px 7px; border-radius: 999px; font: 600 10.5px/1.5 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); border: 1px solid var(--border); }
.crd-src-ok { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 40%, var(--border)); }
.crd-src-carried { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--border)); }
.crd-src-missing { color: var(--muted); }
.crd-src-new { color: var(--accent, var(--muted-strong)); border-style: dashed; }
.crd-asof, .crd-dim { font: 500 11.5px/1.4 var(--font-sans); color: var(--muted); }
.crd-lede { margin: 0 0 6px; font: 450 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.crd-note { margin: 6px 0 0; font: 450 12px/1.5 var(--font-sans); color: var(--muted); }
.crd-fact { margin: 4px 0 6px; font: 500 13px/1.5 var(--font-sans); color: var(--text); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.crd-err { margin: 0 0 6px; font: 500 12px/1.5 var(--font-sans); color: var(--warn); }
.crd-empty { margin: 4px 0 8px; font: 450 13px/1.5 var(--font-sans); color: var(--muted); }
.crd-z { font: 600 11.5px/1.4 var(--font-mono); color: var(--muted-strong); }
.crd-z-hi { color: var(--neg); }
.crd-z-lo { color: var(--pos); }
.crd-pct { font: 500 10.5px/1.4 var(--font-mono); color: var(--muted); }
.crd-hot { color: var(--neg); font-weight: 650; }
.crd-side { display: inline-block; padding: 1px 7px; border-radius: 999px; font: 600 11px/1.5 var(--font-sans); }
.crd-side-bull { background: color-mix(in srgb, var(--pos) 14%, transparent); color: var(--pos); }
.crd-side-bear { background: color-mix(in srgb, var(--neg) 14%, transparent); color: var(--neg); }
.crd-chart { margin: 8px 0 2px; }
.crd-chart svg { width: 100%; height: auto; display: block; }
.crd-legend { margin: 2px 0 0; font: 500 11.5px/1.5 var(--font-sans); color: var(--muted-strong); display: flex; gap: 6px 10px; align-items: center; }
.crd-sw { display: inline-block; width: 14px; height: 3px; border-radius: 2px; background: var(--accent); }
.crd-sw-1 { background: #3b82f6; }
.crd-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
.crd-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px; font: 600 12px/1.4 var(--font-sans); color: var(--muted-strong); background: var(--surface-2); }
.crd-chip small { font: 500 11px/1.4 var(--font-mono); color: var(--muted); }
.crd-chip.is-tracked { border-color: color-mix(in srgb, var(--accent, var(--pos)) 45%, var(--border)); background: color-mix(in srgb, var(--accent, var(--pos)) 8%, var(--surface)); }
.crd-series { padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin: 6px 0; }
.crd-series-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-bottom: 4px; }
.crd-series-name { font: 650 13.5px/1.3 var(--font-sans); color: var(--text-strong); }
.crd-event { padding: 6px 0 2px; border-top: 1px dashed var(--border); }
.crd-event:first-of-type { border-top: 0; }
.crd-event-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font: 500 13px/1.4 var(--font-sans); margin-bottom: 4px; }
.crd-event-meta { display: inline-flex; gap: 8px; }
.crd-dist, .crd-ladder { display: grid; gap: 3px; }
.crd-dist-row { display: grid; grid-template-columns: minmax(96px, 150px) 1fr 44px; gap: 8px; align-items: center; font: 500 12px/1.4 var(--font-sans); }
.crd-dist-row.is-best .crd-dist-label { color: var(--text-strong); font-weight: 650; }
.crd-dist-label { color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.crd-dist-bar { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
.crd-dist-bar i { display: block; height: 100%; background: var(--accent, var(--pos)); opacity: .75; border-radius: 5px; }
.crd-dist-row.is-best .crd-dist-bar i { opacity: 1; }
.crd-dist-p { text-align: right; font: 600 12px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; }
.crd-sources { margin-top: 10px; }
.crd-sources summary { cursor: pointer; font: 600 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.crd-sources ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 3px; font: 450 12.5px/1.5 var(--font-sans); }
/* Owner Lab: crowd join */
.crd-owner-flags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.crd-flag { display: inline-block; padding: 0 6px; border-radius: 999px; font: 600 10.5px/1.6 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); border: 1px solid var(--border); }
.crd-flag-warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
.crd-score { display: inline-block; min-width: 34px; text-align: center; padding: 1px 6px; border-radius: 6px; font: 650 12px/1.5 var(--font-mono); background: var(--surface-2); }
.crd-score-hi { background: color-mix(in srgb, var(--neg) 16%, transparent); color: var(--neg); }
.crd-score-lo { background: color-mix(in srgb, var(--pos) 16%, transparent); color: var(--pos); }
@media (max-width: 560px) {
  .crd-dist-row { grid-template-columns: 92px 1fr 40px; }
}
`;
}
