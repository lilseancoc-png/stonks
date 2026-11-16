// Styles for quant-labs-client.mjs (2026-11-16): the Owner Lab Quant labs
// view and the "Market odds" card on the Bottom tracker and Risk analysis.
// Shares the evb-* / rgl-* / slp-* classes; loaded right after
// self-loop-css.mjs in styles-css.mjs. Colors come from the shared tokens so
// dark mode follows.
export function renderQuantLabsCss() {
  return `
/* ---- Owner Lab: quant labs ---------------------------------------------- */
.ql-body { margin-top: 12px; min-width: 0; }
.ql-body .ln-svg { max-width: 760px; }
.ql-body .mm-kpi b small { display: block; margin-top: 2px; font: 500 11px/1.3 var(--font-sans); color: var(--muted); }
.ql-lines { margin: 4px 0 10px 18px; padding: 0; font: 450 13px/1.6 var(--font-sans); color: var(--text); max-width: 96ch; }
.ql-lines li { margin: 3px 0; }
.ql-linkbtn { font: 650 13px/1.4 var(--font-sans); color: var(--accent, var(--text-strong)); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.ql-linkbtn:hover { color: var(--text-strong); }
.ql-linkbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.ql-warn { margin: 4px 0 8px; padding: 6px 10px; border-radius: var(--r-2, 10px); border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border)); background: color-mix(in srgb, var(--warn) 9%, transparent); color: var(--text-strong); font: 500 12.5px/1.45 var(--font-sans); }
.ql-warn-inline { color: var(--warn); font-weight: 500; }
.ql-table td { vertical-align: top; }
.ql-table td .crd-dim { font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
.ql-wide th { white-space: nowrap; }
.ql-table td.ql-labelcell { white-space: normal; min-width: 260px; }
@media (max-width: 640px) { .ql-table td.ql-labelcell { min-width: 170px; } }
.ql-readline { margin-top: 3px; max-width: 520px; font: 450 12px/1.45 var(--font-sans); color: var(--muted-strong); }
.ql-root .slp-table th:not(.num), .ql-root .slp-table td:not(.num) { text-align: left; }
.ql-universe .slp-table th { white-space: normal; vertical-align: bottom; min-width: 54px; }
.ql-universe { margin-top: 6px; }
.ql-universe .ql-fam td { padding-top: 10px; font: 650 11px/1.3 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
.ql-universe td:first-child { min-width: 170px; }
.ql-universe-read { color: var(--text-strong); }
.ql-list { margin: 6px 0 4px; padding-left: 18px; color: var(--text); font: 450 13px/1.6 var(--font-sans); }
.ql-list li { margin: 3px 0; }
.ql-strong { font-weight: 700; color: var(--text-strong); }
.ql-heat { display: inline-block; min-width: 30px; padding: 1px 6px; border-radius: 6px; text-align: center; font: 600 12px/1.5 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.ql-h1 { background: color-mix(in srgb, var(--neg) 26%, transparent); }
.ql-h2 { background: color-mix(in srgb, var(--neg) 11%, transparent); }
.ql-h3 { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.ql-h4 { background: color-mix(in srgb, var(--pos) 11%, transparent); }
.ql-h5 { background: color-mix(in srgb, var(--pos) 26%, transparent); }
/* The card on the Bottom tracker and Risk analysis pages. */
#risk-odds, #bottom-odds { margin-top: 12px; }
.ql-card { padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--r-2, 10px); background: var(--surface-2, var(--surface)); }
.ql-kicker { display: block; font: 650 11px/1.4 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.ql-card-lead { margin: 4px 0 8px; font: 500 15px/1.45 var(--font-sans); color: var(--text); }
.ql-card-lead b { font-weight: 700; color: var(--text-strong); }
.ql-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 8px; }
.ql-chips-lbl { font: 600 11.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.ql-chip { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 10px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); font: 500 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.ql-chip b { font: 650 13px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.ql-chip small { font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
.ql-chip-weak { border-style: dashed; }
.ql-chip-weak b { color: var(--muted-strong); }
.ql-card-note { margin: 0 0 8px; max-width: 96ch; font: 450 12px/1.5 var(--font-sans); color: var(--muted-strong); }
@media (max-width: 640px) {
  .ql-card-lead { font-size: 14px; }
  .ql-chip { padding: 3px 10px; border-radius: 12px; }
}
`;
}
