export function researchLabCss() { return `
body:not(.research-lab-enabled) [data-page-tab="research-lab"],body:not(.research-lab-enabled) #page-pane-research-lab,body:not(.research-lab-enabled) [data-go="research-lab"],body:not(.research-lab-enabled) a[href="/?tab=research-lab"]{display:none!important}
.rl{--rl-data:#447c8c;--rl-signal:#a17d37;--rl-result:#6f8771;--rl-scenario:#947092;min-width:0}
.rl button,.rl input,.rl select,.rl textarea{font:inherit}
.rl button{cursor:pointer;border:1px solid var(--border-strong);border-radius:7px;background:var(--surface-2);color:var(--text);padding:8px 11px;min-height:36px}
.rl button:hover:not(:disabled){border-color:var(--accent);background:var(--surface-3)}
.rl button:disabled{opacity:.45;cursor:default}
.rl :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.rl input,.rl select,.rl textarea{background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:6px;padding:8px;width:100%;min-width:0;box-sizing:border-box}
.rl input[type=checkbox]{width:auto;accent-color:var(--accent)}
.rl textarea{resize:vertical;min-height:70px}
.rl label{display:grid;gap:5px;font-size:12px;color:var(--muted-strong)}
.rl label small,.rl small{color:var(--muted-strong);line-height:1.5}
.rl-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}
.rl-head h2{margin:6px 0;font-size:30px;letter-spacing:-.04em}.rl-head p{max-width:720px;color:var(--muted-strong);line-height:1.6;margin:8px 0}
.rl-eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent)}
.rl-badge{display:inline-flex;align-items:center;border:1px solid var(--border-strong);border-radius:20px;padding:5px 9px;font-size:11px;white-space:nowrap}
.rl-toolbar,.rl-tabs,.rl-inline{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.rl-tabs{border-bottom:1px solid var(--border);padding-bottom:12px;margin:18px 0}
.rl-tabs button[aria-selected=true]{border-color:var(--accent);color:var(--accent)}
.rl-message{padding:12px 14px;border:1px solid var(--border-strong);border-left:3px solid var(--accent);border-radius:6px;margin:12px 0;white-space:pre-wrap;line-height:1.6;overflow-wrap:anywhere}
.rl-message.error{border-left-color:var(--neg)}.rl-message:empty{display:none}
.rl-panel{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:16px;margin:12px 0;min-width:0}
.rl-panel h3{margin:0 0 12px;font-size:16px}.rl-panel h4{margin:14px 0 8px;font-size:13px}
.rl-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}.rl-wide{grid-column:1/-1}
.rl-muted{color:var(--muted-strong);line-height:1.6;font-size:12px}.rl-warning{color:var(--muted-strong);border-left:2px solid var(--rl-signal);padding:7px 11px;margin:7px 0;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.rl-workbench{display:grid;grid-template-columns:170px minmax(240px,1fr) 230px;gap:10px;margin:16px 0;min-height:510px}
.rl-library,.rl-inspector{border:1px solid var(--border);border-radius:9px;padding:12px;min-width:0;overflow-wrap:anywhere;background:var(--surface)}
.rl-library h3,.rl-inspector h3{font-size:13px;margin:2px 0 10px}
.rl-library-list{max-height:565px;overflow:auto;margin-top:10px;display:grid;gap:7px}
.rl-library button{text-align:left;padding:9px;font-size:11px;border-left:3px solid var(--rl-data)}
.rl-library button[data-category=Signals],.rl-library button[data-category=Logic]{border-left-color:var(--rl-signal)}
.rl-library button[data-category=Scenario]{border-left-color:var(--rl-scenario)}
.rl-library button[data-category=Validation],.rl-library button[data-category=Output]{border-left-color:var(--rl-result)}
.rl-library button small{display:block;font-size:10px;margin-top:4px}
.rl-canvas-shell{position:relative;min-width:0;border:1px solid var(--border-strong);border-radius:9px;overflow:hidden;background:var(--bg)}
.rl-canvas-tools{display:flex;gap:6px;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--border);background:var(--surface)}
.rl-canvas-tools button{min-height:30px;padding:4px 7px;font-size:11px}
.rl-scroll{height:480px;overflow:auto;position:relative;background-image:radial-gradient(var(--border-strong) 1px,transparent 1px);background-size:20px 20px}
.rl-plane{position:relative;transform-origin:0 0;min-width:1500px;min-height:700px}
.rl-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}
.rl-edges path{stroke:var(--muted-strong);stroke-width:1.5;fill:none}.rl-edges text{fill:var(--muted-strong);font-size:10px}
.rl-node{position:absolute;width:220px;background:var(--surface);border:1px solid var(--border-strong);border-top:3px solid var(--rl-data);border-radius:9px;box-shadow:0 5px 15px #0001;overflow:hidden}
.rl-node.selected{outline:2px solid var(--accent);outline-offset:3px}.rl-node[data-category=Signals],.rl-node[data-category=Logic]{border-top-color:var(--rl-signal)}
.rl-node[data-category=Scenario]{border-top-color:var(--rl-scenario)}.rl-node[data-category=Output],.rl-node[data-category=Validation]{border-top-color:var(--rl-result)}
.rl-node .rl-node-title{width:100%;border:none;border-radius:0;text-align:left;background:transparent;font-size:12px;padding:12px;cursor:grab}
.rl-node .rl-node-title{touch-action:none}.rl-ports button.rl-compatible{border-color:var(--accent);outline:1px solid var(--accent)}.rl-source-list{max-height:650px;overflow:auto}.rl-source-list a{color:var(--accent);font-size:12px}
.rl-node-kind{font-size:10px;color:var(--muted-strong);padding:0 12px 8px}
.rl-ports{display:grid;gap:5px;padding:8px;border-top:1px solid var(--border)}.rl-port-row{display:flex;justify-content:space-between;gap:8px}
.rl-ports button{font-size:10px;padding:4px 6px;min-height:27px;border-radius:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.rl-port-out{margin-left:auto}.rl-ports button.pending{outline:2px solid var(--accent)}
.rl-minimap{position:absolute;right:10px;bottom:10px;width:125px;height:65px;background:var(--surface);border:1px solid var(--border-strong);border-radius:5px;opacity:.9}
.rl-minimap rect{fill:var(--accent);opacity:.65}.rl-inspector label{margin:12px 0}.rl-port-info{font-size:10px;color:var(--muted-strong);line-height:1.65;margin:7px 0}
.rl-connections{display:grid;gap:8px}.rl-connection{display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:11px;overflow-wrap:anywhere}
.rl-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:12px 0}
.rl-metric{border:1px solid var(--border);border-radius:8px;padding:13px}.rl-metric strong{display:block;font-size:24px;letter-spacing:-.03em;margin:7px 0}.rl-metric span{font-size:11px;color:var(--muted-strong)}
.rl-table-wrap{overflow:auto;max-width:100%}.rl table{border-collapse:collapse;width:100%;font-size:11px}.rl th,.rl td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap}.rl th{color:var(--muted-strong);font-weight:500}.rl td:last-child{white-space:normal;min-width:100px}
.rl-chart{width:100%;height:190px;display:block}.rl-chart path{stroke:var(--accent);fill:none;stroke-width:2}.rl-chart line{stroke:var(--border-strong)}
.rl-progress{height:7px;border-radius:9px;background:var(--surface-3);overflow:hidden;margin:12px 0}.rl-progress span{display:block;height:100%;background:var(--accent)}
.rl pre{font-size:11px;line-height:1.6;max-height:400px;overflow:auto;background:var(--bg);padding:12px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.rl-log{display:grid;gap:8px;max-height:500px;overflow:auto}.rl-log div{padding:9px;border-bottom:1px solid var(--border);font-size:11px}
.rl-check{display:flex!important;align-items:center;gap:8px!important}.rl-exp{padding:12px 0;border-bottom:1px solid var(--border)}.rl-exp h4{margin:0 0 6px}.rl-exp p{font-size:12px;margin:6px 0;color:var(--muted-strong)}
.rl-empty{padding:32px 15px;text-align:center;color:var(--muted-strong);line-height:1.8}
@media(min-width:1500px){.rl-workbench{grid-template-columns:190px minmax(300px,1fr) 260px}.rl-scroll{height:550px}}
@media(max-width:1150px){.rl-workbench{grid-template-columns:145px minmax(220px,1fr)}.rl-inspector{grid-column:1/-1}.rl-library-list{max-height:480px}}
@media(max-width:650px){.rl-head{display:block}.rl-head h2{font-size:26px}.rl-workbench{grid-template-columns:minmax(0,1fr)}.rl-library-list{display:flex;max-height:120px;overflow:auto}.rl-library button{min-width:150px}.rl-scroll{height:380px}.rl-inspector{grid-column:auto}.rl-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.rl-tabs{gap:5px}.rl-tabs button{font-size:11px;padding:6px 9px}.rl-panel{padding:12px}.rl-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.rl-toolbar button{flex:1 1 40%}.rl-inline>*{max-width:100%}}
`; }
