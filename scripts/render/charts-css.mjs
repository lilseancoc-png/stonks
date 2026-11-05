// Styles for the charts added across the site in the UI overhaul (the step-axis
// line chart, the Rates curve and history, the Track Record equity curve,
// event paths, the earnings scatter, 13F and gold bars, Market mood). Sizes
// are px; the design-system pass maps them onto the shared type scale.
export function renderChartsCss() {
  return `
/* === Step-axis line chart (lineSvgHtml in app-js.mjs) === */
.ln-svg { display: block; width: 100%; height: auto; overflow: visible; }
.ln-grid { stroke: var(--border); stroke-width: 1; opacity: 0.7; }
.ln-zero { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.ln-tick { fill: var(--muted); font: 500 11px var(--font-sans); font-variant-numeric: tabular-nums; }
.ln-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.ln-line.ln-s0 { stroke: var(--accent); stroke-width: 2.5; }
.ln-line.ln-s1 { stroke: #3b82f6; }
.ln-line.ln-s2 { stroke: var(--muted); }
.ln-line.ln-s3 { stroke: #a855f7; }
.ln-line.ln-dashed { stroke-dasharray: 5 4; }
.ln-dot { stroke: var(--surface); stroke-width: 1.5; }
.ln-dot.ln-s0 { fill: var(--accent); }
.ln-dot.ln-s1 { fill: #3b82f6; }
.ln-dot.ln-s2 { fill: var(--muted); }
.ln-band { fill: var(--accent); opacity: 0.14; }
.ln-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); }
.ln-key { display: inline-flex; align-items: center; gap: 6px; }
.ln-swatch { display: inline-block; width: 16px; height: 0; border-top: 2.5px solid var(--muted); }
.ln-swatch.ln-s0 { border-color: var(--accent); }
.ln-swatch.ln-s1 { border-color: #3b82f6; }
.ln-swatch.ln-s2 { border-color: var(--muted); }
.ln-swatch.ln-s3 { border-color: #a855f7; }
.ln-swatch.ln-dashed { border-top-style: dashed; }
.ln-swatch.ln-band-swatch { height: 10px; border: 0; border-radius: 2px; background: var(--accent); opacity: 0.25; }

/* === Shared chart card head === */
.chart-head, .bonds-chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; margin: 0 0 8px; }
.chart-head h3, .bonds-chart-head h3 { margin: 0; font: 600 15px/1.3 var(--font-sans); color: var(--text-strong); }
.chart-foot, .bonds-chart-foot { margin: 6px 0 0; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.chart-foot strong, .bonds-chart-foot strong { color: var(--text-strong); }

/* === Rates & the dollar === */
.bonds-charts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 24px; align-items: start; }
.bonds-charts .bonds-curve { margin: 0; padding: 0; border: 0; background: none; }
.bonds-charts .bonds-curve[hidden] + .bonds-history { grid-column: 1 / -1; }
@media (max-width: 1100px) { .bonds-charts { grid-template-columns: minmax(0, 1fr); } }
/* === Track Record equity curve === */
.acc-sum-equity { margin: 4px 0 20px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.acc-eq-chart { margin: 8px 0 4px; min-height: 120px; }
.acc-eq-chart-note { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
.acc-eq-change b { color: var(--text); font-weight: 600; }
/* === Historical Data event path === */
.h-path { margin: 16px 0 8px; }
.h-path figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 6px 16px; flex-wrap: wrap; margin: 0 0 6px; font-size: 13px; color: var(--muted); }
.h-path figcaption b { color: var(--text-strong); font-weight: 600; font-size: 14px; }
.h-path .ln-svg { max-width: 760px; }
/* === Earnings results: beat or miss scatter === */
.ers-scatter { margin: 20px 0; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.ers-scatter-plot .sc-svg { display: block; width: 100%; height: auto; margin: 0 auto; }
.ers-quads { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0 10px; }
.ers-quad { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--surface-2, var(--bg)); }
.ers-quad b { font: 600 18px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
.ers-quad span { font-size: 13px; color: var(--text); }
.ers-quad small { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
@media (max-width: 640px) { .ers-quads { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ers-quad { padding: 6px 8px; } .ers-quad b { font-size: 16px; } .ers-scatter { padding: 12px; } }
/* === Who owns what: buying and selling by manager === */
.f13mv { margin: 16px 0; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.f13mv-sub { margin: 0 0 10px; font-size: 13px; color: var(--muted); }
.f13mv-key { display: inline-flex; align-items: center; gap: 6px 12px; font-size: 12px; color: var(--muted); }
.f13mv-key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: -6px; }
.f13mv-key i.is-pos { background: var(--pos); }
.f13mv-key i.is-neg { background: var(--neg); }
.f13mv-rows { display: flex; flex-direction: column; gap: 4px; }
.f13mv-row { display: grid; grid-template-columns: minmax(120px, 210px) minmax(0, 1fr) 76px; align-items: center; gap: 10px; padding: 3px 4px; border-radius: 6px; }
.f13mv-row:hover { background: var(--surface-2, var(--bg)); }
.f13mv-name { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f13mv-track { display: grid; grid-template-columns: 1fr 1fr; height: 14px; }
.f13mv-half { position: relative; display: flex; }
.f13mv-sell { justify-content: flex-end; border-right: 1px solid var(--muted); }
.f13mv-half i { display: block; height: 100%; min-width: 1px; }
.f13mv-sell i { background: var(--neg); border-radius: 3px 0 0 3px; opacity: 0.85; }
.f13mv-buy i { background: var(--pos); border-radius: 0 3px 3px 0; opacity: 0.85; }
.f13mv-net { text-align: right; font: 600 13px var(--font-sans); font-variant-numeric: tabular-nums; color: var(--text); }
.f13mv-net.is-pos { color: var(--pos); }
.f13mv-net.is-neg { color: var(--neg); }
@media (max-width: 640px) {
  .f13mv { padding: 12px; }
  .f13mv-row { grid-template-columns: minmax(0, 1fr) 70px; gap: 2px 8px; }
  .f13mv-name { grid-column: 1 / -1; font-size: 12px; }
  .f13mv-track { grid-column: 1; }
}
/* === Market mood: gauge, year line, seven parts === */
.fng-overview { display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 24px; align-items: center; margin: 0 0 16px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.fng-ov-gauge { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.fng-ov-gauge .fng-rating { font-size: 20px; }
.fng-ov-gauge.fng-band-extreme-fear .fng-rating { color: var(--fng-extreme-fear); }
.fng-ov-gauge.fng-band-fear .fng-rating { color: var(--fng-fear); }
.fng-ov-gauge.fng-band-greed .fng-rating { color: var(--fng-greed); }
.fng-ov-gauge.fng-band-extreme-greed .fng-rating { color: var(--fng-extreme-greed); }
.fng-ov-source { font-size: 12px; color: var(--muted); }
.fng-ov-history { min-width: 0; }
.fng-ov-history .fng-spark { height: 170px; }
.fng-ov-history .fng-spark-wrap { padding: 0; border: 0; background: none; }
.fng-ov-history .fng-spark-plot { margin-right: 84px; }
.fng-ov-history .fng-spark-axis { margin-right: 84px; }
.fng-spark-ylab { position: absolute; left: calc(100% + 8px); transform: translateY(-50%); font-size: 11px; color: var(--muted); pointer-events: none; white-space: nowrap; }
.fng-ov-parts { margin: 0 0 16px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.fng-ov-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; }
.fng-ov-row { display: grid; grid-template-columns: minmax(130px, 170px) minmax(0, 1fr) 92px; align-items: center; gap: 10px; padding: 6px 6px; border: 0; border-radius: 6px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.fng-ov-row:hover, .fng-ov-row:focus-visible { background: var(--surface-2, var(--bg)); }
.fng-ov-name { font-size: 13px; }
.fng-ov-band { font-size: 12px; color: var(--muted); text-align: right; }
.fng-ov-row.fng-band-extreme-fear .fng-ov-band { color: var(--fng-extreme-fear); }
.fng-ov-row.fng-band-fear .fng-ov-band { color: var(--fng-fear); }
.fng-ov-row.fng-band-greed .fng-ov-band { color: var(--fng-greed); }
.fng-ov-row.fng-band-extreme-greed .fng-ov-band { color: var(--fng-extreme-greed); }
@media (max-width: 900px) {
  .fng-overview { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .fng-ov-rows { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .fng-overview, .fng-ov-parts { padding: 12px; }
  .fng-ov-row { grid-template-columns: minmax(0, 1fr) 84px; gap: 2px 8px; }
  .fng-ov-name { grid-column: 1 / -1; }
  .fng-ov-history .fng-spark { height: 140px; }
}
/* === Central-bank gold: quarterly net tonnes === */
.cbg-demand .cbg-chart-head { flex-wrap: wrap; gap: 8px 16px; }
.cbg-demand-svg2 { display: block; width: 100%; height: auto; margin: 10px 0 0; overflow: visible; }
.cbg-tick { fill: var(--muted); font: 500 11px var(--font-sans); font-variant-numeric: tabular-nums; }
.cbg-demand-bar.is-latest { fill: var(--accent-strong, #b8862b); opacity: 1; }
.cbg-avg { stroke: var(--text); stroke-width: 1.25; stroke-dasharray: 5 4; opacity: 0.55; }
.cbg-span { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; }
.cbg-span button { padding: 3px 10px; border: 0; border-radius: 6px; background: none; color: var(--muted); font: 600 12px var(--font-sans); cursor: pointer; }
.cbg-span button.is-active { background: var(--surface-2, var(--bg)); color: var(--text-strong); }
.cbg-key { display: inline-block; width: 12px; vertical-align: middle; margin: 0 6px 0 0; }
.cbg-key-latest { height: 10px; border-radius: 2px; background: var(--accent-strong, #b8862b); }
.cbg-key-avg { height: 0; border-top: 1.5px dashed var(--text); opacity: 0.6; margin-left: 8px; }
/* === Grade score over time (Owner Grade page) === */
.ogh-zone-lbl { font: 600 11px var(--font-sans); opacity: 0.8; }
.ogh-zone-lbl.call { fill: var(--pos); }
.ogh-zone-lbl.put { fill: var(--neg); }
.ogh-head .ogh-span { margin-left: auto; }
.opt-price-host { margin: 12px 0; }
.opt-price-host .opt-tech-chart { margin-bottom: 0; }
`;
}
