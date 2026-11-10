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
.slp-ch { padding: 8px 10px; margin: 8px 0; border: 1px solid var(--border); border-radius: var(--r-2, 10px); }
.slp-ch-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 600 13px/1.4 var(--font-sans); color: var(--text-strong); }
.slp-checks { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.slp-check { font: 500 11.5px/1.6 var(--font-sans); padding: 0 8px; border-radius: var(--r-pill, 999px); border: 1px solid var(--border); color: var(--muted-strong); }
.slp-check.is-ok { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 40%, var(--border)); }
.slp-section .crd-dim { font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
.slp-alert { margin: 6px 0 8px; padding: 8px 10px; border-radius: var(--r-2, 10px); border: 1px solid color-mix(in srgb, var(--neg) 45%, var(--border)); background: color-mix(in srgb, var(--neg) 8%, transparent); color: var(--text-strong); font: 500 12.5px/1.45 var(--font-sans); }
.slp-wait { list-style: none; margin: 4px 0; padding: 0; }
.slp-wait li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.slp-btns { display: flex; gap: 6px; flex: none; }
.slp-btn { font: 600 12px/1.2 var(--font-sans); padding: 4px 12px; min-height: 32px; border-radius: var(--r-pill, 999px); border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text-strong); cursor: pointer; }
.slp-btn.is-quiet { background: transparent; color: var(--muted-strong); border-color: var(--border); }
.slp-btn:hover:not([disabled]) { border-color: var(--accent); color: var(--text-strong); }
.slp-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.slp-btn:disabled { opacity: .55; cursor: default; }
.slp-table tr.is-current td { font-weight: 600; }
.slp-table tr.is-current td .crd-dim { font-weight: 450; }
.slp-table th.l, .slp-table td.l { text-align: left; }
.slp-odds .odds-lbl { margin-right: 2px; }
`;
}
