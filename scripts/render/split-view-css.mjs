// Styles for split-view-js.mjs: the two-pane layout in the main window and
// the stripped-down page shown inside each pane (html.is-embed).
export function renderSplitViewCss() {
  return `
/* Header button (sits beside the light / dark switch). */
#split-toggle[aria-pressed="true"] { color: var(--accent); border-color: var(--accent-line, var(--accent)); background: var(--accent-tint-2, var(--surface-2)); }
#split-toggle[hidden] { display: none; }

/* Main window while split view is on: the header stays, the panes take the rest. */
.split-view { display: none; }
body.split-on { padding-left: 0 !important; overflow: hidden; }
body.split-on #main-content, body.split-on .site-footer, body.split-on .page-sub, body.split-on #freshness-banner,
body.split-on .side-nav, body.split-on .side-nav-backdrop, body.split-on #side-nav-toggle, body.split-on .phone-tabbar,
body.split-on .back-to-top, body.split-on .cmp-tray { display: none !important; }
body.split-on .split-view {
  display: flex; position: fixed; left: 0; right: 0; bottom: 0; top: var(--header-h); z-index: 50;
  padding: 8px max(8px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(8px, env(safe-area-inset-left, 0px));
  background: var(--bg);
}
.split-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--bg); }
.split-pane-a { flex: 0 0 calc(var(--split-r, 50) * 1% - 6px); }
.split-pane-b { flex: 1 1 0; }
.split-bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--surface); }
.split-pick { flex: 1 1 auto; min-width: 0; display: flex; }
.split-pick select { width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-strong); font: 600 13.5px/1.2 var(--font-sans); }
.split-btn { flex: 0 0 auto; height: 34px; padding: 0 11px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--muted-strong); font: 500 12.5px/1 var(--font-sans); cursor: pointer; white-space: nowrap; }
.split-btn:hover { border-color: var(--accent-line, var(--accent)); color: var(--text-strong); }
.split-close { width: 34px; padding: 0; font-size: 18px; }
.split-pick select:focus-visible, .split-btn:focus-visible, .split-divider:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.split-frame { flex: 1 1 auto; display: block; width: 100%; min-height: 0; border: 0; background: var(--bg); }
.split-divider { flex: 0 0 12px; display: grid; place-items: center; cursor: col-resize; touch-action: none; border-radius: 6px; }
.split-divider span { width: 4px; height: 44px; border-radius: 2px; background: var(--border-strong, var(--border)); }
.split-divider:hover span, .split-view.is-dragging .split-divider span { background: var(--accent); }
.split-view.is-dragging { cursor: col-resize; user-select: none; }
.split-view.is-dragging .split-frame { pointer-events: none; }
@media (max-width: 760px) {
  body.split-on .split-view { flex-direction: column; }
  .split-divider { cursor: row-resize; flex-basis: 14px; }
  .split-divider span { width: 44px; height: 4px; }
  .split-view.is-dragging { cursor: row-resize; }
  .split-btn[data-split-full] { display: none; }
}

/* Inside a pane: just the page, no site chrome around it. */
html.is-embed { --header-h: 0px; }
html.is-embed body { padding-left: 0 !important; }
html.is-embed .site-header, html.is-embed .side-nav, html.is-embed .side-nav-backdrop, html.is-embed .phone-tabbar,
html.is-embed .site-footer, html.is-embed .page-sub, html.is-embed .skip-content, html.is-embed .split-view { display: none !important; }
html.is-embed .back-to-top { bottom: max(16px, env(safe-area-inset-bottom, 0px)); }
html.is-embed .cmp-tray { bottom: 14px !important; }
html.is-embed #freshness-banner { margin-top: 8px; padding-block: 6px; }
`.trimEnd();
}
