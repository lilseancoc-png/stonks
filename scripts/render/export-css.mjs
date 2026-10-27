// Styles for export-js.mjs: the Owner-only Export button and menu, the
// outline on the part being exported, and the print layout that prints only
// that part.
export function renderExportCss() {
  return `
/* Header button (beside split view and the light / dark switch). */
#export-toggle[hidden] { display: none; }
#export-toggle[aria-expanded="true"] { color: var(--accent); border-color: var(--accent-line, var(--accent)); background: var(--accent-tint-2, var(--surface-2)); }
@media (max-width: 1279px) {
  .workspace-settings #export-toggle { width: 44px; height: 44px; }
  /* One more button in the settings pop-over: keep room for the time zone. */
  .workspace-settings-panel:has(#export-toggle:not([hidden])) { width: 300px; }
}

.export-panel {
  position: fixed; z-index: 1200; top: 64px; right: 12px; width: 360px; max-width: calc(100vw - 24px);
  max-height: calc(100vh - 88px); overflow: auto; overscroll-behavior: contain;
  padding: 14px; border: 1px solid var(--border-strong, var(--border)); border-radius: 12px;
  background: var(--surface); color: var(--text); box-shadow: 0 16px 40px rgb(0 0 0 / .22);
  font: 400 14px/1.4 var(--font-sans);
}
.export-panel[hidden] { display: none; }
.export-panel.is-busy .export-fmt, .export-panel.is-busy .export-src { opacity: .55; pointer-events: none; }
.export-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.export-head b { display: block; font-size: 15px; color: var(--text-strong); }
.export-head span { display: block; font-size: 12.5px; color: var(--muted); }
.export-x { width: 32px; height: 32px; min-height: 32px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--muted-strong, var(--muted)); font-size: 18px; line-height: 1; cursor: pointer; }
.export-parts { margin: 0 0 12px; padding: 0; border: 0; display: grid; gap: 2px; }
.export-parts legend, .export-sources > span { padding: 0; margin-bottom: 6px; font: 600 11px/1.2 var(--font-mono, monospace); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.export-part { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 6px; cursor: pointer; color: var(--text-strong); }
.export-part:hover { background: var(--surface-2); }
.export-part input { flex: 0 0 auto; margin: 0; accent-color: var(--accent); width: 16px; height: 16px; }
.export-part span { min-width: 0; overflow-wrap: anywhere; }
.export-fmts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.export-fmt, .export-src {
  min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px;
  background: var(--bg); color: var(--text-strong); font: 600 13px/1.2 var(--font-sans); text-align: left; cursor: pointer;
}
.export-fmt:hover:not(:disabled), .export-src:hover { border-color: var(--accent-line, var(--accent)); }
.export-fmt:disabled { opacity: .45; cursor: not-allowed; }
.export-fmt-data { background: var(--surface-2); }
.export-x:focus-visible, .export-fmt:focus-visible, .export-src:focus-visible, .export-part input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.export-sources { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.export-sources > span { flex: 1 0 100%; margin-bottom: 0; }
.export-src { min-height: 32px; font: 500 12px/1.2 var(--font-mono, monospace); }
.export-status { margin: 10px 0 0; min-height: 1.2em; font-size: 12.5px; color: var(--muted-strong, var(--muted)); }
.export-status:empty { display: none; }
.export-status.is-bad { color: var(--down, #c0392b); }
.export-empty { margin: 4px 0 0; color: var(--muted-strong, var(--muted)); }
@media (max-width: 640px) {
  .export-panel { top: auto !important; right: 8px !important; left: 8px; bottom: max(8px, env(safe-area-inset-bottom, 0px)); width: auto; max-width: none; max-height: 78vh; border-radius: 14px; }
  .export-fmt, .export-src { min-height: 44px; font-size: 14px; }
  .export-part { min-height: 40px; }
}

/* The part that will be exported, outlined while the menu is open. */
.export-target { outline: 2px dashed var(--accent); outline-offset: 4px; border-radius: 4px; }
.export-hide { display: none !important; }
.export-cover { position: fixed; inset: 0; z-index: 1300; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 70%, transparent); }
.export-cover span { padding: 10px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-strong); font: 600 14px/1.2 var(--font-sans); box-shadow: 0 8px 24px rgb(0 0 0 / .18); }

/* Print / Save as PDF prints only the chosen part. */
.export-print-head { display: none; }
@media print {
  html.exporting-print, html.exporting-print body { background: var(--bg) !important; padding: 0 !important; margin: 0 !important; overflow: visible !important; height: auto !important; }
  html.exporting-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html.exporting-print body *:not(.export-print-path):not(.export-print-target):not(.export-print-target *):not(.export-print-head):not(.export-print-head *) { display: none !important; }
  html.exporting-print .export-print-path { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; max-width: none !important; width: auto !important; transform: none !important; overflow: visible !important; }
  html.exporting-print .export-print-target { margin: 0 !important; max-width: none !important; overflow: visible !important; }
  html.exporting-print .export-print-head { display: flex !important; justify-content: space-between; gap: 12px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); font: 13px/1.3 var(--font-sans); color: var(--muted); }
  html.exporting-print .export-print-head b { color: var(--text-strong); font-size: 16px; }
  html.exporting-print .export-target { outline: 0; }
}
`;
}
