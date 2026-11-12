// Styles for history-rhymes-client.mjs (2026-11-12): the "Booms & busts" page
// and its Risk analysis context card. Reuses the mm-* KPI tiles
// (views-next-css.mjs), the ln-* chart classes (charts-css.mjs) and the vt-*
// tables; loaded after them in styles-css.mjs.
export function renderHistoryRhymesCss() {
  return `
/* ---- Booms & busts ------------------------------------------------------- */
.hr-body { display: grid; gap: 12px; margin-top: 10px; min-width: 0; }
.hr-empty { margin: 4px 0 8px; font: 450 13px/1.5 var(--font-sans); color: var(--muted); }
.hr-dim { color: var(--muted); font-weight: 500; }
.hr-warn { color: var(--warn); }
.hr-kicker { display: block; font: 600 11px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.hr-h3 { margin: 14px 0 2px; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.hr-h4 { margin: 12px 0 4px; font: 650 13px/1.3 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; }
.hr-lede { margin: 0 0 6px; font: 450 13.5px/1.55 var(--font-sans); color: var(--muted-strong); max-width: 76ch; }
.hr-note { margin: 4px 0 0; font: 450 12px/1.5 var(--font-sans); color: var(--muted); max-width: 80ch; }
.hr-src { font: 500 11.5px/1.4 var(--font-sans); color: var(--accent, var(--muted-strong)); white-space: nowrap; }
.hr-linkbtn { background: none; border: 0; padding: 0; font: inherit; color: var(--accent, var(--text)); text-decoration: underline; cursor: pointer; }
.hr-hero { display: grid; gap: 10px; padding: 12px 14px; border: 1px solid var(--border); border-left: 4px solid var(--hr-tone, var(--muted)); border-radius: 12px; background: var(--surface); }
.hr-hero.is-early { --hr-tone: var(--pos); }
.hr-hero.is-boom { --hr-tone: #3b82f6; }
.hr-hero.is-late { --hr-tone: var(--warn); }
.hr-hero.is-bust { --hr-tone: var(--neg); }
.hr-hero-lead p { margin: 2px 0 0; font: 450 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-stage { display: block; margin-top: 2px; font: 700 20px/1.25 var(--font-sans); color: var(--hr-tone, var(--text-strong)); }
.hr-hero .mm-kpis { margin: 0; }
.hr-hero .mm-kpi b small { display: block; margin-top: 2px; font: 500 12px/1.4 var(--font-sans); color: var(--muted); }
.hr-signs { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.hr-sign { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 0; }
.hr-sign.is-lit { border-color: color-mix(in srgb, var(--neg) 45%, var(--border)); }
.hr-sign.is-partial { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); }
.hr-sign header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hr-sign h4 { margin: 0; font: 650 13.5px/1.35 var(--font-sans); color: var(--text-strong); }
.hr-now { margin: 6px 0 4px; font: 450 12.5px/1.5 var(--font-sans); color: var(--text); }
.hr-seen { margin: 0 0 4px; font: 500 11.5px/1.6 var(--font-sans); color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.hr-sign details summary { cursor: pointer; font: 600 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-sign details p { margin: 4px 0 0; font: 450 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font: 650 10.5px/1.6 var(--font-sans); border: 1px solid var(--border); background: var(--surface-2); color: var(--muted-strong); white-space: nowrap; }
.hr-pill.is-lit { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 45%, var(--border)); background: color-mix(in srgb, var(--neg) 10%, var(--surface)); }
.hr-pill.is-partial { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); background: color-mix(in srgb, var(--warn) 10%, var(--surface)); }
.hr-pill.is-clear { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 40%, var(--border)); }
.hr-pill.is-unknown { color: var(--muted); }
.hr-case-chip { display: inline-block; padding: 0 7px; border-radius: 999px; font: 600 10.5px/1.6 var(--font-sans); background: var(--surface-2); color: var(--muted-strong); border: 1px solid var(--border); }
.hr-matches { display: grid; gap: 6px; max-width: 640px; }
.hr-match-row { display: grid; grid-template-columns: minmax(120px, 200px) 1fr 64px; gap: 10px; align-items: center; font: 500 13px/1.4 var(--font-sans); }
.hr-match-name { color: var(--text); }
.hr-bar { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
.hr-bar i { display: block; height: 100%; border-radius: 5px; background: var(--accent, var(--pos)); }
.hr-match-val { text-align: right; font: 600 12px/1.4 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--muted-strong); }
.hr-chart { margin: 6px 0 2px; min-width: 0; max-width: 900px; }
.hr-svg { width: 100%; height: auto; display: block; overflow: visible; }
.hr-mark { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: .8; }
.hr-mark-lbl { fill: var(--muted); font: 500 10.5px var(--font-sans); }
.hr-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 4px 0 0; font: 500 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-legend span { display: inline-flex; align-items: center; gap: 6px; }
.hr-sw { display: inline-block; width: 16px; height: 3px; border-radius: 2px; background: var(--accent); }
.hr-sw.ln-s1 { background: #3b82f6; }
.hr-sw.ln-s2 { background: var(--muted); }
.hr-sw.ln-s3 { background: #a855f7; }
.hr-sw.is-dashed { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px); }
.hr-case { display: grid; gap: 8px; min-width: 0; }
.hr-era { margin: 0; font: 600 12px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.hr-story p { margin: 0 0 8px; font: 450 14px/1.6 var(--font-sans); color: var(--text); max-width: 76ch; }
.hr-numbers { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.hr-num { padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hr-num b { font: 700 16px/1.3 var(--font-sans); color: var(--text-strong); font-variant-numeric: tabular-nums; }
.hr-num span { font: 500 12px/1.4 var(--font-sans); color: var(--muted-strong); }
.hr-num small { font: 500 11px/1.4 var(--font-sans); color: var(--muted); }
.hr-compare { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
.hr-rhyme, .hr-differs, .hr-callout { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); }
.hr-rhyme { border-left: 3px solid var(--warn); }
.hr-differs { border-left: 3px solid #3b82f6; }
.hr-rhyme h4, .hr-differs h4, .hr-callout h4 { margin: 0 0 4px; font: 650 13px/1.35 var(--font-sans); color: var(--text-strong); }
.hr-rhyme p, .hr-differs p, .hr-callout p { margin: 0; font: 450 13px/1.55 var(--font-sans); color: var(--text); }
.hr-callout .hr-numbers { margin-top: 8px; }
.hr-callout .hr-note { margin-top: 6px; }
.hr-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; border-left: 2px solid var(--border); }
.hr-timeline li { display: grid; grid-template-columns: 92px 1fr; gap: 10px; padding: 2px 0 2px 10px; font: 450 13px/1.5 var(--font-sans); }
.hr-timeline time { font: 600 12px/1.6 var(--font-mono); color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.hr-sources-line { margin: 6px 0 0; font: 450 12px/1.6 var(--font-sans); color: var(--muted); }
.hr-sources-line .hr-src { white-space: normal; }
.hr-table-wrap { overflow-x: auto; max-width: 100%; }
.hr-table { border-collapse: collapse; width: 100%; font: 450 13px/1.45 var(--font-sans); }
.hr-table th { text-align: left; font: 600 11.5px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .03em; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.hr-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.hr-table td.hr-numcell { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 650; }
.hr-flags { display: inline-flex; flex-wrap: wrap; gap: 3px; }
.hr-detail { display: grid; gap: 6px; padding: 4px 0; white-space: normal; max-width: min(900px, 80vw); }
.hr-detail-cds { margin: 0; padding-left: 18px; display: grid; gap: 2px; font: 450 12.5px/1.5 var(--font-sans); color: var(--muted-strong); max-width: 90ch; }
.hr-flag { display: inline-block; padding: 0 6px; border-radius: 999px; font: 600 10.5px/1.6 var(--font-sans); background: color-mix(in srgb, var(--warn) 10%, var(--surface)); color: var(--muted-strong); border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); }
.hr-method { margin-top: 8px; }
.hr-method summary { cursor: pointer; font: 600 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-method ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; font: 450 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
.hr-roles { margin: 6px 0 0; display: grid; gap: 2px 0; }
.hr-roles dt { font: 650 13px/1.4 var(--font-sans); color: var(--text-strong); margin-top: 6px; }
.hr-roles dd { margin: 0; font: 450 12.5px/1.5 var(--font-sans); color: var(--muted-strong); }
/* Risk analysis context card (not a voting desk) */
#risk-rhymes { margin-top: 12px; }
.hr-risk { padding: 10px 12px; border: 1px dashed var(--border); border-radius: 10px; background: var(--surface-2); display: grid; gap: 4px; }
.hr-risk p { margin: 0; font: 450 13px/1.5 var(--font-sans); color: var(--text); }
.hr-risk .book-more { justify-self: start; }
@media (max-width: 640px) {
  .hr-match-row { grid-template-columns: minmax(90px, 130px) 1fr 52px; gap: 6px; }
  .hr-timeline li { grid-template-columns: 80px 1fr; gap: 6px; }
  .hr-stage { font-size: 18px; }
  .hr-signs { grid-template-columns: 1fr; }
}
`;
}
