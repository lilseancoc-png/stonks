// Styles for the table-first list views added in the UI overhaul (Options
// walls, Unusual trades, Moving averages, Rising volatility, the Grade
// indicator table). The shared table itself lives in views-css.mjs.
export function renderTablesCss() {
  return `
/* ---- Options walls table -------------------------------------------------- */
.oi-list.is-table { display: block; }
.oi-vt td.oi-range-col { min-width: 140px; }
.oi-range { position: relative; display: inline-block; width: 120px; height: 12px; vertical-align: middle; }
.oi-range::before { content: ""; position: absolute; left: 0; right: 0; top: 4px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--neg) 0 6px, var(--border-strong, var(--border)) 6px calc(100% - 6px), var(--pos) calc(100% - 6px)); }
.oi-range-dot { position: absolute; top: 1px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--text-strong); box-shadow: 0 0 0 2px var(--surface); }
.oi-range.is-above .oi-range-dot { background: var(--pos); }
.oi-range.is-below .oi-range-dot { background: var(--neg); }
.oi-vt .oi-score { font-size: 11px; padding: 2px 6px; }
.oi-vt-detail { display: grid; gap: 10px; }
.oi-vt tr.is-flagged td:first-child { box-shadow: inset 3px 0 0 var(--warn, #d97706); }

/* ---- Unusual trades table ------------------------------------------------- */
.flow-list.is-table { display: block; }
.flow-vt .flow-tape, .flow-vt .flow-repeat { font-size: 11px; }
.flow-vt .flow-note { margin: 0; max-width: 72ch; color: var(--text-2, var(--text)); font-size: 12.5px; line-height: 1.5; }
.flow-vt-detail { display: grid; gap: 8px; }
.flow-vt-detail .flow-grade-btn { justify-self: start; }

/* ---- Moving averages: every stock against its averages ------------------- */
.ma-all { margin-top: 18px; }
.ma-all-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 12px; }
.ma-all-head h3 { margin: 0; font-size: 15px; }
.ma-all-head p { margin: 0; color: var(--muted); font-size: 12px; }
.ma-all .vt-cbar { width: 72px; }
@media (max-width: 760px) { .ma-all .vt-cbar { width: 44px; } .ma-all .vt-cbar-cell b { min-width: 44px; } }

/* ---- Rising volatility: percentile bar + band pill ------------------------ */
.ivt-trow-pct .vt-bar-track { width: 54px; }
.ivt-trow-pct .vt-bar b { min-width: 22px; text-align: right; font-weight: 600; }
.iv-band-pill { display: inline-block; padding: 2px 7px; border-radius: 999px; font: 600 10.5px/1.3 var(--font-sans); white-space: nowrap; background: var(--surface-2); color: var(--muted-strong); border: 1px solid var(--border); }
.iv-band-pill.iv-band-cheap { color: var(--pos); background: var(--pos-soft); border-color: transparent; }
.iv-band-pill.iv-band-rich { color: var(--warn, #b45309); background: var(--warn-soft, rgba(217,119,6,.12)); border-color: transparent; }
.iv-band-pill.iv-band-very-rich { color: var(--neg); background: var(--neg-soft); border-color: transparent; }

/* ---- Grade page: indicator table ------------------------------------------ */
.opt-tech-table-wrap { grid-column: 1 / -1; }
.opt-tech-table td.opt-tech-t-read { white-space: normal; min-width: 180px; }
.opt-tech-table .opt-tech-pill { margin-right: 6px; }
.opt-tech-table .opt-tech-t-note { color: var(--muted); font-size: 12px; }
.opt-tech-table .opt-tech-num { font: 600 13px/1.3 var(--font-mono); color: var(--text-strong); }
.opt-tech-table .opt-tech-vsub { display: block; margin-top: 2px; font: 500 11px/1.3 var(--font-sans); color: var(--muted); white-space: nowrap; }
.opt-tech-table td.opt-tech-t-label { font-weight: 600; color: var(--text-strong); }
.opt-tech-table td { vertical-align: top; }
.opt-tech-table .opt-tech-t-grp td { background: var(--surface-2); color: var(--muted); font: 600 11px/1.2 var(--font-sans); padding-top: 6px; padding-bottom: 6px; }
.opt-tech-table .opt-tech-t-grp:hover td { background: var(--surface-2); }
@media (max-width: 760px) {
  .opt-tech-table thead { display: none; }
  .opt-tech-table tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; border-bottom: 1px solid var(--hairline, var(--border)); }
  .opt-tech-table tbody tr td { border-bottom: 0; }
  .opt-tech-table tbody tr.opt-tech-t-grp { display: block; }
  .opt-tech-table tbody tr.opt-tech-t-grp td { display: block; }
  .opt-tech-table td.opt-tech-t-read { grid-column: 1 / -1; min-width: 0; padding-top: 0; }
}
`;
}
