#!/usr/bin/env node
// Background publication of the same pregame pair the Owner game board uses.
// Private R2 only. Public workflow logs contain counts, never lines or keys.
import { store } from '../lib/datastore.mjs';
import { recordLoader } from '../lib/sports/http.mjs';
import { loadPropSources } from '../lib/sports/prop-sources.mjs';
import { recommendationsView } from '../lib/sports/props.mjs';
import { capturePropPicks } from '../lib/sports/prop-record.mjs';
import { captureNBAResearch } from '../lib/sports/nba-research.mjs';
if (!process.env.PROPLINE_API_KEY) throw new Error('PROPLINE_API_KEY is required');
if (store.backend !== 'r2') throw new Error('The prop record requires R2');
let failed = false;
const requested = process.argv.find((s) => s.startsWith('--sport='))?.slice(8);
if (requested && !['nba', 'nfl'].includes(requested)) throw new Error('sport must be nba or nfl');
// Our own failure reasons, safe for a public log (no lines, names or keys).
const SAFE_REASONS = new Set(['a current feed is unavailable', 'NBA research recording is unavailable or busy',
  'a current feed is unavailable; NBA outage evidence retained', 'NBA reference feed unavailable; outage evidence retained', 'recording is unavailable or busy']);
for (const sport of requested ? [requested] : ['nba', 'nfl']) {
  let feeds = '';
  try {
    const now = Date.now(), sources = await loadPropSources({ sport, now });
    // Feed states only ("ok", "stale", "rate_limited", "unavailable", ...).
    feeds = ` lines=${sources.lines?.state || '?'} injuries=${sources.injuries?.state || '?'}` + (sport === 'nba' ? ` reference=${sources.reference?.state || '?'}` : '');
    const feedsOk = sources.lines.state === 'ok' && sources.injuries.state === 'ok';
    if (!feedsOk && sport !== 'nba') throw new Error('a current feed is unavailable');
    const view = await recommendationsView({ load: recordLoader(store), sport, now, tz: 'America/Los_Angeles', sources });
    if (sport === 'nba') {
      const evidence = await captureNBAResearch({ store, view, now, clock: Date.now });
      if (evidence.state === 'busy') { console.log('nba: another collector is recording evidence; existing records preserved'); continue; }
      if (evidence.state !== 'ok') throw new Error('NBA research recording is unavailable or busy');
    }
    if (!feedsOk) throw new Error('a current feed is unavailable; NBA outage evidence retained');
    if (sport === 'nba' && sources.reference?.state !== 'ok') throw new Error('NBA reference feed unavailable; outage evidence retained');
    const result = await capturePropPicks({ store, view, clock: Date.now });
    if (result.state === 'busy') { console.log(`${sport}: another scan is recording picks; existing records preserved`); continue; }
    if (result.state !== 'ok') throw new Error('recording is unavailable or busy');
    console.log(`${sport}: ${view.games.length} games checked; ${result.added} pregame props recorded`);
  } catch (err) {
    failed = true;
    const reason = SAFE_REASONS.has(err?.message) ? err.message : `unexpected ${err?.name || 'error'}`;
    console.error(`${sport}: prop refresh failed (${reason};${feeds || ' feeds not read'}); existing record preserved`);
  }
}
if (failed) process.exitCode = 1;
