import { siteCatalog } from './research-lab/site-catalog.mjs';
import { SOURCE_KEYS } from './research-lab/feature-sources.mjs';
// Every page has a data contract or an explicit explanation of its runtime.
const extra = {
  home:'manifest.json', tickers:'manifest.json', compare:'manifest.json', strategies:'grades.json',
  'open-picks':'picks-open.json', track:'picks-accuracy.json',
};
const fields = {
  'manifest.json':['symbols:array'], 'owner-market-brief.json':['coverage:array'],
  'unified-signal.json':['decisions:array'], 'grades.json':['grades:object'],
  'calendar.json':['events:array','coverage:object'], 'heatmap.json':['tickers:collection'],
  'party-tracker.json':['offices:collection','coverage:array'], 'earnings-forecast.json':['companies:array'],
  'historical-data.json':['indexes:collection'], 'earnings-tracker.json':['seasons:collection'],
  'oi-tracker.json':['tickers:array','summary:object'], 'unusual.json':['tickers:array','summary:object'],
  'picks-open.json':['open:array'], 'picks-accuracy.json':['open:array','closed:array'],
  'quant.json':['sigma:object','vrp:object'], 'briefs.json':['current:object'],
};
const weekly = new Set(['search-interest','ram-prices','accelerator-prices']);
const swing = new Set(['picks','leaps','stocks','rotation','levetf','unified-signal-engine']);
const context = new Set(['historical-data','party-tracker','earnings-forecast']);
export const UPDATE_FEATURES = Object.freeze(siteCatalog.map(page=>{
  const key=SOURCE_KEYS[page.id] || extra[page.id] || null;
  return Object.freeze({id:page.id,label:page.label,key,fields:fields[key] || [],
    maxHours:weekly.has(page.id)?240:context.has(page.id)?192:96,
    cadence:weekly.has(page.id)?'weekly':swing.has(page.id)?'swing':['flow','volume','heatmap','oi'].includes(page.id)?'scanner':'full',
    mode:key?'output':page.id==='research-lab'?'on-demand':page.id==='update-checker'?'monitor':'reference',
  });
}));
