// One-off data check over raw downloads (no store, no network): Yahoo chart
// JSON files and FRED CSVs saved in a folder, read the same way the collector
// reads them, then run the build's data checks and print the study counts.
//
// Usage: node scripts/audit-historical-quality.mjs --dir=<folder> [--json]
//   <folder>/yahoo/<SYMBOL with ^ as _>.json   v8 chart responses
//   <folder>/fred/<ID>.csv                     fredgraph.csv downloads
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HISTORICAL_MARKETS, HISTORICAL_EVENT_MARKETS, HISTORICAL_CONTEXT } from '../lib/historical-sources.mjs';
import { cleanHistoricalBars, cleanLongBars } from '../lib/historical-market-history.mjs';
import { buildHistoricalData } from '../lib/historical-data.mjs';
import { FOMC_DECISIONS } from '../lib/historical-events.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg('dir');
if (!dir) { console.error('Usage: node scripts/audit-historical-quality.mjs --dir=<folder> [--json]'); process.exit(2); }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;|&#8211;|\u2013/g, '-').replace(/\s+/g, ' ');
// Scheduled FOMC meetings from the Fed's historical pages ("March 21-22 Meeting",
// "January 31-February 1 Meeting"); conference calls and unscheduled meetings are
// skipped. The decision date is the meeting's last day.
function fomcFromHistorical(html, year) {
  const out = [], re = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*-\s*(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(\d{1,2}))?\s*(?:,\s*\d{4}\s*)?(Meeting|Conference Call|\(unscheduled\))/gi;
  for (const m of text(html).matchAll(re)) {
    if (!/^meeting$/i.test(m[5])) continue;
    const month = MONTHS.indexOf((m[3] || m[1]).toLowerCase()) + 1, day = Number(m[4] || m[2]);
    const tail = text(html).slice(m.index, m.index + 120);
    if (/unscheduled/i.test(tail.slice(0, 60))) continue;
    out.push(iso(year, month, day));
  }
  return [...new Set(out)].sort();
}
// fomccalendars.htm: per-year panels with month + "26-27" / "31-1" day cells.
function fomcFromCalendars(html) {
  const out = [], t = text(html);
  for (const block of t.split(/(?=\b(20\d\d) FOMC Meetings\b)/)) {
    const y = Number(block.match(/^(20\d\d) FOMC Meetings/)?.[1]);
    if (!y) continue;
    const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December)(?:\/(January|February|March|April|May|June|July|August|September|October|November|December))?\s+(\d{1,2})\s*-\s*(\d{1,2})(\*?)/g;
    for (const m of block.matchAll(re)) out.push(iso(y, MONTHS.indexOf((m[2] || m[1]).toLowerCase()) + 1, Number(m[4])));
  }
  return [...new Set(out)].sort();
}
async function fedFomc() {
  const files = new Set(await readdir(resolve(dir, 'fed')).catch(() => []));
  const byYear = {};
  for (let y = 1994; y <= 2020; y++) {
    if (!files.has(`fomchistorical${y}.htm`)) continue;
    byYear[y] = fomcFromHistorical(await readFile(resolve(dir, 'fed', `fomchistorical${y}.htm`), 'utf8'), y);
  }
  if (files.has('fomccalendars.htm')) for (const d of fomcFromCalendars(await readFile(resolve(dir, 'fed', 'fomccalendars.htm'), 'utf8'))) (byYear[d.slice(0, 4)] ||= []).push(d);
  const fed = Object.values(byYear).flat().sort(), ours = new Set(FOMC_DECISIONS), theirs = new Set(fed);
  const lo = fed[0], hi = fed.at(-1);
  return {
    perYear: Object.fromEntries(Object.entries(byYear).map(([y, d]) => [y, d.length])),
    missingFromOurs: fed.filter(d => !ours.has(d)),
    notOnFedPages: FOMC_DECISIONS.filter(d => d >= lo && d <= hi && !theirs.has(d)),
    all: fed,
  };
}

