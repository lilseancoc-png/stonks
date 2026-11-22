// Styles for trade-pop-client.mjs (2026-11-22): the chance of profit line on
// open Top Picks cards, the "Why" panel in table rows, and the Owner check.
export function renderTradePopCss() {
  return `
/* ---- Chance of profit -------------------------------------------------------- */
.pop-chip {
  margin: 6px 0; max-width: 680px; padding: 5px 10px; border: 1px solid var(--border);
  border-radius: var(--r-2, 10px); background: var(--surface-2, var(--surface));
  font: 500 13px/1.45 var(--font-sans);
}
.pop-chip > summary { cursor: pointer; list-style: none; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.pop-chip > summary::-webkit-details-marker { display: none; }
.pop-chip .pop-lbl { color: var(--muted-strong); font-weight: 600; }
.pop-chip > summary b { font-variant-numeric: tabular-nums; }
.pop-chip > summary small { color: var(--muted); font-size: 12px; }
.pop-chip .pop-open { margin-left: auto; color: var(--accent, var(--link)); font-weight: 600; font-size: 12px; }
.pop-chip .pop-open::after { content: " ▾"; }
.pop-chip[open] .pop-open::after { content: " ▴"; }
.pop-why { margin: 6px 0 2px; max-width: 78ch; }
.pop-why .pop-line { margin: 4px 0; color: var(--text); font: 500 13px/1.55 var(--font-sans); }
.pop-why .pop-sub { color: var(--muted-strong); font-size: 12.5px; }
.pop-why .pop-src { margin: 2px 0 6px 18px; padding: 0; font: 500 12.5px/1.5 var(--font-sans); color: var(--text); }
.pop-why .pop-src li { margin: 1px 0; }
.pop-check .mm-kpis { margin: 4px 0 8px; }
.pop-table td { font-variant-numeric: tabular-nums; }
.pop-table th:not(.num), .pop-table td:not(.num) { text-align: left; }
.pop-table td small { color: var(--muted); font-size: 12px; }
.pop-table tr.pop-grp td { border-top: 1px solid var(--border); }
@media (max-width: 640px) {
  .pop-chip .pop-open { margin-left: 0; }
}
`;
}
