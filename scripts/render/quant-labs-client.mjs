// Quant labs: its own Owner page (2026-11-16; an Owner Lab view until the same day). Renders the Owner-only
// quant-labs.json written by every full bake (lib/labs/index.mjs): the chance
// of a 10% or 20% market fall and of a recovery, how honest every stated
// chance on the site has been, factor and volatility reads per stock, annual
// report text changes and the research registry. The same file feeds the
// "Market odds" card on the Bottom tracker and Risk analysis pages.
//
// Pasted into the app.js IIFE after renderSelfLoopJs(), so it reuses the
// evb* / slp* formatters, escapeHtml, $, dataUrl, quantFetchJson, VIEWS,
// vnTabsHtml, lineSvgHtml, lineLegendHtml, vtBarHtml, vtCbarHtml, rglEt and
// HAS_OWNER_ACCESS from that scope. ES5 only.
export function renderQuantLabsJs() {
  return `
  // ---- Quant labs (Owner page) -----------------------------------------------
  var qlState = { data: null, fetchedAt: 0, error: null, pending: null };
  var QL_TABS = [['summary', 'Summary'], ['odds', 'Market odds'], ['calibration', 'Calibration'], ['factors', 'Factors'], ['vol', 'Volatility'], ['filings', 'Annual reports'], ['registry', 'Registry']];
  var QL_STATUS = { working: ['Working', 'evb-s-pass'], weak: ['Weak', 'evb-s-unclear'], 'no-skill': ['No skill', 'evb-s-fail'], thin: ['Too few cases', 'evb-s-collect'] };
  var QL_CAL = {
    chance: { good: ['Honest and useful', 'evb-s-pass'], flat: ['Honest, adds little', 'evb-s-unclear'], over: ['States too high', 'evb-s-fail'], under: ['States too low', 'evb-s-fail'], uneven: ['Uneven', 'evb-s-unclear'], worse: ['Worse than the average', 'evb-s-fail'], few: ['Collecting', 'evb-s-collect'] },
    score: { good: ['Ranks outcomes', 'evb-s-pass'], flat: ['No clear ranking', 'evb-s-unclear'], worse: ['Backwards', 'evb-s-fail'], few: ['Collecting', 'evb-s-collect'] },
    range: { good: ['About right', 'evb-s-pass'], over: ['Too narrow', 'evb-s-fail'], under: ['Too wide', 'evb-s-unclear'], few: ['Collecting', 'evb-s-collect'] }
  };
  var QL_KIND = { chance: 'Chance', score: 'Score', range: 'Range' };
  var QL_REG = { holds: ['Holds up', 'evb-s-pass'], lucky: ['Could be luck', 'evb-s-unclear'], unproven: ['Unproven', 'evb-s-unclear'], losing: ['Losing', 'evb-s-fail'], few: ['Collecting', 'evb-s-collect'] };
  var QL_FAC = { holds: ['Holds up', 'evb-s-pass'], reversed: ['Holds, in reverse', 'evb-s-pass'], lucky: ['Could be luck', 'evb-s-unclear'], none: ['No proven edge', 'evb-s-unclear'], few: ['Collecting', 'evb-s-collect'] };
  var QL_VOLREAD = { rich: ['Rich', 'evb-s-fail'], cheap: ['Cheap', 'evb-s-pass'], fair: ['Fair', 'evb-s-unclear'] };
  var QL_MODEL = { trailing: 'Last 21 sessions', ewma: 'Weighted recent moves (EWMA)', garch: 'GARCH', har: 'Day, week and month mix (HAR)' };
  var QL_RES = { working: ['Working', 'evb-s-pass'], weak: ['Weak', 'evb-s-unclear'], 'no-skill': ['No skill', 'evb-s-fail'], holds: ['Holds up', 'evb-s-pass'], lucky: ['Could be luck', 'evb-s-unclear'], none: ['No proven edge', 'evb-s-unclear'], better: ['Better', 'evb-s-pass'], same: ['No gain', 'evb-s-unclear'], worse: ['Worse', 'evb-s-fail'], thin: ['Too few cases', 'evb-s-collect'], few: ['Collecting', 'evb-s-collect'], unproven: ['Unproven', 'evb-s-unclear'] };

  function qlFrac(v, d){ return v == null || !isFinite(v) ? '—' : (Number(v) * 100).toFixed(d == null ? 0 : d) + '%'; }
  function qlPtsPct(v, d){ return v == null || !isFinite(v) ? '—' : slpPts(v, d) + '%'; }
  function qlNumPct(v, d){ return v == null || !isFinite(v) ? '—' : slpNum(v, d) + '%'; }
  function qlSkill(v){ return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (Number(v) * 100).toFixed(1) + '%'; }
  function qlPill(pair){ return pair ? '<span class="evb-pill ' + pair[1] + '">' + escapeHtml(pair[0]) + '</span>' : ''; }
  function qlStale(block){ return block && block.stale ? '<p class="ql-warn">Last good copy: this lab could not run on the newest build.</p>' : ''; }
  function qlMissing(block, what){ return '<p class="hint">' + escapeHtml((block && block.note) || (what + ' is not available yet. The next full build writes it.')) + '</p>'; }
  function qlH(title){ return '<h4 class="slp-h4">' + escapeHtml(title) + '</h4>'; }
  function qlRange(r){ return r && r.length === 2 && r[0] != null && r[1] != null ? qlFrac(r[0]) + ' to ' + qlFrac(r[1]) : '—'; }
  function qlTarget(d, id){ var out = null; ((d.drawdown && d.drawdown.targets) || []).forEach(function(t){ if (t.id === id) out = t; }); return out; }
  function qlJump(tab, text){ return '<button type="button" class="ql-linkbtn" data-ql-tab="' + tab + '">' + escapeHtml(text) + '</button>'; }

  // One sentence for the headline chance, shared by the page and the cards.
  function qlHeadline(t){
    if (!t || t.p == null) return '';
    return 'Chance of a 10%+ drop within 6 months: <b>' + qlFrac(t.p) + '</b> (normal ' + qlFrac(t.base) + (t.range && t.range[0] != null ? ', range ' + qlRange(t.range) : '') + ').';
  }

  // ---- Summary ---------------------------------------------------------------
  function qlSummaryHtml(d){
    var card = d.card || null, cal = (d.calibration && d.calibration.summary) || {}, reg = (d.registry && d.registry.summary) || {};
    var vol = d.vol || {}, fil = d.filings || {}, fac = d.factors || {};
    var six = null; ((card && card.fall) || []).forEach(function(t){ if (t.id === 'fall10_6m') six = t; });
    var kpis = [
      ['10%+ fall within 6 months', six ? qlFrac(six.p) + ' <small>normal ' + qlFrac(six.base) + '</small>' : '—', 'Chance the S&P 500 closes 10% or more below its latest close within 6 months, against how often that happened since 1962'],
      ['Stated chances checked', String(cal.total || 0) + ' <small>' + (cal.good || 0) + ' honest and useful</small>', 'Every chance, score and range the site states that can be graded against what happened'],
      ['Trade books that hold up', (reg.holds || 0) + ' of ' + (reg.total || 0), 'Books whose average result survives the penalty for how many rule sets were tried'],
      ['Options rich / cheap', vol.summary ? vol.summary.rich + ' / ' + vol.summary.cheap : '—', 'Stocks whose option prices sit 8 or more points over, or 3 or more points under, the volatility forecast'],
      ['Stocks with factor ranks', String((fac.names || []).length)],
      ['Annual reports compared', String(fil.read || 0)],
    ];
    var lines = [];
    if (six) lines.push('<li>' + qlJump('odds', 'Market odds') + ': ' + qlHeadline(six) + ' ' + qlPill(QL_STATUS[six.status]) + '</li>');
    else lines.push('<li>' + qlJump('odds', 'Market odds') + ': not available yet.</li>');
    var off = [];
    ((d.calibration && d.calibration.sources) || []).forEach(function(s){ if (s.verdict === 'worse' || s.verdict === 'over' || s.verdict === 'under') off.push(s.label); });
    lines.push('<li>' + qlJump('calibration', 'Calibration') + ': ' + (cal.good || 0) + ' of ' + (cal.total || 0) + ' sources are honest and useful, ' + (cal.off || 0) + ' are off, ' + (cal.flat || 0) + ' add little and ' + (cal.few || 0) + ' are still collecting.' + (off.length ? ' Off: ' + escapeHtml(off.slice(0, 3).join('; ')) + '.' : '') + '</li>');
    var hist = fac.history || null, passed = 0;
    ((hist && hist.rows) || []).forEach(function(r){ if (r.verdict === 'holds') passed++; });
    lines.push('<li>' + qlJump('factors', 'Factors') + ': ' + (hist ? passed + ' of ' + hist.rows.length + ' price factors passed the history test on the covered stocks (bar: t ' + slpNum(hist.tBar, 2) + ' after ' + hist.trials + ' tries).' : 'no history test on the covered stocks on file yet.') + (fac.universe && fac.universe.factors ? ' On the 500 largest US companies, ' + qlUniversePassed(fac.universe).length + ' of ' + fac.universe.factors.length + ' factors held up.' : '') + (fac.gradeVs && fac.gradeVs.status === 'ok' ? ' Factors explain ' + qlFrac(fac.gradeVs.r2) + ' of today\\'s grade.' : '') + '</li>');
    lines.push('<li>' + qlJump('vol', 'Volatility') + ': ' + (vol.status === 'ok' ? 'forecast model ' + escapeHtml(QL_MODEL[vol.model] || vol.model) + '; the median stock\\'s options sit ' + slpPts(vol.summary && vol.summary.medianPremium) + ' points against the forecast.' : 'not available yet.') + '</li>');
    lines.push('<li>' + qlJump('filings', 'Annual reports') + ': ' + (fil.read ? fil.read + ' compared with the year before, ' + ((fil.summary && fil.summary.rewritten) || 0) + ' with a rewritten risk section.' : 'collecting, a few companies per build.') + '</li>');
    lines.push('<li>' + qlJump('registry', 'Registry') + ': ' + (reg.holds || 0) + ' of ' + (reg.total || 0) + ' trade books hold up once the number of things tried is counted; ' + (reg.losing || 0) + ' are losing.</li>');
    return '<p class="evb-lead">Six measurement labs, rebuilt on every full build with no AI call. Each one answers a plain question: how likely is a market fall, are the site\\'s stated chances honest, what do the grade and the trades lean on, are options priced over or under the moves to come, what changed in the annual reports, and which results would survive counting every attempt.</p>' +
      slpKpis(kpis) + '<ul class="ql-lines">' + lines.join('') + '</ul>';
  }

  // ---- Market odds -----------------------------------------------------------
  function qlBinsChart(bins, aria){
    if (!bins || bins.length < 2) return '';
    var labels = bins.map(function(b){ return Math.round(b.p * 100) + '%'; });
    var series = [
      { name: 'Stated', values: bins.map(function(b){ return b.p * 100; }), cls: 'ln-s1', dashed: true },
      { name: 'Happened', values: bins.map(function(b){ return b.hit * 100; }), cls: 'ln-s0', dots: true },
    ];
    return lineLegendHtml(series) + lineSvgHtml({ labels: labels, series: series, h: 220, zero: true, yFmt: function(v){ return Math.round(v) + '%'; }, ariaLabel: aria });
  }
  function qlTargetDetail(t){
    if (!t || t.status === 'thin') return '';
    var eras = (t.eraSkill || []).map(function(e){
      var beat = e.brier != null && e.baseBrier != null ? (e.brier < e.baseBrier ? '<span class="sig-pos">Yes</span>' : '<span class="sig-neg">No</span>') : '—';
      return '<tr><td>' + escapeHtml(e.era) + '</td><td class="num">' + (e.n || 0) + '</td><td class="num">' + (e.events || 0) + '</td><td class="num">' + qlFrac(e.meanP) + '</td><td class="num">' + slpNum(e.brier, 3) + '</td><td class="num">' + slpNum(e.baseBrier, 3) + '</td><td class="num">' + beat + '</td></tr>';
    }).join('');
    var maxW = 0; (t.weights || []).forEach(function(w){ maxW = Math.max(maxW, Math.abs(w.w || 0)); });
    var weights = (t.weights || []).map(function(w){
      return '<tr><td>' + escapeHtml(w.label) + '</td><td class="num">' + (w.w ? vtCbarHtml(w.w, maxW || 1, (w.w > 0 ? '+' : '') + Number(w.w).toFixed(2)) : '<span class="crd-dim">not used</span>') + '</td></tr>';
    }).join('');
    return '<details class="rgl-details slp-details"><summary>' + escapeHtml(t.label) + ': the test behind it</summary>' +
      '<p class="evb-note">Each decline era was left out in turn, the model was fitted on the rest, and its chances were graded on the era it never saw. ' + (t.tested || 0) + ' dates graded this way, ' + (t.events || 0) + ' of them followed by the event. ' + (t.recalibrated ? 'The raw chances were rescaled once because that improved the held-out score.' : 'The raw chances are used as fitted.') + '</p>' +
      qlBinsChart(t.bins, 'Stated chance against how often the event followed, ' + t.label) +
      (eras ? slpTable([['Era left out'], ['Dates', 1], ['Events', 1], ['Avg chance stated', 1], ['Squared miss', 1], ['Always-the-average miss', 1], ['Beat the average', 1]], eras) : '') +
      (weights ? qlH('What the model leans on') + '<p class="evb-note">Weights on inputs scaled to the same units; a bar to the right raises the chance when the input is high. An input whose history points the wrong way for its expected direction is left at zero.</p>' + slpTable([['Input'], ['Weight', 1]], weights) : '') +
      '</details>';
  }
  function qlOddsHtml(d){
    var dd = d.drawdown || {};
    if (dd.status !== 'ok') return qlMissing(dd, 'The market odds read');
    var T = dd.targets || [], head = qlTarget(d, 'fall10_6m');
    var lead = '<p class="evb-lead">' + (head && head.today != null ? qlHeadline({ p: head.today, base: head.base, range: head.range }) + ' ' + qlPill(QL_STATUS[head.status]) : 'No headline chance on this build.') + ' Read through the ' + escapeHtml(evbDate(dd.asOf)) + ' close, with the S&P 500 ' + slpNum(dd.offHigh, 1) + '% under its high.</p>';
    var rows = T.map(function(t){
      var gap = t.today != null && t.base != null ? (t.today - t.base) * 100 : null;
      // A higher chance of a fall is bad news; a higher chance of the low holding or a new high is good news.
      var gapCls = gap == null || Math.abs(gap) < 0.5 ? '' : (gap > 0) === (t.kind === 'fall') ? 'sig-neg' : 'sig-pos';
      var held = t.note && /already held/.test(t.note);
      var today = t.today != null ? '<b>' + qlFrac(t.today) + '</b>' : '<span class="crd-dim"' + (t.note ? ' title="' + escapeHtml(t.note) + '"' : '') + '>' + (t.kind === 'fall' ? '—' : held ? 'already held' : 'only in a 10%+ decline') + '</span>';
      return '<tr><td>' + escapeHtml(t.label) + '</td><td class="num">' + today + '</td><td class="num">' + qlFrac(t.base) + '</td><td class="num">' + (t.today != null ? qlRange(t.range) : '—') + '</td><td class="num ' + gapCls + '">' + (gap == null ? '—' : slpPts(gap, 0) + ' pts') + '</td><td class="num ' + slpSign(t.skill) + '">' + qlSkill(t.skill) + '</td><td class="num">' + (t.events || 0) + ' of ' + (t.n || 0) + '</td><td>' + qlPill(QL_STATUS[t.status]) + '</td></tr>';
    }).join('');
    var table = slpTable([['Event'], ['Chance now', 1], ['Normal', 1, 'How often the event followed across the whole history'], ['Range', 1, 'Middle 80% of the chance when the decline eras are resampled'], ['Against normal', 1], ['Skill', 1, 'Share of the always-say-the-average squared miss removed, with each decline era held out. Above 0 adds something; 5% or more with a range above 0 counts as working.'], ['Past cases', 1, 'Dates followed by the event, of all dates graded'], ['Status']], rows);
    var drivers = head && head.drivers && head.drivers.length ? '<p class="evb-note"><strong>What is moving the 6-month chance:</strong> ' + head.drivers.map(function(x){ return escapeHtml(x.label) + ' (' + (x.push > 0 ? 'raises it' : 'lowers it') + ')'; }).join('; ') + '.</p>' : '';
    var inputs = (dd.inputs || []).map(function(x){
      var val = x.value == null || !isFinite(x.value) ? '—' : x.unit === '%' ? slpNum(x.value, 1) + '%' : x.unit === 'pts' ? slpNum(x.value, 2) + ' pts' : x.unit === 'x' ? slpNum(x.value, 2) + '×' : slpNum(x.value, 0);
      return '<tr><td>' + escapeHtml(x.label) + '</td><td class="num">' + val + '</td><td class="num">' + (x.pct != null ? vtBarHtml(x.pct / 100, '', x.pct + 'th') : '—') + '</td><td class="num">' + escapeHtml(String(x.from || '').slice(0, 4)) + '</td></tr>';
    }).join('');
    var log = dd.log || [], chart = '';
    if (log.length >= 2){
      var series = [
        { name: '10%+ within 6 months', values: log.map(function(r){ return r.fall10_6m == null ? null : r.fall10_6m * 100; }), cls: 'ln-s0' },
        { name: '10%+ within 12 months', values: log.map(function(r){ return r.fall10_12m == null ? null : r.fall10_12m * 100; }), cls: 'ln-s1' },
        { name: '20%+ within 12 months', values: log.map(function(r){ return r.fall20_12m == null ? null : r.fall20_12m * 100; }), cls: 'ln-s2' },
      ];
      chart = qlH('The chance stated at each close') + lineLegendHtml(series) + lineSvgHtml({ labels: log.map(function(r){ return evbDate(r.d); }), series: series, h: 220, zero: true, yFmt: function(v){ return Math.round(v) + '%'; }, ariaLabel: 'Stated chance of a market fall at each close' }) +
        '<p class="evb-note">Each close writes one row. Once enough time has passed these stated chances are graded on the Calibration tab, separately from the history test.</p>';
    } else chart = '<p class="evb-note">The log of stated chances starts with this build; the line appears from the second close.</p>';
    var study = dd.study, studyHtml = '';
    if (study){
      var ridge = (study.ridge || []).map(function(r){
        return '<tr><td>' + r.l2 + (r.l2 === dd.l2 ? ' <span class="crd-dim">in use</span>' : '') + '</td>' + ['fall10_3m', 'fall10_6m', 'fall10_12m', 'fall20_12m', 'lowIn_6m', 'newHigh_12m'].map(function(k){ var v = r.skill && r.skill[k]; return '<td class="num ' + slpSign(v) + '">' + qlSkill(v) + '</td>'; }).join('') + '</tr>';
      }).join('');
      studyHtml = '<details class="rgl-details slp-details"><summary>Side checks from the history run</summary>' +
        '<p class="evb-note">The fit strength (20) was fixed before the test. The other two strengths are shown to check that the result does not hang on that choice.</p>' +
        slpTable([['Fit strength'], ['10% in 3m', 1], ['10% in 6m', 1], ['10% in 12m', 1], ['20% in 12m', 1], ['Low holds', 1], ['New high in 12m', 1]], ridge) +
        (study.breadth ? '<p class="evb-note"><strong>Market breadth as an extra input</strong> (share of sector funds above their 200-day average, from ' + escapeHtml(String(study.breadth.from || '').slice(0, 4)) + '): ' + escapeHtml(study.breadth.read || '') + '</p>' : '') + '</details>';
    }
    return qlStale(dd) + lead + table + drivers +
      '<p class="evb-note">A logistic model fitted on S&amp;P 500 month-ends since ' + escapeHtml(String(dd.sampleFrom || '').slice(0, 4)) + ' (' + (dd.samples || 0) + ' dates, ' + ((dd.eras || []).length) + ' decline eras). Each input may only push in the direction set before fitting. "Normal" is how often the event followed across that whole history. The recovery rows apply only while the index is 10% or more under its high.</p>' +
      chart + qlH('The inputs today') + slpTable([['Input'], ['Value', 1], ['Rank in its own history', 1], ['Since', 1]], inputs) +
      T.map(qlTargetDetail).join('') + studyHtml;
  }

  // ---- Calibration -----------------------------------------------------------
  function qlCalDetail(s){
    var out = '';
    if (s.note) out += '<p class="evb-note">' + escapeHtml(s.note) + '</p>';
    if (s.bins && s.bins.length){
      out += slpTable([['Stated', 1], ['Happened', 1], ['Rows', 1]], s.bins.map(function(b){ return '<tr><td class="num">' + qlFrac(b.p) + '</td><td class="num">' + qlFrac(b.hit) + '</td><td class="num">' + b.n + '</td></tr>'; }).join(''));
    }
    if (s.bands && s.bands.length){
      out += slpTable([['Score band'], ['Event rate', 1], ['Rows', 1]], s.bands.map(function(b){ return '<tr><td>' + slpNum(b.lo, 1) + ' to ' + slpNum(b.hi, 1) + '</td><td class="num">' + qlFrac(b.hit) + '</td><td class="num">' + b.n + '</td></tr>'; }).join(''));
    }
    return out;
  }
  function qlCalibrationHtml(d){
    var c = d.calibration || {};
    if (!c.sources) return qlMissing(c, 'The calibration lab');
    var cols = [
      { label: '', nosort: true, cell: function(s){ return qlCalDetail(s) ? VIEWS.expandHtml('Show the bands') : ''; } },
      { label: 'What is stated', cls: 'ql-labelcell', cell: function(s){ return '<b>' + escapeHtml(s.label) + '</b>' + (s.where ? '<div class="crd-dim">' + escapeHtml(s.where) + '</div>' : '') + (s.read ? '<div class="ql-readline">' + escapeHtml(s.read) + '</div>' : ''); }, sort: function(s){ return s.label; } },
      { label: 'Kind', cell: function(s){ return QL_KIND[s.kind] || s.kind; }, sort: function(s){ return s.kind; } },
      { label: 'Graded', num: true, cell: function(s){ return String(s.n || 0); }, sort: function(s){ return s.n || 0; } },
      { label: 'Stated', num: true, title: 'Average chance stated (or the coverage a range claims)', cell: function(s){ return s.kind === 'range' ? qlFrac(s.claimed) : s.kind === 'chance' ? qlFrac(s.stated) : ''; }, sort: function(s){ return s.kind === 'range' ? s.claimed : s.stated; } },
      { label: 'Happened', num: true, title: 'How often the event happened (or the result landed inside the range)', cell: function(s){ return s.kind === 'range' ? qlFrac(s.covered) : qlFrac(s.rate); }, sort: function(s){ return s.kind === 'range' ? s.covered : s.rate; } },
      { label: 'Skill', num: true, title: 'Chances: share of the always-say-the-average squared miss removed. Scores: how often a winner outranked a loser (50% is no skill).', cell: function(s){ return s.kind === 'chance' ? (s.skill == null ? '' : '<span class="' + slpSign(s.skill) + '">' + qlSkill(s.skill) + '</span>') : s.kind === 'score' ? (s.auc == null ? '' : qlFrac(s.auc) + ' <span class="crd-dim">rank</span>') : ''; }, sort: function(s){ return s.kind === 'chance' ? s.skill : s.kind === 'score' ? (s.auc == null ? null : s.auc - 0.5) : null; } },
      { label: 'Verdict', cell: function(s){ return qlPill((QL_CAL[s.kind] || QL_CAL.chance)[s.verdict]); }, sort: function(s){ return s.verdict; } },
    ];
    var sum = c.summary || {};
    return qlStale(c) + '<p class="evb-lead">Every chance, score and range the site states, graded against what happened. A chance is honest when events it calls 30% happen about 30% of the time, and useful when it beats always saying the average.</p>' +
      slpKpis([['Sources', String(sum.total || 0)], ['Honest and useful', String(sum.good || 0)], ['Off', String(sum.off || 0), 'Stated too high, too low, or worse than always saying the average'], ['Adds little', String(sum.flat || 0)], ['Still collecting', String(sum.few || 0), 'Fewer than 30 graded rows']]) +
      VIEWS.tableHtml(cols, c.sources, { key: 'ql-cal', tall: false, cls: 'ql-table', empty: 'No sources yet.', detail: qlCalDetail }) +
      '<p class="evb-note">The market-odds rows come from the history test (each decline era held out); a second set of rows grades the chances stated live once their window has passed. Scores are not chances, so they are judged on ranking only.</p>';
  }

  // ---- Factors ---------------------------------------------------------------
  function qlUniversePassed(u){
    return ((u && u.factors) || []).filter(function(r){ return r.verdict === 'holds' || r.verdict === 'reversed'; });
  }
  // The wide history test: the 500 largest US companies at each month-end.
  function qlUniverseHtml(u){
    if (!u || !u.factors || !u.factors.length) return '';
    var fams = {};
    (u.families || []).forEach(function(x){ fams[x.key] = x.label; });
    var rows = '', last = null;
    u.factors.forEach(function(r){
      if (r.family !== last){ last = r.family; rows += '<tr class="ql-fam"><td colspan="13">' + escapeHtml(fams[r.family] || r.family) + '</td></tr>'; }
      rows += qlUniverseRow(r, r.label, r.hint);
    });
    if (u.composite) rows += '<tr class="ql-fam"><td colspan="13">All together</td></tr>' + qlUniverseRow(u.composite, 'Value, momentum, profitability, quality and earnings growth', 'Each company\\'s average rank across the five families, equally weighted');
    var passed = qlUniversePassed(u);
    var read = passed.length
      ? passed.length + ' of ' + u.factors.length + ' factors held up after costs and after counting everything tried: ' + passed.map(function(r){ return r.label + (r.verdict === 'reversed' ? ' (in reverse)' : ''); }).join(', ') + '.'
      : 'None of the ' + u.factors.length + ' factors held up after costs and after counting everything tried.';
    var frows = (u.families || []).map(function(x){
      return '<tr><td>' + escapeHtml(x.label) + '</td><td class="num ' + slpSign(x.slope) + '">' + slpPts(x.slope, 2) + '%</td><td class="num">' + slpNum(x.t, 2) + '</td><td class="num ' + slpSign(x.first) + '">' + slpPts(x.first, 2) + '%</td><td class="num ' + slpSign(x.second) + '">' + slpPts(x.second, 2) + '%</td><td class="num">' + (x.months || 0) + '</td></tr>';
    }).join('');
    var caveats = (u.caveats || []).map(function(c){ return '<li>' + escapeHtml(c) + '</li>'; }).join('');
    return '<div class="ql-universe" data-ql-universe>' +
      qlH('History test: the ' + (u.size || 500) + ' largest US companies, ' + String(u.from || '').slice(0, 4) + ' to ' + String(u.to || '').slice(0, 4)) +
      '<p class="evb-lead ql-universe-read">' + escapeHtml(read) + '</p>' +
      '<p class="evb-note">Each month-end the ' + (u.names || u.size || 500) + ' largest of ' + (u.pool || 0) + ' US companies are ranked on every factor, using only numbers that were already filed, and the next month\\'s return is read (' + (u.months || 0) + ' months). Rank skill is the correlation between the rank and the return that followed, 1 to 12 months ahead. The spread is the top fifth minus the bottom fifth, per year, before and after a cost of ' + (u.costBps || 10) + ' basis points a side. ' + (u.trials || 0) + ' things were tried, so a result needs a t value of ' + slpNum(u.tBar, 2) + ' and the same sign in both halves. The smallest company in the ' + (u.size || 500) + ' was worth $' + slpNum(u.smallest && u.smallest.first, 1) + 'B at the start and $' + slpNum(u.smallest && u.smallest.last, 1) + 'B at the end.</p>' +
      slpTable([['Factor'], ['1 mo', 1], ['3 mo', 1], ['6 mo', 1], ['12 mo', 1], ['Spread a year', 1], ['After costs', 1], ['t', 1, 't value of the monthly spread'], ['Worst fall', 1], ['Turnover', 1, 'Share of the top and bottom fifths replaced each month'], ['Top fifth vs all', 1, 'What buying only the top fifth earned over the average company, per year. The site buys calls and puts on single names, so this is the long-only read'], ['Both halves'], ['Verdict']], rows) +
      (frows ? qlH('Each family with the others held fixed') +
        '<p class="evb-note">One regression per month of the next month\\'s return on all seven family scores at once (' + (u.familyMonths || 0) + ' months). A plus means companies ranking one standard step higher on that family earned that much more the next month than companies that looked the same on every other family.</p>' +
        slpTable([['Family'], ['Per month', 1], ['t', 1], ['First half', 1], ['Second half', 1], ['Months', 1]], frows) : '') +
      (caveats ? '<details class="rgl-details slp-details"><summary>Limits of this test</summary><ul class="ql-list">' + caveats + '</ul></details>' : '') +
      '<p class="evb-note">Ran ' + escapeHtml(evbDate(u.ran)) + ' on public data downloaded ' + escapeHtml(evbDate(u.data && u.data.builtAt)) + '. Aggregates only: no company is named or ranked here, and nothing on this page changes a pick or a grade.</p>' +
      '</div>';
  }
  function qlUniverseRow(r, label, hint){
    var by = {}; (r.ic || []).forEach(function(x){ by[x.h] = x; });
    var sp = r.spread || {};
    return '<tr><td' + (hint ? ' title="' + escapeHtml(hint) + '"' : '') + '>' + escapeHtml(label) + '</td>' + qlIcCell(by[1]) + qlIcCell(by[3]) + qlIcCell(by[6]) + qlIcCell(by[12]) +
      '<td class="num ' + slpSign(sp.perYear) + '">' + qlPtsPct(sp.perYear) + '</td><td class="num ' + slpSign(sp.net) + '">' + qlPtsPct(sp.net) + '</td><td class="num">' + slpNum(sp.t, 2) + '</td><td class="num">' + qlNumPct(sp.worst, 0) + '</td><td class="num">' + qlFrac(sp.turnover) + '</td><td class="num ' + slpSign(sp.topVsAll) + '">' + qlPtsPct(sp.topVsAll) + '</td><td>' + (r.bothHalves == null ? '—' : r.bothHalves ? 'Yes' : 'No') + '</td><td>' + qlPill(QL_FAC[r.verdict]) + '</td></tr>';
  }
  function qlIcCell(r){
    if (!r || r.ic == null) return '<td class="num">—</td>';
    return '<td class="num ' + slpSign(r.ic) + '" title="' + (r.n || 0) + ' dates' + (r.t != null ? ', t ' + Number(r.t).toFixed(2) : '') + '">' + slpPts(r.ic, 3) + '</td>';
  }
  function qlHeat(v){
    if (v == null || !isFinite(v)) return '<span class="vt-na">—</span>';
    var band = v >= 80 ? 'ql-h5' : v >= 60 ? 'ql-h4' : v >= 40 ? 'ql-h3' : v >= 20 ? 'ql-h2' : 'ql-h1';
    return '<span class="ql-heat ' + band + '">' + Math.round(v) + '</span>';
  }
  function qlFactorsHtml(d){
    var f = d.factors || {};
    if (f.status !== 'ok') return qlMissing(f, 'The factor lab');
    var out = qlStale(f) + '<p class="evb-lead">A factor is a simple, well-known trait of a stock: recent momentum, low volatility, cheapness, profitability. This lab asks three things: does any of them predict returns in our names, how much of the grade is just these traits, and what the trades lean on.</p>';
    var hist = f.history;
    if (hist && hist.rows){
      var hrows = hist.rows.map(function(r){
        var by = {}; (r.ic || []).forEach(function(x){ by[x.h] = x; });
        var sp = r.spread || {};
        return '<tr><td>' + escapeHtml(r.label) + '</td>' + qlIcCell(by[1]) + qlIcCell(by[5]) + qlIcCell(by[21]) + qlIcCell(by[63]) + '<td class="num ' + slpSign(sp.perYear) + '">' + slpPts(sp.perYear) + '%</td><td class="num ' + slpSign(sp.net) + '">' + slpPts(sp.net) + '%</td><td class="num">' + slpNum(sp.t, 2) + '</td><td class="num">' + slpNum(sp.worst, 0) + '%</td><td class="num">' + qlFrac(sp.turnover) + '</td><td>' + (r.bothHalves == null ? '—' : r.bothHalves ? 'Yes' : 'No') + '</td><td>' + qlPill(QL_FAC[r.verdict]) + '</td></tr>';
      }).join('');
      out += qlH('History test: ' + hist.names + ' covered stocks, ' + String((hist.calendar && hist.calendar.from) || '').slice(0, 4) + ' to ' + String((hist.calendar && hist.calendar.to) || '').slice(0, 4)) +
        '<p class="evb-note">Rank skill is the correlation between the factor and the return that followed (1, 5, 21 and 63 sessions). The spread is the top third minus the bottom third, per year, before and after trading costs. ' + hist.trials + ' factor-and-horizon pairs were tried, so a result needs a t value of ' + slpNum(hist.tBar, 2) + ' to count, and the same sign in both halves.' + (hist.caveat ? ' ' + escapeHtml(hist.caveat) : '') + '</p>' +
        slpTable([['Factor'], ['1 day', 1, 'Rank skill 1 session ahead'], ['5 days', 1, 'Rank skill 5 sessions ahead'], ['21 days', 1, 'Rank skill 21 sessions ahead'], ['63 days', 1, 'Rank skill 63 sessions ahead'], ['Spread a year', 1], ['After costs', 1], ['t', 1], ['Worst fall', 1], ['Turnover', 1, 'Share of the top and bottom thirds replaced at each monthly rebalance'], ['Both halves'], ['Verdict']], hrows);
    }
    out += qlUniverseHtml(f.universe);
    if (f.skill && f.skill.length){
      var srows = f.skill.map(function(r){
        var by = {}; (r.ic || []).forEach(function(x){ by[x.h] = x; });
        return '<tr' + (r.key === 'grade' ? ' class="is-current"' : '') + '><td>' + escapeHtml(r.label) + '</td>' + qlIcCell(by[1]) + qlIcCell(by[5]) + qlIcCell(by[21]) + qlIcCell(by[63]) + '<td class="num">' + ((by[21] && by[21].n) || 0) + '</td></tr>';
      }).join('');
      out += qlH('Live panel: rank skill since the weekly snapshots began') +
        '<p class="evb-note">One snapshot of every factor is kept each week (' + (f.snapshots || 0) + ' so far). The fundamental factors (value, margins, growth, debt) have no free point-in-time history, so their skill can only be measured forward from these snapshots. The grade is scored the same way for comparison.</p>' +
        slpTable([['Factor'], ['1', 1], ['5', 1], ['21', 1], ['63', 1], ['Weeks at 21', 1]], srows);
    }
    if (f.exposures && f.exposures.length){
      var names = [], shortOf = {};
      f.exposures.forEach(function(b){ (b.betas || []).forEach(function(x){ if (names.indexOf(x.label) < 0){ names.push(x.label); shortOf[x.label] = x.short || x.label; } }); });
      var erows = f.exposures.map(function(b){
        if (b.status !== 'ok') return '<tr><td>' + escapeHtml(b.label) + '</td><td class="num">' + (b.n || 0) + '</td><td colspan="' + (names.length + 3) + '"><span class="crd-dim">Collecting: needs more days with positions</span></td></tr>';
        var by = {}; (b.betas || []).forEach(function(x){ by[x.label] = x; });
        return '<tr><td>' + escapeHtml(b.label) + '</td><td class="num">' + b.n + '</td><td class="num ' + slpSign(b.total) + '">' + slpPts(b.total) + '%</td>' + names.map(function(n){ var x = by[n]; return x ? '<td class="num' + (Math.abs(x.t || 0) >= 2 ? ' ql-strong' : '') + '" title="t ' + slpNum(x.t, 2) + '">' + slpPts(x.beta, 2) + '</td>' : '<td class="num">—</td>'; }).join('') + '<td class="num ' + slpSign(b.alpha) + '" title="t ' + slpNum(b.alphaT, 2) + '">' + slpPts(b.alpha) + '%</td><td class="num">' + qlFrac(b.r2) + '</td></tr>';
      }).join('');
      out += qlH('What each book leans on') +
        '<p class="evb-note">Each book\\'s daily return is split into the part explained by the market, small against large stocks, growth against the market, and momentum and low volatility inside our names. What is left is the book\\'s own return per year. The grade book holds the top third of stocks by grade against the bottom third. A bold number is a lean that is unlikely to be chance (t of 2 or more).</p>' +
        slpTable([['Book'], ['Days', 1], ['Return a year', 1]].concat(names.map(function(n){ return [shortOf[n], 1, n]; })).concat([['Left over a year', 1, 'Return not explained by the factors'], ['Explained', 1, 'Share of the day-to-day swings the factors account for']]), erows);
    }
    var gv = f.gradeVs;
    if (gv && gv.status === 'ok'){
      var loads = (gv.loads || []).map(function(x){ return '<tr><td>' + escapeHtml(x.label) + '</td><td class="num">' + slpPts(x.corr, 2) + '</td><td class="num">' + slpNum(x.t, 2) + '</td></tr>'; }).join('');
      var cols = [
        { label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b>'; }, sort: function(r){ return r.s; } },
        { label: 'Grade', num: true, cell: function(r){ return '<span class="' + slpSign(r.grade) + '">' + slpPts(r.grade) + '</span>'; }, sort: function(r){ return r.grade; } },
        { label: 'Grade rank', num: true, cell: function(r){ return String(r.rank); }, sort: function(r){ return r.rank; } },
        { label: 'Net of factors', num: true, title: 'The grade with the part explained by momentum, trend, volatility and beta taken out', cell: function(r){ return '<span class="' + slpSign(r.net) + '">' + slpPts(r.net) + '</span>'; }, sort: function(r){ return r.net; } },
        { label: 'Net rank', num: true, cell: function(r){ return String(r.netRank); }, sort: function(r){ return r.netRank; } },
        { label: 'Places moved', num: true, cell: function(r){ var m = r.rank - r.netRank; return '<span class="' + slpSign(m) + '">' + (m > 0 ? '+' : '') + m + '</span>'; }, sort: function(r){ return r.rank - r.netRank; } },
      ];
      out += qlH('The grade with the factor part taken out') +
        '<p class="evb-note">Across ' + gv.n + ' stocks, four price traits explain ' + qlFrac(gv.r2) + ' of today\\'s grade; taking them out moves the median stock ' + (gv.medianShift || 0) + ' places. A low share means the grade is mostly its own view, not momentum by another name. This is a read only: the grade and the pick order are unchanged.</p>' +
        slpTable([['Trait'], ['Link to the grade', 1, 'Correlation across stocks today'], ['t', 1]], loads) +
        VIEWS.tableHtml(cols, gv.names || [], { key: 'ql-gradevs', tall: true, cls: 'ql-table', empty: 'No grades to compare.' });
    }
    if (f.trades && f.trades.length && f.list){
      var keys = f.list.filter(function(x){ return x.price; }).slice(0, 7);
      var trows = f.trades.map(function(t){
        return '<tr><td><b>' + escapeHtml(t.s) + '</b> ' + escapeHtml(t.side || '') + '</td>' + keys.map(function(k){ return '<td class="num">' + qlHeat(t.f && t.f[k.key]) + '</td>'; }).join('') + '<td>' + escapeHtml(evbDate(t.loggedOn)) + (t.atEntry ? '' : ' <span class="crd-dim">after entry</span>') + '</td></tr>';
      }).join('');
      out += qlH('Open Top Picks trades: where each stock ranks today') +
        '<p class="evb-note">Rank among the covered stocks, 0 to 99. The values are also frozen the first day the lab sees a trade, so closed trades can later be split by what they leaned on.</p>' +
        slpTable([['Trade']].concat(keys.map(function(k){ return [k.short || k.label, 1, k.label + ': ' + k.hint]; })).concat([['Logged']]), trows);
    }
    if (f.names && f.names.length && f.list){
      var fcols = [{ label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b>'; }, sort: function(r){ return r.s; } },
        { label: 'Grade', num: true, cell: function(r){ return r.grade == null ? '' : '<span class="' + slpSign(r.grade) + '">' + slpPts(r.grade) + '</span>'; }, sort: function(r){ return r.grade; } }];
      f.list.forEach(function(x){
        fcols.push({ label: x.short || x.label, num: true, title: x.label + ': ' + x.hint, cell: function(r){ return qlHeat(r.f && r.f[x.key]); }, sort: function(r){ return r.f ? r.f[x.key] : null; } });
      });
      out += qlH('Every stock\\'s factor ranks today') +
        '<p class="evb-note">Rank among the covered stocks, 0 to 99, as of ' + escapeHtml(evbDate(f.asOf)) + '. Higher always means more of the trait named in the column (cheaper for value, calmer for low volatility).</p>' +
        VIEWS.tableHtml(fcols, f.names, { key: 'ql-factors', tall: true, cls: 'ql-table ql-wide', empty: 'No factor ranks yet.' });
    }
    return out;
  }

  // ---- Volatility ------------------------------------------------------------
  function qlModelRows(models, best){
    return (models || []).map(function(m){
      return '<tr' + (m.model === best ? ' class="is-current"' : '') + '><td>' + escapeHtml(QL_MODEL[m.model] || m.model) + (m.model === best ? ' <span class="crd-dim">best</span>' : '') + '</td><td class="num">' + (m.n || 0) + '</td><td class="num">' + slpNum(m.qlike, 3) + '</td><td class="num ' + slpSign(m.vsBase) + '">' + (m.model === 'trailing' ? 'baseline' : slpPts(m.vsBase) + '%') + '</td><td class="num">' + slpNum(m.rmse, 1) + '</td><td class="num">' + slpPts(m.bias, 1) + '</td><td class="num">' + (m.t == null ? '—' : slpNum(m.t, 2)) + '</td></tr>';
    }).join('');
  }
  function qlVolHtml(d){
    var v = d.vol || {};
    if (v.status !== 'ok') return qlMissing(v, 'The volatility lab');
    var s = v.summary || {}, test = v.test || {}, head = [['Model'], ['Forecasts', 1], ['Loss', 1, 'QLIKE: the standard loss for volatility forecasts; lower is better'], ['Against the baseline', 1, 'Share of the baseline loss removed'], ['Typical miss', 1, 'Root mean squared miss in volatility points'], ['Bias', 1, 'Positive means it forecast too high on average'], ['t', 1, 'Whether the gain over the baseline is likely real, counted on dates']];
    var cols = [
      { label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b>'; }, sort: function(r){ return r.s; } },
      { label: 'Option price (IV)', num: true, title: 'At-the-money 30-day implied volatility, annual', cell: function(r){ return r.iv == null ? '' : slpNum(r.iv, 1) + '%'; }, sort: function(r){ return r.iv; } },
      { label: 'Forecast', num: true, title: 'Forecast volatility over the next 21 sessions, annual, from the model in use', cell: function(r){ return r.forecast == null ? '' : slpNum(r.forecast, 1) + '%'; }, sort: function(r){ return r.forecast; } },
      { label: 'Premium', num: true, title: 'Option price minus the forecast, in volatility points', cell: function(r){ return r.premium == null ? '' : vtCbarHtml(r.premium, 20, slpPts(r.premium, 1)); }, sort: function(r){ return r.premium; } },
      { label: 'Rank', num: true, title: 'Rank of the premium among today\\'s stocks, 0 to 100', cell: function(r){ return r.rank == null ? '' : String(r.rank); }, sort: function(r){ return r.rank; } },
      { label: 'Read', cell: function(r){ return qlPill(QL_VOLREAD[r.read]); }, sort: function(r){ return r.read; } },
      { label: 'Last 21', num: true, cell: function(r){ return r.trailing == null ? '' : slpNum(r.trailing, 1) + '%'; }, sort: function(r){ return r.trailing; } },
      { label: 'EWMA', num: true, cell: function(r){ return r.ewma == null ? '' : slpNum(r.ewma, 1) + '%'; }, sort: function(r){ return r.ewma; } },
      { label: 'GARCH', num: true, cell: function(r){ return r.garch == null ? '' : slpNum(r.garch, 1) + '%'; }, sort: function(r){ return r.garch; } },
      { label: 'HAR', num: true, cell: function(r){ return r.har == null ? '' : slpNum(r.har, 1) + '%'; }, sort: function(r){ return r.har; } },
    ];
    var pt = v.premiumTest || {};
    var bands = (v.byPremium || []).map(function(b){ return '<tr><td>' + escapeHtml(b.label) + '</td><td class="num">' + (b.n || 0) + '</td><td class="num">' + qlFrac(b.win) + '</td><td class="num ' + slpSign(b.avg) + '">' + (b.avg == null ? '—' : slpPts(b.avg) + '%') + '</td></tr>'; }).join('');
    return qlStale(v) + '<p class="evb-lead">An option is a bet on how much a stock will move. This lab forecasts each stock\\'s movement over the next 21 sessions and sets it against what the options charge. A positive premium means the options price in more movement than the forecast.</p>' +
      slpKpis([['Forecast model in use', escapeHtml(QL_MODEL[v.model] || v.model)], ['Stocks', String(s.names || 0)], ['Median premium', slpPts(s.medianPremium, 1) + ' pts'], ['Rich (8+ over)', String(s.rich || 0)], ['Cheap (3+ under)', String(s.cheap || 0)]]) +
      VIEWS.tableHtml(cols, v.names || [], { key: 'ql-vol', tall: true, cls: 'ql-table ql-wide', empty: 'No forecasts yet.' }) +
      qlH('Which forecast is best') +
      (test.history ? '<p class="evb-note">History test: ' + (test.history.symbols || 0) + ' symbols, out of sample from ' + escapeHtml(String(test.history.from || '').slice(0, 4)) + ', ' + (test.history.rows || 0) + ' forecasts. The model in use is the winner of this test.</p>' + slpTable(head, qlModelRows(test.history.models, test.history.best)) : '') +
      (test.live ? '<p class="evb-note">The same test on the bars this build holds (about a year), from ' + escapeHtml(evbDate(test.live.from)) + ', ' + (test.live.rows || 0) + ' forecasts.</p>' + slpTable(head, qlModelRows(test.live.models, test.live.best)) : '') +
      qlH('Does the premium tell us anything?') +
      '<p class="evb-note">' + escapeHtml(pt.read || '') + (pt.ic != null ? ' Rank link with what the options ended up overcharging: ' + slpPts(pt.ic, 2) + ' for the forecast premium against ' + slpPts(pt.baseIc, 2) + ' for the plain gap, over ' + (pt.dates || 0) + ' dates (t ' + slpNum(pt.t, 2) + ' on the difference). Both links are high by construction because the option price sits on both sides; only the difference between them counts.' : '') + '</p>' +
      (v.tradesMatched ? '<p class="evb-note">Closed Top Picks single options by the premium on the day they opened (' + v.tradesMatched + ' matched):</p>' + slpTable([['Premium at entry'], ['Trades', 1], ['Won', 1], ['Average result', 1]], bands) : '<p class="evb-note">No closed single-option trade has a premium on its entry day yet.</p>');
  }

  // ---- Annual reports --------------------------------------------------------
  function qlFilingDetail(r){
    var out = '';
    if (r.newTerms && r.newTerms.length) out += '<p class="evb-note"><strong>Words that are new this year:</strong> ' + escapeHtml(r.newTerms.join(', ')) + '</p>';
    if (r.goneTerms && r.goneTerms.length) out += '<p class="evb-note"><strong>Words that dropped out:</strong> ' + escapeHtml(r.goneTerms.join(', ')) + '</p>';
    if (r.sample && r.sample.length) out += '<p class="evb-note"><strong>New paragraphs (opening words):</strong></p><ul class="ql-lines">' + r.sample.map(function(x){ return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
    return out;
  }
  function qlFilingsHtml(d){
    var f = d.filings || {};
    var lead = '<p class="evb-lead">Companies mostly copy last year\\'s risk section into this year\\'s annual report. When one rewrites it, something changed. This lab compares the two newest annual reports for each covered company, word for word, with no AI.</p>';
    if (!f.rows || !f.rows.length){
      return lead + '<p class="hint">Collecting: the build reads a few companies\\' reports from the SEC each time it runs' + (f.waiting != null ? ' (' + f.waiting + ' still to read)' : '') + '. The first comparisons appear after the next builds.</p>' +
        ((f.failed && f.failed.length) ? '<p class="evb-note">Could not be read: ' + escapeHtml(f.failed.map(function(x){ return x.s + (x.why ? ' (' + x.why + ')' : ''); }).join(', ')) + '.</p>' : '');
    }
    var sum = f.summary || {};
    var cols = [
      { label: '', nosort: true, cell: function(r){ return qlFilingDetail(r) ? VIEWS.expandHtml('Show what changed') : ''; } },
      { label: 'Stock', cell: function(r){ return '<b>' + escapeHtml(r.s) + '</b>'; }, sort: function(r){ return r.s; } },
      { label: 'Report', cell: function(r){ return escapeHtml(r.form || '') + ' <span class="crd-dim">' + escapeHtml(evbDate(r.filed)) + '</span>'; }, sort: function(r){ return r.filed; } },
      { label: 'Same as last year', num: true, title: 'Similarity of the risk section with the year before; 100% is a straight copy', cell: function(r){ return vtBarHtml(r.sim, '', qlFrac(r.sim)); }, sort: function(r){ return r.sim; } },
      { label: 'New paragraphs', num: true, title: 'Share of this year\\'s paragraphs with no close match last year', cell: function(r){ return qlFrac(r.addedShare) + ' <span class="crd-dim">' + (r.added || 0) + '</span>'; }, sort: function(r){ return r.addedShare; } },
      { label: 'Dropped', num: true, title: 'Paragraphs from last year with no close match this year', cell: function(r){ return String(r.removed || 0); }, sort: function(r){ return r.removed; } },
      { label: 'Length', num: true, title: 'Words in the risk section, and the change from last year', cell: function(r){ return (r.words || 0).toLocaleString('en-US') + ' <span class="' + slpSign(r.wordsChg) + '">' + (r.wordsChg == null ? '' : slpPts(r.wordsChg, 0) + '%') + '</span>'; }, sort: function(r){ return r.words; } },
      { label: 'Flag', cell: function(r){ return r.flag === 'rewritten' ? qlPill(['Rewritten', 'evb-s-unclear']) : r.flag === 'copied' ? qlPill(['Copied', 'evb-s-collect']) : ''; }, sort: function(r){ return r.flag || ''; } },
    ];
    return qlStale(f) + lead +
      slpKpis([['Reports compared', String(f.read || 0)], ['Median similarity', qlFrac(sum.medianSim)], ['Rewritten', String(sum.rewritten || 0), 'Among the least similar fifth, with a tenth or more of the paragraphs new'], ['Copied', String(sum.copied || 0), 'Almost no new paragraphs'], ['Still to read', f.waiting == null ? '—' : String(f.waiting)]]) +
      VIEWS.tableHtml(cols, f.rows, { key: 'ql-filings', tall: f.rows.length > 16, cls: 'ql-table', empty: 'No reports compared yet.', detail: qlFilingDetail }) +
      '<p class="evb-note">Whether a rewritten risk section is followed by weaker returns is a known research finding in large samples; it is not proven here. With 85 companies and one report a year each, this is a reading aid, not a signal.</p>';
  }

  // ---- Registry --------------------------------------------------------------
  function qlRegistryHtml(d){
    var r = d.registry || {};
    if (!r.rows) return qlMissing(r, 'The research registry');
    var cols = [
      { label: 'Book', cls: 'ql-labelcell', cell: function(x){ return '<b>' + escapeHtml(x.label) + '</b>' + (x.read ? '<div class="ql-readline">' + escapeHtml(x.read) + '</div>' : ''); }, sort: function(x){ return x.label; } },
      { label: 'Closed', num: true, cell: function(x){ return String(x.n || 0); }, sort: function(x){ return x.n || 0; } },
      { label: 'Average', num: true, title: 'Average result per trade, percent of the premium', cell: function(x){ return x.mean == null ? '' : '<span class="' + slpSign(x.mean) + '">' + slpPts(x.mean) + '%</span>'; }, sort: function(x){ return x.mean; } },
      { label: 't', num: true, title: 'How far the average sits from zero, in standard errors', cell: function(x){ return x.t == null ? '' : slpNum(x.t, 2); }, sort: function(x){ return x.t; } },
      { label: 'Things tried', num: true, title: 'Rule sets or variants tried to get this result', cell: function(x){ return String(x.trials || 1); }, sort: function(x){ return x.trials || 1; } },
      { label: 't needed', num: true, title: 'The t value a result needs once that many attempts are allowed for', cell: function(x){ return x.tNeeded == null ? '' : slpNum(x.tNeeded, 2); }, sort: function(x){ return x.tNeeded; } },
      { label: 'Chance it is real', num: true, title: 'Deflated Sharpe ratio: the chance the true average beats what the luckiest of that many attempts would show', cell: function(x){ return x.chanceReal == null ? '' : qlFrac(x.chanceReal); }, sort: function(x){ return x.chanceReal; } },
      { label: 'Worst run', num: true, title: 'Largest peak-to-trough fall of the running sum of per-trade results, in points of one trade\\'s premium (100 points = one premium lost)', cell: function(x){ return x.worstRun == null ? '' : slpNum(x.worstRun, 0) + ' pts'; }, sort: function(x){ return x.worstRun; } },
      { label: 'Verdict', cell: function(x){ return qlPill(QL_REG[x.verdict]); }, sort: function(x){ return x.verdict; } },
    ];
    var trials = (r.trials || []).map(function(x){ return '<tr><td>' + escapeHtml(x.family) + '</td><td class="num">' + x.trials + '</td><td>' + escapeHtml(x.what || '') + '</td></tr>'; }).join('');
    var research = (r.research || []).map(function(x){ return '<tr><td>' + escapeHtml(x.label) + '</td><td class="num">' + (x.trials || 1) + '</td><td>' + escapeHtml(x.result || '') + '</td><td>' + qlPill(QL_RES[x.verdict]) + '</td><td>' + escapeHtml(evbDate(x.ran)) + '</td></tr>'; }).join('');
    return qlStale(r) + '<p class="evb-lead">Try enough rules and one will look good by luck. The registry keeps the number of things tried beside every result and asks whether the result would still stand after allowing for them. A book holds up only when the chance it is real is 95% or more and its t value clears the bar.</p>' +
      VIEWS.tableHtml(cols, r.rows, { key: 'ql-registry', tall: false, cls: 'ql-table', empty: 'No books with closed trades yet.' }) +
      qlH('What was tried') + slpTable([['Family'], ['Count', 1], ['What it counts']], trials) +
      (research ? qlH('History tests on file') + slpTable([['Test'], ['Things tried', 1], ['Result'], ['Verdict'], ['Ran']], research) : '');
  }

  // ---- Page ------------------------------------------------------------------
  function qlTabNow(){
    var tab = VIEWS.get('quant-labs.tab', 'summary');
    for (var i = 0; i < QL_TABS.length; i++) if (QL_TABS[i][0] === tab) return tab;
    return 'summary';
  }
  function renderQuantLabs(){
    var root = $('quant-labs-root'); if (!root) return;
    var d = qlState.data;
    if (!d){ root.innerHTML = '<p class="hint">' + (qlState.error ? 'The labs could not be loaded (' + escapeHtml(qlState.error) + '). Every full build writes them; the first one after this deploys creates the file.' : 'Loading…') + '</p>'; return; }
    var tab = qlTabNow();
    var body = tab === 'odds' ? qlOddsHtml(d) : tab === 'calibration' ? qlCalibrationHtml(d) : tab === 'factors' ? qlFactorsHtml(d) : tab === 'vol' ? qlVolHtml(d) : tab === 'filings' ? qlFilingsHtml(d) : tab === 'registry' ? qlRegistryHtml(d) : qlSummaryHtml(d);
    root.innerHTML = vnTabsHtml(QL_TABS, tab, 'data-ql-tab') + '<div class="ql-body slp-section">' + body + '</div>' +
      '<p class="evb-note">Measurement only: nothing on this page changes a pick, a grade or the Track Record. Built ' + escapeHtml(rglEt(d.builtAt)) + (d.research && d.research.ran ? '; history tests ran ' + escapeHtml(evbDate(d.research.ran)) : '') + '.</p>';
    if (typeof vnTabsReveal === 'function') vnTabsReveal(root);
  }
  // One read of the Owner file, shared by the Quant labs page and the cards.
  function qlFetch(force){
    if (!HAS_OWNER_ACCESS) return Promise.resolve(null);
    if (!force && qlState.data && Date.now() - qlState.fetchedAt < 15 * 60 * 1000) return Promise.resolve(qlState.data);
    if (qlState.pending) return qlState.pending;
    qlState.error = null;
    qlState.pending = quantFetchJson(dataUrl('quant-labs.json')).then(function(row){
      qlState.data = row && typeof row === 'object' ? row : null; qlState.fetchedAt = Date.now(); qlState.pending = null;
      return qlState.data;
    }, function(err){
      qlState.pending = null; qlState.error = err && err.status === 404 ? 'not written yet' : String(err && err.message || err);
      return null;
    });
    return qlState.pending;
  }
  function loadQuantLabs(force){
    var status = $('owner-labs-status');
    if (status && !qlState.data) status.textContent = 'Loading the labs…';
    renderQuantLabs();
    qlFetch(force).then(function(d){
      if (status) status.textContent = d ? 'Written by the ' + rglEt(d.builtAt) + ' build.' : (qlState.error === 'not written yet' ? 'No labs file yet. The next full build writes it.' : 'The labs are not available right now.');
      renderQuantLabs();
    });
  }
  document.addEventListener('click', function(ev){
    if (ev.target && ev.target.closest && ev.target.closest('[data-owner-labs-refresh]')){ loadQuantLabs(true); return; }
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-ql-tab]') : null;
    if (!t) return;
    VIEWS.set('quant-labs.tab', t.getAttribute('data-ql-tab'));
    renderQuantLabs();
    var root = $('quant-labs-root');
    if (root && t.classList.contains('ql-linkbtn') && root.scrollIntoView) root.scrollIntoView({ block: 'start' });
  });

  // ---- "Market odds" card on the Bottom tracker and Risk analysis -------------
  // Context only: it votes on nothing and changes no verdict on either page.
  // Completed sessions since the card's close: today counts once it is past
  // 16:00 ET, so a Friday read on a Saturday is current and a Thursday read
  // on Friday evening is one session behind.
  function qlSessionsBehind(asOf){
    if (!asOf || !/^\\d{4}-\\d{2}-\\d{2}/.test(String(asOf))) return null;
    var gap = marketSessionGap(String(asOf).slice(0, 10) + 'T21:00:00Z');
    if (gap == null) return null;
    var et = etNowParts();
    if (gap > 0 && et && et.hour < 16 && isMarketSessionDay(new Date(et.dateKey + 'T12:00:00Z'))) gap--;
    return gap;
  }
  function qlCardHtml(d){
    var c = d && d.card;
    if (!c || !c.fall || !c.fall.length) return '';
    var by = {}; c.fall.forEach(function(t){ by[t.id] = t; });
    var head = by.fall10_6m;
    if (!head) return '';
    // A chance whose model has not shown skill on held-out history is marked, not hidden.
    var chip = function(t, label){ return t ? '<span class="ql-chip' + (t.status !== 'working' ? ' ql-chip-weak" title="No proven skill on held-out history; a rough guide only' : '') + '"><span>' + label + '</span><b>' + qlFrac(t.p) + '</b><small>normal ' + qlFrac(t.base) + (t.status !== 'working' ? ' · rough' : '') + '</small></span>' : ''; };
    var rec = (c.recovery || []).map(function(t){ return chip(t, escapeHtml(t.label)); }).join('');
    var weak = head.status !== 'working';
    var behind = qlSessionsBehind(c.asOf);
    var asOfTag = c.asOf ? ' · ' + escapeHtml(evbDate(c.asOf)) + ' close' : '';
    var behindNote = behind > 0 ? '<p class="ql-card-note"><span class="ql-warn-inline">' + behind + ' session' + (behind === 1 ? '' : 's') + ' behind: the market has closed since this read, so these chances do not include the latest moves.</span></p>' : '';
    return '<div class="ql-card"><span class="ql-kicker">Context, not a vote · Market odds' + asOfTag + '</span>' + behindNote +
      '<p class="ql-card-lead">' + qlHeadline(head) + (weak ? ' <span class="ql-warn-inline">This model has not shown skill on held-out history; treat it as a rough guide.</span>' : '') + '</p>' +
      '<div class="ql-chips">' + chip(by.fall10_3m, 'Within 3 months') + chip(by.fall10_12m, 'Within 12 months') + chip(by.fall20_12m, '20%+ within 12 months') + '</div>' +
      (rec ? '<div class="ql-chips"><span class="ql-chips-lbl">Inside this decline</span>' + rec + '</div>' : '') +
      '<p class="ql-card-note">From S&amp;P 500 history since ' + escapeHtml(String(c.from || '1962').slice(0, 4)) + ': rates, credit spreads, the trend and how far the index sits from its high, through the ' + escapeHtml(evbDate(c.asOf)) + ' close (' + slpNum(c.offHigh, 1) + '% under the high). "Normal" is how often it happened across that history.' + (c.stale ? ' Last good copy; the newest build could not refit it.' : '') + '</p>' +
      '<a class="book-more" href="?tab=quant-labs">Open Quant labs</a></div>';
  }
  function loadMarketOddsCards(){
    var hosts = [$('risk-odds'), $('bottom-odds')].filter(function(h){ return !!h; });
    if (!hosts.length || !HAS_OWNER_ACCESS) return;
    qlFetch().then(function(d){
      var html = qlCardHtml(d);
      hosts.forEach(function(h){ h.hidden = !html; h.innerHTML = html; });
    });
  }
`;
}
