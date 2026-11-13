// The stock page's Leadership tab: the company's board and executives, what
// each owns and what share of the votes it carries, who controls the company,
// and seven ways to look at it (people, org chart, connections web, votes and
// stakes, tenure timeline, table, changes). Data: the `corporate` block of the
// public per-ticker file (lib/corporate-structure/assemble.mjs).
//
// The returned string is pasted inside the app.js IIFE (ES5, no imports).
// Keep it free of backslashes and template-literal placeholders.

export function renderLeadershipJs() {
  return `
  var LEADERSHIP = (function(){
    var VIEW_KEY = 'stonks-lead-view-v1';
    var VIEWS_LIST = [['people', 'People'], ['org', 'Org chart'], ['web', 'Connections'], ['votes', 'Votes & stakes'], ['tenure', 'Tenure'], ['table', 'Table'], ['changes', 'Changes']];
    var st = { view: 'people', sel: null, data: null, sym: null };
    try { var sv = localStorage.getItem(VIEW_KEY); if (sv) st.view = sv; } catch (_) {}
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fin(v){ return v != null && isFinite(v); }
    function n0(v){ return fin(v) ? Math.round(v).toLocaleString() : '—'; }
    function pct(v, d){ if (!fin(v)) return '—'; if (v === 0) return '0%'; if (v > 0 && v < 0.01) return '<0.01%'; return Number(v).toFixed(d == null ? (v >= 10 ? 1 : 2) : d) + '%'; }
    function usd(v){
      if (!fin(v)) return '—';
      var a = Math.abs(v);
      if (a >= 1e12) return '$' + (a / 1e12).toFixed(2) + 'T';
      if (a >= 1e9) return '$' + (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'B';
      if (a >= 1e6) return '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
      if (a >= 1e3) return '$' + (a / 1e3).toFixed(0) + 'K';
      return '$' + Math.round(a);
    }
    function sh(v){
      if (!fin(v)) return '—';
      var a = Math.abs(v);
      if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
      if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K';
      return Math.round(v).toLocaleString();
    }
    function day(iso){
      if (!iso) return '—';
      var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
      return isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : esc(iso);
    }
    function yr(iso){ return iso ? Number(String(iso).slice(0, 4)) : null; }
    function nowYear(){ return new Date().getUTCFullYear(); }
    function startYear(p){
      var c = [p.boardSince, p.joined, p.roleSince, yr(p.insiderSince)].filter(function(x){ return fin(x) && x > 1900; });
      return c.length ? Math.min.apply(null, c) : null;
    }
    // A start year, or the year of the first filing found (a lower bound).
    function startInfo(p){
      var y = startYear(p);
      if (y) return { y: y, approx: false };
      var s = yr(p.seenSince);
      return fin(s) && s > 1900 ? { y: s, approx: true } : null;
    }
    function yearsText(p){
      var si = startInfo(p);
      if (!si) return '—';
      var n = nowYear() - si.y;
      if (si.approx && n < 1) return '—';
      return (si.approx ? '≥' : '') + (n < 1 ? '<1' : n);
    }
    // What the years count from, in the card's label: the earliest dated
    // start decides ("On board" 15, "At company" 31, "Insider" <1).
    function yearsLabel(p){
      var si = startInfo(p);
      if (!si) return 'Years';
      if (si.approx) return 'Filing';
      if (fin(p.joined) && p.joined === si.y) return 'At company';
      if (fin(p.boardSince) && p.boardSince === si.y) return 'On board';
      if (fin(p.roleSince) && p.roleSince === si.y) return 'In role';
      return 'Insider';
    }
    function yrsUnit(p){ var t = yearsText(p); return t === '<1' || t === '1' || t === '≥1' ? 'yr' : 'yrs'; }
    // "on board 15 yrs", "insider <1 yr": the count and what it counts from.
    function yearsPhrase(p){
      var t = yearsText(p);
      return t === '—' ? '' : yearsLabel(p).toLowerCase() + ' ' + t + ' ' + yrsUnit(p);
    }
    function yearsTip(p){
      var l = yearsLabel(p), si = startInfo(p);
      if (!si) return '';
      return l === 'At company' ? 'Joined the company in ' + si.y + ' (proxy statement)' : l === 'On board' ? 'On the board since ' + si.y + ' (proxy statement)' : l === 'In role' ? 'In the current role since ' + si.y + ' (proxy statement)' : l === 'Insider' ? 'Became a company insider (Form 3) in ' + si.y + '; time at the company before that is not in the filings' : 'Earliest insider filing found: ' + si.y + ' (at least this long)';
    }
    function coKey(name){
      return String(name || '').toLowerCase().replace(/ *[/][a-z]{2,3}[/]? *$/, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
        .replace(/ (the|inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|holdings?|group|sa|nv|ag|se|llc|lp|platforms|technologies|technology)(?= |$)/g, ' ')
        .replace(/^the /, '').replace(/ +/g, ' ').trim().replace(/( and)+$/, '');
    }
    function coName(name){ return String(name || '').replace(/ *[/][A-Za-z]{2,3}[/]? *$/, ''); }
    // "Emerson Electric Co" -> "Emerson Electric"; long names end in "…".
    function shortCo(name, max){
      var t = String(name || '').replace(/ +/g, ' ').replace(/ *[/][A-Za-z]{2,3}[/]? *$/, '').replace(/,? +(& co[.]?|and company|inc[.]?|incorporated|corp[.]?|corporation|co[.]?|company|ltd[.]?|limited|plc|n[.]?v[.]?|s[.]?a[.]?|ag|se|holdings?|l[.]?p[.]?|llc)$/i, '').replace(/[,. ]+$/, '').trim() || String(name || '');
      max = max || 20;
      return t.length > max ? t.slice(0, max - 1).replace(/ +[^ ]*$/, '') + '…' : t;
    }
    // Other companies a person is at now: their own insider filings there,
    // then the proxy's list of their other public boards.
    function otherNow(p){
      var out = [], seen = {};
      (p.other || []).forEach(function(o){
        if (!o.active) return;
        var k = o.covered || coKey(o.name);
        if (seen[k]) return; seen[k] = 1;
        out.push({ key: o.cik || k, name: o.name, ticker: o.ticker, covered: o.covered, role: o.role, via: 'filings' });
      });
      (p.otherBoards || []).forEach(function(b){
        if (!b.current) return;
        var k = b.covered || coKey(b.company);
        if (seen[k]) return; seen[k] = 1;
        out.push({ key: k, name: b.company, ticker: b.covered || null, covered: b.covered || null, role: 'Director', via: 'proxy' });
      });
      return out;
    }
    function initials(name){
      var t = String(name || '').replace(/[^A-Za-z ]/g, ' ').split(' ').filter(Boolean);
      return ((t[0] || '?').charAt(0) + (t.length > 1 ? t[t.length - 1].charAt(0) : '')).toUpperCase();
    }
    function roleText(p){
      if (p.title) return p.title;
      if (p.chair) return 'Chair of the board';
      if (p.director) return p.leadIndependent ? 'Lead independent director' : 'Director';
      if (p.tenPct) return '10% owner';
      return 'Insider';
    }
    function kind(p){ return p.officer ? 'exec' : p.director ? (p.independent === true ? 'indep' : p.independent === false ? 'affil' : 'dir') : 'holder'; }
    function byId(id){ var d = st.data; if (!d) return null; for (var i = 0; i < d.people.length; i++) if (d.people[i].id === id) return d.people[i]; return null; }
    function badges(p){
      var b = [];
      if (p.ceo) b.push(['CEO', 'is-accent']);
      if (p.chair) b.push([p.officer ? 'Chair' : 'Chair', 'is-accent']);
      if (p.leadIndependent) b.push(['Lead independent', 'is-info']);
      if (p.director && p.independent === true) b.push(['Independent', 'is-info']);
      if (p.director && p.independent === false) b.push(['Not independent', 'is-violet']);
      if (p.director && !p.chair && !p.leadIndependent && p.officer) b.push(['Director', '']);
      if (p.tenPct) b.push(['10%+ owner', 'is-warn']);
      return b.map(function(x){ return '<span class="ld-badge ' + x[1] + '">' + esc(x[0]) + '</span>'; }).join('');
    }
    // plain: inside a card button, where a link cannot nest.
    function otherChips(p, max, plain){
      var list = otherNow(p);
      var html = list.slice(0, max || 4).map(function(o){
        var label = o.ticker || o.name;
        var inner = esc(label) + (o.role ? ' <small>' + esc(shortRole(o.role)) + '</small>' : '');
        if (plain) return '<span class="ld-chip' + (o.covered ? ' is-covered' : '') + '" title="' + esc(o.name) + '">' + inner + '</span>';
        return o.covered ? '<a class="ld-chip is-covered" href="?tab=stock&s=' + encodeURIComponent(o.covered) + '" data-stock-sym="' + esc(o.covered) + '" title="' + esc(o.name) + '">' + inner + '</a>' : '<span class="ld-chip" title="' + esc(o.name) + '">' + inner + '</span>';
      }).join('');
      if (list.length > (max || 4)) html += '<span class="ld-chip is-more">+' + (list.length - (max || 4)) + '</span>';
      return html;
    }
    // A role that fits a small box: common words shortened, cut at a word
    // with "…" (the full title is on the card and in the detail).
    function shortRole(r, max){
      var t = String(r || '').replace(/Executive Vice President/gi, 'EVP').replace(/Senior Vice President/gi, 'SVP').replace(/Vice President/gi, 'VP')
        .replace(/Chief Executive Officer/gi, 'CEO').replace(/Chief Financial Officer/gi, 'CFO').replace(/Chief Operating Officer/gi, 'COO')
        .replace(/Chief Technology Officer/gi, 'CTO').replace(/Chief Legal Officer/gi, 'CLO').replace(/Chief Accounting Officer/gi, 'CAO')
        .replace(/Chief Information Officer/gi, 'CIO').replace(/Principal Accounting Officer/gi, 'PAO').replace(/General Counsel/gi, 'GC')
        .replace(/Research (&|and) Development/gi, 'R&D').replace(/ *[/] */g, '/').replace(/ +/g, ' ').trim();
      max = max || 40;
      if (t.length <= max) return t;
      t = t.slice(0, max - 1);
      var cut = Math.max(t.lastIndexOf(' '), t.lastIndexOf(','), t.lastIndexOf(';'), t.lastIndexOf('/'));
      return (cut > max / 2 ? t.slice(0, cut) : t).replace(/[ ,;/&]+$/, '') + '…';
    }
    function tenureLine(p){
      var parts = [];
      if (fin(p.boardSince)) parts.push('On the board since ' + p.boardSince + ' (' + (nowYear() - p.boardSince) + ' yr' + (nowYear() - p.boardSince === 1 ? '' : 's') + ')');
      if (fin(p.joined)) parts.push('Joined in ' + p.joined);
      if (fin(p.roleSince)) parts.push('In this role since ' + p.roleSince);
      if (!parts.length && p.insiderSince) parts.push('Became an insider ' + day(p.insiderSince) + ' (first Form 3)');
      if (!parts.length && p.seenSince) parts.push('Filing as an insider since at least ' + day(p.seenSince));
      return parts.join(' · ');
    }
    // --- header: who controls it, board make-up --------------------------------
    function headerHtml(d){
      var b = d.board || {}, c = d.control || {};
      var ceo = b.ceo ? byId(b.ceo) : null, chair = b.chair ? byId(b.chair) : null;
      var coCeos = d.people.filter(function(p){ return p.ceo; });
      var tone = c.level === 'controlled' ? 'is-neg' : c.level === 'insiders' ? 'is-warn' : c.level === 'sway' ? 'is-warn' : 'is-pos';
      var label = { controlled: 'Controlled', insiders: 'Insider majority', sway: 'One big voice', spread: 'Widely held', unknown: 'Not yet known' }[c.level] || '—';
      var kpis = [
        [coCeos.length > 1 ? 'Co-chief executives' : 'Chief executive', coCeos.length > 1 ? coCeos.map(personLink).join(' and ') : ceo ? personLink(ceo) : '—'],
        ['Chair', chair ? (b.ceoIsChair ? 'Same person as CEO' : personLink(chair)) : '—'],
        ['Board', b.size ? b.size + ' directors' + (fin(b.independent) ? ' · ' + b.independent + ' independent' : '') : '—'],
        ['Average board tenure', fin(b.avgTenure) ? b.avgTenure + ' years' : '—'],
        ['Insiders hold', fin(c.insidersVotingPct) ? pct(c.insidersVotingPct) + ' of votes' : '—']
      ];
      return '<section class="ld-control ' + tone + '">' +
        '<div class="ld-control-main"><span class="ld-pill ' + tone + '">' + esc(label) + '</span>' +
          '<p class="ld-control-line">' + esc(c.summary || '') + '</p>' +
          (c.gap ? '<p class="ld-control-sub">' + esc(c.gap) + '</p>' : '') +
          (c.votesNote ? '<p class="ld-control-sub">Share classes: ' + esc(c.votesNote) + '</p>' : '') +
          (c.controlledCompany ? '<p class="ld-control-sub">The company calls itself a <b>controlled company</b> under its exchange rules, so some board independence rules do not apply.</p>' : '') +
          (c.filingNote ? '<p class="ld-control-quote">From the filing: “' + esc(c.filingNote) + '”</p>' : '') +
          lateHtml(d) +
        '</div>' +
        '<dl class="ld-kpis">' + kpis.map(function(k){ return '<div><dt>' + esc(k[0]) + '</dt><dd>' + k[1] + '</dd></div>'; }).join('') + '</dl>' +
      '</section>';
    }
    function lateHtml(d){
      var s = d.source || {}, h = '';
      if (s.lateChanges) h += '<p class="ld-control-warn">' + 'The company filed ' + (s.lateChanges.count === 1 ? 'a leadership change notice' : s.lateChanges.count + ' leadership change notices') + ' (Form 8-K) after its proxy statement (newest ' + day(s.lateChanges.latest) + ', <a href="' + esc(s.lateChanges.url) + '" target="_blank" rel="noopener">read it</a>). Roles below follow newer insider filings where there are any; other titles may be out of date until the next proxy.</p>';
      (s.notes || []).forEach(function(n){ h += '<p class="ld-control-sub">' + esc(String(n).replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g, function(m){ return day(m); })) + '</p>'; });
      return h;
    }
    // Stake for a card or table cell: the value, else the share count, else
    // "None" when the filings report no shares.
    function stakeText(p, withSh){
      if (fin(p.value)) return usd(p.value);
      if (p.holdings) return sh(p.holdings.total) + (withSh ? ' sh' : '');
      return p.noShares ? 'None' : withSh ? '—' : '';
    }
    function indepText(p){
      if (!p.director) return '';
      if (p.independent === true) return 'Yes';
      if (p.independent === false) return 'No';
      return p.newSinceProxy ? 'Not stated yet' : '—';
    }
    function personLink(p){ return '<button type="button" class="ld-plink" data-ld-person="' + esc(p.id) + '">' + esc(p.name) + '</button>'; }
    // --- 1. people cards -------------------------------------------------------
    function cardHtml(p){
      return '<button type="button" class="ld-card k-' + kind(p) + (st.sel === p.id ? ' is-sel' : '') + '" data-ld-person="' + esc(p.id) + '">' +
        '<span class="ld-avatar" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
        '<span class="ld-card-main"><b class="ld-card-name">' + esc(p.name) + '</b><span class="ld-card-role">' + esc(roleText(p)) + '</span>' +
          '<span class="ld-badges">' + badges(p) + '</span>' +
          '<span class="ld-card-stats">' +
            '<span' + (p.noShares && !p.holdings ? ' title="Their SEC filings so far report no shares"' : '') + '><small>Stake</small>' + stakeText(p, true) + '</span>' +
            '<span><small>Votes</small>' + pct(p.proxy && fin(p.proxy.votingPercent) ? p.proxy.votingPercent : p.pctVoting) + '</span>' +
            (st.noYears ? '' : '<span title="' + esc(yearsTip(p)) + '"><small>' + esc(yearsLabel(p)) + '</small>' + yearsText(p) + (yearsText(p) === '—' ? '' : ' <i class="ld-yrs">' + yrsUnit(p) + '</i>') + '</span>') +
          '</span>' +
          (otherChips(p, 3, true) ? '<span class="ld-chips">' + otherChips(p, 3, true) + '</span>' : '') +
        '</span></button>';
    }
    function peopleHtml(d){
      // No start year for anyone (a 20-F gives none): leave the column out.
      st.noYears = !d.people.some(function(p){ return yearsText(p) !== '—'; });
      var ex = d.people.filter(function(p){ return p.officer; });
      var dir = d.people.filter(function(p){ return p.director && !p.officer; });
      var own = d.people.filter(function(p){ return !p.officer && !p.director; });
      var h = '';
      if (ex.length) h += '<section class="ld-group"><h4 class="ld-h4">Executives <small>' + ex.length + '</small></h4><div class="ld-cards">' + ex.map(cardHtml).join('') + '</div></section>';
      if (dir.length) h += '<section class="ld-group"><h4 class="ld-h4">Board of directors <small>' + (d.board.size || dir.length) + ' incl. executives on the board</small></h4><div class="ld-cards">' + dir.map(cardHtml).join('') + '</div></section>';
      if (own.length) h += '<section class="ld-group"><h4 class="ld-h4">Other insiders <small>' + own.length + '</small></h4><div class="ld-cards">' + own.map(cardHtml).join('') + '</div></section>';
      h += holdersHtml(d);
      return h || '<p class="stp-empty">No people found in the filings read so far.</p>';
    }
    function holdersHtml(d){
      if (!d.holders || !d.holders.length) return '';
      return '<section class="ld-group"><h4 class="ld-h4">Largest outside holders <small>from the proxy ownership table and 10% owner filings</small></h4><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Holder</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Of its class</th><th scope="col" class="num">Of all votes</th><th scope="col" class="num">Value</th></tr></thead><tbody>' +
        d.holders.map(function(h){
          var shares = h.shares || (h.holdings || []).reduce(function(s, x){ return s + (x.shares || 0); }, 0);
          var tag = h.source === 'filings' ? ' <small class="stp-dim">10% owner, Form 4</small>' : h.alsoFiles ? ' <small class="stp-dim">also files as a 10% owner</small>' : '';
          var who = h.filers && h.filers.length > 1 ? '<br><small class="stp-dim">Files with ' + esc(h.filers.filter(function(n){ return n !== h.name; }).slice(0, 3).join(', ')) + '</small>' : '';
          return '<tr><td>' + esc(h.name) + tag + who + '</td><td class="num">' + (shares ? sh(shares) : '—') + '</td><td class="num">' + pct(h.pctOfClass) + '</td><td class="num">' + pct(h.pctVoting) + '</td><td class="num">' + usd(h.value) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    // --- 2. org chart -----------------------------------------------------------
    function nodeHtml(p, cls){
      return '<button type="button" class="ld-node k-' + kind(p) + (cls ? ' ' + cls : '') + (st.sel === p.id ? ' is-sel' : '') + '" data-ld-person="' + esc(p.id) + '">' +
        '<b>' + esc(p.name) + '</b><span>' + esc(shortRole(roleText(p))) + '</span>' +
        '<small>' + [fin(p.pctVoting) && p.pctVoting >= 0.01 ? pct(p.pctVoting) + ' votes' : '', startInfo(p) && yearsText(p) !== '—' ? yearsText(p) + ' ' + yrsUnit(p) : ''].filter(Boolean).join(' · ') + '</small></button>';
    }
    function orgHtml(d){
      var dirs = d.people.filter(function(p){ return p.director; });
      dirs.sort(function(a, b){ return (b.chair - a.chair) || (b.leadIndependent - a.leadIndependent) || ((a.boardSince || 9999) - (b.boardSince || 9999)); });
      var ceos = d.people.filter(function(p){ return p.ceo; });
      var execs = d.people.filter(function(p){ return p.officer && !p.ceo; });
      var comm = (d.board.committees || []);
      var h = '<div class="ld-org">';
      h += '<div class="ld-org-tier ld-org-board"><div class="ld-org-label">Shareholders elect the board' + (d.control && d.control.level === 'controlled' ? ' (one holder controls that vote)' : '') + '</div>' +
        '<div class="ld-org-title">Board of directors <small>' + dirs.length + ' members' + (fin(d.board.independent) ? ' · ' + d.board.independent + ' independent' : '') + '</small></div>' +
        '<div class="ld-org-row">' + dirs.map(function(p){ return nodeHtml(p, p.chair ? 'is-chair' : ''); }).join('') + '</div>';
      if (comm.length){
        h += '<div class="ld-org-comms">' + comm.map(function(c){
          var chair = c.chair ? byId(c.chair) : null;
          return '<div class="ld-comm"><b>' + esc(c.name) + '</b><span>' + c.members.map(function(id){ var p = byId(id); return p ? '<button type="button" class="ld-plink' + (c.chair === id ? ' is-chair' : '') + '" data-ld-person="' + esc(id) + '">' + esc(p.name) + '</button>' : ''; }).join(', ') + '</span>' + (chair ? '<small>Chair: ' + esc(chair.name) + '</small>' : '') + '</div>';
        }).join('') + '</div>';
      }
      h += '</div>';
      if (ceos.length){
        h += '<div class="ld-org-link" aria-hidden="true"></div><div class="ld-org-tier ld-org-top"><div class="ld-org-label">The board appoints and oversees the ' + (ceos.length > 1 ? 'co-CEOs' : 'CEO') + '</div>' +
          (ceos.length > 1 ? '<div class="ld-org-row">' + ceos.map(function(p){ return nodeHtml(p, 'is-ceo'); }).join('') + '</div>' : nodeHtml(ceos[0], 'is-ceo')) + '</div>';
      }
      if (execs.length){
        h += '<div class="ld-org-link" aria-hidden="true"></div><div class="ld-org-tier ld-org-execs"><div class="ld-org-label">Executive officers</div><div class="ld-org-row">' + execs.map(function(p){ return nodeHtml(p); }).join('') + '</div></div>';
      }
      h += '</div><p class="stp-src">Filings name each officer and director but do not publish who reports to whom, so every officer is drawn under the ' + (ceos.length > 1 ? 'co-CEOs' : 'CEO') + '.</p>';
      return h;
    }
    // --- 3. connections web --------------------------------------------------------
    function webHtml(d, sym){
      var people = d.people.filter(function(p){ return !p.entity; }).slice(0, 28);
      var comps = {}, order = [];
      people.forEach(function(p, i){
        otherNow(p).forEach(function(o){
          var k = o.covered || coKey(o.name);
          if (!comps[k]){ comps[k] = { key: k, name: o.name, ticker: o.ticker, covered: o.covered, people: [] }; order.push(k); }
          if (!comps[k].people.some(function(q){ return q.i === i; })) comps[k].people.push({ i: i, role: o.role });
        });
      });
      if (!order.length) return '<p class="stp-empty">No current director or officer is listed at another public company, in the proxy statement or in their own insider filings.</p>';
      // The view box is wider than the rings so long company names on the
      // left and right are never cut off.
      var W = 1000, PAD = 200, cx = 500, cy = 500, R1 = 215, R2 = 405;
      var n = people.length;
      // Many people: alternate two rings so neighbours' names do not touch.
      var pos = people.map(function(p, i){ var a = -Math.PI / 2 + (i / n) * Math.PI * 2; var r = n > 16 ? (i % 2 ? R1 + 38 : R1 - 22) : R1; return { a: a, r: r, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; });
      var list = order.map(function(k){ var c = comps[k]; var sx = 0, sy = 0; c.people.forEach(function(q){ sx += Math.cos(pos[q.i].a); sy += Math.sin(pos[q.i].a); }); c.ang = Math.atan2(sy, sx); return c; });
      list.sort(function(a, b){ return a.ang - b.ang; });
      list = list.slice(0, 44);
      var m = list.length;
      // Spread the outer ring evenly, starting near the first company's own angle.
      var a0 = list.length ? list[0].ang : 0;
      list.forEach(function(c, j){ var a = a0 + (j / m) * Math.PI * 2; c.x = cx + R2 * Math.cos(a); c.y = cy + R2 * Math.sin(a); c.a = a; });
      var s = '<svg class="ld-web" viewBox="' + (-PAD) + ' 0 ' + (W + PAD * 2) + ' ' + W + '" role="img" aria-label="' + esc(d.name + ': people and the other public companies they are insiders at') + '">';
      people.forEach(function(p, i){ s += '<line class="ld-w-spoke" x1="' + cx + '" y1="' + cy + '" x2="' + pos[i].x.toFixed(1) + '" y2="' + pos[i].y.toFixed(1) + '"/>'; });
      list.forEach(function(c){ c.people.forEach(function(q){ s += '<line class="ld-w-edge' + (c.covered ? ' is-covered' : '') + '" x1="' + pos[q.i].x.toFixed(1) + '" y1="' + pos[q.i].y.toFixed(1) + '" x2="' + c.x.toFixed(1) + '" y2="' + c.y.toFixed(1) + '"><title>' + esc(people[q.i].name + ' at ' + c.name + (q.role ? ' (' + q.role + ')' : '')) + '</title></line>'; }); });
      s += '<circle class="ld-w-center" cx="' + cx + '" cy="' + cy + '" r="74"/><text class="ld-w-center-t" x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle">' + esc(sym) + '</text><text class="ld-w-center-s" x="' + cx + '" y="' + (cy + 24) + '" text-anchor="middle">' + esc(String(d.name).slice(0, 22)) + '</text>';
      list.forEach(function(c){
        var right = Math.cos(c.a) >= 0;
        var lx = c.x + (right ? 16 : -16), ly = c.y + 5;
        var short = shortCo(c.name, 22);
        var label = c.covered || (c.ticker && /…$/.test(short) ? c.ticker : short);
        var g = '<circle class="ld-w-co' + (c.covered ? ' is-covered' : '') + '" cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="' + (8 + Math.min(6, c.people.length * 2)) + '"/>' +
          '<text class="ld-w-co-t" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + (right ? 'start' : 'end') + '">' + esc(label) + '</text><title>' + esc(c.name + ': ' + c.people.map(function(q){ return people[q.i].name; }).join(', ')) + '</title>';
        s += c.covered ? '<a href="?tab=stock&s=' + encodeURIComponent(c.covered) + '" data-stock-sym="' + esc(c.covered) + '" class="ld-w-link">' + g + '</a>' : '<g>' + g + '</g>';
      });
      // Names sit just outside each person's dot, on the side facing away
      // from the centre (above at the top, below at the bottom).
      people.forEach(function(p, i){
        var c = Math.cos(pos[i].a), sn = Math.sin(pos[i].a), anchor, lx, ly;
        if (c > 0.42){ anchor = 'start'; lx = pos[i].x + 21; ly = pos[i].y + 6; }
        else if (c < -0.42){ anchor = 'end'; lx = pos[i].x - 21; ly = pos[i].y + 6; }
        else { anchor = 'middle'; lx = pos[i].x; ly = sn < 0 ? pos[i].y - 23 : pos[i].y + 36; }
        var last = String(p.name).split(' ').filter(Boolean).pop();
        s += '<g class="ld-w-p k-' + kind(p) + (st.sel === p.id ? ' is-sel' : '') + '" data-ld-person="' + esc(p.id) + '" tabindex="0" role="button" aria-label="' + esc(p.name) + '"><circle cx="' + pos[i].x.toFixed(1) + '" cy="' + pos[i].y.toFixed(1) + '" r="15"/><text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(last) + '</text><title>' + esc(p.name + ' · ' + roleText(p)) + '</title></g>';
      });
      s += '</svg>';
      var legend = '<div class="ld-legend"><span><i class="k-exec"></i>Executive</span><span><i class="k-indep"></i>Independent director</span><span><i class="k-affil"></i>Non-independent director</span><span><i class="is-covered"></i>Another company this site covers (tap to open)</span></div>';
      var rows = list.slice().sort(function(a, b){ return b.people.length - a.people.length || String(a.name).localeCompare(String(b.name)); }).map(function(c){
        return '<li><b>' + (c.covered ? '<a href="?tab=stock&s=' + encodeURIComponent(c.covered) + '" data-stock-sym="' + esc(c.covered) + '">' + esc(coName(c.name)) + '</a>' : esc(coName(c.name))) + ((c.covered || c.ticker) ? ' <small>' + esc(c.covered || c.ticker) + '</small>' : '') + '</b><span>' + c.people.map(function(q){ return '<button type="button" class="ld-plink" data-ld-person="' + esc(people[q.i].id) + '">' + esc(people[q.i].name) + '</button>' + (q.role ? ' <small>(' + esc(shortRole(q.role)) + ')</small>' : ''); }).join(', ') + '</span></li>';
      }).join('');
      var inter = (d.interlocks || []).length ? '<p class="ld-inter">Shares people with ' + d.interlocks.map(function(x){ return '<a class="ld-chip is-covered" href="?tab=stock&s=' + encodeURIComponent(x.symbol) + '" data-stock-sym="' + esc(x.symbol) + '">' + esc(x.symbol) + ' <small>' + x.people.length + '</small></a>'; }).join(' ') + '</p>' : '';
      return inter + '<div class="ld-web-wrap">' + s + '</div>' + legend + '<h4 class="ld-h4">Where they also sit</h4><ul class="ld-where">' + rows + '</ul>' +
        '<p class="stp-src">From the proxy statement’s list of each director’s other public company boards, and each person’s own SEC insider filings (Forms 3, 4 and 5) at other companies within about the last 15 months. Private company boards and nonprofits do not file these.</p>';
    }
    // --- 4. votes and stakes -----------------------------------------------------
    function votesHtml(d){
      var rows = [];
      d.people.forEach(function(p){ var v = p.proxy && fin(p.proxy.votingPercent) ? p.proxy.votingPercent : p.pctVoting; if (fin(v) || fin(p.pctEconomic) || fin(p.value)) rows.push({ id: p.id, name: p.name, sub: roleText(p), votes: v, econ: p.pctEconomic, value: p.value, k: kind(p) }); });
      (d.holders || []).forEach(function(h){ rows.push({ name: h.name, sub: 'Outside holder', votes: h.pctVoting, econ: fin(h.pctEconomic) ? h.pctEconomic : h.pctOfClass, value: h.value, k: 'holder' }); });
      rows.sort(function(a, b){ return (b.votes || 0) - (a.votes || 0) || (b.econ || 0) - (a.econ || 0) || (b.value || 0) - (a.value || 0); });
      var top = rows.slice(0, 14);
      var max = Math.max.apply(null, top.map(function(r){ return Math.max(r.votes || 0, r.econ || 0); }).concat([1]));
      var seg = [], used = 0;
      rows.filter(function(r){ return fin(r.votes) && r.votes >= 0.5; }).slice(0, 7).forEach(function(r){ if (used + r.votes <= 100.5){ seg.push(r); used += r.votes; } });
      var rest = Math.max(0, 100 - used);
      var stack = '<div class="ld-stack" role="img" aria-label="Share of all votes">' + seg.map(function(r, i){ return '<span class="ld-seg s' + (i % 7) + '" style="width:' + Math.min(100, r.votes).toFixed(2) + '%" title="' + esc(r.name + ': ' + pct(r.votes) + ' of votes') + '"></span>'; }).join('') + '<span class="ld-seg is-rest" style="width:' + rest.toFixed(2) + '%" title="Everyone else: ' + rest.toFixed(1) + '%"></span></div>' +
        '<div class="ld-stack-key">' + seg.map(function(r, i){ return '<span><i class="s' + (i % 7) + '"></i>' + esc(r.name) + ' <b>' + pct(r.votes) + '</b></span>'; }).join('') + '<span><i class="is-rest"></i>Everyone else <b>' + rest.toFixed(1) + '%</b></span></div>';
      var bars = '<div class="ld-bars">' + top.map(function(r){
        return '<div class="ld-bar-row"' + (r.id ? ' data-ld-person="' + esc(r.id) + '" role="button" tabindex="0"' : '') + '><div class="ld-bar-name"><b>' + esc(r.name) + '</b><small>' + esc(r.sub) + '</small></div>' +
          '<div class="ld-bar-pair"><span class="ld-bar is-econ" style="width:' + (fin(r.econ) ? Math.max(0.6, r.econ / max * 100) : 0).toFixed(2) + '%"></span><em>' + pct(r.econ) + ' of shares</em>' +
          '<span class="ld-bar is-votes" style="width:' + (fin(r.votes) ? Math.max(0.6, r.votes / max * 100) : 0).toFixed(2) + '%"></span><em>' + pct(r.votes) + ' of votes</em></div>' +
          '<div class="ld-bar-val">' + usd(r.value) + '</div></div>';
      }).join('') + '</div>';
      var cls = (d.classes || []).length ? '<h4 class="ld-h4">Share classes</h4><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Class</th><th scope="col" class="num">Votes per share</th><th scope="col" class="num">Shares outstanding</th><th scope="col" class="num">Share of all votes</th><th scope="col">Traded</th></tr></thead><tbody>' +
        (function(){
          var tv = 0, ok = true;
          d.classes.forEach(function(c){ if (fin(c.votes) && fin(c.outstanding)) tv += c.votes * c.outstanding; else ok = false; });
          return d.classes.map(function(c){ return '<tr><td>' + esc(c.name) + (c.source === 'quote' ? ' <small class="stp-dim">(count from the quote)</small>' : '') + '</td><td class="num">' + (fin(c.votes) ? (c.votes === 0 ? 'None' : n0(c.votes)) : '—') + '</td><td class="num">' + sh(c.outstanding) + '</td><td class="num">' + (ok && tv > 0 ? pct(c.votes * c.outstanding / tv * 100) : '—') + '</td><td>' + (c.listed === true ? 'Listed' : c.listed === false ? 'Not listed' : '—') + '</td></tr>'; }).join('');
        })() + '</tbody></table></div>' : '';
      var group = d.group ? '<p class="stp-src">' + esc(d.group.name) + ': ' + (d.group.holdings || []).map(function(h){ var multi = (d.group.holdings || []).length > 1 && h.className; return (h.shares ? sh(h.shares) + ' ' + (multi ? esc(h.className) + ' shares' : 'shares') : '') + (fin(h.percent) ? ' (' + pct(h.percent) + (h.className && !multi ? ' of ' + esc(h.className) : '') + ')' : ''); }).join(', ') + (fin(d.group.votingPercent) ? ' · ' + pct(d.group.votingPercent) + ' of votes' : '') + ', per the proxy table.</p>' : '';
      return '<h4 class="ld-h4">Who holds the votes</h4>' + stack + '<h4 class="ld-h4">Stake vs votes</h4>' + bars + cls + group +
        '<p class="stp-src">Shares come from each person’s latest SEC filing (direct, and through trusts, family and entities). Value uses the latest price' + (d.source && d.source.unitPriceNote ? '; ' + esc(String(d.source.unitPriceNote).replace(/[.]$/, '')) : '') + '. Votes use each class’s votes per share; where the proxy statement prints a voting figure, that figure is shown. Unvested stock awards and options are not counted.</p>';
    }
    // --- 5. tenure timeline --------------------------------------------------------
    function tenureHtml(d){
      var ny = nowYear();
      var rows = d.people.filter(function(p){ return !p.entity && startInfo(p); }).map(function(p){ var si = startInfo(p); return { p: p, s: si.y, approx: si.approx }; });
      if (!rows.length) return '<p class="stp-empty">No start dates in the filings read so far.</p>';
      rows.sort(function(a, b){ return a.s - b.s; });
      var min = Math.max(ny - 40, Math.min.apply(null, rows.map(function(r){ return r.s; })));
      min = Math.floor(min / 5) * 5;
      var span = Math.max(1, ny + 1 - min);
      function x(y){ return ((Math.max(min, y) - min) / span * 100).toFixed(2) + '%'; }
      var ticks = '';
      for (var y = min; y <= ny; y += (span > 24 ? 10 : 5)) ticks += '<span style="left:' + x(y) + '">' + y + '</span>';
      var body = rows.map(function(r){
        var p = r.p;
        var bars = '';
        if (fin(p.joined) && p.joined < r.s + 100) bars += '<span class="ld-t-bar is-company" style="left:' + x(p.joined) + ';width:calc(100% - ' + x(p.joined) + ')" title="At the company since ' + p.joined + '"></span>';
        if (fin(p.boardSince)) bars += '<span class="ld-t-bar is-board" style="left:' + x(p.boardSince) + ';width:calc(100% - ' + x(p.boardSince) + ')" title="On the board since ' + p.boardSince + '"></span>';
        if (!fin(p.boardSince) && !fin(p.joined)) bars += '<span class="ld-t-bar is-insider' + (r.approx ? ' is-approx' : '') + '" style="left:' + x(r.s) + ';width:calc(100% - ' + x(r.s) + ')" title="' + (r.approx ? 'Filing as an insider since at least ' + esc(day(p.seenSince)) : p.insiderSince ? 'Became an insider ' + esc(day(p.insiderSince)) : 'Since ' + r.s) + '"></span>';
        if (fin(p.roleSince)) bars += '<span class="ld-t-mark" style="left:' + x(p.roleSince) + '" title="In the current role since ' + p.roleSince + '"></span>';
        return '<div class="ld-t-row" data-ld-person="' + esc(p.id) + '" role="button" tabindex="0"><div class="ld-t-name"><b>' + esc(p.name) + '</b><small>' + esc(shortRole(roleText(p))) + (yearsPhrase(p) ? ' · ' + esc(yearsPhrase(p)) : '') + '</small></div><div class="ld-t-track">' + bars + '</div></div>';
      }).join('');
      var ten = rows.map(function(r){ return ny - r.s; });
      return '<div class="ld-t-head"><div></div><div class="ld-t-axis">' + ticks + '</div></div>' + body +
        '<div class="ld-legend"><span><i class="t-company"></i>At the company</span><span><i class="t-board"></i>On the board</span><span><i class="t-insider"></i>Became an insider (Form 3)</span><span><i class="t-insider is-approx"></i>At least since (first filing found)</span><span><i class="t-mark"></i>Took the current role</span></div>' +
        '<p class="stp-src">Longest serving: ' + esc(rows[0].p.name) + ' (' + (rows[0].approx ? 'at least ' : '') + (ny - rows[0].s) + ' years). Median: ' + ten.sort(function(a, b){ return a - b; })[Math.floor(ten.length / 2)] + ' years. Board and company years come from the proxy statement; otherwise the date the person filed Form 3 here, or, failing that, their earliest filing found (a lower bound, marked ≥).</p>';
    }
    // --- 6. table --------------------------------------------------------------------
    function tableView(d){
      var cols = [
        { label: 'Name', cell: function(p){ return personLink(p); }, sort: function(p){ return p.name; } },
        { label: 'Role', cell: function(p){ return esc(roleText(p)); }, sort: function(p){ return roleText(p); } },
        { label: 'Independent', cell: function(p){ return indepText(p); }, sort: function(p){ return p.independent === true ? 1 : p.independent === false ? 0 : -1; } },
        { label: 'Since', num: true, cell: function(p){ var si = startInfo(p); return si ? (si.approx ? '≤' : '') + si.y : ''; }, sort: function(p){ var si = startInfo(p); return si ? si.y : null; } },
        { label: 'Age', num: true, cell: function(p){ return fin(p.age) ? String(p.age) : ''; }, sort: function(p){ return p.age; } },
        { label: 'Shares', num: true, cell: function(p){ return p.holdings ? sh(p.holdings.total) : p.noShares ? 'None' : ''; }, sort: function(p){ return p.holdings ? p.holdings.total : p.noShares ? 0 : null; } },
        { label: 'Value', num: true, cell: function(p){ return fin(p.value) ? usd(p.value) : ''; }, sort: function(p){ return p.value; } },
        { label: '% of shares', num: true, cell: function(p){ return fin(p.pctEconomic) ? pct(p.pctEconomic) : ''; }, sort: function(p){ return p.pctEconomic; } },
        { label: '% of votes', num: true, cell: function(p){ var v = p.proxy && fin(p.proxy.votingPercent) ? p.proxy.votingPercent : p.pctVoting; return fin(v) ? pct(v) : ''; }, sort: function(p){ return p.proxy && fin(p.proxy.votingPercent) ? p.proxy.votingPercent : p.pctVoting; } },
        { label: 'Other companies', cell: function(p){ return otherChips(p, 4); }, sort: function(p){ return otherNow(p).length; } },
        { label: 'Committees', cell: function(p){ return esc((p.committees || []).map(function(c){ return c.replace(/ Committee$/i, ''); }).join(', ')); }, sort: function(p){ return (p.committees || []).length; } }
      ];
      if (typeof VIEWS !== 'undefined' && VIEWS.tableHtml) return VIEWS.tableHtml(cols, d.people, { key: 'leadership', empty: 'No people found yet.' });
      return '<div class="stp-table-wrap"><table class="stp-table"><thead><tr>' + cols.map(function(c){ return '<th scope="col"' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.people.map(function(p){ return '<tr>' + cols.map(function(c){ return '<td' + (c.num ? ' class="num"' : '') + '>' + (c.cell(p) || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }
    // --- 7. changes ----------------------------------------------------------------------
    function changesHtml(d){
      var items = (d.changes || []).map(function(c){
        var what = c.kind === 'joined' ? '<b>' + esc(c.name) + '</b> filed as a new insider' + (c.role ? ' (' + esc(c.role) + ')' : '') : c.kind === 'last-filing' ? 'Last insider filing by <b>' + esc(c.name) + '</b>' + (c.role ? ' (' + esc(c.role) + ')' : '') + '; ' + (c.offBoard ? 'not on the board list in the ' + day(c.offBoard) + ' proxy' : c.replacedBy ? esc(c.replacedBy.name) + ' holds that role now' : 'no longer listed') : 'Leadership change filed (8-K item 5.02: a director or officer joined, left or changed role)';
        return '<li><time>' + day(c.date) + '</time><span>' + what + (c.url ? ' · <a href="' + esc(c.url) + '" target="_blank" rel="noopener">Read the filing</a>' : '') + '</span></li>';
      }).join('');
      var former = (d.former || []).length ? '<h4 class="ld-h4">Former insiders</h4><div class="stp-table-wrap"><table class="stp-table"><thead><tr><th scope="col">Name</th><th scope="col">Last role filed</th><th scope="col">Insider since</th><th scope="col">Last filing</th></tr></thead><tbody>' +
        d.former.map(function(f){ return '<tr><td>' + esc(f.name) + '</td><td>' + esc(f.role || '') + (f.replacedBy ? '<small class="stp-dim"> · now ' + esc(f.replacedBy.name) + ' (filing of ' + day(f.replacedBy.at) + ')</small>' : f.offBoard ? '<small class="stp-dim"> · not on the board list in the ' + day(f.offBoard) + ' proxy</small>' : '') + '</td><td>' + (f.insiderSince ? day(f.insiderSince) : f.seenSince ? 'by ' + day(f.seenSince) : '—') + '</td><td>' + (f.lastUrl ? '<a href="' + esc(f.lastUrl) + '" target="_blank" rel="noopener">' + day(f.lastFiled) + '</a>' : day(f.lastFiled)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
      return (items ? '<ol class="ld-changes">' + items + '</ol>' : '<p class="stp-empty">No leadership changes in the last 18 months of filings.</p>') + former;
    }
    // --- person detail -----------------------------------------------------------------
    function detailHtml(p){
      if (!p) return '';
      var hold = p.holdings;
      // One "as of" for all lines goes in the source note instead of a column;
      // a footnote gets a row of its own under its line.
      var oneDay = hold && hold.lines && hold.lines.every(function(l){ return l.asOf === hold.lines[0].asOf; });
      var shortNote = function(t){ t = String(t || ''); if (t.length <= 140) return t; var cut = t.slice(0, 140); return cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : 140) + '…'; };
      var lines = hold && hold.lines && hold.lines.length ? '<div class="ld-mini-wrap"><table class="stp-table ld-mini ld-lines" data-nosort><thead><tr><th scope="col">How held</th><th scope="col">Class</th><th scope="col" class="num">Shares</th>' + (oneDay ? '' : '<th scope="col">As of</th>') + '</tr></thead><tbody>' +
        hold.lines.map(function(l){ return '<tr' + (l.note ? ' class="has-note"' : '') + '><td>' + esc(l.how) + '</td><td>' + esc(l.cls === 'common' ? 'Common' : l.cls === 'ADS' ? 'ADS' : 'Class ' + l.cls) + '</td><td class="num">' + n0(l.shares) + '</td>' + (oneDay ? '' : '<td>' + day(l.asOf) + '</td>') + '</tr>' +
          (l.note ? '<tr class="ld-note-row"><td colspan="' + (oneDay ? 3 : 4) + '" title="' + esc(l.note) + '">' + esc(shortNote(l.note)) + '</td></tr>' : ''); }).join('') + '</tbody></table></div>' : '';
      var srcLine = hold ? '<p class="stp-src">' + (hold.source === 'proxy' ? 'Shares from the proxy ownership table' + (hold.asOf ? ' (as of ' + esc(hold.asOf) + ')' : '') + ', because the insider filings read so far do not cover every share class this person holds.' : 'Shares from the latest SEC insider filings (Forms 3, 4 and 5), as of ' + day(hold.asOf) + '.') +
        (hold.ads ? ' The total counts each of the ' + n0(hold.ads) + ' US depositary shares (ADS) as ' + n0(hold.adsRatio) + ' ordinary shares.' : '') + '</p>'
        : p.noShares ? '<p class="stp-src">Their SEC insider filings so far report no shares. Stock awards that have not vested and options are not counted.</p>' : '';
      var proxyLine = p.proxy && p.proxy.holdings && p.proxy.holdings.length && hold && hold.source !== 'proxy' ? '<p class="stp-src">Proxy ownership table: ' + p.proxy.holdings.map(function(h){ return (h.shares ? n0(h.shares) + ' shares' : '') + (h.className ? ' ' + esc(h.className) : '') + (fin(h.percent) ? ' (' + pct(h.percent) + ' of class)' : ''); }).join(', ') + (fin(p.proxy.votingPercent) ? ' · ' + pct(p.proxy.votingPercent) + ' of votes' : '') + '. The table counts options and awards vesting within 60 days, so it can differ from the filing count.</p>' : '';
      var others = (p.other || []).map(function(o){
        return '<li>' + (o.covered ? '<a href="?tab=stock&s=' + encodeURIComponent(o.covered) + '" data-stock-sym="' + esc(o.covered) + '">' + esc(o.name) + '</a>' : esc(o.name)) + (o.ticker ? ' <small>' + esc(o.ticker) + '</small>' : '') +
          ' <span class="stp-dim">' + esc(o.role || 'Insider') + (o.since ? ' · since ' + day(o.since) : '') + (o.left ? ' · no longer listed there' : o.active ? '' : o.last ? ' · last filing ' + day(o.last) : o.before ? ' · last filing before ' + day(o.before) : '') + '</span></li>';
      }).join('');
      var boards = (p.otherBoards || []).length ? '<p><b>Other public boards (per the proxy):</b> ' + p.otherBoards.map(function(b){ return (b.covered ? '<a href="?tab=stock&s=' + encodeURIComponent(b.covered) + '" data-stock-sym="' + esc(b.covered) + '">' + esc(b.company) + '</a>' : esc(b.company)) + (b.current ? '' : ' <small class="stp-dim">(' + (b.left ? 'no longer listed there' : 'past') + ')</small>'); }).join(', ') + '</p>' : '';
      var tx = (p.tx || []).length ? '<h5>Latest filed trades</h5><div class="ld-mini-wrap"><table class="stp-table ld-mini ld-tx" data-nosort><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Price</th><th scope="col" class="num">Owned after</th></tr></thead><tbody>' +
        p.tx.map(function(t){ return '<tr><td>' + day(t.date) + '</td><td title="SEC transaction code ' + esc(t.code) + '">' + esc(t.what) + ' <small class="stp-dim ld-code">' + esc(t.code) + '</small></td><td class="num">' + (t.ad === 'D' ? '−' : '+') + n0(t.shares) + '</td><td class="num">' + (fin(t.price) && t.price > 0 ? '$' + Number(t.price).toFixed(2) : '—') + '</td><td class="num">' + n0(t.post) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
      return '<section class="ld-detail" aria-label="' + esc(p.name) + '">' +
        '<div class="ld-detail-head"><span class="ld-avatar is-lg k-' + kind(p) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span><div><h4>' + esc(p.name) + '</h4><p>' + esc(roleText(p)) + (fin(p.age) ? ' · age ' + p.age : '') + '</p><span class="ld-badges">' + badges(p) + '</span></div>' +
          '<button type="button" class="ld-close" data-ld-close aria-label="Close">×</button></div>' +
        (p.occupation ? '<p><b>Main job:</b> ' + esc(p.occupation) + '</p>' : '') +
        (tenureLine(p) ? '<p><b>Tenure:</b> ' + esc(tenureLine(p)) + '</p>' : '') +
        ((p.committees || []).length ? '<p><b>Committees:</b> ' + esc(p.committees.join(', ')) + ((p.chairOf || []).length ? ' · chairs ' + esc(p.chairOf.join(', ')) : '') + '</p>' : '') +
        '<div class="ld-detail-kpis"><div><small>Shares</small><b>' + (hold ? n0(hold.total) : p.noShares ? 'None' : '—') + '</b></div><div><small>Value</small><b>' + usd(p.value) + '</b></div><div><small>Of all shares</small><b>' + pct(p.pctEconomic) + '</b></div><div><small>Of all votes</small><b>' + pct(p.proxy && fin(p.proxy.votingPercent) ? p.proxy.votingPercent : p.pctVoting) + '</b></div></div>' +
        (p.wasCeo ? '<p class="ld-note">Named CEO in an older filing (' + esc(p.wasCeo) + '); a newer filing names someone else.</p>' : '') +
        (p.replacedBy ? '<p class="ld-note">Was ' + esc(p.replacedBy.role) + '; a filing of ' + day(p.replacedBy.at) + ' names ' + esc(p.replacedBy.name) + '.</p>' : '') +
        (p.wasChair ? '<p class="ld-note">Listed as chair in an older filing (' + esc(p.wasChair) + '); a newer filing names someone else.</p>' : '') +
        lines + srcLine + proxyLine + boards +
        (others ? '<h5>Insider at other public companies</h5><ul class="ld-others">' + others + '</ul>' : '') +
        tx +
        (p.lastUrl ? '<p class="stp-src">Latest SEC filing: <a href="' + esc(p.lastUrl) + '" target="_blank" rel="noopener">' + day(p.lastFiled) + '</a>' + (p.cik ? ' · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + esc(p.cik) + '&type=4&owner=include" target="_blank" rel="noopener">All of their filings</a>' : '') + '</p>' : '') +
      '</section>';
    }
    // --- frame --------------------------------------------------------------------------
    function viewBody(d, sym){
      var v = st.view;
      return v === 'org' ? orgHtml(d) : v === 'web' ? webHtml(d, sym) : v === 'votes' ? votesHtml(d) : v === 'tenure' ? tenureHtml(d) : v === 'table' ? tableView(d) : v === 'changes' ? changesHtml(d) : peopleHtml(d);
    }
    function sourceHtml(d){
      var s = d.source || {};
      var bits = [];
      if (s.doc) bits.push(esc(s.doc.form) + ' filed ' + day(s.doc.filed) + ' (<a href="' + esc(s.doc.url) + '" target="_blank" rel="noopener">open</a>' + (s.doc.recordDate ? ', record date ' + day(s.doc.recordDate) : '') + '; read by AI and checked against the text: ' + s.doc.kept + ' facts kept' + (s.doc.dropped ? ', ' + s.doc.dropped + ' dropped' : '') + ')');
      else if (s.docPending) bits.push('the ' + esc(s.docPending.form) + ' filed ' + day(s.docPending.filed) + ' is queued to be read');
      if (s.filingsThrough) bits.push('insider Forms 3, 4 and 5 through ' + day(s.filingsThrough) + ' (' + (s.insiders || 0) + ' filers)');
      return '<p class="stp-src">Source: SEC EDGAR, ' + bits.join('; ') + '. <a href="' + esc(s.edgar) + '" target="_blank" rel="noopener">Company filings</a>. Public disclosures, not investment advice.</p>';
    }
    function html(d, sym){
      if (!d) return '';
      var note = '';
      if (d.collecting) note = '<p class="ld-note">Still collecting: the first pass reads each insider’s newest filings and the latest proxy statement over a few days, so some people or figures may be missing.</p>';
      if (!d.section16) note += '<p class="ld-note">' + esc(d.name) + ' files as a foreign company, so its insiders do not file US Forms 3, 4 and 5. People and holdings come from its annual report (20-F).</p>';
      var tabs = '<div class="ld-views" role="tablist" aria-label="Ways to view">' + VIEWS_LIST.map(function(v){ return '<button type="button" role="tab" class="ld-view' + (st.view === v[0] ? ' is-on' : '') + '" aria-selected="' + (st.view === v[0]) + '" data-ld-view="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>';
      return note + headerHtml(d) + tabs + '<div class="ld-detail-slot">' + (st.sel ? detailHtml(byId(st.sel)) : '') + '</div><div class="ld-body ld-v-' + st.view + '">' + viewBody(d, sym) + '</div>' + sourceHtml(d);
    }
    function paint(root){
      if (!root || !st.data) return;
      root.innerHTML = html(st.data, st.sym);
      // On a phone the web scrolls sideways inside its box: start centred.
      var w = root.querySelector('.ld-web-wrap');
      if (w && w.scrollWidth > w.clientWidth) w.scrollLeft = (w.scrollWidth - w.clientWidth) / 2;
    }
    function mount(root, d, sym){
      if (!root) return;
      if (st.sym !== sym) st.sel = null;
      st.data = d; st.sym = sym;
      if (!VIEWS_LIST.some(function(v){ return v[0] === st.view; })) st.view = 'people';
      paint(root);
      root.onclick = function(ev){
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-ld-view], [data-ld-person], [data-ld-close]') : null;
        if (!t || !root.contains(t)) return;
        if (t.hasAttribute('data-ld-view')){ st.view = t.getAttribute('data-ld-view'); try { localStorage.setItem(VIEW_KEY, st.view); } catch (_) {} paint(root); return; }
        if (t.hasAttribute('data-ld-close')){ st.sel = null; paint(root); return; }
        var id = t.getAttribute('data-ld-person');
        st.sel = st.sel === id ? null : id;
        paint(root);
        var slot = root.querySelector('.ld-detail');
        if (slot && slot.scrollIntoView) { try { slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { slot.scrollIntoView(); } }
      };
      root.onkeydown = function(ev){
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-ld-person][tabindex]') : null;
        if (t) { ev.preventDefault(); t.click(); }
      };
    }
    return { mount: mount, html: html };
  })();
`;
}
