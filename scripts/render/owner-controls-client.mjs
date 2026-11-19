// Owner controls (2026-11-19, lib/owner-controls.mjs): the banner on Top
// Picks, Open picks, the Strategy engines page and Owner Settings, and the
// full controls panel on the Strategy engines page. Pasted into the app.js
// IIFE, so it is ES5 inside a template string: no backticks, write regex
// escapes as \\d (this file uses none).
//
// Everything is read from and posted to /api/auth/owner-controls (Owner
// session, same-origin POST). Public visitors never request it: nothing loads
// until the stonks-owner-ready event, and every placeholder stays hidden.
//
//   <div data-oc-banner="picks" hidden></div>   one-line status + Stop / Resume
//   <section id="oc-panel" hidden></section>    the controls (engines page)

export function ownerControlsBanner(where) {
  return `<div class="oc-banner" data-oc-banner="${where}" role="status" aria-live="polite" hidden></div>`;
}
export function ownerControlsPanel() {
  return `<section class="card oc-panel" id="oc-panel" aria-labelledby="oc-title" hidden></section>`;
}

export function renderOwnerControlsJs() {
  return `
  // ---- Owner controls (lib/owner-controls.mjs) ------------------------------
  var OC = { data: null, loading: false, saving: false, error: null, msg: null, check: null, checkSym: '', score: null, scoreLoading: false, livePx: {} };
  function ocEsc(s){ return escapeHtml(s == null ? '' : String(s)); }
  function ocWhen(iso, withDay){
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    // In the site's chosen display zone, which names itself (ET, UTC, local).
    return formatDisplayInstant(d, withDay === false ? { hour: 'numeric', minute: '2-digit', hour12: true } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function ocDay(date){
    if (!date) return '';
    var d = new Date(date + 'T12:00:00Z');
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }
  function ocUsd(v){ return v == null || !isFinite(v) ? 'off' : '$' + Math.round(v).toLocaleString('en-US'); }
  // A reply from the controls action always carries the dial and the log.
  function ocValid(j){ return !!(j && typeof j === 'object' && j.dial && j.dial.level && Array.isArray(j.log) && Array.isArray(j.avoid)); }
  function ocLoad(force){
    if (!HAS_OWNER_ACCESS) return;
    if (OC.loading || (OC.data && !force)) { ocRenderAll(); return; }
    OC.loading = true;
    fetch('/api/auth/owner-controls', { cache: 'no-store', credentials: 'same-origin' })
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(j){ if (!ocValid(j)) throw new Error('bad reply'); OC.data = j; OC.error = null; })
      .catch(function(){ OC.error = 'load'; })
      .then(function(){ OC.loading = false; ocRenderAll(); });
  }
  function ocPost(body, okMsg){
    if (OC.saving) return;
    OC.saving = true; OC.msg = null; ocRenderAll();
    fetch('/api/auth/owner-controls', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + r.status); return j; }); })
      .then(function(j){ if (!ocValid(j)) throw new Error('unexpected reply'); OC.data = j; OC.msg = { ok: true, text: j.changed === false ? 'No change.' : (j.text || okMsg || 'Saved.') + (j.changed === false ? '' : ' Logged; Undo is in the change log.') }; OC.score = null; })
      .catch(function(err){ OC.msg = { ok: false, text: 'Couldn’t save: ' + (err && err.message ? err.message : 'try again') + '.' }; })
      .then(function(){ OC.saving = false; ocRenderAll(); });
  }
  function ocSummary(d){
    var bits = [];
    if (d.dial && d.dial.level !== 'normal') bits.push('Risk dial <b>' + ocEsc(d.dial.label) + '</b> until ' + ocEsc(ocWhen(d.dial.until)));
    var av = (d.avoid || []).filter(function(a){ return a.active; });
    if (av.length) bits.push('Avoid ' + av.map(function(a){ return '<b>' + ocEsc(a.sym) + '</b>'; }).join(', '));
    var wa = (d.watch || []).filter(function(w){ return w.active; });
    if (wa.length) bits.push('Watching ' + wa.map(function(w){ return '<b>' + ocEsc(w.sym) + '</b>'; }).join(', '));
    var ca = (d.catalysts || []).filter(function(k){ return k.active; });
    if (ca.length) bits.push('Catalyst' + (ca.length === 1 ? '' : 's') + ': ' + ca.slice(0, 3).map(function(k){ return ocEsc(ocDay(k.date)) + (k.sym ? ' <b>' + ocEsc(k.sym) + '</b>' : '') + ' ' + ocEsc(k.text); }).join('; ') + (ca.length > 3 ? '; +' + (ca.length - 3) + ' more' : ''));
    return bits;
  }
  function ocBannerHtml(where){
    var d = OC.data;
    if (!d) return OC.error ? '<span class="oc-b-line muted">Owner controls couldn’t load. The engines read “no control” when nothing is saved.</span>' : '';
    var link = where === 'engines' ? ' <button type="button" class="oc-b-link oc-b-jump" data-oc-act="jump">Controls below &darr;</button>' : ' <a class="oc-b-link" href="?tab=engines">Open controls &rarr;</a>';
    var btn = d.stop
      ? '<button type="button" class="oc-btn oc-btn-go" data-oc-act="resume"' + (OC.saving ? ' disabled' : '') + '>Resume new trades</button>'
      : '<button type="button" class="oc-btn oc-btn-stop" data-oc-act="stop"' + (OC.saving ? ' disabled' : '') + '>Stop new trades</button>';
    if (d.enabled === false) return '<span class="oc-b-line"><b class="oc-b-title">Owner controls are off</b> in Owner Settings (Account limits tab). Nothing saved here applies: trades open as if no control were set. The account limits still apply.</span><span class="oc-b-act"><a class="oc-b-link" href="?tab=owner-settings">Owner Settings &rarr;</a></span>';
    var bits = ocSummary(d);
    var head = d.stop
      ? '<b class="oc-b-title">New trades are stopped.</b> Since ' + ocEsc(ocWhen(d.stop.at)) + (d.stop.by ? ' by ' + ocEsc(d.stop.by) : '') + '. No new Top Picks record trades, engine trades or Webull paper opens. Exits keep running. The LEAPS, Leveraged ETFs and Sector rotation paper logs keep logging (they never trade).'
      : bits.length ? '<b class="oc-b-title">Controls in force:</b> ' + bits.join(' · ') + '.' : '<span class="muted">Owner controls: none in force.</span>';
    return '<span class="oc-b-line">' + head + (d.stop && bits.length ? ' <span class="muted">' + bits.join(' · ') + '.</span>' : '') + '</span><span class="oc-b-act">' + btn + link + '</span>';
  }
  function ocRenderBanners(){
    var list = document.querySelectorAll('[data-oc-banner]');
    for (var i = 0; i < list.length; i++){
      var el = list[i];
      var where = el.getAttribute('data-oc-banner');
      // A failed load is said only where the controls live (the engines page
      // and Owner Settings); elsewhere the banner stays out of the way.
      if (!HAS_OWNER_ACCESS || (!OC.data && (!OC.error || (where !== 'engines' && where !== 'settings')))){ el.hidden = true; el.innerHTML = ''; continue; }
      el.hidden = false;
      el.className = 'oc-banner' + (OC.data && OC.data.enabled === false ? ' is-on' : OC.data && OC.data.stop ? ' is-stop' : OC.data && OC.data.any ? ' is-on' : '');
      el.innerHTML = ocBannerHtml(where);
    }
  }
  function ocListHtml(rows, kind){
    if (!rows.length) return '<p class="oc-empty">' + (kind === 'avoid' ? 'No stock is on the avoid list.' : kind === 'watch' ? 'No stock is being watched closely.' : 'No catalyst flagged.') + '</p>';
    return '<ul class="oc-list">' + rows.map(function(r){
      if (kind === 'avoid') return '<li' + (r.active ? '' : ' class="is-off"') + '><b>' + ocEsc(r.sym) + '</b> <span class="muted">since ' + ocEsc(ocWhen(r.at)) + (r.until ? ', until ' + ocEsc(ocDay(r.until)) : ', until lifted') + (r.close ? ', open trades close at the next run' : '') + (r.px ? ', then $' + Number(r.px).toFixed(2) : '') + '</span> <button type="button" class="oc-btn oc-btn-sm" data-oc-act="lift" data-oc-sym="' + ocEsc(r.sym) + '">Lift</button></li>';
      if (kind === 'watch') return '<li' + (r.active ? '' : ' class="is-off"') + '><b>' + ocEsc(r.sym) + '</b> <span class="muted">front of the queue through ' + ocEsc(ocDay(r.until)) + '</span> <button type="button" class="oc-btn oc-btn-sm" data-oc-act="unwatch" data-oc-sym="' + ocEsc(r.sym) + '">Stop watching</button></li>';
      return '<li' + (r.active ? '' : ' class="is-off"') + '><b>' + ocEsc(ocDay(r.date)) + '</b>' + (r.sym ? ' <b>' + ocEsc(r.sym) + '</b>' : '') + ' ' + ocEsc(r.text) + ' <button type="button" class="oc-btn oc-btn-sm" data-oc-act="uncatalyst" data-oc-id="' + r.id + '">Remove</button></li>';
    }).join('') + '</ul>';
  }
  function ocCheckHtml(){
    var sym = OC.checkSym;
    if (!sym) return '<p class="oc-empty">Type a ticker to see what every engine read on its last run, with a live quote. Nothing is saved.</p>';
    var ed = typeof engState !== 'undefined' && engState && engState.data ? engState.data : null;
    var q = OC.check;
    var out = '<div class="oc-check-head"><b>' + ocEsc(sym) + '</b> ' + (q === 'loading' ? '<span class="muted">quote loading…</span>' : q && q.spot != null ? '<span>$' + Number(q.spot).toFixed(2) + '</span>' + (q.changePct != null ? ' <span class="' + (q.changePct >= 0 ? 'pos' : 'neg') + '">' + (q.changePct > 0 ? '+' : '') + Number(q.changePct).toFixed(2) + '% today</span>' : '') + ' <span class="muted">live quote</span>' : '<span class="muted">no live quote</span>') + '</div>';
    if (!ed){ return out + '<p class="oc-empty">The engines’ last run has not loaded yet.</p>'; }
    var rows = ed.checks && ed.checks.rows ? ed.checks.rows[sym] || [] : null;
    var held = [];
    (ed.engines || []).forEach(function(e){ (e.open || []).forEach(function(t){ if (t.symbol === sym) held.push({ e: e, t: t }); }); });
    var asOf = ed.checks && ed.checks.iso ? ' (run of ' + ocEsc(ocWhen(ed.checks.iso)) + ')' : '';
    var body = '';
    if (rows == null) body += '<p class="oc-empty">The last engines run is from before this check existed; the next 11:00 or 15:30 ET run fills it.</p>';
    else if (!rows.length) body += '<p class="oc-empty">No engine had a setup on ' + ocEsc(sym) + ' near its entry bar at its last run' + asOf + '.</p>';
    else body += '<table class="vt oc-check-table" data-nosort><thead><tr><th>Engine</th><th>Setup</th><th>Side</th><th>Score</th><th>Result</th></tr></thead><tbody>' + rows.map(function(r){
      var e = null; (ed.engines || []).forEach(function(x){ if (x.id === r.engine) e = x; });
      var lbl = r.setup; if (e) (e.setups || []).forEach(function(s){ if (s.key === r.setup) lbl = s.label; });
      return '<tr><td>' + ocEsc(e ? e.name : r.engine) + '</td><td>' + ocEsc(lbl) + '</td><td>' + ocEsc(r.side) + '</td><td>' + (r.score == null ? '—' : Math.round(r.score) + (e ? ' <span class="muted">/ bar ' + Math.round(e.bar.now) + '</span>' : '')) + '</td><td>' + (r.taken ? '<b class="pos">Opened</b>' : ocEsc(r.why || (r.skipped ? 'price filter' : 'not taken'))) + '</td></tr>';
    }).join('') + '</tbody></table><p class="oc-note">Last run' + asOf + '. Engines that are not listed did not score a setup on it.</p>';
    if (held.length) body += '<p class="oc-note">Open now: ' + held.map(function(h){ return ocEsc(h.e.name) + ' ' + ocEsc(h.t.side) + (h.t.optionPnlPct != null ? ' (' + (h.t.optionPnlPct > 0 ? '+' : '') + Number(h.t.optionPnlPct).toFixed(1) + '%)' : ''); }).join(', ') + '.</p>';
    var d = OC.data || {};
    var av = (d.avoid || []).some(function(a){ return a.sym === sym && a.active; }), wa = (d.watch || []).some(function(w){ return w.sym === sym && w.active; });
    body += '<div class="oc-row">' +
      (av ? '<button type="button" class="oc-btn" data-oc-act="lift" data-oc-sym="' + ocEsc(sym) + '">Lift avoid</button>' : '<button type="button" class="oc-btn" data-oc-act="avoid-from-check">Avoid ' + ocEsc(sym) + '</button>') +
      (wa ? '<button type="button" class="oc-btn" data-oc-act="unwatch" data-oc-sym="' + ocEsc(sym) + '">Stop watching</button>' : '<button type="button" class="oc-btn" data-oc-act="watch" data-oc-sym="' + ocEsc(sym) + '">Watch closely</button>') +
      '<button type="button" class="oc-btn" data-oc-act="catalyst-from-check">Flag a catalyst</button></div>';
    return out + body;
  }
  function ocScoreHtml(){
    var s = OC.score;
    if (OC.scoreLoading) return '<p class="oc-empty">Loading the scorecard…</p>';
    if (!s) return '<p class="oc-empty">Open to load: how closed trades did under each setting, and what avoided stocks did next.</p>';
    if (s.error) return '<p class="oc-empty">The scorecard couldn’t load.</p>';
    var groups = (s.groups || []).map(function(g){ return '<tr><td>' + ocEsc(g.label) + '</td><td class="oc-num">' + g.n + '</td><td class="oc-num">' + (g.winRate == null ? '—' : Math.round(g.winRate * 100) + '%') + '</td><td class="oc-num">' + (g.avg == null ? '—' : '<span class="' + (g.avg >= 0 ? 'pos' : 'neg') + '">' + (g.avg > 0 ? '+' : '') + g.avg.toFixed(1) + '%</span>') + '</td></tr>'; }).join('');
    var av = (s.avoided || []).map(function(a){
      var now = a.open ? OC.livePx[a.sym] : a.pxEnd;
      var mv = a.px && now ? (now / a.px - 1) * 100 : null;
      return '<tr><td><b>' + ocEsc(a.sym) + '</b></td><td>' + ocEsc(ocWhen(a.at)) + '</td><td class="oc-num">' + (a.px ? '$' + Number(a.px).toFixed(2) : '—') + '</td><td class="oc-num">' + (now ? '$' + Number(now).toFixed(2) + (a.open ? ' <span class="muted">live</span>' : ' <span class="muted">at lift</span>') : '—') + '</td><td class="oc-num">' + (mv == null ? '—' : '<span class="' + (mv >= 0 ? 'pos' : 'neg') + '">' + (mv > 0 ? '+' : '') + mv.toFixed(1) + '%</span>') + '</td></tr>';
    }).join('');
    return '<p class="oc-note">' + (s.ready ? 'A month or more of controls' : 'Early: ' + s.days + ' day' + (s.days === 1 ? '' : 's') + ' of controls so far; the read means more after a month') + '. Closed trades from both records, each result per contract or per share lot.</p>' +
      '<table class="vt" data-nosort><thead><tr><th>Setting</th><th class="oc-num">Closed</th><th class="oc-num">Win rate</th><th class="oc-num">Average</th></tr></thead><tbody>' + groups + '</tbody></table>' +
      '<h4 class="oc-h4">Avoided stocks: what they did next</h4>' + (av ? '<table class="vt" data-nosort><thead><tr><th>Stock</th><th>Avoided</th><th class="oc-num">Price then</th><th class="oc-num">Price now</th><th class="oc-num">Move</th></tr></thead><tbody>' + av + '</tbody></table>' : '<p class="oc-empty">No stock has been avoided yet.</p>');
  }
  function ocLoadScore(){
    if (OC.scoreLoading) return;
    OC.scoreLoading = true; ocRenderPanel();
    fetch('/api/auth/owner-controls?scorecard=1', { cache: 'no-store', credentials: 'same-origin' })
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(j){
        OC.score = j.scorecard || { error: true };
        var syms = (OC.score.avoided || []).filter(function(a){ return a.open; }).map(function(a){ return a.sym; });
        if (!syms.length) return null;
        return fetch('/api/quotes?symbols=' + encodeURIComponent(syms.join(',')), { cache: 'no-store' }).then(function(r){ return r.ok ? r.json() : null; }).then(function(q){
          var list = q && (q.quotes || q.data || q) ; if (!list) return;
          if (!Array.isArray(list)) list = Object.keys(list).map(function(k){ var v = list[k]; return v && typeof v === 'object' ? Object.assign({ symbol: k }, v) : null; }).filter(Boolean);
          list.forEach(function(x){ var p = x && (x.spot != null ? x.spot : x.price != null ? x.price : x.regularMarketPrice); if (x && x.symbol && p > 0) OC.livePx[String(x.symbol).toUpperCase()] = Number(p); });
        }).catch(function(){});
      })
      .catch(function(){ OC.score = { error: true }; })
      .then(function(){ OC.scoreLoading = false; ocRenderPanel(); });
  }
  function ocRunCheck(sym){
    sym = String(sym || '').trim().toUpperCase();
    OC.checkSym = sym; OC.check = sym ? 'loading' : null;
    ocRenderPanel();
    if (!sym) return;
    fetch('/api/quote?symbol=' + encodeURIComponent(sym), { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(q){ if (OC.checkSym === sym) OC.check = q && q.spot != null ? q : null; })
      .catch(function(){ if (OC.checkSym === sym) OC.check = null; })
      .then(function(){ if (OC.checkSym === sym) ocRenderPanel(); });
  }
  function ocRenderPanel(){
    var box = document.getElementById('oc-panel');
    if (!box) return;
    if (!HAS_OWNER_ACCESS){ box.hidden = true; box.innerHTML = ''; return; }
    var d = OC.data;
    box.hidden = false;
    if (!d){ box.innerHTML = '<p class="oc-empty">' + (OC.error ? 'The controls couldn’t load. Try again in a moment.' : 'Loading the controls…') + '</p>'; return; }
    var dis = OC.saving ? ' disabled' : '';
    var dials = (d.dials || []).map(function(x){ return '<button type="button" class="oc-pill' + (x.level === d.dial.level ? ' is-on' : '') + (x.level !== 'normal' ? ' is-' + x.level : '') + '" data-oc-act="dial" data-oc-level="' + x.level + '" aria-pressed="' + (x.level === d.dial.level ? 'true' : 'false') + '" title="' + ocEsc(x.help) + '"' + dis + '>' + ocEsc(x.label) + '</button>'; }).join('');
    var lim = d.limits || {};
    var limTxt = d.limits ? ['Open option premium ' + ocUsd(lim.openUsd), 'Daily loss stop ' + ocUsd(lim.dayLossUsd), 'Per stock ' + ocUsd(lim.nameUsd), 'New trades a day ' + (lim.newPerDay == null ? 'off' : lim.newPerDay)].join(' · ') : 'Unavailable';
    var log = (d.log || []).slice(0, 12).map(function(l){ return '<li' + (l.undone ? ' class="is-off"' : '') + '>' + ocEsc(l.text) + (l.undone ? ' <em>(undone)</em>' : '') + ' <span class="muted">· ' + ocEsc(ocWhen(l.at)) + (l.by ? ' · ' + ocEsc(l.by) : '') + '</span></li>'; }).join('');
    var today = d.now ? String(d.now).slice(0, 10) : '';
    box.innerHTML =
      '<header class="card-header"><h2 class="card-title" id="oc-title">Controls</h2><span class="card-eyebrow">Owner · applies to Top Picks, every engine and the Webull paper account</span></header>' +
      (d.enabled === false ? '<p class="oc-msg is-bad">Owner controls are off in Owner Settings (Account limits tab). You can still change them here, but nothing applies to Top Picks, the engines or the Webull paper account until the switch is back on.</p>' : '') +
      (OC.msg ? '<p class="oc-msg ' + (OC.msg.ok ? 'is-ok' : 'is-bad') + '" role="status">' + ocEsc(OC.msg.text) + '</p>' : '') +
      '<div class="oc-grid">' +
        '<div class="oc-cell oc-cell-stop' + (d.stop ? ' is-stop' : '') + '"><h3 class="oc-h3">Stop new trades</h3><p class="oc-note">' + (d.stop ? '<b>On</b> since ' + ocEsc(ocWhen(d.stop.at)) + (d.stop.by ? ' by ' + ocEsc(d.stop.by) : '') + '. No new Top Picks record trades, engine trades or Webull paper opens; exits keep running. The LEAPS, Leveraged ETFs and Sector rotation paper logs keep logging (they never trade).' : 'Off. One click stops new Top Picks record trades, engine trades and Webull paper opens. Exits keep running.') + '</p>' +
          (d.stop ? '<button type="button" class="oc-btn oc-btn-go" data-oc-act="resume"' + dis + '>Resume new trades</button>' : '<button type="button" class="oc-btn oc-btn-stop" data-oc-act="stop"' + dis + '>Stop new trades</button>') + '</div>' +
        '<div class="oc-cell"><h3 class="oc-h3">Risk dial</h3><div class="oc-pills" role="group" aria-label="Risk dial">' + dials + '</div><p class="oc-note">' + ocEsc(d.dial.help) + (d.dial.level !== 'normal' ? ' Until ' + ocEsc(ocWhen(d.dial.until)) + '.' : ' A change lasts until ' + ocEsc(ocWhen(d.nextDialUntil)) + ' (Friday’s close), then goes back to Normal.') + ' Not tied to fear.</p></div>' +
      '</div>' +
      '<div class="oc-cell"><h3 class="oc-h3">Check this stock</h3><form class="oc-form" data-oc-form="check"><label class="oc-lbl">Ticker <input class="oc-in oc-in-sym" name="sym" maxlength="10" autocomplete="off" spellcheck="false" value="' + ocEsc(OC.checkSym) + '"></label><button type="submit" class="oc-btn">Check</button></form><div class="oc-check">' + ocCheckHtml() + '</div></div>' +
      '<div class="oc-grid">' +
        '<div class="oc-cell"><h3 class="oc-h3">Avoid</h3><p class="oc-note">No new entries on the stock in any engine or Top Picks until you lift it.</p><form class="oc-form" data-oc-form="avoid"><label class="oc-lbl">Ticker <input class="oc-in oc-in-sym" name="sym" maxlength="10" autocomplete="off" spellcheck="false" required></label><label class="oc-lbl">Until (optional) <input class="oc-in" type="date" name="until" min="' + ocEsc(today) + '"></label><label class="oc-chk"><input type="checkbox" name="close"> Close its open trades at the next run</label><button type="submit" class="oc-btn"' + dis + '>Avoid</button></form>' + ocListHtml(d.avoid || [], 'avoid') + '</div>' +
        '<div class="oc-cell"><h3 class="oc-h3">Watch closely</h3><p class="oc-note">Front of each engine’s queue and first for Top Picks’ AI review slots for ' + d.watchSessions + ' sessions (through ' + ocEsc(ocDay(d.nextWatchUntil)) + ' if set now). No bar is lowered.</p><form class="oc-form" data-oc-form="watch"><label class="oc-lbl">Ticker <input class="oc-in oc-in-sym" name="sym" maxlength="10" autocomplete="off" spellcheck="false" required></label><button type="submit" class="oc-btn"' + dis + '>Watch</button></form>' + ocListHtml(d.watch || [], 'watch') + '</div>' +
      '</div>' +
      '<div class="oc-cell"><h3 class="oc-h3">Catalyst log</h3><p class="oc-note">One line, shown on Top Picks, Open picks and here until its date. It changes no trade.</p><form class="oc-form" data-oc-form="catalyst"><label class="oc-lbl">Ticker (optional) <input class="oc-in oc-in-sym" name="sym" maxlength="10" autocomplete="off" spellcheck="false"></label><label class="oc-lbl oc-lbl-wide">What <input class="oc-in" name="text" maxlength="140" required></label><label class="oc-lbl">Date <input class="oc-in" type="date" name="date" min="' + ocEsc(today) + '" required></label><button type="submit" class="oc-btn"' + dis + '>Flag</button></form>' + ocListHtml(d.catalysts || [], 'catalyst') + '</div>' +
      '<div class="oc-grid">' +
        '<div class="oc-cell"><h3 class="oc-h3">Account limits</h3><p class="oc-note">' + ocEsc(limTxt) + '. Off until you set them in <a href="?tab=owner-settings">Owner Settings → Account limits</a>. Enforced in the engines and the Webull paper mirror.</p></div>' +
        '<div class="oc-cell"><h3 class="oc-h3">Change log</h3>' + (log ? '<ol class="oc-log">' + log + '</ol>' : '<p class="oc-empty">No changes yet.</p>') + '<button type="button" class="oc-btn" data-oc-act="undo"' + (d.canUndo ? dis : ' disabled') + '>Undo the last change</button></div>' +
      '</div>' +
      '<details class="oc-cell oc-score" data-oc-score' + (OC.score || OC.scoreLoading ? ' open' : '') + '><summary class="oc-h3">Scorecard</summary>' + ocScoreHtml() + '</details>';
  }
  function ocRenderAll(){ ocRenderBanners(); ocRenderPanel(); }
  function ocConfirm(text){ try { return window.confirm(text); } catch (e) { return false; } }
  function ocAct(btn){
    var act = btn.getAttribute('data-oc-act'), sym = btn.getAttribute('data-oc-sym');
    if (act === 'stop'){ if (ocConfirm('Stop new trades? No new Top Picks record trades, engine trades or Webull paper opens until you resume. Exits keep running.')) ocPost({ act: 'stop', confirm: true }); return; }
    if (act === 'resume'){ ocPost({ act: 'resume' }); return; }
    if (act === 'jump'){ var pn = document.getElementById('oc-panel'); if (pn && pn.scrollIntoView) pn.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (act === 'dial'){
      var level = btn.getAttribute('data-oc-level');
      if (level === 'riskier' && !ocConfirm('Riskier until Friday’s close? Engine trades buy 1.5x the size (inside the account limits) and the entry bar drops 3 points.')) return;
      ocPost({ act: 'dial', level: level, confirm: level === 'riskier' ? true : undefined }); return;
    }
    if (act === 'lift'){ ocPost({ act: 'lift', sym: sym, px: OC.checkSym === sym && OC.check && OC.check.spot ? OC.check.spot : undefined }); return; }
    if (act === 'watch' || act === 'unwatch'){ ocPost({ act: act, sym: sym }); return; }
    if (act === 'uncatalyst'){ ocPost({ act: 'uncatalyst', id: Number(btn.getAttribute('data-oc-id')) }); return; }
    if (act === 'undo'){ if (ocConfirm('Undo the last change?')) ocPost({ act: 'undo' }); return; }
    if (act === 'avoid-from-check' || act === 'catalyst-from-check'){
      var f = document.querySelector('[data-oc-form="' + (act === 'avoid-from-check' ? 'avoid' : 'catalyst') + '"]');
      if (f && f.elements.sym){ f.elements.sym.value = OC.checkSym; var next = act === 'avoid-from-check' ? f.elements.sym : f.elements.text; if (next && next.focus) next.focus(); }
    }
  }
  function ocSubmit(form){
    var kind = form.getAttribute('data-oc-form'), el = form.elements;
    var sym = el.sym ? String(el.sym.value || '').trim().toUpperCase() : '';
    if (kind === 'check'){ ocRunCheck(sym); return; }
    if (kind === 'avoid'){
      var close = !!(el.close && el.close.checked);
      if (close && !ocConfirm('Avoid ' + sym + ' and close its open trades at the next 11:00 or 15:30 ET run, in every engine and Top Picks?')) return;
      ocPost({ act: 'avoid', sym: sym, close: close, until: el.until && el.until.value ? el.until.value : undefined, confirm: close ? true : undefined, px: OC.checkSym === sym && OC.check && OC.check.spot ? OC.check.spot : undefined });
      return;
    }
    if (kind === 'watch'){ ocPost({ act: 'watch', sym: sym }); return; }
    if (kind === 'catalyst'){ ocPost({ act: 'catalyst', sym: sym || undefined, text: el.text ? el.text.value : '', date: el.date ? el.date.value : '' }); }
  }
  document.addEventListener('click', function(ev){
    var t = ev.target;
    var btn = t && t.closest ? t.closest('[data-oc-act]') : null;
    if (btn && HAS_OWNER_ACCESS && !btn.disabled){ ev.preventDefault(); ocAct(btn); }
  });
  document.addEventListener('submit', function(ev){
    var f = ev.target;
    if (f && f.getAttribute && f.getAttribute('data-oc-form')){ ev.preventDefault(); if (HAS_OWNER_ACCESS) ocSubmit(f); }
  });
  document.addEventListener('toggle', function(ev){
    var t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute('data-oc-score') && t.open && !OC.score && !OC.scoreLoading) ocLoadScore();
  }, true);
  document.addEventListener('stonks-owner-ready', function(){ if (HAS_OWNER_ACCESS) ocLoad(true); });
`;
}

