// Styles for market-risk-client.mjs (2026-11-17): the one-line summary of the
// four market-risk reads at the top of the Owner "Market risk" tabs.
export function renderMarketRiskCss() {
  return `
/* ---- Market risk line ---------------------------------------------------- */
.mr-line { display: grid; gap: 8px; margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.mr-line[hidden] { display: none; }
.mr-kicker { display: block; font: 600 11px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.mr-reads { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; min-width: 0; }
.mr-read { display: grid; gap: 2px; align-content: start; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-left: 3px solid var(--mr-tone, var(--border)); border-radius: 8px; background: var(--surface-2, var(--surface)); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.mr-read:hover { border-color: var(--accent-line, var(--border)); border-left-color: var(--mr-tone, var(--border)); }
.mr-read:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mr-read.is-here { cursor: default; background: var(--accent-tint-2, var(--surface-2, var(--surface))); }
.mr-read.is-off { --mr-tone: var(--neg); }
.mr-read.is-on { --mr-tone: var(--pos); }
.mr-read.is-warn { --mr-tone: var(--warn); }
.mr-read small { font: 500 11.5px/1.3 var(--font-sans); color: var(--muted); }
.mr-read b { font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); overflow-wrap: anywhere; }
.mr-na { font-weight: 500; color: var(--muted); }
.mr-rough { margin-left: 4px; padding: 0 5px; border-radius: 999px; background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); font: 600 10.5px/1.6 var(--font-sans); vertical-align: 1px; }
.mr-lead { margin: 0; font: 550 13.5px/1.5 var(--font-sans); color: var(--text-strong); max-width: 90ch; }
.mr-why { margin: 0; font: 450 12.5px/1.5 var(--font-sans); color: var(--muted-strong); max-width: 90ch; }
@media (max-width: 560px) { .mr-reads { grid-template-columns: 1fr 1fr; } }
`;
}