// Same date label as loadFreeMarketHistory: the bar's timestamp as a UTC day.
function yahooChartRows(json) {
  const r = json?.chart?.result?.[0], ts = r?.timestamp || [], close = r?.indicators?.quote?.[0]?.close || [];
  return ts.map((t, i) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), v: close[i] })).filter(x => x.v != null);
}
const cutoff = arg('cutoff') || new Date().toISOString().slice(0, 10);
const symbols = {}, records = {}, context = {};
for (const def of [...HISTORICAL_MARKETS, ...HISTORICAL_EVENT_MARKETS]) {
  try {
    const raw = yahooChartRows(JSON.parse(await readFile(resolve(dir, 'yahoo', def.id.replace('^', '_') + '.json'), 'utf8')));
    const rows = (def.long ? cleanLongBars : cleanHistoricalBars)(raw.filter(r => r.t >= (def.since || '1990-01-01')), cutoff);
    const kept = new Set(rows.map(r => r.t));
    const off = [...new Set(raw.map(r => r.t).filter(t => t >= '1990-01-01' && t <= cutoff && !kept.has(t)))].sort();
    symbols[def.id] = rows;
    records[def.id] = { collectedAtIso: `${cutoff}T23:00:00Z`, confirmedThrough: rows.at(-1)?.t, offCalendarRows: off.length, offCalendarSample: off.slice(-5) };
  } catch (e) { records[def.id] = { error: e.message }; }
}
const { parseFredHistoryCsv } = await import('./collect-historical-sources.mjs').catch(() => ({}));
const fredFiles = new Set(await readdir(resolve(dir, 'fred')).catch(() => []));
for (const def of HISTORICAL_CONTEXT) {
  if (!fredFiles.has(def.id + '.csv') || !parseFredHistoryCsv) continue;
  try { context[def.id] = { rows: parseFredHistoryCsv(await readFile(resolve(dir, 'fred', def.id + '.csv'), 'utf8'), def.id) }; } catch (e) { records[def.id] = { error: e.message }; }
}
const data = buildHistoricalData({ sourceCache: { version: 2, symbols, records, context, releases: {} }, builtAtIso: `${cutoff}T23:00:00Z`, inputs: { headlineHits: {}, squeezes: [] } });
const years = (sym, id) => data.indexes[sym]?.studies.find(s => s.id === id)?.ranges.all.years.map(e => e.year) || [];
const studies = Object.fromEntries(Object.keys(data.indexes).map(sym => [sym, Object.fromEntries(data.indexes[sym].studies.map(s => [s.id, { n: s.ranges.all.n, first: s.ranges.all.years[0]?.year ?? null, meanPct: s.ranges.all.meanPct, medianPct: s.ranges.all.medianPct, positivePct: s.ranges.all.positivePct }]))]));
// Checks for the Brief's historical playbook figures.
async function rawBars(sym) {
  const r = JSON.parse(await readFile(resolve(dir, 'yahoo', sym.replace('^', '_') + '.json'), 'utf8'))?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0] || {};
  return (r?.timestamp || []).map((t, i) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), c: q.close?.[i], l: q.low?.[i] })).filter(b => b.c != null);
}
async function playbook() {
  const out = {};
  const santa = data.indexes['^GSPC']?.studies.find(s => s.id === 'santa')?.ranges;
  if (santa) out.santaGspc = Object.fromEntries(Object.entries(santa).map(([k, r]) => [k, { n: r.n, meanPct: r.meanPct, medianPct: r.medianPct, positivePct: r.positivePct }]));
  try {
    const ix = await rawBars('^IXIC'), rows = [];
    for (let i = 1; i < ix.length - 5; i++) {
      const ch = ix[i].c / ix[i - 1].c - 1;
      if (ch > -0.04) continue;
      const crashLow = ix[i].l ?? ix[i].c, next = ix.slice(i + 1, i + 6);
      const lowTest = next.some(b => (b.l ?? b.c) <= crashLow), closeTest = next.some(b => b.c <= ix[i].c);
      rows.push({ t: ix[i].t, lowTest, closeTest, lows: ix[i].l != null && next.every(b => b.l != null) });
    }
    const withLows = rows.filter(r => r.lows);
    out.nasdaq4 = { n: rows.length, since: rows[0]?.t, lowTestedPct: withLows.length ? +(100 * withLows.filter(r => r.lowTest).length / withLows.length).toFixed(1) : null, lowN: withLows.length, closeTestedPct: rows.length ? +(100 * rows.filter(r => r.closeTest).length / rows.length).toFixed(1) : null };
  } catch (e) { out.nasdaq4 = { error: e.message }; }
  try {
    const g = await rawBars('^GSPC'), pre = g.find(b => b.t === '1987-10-16'), peak = g.filter(b => b.t >= '1987-01-01' && b.t <= '1987-10-16').reduce((a, b) => b.c > a.c ? b : a);
    out.crash1987 = { preCrashClose: pre?.c, regainedPreCrash: g.find(b => b.t > '1987-10-19' && b.c >= pre.c)?.t, peak: peak.t, peakClose: peak.c, regainedPeak: g.find(b => b.t > '1987-10-19' && b.c >= peak.c)?.t };
  } catch (e) { out.crash1987 = { error: e.message }; }
  return out;
}
const out = { cutoff, quality: data.quality, midterm: { '^GSPC': years('^GSPC', 'midterm'), SPY: years('SPY', 'midterm') }, studies, events: Object.fromEntries(Object.entries(data.events.studies).map(([k, s]) => [k, s.summary?.n ?? s.all?.n ?? s.rows?.length ?? null])) };
out.playbook = await playbook();
out.fomc = await fedFomc();
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`Data checks: ${data.quality.summary.pass} pass, ${data.quality.summary.warn} watch, ${data.quality.summary.fail} fail`);
  for (const c of data.quality.checks) if (c.status !== 'pass') console.log(`  [${c.status}] ${c.title}: ${c.detail}`);
  console.log(`S&P 500 midterm years (${out.midterm['^GSPC'].length}): ${out.midterm['^GSPC'].join(', ')}`);
  console.log(`SPY midterm years (${out.midterm.SPY.length}): ${out.midterm.SPY.join(', ')}`);
  console.log('Playbook:', JSON.stringify(out.playbook));
  console.log('FOMC per year:', JSON.stringify(out.fomc.perYear));
  console.log('FOMC on Fed pages but not ours:', out.fomc.missingFromOurs.join(' '));
  console.log('FOMC ours but not on Fed pages:', out.fomc.notOnFedPages.join(' '));
}
