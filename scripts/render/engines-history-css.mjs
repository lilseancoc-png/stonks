// Styles for engines-history-client.mjs (2026-11-17): Pattern lab's
// "Strategy styles by era", the case-study strips and the Owner "Today's
// regime fit" block. Reuses the vt-* tables (views-css.mjs).
export function renderEnginesHistoryCss() {
  return `
/* ---- Engine history on the site ------------------------------------------ */
[data-eh][hidden] { display: none !important; }
.eh-card, .eh-strip, .eh-fit { display: grid; gap: 8px; margin: 12px 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.eh-head h3 { margin: 2px 0 0; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.eh-head h4, .eh-strip-head h4 { margin: 2px 0 0; font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.eh-kicker { display: block; font: 600 11px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.eh-lede, .eh-line { margin: 0; font: 450 13px/1.55 var(--font-sans); color: var(--muted-strong); max-width: 80ch; }
.eh-line { color: var(--text); }
.eh-note { margin: 0; font: 450 12px/1.5 var(--font-sans); color: var(--muted); max-width: 84ch; }
.eh-dim { color: var(--muted); font-weight: 500; }
.eh-block { display: block; font-size: 11px; }
.eh-star { margin-left: 1px; color: var(--muted); font-size: 10px; }
.eh-v { font-variant-numeric: tabular-nums; font-weight: 650; white-space: nowrap; }
.eh-v.pos { color: var(--pos); }
.eh-v.neg { color: var(--neg); }
.eh-v.is-few { opacity: .5; }
.eh-totals { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.eh-total { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2, var(--surface)); min-width: 0; }
.eh-total-name { font: 600 12px/1.35 var(--font-sans); color: var(--muted-strong); }
.eh-total b { font-size: 18px; line-height: 1.2; }
.eh-total small { font: 450 11.5px/1.4 var(--font-sans); color: var(--muted); }
.eh-callout { margin: 0; padding: 8px 10px; border-left: 3px solid var(--warn); border-radius: 6px; background: color-mix(in srgb, var(--warn) 8%, var(--surface)); font: 450 12.5px/1.5 var(--font-sans); color: var(--text); }
.eh-table td small { font-weight: 450; }
.eh-caveats summary { cursor: pointer; font: 600 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.eh-caveats p, .eh-caveats li { font: 450 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.eh-caveats ul { margin: 4px 0 0; padding-left: 18px; }
.eh-eras { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.eh-era { display: grid; gap: 4px; align-content: start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2, var(--surface)); min-width: 0; }
.eh-era > b { font: 650 13px/1.35 var(--font-sans); color: var(--text-strong); }
.eh-era > .eh-dim { font: 500 11.5px/1.4 var(--font-sans); }
.eh-chips { list-style: none; margin: 2px 0 0; padding: 0; display: grid; gap: 2px; }
.eh-chips li { display: grid; grid-template-columns: 1fr auto 3.2em; gap: 6px; align-items: baseline; font: 500 12px/1.45 var(--font-sans); color: var(--muted-strong); }
.eh-chips li small { text-align: right; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.eh-cellchips { display: flex; flex-wrap: wrap; gap: 6px; }
.eh-cellchip { display: inline-flex; gap: 4px; align-items: baseline; padding: 2px 9px; border: 1px solid var(--border); border-radius: 999px; font: 500 12px/1.6 var(--font-sans); color: var(--text); background: var(--surface-2, var(--surface)); }
.eh-cellchip b { font-weight: 650; color: var(--muted-strong); }
.eh-cellchip small { color: var(--muted); }
.eh-cellchip.is-na { color: var(--muted); }
@media (max-width: 560px) {
  .eh-card, .eh-strip, .eh-fit { padding: 10px; }
  .eh-total b { font-size: 16px; }
  .eh-table td:first-child, .eh-table th:first-child { min-width: 8.5em; max-width: 10.5em; white-space: normal; }
}
`;
}
