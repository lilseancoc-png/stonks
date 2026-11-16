// Browser code for the "AI disruption" page (Phase 2, 2026-11-16,
// lib/ai-disruption/). Pasted into the app.js IIFE after prediction-client.mjs,
// so it may use the vn* helpers, VIEWS, escapeHtml and dataUrl. ES5 only,
// inside a template string: write regex escapes as \\d, no backticks, no
// straight apostrophes inside single-quoted strings (use a curly one).
//
// Public tabs read ai-disruption.json: the launch log (with the "auto" badge
// until the Owner confirms a row), the capability board and the companies each
// launch targets. Facts about lab products only; no stock is scored here.
// The Owner tab (Review) reads ai-disruption-owner.json and the decisions from
// /api/auth/ai-disruption-review, requested only when HAS_OWNER_ACCESS is true,
// and posts confirm / fix / reject clicks there. The next update applies them.
//
// Also exported to the rest of app.js: aiDisruptionStockStripHtml(pub, sym)
// for the stock page and aiDisruptionPublicJson().
export function renderAiDisruptionJs() {
  return `
  // ---- AI disruption -----------------------------------------------------------
  var AID_TABS = [['log', 'Launch log'], ['board', 'Capability board'], ['companies', 'Companies']];
  var AID_OWNER_TABS = [['review', 'Review queue'], ['scorecard', 'Scorecard']];
  var AID_LAB_COLOR = { openai: '#10a37f', anthropic: '#c96442', google: '#4285f4', microsoft: '#7f56d9', meta: '#0866ff', xai: '#6b7280' };
  var AID_AVAIL = { preview: 'Preview', beta: 'Beta', ga: 'Generally available' };
  var AID_AUTO = { draft: 'Drafts for a person', approve: 'Acts with approval', unattended: 'Works unattended' };
  var AID_PLAN = { free: 'Free', consumer: 'Paid personal', business: 'Business', enterprise: 'Enterprise', api: 'API' };
  var AID_ROLE = { core: 'core product', addon: 'add-on', adjacent: 'adjacent' };
  var aidState = { data: null, owner: null, decisions: null, loading: false, ownerLoading: false, error: null, fetchedAt: 0, urlRead: false, saving: {}, note: {} };
  // The page router drops ?view= for every page but the stock page before the
  // data arrives, so the deep link is read from the address at load.
  var AID_BOOT_QS = (function(){ try { return location.search || ''; } catch (_) { return ''; } })();
  function aidView(key, dflt){ return VIEWS.get('aidisruption.' + key, dflt); }
  function aidSetView(key, v){ VIEWS.set('aidisruption.' + key, v); }
  function aidCapName(d, id){
    var c = (d.capabilities || []).filter(function(x){ return x.id === id; })[0];
    return c ? c.name : id;
  }
  function aidLabName(d, id){
    var l = (d.labs || []).filter(function(x){ return x.id === id; })[0];
    return l ? l.name : id;
  }
  function aidLabTag(d, id){
    return '<span class="aid-lab" style="--aid-lab:' + (AID_LAB_COLOR[id] || '#888') + '">' + escapeHtml(aidLabName(d, id)) + '</span>';
  }
  function aidSafeUrl(u){ return u && /^https:\\/\\/[a-z0-9.-]+\\//i.test(u) ? u : null; }
  function aidStatus(l){
    return l.status === 'confirmed'
      ? '<span class="aid-badge aid-badge-ok" title="Checked by the site owner' + (l.edited ? '; the tags were fixed by hand' : '') + '">confirmed' + (l.edited ? ' · fixed' : '') + '</span>'
      : '<span class="aid-badge aid-badge-auto" title="Tagged by the site’s rules from the lab’s own post; not yet checked by a person">auto</span>';
  }
  function aidScore(s){
    if (s == null || !isFinite(s)) return '<span class="vt-na">—</span>';
    var n = Math.max(0, Math.min(100, Number(s)));
    return '<span class="aid-score" title="Customer-capture score, 0 to 100: how ready this launch is to pull paying customers away from traditional software"><span class="aid-score-bar" aria-hidden="true"><i style="width:' + n.toFixed(0) + '%"></i></span><b>' + n.toFixed(0) + '</b></span>';
  }
  function aidTargetsHtml(l, max){
    var list = (l.targets || []).slice(0, max || 5);
    if (!list.length) return '<span class="vt-na">—</span>';
    return '<span class="aid-targets">' + list.map(function(t){
      var label = escapeHtml(t.company.length <= 6 && /^[A-Z.]+$/.test(t.company) ? t.company : t.name);
      var tip = escapeHtml(t.name + ': ' + (AID_ROLE[t.role] || t.role) + ' in ' + t.capability.replace(/_/g, ' ') + '. ' + (t.outcome === 'obsolescence' ? 'A direct replacement of a core product (flagged for review).' : t.outcome === 'business-model' ? 'Could change how it earns from a core product.' : t.outcome === 'commoditization' ? 'Could turn a paid add-on into a free feature.' : 'Worth watching.'));
      var cls = 'aid-t aid-t-' + escapeHtml(t.outcome || 'watch') + (t.coverage === 'covered' ? ' aid-t-covered' : '');
      return t.coverage === 'covered' ? '<a class="' + cls + '" href="' + escapeHtml(vnHref(t.company)) + '" title="' + tip + '">' + label + '</a>' : '<span class="' + cls + '" title="' + tip + '">' + label + '</span>';
    }).join('') + ((l.targets || []).length > list.length ? '<small class="crd-dim">+' + ((l.targets || []).length - list.length) + '</small>' : '') + '</span>';
  }
  function aidLaunchTitle(l){
    var url = aidSafeUrl(l.link || l.source);
    var t = escapeHtml(l.title || l.id);
    return '<span class="aid-title">' + (url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : t) + '</span> <small class="crd-dim">' + escapeHtml(l.product || '') + '</small> ' + aidStatus(l);
  }
  function aidDay(iso){
    var t = Date.parse(String(iso || '').slice(0, 10) + 'T12:00:00Z');
    if (!isFinite(t)) return String(iso || '');
    try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } catch (_) { return String(iso).slice(0, 10); }
  }
  function aidWithin(dateIso, days){
    var t = Date.parse(String(dateIso) + 'T12:00:00Z');
    return isFinite(t) && Date.now() - t <= days * 86400000;
  }
  function aidKpis(d){
    var c = d.counts || {};
    var src = d.sources || [];
    var ok = src.filter(function(s){ return s.ok; }).length;
    var k = [
      ['Launches logged', String(c.launches || 0)],
      ['Last 30 days', String(c.last30 || 0)],
      ['Checked by the owner', String(c.confirmed || 0) + '<small class="aid-kpi-sub">the rest carry the auto badge</small>'],
      ['Lab sources read', src.length ? ok + ' of ' + src.length : '—'],
    ];
    return '<div class="mm-kpis">' + k.map(function(x){ return '<div class="mm-kpi"><span>' + escapeHtml(x[0]) + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>';
  }
  function aidChips(list, current, attr){
    return '<div class="aid-chips">' + list.map(function(o){
      return '<button type="button" class="aid-chip' + (o[0] === current ? ' is-on' : '') + '" ' + attr + '="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function aidLogHtml(d){
    var lab = aidView('lab', 'all'), cap = aidView('cap', 'all'), status = aidView('status', 'all'), company = aidView('company', '');
    var rows = (d.launches || []).filter(function(l){
      if (lab !== 'all' && l.lab !== lab) return false;
      if (cap !== 'all' && (l.capabilities || []).indexOf(cap) < 0) return false;
      if (status !== 'all' && l.status !== status) return false;
      if (company && !(l.targets || []).some(function(t){ return t.company === company; })) return false;
      return true;
    });
    var caps = (d.capabilities || []).filter(function(c){ return (d.launches || []).some(function(l){ return (l.capabilities || []).indexOf(c.id) >= 0; }); });
    var h = aidChips([['all', 'All labs']].concat((d.labs || []).map(function(l){ return [l.id, l.name]; })), lab, 'data-aid-lab') +
      '<div class="aid-filters"><label>Capability <select data-aid-cap><option value="all">All capabilities</option>' + caps.map(function(c){ return '<option value="' + escapeHtml(c.id) + '"' + (c.id === cap ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>'; }).join('') + '</select></label>' +
      aidChips([['all', 'Any status'], ['auto', 'Auto'], ['confirmed', 'Confirmed']], status, 'data-aid-status') +
      (company ? '<button type="button" class="aid-chip is-on" data-aid-company="" title="Show every company">Targets ' + escapeHtml(company) + ' ✕</button>' : '') + '</div>';
    h += VIEWS.tableHtml([
      { label: 'Launch', cls: 'aid-c-wide', cell: function(l){ return aidLabTag(d, l.lab) + ' ' + aidLaunchTitle(l); }, sort: function(l){ return l.title; } },
      { label: 'Date', cls: 'aid-c-date', cell: function(l){ return escapeHtml(aidDay(l.date)); }, sort: function(l){ return l.date; } },
      { label: 'Does', cls: 'aid-c-mid', cell: function(l){ return '<span class="aid-caps">' + (l.capabilities || []).map(function(c){ return '<span>' + escapeHtml(aidCapName(d, c)) + '</span>'; }).join('') + '</span><small class="crd-dim aid-sub">' + escapeHtml((d.labels && d.labels.how && d.labels.how[l.how]) || l.how || '') + '</small>'; }, nosort: true },
      { label: 'Who can use it', cls: 'aid-c-mid', cell: function(l){ return escapeHtml((l.plans || []).map(function(p){ return AID_PLAN[p] || p; }).join(', ') || 'Shown, not sold') + '<small class="crd-dim aid-sub">' + escapeHtml(AID_AVAIL[l.availability] || l.availability) + ' · ' + escapeHtml(AID_AUTO[l.autonomy] || l.autonomy) + '</small>'; }, nosort: true },
      { label: 'Score', num: true, cell: function(l){ return aidScore(l.score); }, sort: function(l){ return l.score; }, title: 'Customer-capture score, 0 to 100' },
      { label: 'Targets', cls: 'aid-c-mid', cell: function(l){ return aidTargetsHtml(l, 5); }, sort: function(l){ return (l.targets || []).length; } },
    ], rows, { key: 'aid-log', cls: 'aid-log', empty: 'No launch matches these filters.' });
    return h;
  }
  function aidBoardHtml(d){
    var board = d.board || {};
    var labs = d.labs || [];
    var caps = (d.capabilities || []).filter(function(c){ return board[c.id]; }).map(function(c){
      var cells = board[c.id], best = 0;
      labs.forEach(function(l){ if (cells[l.id] && cells[l.id].score > best) best = cells[l.id].score; });
      return { c: c, cells: cells, best: best };
    }).sort(function(a, b){ return b.best - a.best; });
    var byId = {};
    (d.launches || []).forEach(function(l){ byId[l.id] = l; });
    var h = '<p class="aid-lede">For each capability, the best customer-capture score each lab has shipped so far. A darker cell is a launch closer to replacing a paid product: broadly sold, doing more of the job, working with less supervision.</p>';
    h += '<div class="vt-wrap"><table class="vt-table aid-board" data-nosort><thead><tr><th>Capability</th>' + labs.map(function(l){ return '<th class="num">' + escapeHtml(l.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    caps.forEach(function(r){
      h += '<tr><td><button type="button" class="aid-linkbtn" data-aid-goto-cap="' + escapeHtml(r.c.id) + '" title="' + escapeHtml(r.c.does) + '">' + escapeHtml(r.c.name) + '</button></td>';
      labs.forEach(function(l){
        var cell = r.cells[l.id];
        if (!cell || !cell.score){ h += '<td class="num aid-cell aid-cell-none">—</td>'; return; }
        var ln = byId[cell.launch];
        var tip = (ln ? ln.title + ' (' + cell.date + ')' : cell.date) + (cell.prior ? ' · was ' + cell.prior : '') + ' · ' + cell.launches + ' launch' + (cell.launches === 1 ? '' : 'es');
        h += '<td class="num aid-cell" style="--aid-heat:' + Math.max(0, Math.min(100, Math.round((cell.score - 40) * 2))) + '" title="' + escapeHtml(tip) + '">' + cell.score + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }
  function aidCompaniesHtml(d){
    var only = aidView('covered', 'covered');
    var counts = {}, latest = {};
    (d.launches || []).forEach(function(l){
      if (!aidWithin(l.date, 90)) return;
      (l.targets || []).forEach(function(t){
        counts[t.company] = (counts[t.company] || 0) + 1;
        if (!latest[t.company] || latest[t.company].date < l.date) latest[t.company] = { date: l.date, title: l.title, outcome: t.outcome };
      });
    });
    var list = (d.companies || []).filter(function(c){ return only === 'all' || c.coverage === 'covered'; });
    var h = aidChips([['covered', 'Covered stocks'], ['all', 'Every company named']], only, 'data-aid-covered') +
      '<p class="aid-lede">Which companies sell what the labs are shipping, and how a launch could reach them. Descriptions only: nothing here rates a stock. Companies outside the site’s covered list are named so a launch can be explained, and are never priced or tested.</p>';
    h += VIEWS.tableHtml([
      { label: 'Company', cls: 'aid-c-mid', cell: function(c){ return c.coverage === 'covered' ? '<a href="' + escapeHtml(vnHref(c.id)) + '">' + escapeHtml(c.id) + '</a> <small class="crd-dim">' + escapeHtml(c.name) + '</small>' : escapeHtml(c.name) + ' <small class="crd-dim">' + (c.coverage === 'private' ? 'private' : escapeHtml(c.id)) + '</small>'; }, sort: function(c){ return c.name; } },
      { label: 'What it sells that the labs now ship', cls: 'aid-c-wide', cell: function(c){ return '<span class="aid-caps">' + (c.exposures || []).map(function(e){ return '<span title="' + escapeHtml(e.how || '') + '">' + escapeHtml(aidCapName(d, e.capability)) + ' <small>' + escapeHtml(AID_ROLE[e.role] || e.role) + '</small></span>'; }).join('') + '</span>'; }, nosort: true },
      { label: 'Launches, 90 days', num: true, cell: function(c){ var n = counts[c.id] || 0; return n ? '<button type="button" class="aid-linkbtn" data-aid-company="' + escapeHtml(c.id) + '">' + n + '</button>' : '0'; }, sort: function(c){ return counts[c.id] || 0; } },
      { label: 'Latest', cls: 'aid-c-mid', cell: function(c){ var x = latest[c.id]; return x ? escapeHtml(x.title) + ' <small class="crd-dim">' + escapeHtml(aidDay(x.date)) + '</small>' : ''; }, sort: function(c){ return latest[c.id] ? latest[c.id].date : ''; } },
      { label: 'Its defense', cls: 'aid-c-wide', cell: function(c){ return '<small>' + escapeHtml(c.defense || '') + '</small>'; }, nosort: true },
    ], list, { key: 'aid-companies', cls: 'aid-co', empty: 'No company to show.' });
    return h;
  }

  // ---- Owner review --------------------------------------------------------------
  function aidDecisionOf(id){ return aidState.decisions && aidState.decisions.decisions ? aidState.decisions.decisions[id] || null : null; }
  function aidPendingTag(id){
    var dc = aidDecisionOf(id);
    if (!dc) return '';
    var word = dc.act === 'reject' ? 'rejected' : dc.act === 'edit' ? 'fixed' : 'confirmed';
    return '<span class="aid-badge aid-badge-pending" title="Saved; the next site update applies it">' + word + ' · applies next update</span> <button type="button" class="aid-linkbtn" data-aid-act="undo" data-aid-id="' + escapeHtml(id) + '">Undo</button>';
  }
  function aidFixForm(d, row){
    var f = row || {};
    var lab = (d.labs || []).filter(function(l){ return l.id === f.lab; })[0] || { products: [] };
    var caps = f.capabilities || [];
    var plans = f.plans || [];
    var sel = function(name, opts, cur){ return '<select name="' + name + '">' + opts.map(function(o){ return '<option value="' + escapeHtml(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>'; }).join('') + '</select>'; };
    return '<form class="aid-fix" data-aid-fix="' + escapeHtml(f.id) + '">' +
      '<label class="aid-fix-wide">Title <input name="title" maxlength="120" value="' + escapeHtml(f.title || '') + '"></label>' +
      '<label>Product ' + sel('product', lab.products.map(function(p){ return [p, p]; }), f.product || lab.products[0]) + '</label>' +
      '<label>How it hits ' + sel('how', [['direct', 'Direct replacement'], ['workflow', 'Workflow displacement'], ['platform', 'Platform consolidation']], f.how || 'direct') + '</label>' +
      '<label>Availability ' + sel('availability', [['preview', 'Preview'], ['beta', 'Beta'], ['ga', 'Generally available']], f.availability || 'preview') + '</label>' +
      '<label>Autonomy ' + sel('autonomy', [['draft', 'Drafts for a person'], ['approve', 'Acts with approval'], ['unattended', 'Works unattended']], f.autonomy || 'draft') + '</label>' +
      '<label>Coverage ' + sel('coverage', [[0, '0 · none'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5 · the whole job']], f.coverage == null ? 2 : f.coverage) + '</label>' +
      '<fieldset><legend>Plans</legend>' + ['free', 'consumer', 'business', 'enterprise', 'api'].map(function(p){ return '<label class="aid-check"><input type="checkbox" name="plan" value="' + p + '"' + (plans.indexOf(p) >= 0 ? ' checked' : '') + '> ' + AID_PLAN[p] + '</label>'; }).join('') + '</fieldset>' +
      '<fieldset class="aid-fix-wide"><legend>Capabilities (1 to 6)</legend>' + (d.capabilities || []).map(function(c){ return '<label class="aid-check"><input type="checkbox" name="cap" value="' + escapeHtml(c.id) + '"' + (caps.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + escapeHtml(c.name) + '</label>'; }).join('') + '</fieldset>' +
      '<div class="aid-fix-wide aid-actions"><button type="submit" class="aid-btn aid-btn-primary">Save fix</button> <span class="aid-msg">' + escapeHtml(aidState.note[f.id] || '') + '</span></div></form>';
  }
  function aidActionsHtml(id){
    if (aidDecisionOf(id)) return aidPendingTag(id);
    var busy = aidState.saving[id];
    return '<span class="aid-actions">' +
      '<button type="button" class="aid-btn" data-aid-act="confirm" data-aid-id="' + escapeHtml(id) + '"' + (busy ? ' disabled' : '') + '>Confirm</button>' +
      '<button type="button" class="aid-btn" data-aid-act="fix" data-aid-id="' + escapeHtml(id) + '"' + (busy ? ' disabled' : '') + '>Fix</button>' +
      '<button type="button" class="aid-btn aid-btn-neg" data-aid-act="reject" data-aid-id="' + escapeHtml(id) + '"' + (busy ? ' disabled' : '') + '>Reject</button>' +
      (aidState.note[id] ? ' <span class="aid-msg">' + escapeHtml(aidState.note[id]) + '</span>' : '') + '</span>';
  }
  function aidReviewHtml(d){
    var o = aidState.owner;
    if (!o) return '<p class="crd-empty">' + (aidState.ownerLoading ? 'Loading the review queue…' : 'The review queue is written by the next site update.') + '</p>';
    var rv = o.review || {};
    var openFix = aidView('fix', '');
    var h = '<div class="mm-kpis">' +
      '<div class="mm-kpi"><span>Waiting for review</span><b>' + (o.queue || []).length + '</b></div>' +
      '<div class="mm-kpi"><span>Auto rows not checked</span><b>' + ((d.counts && d.counts.auto) || 0) + '</b></div>' +
      '<div class="mm-kpi"><span>Rules’ tags kept as they were</span><b>' + (rv.rulesKept == null ? '—' : rv.rulesKept + '%') + '<small class="aid-kpi-sub">' + ((rv.confirmedAsIs || 0) + (rv.edited || 0)) + ' rows reviewed</small></b></div>' +
      '<div class="mm-kpi"><span>Rejected</span><b>' + (rv.rejected || 0) + '</b></div></div>';
    h += '<p class="aid-lede">Confirm a row when the rules got it right, fix its tags when they did not (a fix also confirms it), and reject anything that is not a launch. Clicks save at once and show on the public page from the next site update.</p>';
    h += '<h3 class="aid-h3">Posts the rules could not place</h3>';
    var queue = o.queue || [];
    if (!queue.length) h += '<p class="crd-empty">Nothing waiting.</p>';
    queue.forEach(function(q){
      var s = q.suggestion || {};
      var url = aidSafeUrl(q.url);
      h += '<div class="aid-q"><div class="aid-q-head">' + aidLabTag(d, q.lab) + ' <b>' + (url ? '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(q.title) + '</a>' : escapeHtml(q.title)) + '</b> <small class="crd-dim">' + escapeHtml(q.date) + ' · ' + escapeHtml(q.source || '') + '</small></div>' +
        (q.text ? '<p class="aid-q-text">' + escapeHtml(q.text) + '</p>' : '') +
        '<p class="aid-q-why">Why it is here: ' + escapeHtml((q.needs && q.needs.length ? ['the saved fix still needs ' + q.needs.join(', ')] : q.reasons || []).join('; ')) +
        (s.capabilities && s.capabilities.length ? ' · rules’ guess: ' + escapeHtml(s.capabilities.map(function(c){ return aidCapName(d, c); }).join(', ')) : '') + '</p>' +
        (aidDecisionOf(q.id) ? aidPendingTag(q.id) : '<span class="aid-actions"><button type="button" class="aid-btn" data-aid-act="fix" data-aid-id="' + escapeHtml(q.id) + '">Add to the log…</button><button type="button" class="aid-btn aid-btn-neg" data-aid-act="reject" data-aid-id="' + escapeHtml(q.id) + '">Not a launch</button>' + (aidState.note[q.id] ? ' <span class="aid-msg">' + escapeHtml(aidState.note[q.id]) + '</span>' : '') + '</span>') +
        (openFix === q.id && !aidDecisionOf(q.id) ? aidFixForm(d, Object.assign({ id: q.id, lab: q.lab, date: q.date, title: s.title || q.title }, s)) : '') + '</div>';
    });
    var autos = (d.launches || []).filter(function(l){ return l.status === 'auto'; }).slice(0, 40);
    h += '<h3 class="aid-h3">Auto rows to check (newest first)</h3>';
    h += VIEWS.tableHtml([
      { label: 'Launch', cls: 'aid-c-wide', cell: function(l){ return aidLabTag(d, l.lab) + ' ' + aidLaunchTitle(l); }, sort: function(l){ return l.title; } },
      { label: 'Date', cls: 'aid-c-date', cell: function(l){ return escapeHtml(aidDay(l.date)); }, sort: function(l){ return l.date; } },
      { label: 'Tags', cls: 'aid-c-mid', cell: function(l){ return '<span class="aid-caps">' + (l.capabilities || []).map(function(c){ return '<span>' + escapeHtml(aidCapName(d, c)) + '</span>'; }).join('') + '</span><small class="crd-dim aid-sub">' + escapeHtml(((l.plans || []).map(function(p){ return AID_PLAN[p] || p; }).join(', ') || 'Shown, not sold') + ' · ' + (AID_AVAIL[l.availability] || l.availability) + ' · ' + (AID_AUTO[l.autonomy] || l.autonomy) + ' · covers ' + l.coverage + ' of 5') + '</small>'; }, nosort: true },
      { label: 'Score', num: true, cell: function(l){ return aidScore(l.score); }, sort: function(l){ return l.score; } },
      { label: '', cell: function(l){ return aidActionsHtml(l.id); }, nosort: true },
    ], autos, { key: 'aid-review', cls: 'aid-log aid-rev', empty: 'Every row is checked.', detail: function(l){ return openFix === l.id && !aidDecisionOf(l.id) ? aidFixForm(d, l) : ''; } });
    if ((o.skipped || []).length){
      h += '<details class="crd-sources"><summary>Skipped as not a launch (' + o.skipped.length + ')</summary><ul>' + o.skipped.map(function(s){ return '<li>' + aidLabTag(d, s.lab) + ' ' + escapeHtml(s.title) + ' <small class="crd-dim">' + escapeHtml(s.date) + ' · ' + escapeHtml(s.why || '') + '</small></li>'; }).join('') + '</ul></details>';
    }
    return h;
  }
  function aidScorecardHtml(d){
    if (typeof aidScorecardBody === 'function') return aidScorecardBody(d, aidState.owner);
    return '<p class="crd-empty">The scorecard is not built yet.</p>';
  }
  function aidSourcesHtml(d){
    var src = d.sources || [];
    return '<details class="crd-sources"><summary>Sources and how this works</summary><ul>' + (src.length ? src.map(function(s){
      return '<li><b>' + escapeHtml(aidLabName(d, s.lab)) + '</b> ' + escapeHtml(s.source) + ' ' + (s.ok ? '<span class="crd-src crd-src-ok">read</span>' : '<span class="crd-src crd-src-carried">not read</span>') + (s.lastOk ? ' <span class="crd-dim">last read ' + escapeHtml(s.lastOk) + '</span>' : '') + '</li>';
    }).join('') : '<li>No source read yet.</li>') + '</ul>' +
      '<p class="crd-note">Once a trading day the site reads each lab’s official release notes and news (OpenAI, Anthropic, Google, Microsoft, Meta, xAI) and tags every new launch with simple keyword rules: what it does, who can use it, how ready it is and how much it works on its own. No AI reads the posts. Each new row carries an “auto” badge until the site owner checks it; posts the rules cannot place wait for review, and company news (funding, filings, hires, papers) is left out. The 88 launches before November 16, 2026 were entered by hand.</p>' +
      '<p class="crd-note">The customer-capture score (0 to 100) weighs how much of a rival product’s job the launch does (25%), how far along it is (20%), whether companies can buy it (20%), how much it works on its own (15%), how widely it is sold (10%), and its integrations and price (5% each). It describes a product, not a stock. Weights: ' + escapeHtml(d.weightsVersion || '') + '.</p></details>';
  }
  function renderAiDisruption(){
    var root = document.getElementById('aid-root'); if (!root) return;
    var d = aidState.data;
    if (!d){
      root.innerHTML = '<p class="crd-empty">' + (aidState.error ? 'The AI disruption page could not load. The next full update writes it; try again later.' : 'Loading the AI launch log…') + '</p>';
      return;
    }
    if (!aidState.urlRead){
      aidState.urlRead = true;
      try {
        var q = new URLSearchParams(location.search), q0 = new URLSearchParams(AID_BOOT_QS);
        var v = q.get('view') || (q0.get('tab') === 'ai-disruption' ? q0.get('view') : null), co = q.get('company'), cap = q.get('cap');
        if (v && AID_TABS.concat(AID_OWNER_TABS).some(function(t){ return t[0] === v; })) aidSetView('tab', v);
        if (co && /^[A-Za-z0-9. -]{1,40}$/.test(co)){ aidSetView('company', co); aidSetView('tab', 'log'); }
        if (cap && /^[a-z_]{2,40}$/.test(cap)){ aidSetView('cap', cap); aidSetView('tab', 'log'); }
      } catch (_) {}
    }
    var asof = document.getElementById('aid-asof');
    if (asof) asof.textContent = d.builtAt ? 'Built ' + vnWhen(d.builtAt) + (d.stale ? ' · last good read' : '') : '';
    var tabs = AID_TABS.concat(HAS_OWNER_ACCESS ? AID_OWNER_TABS : []);
    var tab = aidView('tab', 'log');
    if (!tabs.some(function(t){ return t[0] === tab; })) tab = 'log';
    var body = tab === 'board' ? aidBoardHtml(d) : tab === 'companies' ? aidCompaniesHtml(d) : tab === 'review' ? aidReviewHtml(d) : tab === 'scorecard' ? aidScorecardHtml(d) : aidLogHtml(d);
    root.innerHTML = (d.stale ? '<p class="crd-err">The lab sources were not read on the last update. This is the last good log.</p>' : '') +
      aidKpis(d) + vnTabsHtml(tabs, tab, 'data-aid-tab') + '<div class="crd-body aid-body">' + body + '</div>' + aidSourcesHtml(d);
    vnTabsReveal(root);
  }
  function aidPaneOpen(){ var p = document.getElementById('page-pane-ai-disruption'); return !!(p && !p.hidden); }
  function loadAiDisruptionOwner(){
    if (!HAS_OWNER_ACCESS || aidState.ownerLoading || aidState.owner) return;
    aidState.ownerLoading = true;
    vnJson('ai-disruption-owner.json', true).then(function(j){
      aidState.ownerLoading = false;
      aidState.owner = j && typeof j === 'object' && Array.isArray(j.queue) ? j : null;
      if (aidPaneOpen()) renderAiDisruption();
    });
    fetch('/api/auth/ai-disruption-review', { cache: 'no-store', credentials: 'same-origin' })
      .then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
      .then(function(j){ if (j && j.decisions){ aidState.decisions = j; if (aidPaneOpen()) renderAiDisruption(); } });
  }
  function aiDisruptionPublicJson(){ return vnJson('ai-disruption.json', false).then(function(j){ return j && typeof j === 'object' && Array.isArray(j.launches) ? j : null; }); }
  function loadAiDisruption(force){
    loadAiDisruptionOwner();
    if (!force && aidState.data && Date.now() - aidState.fetchedAt < 10 * 60 * 1000){ renderAiDisruption(); return; }
    if (aidState.loading) return;
    aidState.loading = true; aidState.error = null;
    renderAiDisruption();
    aiDisruptionPublicJson().then(function(j){
      aidState.data = j;
      aidState.error = j ? null : 'missing';
      aidState.fetchedAt = Date.now(); aidState.loading = false;
      renderAiDisruption();
    });
  }
  function aidSend(body, id){
    aidState.saving[id] = true; aidState.note[id] = 'Saving…';
    renderAiDisruption();
    fetch('/api/auth/ai-disruption-review', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; }); })
      .catch(function(){ return { ok: false, j: { error: 'network error' } }; })
      .then(function(res){
        delete aidState.saving[id];
        if (res.ok && res.j && res.j.decisions){ aidState.decisions = res.j; aidState.note[id] = ''; if (aidView('fix', '') === id) aidSetView('fix', ''); }
        else aidState.note[id] = 'Not saved: ' + ((res.j && res.j.error) || 'try again');
        renderAiDisruption();
      });
  }
  document.addEventListener('click', function(ev){
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-aid-tab],[data-aid-lab],[data-aid-status],[data-aid-company],[data-aid-covered],[data-aid-goto-cap],[data-aid-act]') : null;
    if (!el || !el.closest('#aid-root')) return;
    if (el.hasAttribute('data-aid-tab')) aidSetView('tab', el.getAttribute('data-aid-tab'));
    else if (el.hasAttribute('data-aid-lab')) aidSetView('lab', el.getAttribute('data-aid-lab'));
    else if (el.hasAttribute('data-aid-status')) aidSetView('status', el.getAttribute('data-aid-status'));
    else if (el.hasAttribute('data-aid-covered')) aidSetView('covered', el.getAttribute('data-aid-covered'));
    else if (el.hasAttribute('data-aid-company')){ aidSetView('company', el.getAttribute('data-aid-company')); aidSetView('tab', 'log'); }
    else if (el.hasAttribute('data-aid-goto-cap')){ aidSetView('cap', el.getAttribute('data-aid-goto-cap')); aidSetView('tab', 'log'); }
    else if (el.hasAttribute('data-aid-act')){
      if (!HAS_OWNER_ACCESS) return;
      var act = el.getAttribute('data-aid-act'), id = el.getAttribute('data-aid-id');
      if (act === 'fix'){
        aidSetView('fix', aidView('fix', '') === id ? '' : id);
        renderAiDisruption();
        var tr = document.querySelector('#aid-root [data-aid-fix="' + id.replace(/"/g, '') + '"]');
        var row = tr && tr.closest('tr.vt-detail');
        if (row) row.hidden = false;
        return;
      }
      aidSend({ act: act, id: id }, id);
      return;
    }
    renderAiDisruption();
  });
  document.addEventListener('change', function(ev){
    var el = ev.target;
    if (el && el.matches && el.matches('#aid-root select[data-aid-cap]')){ aidSetView('cap', el.value); renderAiDisruption(); }
  });
  document.addEventListener('submit', function(ev){
    var form = ev.target && ev.target.closest ? ev.target.closest('form[data-aid-fix]') : null;
    if (!form) return;
    ev.preventDefault();
    if (!HAS_OWNER_ACCESS) return;
    var id = form.getAttribute('data-aid-fix');
    var val = function(n){ var x = form.querySelector('[name="' + n + '"]'); return x ? x.value : null; };
    var checked = function(n){ return Array.prototype.slice.call(form.querySelectorAll('input[name="' + n + '"]:checked')).map(function(x){ return x.value; }); };
    var fields = { title: val('title'), product: val('product'), how: val('how'), availability: val('availability'), autonomy: val('autonomy'), coverage: Number(val('coverage')), plans: checked('plan'), capabilities: checked('cap') };
    if (!fields.capabilities.length || fields.capabilities.length > 6){ aidState.note[id] = 'Pick 1 to 6 capabilities.'; renderAiDisruption(); return; }
    if (fields.availability === 'ga' && !fields.plans.length){ aidState.note[id] = 'A generally available launch needs a plan.'; renderAiDisruption(); return; }
    aidSend({ act: 'edit', id: id, fields: fields }, id);
  });
  document.addEventListener('stonks-owner-ready', function(){ if (aidPaneOpen()){ loadAiDisruptionOwner(); renderAiDisruption(); } });

  // ---- Stock page strip (stock-page-js.mjs) ----
  function aiDisruptionStockStripHtml(d, sym){
    if (!d || !sym) return '';
    var co = (d.companies || []).filter(function(c){ return c.id === sym && c.coverage === 'covered'; })[0];
    if (!co) return '';
    var hits = (d.launches || []).filter(function(l){ return aidWithin(l.date, 90) && (l.targets || []).some(function(t){ return t.company === sym; }); });
    var outcomeOf = function(l){ var t = (l.targets || []).filter(function(x){ return x.company === sym; })[0]; return t ? t.outcome : 'watch'; };
    var OUT = (d.labels && d.labels.outcome) || {};
    var caps = (co.exposures || []).map(function(e){ return aidCapName(d, e.capability); });
    var h = '<h3 class="stp-h3">AI launches aimed at what it sells</h3>' +
      '<p class="stp-lede">' + escapeHtml(co.name) + ' sells ' + escapeHtml(caps.slice(0, 4).join(', ')) + (caps.length > 4 ? ' and more' : '') + '. ' +
      (hits.length ? hits.length + ' AI lab launch' + (hits.length === 1 ? '' : 'es') + ' in the last 90 days overlap' + (hits.length === 1 ? 's' : '') + ' with it.' : 'No AI lab launch in the last 90 days overlaps with it.') + '</p>';
    if (hits.length){
      h += '<ul class="aid-strip">' + hits.slice(0, 4).map(function(l){
        var o = outcomeOf(l);
        return '<li>' + aidLabTag(d, l.lab) + ' <span>' + escapeHtml(l.title) + '</span> <small class="crd-dim">' + escapeHtml(l.date) + '</small> <span class="aid-t aid-t-' + escapeHtml(o) + '">' + escapeHtml(OUT[o] || o) + '</span></li>';
      }).join('') + '</ul>';
    }
    h += '<p class="stp-src">From the AI labs’ own release notes; a description of the products, not a view on the stock. <a href="?tab=ai-disruption&amp;company=' + encodeURIComponent(sym) + '">Every launch aimed at ' + escapeHtml(sym) + '</a></p>';
    return h;
  }
`;
}
