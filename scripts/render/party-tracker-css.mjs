export function renderPartyTrackerCss() {
  return `
#party-tracker-section { min-width: 0; }
#party-tracker-root { min-width: 0; color: var(--text); }
.pty-now { margin: 4px 0 8px; font-size: 15px; line-height: 1.55; }
.pty-caveat, .pty-note, .pty-caption { color: var(--muted-strong); font-size: 13px; line-height: 1.65; }
.pty-notice { margin: 12px 0; padding: 12px 14px; background: var(--surface-2); border-left: 2px solid var(--border-strong); color: var(--muted-strong); font-size: 13px; line-height: 1.6; }
.pty-offices, .pty-gov { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 18px 0 8px; }
.pty-card, .pty-gov article { border-top: 1px solid var(--border); padding: 14px 0 8px; min-width: 0; }
.pty-card h3, .pty-gov h3, .pty-block h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); }
.pty-gov b { display: block; font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; }
.pty-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pty-pair div { min-width: 0; }
.pty-pair b { display: block; font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.15; }
.pty-pair span, .pty-pair small, .pty-card p, .pty-gov p { display: block; color: var(--muted-strong); font-size: 12px; line-height: 1.45; }
.pty-pair small { margin-top: 4px; }
.pty-lead { color: var(--text); font-weight: 600; }
.pty-up { color: var(--pos); }
.pty-down { color: var(--neg); }
.pty-read { margin: 8px 0 0; color: var(--text); font-size: 13px; line-height: 1.55; }
.pty-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 22px 0 16px; }
.pty-tabs button { border: 0; background: none; color: var(--muted-strong); padding: 10px 14px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
.pty-tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.pty-tabs button:focus-visible, .pty-sort:focus-visible, .pty-retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pty-chart { width: 100%; height: auto; display: block; cursor: crosshair; touch-action: none; user-select: none; }
.pty-axis { fill: var(--muted-strong); font-size: 11px; font-variant-numeric: tabular-nums; }
.pty-axis line { stroke: var(--muted-strong); stroke-opacity: .35; }
.pty-axis .pty-grid { stroke-opacity: .12; }
.pty-cycles { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.pty-cycles button, .pty-term-btn { border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; text-align: left; }
.pty-cycles button[aria-pressed="true"], .pty-term.is-selected { border-color: var(--accent); }
.pty-term-btn { width: 100%; }
.pty-term-btn small, .pty-cycles button small { display: block; color: var(--muted-strong); font-size: 11px; margin-top: 2px; }
.pty-legend { display: flex; gap: 16px; margin: 8px 0 4px; font-size: 12px; color: var(--muted-strong); }
.pty-legend i { display: inline-block; width: 18px; height: 3px; margin-right: 6px; vertical-align: middle; }
.pty-d { background: #7ea0c4; }
.pty-r { background: #c4896a; }
.pty-reads { display: grid; gap: 10px; margin: 16px 0 18px; }
.pty-reads p { margin: 0; padding: 12px 14px; background: var(--surface-2); border-left: 2px solid var(--border); font-size: 13px; line-height: 1.6; }
.pty-scroll { width: 100%; overflow-x: auto; }
.pty-table { border-collapse: collapse; width: 100%; font-size: 13px; text-align: left; }
.pty-table th, .pty-table td { padding: 12px; border-bottom: 1px solid var(--border); vertical-align: top; font-variant-numeric: tabular-nums; }
.pty-table th { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted-strong); font-weight: 600; }
.pty-sort { border: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; padding: 0; }
.pty-table td small, .pty-table th small { display: block; color: var(--muted-strong); font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; margin-top: 4px; }
.pty-group td { color: var(--muted-strong); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; background: var(--surface-2); }
.pty-focus { box-shadow: inset 2px 0 0 var(--accent); }
.pty-timeline { display: grid; gap: 14px; margin: 8px 0 18px; }
.pty-term { border-top: 1px solid var(--border); padding-top: 12px; }
.pty-term h3 { margin: 0; font-size: 18px; font-weight: 500; }
.pty-chapters { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.pty-chapters li { font-size: 13px; line-height: 1.45; }
.pty-open { display: inline-block; margin-left: 8px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-strong); vertical-align: middle; }
.pty-details { margin: 8px 0 16px; }
.pty-details summary { cursor: pointer; font-weight: 600; }
.pty-details p, .pty-details li { color: var(--muted-strong); font-size: 13px; line-height: 1.65; }
.pty-empty { padding: 16px 0; color: var(--muted-strong); }
.pty-retry { margin-top: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 6px; padding: 8px 12px; font: inherit; cursor: pointer; }
@media (max-width: 800px) {
  .pty-offices, .pty-gov { grid-template-columns: 1fr; gap: 4px; }
  .pty-pair b { font-size: 22px; }
  .pty-tabs button { padding: 10px 8px; }
}
`;
}
