// Smoke test for the engine history on the site (lib/engines-history.mjs,
// 2026-11-17): the committed results stay aggregates only, today's market
// cell follows the history test's rules, the regime fit and its line read
// the right cells, the switch writes the off stub, the file is public and
// bake-owned, the Owner brief, the MCP and the pages are wired, and nothing
// in it can reach a pick, grade, engine or record. Synthetic inputs only.
// Run: node scripts/engines-history-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEnginesHistory, marketCell, regimeFit, fitLine, validateEnginesHistory,
  ENGINES_HISTORY_KEY, STYLE_IDS, STYLES, CASE_ERAS,
} from '../lib/engines-history.mjs';
import { enginesHistoryResults, enginesHistoryInputs, enginesHistoryFixture, ENGINES_HISTORY_FIXTURE_TIME } from './fixtures/engines-history.mjs';
import { isPremiumKey } from '../lib/premium-keys.mjs';
import { isBakeOwnedKey } from '../lib/data-ownership.mjs';
import { buildOwnerMarketBrief, OWNER_BRIEF_SOURCES } from '../lib/owner-market-brief.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';
import { FEATURE_DATASETS } from '../lib/mcp/tools.mjs';
import { OWNER_SETTINGS } from '../lib/owner-settings.mjs';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// 1. The committed results: aggregates only, every era and style present.
const results = enginesHistoryResults();
const v = validateEnginesHistory(results);
ok(v.ok, 'committed results pass the aggregates-only check: ' + v.errors.join('; '));
ok(results.eras.length >= 20, 'at least 20 eras');
for (const id of STYLE_IDS) ok(results.styles[id] && Number.isFinite(results.styles[id].n), 'totals for ' + id);
const raw = readFileSync(new URL('../research/engines-history/latest.json', import.meta.url), 'utf8');
ok(!/"(symbol|ticker|tradeId|contract|strike|expiry|d0|d1|pnl)"/i.test(raw), 'no trade-level field in the committed file');
ok(!/\b(AAPL|MSFT|NVDA|TSLA|AMZN|META|GOOGL)\b/.test(raw), 'no ticker named in the committed file');
for (const [k, list] of Object.entries(CASE_ERAS)) for (const era of list) ok(results.eras.some((e) => e.key === era), `case ${k}: era "${era}" exists in the results`);
// The guard catches a trade row slipped in.
const leaked = structuredClone(results); leaked.eras[0].trades = [{ symbol: 'AAPL', pnl: 10 }];
ok(!validateEnginesHistory(leaked).ok, 'a trade row is refused');
const long = structuredClone(results); long.years = Array.from({ length: 200 }, (_, y) => ({ y }));
ok(!validateEnginesHistory(long).ok, 'an unbounded list is refused');
ok(!validateEnginesHistory(null).ok, 'nothing is refused');

// 2. Today's market cell follows the history test's rules.
const up = marketCell(enginesHistoryInputs());
eq(up.cell, 'up/normal', 'rising S&P + VIX 18.4 = up/normal');
eq([up.parts.rates.state, up.parts.infl.state, up.parts.fc.state], ['flat', 'low', 'loose'], 'rates flat, inflation low, conditions loose');
const down = marketCell(enginesHistoryInputs({ trend: 'down', vix: 31, cpiYoy: 5, nfci: 0.2, tenYearMove: 0.8 }));
eq(down.cell, 'down/stressed', 'falling S&P + VIX 31 = down/stressed');
eq([down.parts.rates.state, down.parts.infl.state, down.parts.fc.state], ['rising', 'high', 'tight'], 'rates rising, inflation high, conditions tight');
eq(marketCell(enginesHistoryInputs({ vix: 15.9 })).parts.vol.state, 'calm', 'VIX under 16 is calm');
eq(marketCell(enginesHistoryInputs({ vix: 25 })).parts.vol.state, 'stressed', 'VIX 25 is stressed');
eq(marketCell(enginesHistoryInputs({ tenYearMove: -0.6 })).parts.rates.state, 'falling', 'a 0.6 point fall is falling');
eq(marketCell(enginesHistoryInputs({ nfci: 0 })).parts.fc.state, 'tight', 'NFCI at 0 is tight');
// Missing or stale series leave their part out, never guess.
const noVix = marketCell({ ...enginesHistoryInputs(), vix: [] });
ok(noVix.cell === null && noVix.parts.vol === null && noVix.parts.trend, 'no VIX: no cell, trend still read');
const staleVix = enginesHistoryInputs(); staleVix.vix = staleVix.vix.slice(0, 200);
eq(marketCell(staleVix).parts.vol, null, 'a VIX reading months old is not today');
eq(marketCell({ spx: enginesHistoryInputs().spx.slice(0, 150) }), null, 'fewer than 200 sessions: no cell');

// 3. The regime fit reads the history test's own cells.
const fit = regimeFit(results, up);
eq(fit.rows.length, STYLE_IDS.length, 'one row per style');
const mac = fit.rows.find((r) => r.id === 'macro');
eq(mac.cell, results.regime.byState.macro.cell['up/normal'], 'macro row = the up/normal cell');
eq(mac.infl, results.regime.byState.macro.infl.low, 'macro inflation row = low');
ok(fit.best && fit.worst && fit.best !== fit.worst, 'best and worst named');
const line = fitLine(up, fit);
ok(/Today \(2026-11-16\)/.test(line) && /Context, not a vote/.test(line) && /trades\)/.test(line), 'the line names the date, counts and says context');
ok(!/\b(buy|sell|should)\b/i.test(line), 'no advice wording in the line');

