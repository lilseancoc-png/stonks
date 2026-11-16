// Styles for ai-disruption-client.mjs (2026-11-16): the AI disruption page,
// its Owner review tab and the stock page strip. Reuses the crd-* pieces from
// crowd-css.mjs and the mm-* KPI tiles; loaded after both in styles-css.mjs.
export function renderAiDisruptionCss() {
  return `
/* ---- AI disruption ---------------------------------------------------------- */
.aid-body { gap: 10px; }
.aid-lede { margin: 2px 0 6px; font: 500 13px/1.5 var(--font-sans); color: var(--muted-strong); max-width: 78ch; }
.aid-h3 { margin: 14px 0 6px; font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.aid-kpi-sub { display: block; margin-top: 2px; font: 500 11.5px/1.35 var(--font-sans); color: var(--muted); white-space: normal; }
.aid-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
.aid-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--muted-strong); font: 600 12.5px/1.3 var(--font-sans); cursor: pointer; }
.aid-chip.is-on { background: color-mix(in srgb, var(--accent, var(--pos)) 14%, var(--surface)); border-color: color-mix(in srgb, var(--accent, var(--pos)) 50%, var(--border)); color: var(--text-strong); }
.aid-chip:focus-visible, .aid-btn:focus-visible, .aid-linkbtn:focus-visible { outline: 2px solid var(--accent, var(--pos)); outline-offset: 2px; }
.aid-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 2px 0 8px; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.aid-filters select { margin-left: 4px; max-width: 240px; min-height: 32px; padding: 0 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-2, 8px); font: 500 13px/1.2 var(--font-sans); }
.aid-lab { display: inline-block; padding: 0 7px; border-radius: 999px; font: 650 11px/1.7 var(--font-sans); color: var(--aid-lab); border: 1px solid color-mix(in srgb, var(--aid-lab) 45%, var(--border)); background: color-mix(in srgb, var(--aid-lab) 9%, var(--surface)); white-space: nowrap; }
.aid-title { font: 550 13px/1.4 var(--font-sans); color: var(--text); }
.aid-title a { color: inherit; text-decoration: none; }
.aid-title a:hover { text-decoration: underline; }
#aid-root td.aid-c-wide { white-space: normal; min-width: 200px; max-width: 340px; }
#aid-root td.aid-c-mid { white-space: normal; min-width: 130px; max-width: 240px; }
#aid-root td.aid-c-date { white-space: nowrap; }
.aid-sub { display: block; margin-top: 3px; font-size: 11.5px; line-height: 1.35; }
.aid-badge { display: inline-block; padding: 0 6px; border-radius: 999px; font: 650 10px/1.65 var(--font-sans); letter-spacing: .02em; white-space: nowrap; border: 1px solid var(--border); }
.aid-badge-auto { color: var(--muted-strong); border-style: dashed; background: var(--surface-2); }
.aid-badge-ok { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 45%, var(--border)); background: color-mix(in srgb, var(--pos) 8%, var(--surface)); }
.aid-badge-pending { color: var(--warn, #b7791f); border-color: color-mix(in srgb, var(--warn, #b7791f) 45%, var(--border)); }
.aid-caps { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.aid-caps > span { padding: 0 6px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); font: 550 11.5px/1.6 var(--font-sans); color: var(--muted-strong); white-space: nowrap; max-width: 100%; }
#aid-root td .aid-caps > span { white-space: normal; }
.aid-caps small { color: var(--muted); font-weight: 500; }
.aid-score { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
.aid-score b { font: 650 12.5px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; min-width: 24px; text-align: right; }
.aid-score-bar { display: inline-block; width: 46px; height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
.aid-score-bar i { display: block; height: 100%; background: var(--accent, var(--pos)); opacity: .8; }
.aid-targets { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.aid-t { display: inline-block; padding: 0 6px; border-radius: 6px; font: 600 11.5px/1.6 var(--font-mono); text-decoration: none; border: 1px solid var(--border); color: var(--muted-strong); background: var(--surface); white-space: nowrap; }
.aid-t-covered { font-weight: 700; }
.aid-t-obsolescence { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 45%, var(--border)); }
.aid-t-business-model { color: var(--warn, #b7791f); border-color: color-mix(in srgb, var(--warn, #b7791f) 45%, var(--border)); }
.aid-t-commoditization { color: var(--muted-strong); border-color: color-mix(in srgb, var(--muted) 50%, var(--border)); }
.aid-t-watch { color: var(--muted); border-style: dashed; }
.aid-board td:first-child { white-space: normal; min-width: 180px; }
#aid-root .aid-board td.aid-cell { font: 650 12.5px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--accent, var(--pos)) calc(var(--aid-heat, 0) * .5%), var(--surface)); }
#aid-root .aid-board td.aid-cell-none { color: var(--muted); }
.aid-linkbtn { border: 0; padding: 0; background: none; color: var(--accent, var(--pos)); font: inherit; cursor: pointer; text-align: left; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.aid-actions { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.aid-btn { padding: 3px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font: 600 12px/1.4 var(--font-sans); cursor: pointer; }
.aid-btn:disabled { opacity: .55; cursor: default; }
.aid-btn-primary { background: var(--accent, var(--pos)); color: #fff; border-color: transparent; }
.aid-btn-neg { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 40%, var(--border)); }
.aid-msg { font: 500 12px/1.4 var(--font-sans); color: var(--muted-strong); }
.aid-q { padding: 10px 12px; margin: 0 0 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.aid-q-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font: 550 13px/1.45 var(--font-sans); }
.aid-q-head a { color: inherit; }
.aid-q-text { margin: 6px 0; font: 500 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.aid-q-why { margin: 4px 0 8px; font: 500 12px/1.45 var(--font-sans); color: var(--muted); }
.aid-fix { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px 12px; margin-top: 10px; padding: 10px; border: 1px dashed var(--border); border-radius: 10px; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.aid-fix label { display: grid; gap: 3px; }
.aid-fix input[type="text"], .aid-fix input[name="title"], .aid-fix select { width: 100%; box-sizing: border-box; }
.aid-fix fieldset { margin: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.aid-fix legend { padding: 0 4px; font-weight: 650; }
.aid-fix .aid-check { display: inline-flex; gap: 4px; align-items: center; }
.aid-fix-wide { grid-column: 1 / -1; }
.aid-v { display: inline-block; padding: 0 7px; border-radius: 999px; font: 650 11px/1.7 var(--font-sans); white-space: nowrap; border: 1px solid var(--border); color: var(--muted-strong); background: var(--surface-2); }
.aid-v-neg { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 45%, var(--border)); background: color-mix(in srgb, var(--neg) 8%, var(--surface)); }
.aid-v-pos { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 45%, var(--border)); background: color-mix(in srgb, var(--pos) 8%, var(--surface)); }
.aid-v-wait { border-style: dashed; color: var(--muted); }
.aid-cellv { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; font: 600 12.5px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; }
#aid-root .aid-sc td { white-space: normal; vertical-align: top; }
#aid-root .aid-sc td:first-child { min-width: 150px; }
.aid-gate { margin: 10px 0 4px; padding: 10px 12px; border: 1px solid var(--border); border-left: 3px solid var(--warn, #b7791f); border-radius: 10px; background: var(--surface); font: 500 13px/1.5 var(--font-sans); color: var(--text); }
.aid-gate.is-ready { border-left-color: var(--pos); }
.aid-gate ul { margin: 4px 0 0; padding-left: 18px; color: var(--muted-strong); }
.aid-chart { max-width: 760px; }
.aid-chart svg { width: 100%; height: auto; display: block; }
.aid-notes { margin: 8px 0; padding-left: 18px; font: 500 12.5px/1.6 var(--font-sans); color: var(--muted-strong); }
.aid-strip { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 6px; }
.aid-strip li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; font: 500 13px/1.45 var(--font-sans); }
@media (max-width: 640px) {
  #aid-root td.aid-c-wide { min-width: 170px; }
  #aid-root td.aid-c-mid { min-width: 120px; }
  .aid-fix { grid-template-columns: 1fr; }
}
`;
}
