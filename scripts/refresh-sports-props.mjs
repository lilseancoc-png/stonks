#!/usr/bin/env node
// Background publication of the same pregame pair the Owner game board uses.
// Private R2 only. Public workflow logs contain counts, never lines or keys.
import { store } from '../lib/datastore.mjs';
import { recordLoader } from '../lib/sports/http.mjs';
import { loadPropSourcesWithRetry } from '../lib/sports/prop-sources.mjs';
import { recommendationsView } from '../lib/sports/props.mjs';
import { capturePropPicks } from '../lib/sports/prop-record.mjs';
import { captureNBAResearch } from '../lib/sports/nba-research.mjs';
import { archiveLines } from '../lib/sports/line-archive.mjs';
if (!process.env.PROPLINE_API_KEY) throw new Error('PROPLINE_API_KEY is required');
if (store.backend !== 'r2') throw new Error('The prop record requires R2');
let failed = false;
const requested = process.argv.find((s) => s.startsWith('--sport='))?.slice(8);
// --no-game-lines: skip the NBA books' game spread/total request (the
// NBA research collector; the board falls back to the archived line the
// hourly props scan wrote, so the request budget stays where it was).
const gameLines = !process.argv.includes('--no-game-lines');
if (requested && !['nba', 'nfl'].includes(requested)) throw new Error('sport must be nba or nfl');
// Our own failure reasons, safe for a public log (no lines, names or keys).
const SAFE_REASONS = new Set(['a current feed is unavailable',
  'a current feed is unavailable; NBA outage evidence retained', 'NBA reference feed unavailable; outage evidence retained', 'recording is unavailable or busy']);
for (const sport of requested ? [requested] : ['nba', 'nfl']) {
  let feeds = '';
  try {
    const { now, sources, retried } = await loadPropSourcesWithRetry({ sport, parts: ['lines', 'injuries', 'reference', ...(gameLines ? ['game_lines'] : [])] });
    if (retried) console.log(`${sport}: a feed was down, read once more after a short wait (${retried.trim()})`);
    // Feed states only ("ok", "stale", "rate_limited", "unavailable", ...),
    // plus the provider's HTTP status number for a failed sportsbook read.
    const code = (s) => (s ? ` (http ${s})` : '');
    const kind = (k) => (k ? ` (${k})` : '');
    feeds = `${retried} lines=${sources.lines?.state || '?'}${code(sources.lines?.http_status)} injuries=${sources.injuries?.state || '?'}` + (sport === 'nba'
      ? ` reference=${sources.reference?.state || '?'}${code(sources.reference?.http_status)}${kind(sources.reference?.fail_kind)} game_lines=${sources.reference?.game_lines_state || '?'}${code(sources.reference?.game_lines_http_status)}${kind(sources.reference?.game_lines_fail_kind)}`
      // NFL book prices (2026-11-13): state, priced lines and distinct books
      // (counts only), so the scheduled run shows whether the feed carries them.
      : ` reference=${sources.reference?.state || '?'}${code(sources.reference?.http_status)}${kind(sources.reference?.fail_kind)} book_lines=${sources.reference?.quotes?.length || 0} books=${new Set((sources.reference?.quotes || []).map((q) => q.book)).size}`);
    if (sport === 'nba') {
      const q = sources.reference?.quotes || [];
      feeds += ` book_lines=${q.length} books=${new Set(q.map((x) => x.book)).size}`;
    }
    const feedsOk = sources.lines.state === 'ok' && sources.injuries.state === 'ok';
    if (!feedsOk && sport !== 'nba') throw new Error('a current feed is unavailable');
    const view = await recommendationsView({ load: recordLoader(store), sport, now, tz: 'America/Los_Angeles', sources });
    // Every matched pregame line, for the model check's real-line score
    // (counts only in the log).
    const archived = await archiveLines({ store, sport, lines: view.line_index, gameLines: view.game_line_index || [], now });
    console.log(`${sport}: line archive ${archived.state}; ${archived.added} new lines, ${archived.moved} moved, ${archived.games || 0} game spreads/totals`);
    // How the feed's lines were tied to stored players (counts only).
    const m = view.matching || {};
    console.log(`${sport}: lines matched by id ${m.id || 0}, by name ${m.name || 0}, by name variant ${m.variant || 0}; ${m.unmatched_players || 0} player names not matched`);
    if (sport === 'nba') {
      // The research evidence and the props record are separate files under
      // separate leases. Since 2026-11-17 (Owner choice) a research capture
      // that fails or finds another collector busy no longer stops the props
      // record: the run notes it as a warning and records the props anyway.
      const evidence = await captureNBAResearch({ store, view, now, clock: Date.now });
      if (evidence.state === 'busy') console.log('nba: another collector is recording evidence; recording the props anyway');
      else if (evidence.state !== 'ok') {
        // Which step stopped and a fixed error label (researchFailure), so the
        // run says why without printing keys or provider text.
        const f = evidence.failure;
        console.log(`::warning::nba: research recording failed${f ? ` (research=${f.step}/${f.kind})` : ''}; recording the props anyway`);
      }
    }
    if (!feedsOk) throw new Error('a current feed is unavailable; NBA outage evidence retained');
    if (sport === 'nba' && sources.reference?.state !== 'ok') throw new Error('NBA reference feed unavailable; outage evidence retained');
    const result = await capturePropPicks({ store, view, lines: sources.lines.lines, clock: Date.now });
    if (result.state === 'busy') { console.log(`${sport}: another scan is recording picks; existing records preserved`); continue; }
    if (result.state !== 'ok') throw new Error('recording is unavailable or busy');
    console.log(`${sport}: ${view.games.length} games checked; ${result.added} pregame props recorded; ${result.closings || 0} closing lines noted`);
  } catch (err) {
    failed = true;
    const reason = SAFE_REASONS.has(err?.message) ? err.message : `unexpected ${err?.name || 'error'}`;
    console.error(`${sport}: prop refresh failed (${reason};${feeds || ' feeds not read'}); existing record preserved`);
  }
}
if (failed) process.exitCode = 1;
