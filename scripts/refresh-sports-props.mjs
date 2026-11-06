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
for (const sport of requested ? [requested] : ['nba', 'nfl']) {
  try {
    const now = Date.now(), sources = await loadPropSources({ sport, now });
    const feedsOk = sources.lines.state === 'ok' && sources.injuries.state === 'ok';
    if (!feedsOk && sport !== 'nba') throw new Error('a current feed is unavailable');
    const view = await recommendationsView({ load: recordLoader(store), sport, now, tz: 'America/Los_Angeles', sources });
    if (sport === 'nba') {
      const evidence = await captureNBAResearch({ store, view, now, clock: Date.now });
      if (evidence.state !== 'ok') throw new Error('NBA research recording is unavailable or busy');
    }
    if (!feedsOk) throw new Error('a current feed is unavailable; NBA outage evidence retained');
    const result = await capturePropPicks({ store, view, clock: Date.now });
    if (result.state !== 'ok') throw new Error('recording is unavailable or busy');
    console.log(`${sport}: ${view.games.length} games checked; ${result.added} pregame props recorded`);
  } catch { failed = true; console.error(`${sport}: prop refresh failed; existing record preserved`); }
}
if (failed) process.exitCode = 1;
