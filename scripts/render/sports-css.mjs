export function renderSportsCss() {
  return `
.sp-section { min-width: 0; }
.sp-section [id$="-root"] { min-width: 0; color: var(--text); }
.sp-days { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 6px 0 18px; }
.sp-day { font-size: 13px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-day b { color: var(--text); font-weight: 600; margin-right: 4px; }
.sp-zone { margin-left: auto; font-size: 12px; color: var(--muted-strong); display: inline-flex; align-items: center; gap: 6px; }
.sp-zone select { font: inherit; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; }
.sp-zone select:focus-visible, .sp-retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sp-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); gap: 20px; align-items: start; }
.sp-player-row { grid-column: 1 / -1; min-width: 0; }
.sp-player-row:empty { display: none; }
.sp-board h3, .sp-side h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.sp-empty { padding: 18px 16px; border: 1px dashed var(--border-strong); border-radius: 8px; background: var(--surface-2); }
.sp-empty b { display: block; font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.sp-empty p { margin: 4px 0 0; color: var(--muted-strong); font-size: 13px; line-height: 1.6; }
.sp-source, .sp-stats { border-top: 1px solid var(--border); padding-top: 12px; margin-bottom: 16px; }
.sp-source dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13px; }
.sp-source dt { color: var(--muted-strong); }
.sp-source dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.sp-source a { color: var(--accent); }
.sp-state-ok { color: var(--pos); }
.sp-state-failed { color: var(--neg); }
.sp-state-degraded, .sp-state-not_connected, .sp-state-unknown { color: var(--muted-strong); }
.sp-stats ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.sp-stats li { font-size: 12px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--border); }
.sp-stats li.sp-on { border-color: var(--accent); color: var(--text); }
.sp-stats li span { font-size: 11px; opacity: .8; }
.sp-stats .sp-label { margin: 10px 0 6px; }
.sp-stats .sp-label:first-of-type { margin-top: 0; }
.sp-stats .sp-note { margin-top: 10px; }
.sp-steps { margin: 0 0 18px; padding-left: 20px; display: grid; gap: 10px; }
.sp-steps li { font-size: 13px; line-height: 1.6; color: var(--muted-strong); }
.sp-steps b { display: block; color: var(--text); font-weight: 600; }
.sp-note, .sp-foot { color: var(--muted-strong); font-size: 12px; line-height: 1.6; }
.sp-foot { margin: 18px 0 0; }
.sp-retry { font: inherit; color: var(--text); background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 7px 12px; cursor: pointer; }
.sp-muted, .sp-loading { color: var(--muted-strong); font-size: 13px; }
.sp-day-group { margin-bottom: 14px; }
.sp-day-group h4, .sp-panel h4 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.sp-day-group h4 span, .sp-panel h4 span, .sp-team h5 span { color: var(--muted-strong); font-weight: 400; font-size: 12px; margin-left: 4px; }
.sp-none { margin: 0; }
.sp-games { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.sp-props-status { padding: 14px; margin-bottom: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); font-size: 13px; }
.sp-props-status p { margin: 7px 0; line-height: 1.6; }
.sp-props-status a { color: var(--accent); }
.sp-props { padding: 10px 6px 18px; display: grid; gap: 8px; }
.sp-prop { padding: 12px; border: 1px solid var(--border); border-radius: 8px; min-width: 0; }
.sp-prop-title { display: flex; gap: 9px; align-items: start; }
.sp-prop-title > div { min-width: 0; flex: 1; }
.sp-prop-title strong { display: block; font-size: 14px; margin-top: 4px; overflow-wrap: anywhere; }
.sp-prop-number { color: var(--accent); font-size: 14px; font-weight: 700; }
.sp-prop-score { text-align: right; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-prop-score small { display: block; margin-top: 3px; color: var(--muted-strong); font-size: 11px; }
.sp-nba-pair, .sp-nba-research { min-width: 0; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font-size: 13px; line-height: 1.6; }
.sp-nba-pair h4, .sp-nba-research h4 { margin: 0 0 8px; }
.sp-nba-pair label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.sp-nba-pair input { min-width: 0; width: 110px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; }
.sp-nba-pair .sp-btn { margin: 4px 5px 4px 0; }
.sp-nba-research { margin-bottom: 18px; }
.sp-prop details { margin: 10px 0; font-size: 13px; }
.sp-prop summary, .sp-prop-injuries summary { cursor: pointer; color: var(--muted-strong); font-size: 12px; }
.sp-prop dl { margin: 10px 0; }
.sp-prop dt { font-weight: 600; margin-top: 9px; }
.sp-prop dd { margin: 4px 0 0; color: var(--muted-strong); line-height: 1.6; }
.sp-prop-empty { color: var(--muted-strong); font-size: 12px; margin: 5px 10px; line-height: 1.6; }
.sp-prop-injuries ul { padding-left: 18px; font-size: 12px; }
.sp-prop-injuries p { margin: 4px 0 10px; line-height: 1.6; color: var(--muted-strong); }
.sp-game { width: 100%; display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 10px; align-items: center; text-align: left; font: inherit; font-size: 13px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; cursor: pointer; font-variant-numeric: tabular-nums; }
.sp-game:hover { border-color: var(--border-strong); }
.sp-game.is-on { border-color: var(--accent); }
.sp-game:focus-visible, .sp-link:focus-visible, .sp-close:focus-visible, .sp-find input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sp-time { color: var(--muted-strong); white-space: nowrap; }
.sp-match { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.sp-match i { font-style: normal; font-weight: 400; color: var(--muted-strong); }
.sp-gstat { text-align: right; font-size: 12px; }
.sp-final b { font-weight: 500; }
.sp-final b.sp-win { font-weight: 700; color: var(--text); }
.sp-panel { margin: 12px 0 18px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); min-width: 0; }
.sp-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sp-panel h5, .sp-team h5 { margin: 14px 0 6px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.sp-matchup, .sp-tb { margin: 12px 0 4px; border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px 4px; container: sp-mx / inline-size; }
.sp-matchup > summary, .sp-tb > summary { cursor: pointer; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); padding: 4px 0; }
.sp-matchup h6, .sp-tb h6 { margin: 14px 0 6px; font-size: 12px; font-weight: 600; color: var(--muted-strong); }
.sp-mx-table th[scope="row"] { font-weight: 500; text-align: left; white-space: nowrap; }
.sp-mx-table td { white-space: nowrap; }
.sp-nw { white-space: nowrap; }
.sp-rank { font-size: 11px; color: var(--muted-strong); margin-left: 2px; }
.sp-tag { display: inline-block; font-size: 10px; line-height: 1.5; padding: 0 6px; margin-left: 4px; border-radius: 999px; border: 1px solid var(--border); vertical-align: 1px; }
.sp-tag-soft { color: var(--pos); border-color: var(--pos); }
.sp-tag-tough { color: var(--neg); border-color: var(--neg); }
.sp-meetings { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; font-variant-numeric: tabular-nums; }
.sp-meetings .sp-win { font-weight: 700; color: var(--text); }
@media (max-width: 560px) { .sp-matchup, .sp-tb { padding: 6px 8px 2px; } }
/* The matchup can sit in a narrow column (a phone, or beside the board on a
   small laptop), so it follows its own width, not the window's. */
@container sp-mx (max-width: 520px) {
  .sp-table.sp-mx-table th { white-space: normal; }
  .sp-table.sp-mx-table th, .sp-table.sp-mx-table td { padding-left: 4px; padding-right: 4px; font-size: 12px; }
  .sp-table.sp-mx-table td { white-space: normal; }
  .sp-mx-table .sp-rank { display: block; margin: 0; }
}
/* Game panel player tables: names may wrap and cells sit a little closer so
   the whole table fits beside the board on a desktop. */
.sp-table.sp-game-table th, .sp-table.sp-game-table td { padding-left: 5px; padding-right: 5px; }
.sp-table.sp-game-table td.sp-pl { white-space: normal; min-width: 8.5em; }
.sp-close { font: inherit; font-size: 18px; line-height: 1; color: var(--muted-strong); background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; }
.sp-teams { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.sp-table-wrap { overflow-x: auto; max-width: 100%; }
.sp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sp-table th, .sp-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.sp-table th { font-weight: 600; color: var(--muted-strong); font-size: 11.5px; }
/* Muted notes inside a table keep the cell's size; a <small> note is smaller. */
.sp-table .sp-muted { font-size: inherit; }
.sp-table small.sp-muted { font-size: 11px; font-weight: 400; }
.sp-table .sp-n { text-align: right; }
.sp-table tr.sp-key td:first-child { font-weight: 600; }
.sp-table tr.sp-dnp td { color: var(--muted-strong); }
.sp-table td.sp-wrap { white-space: normal; min-width: 14em; }
.sp-fc-none { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
.sp-link { font: inherit; color: var(--text); font-weight: 500; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--muted-strong) 45%, transparent); text-underline-offset: 3px; }
.sp-link:hover { color: var(--accent); text-decoration-color: var(--accent); }
.sp-link:hover { text-decoration: underline; }
.sp-search { margin-top: 18px; }
.sp-find { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted-strong); max-width: 360px; }
.sp-find input { font: inherit; font-size: 14px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; }
.sp-out { font-size: 11px; color: var(--neg); margin-left: 4px; white-space: nowrap; }
.sp-results { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; font-size: 13px; }
/* Pick Builder */
.sp-gap { margin-top: 22px !important; }
.sp-field { display: inline-flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted-strong); min-width: 0; }
.sp-field select, .sp-field input, .sp-leg-line select, .sp-leg-line input { font: inherit; font-size: 14px; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; min-width: 0; }
.sp-field select:focus-visible, .sp-field input:focus-visible, .sp-leg-line select:focus-visible, .sp-leg-line input:focus-visible, .sp-btn:focus-visible, .sp-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sp-money { display: inline-flex; align-items: center; gap: 4px; }
.sp-money i { font-style: normal; color: var(--muted-strong); font-size: 13px; }
.sp-money input { width: 96px; }
.sp-btn { font: inherit; font-size: 13px; font-weight: 500; color: var(--text); background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 6px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
.sp-btn:hover:not(:disabled) { border-color: var(--accent); }
.sp-btn:disabled { opacity: .5; cursor: not-allowed; }
.sp-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--surface); font-weight: 600; }
.sp-chip { font: inherit; font-size: 12px; color: var(--accent); background: transparent; border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; cursor: pointer; }
.sp-chip:hover { border-color: var(--accent); }
.sp-add { padding: 14px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); }
.sp-add-row, .sp-pick-row, .sp-settings, .sp-payout-row, .sp-save-row, .sp-settle, .sp-entry-actions { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 12px; }
.sp-add .sp-find { flex: 1 1 220px; }
.sp-add-pick { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
.sp-add-pick h4 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
.sp-add-pick h4 span { color: var(--muted-strong); font-weight: 400; font-size: 12px; margin-left: 4px; }
.sp-pickform { margin: 4px 0 6px; }
.sp-pick-game { margin: 0 0 10px; font-size: 13px; color: var(--muted-strong); }
.sp-line-field input { width: 96px; }
.sp-pick-msg { margin: 8px 0 0; font-size: 13px; color: var(--pos); min-height: 1em; }
.sp-pick-msg:empty { margin: 0; min-height: 0; }
.sp-bad, .sp-pick-msg.sp-bad { color: var(--neg); }
.sp-banner { margin: 0 0 10px; padding: 9px 12px; border-radius: 6px; border: 1px solid var(--accent); font-size: 13px; }
.sp-banner.sp-bad { border-color: var(--neg); }
.sp-legs { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 8px; }
.sp-leg { padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); min-width: 0; }
.sp-leg-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sp-leg-name { font-weight: 600; font-size: 14px; min-width: 0; overflow-wrap: anywhere; }
.sp-leg-name i { font-style: normal; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border-strong); font-size: 11px; margin-right: 8px; color: var(--muted-strong); }
.sp-leg-name span { color: var(--muted-strong); font-weight: 400; font-size: 12px; }
.sp-leg-game { margin: 4px 0 10px; font-size: 12px; color: var(--muted-strong); }
.sp-leg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 13px; }
.sp-leg-stat { font-weight: 600; }
.sp-leg-line input[data-sp-leg-line] { width: 84px; }
.sp-chance { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-strong); font-size: 12px; margin-left: auto; }
.sp-chance input { width: 64px; }
.sp-chance i { font-style: normal; }
.sp-src { font-size: 11px; color: var(--muted-strong); min-width: 0; }
.sp-hist { margin-top: 10px; font-size: 12.5px; color: var(--muted-strong); display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.sp-hist b { color: var(--text); font-variant-numeric: tabular-nums; }
.sp-hist-use { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.sp-model-line { flex-basis: 100%; line-height: 1.5; }
.sp-model-warn { color: var(--warn, var(--muted-strong)); }
.sp-hist-range { flex-basis: 100%; font-size: 11.5px; }
.sp-q { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-strong); white-space: nowrap; vertical-align: 1px; }
.sp-q-validated { color: var(--pos); border-color: currentColor; }
.sp-model-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 12.5px; }
.sp-model-list li { display: grid; gap: 3px; }
.sp-model-list b { font-variant-numeric: tabular-nums; }
.sp-model-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sp-model-tally { margin: 0 0 8px; font-size: 12px; color: var(--muted-strong); }
.sp-model-list li { grid-template-columns: minmax(0, 1fr); }
.sp-model-stat { min-width: 0; }
.sp-model-stat > summary { cursor: pointer; list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.sp-model-stat > summary::-webkit-details-marker { display: none; }
.sp-model-stat > summary::before { content: '\\25B8'; color: var(--muted); font-size: 10px; flex: none; }
.sp-model-stat[open] > summary::before { content: '\\25BE'; }
.sp-model-name { font-weight: 600; flex: 1 1 auto; min-width: 0; }
.sp-model-verdict { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.sp-model-score { font-variant-numeric: tabular-nums; font-size: 12px; white-space: nowrap; }
.sp-model-body { display: grid; gap: 3px; padding: 6px 0 2px 16px; }
.sp-model-links { margin-top: 12px; font-size: 12.5px; }
.sp-model-links > summary { cursor: pointer; font-weight: 600; color: var(--muted-strong); padding: 4px 0; }
.sp-model-links[open] > summary { margin-bottom: 8px; }
.sp-rel { margin: 4px 0 0; display: flex; align-items: center; gap: 10px; }
.sp-rel figcaption { font-size: 11.5px; color: var(--muted); max-width: 160px; }
.sp-rel-svg { flex: none; overflow: visible; }
.sp-rel-diag { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.sp-rel-dot { fill: var(--accent); fill-opacity: .75; stroke: var(--surface); stroke-width: 1; }
.sp-rel-dot.is-off { fill: var(--warn, var(--neg)); }
.sp-clv-section { margin: 12px 0 4px; }
.sp-clv-section h4 { margin: 0 0 4px; }
.sp-clv-charts { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; margin: 6px 0; }
.sp-clv { margin: 0; }
.sp-clv-svg { display: block; max-width: 100%; height: auto; overflow: visible; }
.sp-clv figcaption { font-size: 11.5px; color: var(--muted); }
.sp-clv-bar { fill: var(--muted); fill-opacity: .55; }
.sp-clv-bar.is-for { fill: var(--pos); fill-opacity: .7; }
.sp-clv-bar.is-against { fill: var(--neg); fill-opacity: .7; }
.sp-clv-split { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 4px; min-width: 240px; }
.sp-clv-split li { display: grid; grid-template-columns: 9.5em 1fr 3em; align-items: center; gap: 8px; font-size: 12.5px; }
.sp-clv-split li small { color: var(--muted); }
.sp-clv-track { display: block; height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--muted) 18%, transparent); overflow: hidden; }
.sp-clv-track i { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.sp-clv-split b { text-align: right; font-variant-numeric: tabular-nums; }
.sp-fc-game { margin: -4px 0 6px; font-size: 12.5px; }
.sp-avail { margin: 0 0 8px; font-size: 12.5px; }
.sp-lines { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; color: var(--muted-strong); }
.sp-lines span { white-space: nowrap; }
.sp-lines b { color: var(--text); font-variant-numeric: tabular-nums; }
.sp-calib { list-style: none; margin: 0 0 6px; padding: 0; font-size: 13px; display: grid; gap: 4px; }
.sp-settings { margin: 14px 0 0; }
.sp-payouts { margin-top: 14px; }
.sp-label { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: var(--muted-strong); }
.sp-eval { margin-top: 14px; padding: 14px 16px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 13px; line-height: 1.55; }
.sp-eval p { margin: 6px 0 0; }
.sp-eval p:first-child { margin-top: 0; }
.sp-eval-bad { border-color: var(--neg); }
.sp-warn { margin: 0 0 10px; padding: 0 0 0 18px; color: var(--warn); }
.sp-warn li { margin: 2px 0; }
.sp-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 2px 0 10px; }
.sp-tile { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); min-width: 0; }
.sp-tile > span { display: block; font-size: 11.5px; color: var(--muted-strong); }
.sp-tile b { display: block; font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
.sp-tile > i { display: block; font-style: normal; font-size: 11px; color: var(--muted-strong); margin-top: 2px; }
.sp-pos { color: var(--pos); }
.sp-neg { color: var(--neg); }
.sp-dist { font-size: 12.5px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-links { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; font-size: 13px; }
.sp-links li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; }
.sp-link-val { font-variant-numeric: tabular-nums; color: var(--muted-strong); }
.sp-link-val i { font-style: normal; color: var(--muted); }
.sp-save { margin-top: 14px; display: grid; gap: 10px; }
.sp-note-field input { width: 100%; }
.sp-note-field { display: flex; }
.sp-journal { margin-top: 28px; }
.sp-journal h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.sp-entries { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; }
.sp-entry { padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); font-size: 13px; min-width: 0; }
.sp-entry.is-withdrawn { opacity: .65; }
.sp-entry-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; color: var(--muted-strong); font-size: 12px; }
.sp-entry-pay { margin: 6px 0 8px; font-size: 12px; color: var(--muted-strong); }
.sp-entry-legs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sp-entry-legs li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 12px; min-width: 0; }
.sp-entry-legs li > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.sp-entry-money { margin: 8px 0 0; font-variant-numeric: tabular-nums; }
.sp-entry-note { margin: 6px 0 0; font-style: italic; color: var(--muted-strong); overflow-wrap: anywhere; }
.sp-entry-actions { margin-top: 10px; }
.sp-confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.sp-res { font-size: 12px; color: var(--muted-strong); white-space: nowrap; font-variant-numeric: tabular-nums; }
.sp-res-win { color: var(--pos); font-weight: 600; }
.sp-res-loss { color: var(--neg); font-weight: 600; }
.sp-res-push, .sp-res-void { color: var(--warn); }
.sp-badge { font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--muted-strong); white-space: nowrap; }
.sp-badge-win { color: var(--pos); border-color: var(--pos); }
.sp-badge-loss { color: var(--neg); border-color: var(--neg); }
.sp-badge-review, .sp-badge-partial, .sp-badge-refund { color: var(--warn); border-color: var(--warn); }
/* Views, charts and stat tables */
.sp-seg { display: flex; width: fit-content; flex-wrap: nowrap; gap: 4px; margin: 0 0 12px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); max-width: 100%; overflow-x: auto; scrollbar-width: none; vertical-align: top; }
.sp-seg::-webkit-scrollbar { display: none; }
.sp-seg button { font: inherit; font-size: 12.5px; color: var(--muted-strong); background: transparent; border: 0; border-radius: 6px; padding: 6px 11px; cursor: pointer; white-space: nowrap; }
.sp-seg button:hover:not(:disabled) { color: var(--text); }
.sp-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: inset 0 0 0 1px var(--border-strong); }
.sp-seg button:disabled { opacity: .45; cursor: not-allowed; }
.sp-seg button:focus-visible, .sp-th:focus-visible, .sp-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.sp-board > .sp-seg { margin-bottom: 16px; }
.sp-ctl, .sp-ch-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 12px; margin: 0 0 12px; }
.sp-ctl .sp-field select, .sp-ch-controls .sp-field select { font-size: 13px; padding: 6px 8px; }
.sp-board > [data-sp-part="view"] > h3 span { text-transform: none; letter-spacing: 0; font-weight: 400; margin-left: 4px; }
.sp-charts { margin: 0 0 6px; }
.sp-ch-wrap { min-width: 0; }
.sp-ch { display: block; width: 100%; height: auto; overflow: visible; font-variant-numeric: tabular-nums; }
.sp-ch-grid { stroke: var(--border); stroke-width: 1; }
.sp-ch-grid.is-zero { stroke: var(--border-strong); }
.sp-ch-axis { fill: var(--muted-strong); font-size: 10.5px; }
.sp-ch-sub { fill: var(--muted); font-size: 9.5px; }
.sp-ch-val { fill: var(--text); font-size: 10.5px; font-weight: 600; }
.sp-bar.is-over, .sp-dot.is-over { fill: var(--pos); }
.sp-bar.is-under, .sp-dot.is-under { fill: var(--neg); }
.sp-bar.is-at, .sp-dot.is-at { fill: var(--muted); }
.sp-bar { opacity: .88; }
.sp-dot { stroke: var(--surface-2); stroke-width: 1.5; }
.sp-ch-avg { stroke: var(--text); stroke-width: 1.4; stroke-dasharray: 5 4; opacity: .75; }
.sp-ch-ref { stroke: var(--accent); stroke-width: 2; }
.sp-ch-line { fill: none; stroke: var(--muted-strong); stroke-width: 1.6; }
.sp-ch-roll { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 2 3; }
.sp-ch-fit { stroke: var(--accent); stroke-width: 1.6; stroke-dasharray: 2 3; }
.sp-ch-tag { font-size: 10.5px; font-weight: 600; }
.sp-ch-tag-avg { fill: var(--text); }
.sp-ch-tag-ref { fill: var(--accent); }
.sp-ch-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 6px; font-size: 12px; color: var(--muted-strong); }
.sp-ch-legend span { display: inline-flex; align-items: center; gap: 6px; }
.sp-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.sp-swatch.is-over { background: var(--pos); }
.sp-swatch.is-under { background: var(--neg); }
.sp-key-line { display: inline-block; width: 18px; height: 0; border-top: 2px dashed var(--text); opacity: .8; }
.sp-key-ref { border-top: 2px solid var(--accent); opacity: 1; }
.sp-key-roll, .sp-key-fit { border-top: 2px dotted var(--accent); opacity: 1; }
.sp-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 6px; margin: 10px 0 4px; }
.sp-ch-controls .sp-line-field input { width: 112px; }
.sp-facts > div { padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); min-width: 0; }
.sp-facts dt { font-size: 11px; color: var(--muted-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-facts dd { margin: 2px 0 0; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.sp-facts small { font-size: 11px; font-weight: 500; color: var(--muted-strong); }
.sp-facts small.sp-pos { color: var(--pos); }
.sp-facts small.sp-neg { color: var(--neg); }
.sp-hits { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 4px; font-size: 12.5px; }
.sp-hit { display: grid; grid-template-columns: 116px minmax(0, 1fr) 96px; align-items: center; gap: 10px; padding: 3px 6px; border-radius: 6px; }
.sp-hit.is-line { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.sp-hit-t { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-hit-t small, .sp-hit-n small { color: var(--muted-strong); font-size: 10.5px; }
.sp-hit-bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.sp-hit-bar i.is-over { background: var(--pos); opacity: .85; }
.sp-hit-bar i.is-under { background: var(--neg); opacity: .7; }
.sp-hit-n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted-strong); }
.sp-hit-n b { color: var(--text); }
.sp-split { margin: 0 0 10px; }
.sp-split h6 { margin: 0 0 4px; font-size: 11.5px; font-weight: 600; color: var(--muted-strong); }
.sp-split ul, .sp-hbars { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 12.5px; }
.sp-split li { display: grid; grid-template-columns: 150px minmax(0, 1fr) 150px; align-items: center; gap: 10px; }
.sp-split-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-split-track, .sp-hb-track { position: relative; height: 12px; border-radius: 3px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.sp-split-bar, .sp-hb-bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; opacity: .85; }
.sp-split-bar.is-over, .sp-hb-bar.is-over { background: var(--pos); }
.sp-split-bar.is-under, .sp-hb-bar.is-under { background: var(--neg); }
.sp-split-bar.is-at, .sp-hb-bar.is-at { background: var(--muted); }
.sp-split-ref { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--text); opacity: .7; }
.sp-split-val { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-split-val small { color: var(--muted-strong); font-size: 11px; }
.sp-hbars { margin-bottom: 6px; }
.sp-hbars li { display: grid; grid-template-columns: 24px minmax(120px, 210px) minmax(0, 1fr) 52px; align-items: center; gap: 8px; }
.sp-hb-rank { color: var(--muted-strong); text-align: right; font-variant-numeric: tabular-nums; }
.sp-hb-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-hb-name small { color: var(--muted-strong); font-size: 11px; }
.sp-hb-val { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.sp-spark { display: block; overflow: visible; }
.sp-spark-cell { padding-top: 2px !important; padding-bottom: 2px !important; }
.sp-th { font: inherit; font-weight: 600; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px; }
.sp-th i { font-style: normal; font-size: 9px; min-width: 8px; }
.sp-th.is-on { color: var(--text); }
.sp-table th.sp-l { text-align: left; }
.sp-table th.sp-n .sp-th { flex-direction: row-reverse; }
.sp-table td.is-sorted { font-weight: 600; color: var(--text); }
.sp-lead td:nth-child(2), .sp-lead th:nth-child(2), .sp-teamtable td:first-child, .sp-teamtable th:first-child { position: sticky; left: 0; background: var(--surface-2); z-index: 1; }
.sp-more { margin: 10px 0 4px; }
.sp-leg-chart { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.sp-legspark { display: block; max-width: 100%; height: auto; overflow: visible; }
.sp-leg-chart small { font-size: 12px; }
.sp-teamtable td:first-child .sp-link { font-weight: 600; }
@media (max-width: 760px) {
  .sp-hit { grid-template-columns: 92px minmax(0, 1fr) 76px; gap: 8px; }
  .sp-split li { grid-template-columns: 104px minmax(0, 1fr) 112px; gap: 8px; }
  .sp-hbars li { grid-template-columns: 20px minmax(96px, 136px) minmax(0, 1fr) 44px; gap: 6px; }
  .sp-seg button { padding: 6px 9px; }
}
@media (max-width: 760px) {
  .sp-chance { margin-left: 0; }
  .sp-add, .sp-leg, .sp-eval, .sp-entry { padding: 12px; }
  .sp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .sp-grid { grid-template-columns: minmax(0, 1fr); }
  .sp-board { order: 0; }
  .sp-player-row { order: 1; }
  .sp-side { order: 2; }
  .sp-zone { margin-left: 0; }
  .sp-game { grid-template-columns: minmax(0, 1fr) auto; }
  .sp-time { grid-column: 1 / -1; font-size: 12px; }
}
.sp-data-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-data-chip i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.sp-data-chip.sp-state-ok { color: var(--text); }
.sp-data-chip.sp-state-ok i { color: var(--pos); }
.sp-data-chip.sp-state-failed i { color: var(--neg); }
.sp-source-fold > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; }
.sp-source-fold > summary::-webkit-details-marker { display: none; }
.sp-source-fold > summary h3 { margin: 0; }
.sp-source-fold > summary::after { content: '\\25BE'; color: var(--muted-strong); font-size: 12px; }
.sp-source-fold[open] > summary::after { content: '\\25B4'; }
.sp-source-fold[open] > summary { margin-bottom: 8px; }
.sp-be { margin: 4px 0 14px; }
.sp-be-head, .sp-be-scale { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-be-head b { color: var(--text); font-weight: 600; margin-left: 4px; }
.sp-be-head b.sp-pos { color: var(--pos); } .sp-be-head b.sp-neg { color: var(--neg); }
.sp-be-track { position: relative; height: 12px; margin: 6px 0 4px; border-radius: 999px; background: color-mix(in srgb, var(--border) 70%, transparent); overflow: hidden; }
.sp-be-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; }
.sp-be-fill.is-ahead { background: color-mix(in srgb, var(--pos) 75%, transparent); }
.sp-be-fill.is-behind { background: color-mix(in srgb, var(--neg) 70%, transparent); }
.sp-be-band { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--muted-strong) 22%, transparent); }
.sp-be-mark { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); }
/* Team bets (2026-11-12): the team game model in the game panel. */
.sp-tb-lead { margin: 6px 0 4px; font-size: 14px; line-height: 1.6; font-variant-numeric: tabular-nums; }
.sp-tb p.sp-muted { margin: 4px 0; line-height: 1.6; }
.sp-tb-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 12px; margin: 4px 0 10px; }
.sp-tb-form .sp-field select, .sp-tb-form .sp-field input { font-size: 13px; padding: 6px 8px; }
.sp-tb-form input[data-sp-tb="line"], .sp-tb-form input[data-sp-tb="price"] { width: 118px; }
.sp-tb-result { min-height: 28px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.sp-tb-result p { margin: 4px 0; font-size: 13px; line-height: 1.6; }
.sp-tb-big { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 14px; }
.sp-tb-big b { font-size: 20px; font-variant-numeric: tabular-nums; }
.sp-tb-big small { color: var(--muted-strong); font-size: 12px; font-variant-numeric: tabular-nums; }
.sp-tb-ev b.sp-pos { color: var(--pos); } .sp-tb-ev b.sp-neg { color: var(--neg); }
.sp-tb-line { fill: none; stroke-width: 2.2; }
.sp-tb-line.is-home { stroke: var(--accent); }
.sp-tb-line.is-away { stroke: var(--muted-strong); }
.sp-tb-key { border-top-style: solid; opacity: 1; }
.sp-tb-key.is-home { border-top-color: var(--accent); }
.sp-tb-key.is-away { border-top-color: var(--muted-strong); }
.sp-tb-table td:first-child { white-space: nowrap; }
.sp-tb-more { margin: 8px 0 4px; }
.sp-tb-more > summary { cursor: pointer; font-size: 12.5px; color: var(--muted-strong); padding: 4px 0; }
.sp-twin { white-space: nowrap; font-variant-numeric: tabular-nums; }
/* Player page (2026-11-12): a player opens in place of the board. */
.sp-has-player > .sp-days, .sp-has-player > .sp-grid > .sp-board, .sp-has-player > .sp-grid > .sp-side, .sp-has-player > .sp-foot { display: none; }
.sp-has-player > .sp-grid { display: block; }
.sp-ppage { margin-top: 0; }
.sp-pp-top { margin: 0 0 8px; }
.sp-back { font: inherit; font-size: 13px; color: var(--accent); background: transparent; border: 0; padding: 4px 0; cursor: pointer; }
.sp-back:hover { text-decoration: underline; }
.sp-back:focus-visible, .sp-ptabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sp-pp-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 24px; margin: 0 0 12px; }
.sp-pp-name { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.2; }
.sp-pp-who p { margin: 4px 0 0; }
.sp-pp-next { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 520px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 13px; }
.sp-pp-next b { font-size: 15px; }
.sp-pp-tl { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.sp-pp-chips { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.sp-pp-chips span { font-size: 12px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-pp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin: 0 0 4px; }
.sp-pp-tile { display: flex; flex-direction: column; gap: 2px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); min-width: 0; }
.sp-pp-tile b { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
.sp-pp-sub { font-size: 12px; color: var(--muted-strong); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-pp-sub small.sp-pos { color: var(--pos); } .sp-pp-sub small.sp-neg { color: var(--neg); }
.sp-pp-tile .sp-spark { margin-top: 4px; }
.sp-pp-note { margin: 4px 0 12px; }
.sp-ptabs { display: flex; gap: 2px; margin: 4px 0 14px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.sp-ptabs::-webkit-scrollbar { display: none; }
.sp-ptabs button { font: inherit; font-size: 13px; color: var(--muted-strong); background: transparent; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 12px; cursor: pointer; white-space: nowrap; }
.sp-ptabs button:hover { color: var(--text); }
.sp-ptabs button[aria-selected="true"] { color: var(--text); font-weight: 600; border-bottom-color: var(--accent); }
.sp-ptab-body > h5:first-child { margin-top: 0; }
.sp-res { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted-strong); }
.sp-res.is-w { color: var(--pos); } .sp-res.is-l { color: var(--neg); }
.sp-pp-up td { vertical-align: top; }
@media (max-width: 560px) {
  .sp-pp-name { font-size: 19px; }
  .sp-pp-next { max-width: none; width: 100%; }
  .sp-pp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sp-ptabs { flex-wrap: wrap; overflow: visible; }
  .sp-ptabs button { padding: 7px 9px; }
  .sp-tb-form .sp-field { flex: 1 1 140px; }
  .sp-tb-form input[data-sp-tb="line"], .sp-tb-form input[data-sp-tb="price"] { width: 100%; }
}
/* Pick Builder: game bets, odds and parlays (2026-11-12). */
.sp-add-hint { margin: -4px 0 10px; font-size: 12.5px; }
.sp-gb-game { flex: 1 1 260px; }
.sp-gb-game select { width: 100%; }
.sp-tb-form input[data-sp-gb="line"] { width: 110px; }
.sp-leg-team .sp-leg-name > span:last-child { font-weight: 500; }
.sp-leg-line input[data-sp-leg-tline] { width: 84px; }
.sp-ms { font-size: 11.5px; color: var(--muted-strong); font-variant-numeric: tabular-nums; }
.sp-ms:empty { display: none; }
.sp-price-field { flex-direction: row; align-items: center; gap: 6px; }
.sp-price-field span { font-size: 12px; }
.sp-price-field input { width: 84px; }
.sp-price-note { font-size: 12px; color: var(--muted-strong); font-variant-numeric: tabular-nums; flex-basis: 100%; }
.sp-price-note:empty { display: none; }
.sp-price-note .sp-bad, .sp-pick-msg .sp-bad { color: var(--neg); }
.sp-parlay-all { margin: 4px 0; font-size: 14px; font-variant-numeric: tabular-nums; }
.sp-payout-row .sp-price-note { flex-basis: auto; align-self: flex-end; padding-bottom: 8px; }
.sp-payout-row input[data-sp-parlay] { width: 110px; }
.sp-odds { margin: 12px 0 4px; }
.sp-odds-table { width: auto; min-width: min(100%, 360px); }
.sp-odds-table th { text-align: left; font-weight: 500; padding-right: 16px; }
.sp-odds-table td { font-variant-numeric: tabular-nums; white-space: nowrap; }
.sp-odds-edge { margin: 6px 0 0; font-size: 13px; }
.sp-sg-notes { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted-strong); }
.sp-sg-notes li + li { margin-top: 4px; }
@media (max-width: 560px) {
  .sp-odds-table { width: 100%; }
  .sp-odds-table th small { display: none; }
  .sp-odds-table th { padding-right: 8px; }
  .sp-price-field { margin-left: 0; }
}
`;
}
