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
@media (max-width: 760px) {
  .sp-grid { grid-template-columns: minmax(0, 1fr); }
  .sp-zone { margin-left: 0; }
}
`;
}