export function renderOwnerControlsCss() {
  return `
/* ---- Owner controls (lib/owner-controls.mjs) ------------------------------ */
.oc-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin: 0 0 12px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--r-2, 8px); background: var(--surface); font: 400 13px/1.45 var(--font-sans); color: var(--text); min-width: 0; }
.oc-banner[hidden] { display: none; }
.oc-banner.is-on { border-color: color-mix(in srgb, var(--warn, #c78a00) 45%, var(--border)); background: color-mix(in srgb, var(--warn, #c78a00) 7%, var(--surface)); }
.oc-banner.is-stop { border-color: var(--neg); background: color-mix(in srgb, var(--neg) 10%, var(--surface)); }
.oc-b-line { flex: 1 1 280px; min-width: 0; overflow-wrap: anywhere; }
.oc-b-title { color: var(--text-strong); }
.oc-banner.is-stop .oc-b-title { color: var(--neg); }
.oc-b-act { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.oc-b-link { font-weight: 600; white-space: nowrap; }
.oc-b-jump { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
.oc-banner .muted, .oc-panel .muted { color: var(--muted-strong); }
.oc-btn { min-height: 32px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-strong); font: 600 12.5px/1.2 var(--font-sans); cursor: pointer; }
.oc-btn:hover:not([disabled]) { border-color: var(--accent); }
.oc-btn:focus-visible, .oc-pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.oc-btn[disabled], .oc-pill[disabled] { opacity: .55; cursor: not-allowed; }
.oc-btn-stop { border-color: var(--neg); color: var(--neg); }
.oc-btn-stop:hover:not([disabled]) { background: color-mix(in srgb, var(--neg) 12%, transparent); border-color: var(--neg); }
.oc-btn-go { border-color: var(--pos); color: var(--pos); }
.oc-btn-sm { min-height: 26px; padding: 2px 9px; font-size: 12px; }
.oc-panel { min-width: 0; }
.oc-panel[hidden] { display: none; }
.oc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; margin: 0 0 12px; }
.oc-cell { min-width: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-2, 8px); background: var(--surface); margin: 0 0 12px; }
.oc-grid > .oc-cell { margin: 0; }
.oc-cell.is-stop { border-color: var(--neg); background: color-mix(in srgb, var(--neg) 8%, var(--surface)); }
.oc-h3, .oc-score > summary { margin: 0 0 6px; font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.oc-score > summary { cursor: pointer; margin: 0; }
.oc-score[open] > summary { margin-bottom: 8px; }
.oc-h4 { margin: 12px 0 6px; font: 650 13px/1.3 var(--font-sans); color: var(--text-strong); }
.oc-note, .oc-empty { margin: 0 0 8px; font: 400 13px/1.45 var(--font-sans); color: var(--text); overflow-wrap: anywhere; }
.oc-empty { color: var(--muted-strong); }
.oc-msg { margin: 0 0 10px; padding: 6px 10px; border-radius: var(--r-2, 8px); font: 500 13px/1.4 var(--font-sans); }
.oc-msg.is-ok { background: color-mix(in srgb, var(--pos) 10%, transparent); color: var(--text-strong); }
.oc-msg.is-bad { background: color-mix(in srgb, var(--neg) 12%, transparent); color: var(--neg); }
.oc-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; margin: 0 0 6px; }
.oc-pill { min-height: 32px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted-strong); font: 600 12.5px/1.2 var(--font-sans); cursor: pointer; }
.oc-pill.is-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text-strong); }
.oc-pill.is-on.is-riskier { border-color: var(--neg); background: color-mix(in srgb, var(--neg) 14%, transparent); }
.oc-pill.is-on.is-safer { border-color: var(--pos); background: color-mix(in srgb, var(--pos) 14%, transparent); }
.oc-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 0 0 8px; }
.oc-lbl { display: inline-flex; flex-direction: column; gap: 2px; font: 600 11.5px/1.3 var(--font-sans); color: var(--muted-strong); min-width: 0; }
.oc-lbl-wide { flex: 1 1 220px; }
.oc-chk { display: inline-flex; align-items: center; gap: 6px; font: 500 12.5px/1.3 var(--font-sans); color: var(--text); min-height: 32px; }
.oc-in { min-height: 32px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg, transparent); color: var(--text-strong); font: 500 13px/1.2 var(--font-sans); min-width: 0; max-width: 100%; }
.oc-in-sym { width: 7.5em; text-transform: uppercase; }
.oc-lbl-wide .oc-in { width: 100%; }
.oc-list, .oc-log { margin: 0 0 8px; padding: 0 0 0 18px; font: 400 13px/1.55 var(--font-sans); color: var(--text); }
.oc-list li, .oc-log li { margin: 0 0 4px; overflow-wrap: anywhere; }
.oc-list li.is-off, .oc-log li.is-off { opacity: .6; }
.oc-check-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin: 0 0 8px; font: 500 14px/1.4 var(--font-sans); }
.oc-check { min-width: 0; overflow-x: auto; }
.oc-check-table { width: 100%; }
.oc-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.oc-panel .pos { color: var(--pos); }
.oc-panel .neg { color: var(--neg); }
.oc-score .vt { width: 100%; }
.oc-score th, .oc-score td { text-align: left; }
.oc-score .oc-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (max-width: 640px) {
  .oc-banner { padding: 8px 10px; }
  .oc-form { gap: 6px; }
  .oc-lbl-wide { flex-basis: 100%; }
}
`;
}
