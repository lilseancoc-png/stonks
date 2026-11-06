#!/usr/bin/env node
// Background publication of the same pregame pair the Owner game board uses.
// Private R2 only. Public workflow logs contain counts, never lines or keys.
import { store } from '../lib/datastore.mjs';
import { recordLoader } from '../lib/sports/http.mjs';
import { loadPropSources } from '../lib/sports/prop-sources.mjs';
import { recommendationsView } from '../lib/sports/props.mjs';
import { capturePropPicks } from '../lib/sports/prop-record.mjs';
if (!process.env.PROPLINE_API_KEY) throw new Error('PROPLINE_API_KEY is required');
if (store.backend !== 'r2') throw new Error('The prop record requires R2');
let failed = false;
for (const sport of ['nba', 'nfl']) {
  try {
    const now = Date.now(), sources = await loadPropSources({ sport, now });
    if (sources.lines.state !== 'ok' || sources.injuries.state !== 'ok') throw new Error('a current feed is unavailable');
    const view = await recommendationsView({ load: recordLoader(store), sport, now, tz: 'America/Los_Angeles', sources });
    const result = await capturePropPicks({ store, view, clock: Date.now });
    if (result.state !== 'ok') throw new Error('recording is unavailable or busy');
    console.log(`${sport}: ${view.games.length} games checked; ${result.added} pregame props recorded`);
  } catch { failed = true; console.error(`${sport}: prop refresh failed; existing record preserved`); }
}
if (failed) process.exitCode = 1;
