// Market risk line (2026-11-17, UI streamline). Market analysis, Risk
// analysis and the Bottom tracker form one Owner "Market risk" page with
// three tabs. Each tab opens with one line that puts the four market-risk
// reads side by side:
//   - the cross-asset tape (market-analysis.json macroRegime),
//   - the Bottom tracker verdict (bottom-tracker.json),
//   - the Market odds chance of a 10%+ fall within 6 months
//     (quant-labs.json card, the same read as the "Market odds" card),
//   - the Booms & busts stage (public history-rhymes.json).
// When they point different ways it says why: each one looks at a different
// horizon, so a calm tape and a late-boom warning can both be right.
// Owner only. It reads the files these pages already load (shared caches:
// marketState, bottomTrackerState, qlFetch, vnJson), adds no new data file
// and changes no read, vote or verdict. The returned string is pasted inside
// the app.js IIFE (ES5, no imports).
export function renderMarketRiskJs() {
  return `
  var mrState = { odds: null, rhymes: null, tape: null, tapeAsked: false, done: {} };
  var MR_PAGES = ['market', 'risk', 'bottom-tracker'];
  var MR_BTM_TONE = { stress: 'off', slowing: 'warn', pullback: 'warn', potential: 'warn', emerging: 'on', confirmed: 'on', 'no-drawdown': 'on' };
  // Booms & busts stages (lib/history-rhymes.mjs stageFor) for the AI buildout panel.
  var MR_HR_TONE = { quiet: 'on', early: 'on', boom: 'neutral', late: 'warn', strain: 'warn', bust: 'off' };
  var MR_HORIZON = {
    market: 'the tape reads cross-asset stress today and resets every build',
    'bottom-tracker': 'the Bottom tracker stages the fall from the three-year high',
    'quant-labs': 'Market odds are 3 to 12 month chances from S&P 500 history since 1962',
    'history-rhymes': 'Booms & busts counts AI buildout warning signs that took years to play out before'
  };
  // The same read the Market analysis strip shows: the live re-port of the
  // baked tape when live legs are in, else the baked tape, so the line and
  // the strip never name two different states.
  function mrTapeRead(){
    var baked = (typeof marketRegimeBaked === 'function' ? marketRegimeBaked() : null) || mrState.tape, live = null;
    try { live = baked ? computeLiveMacroRegime(baked, macroTape.legs || {}) : null; } catch (_){ live = null; }
    var r = live || baked;
    if (!r || !r.state) return null;
    var m = macroStateMeta(r.state, r.fragile);
    return { id: 'market', label: 'Cross-asset tape', noun: 'the tape', value: m.lbl + (live && live.live ? ' (live)' : ''), tone: m.tone === 'off' ? 'off' : m.tone === 'on' ? 'on' : m.tone === 'fragile' ? 'warn' : 'neutral' };
  }
  function mrBottomRead(){
    var d = bottomTrackerState.data;
    if (!d || d.loadError || !d.verdict || d.verdict === 'unavailable') return null;
    return { id: 'bottom-tracker', label: 'Decline stage', noun: 'the decline stage', value: d.title || d.verdict, tone: MR_BTM_TONE[d.verdict] || 'neutral' };
  }
  function mrOddsRead(){
    var c = mrState.odds && mrState.odds.card, t = null;
    ((c && c.fall) || []).forEach(function(x){ if (x && x.id === 'fall10_6m') t = x; });
    if (!t || t.p == null || !isFinite(t.p)) return null;
    var p = Number(t.p), b = Number(t.base);
    var tone = isFinite(b) && b > 0 ? (p >= b * 1.3 ? 'off' : p <= b * 0.8 ? 'on' : 'neutral') : 'neutral';
    return { id: 'quant-labs', label: '10%+ fall within 6 months', noun: 'the market odds read', value: qlFrac(p) + (isFinite(b) ? ' (normal ' + qlFrac(b) + ')' : ''), tone: tone, rough: t.status !== 'working' };
  }
  function mrRhymesRead(){
    var n = mrState.rhymes && mrState.rhymes.now;
    if (!n || !n.stage) return null;
    return { id: 'history-rhymes', label: 'AI buildout signs', noun: 'the AI buildout read', value: n.stage.label + (n.score != null && n.total != null ? ' · ' + n.score + ' of ' + n.total : ''), tone: MR_HR_TONE[n.stage.id] || 'neutral' };
  }
  function mrReads(){
    return [
      { id: 'market', label: 'Cross-asset tape', read: mrTapeRead() },
      { id: 'bottom-tracker', label: 'Decline stage', read: mrBottomRead() },
      { id: 'quant-labs', label: '10%+ fall within 6 months', read: mrOddsRead() },
      { id: 'history-rhymes', label: 'AI buildout signs', read: mrRhymesRead() }
    ];
  }
  // The one sentence: agree, lean together, or disagree (and why).
  function mrLead(reads){
    var have = reads.filter(function(r){ return r.read; }).map(function(r){ return r.read; });
    var off = have.filter(function(r){ return r.tone === 'off'; });
    var on = have.filter(function(r){ return r.tone === 'on'; });
    if (have.length < 2) return '';
    if (off.length && on.length){
      return 'The reads disagree today: ' + off.map(function(r){ return r.noun; }).join(' and ') + (off.length === 1 ? ' leans' : ' lean') + ' defensive while ' +
        on.map(function(r){ return r.noun; }).join(' and ') + (on.length === 1 ? ' shows' : ' show') + ' no warning. That is usually the horizon, not an error.';
    }
    if (off.length === have.length) return 'All ' + have.length + ' reads lean defensive.';
    if (on.length === have.length) return 'All ' + have.length + ' reads show no warning.';
    if (off.length >= 2) return off.length + ' of ' + have.length + ' reads lean defensive and the rest are mixed.';
    if (on.length >= 2) return on.length + ' of ' + have.length + ' reads show no warning and the rest are mixed.';
    return 'No two reads point opposite ways today.';
  }
  // A read whose file came back empty or failed says so, rather than
  // "Not loaded yet" forever (a missing read is not a calm read).
  function mrDone(id){
    if (id === 'market') return !!mrState.done.market || (!marketState.loading && !!marketState.error && !marketState.data);
    if (id === 'bottom-tracker') return !!bottomTrackerState.data && !bottomTrackerState.loading;
    return !!mrState.done[id];
  }
  function mrHtml(here){
    var reads = mrReads();
    if (!reads.some(function(r){ return r.read; })) return '';
    var cells = reads.map(function(r){
      var x = r.read, on = r.id === here;
      var tone = x ? ' is-' + x.tone : ' is-none';
      var val = x ? escapeHtml(x.value) + (x.rough ? ' <span class="mr-rough" title="This model has not shown skill on held-out history; a rough guide only">rough</span>' : '') : '<span class="mr-na">' + (mrDone(r.id) ? 'Unavailable' : 'Not loaded yet') + '</span>';
      return '<button type="button" class="mr-read' + tone + (on ? ' is-here' : '') + '"' + (on ? ' aria-current="page"' : ' data-wf-go="' + r.id + '"') + '><small>' + escapeHtml(r.label) + '</small><b>' + val + '</b></button>';
    }).join('');
    var lead = mrLead(reads);
    var why = reads.filter(function(r){ return r.read; }).map(function(r){ return MR_HORIZON[r.id]; });
    return '<span class="mr-kicker">Market risk · four reads, four horizons</span>' +
      '<div class="mr-reads">' + cells + '</div>' +
      (lead ? '<p class="mr-lead">' + escapeHtml(lead) + '</p>' : '') +
      (why.length ? '<p class="mr-why">Why they can differ: ' + escapeHtml(why.join('; ')) + '. Each read keeps its own page; this line votes on nothing.</p>' : '');
  }
  function mrRender(){
    if (!HAS_OWNER_ACCESS) return;
    document.querySelectorAll('[data-mr-line]').forEach(function(host){
      var html = mrHtml(host.getAttribute('data-mr-line'));
      if (host.getAttribute('data-mr-html') === html) return;
      host.setAttribute('data-mr-html', html);
      host.innerHTML = html;
      host.hidden = !html;
    });
  }
  // Opening any of the three tabs asks for the four files once (each through
  // the cache its own page uses), then draws the line as each one arrives.
  function mrLoad(){
    if (!HAS_OWNER_ACCESS) return;
    mrRender();
    function settle(id, key){ return function(d){ if (d && key) mrState[key] = d; mrState.done[id] = true; mrRender(); }; }
    if (typeof qlFetch === 'function') qlFetch().then(settle('quant-labs', 'odds'), settle('quant-labs'));
    vnJson('history-rhymes.json', false).then(settle('history-rhymes', 'rhymes'), settle('history-rhymes'));
    if (!bottomTrackerState.data && !bottomTrackerState.loading && typeof loadBottomTracker === 'function') loadBottomTracker();
    // The tape: Market and Risk load market-analysis.json themselves; from the
    // Bottom tracker the line reads the same file once through the shared cache.
    if (!marketState.data && !marketState.loading && !mrState.tapeAsked && !(typeof marketRegimeBaked === 'function' && marketRegimeBaked())){
      mrState.tapeAsked = true;
      var tapeDone = function(j){
        if (j && j.macroRegime) mrState.tape = Object.assign({}, j.macroRegime, { builtAtIso: j.builtAtIso });
        mrState.done.market = true;
        mrRender();
      };
      vnJson('market-analysis.json', true).then(tapeDone, function(){ tapeDone(null); });
    }
  }
`;
}
