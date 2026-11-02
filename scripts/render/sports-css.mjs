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
.sp-stats li.sp-later { color: var(--muted-strong); }
.sp-stats li span { font-size: 11px; opacity: .8; }
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
.sp-close { font: inherit; font-size: 18px; line-height: 1; color: var(--muted-strong); background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; }
.sp-teams { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.sp-table-wrap { overflow-x: auto; max-width: 100%; }
.sp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sp-table th, .sp-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
.sp-table th { font-weight: 600; color: var(--muted-strong); font-size: 11.5px; }
.sp-table .sp-n { text-align: right; }
.sp-table tr.sp-key td:first-child { font-weight: 600; }
.sp-table tr.sp-dnp td { color: var(--muted-strong); }
.sp-link { font: inherit; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
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
.sp-q { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-strong); white-space: nowrap; vertical-align: 1px; }
.sp-q-validated { color: var(--pos); border-color: currentColor; }
.sp-model-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 12.5px; }
.sp-model-list li { display: grid; gap: 3px; }
.sp-model-list b { font-variant-numeric: tabular-nums; }
.sp-model-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sp-fc-game { margin: -4px 0 6px; font-size: 12.5px; }
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
@media (max-width: 760px) {
  .sp-chance { margin-left: 0; }
  .sp-add, .sp-leg, .sp-eval, .sp-entry { padding: 12px; }
  .sp-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .sp-grid { grid-template-columns: minmax(0, 1fr); }
  .sp-zone { margin-left: 0; }
  .sp-game { grid-template-columns: minmax(0, 1fr) auto; }
  .sp-time { grid-column: 1 / -1; font-size: 12px; }
}
`;
}
