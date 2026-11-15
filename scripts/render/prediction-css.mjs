// Styles for prediction-client.mjs (2026-11-15): the Prediction markets page,
// the stock page strip and the Calendar line. Reuses the crd-* pieces from
// crowd-css.mjs and the mm-* KPI tiles; loaded after both in styles-css.mjs.
export function renderPredictionCss() {
  return `
/* ---- Prediction markets -------------------------------------------------- */
.pmk-body { gap: 10px; }
#pm-root .pmk-ct td:first-child { white-space: normal; min-width: 200px; max-width: 380px; }
#pm-root .pmk-ct td .pmk-links { min-width: 110px; }
.pmk-kpi-sub { display: block; margin-top: 2px; font: 500 11.5px/1.35 var(--font-sans); color: var(--muted); white-space: normal; }
.pmk-theme { display: grid; gap: 2px; }
.pmk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 2px; }
.pmk-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--muted-strong); font: 600 12.5px/1.3 var(--font-sans); cursor: pointer; }
.pmk-chip small { font: 500 11px/1.3 var(--font-mono); color: var(--muted); }
.pmk-chip.is-on { background: color-mix(in srgb, var(--accent, var(--pos)) 14%, var(--surface)); border-color: color-mix(in srgb, var(--accent, var(--pos)) 50%, var(--border)); color: var(--text-strong); }
.pmk-chip:focus-visible { outline: 2px solid var(--accent, var(--pos)); outline-offset: 2px; }
.pmk-title { font: 550 13px/1.4 var(--font-sans); color: var(--text); }
.pmk-title a { color: inherit; text-decoration: none; }
.pmk-title a:hover { text-decoration: underline; }
.pmk-venue { display: inline-block; padding: 0 6px; border-radius: 999px; font: 600 10px/1.6 var(--font-sans); letter-spacing: .02em; border: 1px solid var(--border); color: var(--muted-strong); background: var(--surface-2); white-space: nowrap; }
.pmk-venue-kalshi { color: #0f8a5f; border-color: color-mix(in srgb, #0f8a5f 40%, var(--border)); }
.pmk-venue-polymarket { color: #2d6ae3; border-color: color-mix(in srgb, #2d6ae3 40%, var(--border)); }
.pmk-thin, .pmk-pair { display: inline-block; padding: 0 6px; border-radius: 999px; font: 600 10px/1.6 var(--font-sans); border: 1px dashed var(--border); color: var(--muted); white-space: nowrap; }
.pmk-chance { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
.pmk-chance b { font: 650 12.5px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
.pmk-bar { display: inline-block; width: 54px; height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; border: 1px solid var(--border); }
.pmk-bar i { display: block; height: 100%; background: var(--accent, var(--pos)); opacity: .8; }
.pmk-links { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.pmk-link { display: inline-flex; gap: 2px; align-items: baseline; padding: 0 6px; border-radius: 6px; font: 600 11.5px/1.6 var(--font-mono); text-decoration: none; border: 1px solid var(--border); color: var(--muted-strong); background: var(--surface); }
.pmk-link b { font-weight: 700; }
.pmk-link-up { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 40%, var(--border)); }
.pmk-link-down { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 40%, var(--border)); }
.pmk-dir { font: 600 11.5px/1.4 var(--font-sans); }
.pmk-dir-up { color: var(--pos); }
.pmk-dir-down { color: var(--neg); }
.pmk-dir-unk { color: var(--muted); }
.pmk-res { display: inline-block; min-width: 34px; text-align: center; padding: 0 6px; border-radius: 6px; font: 700 11px/1.6 var(--font-mono); background: var(--surface-2); }
.pmk-res-yes { color: var(--pos); }
.pmk-res-no { color: var(--neg); }
.pmk-react { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; font: 500 12px/1.4 var(--font-sans); }
.pmk-verdict { display: inline-block; padding: 0 7px; border-radius: 999px; font: 600 10.5px/1.7 var(--font-sans); border: 1px solid var(--border); color: var(--muted-strong); background: var(--surface-2); white-space: nowrap; }
.pmk-v-holds, .pmk-v-odds-lead, .pmk-v-run-up-follows { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 45%, var(--border)); }
.pmk-v-echo, .pmk-v-odds-echo, .pmk-v-same-day, .pmk-v-moves-together { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
.pmk-v-collecting { color: var(--muted); border-style: dashed; }
.pmk-strip { list-style: none; margin: 4px 0 4px; padding: 0; display: grid; gap: 6px; }
.pmk-strip li { display: grid; grid-template-columns: 46px 1fr; gap: 10px; align-items: start; padding: 6px 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.pmk-strip-p { font: 700 16px/1.3 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-strong); text-align: right; }
.pmk-strip-t { display: grid; gap: 2px; min-width: 0; }
.pmk-strip-t small { font: 500 11.5px/1.4 var(--font-sans); }
.pmk-cal { margin: 4px 0 0; font: 500 12px/1.5 var(--font-sans); color: var(--muted-strong); }
@media (max-width: 560px) {
  .pmk-bar { width: 36px; }
  .pmk-strip li { grid-template-columns: 40px 1fr; }
}
`;
}
