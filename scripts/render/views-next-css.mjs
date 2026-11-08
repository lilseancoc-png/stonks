// Styles for the 2026-11-07 "new ways to see the data" pass: Market map,
// What changed, Past days, option volume by expiry, the Fed liquidity line,
// the stock page additions and the Owner panels. Loaded last in
// styles-css.mjs.
export function renderViewsNextCss() {
  return `
/* ---- Shared ---------------------------------------------------------------- */
.vn-tabs { margin-bottom: 12px; }
.vn-sym { font: 650 12.5px/1.3 var(--font-mono); color: var(--text-strong); text-decoration: none; }
.vn-sym:hover { color: var(--accent); text-decoration: underline; }
.vn-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; margin: 8px 0 0; padding: 0; font: 500 12px/1.4 var(--font-sans); color: var(--muted-strong); }
.vn-legend li { display: inline-flex; align-items: center; gap: 6px; }
.vn-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.vn-g0 { --vn-c: #3b82f6; } .vn-g1 { --vn-c: #a855f7; } .vn-g2 { --vn-c: #14b8a6; } .vn-g3 { --vn-c: #eab308; }
.vn-g4 { --vn-c: #f97316; } .vn-g5 { --vn-c: #ec4899; } .vn-g6 { --vn-c: #84cc16; } .vn-g7 { --vn-c: #94a3b8; } .vn-g8 { --vn-c: #64748b; }
.vn-dot[class*="vn-g"] { background: var(--vn-c); }
.sc-dot[class*="vn-g"] { fill: var(--vn-c); }
.mm-empty, .wc-empty, .pd-empty, .zdte-empty { color: var(--muted); font: 500 13px/1.5 var(--font-sans); padding: 12px 0; }
.mm-lede, .wc-lede, .zdte-lede { margin: 0 0 10px; color: var(--muted-strong); font: 500 13.5px/1.55 var(--font-sans); max-width: 78ch; }
.mm-note, .zdte-note { margin: 8px 0 0; color: var(--muted); font: 500 12px/1.5 var(--font-sans); max-width: 90ch; }
.mm-dim { color: var(--muted); font-size: 12px; }
.mm-h3 { margin: 18px 0 8px; font: 650 14.5px/1.3 var(--font-sans); color: var(--text-strong); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mm-owner-tag { display: inline-block; padding: 1px 7px; border-radius: var(--r-pill, 999px); font: 650 10.5px/1.5 var(--font-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft, rgba(212,160,23,.14)); }
.mm-tools { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-bottom: 10px; font: 500 12.5px/1.3 var(--font-sans); color: var(--muted-strong); }
.mm-tools label { display: inline-flex; align-items: center; gap: 6px; }
.mm-tools select { max-width: 240px; }
.mm-check input { margin: 0; }
.mm-chart { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 6px; min-width: 0; }
.mm-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 4px 0 12px; }
.mm-kpi { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; background: var(--surface); display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mm-kpi span { font: 500 11.5px/1.3 var(--font-sans); color: var(--muted); }
.mm-kpi b { font: 650 17px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.mm-ck { min-height: 160px; }
.mm-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font: 600 10.5px/1.5 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); }
.mm-kv { font: 500 11.5px/1.3 var(--font-mono); color: var(--muted-strong); margin-left: 6px; }
.mm-callout { padding: 8px 12px; border-left: 3px solid var(--neg); background: color-mix(in srgb, var(--neg) 7%, transparent); border-radius: 6px; font: 500 13px/1.5 var(--font-sans); }

/* ---- Fear map ---------------------------------------------------------------- */
.mm-quads { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 6px; font: 500 12px/1.4 var(--font-sans); color: var(--muted-strong); }
.mm-fear-list { margin: 0; padding-left: 22px; display: grid; gap: 4px; font: 500 13px/1.5 var(--font-sans); }

/* ---- Chart wall -------------------------------------------------------------- */
.mm-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
.mm-wall-card { display: flex; flex-direction: column; gap: 4px; padding: 8px 9px 7px; border: 1px solid var(--border); border-left: 3px solid var(--vn-c, var(--border)); border-radius: 8px; background: var(--surface); color: inherit; text-decoration: none; min-width: 0; }
.mm-wall-card:hover { border-color: var(--accent); }
.mm-wall-card .row-spark { width: 100%; height: 34px; }
.mm-wall-top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font: 650 12.5px/1.2 var(--font-mono); }
.mm-wall-top span { font-size: 11.5px; }
.mm-wall-sub { font: 500 10.5px/1.3 var(--font-sans); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vn-gb0 { --vn-c: #3b82f6; } .vn-gb1 { --vn-c: #a855f7; } .vn-gb2 { --vn-c: #14b8a6; } .vn-gb3 { --vn-c: #eab308; }
.vn-gb4 { --vn-c: #f97316; } .vn-gb5 { --vn-c: #ec4899; } .vn-gb6 { --vn-c: #84cc16; } .vn-gb7 { --vn-c: #94a3b8; } .vn-gb8 { --vn-c: #64748b; }

/* ---- Crowding ---------------------------------------------------------------- */
.mm-corr-wrap { position: relative; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 8px; }
.mm-corr-svg { display: block; width: 100%; height: auto; }
.mm-corr-lbl { fill: var(--muted-strong); font-family: var(--font-mono); }
.mm-corr-lbl.is-open { fill: var(--accent); font-weight: 700; }
.mm-corr-open { fill: none; stroke: var(--accent); stroke-width: 1; pointer-events: none; }
.mm-corr-tip { position: absolute; z-index: 5; pointer-events: none; padding: 4px 8px; border-radius: 6px; background: var(--surface-3, #222); color: var(--text-strong); font: 600 12px/1.3 var(--font-mono); box-shadow: 0 4px 14px rgba(0,0,0,.3); white-space: nowrap; }
.mm-clusters, .mm-pairs { margin: 0; padding-left: 18px; display: grid; gap: 5px; font: 500 13px/1.5 var(--font-sans); }
.mm-owner, .pd-owner { margin-top: 18px; padding: 12px 14px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: color-mix(in srgb, var(--accent) 4%, transparent); }
.mm-owner .mm-h3, .pd-owner .mm-h3 { margin-top: 0; }

/* ---- Option volume by expiry ------------------------------------------------- */
.zdte-card { margin-top: 16px; }
.zdte-bar { display: flex; height: 16px; border-radius: 999px; overflow: hidden; background: var(--surface-2); }
.zdte-seg { display: inline-block; height: 100%; }
.zdte-keys .zdte-seg { width: 10px; height: 10px; border-radius: 2px; }
.zdte-s0 { background: var(--neg); } .zdte-s1 { background: #f97316; } .zdte-s2 { background: #3b82f6; } .zdte-s3 { background: var(--muted); }
.zdte-keys { display: flex; flex-wrap: wrap; gap: 4px 16px; list-style: none; padding: 0; margin: 8px 0 0; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.zdte-keys li { display: inline-flex; align-items: center; gap: 6px; }
.zdte-keys b { font-family: var(--font-mono); color: var(--text-strong); }

/* ---- What changed ------------------------------------------------------------- */
.wc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 6px; }
.wc-chip { appearance: none; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-strong); padding: 5px 11px; font: 600 12px/1.2 var(--font-sans); cursor: pointer; }
.wc-chip b { font-family: var(--font-mono); margin-left: 4px; color: var(--text-strong); }
.wc-chip.is-on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft, transparent); }
.wc-count { font: 600 11.5px/1 var(--font-mono); color: var(--muted); }
.wc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.wc-item { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: baseline; padding: 6px 8px; border-left: 3px solid var(--border); border-radius: 4px; font: 500 13px/1.45 var(--font-sans); }
.wc-item.is-up { border-left-color: var(--pos); }
.wc-item.is-down { border-left-color: var(--neg); }
.wc-item:nth-child(odd) { background: color-mix(in srgb, var(--surface-2) 45%, transparent); }
.wc-sec.is-owner { padding: 0 10px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; margin-top: 14px; }
.wc-more { margin-top: 6px; appearance: none; border: 0; background: none; color: var(--accent); font: 600 12.5px/1.3 var(--font-sans); cursor: pointer; padding: 4px 0; }

/* ---- Past days ---------------------------------------------------------------- */
.pd-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.pd-pick select { min-width: 220px; }
.pd-step { appearance: none; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-strong); font: 600 18px/1 var(--font-sans); cursor: pointer; }
.pd-step:disabled { opacity: .4; cursor: default; }
.pd-latest { appearance: none; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-strong); padding: 6px 12px; font: 600 12px/1 var(--font-sans); cursor: pointer; }
.pd-map { position: relative; width: 100%; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); margin: 6px 0 12px; }
.pd-tile { text-decoration: none; }
.pd-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 20px; }
.pd-movers { margin: 0; padding-left: 22px; display: grid; gap: 3px; font: 500 13px/1.5 var(--font-sans); }
.pd-h4 { margin: 12px 0 6px; font: 650 13px/1.3 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; }
.pd-briefs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pd-briefs li { padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
.pd-briefs b { display: block; font: 650 13.5px/1.4 var(--font-sans); color: var(--text-strong); }
.pd-briefs p { margin: 4px 0 0; color: var(--muted-strong); font: 500 13px/1.5 var(--font-sans); }
.pd-brief-when { display: block; font: 500 11px/1.3 var(--font-mono); color: var(--muted); margin-bottom: 2px; }
.pd-run { font: 500 13px/1.6 var(--font-sans); padding: 3px 0; }
.pd-trades { margin: 0; padding-left: 18px; display: grid; gap: 3px; font: 500 13px/1.5 var(--font-sans); }

/* ---- Fed liquidity (Rates & the dollar) ---------------------------------------- */
.bonds-liquidity { margin-top: 16px; }
.bonds-charts .bonds-liquidity { grid-column: 1 / -1; }
.bonds-volcurve { margin-top: 16px; }
.bonds-charts .bonds-volcurve { grid-column: 1 / -1; }
.bonds-read { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font: 650 11px/1.6 var(--font-sans); letter-spacing: .02em; color: var(--muted-strong); background: color-mix(in srgb, var(--muted) 16%, transparent); vertical-align: middle; }
.bonds-read-weak { color: var(--neg); background: color-mix(in srgb, var(--neg) 14%, transparent); }
.bonds-read-strong { color: var(--pos); background: color-mix(in srgb, var(--pos) 14%, transparent); }
.bonds-read-collecting { color: var(--muted); }
.bonds-auction-head { margin: 0 0 10px; font: 500 14px/1.5 var(--font-sans); color: var(--text); }
.bonds-auction-chart { margin-top: 12px; }
.liq-now { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; margin: 2px 0 8px; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.liq-now b { font: 650 18px/1.2 var(--font-mono); color: var(--text-strong); }
.liq-chg { font: 600 12px/1.3 var(--font-mono); padding: 1px 7px; border-radius: 999px; background: var(--surface-2); }
.liq-chg.pos { color: var(--pos); } .liq-chg.neg { color: var(--neg); }


/* ---- Stock page: cone, report minis, chain grid, timeline ---------------------- */
.stp-chart-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.stp-cone-btn[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
.stp-em-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 10px; }
.stp-em { margin: 0; padding: 8px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); min-width: 0; }
.stp-em figcaption { display: flex; justify-content: space-between; align-items: center; gap: 6px; font: 600 12px/1.3 var(--font-sans); color: var(--text-strong); }
.stp-em-svg { display: block; width: 100%; height: auto; margin: 4px 0; overflow: visible; }
.stp-em-svg polyline { stroke-width: 1.8; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.stp-em-svg polyline.is-up { stroke: var(--pos); } .stp-em-svg polyline.is-down { stroke: var(--neg); }
.stp-em-band { fill: var(--accent); fill-opacity: .12; }
.stp-em-zero { stroke: var(--border-strong, var(--border)); stroke-width: 1; }
.stp-em-day { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 3; }
.stp-em-tag { padding: 1px 6px; border-radius: 999px; font: 650 10.5px/1.5 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); }
.stp-em-tag.is-up { color: var(--pos); background: color-mix(in srgb, var(--pos) 12%, transparent); }
.stp-em-tag.is-down { color: var(--neg); background: color-mix(in srgb, var(--neg) 12%, transparent); }
.stp-em-foot { margin: 0; font: 500 11.5px/1.45 var(--font-sans); color: var(--muted-strong); }
.stp-grid-tools { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.stp-grid-tools span { display: inline-flex; gap: 4px; }
.stp-grid { border-collapse: collapse; width: 100%; font: 500 11.5px/1.2 var(--font-mono); font-variant-numeric: tabular-nums; }
.stp-grid th, .stp-grid td { padding: 4px 6px; border: 1px solid var(--border); text-align: right; white-space: nowrap; }
.stp-grid thead th { color: var(--muted-strong); background: var(--surface-2); font-weight: 600; }
.stp-grid tbody th { color: var(--text-strong); background: var(--surface); }
.stp-grid td { background: color-mix(in srgb, var(--accent) calc(var(--g, 0) * 85%), var(--surface)); color: var(--text-strong); }
.stp-grid tr.is-spot th, .stp-grid tr.is-spot td { border-bottom: 2px solid var(--text-strong); }
.stp-story-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.stp-story-chip { appearance: none; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; background: var(--surface); color: var(--muted); font: 600 12px/1.2 var(--font-sans); cursor: pointer; opacity: .6; }
.stp-story-chip.is-on { opacity: 1; color: var(--text-strong); }
.stp-story-chip i { font: 700 10.5px/1 var(--font-mono); font-style: normal; color: var(--accent); }
.stp-story-chip b { font-family: var(--font-mono); color: var(--muted-strong); }
.stp-story-chip small { font: 650 9.5px/1 var(--font-mono); text-transform: uppercase; color: var(--accent); }
.stp-story-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 2px; }
.stp-story-item { display: grid; grid-template-columns: 96px 1fr; gap: 10px; padding: 6px 8px; border-left: 3px solid var(--border); font: 500 13px/1.45 var(--font-sans); }
.stp-story-item.is-up { border-left-color: var(--pos); } .stp-story-item.is-down { border-left-color: var(--neg); }
.stp-story-item.is-owner { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.stp-story-date { font: 500 12px/1.45 var(--font-mono); color: var(--muted); }

/* Owner track record: grade calibration, gate verdicts, book risk. */
.acc-cal-wrap { margin: 6px 0 4px; }
.acc-cal-svg { display: block; width: 100%; max-width: 640px; height: auto; overflow: visible; }
.acc-cal-n { opacity: .75; }
.acc-cal-err { stroke: var(--muted-strong); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.acc-cal-dot { stroke: var(--surface); stroke-width: 2; }
.acc-cal-dot.is-up { fill: var(--pos); } .acc-cal-dot.is-down { fill: var(--neg); }
.acc-gate-verdict { white-space: nowrap; }
.acc-gate-verdict small { color: var(--muted); }
.book-risk .mm-kpis { margin-top: 2px; }
.book-table td { vertical-align: middle; }
.book-table td.num { white-space: nowrap; }
.book-ev { white-space: nowrap; }
.book-table td small { color: var(--muted); font-family: var(--font-mono); }
.book-pos { white-space: nowrap; display: inline-flex; align-items: baseline; gap: 4px; margin: 1px 2px 1px 0; padding: 1px 7px; border-radius: 999px; font: 650 11.5px/1.5 var(--font-mono); border: 1px solid var(--border); }
.book-pos.is-call { color: var(--pos); background: color-mix(in srgb, var(--pos) 10%, transparent); }
.book-pos.is-put { color: var(--neg); background: color-mix(in srgb, var(--neg) 10%, transparent); }
.book-pos small { color: var(--warn, var(--accent)); font-weight: 600; }

/* Owner trade journal. */
.acc-notes { display: grid; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.acc-note { font: 500 12.5px/1.45 var(--font-sans); color: var(--text); min-width: 0; }
.acc-note-add { font-size: 12.5px; }
.acc-note-label { display: block; font: 650 11px/1.4 var(--font-sans); text-transform: uppercase; letter-spacing: .04em; color: var(--muted-strong); margin-bottom: 3px; }
.acc-note-view .acc-note-label { display: inline; margin-right: 6px; }
.acc-note-body { margin: 4px 0; white-space: normal; overflow-wrap: anywhere; color: var(--text-strong); }
.acc-note-meta { font-size: 11.5px; color: var(--muted); }
.acc-note-chip { display: inline-block; margin: 0 4px 2px 0; padding: 0 7px; border-radius: 999px; font: 600 11px/1.6 var(--font-sans); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.acc-note-text { display: block; width: 100%; box-sizing: border-box; min-height: 64px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-strong); font: 500 13px/1.45 var(--font-sans); resize: vertical; text-transform: none; letter-spacing: 0; }
.acc-note-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.acc-note-tag { appearance: none; border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; background: var(--surface); color: var(--muted-strong); font: 600 11.5px/1.4 var(--font-sans); cursor: pointer; }
.acc-note-tag.is-on { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.acc-note-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.stp-note-cell { min-width: 180px; max-width: 360px; white-space: normal !important; text-align: left !important; }
.acc-note-flag { color: var(--accent); font-size: 12px; }
.vt-detail .acc-notes { white-space: normal; text-align: left; padding: 6px 12px; }

@media (max-width: 640px) {
  .book-table .vt-cbar { display: none; }
  .book-table th, .book-table td { padding-left: 6px; padding-right: 6px; }
  .wc-item { grid-template-columns: 54px 1fr; }
  .mm-wall { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  .pd-map { height: 340px !important; }
  .stp-story-item { grid-template-columns: 76px 1fr; }
}
`;
}
