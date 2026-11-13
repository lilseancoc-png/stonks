// Styles for the stock page's Leadership tab (leadership-client.mjs). Colors
// come from the site tokens, so light and dark themes both work; every view
// fits a 360px phone without sideways scrolling (wide tables scroll inside
// their own box, like the rest of the stock page).
export function renderLeadershipCss() {
  return `
/* === Stock page: Leadership tab (scripts/render/leadership-client.mjs) === */
.ld-root { display: grid; gap: 16px; min-width: 0; }
.ld-root .k-exec { --ld-k: var(--accent); }
.ld-root .k-indep { --ld-k: var(--info); }
.ld-root .k-affil { --ld-k: var(--violet); }
.ld-root .k-dir { --ld-k: var(--muted-strong, var(--muted)); }
.ld-root .k-holder { --ld-k: var(--warn); }
.ld-note { margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px; background: var(--warn-tint, var(--surface-2)); color: var(--text); font-size: 13px; }
.stp-link { appearance: none; border: 0; background: none; padding: 0; color: var(--text-strong); font: inherit; border-bottom: 1px solid var(--border); cursor: pointer; }
.stp-link:hover { color: var(--accent); border-bottom-color: var(--accent); }

/* Header: who controls it */
.ld-control { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; padding: 16px; border: 1px solid var(--border); border-left: 4px solid var(--ld-tone, var(--accent)); border-radius: 12px; background: var(--surface); }
.ld-control.is-neg { --ld-tone: var(--neg); }
.ld-control.is-warn { --ld-tone: var(--warn); }
.ld-control.is-pos { --ld-tone: var(--pos); }
.ld-control-main { display: grid; gap: 6px; align-content: start; min-width: 0; }
.ld-pill { justify-self: start; padding: 3px 9px; border-radius: 999px; font: 700 11px/1.4 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; color: var(--ld-tone, var(--accent)); background: color-mix(in srgb, var(--ld-tone, var(--accent)) 14%, transparent); }
.ld-control-line { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-strong); line-height: 1.35; }
.ld-control-sub { margin: 0; font-size: 13px; color: var(--muted); }
.ld-control-quote { margin: 0; font-size: 13px; color: var(--text); font-style: italic; }
.ld-control-warn { margin: 4px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--warn-tint, var(--surface-2)); color: var(--text); font-size: 13px; }
.ld-control-warn a { color: var(--text-strong); }
.ld-kpis { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; align-content: start; }
.ld-kpis div { min-width: 0; }
.ld-kpis dt { font-size: 12px; color: var(--muted); }
.ld-kpis dd { margin: 2px 0 0; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ld-plink { appearance: none; border: 0; background: none; padding: 0; font: inherit; color: var(--text-strong); border-bottom: 1px dotted var(--border-strong); cursor: pointer; text-align: left; }
.ld-plink:hover, .ld-plink:focus-visible { color: var(--accent); border-bottom-color: var(--accent); outline: none; }
.ld-plink.is-chair { font-weight: 700; }

/* View switch */
.ld-views { display: flex; gap: 4px; flex-wrap: wrap; padding: 3px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ld-view { appearance: none; border: 0; background: transparent; color: var(--muted); font: 600 13px/1 var(--font-sans); padding: 8px 11px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
.ld-view:hover { color: var(--text-strong); }
.ld-view.is-on { background: var(--surface-2); color: var(--text-strong); box-shadow: inset 0 0 0 1px var(--border); }
.ld-view:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-body { display: grid; gap: 16px; min-width: 0; }
.ld-group { display: grid; gap: 10px; min-width: 0; }
.ld-h4 { margin: 4px 0 0; font-size: 15px; font-weight: 650; color: var(--text-strong); }
.ld-h4 small { font-weight: 500; color: var(--muted); font-size: 12px; margin-left: 6px; }

/* 1. People cards */
.ld-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.ld-card { appearance: none; display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; align-items: start; text-align: left; padding: 12px; border: 1px solid var(--border); border-top: 3px solid var(--ld-k, var(--border)); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; cursor: pointer; min-width: 0; }
.ld-card:hover { border-color: var(--border-strong); border-top-color: var(--ld-k, var(--border-strong)); }
.ld-card:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-card.is-sel { box-shadow: 0 0 0 2px var(--ld-k, var(--accent)); }
.ld-avatar { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; font: 700 14px/1 var(--font-sans); color: var(--ld-k, var(--accent)); background: color-mix(in srgb, var(--ld-k, var(--accent)) 14%, var(--surface)); border: 1px solid color-mix(in srgb, var(--ld-k, var(--accent)) 35%, transparent); }
.ld-avatar.is-lg { width: 52px; height: 52px; font-size: 18px; }
.ld-card-main { display: grid; gap: 4px; min-width: 0; }
.ld-card-name { color: var(--text-strong); font-size: 15px; overflow-wrap: anywhere; }
.ld-card-role { color: var(--muted); font-size: 13px; line-height: 1.3; overflow-wrap: anywhere; }
.ld-badges { display: flex; gap: 4px; flex-wrap: wrap; }
.ld-badge { padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); }
.ld-badge.is-accent { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.ld-badge.is-info { color: var(--info); background: color-mix(in srgb, var(--info) 12%, transparent); border-color: color-mix(in srgb, var(--info) 30%, transparent); }
.ld-badge.is-violet { color: var(--violet); background: color-mix(in srgb, var(--violet) 12%, transparent); border-color: color-mix(in srgb, var(--violet) 30%, transparent); }
.ld-badge.is-warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
.ld-card-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 4px; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums; font-size: 14px; }
.ld-card-stats small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); }
.ld-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.ld-chip { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; padding: 2px 7px; border-radius: 6px; font-size: 12px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-chip small { color: var(--muted); font-size: 11px; }
.ld-chip.is-covered { border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
a.ld-chip.is-covered:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ld-chip.is-more { color: var(--muted); }

/* 2. Org chart */
.ld-org { display: grid; gap: 0; justify-items: center; min-width: 0; }
.ld-org-tier { width: 100%; display: grid; gap: 10px; justify-items: center; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.ld-org-board { background: color-mix(in srgb, var(--info) 5%, var(--surface)); }
.ld-org-label { font-size: 12px; color: var(--muted); text-align: center; }
.ld-org-title { font-weight: 650; color: var(--text-strong); text-align: center; }
.ld-org-title small { font-weight: 500; color: var(--muted); margin-left: 6px; }
.ld-org-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; width: 100%; }
.ld-org-link { width: 2px; height: 22px; background: var(--border-strong); }
.ld-node { appearance: none; display: grid; gap: 2px; justify-items: center; text-align: center; min-width: 128px; max-width: 190px; padding: 8px 10px; border: 1px solid var(--border); border-bottom: 3px solid var(--ld-k, var(--border)); border-radius: 9px; background: var(--surface); color: var(--text); font: inherit; cursor: pointer; }
.ld-node b { color: var(--text-strong); font-size: 13px; overflow-wrap: anywhere; }
.ld-node span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.ld-node small { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ld-node.is-chair { box-shadow: inset 0 0 0 1px var(--accent); }
.ld-node.is-ceo { min-width: 200px; border-width: 2px; border-color: var(--accent); }
.ld-node.is-sel { box-shadow: 0 0 0 2px var(--ld-k, var(--accent)); }
.ld-node:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-org-comms { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; width: 100%; margin-top: 4px; }
.ld-comm { display: grid; gap: 3px; padding: 8px 10px; border: 1px dashed var(--border); border-radius: 8px; font-size: 13px; min-width: 0; }
.ld-comm b { color: var(--text-strong); font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
.ld-comm small { color: var(--muted); }

/* 3. Connections web */
.ld-inter { margin: 0; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--muted); }
.ld-web-wrap { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 8px; min-width: 0; }
.ld-web { display: block; width: 100%; max-width: 980px; height: auto; margin: 0 auto; }
.ld-w-spoke { stroke: var(--border); stroke-width: 1.5; }
.ld-w-edge { stroke: color-mix(in srgb, var(--muted) 55%, transparent); stroke-width: 1.4; }
.ld-w-edge.is-covered { stroke: var(--accent); stroke-width: 2.2; }
.ld-w-center { fill: color-mix(in srgb, var(--accent) 14%, var(--surface)); stroke: var(--accent); stroke-width: 2; }
.ld-w-center-t { fill: var(--text-strong); font: 700 30px/1 var(--font-sans); }
.ld-w-center-s { fill: var(--muted); font: 500 15px/1 var(--font-sans); }
.ld-w-co { fill: var(--surface-2); stroke: var(--muted); stroke-width: 1.5; }
.ld-w-co.is-covered { fill: color-mix(in srgb, var(--accent) 20%, var(--surface)); stroke: var(--accent); }
.ld-w-co-t { fill: var(--text); font: 500 17px/1 var(--font-sans); }
.ld-w-co-t, .ld-w-p text { paint-order: stroke; stroke: var(--surface); stroke-width: 6px; stroke-linejoin: round; }
.ld-yrs { font-style: normal; font-size: 0.78em; font-weight: 500; color: var(--muted); }
.ld-w-link { cursor: pointer; }
.ld-w-link:hover .ld-w-co-t, .ld-w-link:focus .ld-w-co-t { fill: var(--accent); text-decoration: underline; }
.ld-w-p { cursor: pointer; }
.ld-w-p circle { fill: color-mix(in srgb, var(--ld-k) 22%, var(--surface)); stroke: var(--ld-k); stroke-width: 2; }
.ld-w-p text { fill: var(--text-strong); font: 600 17px/1 var(--font-sans); }
.ld-w-p.is-sel circle, .ld-w-p:hover circle, .ld-w-p:focus circle { stroke-width: 4; }
.ld-w-p:focus { outline: none; }
.ld-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.ld-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ld-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 999px; background: var(--ld-k, var(--muted)); }
.ld-legend i.is-covered { background: var(--accent); border-radius: 2px; }
.ld-legend i.t-company { width: 16px; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 35%, transparent); }
.ld-legend i.t-board { width: 16px; height: 6px; border-radius: 3px; background: var(--info); }
.ld-legend i.t-insider { width: 16px; height: 6px; border-radius: 3px; background: var(--accent); }
.ld-legend i.t-insider.is-approx { background: repeating-linear-gradient(90deg, var(--accent) 0 4px, transparent 4px 7px); }
.ld-legend i.t-mark { width: 3px; height: 12px; border-radius: 1px; background: var(--text-strong); }
.ld-where { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.ld-where li { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 4px 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 13px; }
.ld-where li b { color: var(--text-strong); overflow-wrap: anywhere; }
.ld-where li b a { color: var(--accent); text-decoration: none; }
.ld-where small { color: var(--muted); font-weight: 500; }

/* 4. Votes and stakes */
.ld-stack { display: flex; height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2); }
.ld-seg { height: 100%; min-width: 2px; }
.ld-seg.s0, .ld-stack-key i.s0 { background: var(--accent); }
.ld-seg.s1, .ld-stack-key i.s1 { background: var(--info); }
.ld-seg.s2, .ld-stack-key i.s2 { background: var(--violet); }
.ld-seg.s3, .ld-stack-key i.s3 { background: var(--warn); }
.ld-seg.s4, .ld-stack-key i.s4 { background: var(--pos); }
.ld-seg.s5, .ld-stack-key i.s5 { background: color-mix(in srgb, var(--neg) 80%, var(--surface)); }
.ld-seg.s6, .ld-stack-key i.s6 { background: var(--muted-strong, var(--muted)); }
.ld-seg.is-rest, .ld-stack-key i.is-rest { background: color-mix(in srgb, var(--muted) 22%, transparent); }
.ld-stack-key { display: flex; gap: 6px 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.ld-stack-key span { display: inline-flex; align-items: center; gap: 6px; }
.ld-stack-key i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.ld-stack-key b { color: var(--text-strong); font-variant-numeric: tabular-nums; }
.ld-bars { display: grid; gap: 6px; }
.ld-bar-row { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr) 72px; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 8px; }
.ld-bar-row[data-ld-person] { cursor: pointer; }
.ld-bar-row[data-ld-person]:hover { background: var(--surface-2); }
.ld-bar-row:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-bar-name { display: grid; min-width: 0; }
.ld-bar-name b { color: var(--text-strong); font-size: 13px; overflow-wrap: anywhere; }
.ld-bar-name small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-bar-pair { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 2px 8px; align-items: center; min-width: 0; }
.ld-bar { display: block; height: 8px; border-radius: 4px; max-width: 100%; }
.ld-bar.is-econ { background: color-mix(in srgb, var(--muted) 55%, transparent); }
.ld-bar.is-votes { background: var(--accent); }
.ld-bar-pair em { font-style: normal; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ld-bar-val { text-align: right; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums; font-size: 13px; }

/* 5. Tenure timeline */
.ld-t-head, .ld-t-row { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 12px; align-items: center; }
.ld-t-axis { position: relative; height: 18px; border-bottom: 1px solid var(--border); }
.ld-t-axis span { position: absolute; top: 0; transform: translateX(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ld-t-row { padding: 4px 0; border-radius: 6px; cursor: pointer; }
.ld-t-row:hover { background: var(--surface-2); }
.ld-t-row:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-t-name { display: grid; min-width: 0; padding-left: 6px; }
.ld-t-name b { font-size: 13px; color: var(--text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-t-name small { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-t-track { position: relative; height: 18px; background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--hairline, var(--border)) calc(10% - 1px) 10%); }
.ld-t-bar { position: absolute; height: 8px; border-radius: 4px; }
.ld-t-bar.is-company { top: 2px; height: 14px; background: color-mix(in srgb, var(--muted) 22%, transparent); }
.ld-t-bar.is-board { top: 5px; background: var(--info); }
.ld-t-bar.is-insider { top: 5px; background: var(--accent); }
.ld-t-bar.is-insider.is-approx { background: repeating-linear-gradient(90deg, var(--accent) 0 6px, color-mix(in srgb, var(--accent) 30%, transparent) 6px 10px); }
.ld-t-mark { position: absolute; top: 0; width: 3px; height: 18px; border-radius: 1px; background: var(--text-strong); transform: translateX(-1px); }

/* 7. Changes */
.ld-changes { margin: 0; padding: 0; list-style: none; display: grid; gap: 0; border-left: 2px solid var(--border); }
.ld-changes li { position: relative; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; padding: 8px 0 8px 16px; font-size: 13px; }
.ld-changes li::before { content: ""; position: absolute; left: -6px; top: 13px; width: 10px; height: 10px; border-radius: 999px; background: var(--surface); border: 2px solid var(--accent); }
.ld-changes time { color: var(--muted); font-variant-numeric: tabular-nums; }
.ld-changes a { color: var(--text-strong); }

/* Person detail */
.ld-detail-slot:empty { display: none; }
.ld-detail { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-sm, none); font-size: 14px; min-width: 0; }
.ld-detail p { margin: 0; }
.ld-detail h5 { margin: 6px 0 0; font-size: 13px; color: var(--text-strong); }
.ld-detail-head { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.ld-detail-head h4 { margin: 0; font-size: 18px; color: var(--text-strong); }
.ld-detail-head p { color: var(--muted); font-size: 13px; margin: 2px 0 6px; }
.ld-close { appearance: none; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); width: 32px; height: 32px; border-radius: 8px; font-size: 18px; line-height: 1; cursor: pointer; }
.ld-close:hover { color: var(--text-strong); }
.ld-close:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ld-detail-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.ld-detail-kpis div { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); min-width: 0; }
.ld-detail-kpis small { display: block; font-size: 11px; color: var(--muted); }
.ld-detail-kpis b { color: var(--text-strong); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ld-detail .stp-table { font-size: 13px; }
.ld-mini-wrap { overflow-x: auto; min-width: 0; }
.ld-tx td:first-child, .ld-lines td:nth-child(4), .ld-mini td.num { white-space: nowrap; }
.ld-detail > * { min-width: 0; }
.ld-detail > p { overflow-wrap: break-word; }
.ld-detail a { color: var(--text-strong); }
.ld-others { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: 13px; }
.ld-mini td, .ld-mini th { padding: 5px 8px; }
.ld-lines tr.has-note td { border-bottom: 0; }
.ld-lines .ld-note-row td { padding-top: 0; font-size: 12px; color: var(--muted); }

@media (max-width: 760px) {
  .ld-control { grid-template-columns: minmax(0, 1fr); }
  .ld-control-line { font-size: 16px; }
  .ld-bar-row { grid-template-columns: minmax(0, 1fr) 64px; }
  .ld-bar-pair { grid-column: 1 / -1; grid-row: 2; }
  .ld-bar-val { grid-row: 1; grid-column: 2; }
  .ld-t-head, .ld-t-row { grid-template-columns: minmax(0, 118px) minmax(0, 1fr); gap: 8px; }
  .ld-where li { grid-template-columns: minmax(0, 1fr); }
  .ld-detail-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ld-changes li { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .ld-node { min-width: 0; flex: 1 1 140px; }
  .ld-node.is-ceo { min-width: 0; }
  .ld-web-wrap { overflow-x: auto; overscroll-behavior-x: contain; }
  .ld-web { min-width: 720px; max-width: none; }
  .ld-w-co-t, .ld-w-p text { font-size: 26px; }
  .ld-w-center-t { font-size: 40px; }
  .ld-w-center-s { display: none; }
}
@media (max-width: 420px) {
  .ld-cards { grid-template-columns: minmax(0, 1fr); }
  .ld-kpis { grid-template-columns: minmax(0, 1fr); }
  .ld-view { padding: 7px 9px; font-size: 12px; }
  .ld-detail .ld-mini { font-size: 12px; }
  .ld-mini td, .ld-mini th { padding: 4px 6px; }
  .ld-code { display: none; }
}
`;
}
