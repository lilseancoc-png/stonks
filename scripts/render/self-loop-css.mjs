// Styles for self-loop-client.mjs (2026-11-09): the Owner Lab Loop view.
// Shares the evb-* / rgl-* classes from evidence-css.mjs and
// regime-lab-css.mjs; loaded right after them in styles-css.mjs.
export function renderSelfLoopCss() {
  return `
/* ---- Owner Lab: self-improving loop ------------------------------------- */
.slp-kpis { margin: 6px 0 8px; }
.slp-section .evb-lead .evb-pill { margin-right: 6px; }
.slp-table td.num, .slp-table th.num { white-space: nowrap; }
.slp-details { margin: 4px 0 6px; }
.slp-details > summary { padding: 3px 0; }
.slp-section .ln-svg { max-width: 760px; }
.slp-h4 { margin: 12px 0 4px; font: 650 12.5px/1.4 var(--font-sans); color: var(--text-strong); }
.slp-items li { margin: 2px 0; }
.slp-kpis small { font-weight: 600; margin-left: 4px; }
.slp-section .crd-dim { font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
`;
}
