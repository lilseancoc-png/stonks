import { siteCatalog } from './site-catalog/site-catalog.mjs';
import { SOURCE_KEYS } from './site-catalog/feature-sources.mjs';
// Every page has a data contract or an explicit explanation of its runtime.
const extra = {
  home:'manifest.json', tickers:'manifest.json', stock:'manifest.json', compare:'manifest.json', strategies:'grades.json',
  'open-picks':'picks-open.json', track:'picks-accuracy.json', 'earnings-week':'earnings-week.json',
};
const fields = {
  'manifest.json':['_meta:object'], 'owner-market-brief.json':['coverage:array'],
  'unified-signal.json':['decisions:array'], 'grades.json':['grades:object'],
  'calendar.json':['events:array','coverage:object'], 'heatmap.json':['tickers:collection'],
  'party-tracker.json':['offices:collection','coverage:array'], 'earnings-forecast.json':['companies:array'],
  'historical-data.json':['indexes:collection'], 'earnings-tracker.json':['seasons:collection'],
  'oi-tracker.json':['tickers:array','summary:object'], 'unusual.json':['tickers:array','summary:object'],
  'picks-open.json':['open:array'], 'earnings-week.json':['rows:array'], 'picks-accuracy.json':['open:array','closed:array'],
  'quant.json':['sigma:object','vrp:object'], 'briefs.json':['current:object'],
  'market-map.json':['rows:array','breadth:object'], 'site-changes.json':['items:array'], 'market-days.json':['dates:array','moves:object'],
  'crowd.json':['sources:array','rollup:array'], 'history-rhymes.json':['now:object','cases:array'],
};
const weekly = new Set(['search-interest','ram-prices','accelerator-prices']);
const swing = new Set(['picks','open-picks','track','leaps','stocks','rotation','levetf','unified-signal-engine']);
const context = new Set(['historical-data','party-tracker','earnings-forecast']);
const nonOutput = Object.freeze({cheatsheet:'reference','chart-patterns':'reference',timeline:'reference',privacy:'reference',terms:'reference',glossary:'reference',contact:'on-demand','update-checker':'monitor','owner-settings':'on-demand','sports-nba':'on-demand','sports-nfl':'on-demand','sports-pick-builder':'on-demand'});
export function describeUpdateFeature(page){
  const key=SOURCE_KEYS[page.id] || extra[page.id] || null;
  const mode=key?'output':nonOutput[page.id];
  if(!mode)throw new Error('Update Checker needs an explicit source or non-output policy for '+page.id);
  return Object.freeze({id:page.id,label:page.label,key,fields:fields[key] || [],
    maxHours:weekly.has(page.id)?240:context.has(page.id)?192:96,
    cadence:weekly.has(page.id)?'weekly':swing.has(page.id)?'swing':['flow','volume','heatmap','oi'].includes(page.id)?'scanner':'full',
    mode,
  });
}
export const UPDATE_FEATURES = Object.freeze(siteCatalog.map(describeUpdateFeature));
