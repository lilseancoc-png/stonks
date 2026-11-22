// Styles for the Owner intuition journal panel (journal-client.mjs). On
// screens wider than a phone the page shrinks beside the panel (a split
// view, body.jr-on padding); on a phone the panel is a full-screen sheet that
// tucks away while you pick something on the page.
export function renderJournalCss() {
  return `
#journal-toggle[hidden] { display: none; }
@media (max-width: 1279px) { #journal-toggle { width: 44px; height: 44px; } }
#journal-toggle[aria-expanded="true"] { color: var(--accent); border-color: var(--accent-line, var(--accent)); background: var(--accent-tint-2, var(--surface-2)); }
:root { --jr-w: 420px; }
.jr-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: var(--jr-w); z-index: 61;
  display: flex; flex-direction: column; min-width: 0;
  background: var(--surface); color: var(--text); border-left: 1px solid var(--border);
  box-shadow: -12px 0 32px -24px rgba(0, 0, 0, .55);
  font: 400 14px/1.5 var(--font-sans);
}
.jr-panel[hidden] { display: none; }
@media (min-width: 761px) {
  body.jr-on { padding-right: var(--jr-w); }
  body.jr-on .back-to-top { right: calc(var(--jr-w) + 16px); }
  body.jr-on .cmp-tray { left: calc((100vw - var(--jr-w)) / 2); max-width: calc(100vw - var(--jr-w) - 32px); }
  body.jr-on.split-on .split-view { right: var(--jr-w); }
  /* The page is narrower beside the panel: use the compact header (the
     same rules as a screen under 1280px wide) so no header button slides
     under the panel. */
  body.jr-on .brand-tag { display: none; }
}
@media (min-width: 1280px) {
  body.jr-on .site-header-lead, body.jr-on .site-nav { flex-shrink: 0; }
  body.jr-on #workspace-settings-toggle { display: inline-flex; width: 44px; height: 44px; }
  body.jr-on .workspace-settings-panel { display: none; position: absolute; right: 0; top: calc(100% + 10px); width: 250px; max-width: calc(100vw - 24px); padding: 14px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface); box-shadow: 0 12px 30px rgb(0 0 0 / .25); flex-wrap: wrap; }
  body.jr-on .workspace-settings-panel:has(#export-toggle:not([hidden])) { width: 300px; }
  body.jr-on .workspace-settings.is-open .workspace-settings-panel { display: flex; }
  body.jr-on .workspace-settings .time-zone-control { flex: 1; width: auto; padding: 0 8px; gap: 8px; }
  body.jr-on .workspace-settings .time-zone-control svg { display: block; }
  body.jr-on .workspace-settings .time-zone-control select { width: 100%; height: 44px; font-size: 16px; }
  body.jr-on .workspace-settings #theme-toggle, body.jr-on .workspace-settings #split-toggle, body.jr-on .workspace-settings #export-toggle { width: 44px; height: 44px; }
  body.jr-on .workspace-settings .lang-control { height: 44px; }
  body.jr-on .workspace-settings .auth-chip { width: 100%; justify-content: space-between; border-radius: 6px; }
  body.jr-on .workspace-settings .auth-chip .auth-name { display: inline; max-width: 120px; }
  body.jr-on .workspace-settings .auth-logout { min-height: 44px; display: inline-flex; align-items: center; }
  body.jr-on .site-nav .cmd-palette-trigger { width: 44px; min-width: 44px; height: 44px; padding: 0; justify-content: center; }
  body.jr-on .site-nav .cmd-palette-trigger-label, body.jr-on .site-nav .cmd-palette-trigger-kbd { display: none; }
  body.jr-on .site-nav .discord-btn { min-width: 44px; height: 44px; padding: 0; justify-content: center; }
  body.jr-on .site-nav .discord-btn span, body.jr-on .site-nav .donate-btn { display: none; }
  body.jr-on #journal-toggle { width: 44px; height: 44px; }
}
body.jr-resizing { cursor: col-resize; user-select: none; }
body.jr-resizing iframe { pointer-events: none; }
.jr-resize { position: absolute; left: -5px; top: 0; bottom: 0; width: 10px; cursor: col-resize; touch-action: none; z-index: 1; }
.jr-resize:hover, .jr-resize:focus-visible, body.jr-resizing .jr-resize { background: linear-gradient(90deg, transparent 4px, var(--accent) 4px, var(--accent) 6px, transparent 6px); outline: none; }
.jr-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 70%, var(--bg)); }
.jr-title { display: inline-flex; align-items: center; gap: 7px; font: 700 14px/1.2 var(--font-sans); color: var(--text-strong); white-space: nowrap; }
.jr-title svg { color: var(--accent); flex: none; }
.jr-tabs { display: inline-flex; margin-left: auto; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.jr-tab { height: 30px; padding: 0 12px; border: 0; background: transparent; color: var(--muted-strong, var(--muted)); font: 600 12.5px/1 var(--font-sans); cursor: pointer; }
.jr-tab.is-on { background: var(--accent-tint-2, var(--surface-2)); color: var(--accent); }
.jr-tab + .jr-tab { border-left: 1px solid var(--border); }
.jr-count { font-variant-numeric: tabular-nums; }
.jr-x { flex: none; width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--muted-strong, var(--muted)); font-size: 20px; line-height: 1; cursor: pointer; }
.jr-x:hover { color: var(--text-strong); border-color: var(--accent); }
.jr-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px 24px; }
.jr-now-line { margin: 0 0 8px; color: var(--muted); font-size: 12.5px; }
.jr-now-line span { color: var(--text-strong); font-weight: 600; font-variant-numeric: tabular-nums; }
.jr-editing { margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--accent-line, var(--accent)); border-radius: 8px; background: var(--accent-tint-2, var(--surface-2)); font-size: 12.5px; }
.jr-text { display: block; width: 100%; min-height: 140px; resize: vertical; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-strong, var(--border)); border-radius: 8px; background: var(--bg); color: var(--text-strong); font: 400 15px/1.55 var(--font-sans); }
.jr-text:focus, .jr-f input:focus, .jr-f select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.jr-call { margin: 10px 0; border: 1px solid var(--border); border-radius: 8px; padding: 0 10px; }
.jr-call summary { cursor: pointer; padding: 8px 0; font: 600 13px/1.3 var(--font-sans); color: var(--text-strong); }
.jr-call[open] { padding-bottom: 8px; }
.jr-call-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.jr-f { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 11.5px; color: var(--muted); }
.jr-f input, .jr-f select { height: 32px; min-width: 0; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-strong); font: 500 13px/1 var(--font-sans); }
.jr-tags { margin: 8px 0 12px; }
.jr-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.jr-seg button { height: 30px; padding: 0 9px; border: 0; background: var(--bg); color: var(--muted-strong, var(--muted)); font: 600 12px/1 var(--font-sans); cursor: pointer; white-space: nowrap; }
.jr-seg button + button { border-left: 1px solid var(--border); }
.jr-seg button[aria-pressed="true"] { background: var(--accent); color: var(--surface); }
.jr-hint { color: var(--muted); font-size: 12px; font-weight: 400; }
.jr-ev-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin: 6px 0; font: 600 13px/1.3 var(--font-sans); color: var(--text-strong); }
.jr-ev-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.jr-btn { display: inline-flex; align-items: center; height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-strong); font: 600 12.5px/1 var(--font-sans); cursor: pointer; white-space: nowrap; }
.jr-btn:hover { border-color: var(--accent); color: var(--accent); }
.jr-file { position: relative; }
.jr-ev-list { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 6px; }
.jr-ev-item { padding: 7px 9px; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; background: var(--bg); min-width: 0; }
.jr-ev-shot { border-left-color: var(--muted); }
.jr-ev-top { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.jr-ev-kind { flex: none; color: var(--accent); font: 700 10.5px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.jr-ev-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 12.5px/1.3 var(--font-sans); color: var(--text-strong); }
.jr-ev-x { margin-left: auto; flex: none; width: 24px; height: 22px; border: 0; background: transparent; color: var(--muted); font-size: 17px; line-height: 1; cursor: pointer; }
.jr-ev-x:hover { color: var(--down, #d33); }
.jr-ev-text { margin-top: 3px; font: 500 12.5px/1.45 var(--font-sans); color: var(--text); font-variant-numeric: tabular-nums; white-space: pre-wrap; overflow-wrap: anywhere; }
.jr-ev-meta { margin-top: 3px; color: var(--muted); font-size: 11.5px; overflow-wrap: anywhere; }
.jr-ev-meta a { color: var(--accent); }
.jr-shot { display: block; margin-top: 5px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); cursor: zoom-in; max-width: 100%; }
.jr-shot img { display: block; max-width: 100%; max-height: 220px; object-fit: contain; }
.jr-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; position: sticky; bottom: -24px; padding: 10px 0 14px; background: var(--surface); }
.jr-save { height: 36px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--accent); color: var(--surface); font: 700 13.5px/1 var(--font-sans); cursor: pointer; }
.jr-save:hover { filter: brightness(1.08); }
.jr-link { padding: 2px 0; border: 0; background: transparent; color: var(--accent); font: 600 12.5px/1.3 var(--font-sans); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.jr-danger { color: var(--down, #d33); }
.jr-msg { font-size: 12.5px; color: var(--muted); }
.jr-msg.is-ok { color: var(--up, #1a9a5a); }
.jr-msg.is-bad { color: var(--down, #d33); }
.jr-keys { margin-top: 4px; }
.jr-filters { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; margin-bottom: 8px; }
.jr-q input { width: 100%; }
@media (max-width: 420px) { .jr-filters { grid-template-columns: 1fr 1fr; } .jr-q { grid-column: 1 / -1; } }
.jr-sum { margin-bottom: 8px; color: var(--muted); font-size: 12.5px; }
.jr-sum .up, .jr-since .up { color: var(--up, #1a9a5a); }
.jr-sum .down, .jr-since .down { color: var(--down, #d33); }
.jr-month { margin: 14px 0 6px; color: var(--muted); font: 700 11px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.jr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.jr-entry { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); min-width: 0; scroll-margin-top: 8px; }
.jr-entry.is-focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-tint-2, transparent); }
.jr-entry-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 4px; font-size: 12px; color: var(--muted); }
.jr-author { font-weight: 700; color: var(--text-strong); }
.jr-entry-head time { font-variant-numeric: tabular-nums; }
.jr-edited { padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; font-size: 10.5px; }
.jr-entry-text { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-strong); font-size: 14px; line-height: 1.55; }
.jr-callrow { margin: 2px 0 6px; font-size: 12.5px; color: var(--muted); }
.jr-call-dir { font-weight: 700; color: var(--text-strong); }
.jr-call-dir.jr-up { color: var(--up, #1a9a5a); }
.jr-call-dir.jr-down { color: var(--down, #d33); }
.jr-due { color: var(--warn, #b7791f); font-weight: 600; }
.jr-since { font-variant-numeric: tabular-nums; }
.jr-tagrow { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.jr-tag { padding: 2px 7px; border: 0; border-radius: 999px; background: var(--accent-tint-2, var(--surface-2)); color: var(--accent); font: 600 11.5px/1.3 var(--font-sans); cursor: pointer; }
.jr-mkt { margin-top: 6px; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.jr-outcome { margin-top: 8px; padding: 6px 9px; border-radius: 6px; font-size: 12.5px; background: var(--surface-2, var(--surface)); }
.jr-out-right { border-left: 3px solid var(--up, #1a9a5a); }
.jr-out-wrong { border-left: 3px solid var(--down, #d33); }
.jr-out-mixed { border-left: 3px solid var(--warn, #b7791f); }
.jr-outform { display: grid; gap: 6px; margin-top: 8px; }
.jr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.jr-actions { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; }
.jr-hist { margin: 8px 0 0; padding: 0 0 0 12px; border-left: 2px solid var(--border); list-style: none; display: grid; gap: 8px; }
.jr-hist .jr-entry-text { color: var(--muted-strong, var(--muted)); font-size: 13px; }
.jr-empty { color: var(--muted); font-size: 13px; }
.jr-more { text-align: center; margin: 12px 0 0; }
/* Pick mode: an outline follows the pointer; the bar says what a click does. */
.jr-hl { position: fixed; z-index: 990; pointer-events: none; border: 2px solid var(--accent); border-radius: 6px; background: color-mix(in srgb, var(--accent) 10%, transparent); transition: all .06s ease-out; }
.jr-hl.is-shot { border-style: dashed; }
.jr-hl[hidden] { display: none; }
.jr-pickbar { position: fixed; z-index: 991; left: 50%; bottom: max(16px, env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; max-width: calc(100vw - 24px); padding: 8px 12px; border: 1px solid var(--accent); border-radius: 10px; background: var(--surface); color: var(--text-strong); box-shadow: 0 10px 30px rgba(0, 0, 0, .3); font: 500 13px/1.35 var(--font-sans); }
.jr-pickbar [hidden] { display: none; }
@media (min-width: 761px) { body.jr-on .jr-pickbar { left: calc((100vw - var(--jr-w)) / 2); max-width: calc(100vw - var(--jr-w) - 24px); } }
body.jr-picking, body.jr-picking * { cursor: crosshair !important; }
body.jr-picking .jr-panel *, body.jr-picking .jr-pickbar * { cursor: auto !important; }
.jr-zoom { position: fixed; inset: 0; z-index: 995; display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, .78); }
.jr-zoom img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; background: var(--surface); }
.jr-zoom .jr-x { position: absolute; top: 12px; right: 12px; background: var(--surface); }
@media (max-width: 760px) {
  .jr-panel { left: 0; width: auto; z-index: 970; border-left: 0; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  .jr-resize { display: none; }
  .jr-panel.is-tucked { display: none; }
}
@media print { .jr-panel, .jr-hl, .jr-pickbar { display: none !important; } body.jr-on { padding-right: 0 !important; } }
`.trimEnd();
}
