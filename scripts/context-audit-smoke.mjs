import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildScenarioEngine } from '../lib/scenario-engine.mjs';
import { parseFederalReserveCalendarHtml } from './build.mjs';
import { renderAppJs } from './render/app-js.mjs';

// Production bake and persisted/offline inputs must produce the same coverage.
const bars = Array.from({length: 300}, (_, i) => ({t: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0,10), c: Math.round((100 + i / 3 + Math.sin(i)) * 100) / 100}));
const persisted = {priceSeries: {t: bars.slice(-252).map(b => b.t), c: bars.slice(-252).map(b => b.c)}};
const options = {builtAtIso:'2026-09-06T12:00:00Z', asOfDate:'2026-09-06'};
const baked = buildScenarioEngine({...options, chains:{SPY:{_bars:bars}, AAPL:{_bars:bars}}});
const offline = buildScenarioEngine({...options, chains:{SPY:persisted, AAPL:persisted}});
assert.equal(baked.sensitivities.length, 2);
assert.deepEqual(baked.sensitivities, offline.sensitivities);
assert.equal(buildScenarioEngine({...options, chains:{AAPL:{_bars:[]}}}).sensitivities.length, 0);

const html = `<div class="row cal-nojs__rowTitle"><h4 class="col-md-12">Other</h4></div>
<div class="row"><div class="panel"><div class="panel-body"><div class="row">
<div class="col-xs-2"><p></p></div><div class="col-xs-7"><p>Holiday - Labor Day</p></div><div class="col-xs-3"><p>7</p></div></div></div></div></div>`;
const holiday = parseFederalReserveCalendarHtml(html, 2026, 8)[0];
assert.equal(holiday.type, 'holiday');
assert.equal(holiday.importance, 'low');
assert.equal(buildScenarioEngine({...options, calendar:{events:[holiday]}}).catalysts.length, 0);

const source = renderAppJs();
new vm.Script(source);
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
const context = vm.createContext({Date, Intl, scenarioState:{basket:'AAPL, MSFT'}});
for (const name of ['calDaysFromToday','calDaysFromEvent','calRelativeLabel','calendarTypeLabel','buildCalendarBriefing','scenarioBasketResult']) vm.runInContext(fn(name), context);
const today = Date.parse('2026-09-06T00:00:00Z');
assert.equal(context.calDaysFromToday('2026-09-10', today), 4);
assert.equal(context.calDaysFromToday('2026-09-03', today), -3);
const briefing = context.buildCalendarBriefing({events:[holiday]}, today);
assert.equal(briefing.first, null);
assert.equal(briefing.title, 'Holiday schedule tomorrow');
assert.doesNotMatch(briefing.guidance, /after the release/);
assert.match(context.scenarioBasketResult({sensitivities:[]}, {}), /unavailable/);
console.log('Context audit smoke passed: bake coverage, holidays, current countdowns, honest empty state.');
