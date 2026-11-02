// Bundled into app.js (Function.toString). The Owner Sports section: NBA,
// NFL and Pick Builder pages. Everything is read from the gated
// /api/auth/me?sports=... route; nothing private is written into the page or
// browser storage. The only thing kept in localStorage is the viewer's chosen
// time zone for the Today / Tomorrow boards.
export function sportsFactory(host, doc, options) {
  const TZ_KEY = 'stonks-sports-tz-v1';
  const state = { status: null, pending: null, error: null, page: null, bound: {} };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const leagueOf = (page) => page === 'sports-nba' ? 'nba' : page === 'sports-nfl' ? 'nfl' : null;
  const root = (page) => doc.getElementById(page + '-root');

  function savedZone() {
    try { return host.localStorage.getItem(TZ_KEY) || ''; } catch (_) { return ''; }
  }
  function saveZone(tz) {
    try { host.localStorage.setItem(TZ_KEY, tz); } catch (_) {}
  }
  function fmtDay(dateStr, tz) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
    } catch (_) { return dateStr; }
  }
  function fmtWhen(iso, tz) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); }
    catch (_) { return iso; }
  }

  function fetchStatus(force) {
    if (state.pending) return state.pending;
    if (state.status && !force) return Promise.resolve(state.status);
    const tz = savedZone();
    const url = '/api/auth/me?sports=status' + (tz ? '&tz=' + encodeURIComponent(tz) : '');
    state.error = null;
    state.pending = host.fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => {
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error('signed-out'), { code: 'auth' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then((data) => {
        if (!data || data.schema_version !== 1 || !data.window || !data.sources) throw new Error('Unexpected Sports response');
        state.status = data;
        return data;
      })
      .catch((err) => { state.error = err; throw err; })
      .finally(() => { state.pending = null; });
    return state.pending;
  }

  function zonePicker(s) {
    const current = s.window.time_zone;
    const zones = s.time_zones.slice();
    if (!zones.some((z) => z.id === current)) zones.push({ id: current, label: current });
    return '<label class="sp-zone">Day boundary <select data-sp-zone>' +
      zones.map((z) => '<option value="' + escape(z.id) + '"' + (z.id === current ? ' selected' : '') + '>' + escape(z.label) + ' time</option>').join('') +
      '</select></label>';
  }

  function dayStrip(s) {
    const w = s.window;
    return '<div class="sp-days" role="group" aria-label="Active days">' +
      '<span class="sp-day"><b>Today</b> ' + escape(fmtDay(w.today)) + '</span>' +
      '<span class="sp-day"><b>Tomorrow</b> ' + escape(fmtDay(w.tomorrow)) + '</span>' +
      zonePicker(s) + '</div>';
  }

  function sourceCard(src, tz) {
    const connected = src.state !== 'not_connected';
    const stateText = { ok: 'Up to date', degraded: 'Partly updated', failed: 'Last update failed', unknown: 'Unknown', not_connected: 'Not connected yet' }[src.state] || 'Unknown';
    const rows = [
      ['Source', '<a href="' + escape(src.url) + '" target="_blank" rel="noopener noreferrer">' + escape(src.provider) + '</a>'],
      ['Status', '<span class="sp-state sp-state-' + escape(src.state) + '">' + escape(stateText) + '</span>'],
      ['Last good update', connected ? escape(fmtWhen(src.last_success_utc, tz)) : '—'],
      ['Seasons stored', src.seasons && src.seasons.length ? escape(src.seasons.join(', ')) : '—'],
      ['Refresh', escape(src.refresh)],
      ['Terms', escape(src.license)],
    ];
    return '<div class="sp-source"><h3>Data</h3><dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (src.message ? '<p class="sp-note">' + escape(src.message) + '</p>' : '') + '</div>';
  }

  function statList(stats) {
    return '<div class="sp-stats"><h3>Stats covered</h3><ul>' + stats.map((st) =>
      '<li class="' + (st.enabled ? 'sp-on' : 'sp-later') + '">' + escape(st.label) + (st.enabled ? '' : ' <span>later</span>') + '</li>').join('') + '</ul></div>';
  }

  function leagueHtml(s, league) {
    const src = s.sources[league], tz = s.window.time_zone;
    const name = league.toUpperCase();
    const coming = league === 'nfl'
      ? 'The next update connects nflverse: schedules, two seasons of player game logs, and a daily refresh in season.'
      : 'A later update connects NBA game logs (hoopR and other free sources) and adds CSV import for your own files.';
    const board = src.state === 'not_connected'
      ? '<div class="sp-empty"><b>No ' + name + ' games loaded yet.</b><p>' + escape(coming) + '</p></div>'
      : '<div class="sp-empty"><b>Games will appear here.</b><p>The board lists games starting today or tomorrow in ' + escape(tz) + '.</p></div>';
    return dayStrip(s) + '<div class="sp-grid"><div class="sp-board"><h3>Games</h3>' + board + '</div>' +
      '<aside class="sp-side">' + sourceCard(src, tz) + statList(s.stats[league] || []) + '</aside></div>' +
      '<p class="sp-foot">Private research for the two owners. No sportsbook is connected, nothing is placed, and no AI model is called by this page.</p>';
  }

  function builderHtml(s) {
    const steps = [
      ['Add picks', 'Add 1 to 6 player picks from the NBA and NFL pages, or type them in: player, stat, over or under, and the line.'],
      ['Enter the payout', 'Type the payout your app shows for this exact entry (power or flex). The site never guesses a payout from the number of picks.'],
      ['See the odds', 'Each pick gets a chance of hitting from the player’s history. Picks from the same game are flagged, because they move together.'],
      ['Save a paper pick', 'Save the entry before the games start. After the games it is graded from the final stats, and the journal keeps your record.'],
      ['Screenshots', 'Send a slip screenshot to Claude or ChatGPT; it reads the picks and opens this page with them filled in for you to check and save.'],
    ];
    return dayStrip(s) + '<ol class="sp-steps">' + steps.map((st) => '<li><b>' + escape(st[0]) + '</b><span>' + escape(st[1]) + '</span></li>').join('') + '</ol>' +
      '<div class="sp-empty"><b>The Pick Builder arrives in a later update.</b><p>This page is reserved for it now so the section, its access and its storage are in place first.</p></div>' +
      '<p class="sp-foot">Paper picks only. No sportsbook login, no API and no automatic bets.</p>';
  }

  function render(page) {
    const el = root(page);
    if (!el) return;
    if (!options.owner()) { el.innerHTML = '<div class="sp-empty"><b>Owner sign-in required.</b></div>'; return; }
    if (state.error && !state.status) {
      const auth = state.error.code === 'auth';
      el.innerHTML = '<div class="sp-empty"><b>' + (auth ? 'Your Owner session has ended.' : 'The Sports data could not be loaded.') + '</b>' +
        (auth ? '<p><a href="/welcome.html">Sign in again</a></p>' : '<p><button type="button" class="sp-retry" data-sp-retry>Try again</button></p>') + '</div>';
      return;
    }
    if (!state.status) { el.textContent = 'Loading…'; return; }
    el.innerHTML = page === 'sports-pick-builder' ? builderHtml(state.status) : leagueHtml(state.status, leagueOf(page));
  }

  function bind(page) {
    const el = root(page);
    if (!el || state.bound[page]) return;
    state.bound[page] = true;
    el.addEventListener('change', (event) => {
      const sel = event.target.closest('[data-sp-zone]');
      if (!sel) return;
      saveZone(sel.value);
      state.status = null;
      load(page, true);
    });
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-sp-retry]')) load(page, true);
    });
  }

  function load(page, force) {
    state.page = page;
    bind(page);
    render(page);
    if (!options.owner()) return;
    fetchStatus(force).then(() => render(page), () => render(page));
  }

  return { load };
}
