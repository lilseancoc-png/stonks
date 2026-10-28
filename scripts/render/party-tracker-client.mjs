// Bundled into app.js. Owner prices stay on the gated request and are not
// written into the page or browser storage. Charts opt into the shared
// data-ch hover and data-cr drag-to-compare already used by the rest of the site.
export function partyTrackerFactory(host, doc, options) {
  const state = { data: null, pending: false, error: null, office: 'president', sort: 'gap', dir: 'desc', cycle: 'all', chapter: '', listSort: 'start', listDir: 'asc', openList: false, openMethod: false, bound: false };
  const offices = ['president', 'house', 'senate'];
  const root = () => doc.getElementById('party-tracker-root');
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const partyWord = (party) => party === 'D' ? 'Democratic' : party === 'R' ? 'Republican' : '—';
  const signClass = (n) => typeof n === 'number' && n < 0 ? 'pty-down' : typeof n === 'number' && n > 0 ? 'pty-up' : '';
  const pct = (n, digits) => typeof n === 'number' && Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(digits == null ? 1 : digits) + '%' : '—';
  const excess = (n) => n == null ? '' : Math.abs(n) < 0.05 ? 'in line with S&P' : pct(n) + ' vs S&P';
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function focusSel(sel) {
    const next = root() && root().querySelector(sel);
    if (next && next.focus) next.focus({ preventScroll: true });
  }
  function valid(data) {
    return !!(data && data.version === 1 && typeof data.asOf === 'string' && data.window && Array.isArray(data.offices) && data.offices.length === 3 && data.curves && Array.isArray(data.rows) && Array.isArray(data.timeline) && Array.isArray(data.periods) && Array.isArray(data.methodology));
  }
  function bind() {
    const el = root();
    if (!el || state.bound) return;
    state.bound = true;
    el.addEventListener('click', (event) => {
      const office = event.target.closest('[data-party-office]');
      if (office) {
        state.office = office.getAttribute('data-party-office');
        render();
        focusSel('[data-party-office="' + state.office + '"]');
        return;
      }
      const cycle = event.target.closest('[data-party-cycle]');
      if (cycle) {
        const id = cycle.getAttribute('data-party-cycle');
        state.cycle = id || 'all';
        state.chapter = '';
        if (state.cycle === 'all') {
          if (['total', 'ann', 'excess'].indexOf(state.sort) >= 0) { state.sort = 'gap'; state.dir = 'desc'; }
        } else if (['gap', 'D', 'R'].indexOf(state.sort) >= 0) {
          state.sort = 'ann';
          state.dir = 'desc';
        }
        render();
        focusSel('[data-party-cycle="' + state.cycle + '"]');
        return;
      }
      const chapter = event.target.closest('[data-party-chapter]');
      if (chapter) {
        const id = chapter.getAttribute('data-party-chapter');
        state.chapter = id === 'term' ? '' : id;
        render();
        focusSel('[data-party-chapter="' + (state.chapter || 'term') + '"]');
        return;
      }
      const sort = event.target.closest('[data-party-sort]');
      if (sort) {
        const key = sort.getAttribute('data-party-sort');
        if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.sort = key; state.dir = key === 'name' ? 'asc' : 'desc'; }
        render();
        focusSel('[data-party-sort="' + state.sort + '"]');
        return;
      }
      const listSort = event.target.closest('[data-party-list-sort]');
      if (listSort) {
        const key = listSort.getAttribute('data-party-list-sort');
        if (state.listSort === key) state.listDir = state.listDir === 'asc' ? 'desc' : 'asc';
        else { state.listSort = key; state.listDir = key === 'label' || key === 'start' ? 'asc' : 'desc'; }
        render();
        focusSel('[data-party-list-sort="' + state.listSort + '"]');
      }
      if (event.target.closest('[data-party-retry]')) load(true);
    });
    el.addEventListener('toggle', (event) => {
      const details = event.target.closest('[data-party-details]');
      if (!details) return;
      if (details.getAttribute('data-party-details') === 'list') state.openList = details.open;
      if (details.getAttribute('data-party-details') === 'method') state.openMethod = details.open;
    }, true);
    el.addEventListener('keydown', (event) => {
      const tab = event.target.closest('[data-party-office]');
      if (!tab || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return;
      event.preventDefault();
      const tabs = Array.prototype.slice.call(el.querySelectorAll('[data-party-office]'));
      const index = tabs.indexOf(tab);
      const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
      state.office = tabs[(index + step) % tabs.length].getAttribute('data-party-office');
      render();
      focusSel('[data-party-office="' + state.office + '"]');
    });
  }
  function column(stats, party) {
    return '<div><span>' + partyWord(party) + (stats && stats.faster ? ' · faster' : '') + '</span><b class="' + signClass(stats && stats.annPct) + '">' + pct(stats && stats.annPct) + '</b><small>a year · ' + pct(stats && stats.totalPct) + ' total</small><small>' + (stats && finite(stats.years) ? stats.years.toFixed(1) + ' years' : '—') + '</small></div>';
  }
  function markFaster(parties) {
    const dem = Object.assign({}, parties.D);
    const rep = Object.assign({}, parties.R);
    if (finite(dem.annPct) && finite(rep.annPct) && Math.abs(dem.annPct - rep.annPct) >= 0.05) {
      if (dem.annPct > rep.annPct) dem.faster = true;
      else rep.faster = true;
    }
    return { D: dem, R: rep };
  }
  function hoverAttrs(points, nearestLine) {
    const out = [];
    const dates = [];
    const values = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!finite(point.x) || !finite(point.y) || !finite(point.value)) continue;
      out.push([Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10, point.label]);
      dates.push(point.time);
      values.push(Math.round(point.value * 10000) / 10000);
    }
    if (out.length < 2) return '';
    let html = ' data-ch="' + escape(JSON.stringify(out)) + '"' + (nearestLine ? ' data-ch-xy' : '');
    if (!nearestLine) html += ' data-cr="' + escape(JSON.stringify({ d: dates, s: [{ n: 'S&P 500', v: values }] })) + '"';
    return html;
  }
  function drawChart(seriesList, aria) {
    const flat = [];
    seriesList.forEach((series) => series.points.forEach((point) => { if (point && finite(point.level)) flat.push(point); }));
    if (flat.length < 2) return '<p class="pty-empty">Not enough sessions to draw this stretch.</p>';
    const levels = flat.map((point) => point.level);
    const times = flat.map((point) => Date.parse(point.t));
    const lo = Math.min.apply(null, levels.concat(1));
    const hi = Math.max.apply(null, levels.concat(1));
    const minT = Math.min.apply(null, times);
    const maxT = Math.max.apply(null, times);
    const width = 720;
    const height = 220;
    const padX = 16;
    const padY = 18;
    const xOf = (t) => padX + ((Date.parse(t) - minT) / (maxT - minT || 1)) * (width - padX * 2);
    const yOf = (level) => padY + (1 - (level - lo) / (hi - lo || 1)) * (height - padY * 2);
    const hover = [];
    const paths = seriesList.map((series) => {
      const usable = series.points.filter((point) => point && finite(point.level));
      const d = usable.map((point, index) => {
        const x = xOf(point.t);
        const y = yOf(point.level);
        hover.push({ x: x, y: y, label: point.label, value: point.level, time: point.t });
        const gap = index > 0 && (Date.parse(point.t) - Date.parse(usable[index - 1].t)) > 40 * 86400000;
        return (index && !gap ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + series.color + '" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join('');
    const oneLine = seriesList.length === 1;
    return '<svg class="pty-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(aria) + '"' + hoverAttrs(hover, !oneLine) + '>' +
      '<line x1="' + padX + '" y1="' + yOf(1).toFixed(1) + '" x2="' + (width - padX) + '" y2="' + yOf(1).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.18"/>' +
      paths + '</svg>';
  }
  function pathLabel(point) {
    const move = finite(point.level) ? pct((point.level - 1) * 100) : '—';
    return point.t + '\nS&P 500 $' + Number(point.level).toFixed(2) + ' · ' + move + ' from the start of this line\nPresident ' + partyWord(point.president) + ' · House ' + partyWord(point.house) + ' · Senate ' + partyWord(point.senate);
  }
  function pathChart(points, title, caption) {
    const series = [{ name: 'S&P 500', color: 'currentColor', points: (points || []).map((point) => Object.assign({}, point, { label: pathLabel(point) })) }];
    const end = series[0].points.length ? series[0].points[series[0].points.length - 1].level : null;
    return '<h3>' + escape(title) + '</h3><div class="pty-legend"><span>S&P 500' + (finite(end) ? ' · $' + end.toFixed(2) : '') + '</span><span>$1 is the close before this stretch</span></div>' +
      drawChart(series, title) + '<p class="pty-caption">' + caption + '</p>';
  }
  function compareChart(curves) {
    const dem = curves && curves.D || [];
    const rep = curves && curves.R || [];
    const line = (points, name) => points.filter((point) => finite(point.level)).map((point) => ({
      t: point.t,
      level: point.level,
      label: point.t + '\n' + name + ' days $' + Number(point.level).toFixed(2) + '\n' + pct((point.level - 1) * 100) + ' compounded on those days only',
    }));
    const end = (points) => points.length ? points[points.length - 1].level : null;
    return '<div class="pty-legend"><span><i class="pty-d"></i>Democratic days' + (finite(end(dem)) ? ' · $' + end(dem).toFixed(2) : '') + '</span><span><i class="pty-r"></i>Republican days' + (finite(end(rep)) ? ' · $' + end(rep).toFixed(2) : '') + '</span></div>' +
      drawChart([
        { name: 'Democratic', color: '#7ea0c4', points: line(dem, 'Democratic') },
        { name: 'Republican', color: '#c4896a', points: line(rep, 'Republican') },
      ], 'Growth of one dollar on days each party held the selected office') +
      '<p class="pty-caption">Move next to a line to read that date. A line is drawn only while that party holds the office, so it does not slope through the other party’s years. Cash in those gaps earns nothing. The annualized figures above are the comparison.</p>';
  }
  function sortRows(rows, key, dir, office) {
    const sign = dir === 'asc' ? 1 : -1;
    const read = (row) => {
      if (key === 'name' || key === 'label') return row.label;
      if (key === 'total') return row.totalPct;
      if (key === 'ann') return row.annPct;
      if (key === 'excess') return row.excessTotalPct != null ? row.excessTotalPct : row.excessAnnPct;
      if (key === 'start') return row.start;
      const cell = row.offices && row.offices[office];
      if (!cell) return null;
      if (key === 'D') return cell.D ? cell.D.annPct : null;
      if (key === 'R') return cell.R ? cell.R.annPct : null;
      if (key === 'gap') return cell.gapAnnPct;
      return null;
    };
    return rows.slice().sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (key === 'name' || key === 'label' || key === 'start') return sign * String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv));
      if (av == null && bv == null) return String(a.label || '').localeCompare(String(b.label || ''));
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return String(a.label || a.start || '').localeCompare(String(b.label || b.start || ''));
      return (av - bv) * sign;
    });
  }
  function head(key, label, attrName) {
    const selected = (attrName === 'list' ? state.listSort : state.sort) === key;
    const dir = attrName === 'list' ? state.listDir : state.dir;
    const name = attrName === 'list' ? 'data-party-list-sort' : 'data-party-sort';
    return '<th scope="col" aria-sort="' + (selected ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="pty-sort" ' + name + '="' + key + '">' + label + (selected ? (dir === 'asc' ? ' ↑' : ' ↓') : '') + '</button></th>';
  }
  function comparisonTable(rows) {
    const office = state.office;
    const groups = [['market', 'Other markets'], ['sector', 'Sectors']];
    const body = groups.map(([group, label]) => {
      const items = sortRows(rows.filter((row) => row.group === group), state.sort, state.dir, office);
      if (!items.length) return '';
      return '<tr class="pty-group"><td colspan="4">' + label + '</td></tr>' + items.map((row) => {
        const cell = row.offices[office];
        const side = (stats) => '<td class="' + signClass(stats.annPct) + '"><b>' + pct(stats.annPct) + '</b><small>' + escape(excess(stats.excessAnnPct)) + '</small></td>';
        return '<tr class="' + (row.id === 'XLV' || row.id === 'XLE' ? 'pty-focus' : '') + '"><th scope="row">' + escape(row.label) + '<small>' + escape(row.id) + (row.partial ? ' · since ' + row.firstDate : '') + '</small></th>' + side(cell.D) + side(cell.R) + '<td class="' + signClass(cell.gapAnnPct) + '">' + pct(cell.gapAnnPct) + '<small>' + (cell.leader === 'tie' || !cell.leader ? 'No clear gap' : partyWord(cell.leader) + ' faster') + '</small></td></tr>';
      }).join('');
    }).join('');
    return '<div class="pty-scroll"><table class="pty-table"><caption class="pty-caption">Annualized total return while that party held the selected office. Click a column again to reverse the order. The second line is the gap versus the S&P 500 on the same days.</caption><thead><tr>' + head('name', 'Series') + head('D', 'Democrats') + head('R', 'Republicans') + head('gap', 'Democratic edge') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function stretchTable(rows) {
    const items = sortRows(rows || [], state.sort, state.dir, state.office);
    const groups = [['market', 'Other markets'], ['sector', 'Sectors']];
    const body = groups.map(([group, label]) => {
      const groupRows = items.filter((row) => row.group === group);
      if (!groupRows.length) return '';
      return '<tr class="pty-group"><td colspan="4">' + label + '</td></tr>' + groupRows.map((row) => '<tr class="' + (row.id === 'XLV' || row.id === 'XLE' ? 'pty-focus' : '') + '"><th scope="row">' + escape(row.label) + '<small>' + escape(row.id) + (row.partial ? ' · since ' + row.firstDate : '') + '</small></th><td class="' + signClass(row.totalPct) + '">' + pct(row.totalPct) + '</td><td class="' + signClass(row.annPct) + '">' + pct(row.annPct) + '</td><td class="' + signClass(row.excessTotalPct) + '">' + pct(row.excessTotalPct) + '</td></tr>').join('');
    }).join('');
    return '<div class="pty-scroll"><table class="pty-table"><caption class="pty-caption">Return during this stretch only. Versus S&P is the gap in total return, not the annualized gap. Annualized figures on a stretch shorter than a year can look extreme. Click a column again to reverse it.</caption><thead><tr>' + head('name', 'Series') + head('total', 'Total') + head('ann', 'Annualized') + head('excess', 'Versus S&P') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function govCard(title, stats) {
    return '<article><h3>' + escape(title) + '</h3><b class="' + signClass(stats && stats.annPct) + '">' + pct(stats && stats.annPct) + '</b><p>' + pct(stats && stats.totalPct) + ' total · ' + (stats && finite(stats.years) ? stats.years.toFixed(1) + ' years' : '—') + '</p></article>';
  }
  function activeStretch(data) {
    if (state.cycle === 'all') return null;
    const term = (data.timeline || []).find((item) => item.id === state.cycle);
    if (!term) { state.cycle = 'all'; state.chapter = ''; return null; }
    if (state.chapter) {
      const chapter = (term.chapters || []).find((item) => item.id === state.chapter);
      if (chapter) return { term: term, stretch: chapter, whole: false };
      state.chapter = '';
    }
    return { term: term, stretch: term, whole: true };
  }
  function chips(data, active) {
    const terms = (data.timeline || []).map((term) => '<button type="button" data-party-cycle="' + escape(term.id) + '" aria-pressed="' + (term.id === state.cycle ? 'true' : 'false') + '">' + escape(term.name) + (term.open ? ' · now' : '') + '<small>' + escape(term.start) + ' → ' + escape(term.end) + ' · ' + pct(term.totalPct) + '</small></button>').join('');
    let chapters = '';
    if (active) {
      chapters = '<div class="pty-cycles" role="group" aria-label="Political cycles inside this presidency"><button type="button" data-party-chapter="term" aria-pressed="' + (active.whole ? 'true' : 'false') + '">Whole term<small>' + pct(active.term.annPct) + ' a year</small></button>' +
        (active.term.chapters || []).map((chapter) => '<button type="button" data-party-chapter="' + escape(chapter.id) + '" aria-pressed="' + (chapter.id === state.chapter ? 'true' : 'false') + '">' + partyWord(chapter.house) + ' House · ' + partyWord(chapter.senate) + ' Senate<small>' + escape(chapter.start) + ' → ' + escape(chapter.end) + ' · ' + pct(chapter.totalPct) + '</small></button>').join('') + '</div>';
    }
    return '<div class="pty-cycles" role="group" aria-label="Presidency"><button type="button" data-party-cycle="all" aria-pressed="' + (state.cycle === 'all' ? 'true' : 'false') + '">All years<small>Compare the parties</small></button>' + terms + '</div>' + chapters;
  }
  function timeline(items) {
    return '<section class="pty-block"><h3>Presidents since Bush</h3><div class="pty-timeline">' + items.map((term) => '<article class="pty-term' + (term.id === state.cycle ? ' is-selected' : '') + '"><button type="button" class="pty-term-btn" data-party-cycle="' + escape(term.id) + '" aria-pressed="' + (term.id === state.cycle ? 'true' : 'false') + '"><h3>' + escape(term.name) + ' · ' + partyWord(term.party) + (term.open ? ' <span class="pty-open">In office</span>' : '') + '</h3><p class="pty-caption">' + escape(term.start) + ' to ' + escape(term.end) + ' · S&P 500 ' + pct(term.annPct) + ' a year · ' + pct(term.totalPct) + ' total</p></button></article>').join('') + '</div></section>';
  }
  function periods(rows) {
    const labels = { president: 'President', house: 'House', senate: 'Senate' };
    const sorted = sortRows(rows, state.listSort === 'label' ? 'label' : state.listSort, state.listDir, state.office);
    return '<div class="pty-scroll"><table class="pty-table"><caption class="pty-caption">Every measured stretch. Click a column again to reverse it. Annualized figures on a stretch shorter than a year can look extreme.</caption><thead><tr>' + head('label', 'Control', 'list') + head('start', 'Dates', 'list') + head('total', 'Total', 'list') + head('ann', 'Annualized', 'list') + '</tr></thead><tbody>' + sorted.map((row) => '<tr><th scope="row">' + labels[row.office] + ' · ' + escape(row.label) + ' · ' + partyWord(row.party) + (row.open ? ' <span class="pty-open">Open</span>' : '') + (row.note ? '<small>' + escape(row.note) + '</small>' : '') + '</th><td>' + escape(row.start) + ' → ' + escape(row.end) + '<small>' + (finite(row.years) ? row.years.toFixed(2) + ' years' : '') + '</small></td><td class="' + signClass(row.totalPct) + '">' + pct(row.totalPct) + '</td><td class="' + signClass(row.annPct) + '">' + pct(row.annPct) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function render() {
    const el = root();
    if (!el) return;
    const listDetails = el.querySelector('[data-party-details="list"]');
    const methodDetails = el.querySelector('[data-party-details="method"]');
    if (listDetails) state.openList = listDetails.open;
    if (methodDetails) state.openMethod = methodDetails.open;
    if (!options.owner()) {
      el.innerHTML = '<p class="pty-empty">An Owner session is required to open Party tracker.</p>';
      return;
    }
    if (state.pending) {
      el.innerHTML = '<p class="pty-empty" role="status">Loading party control history…</p>';
      return;
    }
    if (state.error) {
      el.innerHTML = '<div class="pty-empty" role="alert"><p>' + escape(state.error) + '</p><button type="button" class="pty-retry" data-party-retry>Try again</button></div>';
      return;
    }
    const data = state.data;
    if (!data) return;
    if (!offices.includes(state.office)) state.office = 'president';
    const selected = data.offices.find((office) => office.id === state.office) || data.offices[0];
    const highlight = data.highlights && data.highlights[selected.id] || {};
    const active = activeStretch(data);
    const cards = data.offices.map((office) => {
      const parties = markFaster(office.parties);
      return '<article class="pty-card"><h3>' + escape(office.label) + '</h3><div class="pty-pair">' + column(parties.D, 'D') + column(parties.R, 'R') + '</div></article>';
    }).join('');
    const reads = '<div class="pty-reads">' + data.offices.map((office) => '<p>' + escape(office.read) + '</p>').join('') + '</div>';
    const gov = data.government || {};
    let analysis;
    if (active && active.stretch && active.stretch.path) {
      const stretch = active.stretch;
      const health = (stretch.sectors || []).find((row) => row.id === 'XLV');
      const energy = (stretch.sectors || []).find((row) => row.id === 'XLE');
      const who = active.whole ? active.term.name : (partyWord(stretch.house) + ' House and ' + partyWord(stretch.senate) + ' Senate');
      const blurb = who + ', ' + stretch.start + ' to ' + stretch.end + '. The S&P 500 returned ' + pct(stretch.totalPct) + ' (' + pct(stretch.annPct) + ' a year' + (finite(stretch.years) ? ' over ' + stretch.years.toFixed(1) + ' years' : '') + ').';
      const sectorLine = (row, label) => row ? label + ' returned ' + pct(row.totalPct) + ' in this stretch (' + pct(row.annPct) + ' a year), ' + excess(row.excessTotalPct) + ' on the total result.' + (finite(row.years) && row.years >= 1 ? ' Annualized, that is ' + excess(row.excessAnnPct) + '.' : '') : label + ' does not cover this stretch.';
      analysis = '<h3>This stretch</h3><p class="pty-now">' + escape(blurb) + '</p>' +
        pathChart(stretch.path, 'S&P 500 through ' + who, 'Move along the line to read the date, the level, and who held each office. Drag across the line to compare two dates.') +
        '<div class="pty-reads"><p>' + escape(sectorLine(health, 'Health care')) + '</p><p>' + escape(sectorLine(energy, 'Energy')) + '</p></div>' +
        stretchTable(stretch.sectors || []);
    } else {
      analysis = pathChart(data.path || [], 'S&P 500 since Bush’s inauguration', 'Move along the line to read the date and who held the presidency, the House, and the Senate. Drag across the line to compare two dates. Choose a president below to rebase this line on that term.') +
        '<div class="pty-tabs" role="tablist" aria-label="Which office to compare">' + data.offices.map((office) => '<button type="button" role="tab" data-party-office="' + office.id + '" aria-selected="' + (office.id === selected.id ? 'true' : 'false') + '">' + escape(office.label) + '</button>').join('') + '</div>' +
        compareChart(data.curves[selected.id]) +
        '<div class="pty-reads"><p>' + escape(highlight.health || '') + '</p><p>' + escape(highlight.energy || '') + '</p>' + (highlight.widest ? '<p>' + escape(highlight.widest) + '</p>' : '') + '</div>' +
        comparisonTable(data.rows);
    }
    el.innerHTML = (data.carriedForward ? '<p class="pty-notice" role="status">This build could not refresh prices, so the figures below are the previous snapshot' + (data.asOf ? ', through ' + escape(data.asOf) : '') + '.</p>' : '') +
      (data.current ? '<p class="pty-now">' + escape(data.current.read) + '</p>' : '') +
      '<p class="pty-caveat">' + escape(data.caveat || '') + ' Window: ' + escape(data.window.start) + ' through ' + escape(data.window.end) + '.</p>' +
      '<div class="pty-offices">' + cards + '</div>' + reads +
      '<div class="pty-gov">' + govCard('Unified Democratic', gov.unifiedD) + govCard('Unified Republican', gov.unifiedR) + govCard('Split government', gov.divided) + '</div>' +
      '<p class="pty-caption">Unified means one party held the presidency and both chambers. Split is every other day. Both chambers Democratic: ' + pct(gov.bothChambersD && gov.bothChambersD.annPct) + ' a year. Both chambers Republican: ' + pct(gov.bothChambersR && gov.bothChambersR.annPct) + ' a year. Split Congress: ' + pct(gov.splitChambers && gov.splitChambers.annPct) + ' a year.</p>' +
      '<h3>Choose a presidency</h3>' + chips(data, active) + analysis +
      timeline(data.timeline) +
      '<details class="pty-details" data-party-details="list"' + (state.openList ? ' open' : '') + '><summary>Every control stretch</summary>' + periods(data.periods) + '</details>' +
      '<details class="pty-details" data-party-details="method"' + (state.openMethod ? ' open' : '') + '><summary>How this is measured</summary><ul>' + data.methodology.map((line) => '<li>' + escape(line) + '</li>').join('') + '</ul>' + (Array.isArray(data.sources) ? data.sources.map((source) => '<p><a href="' + escape(source.url) + '" target="_blank" rel="noopener">' + escape(source.name) + '</a></p>').join('') : '') + '<p>Built ' + escape(data.builtAtIso) + '.</p></details>';
  }
  async function load(force) {
    bind();
    if (!options.owner()) { render(); return; }
    if (state.pending || (state.data && !force)) { render(); return; }
    state.pending = true;
    state.error = null;
    render();
    try {
      const response = await host.fetch(options.url(), { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Your Owner session is no longer available. Sign in again.' : response.status === 404 ? 'The first Party tracker snapshot has not been published yet. It is produced by a full market build.' : 'The snapshot could not be read. Try again.');
      const data = await response.json();
      if (data && data.error && (!Array.isArray(data.offices) || !data.offices.length)) throw new Error(data.error);
      if (!valid(data)) throw new Error('The snapshot is incomplete or uses an unsupported format. Refresh after the next full market build.');
      state.data = data;
    } catch (err) {
      state.error = err.message || 'Party tracker could not be loaded.';
    } finally {
      state.pending = false;
      render();
    }
  }
  return { load, render };
}