// 4. The payload: on, off, failure.
const p = enginesHistoryFixture();
eq(p.enabled, true, 'on by default');
eq(p.asOf, '2026-11-16', 'asOf is the newest S&P close');
eq(p.styles.map((s) => s.id), STYLE_IDS, 'styles in order');
ok(p.today.line && p.today.fit, 'today carries the line and the fit');
ok(JSON.stringify(p).length < 80000, 'the file stays small');
const off = buildEnginesHistory({ builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, enabled: false });
eq(off, { version: 1, builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, enabled: false }, 'off writes the stub');
assert.throws(() => buildEnginesHistory({ builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, results: leaked }), /invalid/); checks++;
const noInputs = buildEnginesHistory({ builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, results });
eq(noInputs.today, null, 'no series: no today block, still a file');
ok(STYLES.earnings.standIn && STYLES.fundamentals.standIn && STYLES.flow.standIn && !STYLES.macro.standIn, 'stand-ins flagged');

// 5. Access and storage: public, bake-owned, an Owner Settings switch.
eq(isPremiumKey(ENGINES_HISTORY_KEY), false, 'the file is public');
ok(isBakeOwnedKey(ENGINES_HISTORY_KEY), 'the bake may publish it');
const setting = OWNER_SETTINGS.find((s) => s.key === 'ENGINES_HISTORY');
ok(setting && setting.kind === 'switch' && setting.default === true && !setting.picks, 'Owner Settings switch, on, changes no pick');

// 6. Owner brief: one context finding, never a priority.
ok(OWNER_BRIEF_SOURCES.some((s) => s.id === 'engines-history' && s.key === ENGINES_HISTORY_KEY), 'brief reads the file');
{
  const f = ownerBriefFixture();
  f.payloads[ENGINES_HISTORY_KEY] = { ...p, builtAtIso: f.builtAtIso, asOf: f.builtAtIso };
  const report = buildOwnerMarketBrief(f);
  const found = report.findings.find((x) => x.id.startsWith('engines-history:'));
  ok(found && /regime fit/.test(found.title) && found.priority === 4, 'brief adds the regime fit line at the lowest priority');
  ok(!report.priorities.some((x) => x.id.startsWith('engines-history:')), 'never a headline priority');
  const f2 = ownerBriefFixture(); f2.payloads[ENGINES_HISTORY_KEY] = { ...off, builtAtIso: f2.builtAtIso };
  ok(!buildOwnerMarketBrief(f2).findings.some((x) => x.id.startsWith('engines-history:')), 'switched off: no finding');
}

// 7. MCP datasets.
eq(FEATURE_DATASETS['pattern-lab']?.['engines-history'], ENGINES_HISTORY_KEY, 'MCP pattern-lab dataset');
eq(FEATURE_DATASETS.engines?.history, ENGINES_HISTORY_KEY, 'MCP engines dataset');

// 8. Pages: each host leaves its placeholder; the client fills them.
const src = (f) => readFileSync(new URL('./render/' + f, import.meta.url), 'utf8');
ok(/data-eh="eras"/.test(src('pattern-lab-client.mjs')), 'Pattern lab placeholder');
ok(/data-eh="fit"/.test(src('regime-lab-client.mjs')), 'Regime Lab placeholder');
ok(/data-eh="strip"[^>]*rhymes:/.test(src('history-rhymes-client.mjs')), 'Booms & busts placeholder');
ok(/events:/.test(src('historical-data-client.mjs')) && /data-eh-case="crises"/.test(src('historical-data-client.mjs')), 'Historical Data placeholders');
ok(/renderEnginesHistoryJs\(\)/.test(src('app-js.mjs')) && /renderEnginesHistoryCss\(\)/.test(src('styles-css.mjs')), 'client and styles pasted');
const client = src('engines-history-client.mjs');
ok(/vnJson\('engines-history\.json', false\)/.test(client), 'client reads the public file');
ok(!/\`/.test(client.slice(client.indexOf('return `') + 8, client.lastIndexOf('`'))), 'no backtick inside the pasted script');

// 9. Nothing that decides a trade imports it.
for (const f of ['lib/engines/book.mjs', 'lib/engines/signals.mjs', 'lib/engines/learn.mjs', 'lib/top-picks-config.mjs', 'lib/regime-lab/payload.mjs', 'lib/self-loop/tune.mjs']) {
  let text = ''; try { text = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); } catch { continue; }
  ok(!/engines-history/.test(text), f + ' does not read the engine history');
}
const build = readFileSync(new URL('./build.mjs', import.meta.url), 'utf8');
eq((build.match(/buildEnginesHistory\(/g) || []).length, 1, 'the bake builds it once');
ok(/ENGINES_HISTORY !== "0"/.test(build), 'the bake honours ENGINES_HISTORY=0');

console.log(`engines-history smoke: ${checks} checks passed`);
