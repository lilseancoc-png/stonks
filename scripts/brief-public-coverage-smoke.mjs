import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { BRIEF_TOOL_SOURCES, BRIEF_CORE_TABS, collectBriefSiteTools, gatherBriefSignals, briefUserMessage } from './build.mjs';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { isPremiumKey, PREMIUM_KEYS } from '../lib/premium-keys.mjs';
import { BRIEF_FIXTURE_NOW as now, briefPublicFixture } from './fixtures/brief-public.mjs';

const publicTabs = new Set(SITE_SECTIONS.filter((s) => !s.owner).flatMap((s) => s.items.map((x) => x.id)));
const ownerTabs = new Set(SITE_SECTIONS.filter((s) => s.owner).flatMap((s) => s.items.map((x) => x.id)));
const covered = new Set([...BRIEF_TOOL_SOURCES.map((s) => s.tab), ...BRIEF_CORE_TABS, 'narratives']);
const reference = new Set(['home', 'brief', 'cheatsheet', 'chart-patterns', 'timeline', 'privacy', 'terms']);
assert.deepEqual([...publicTabs].filter((tab) => !covered.has(tab) && !reference.has(tab)), [],
  'A new public evidence page must have Brief coverage or an explicit reference-only exemption');
for (const source of BRIEF_TOOL_SOURCES) {
  assert(!isPremiumKey(source.file), `${source.file} must be public`);
  assert(publicTabs.has(source.tab), `${source.label} must link to an existing public page`);
}
assert(BRIEF_CORE_TABS.every((tab) => publicTabs.has(tab)));
assert([...covered].every((tab) => !ownerTabs.has(tab)));

const dir = await mkdtemp(resolve(tmpdir(), 'brief-public-'));
try {
  const payloads = briefPublicFixture();
  for (const source of BRIEF_TOOL_SOURCES) await writeFile(resolve(dir, source.file), JSON.stringify(payloads[source.key]));
  // Seed private files next to public ones. Neither their fields nor their names
  // may leak through the scan, prompt, coverage list or rendered standouts.
  for (const key of PREMIUM_KEYS) if (!key.includes('/')) await writeFile(resolve(dir, key), JSON.stringify({
    marker: 'PRIVATE_BRIEF_SENTINEL', macroRegime: { state: 'risk-off', summary: 'PRIVATE_BRIEF_SENTINEL' },
    candidates: [{ symbol: 'PRIVATE_BRIEF_SENTINEL', clean: true }],
  }));
  const scan = await collectBriefSiteTools({ now, dataDir: dir, narratives: [] });
  assert.equal(scan.checked.length, BRIEF_TOOL_SOURCES.length + 1);
  assert.equal(scan.missing.length, 0);
  assert.equal(scan.total, scan.checked.length);
  assert(scan.facts.length <= 32 && scan.standouts.length <= 10);
  assert.equal(new Set(scan.facts.map((f) => f.source)).size, BRIEF_TOOL_SOURCES.length,
    'Every material public source reaches the prompt before repeat facts consume its cap');
  const textFor = (source) => scan.facts.filter((f) => f.source === source).map((f) => f.text).join('\n');
  assert.match(textFor('Streaks'), /6 green sessions across 8 sessions.*12\.0%.*1\.4x.*reclaimed 20-day average/);
  assert.match(textFor('Streaks'), /ended .*reversal/);
  assert.match(textFor('Pattern lab'), /next-10-session.*\+1\.2% vs \+0\.5% baseline.*n=45.*overlapping.*In-sample/);
  assert.match(textFor('Overnight markets'), /Saved pre-open.*2026-10-27T13:05:00Z.*opening gap/);
  assert.match(textFor('Overnight markets'), /no proven edge/);
  assert.match(textFor('SEC ownership'), /\$2\.0M open-market purchase dated 2026-10-26/);
  assert.match(textFor('SEC ownership'), /2026-06-30.*Delayed quarterly holdings/);
  assert.match(textFor('Capital raises'), /Authorization is not completed repurchases/);
  assert.match(textFor('RAM prices'), /wholesale DRAM spot prices moved \+20\.0%/);
  assert.match(textFor('RAM prices'), /retail RAM/);
  assert.match(textFor('AI CapEx'), /MSFT raised CY2026 CapEx guidance.*Management guidance, not reported spending/);
  assert.match(textFor('Earnings calls'), /hawkish.*analysts skeptical/);
  assert.match(textFor('Commodities'), /2026-10-27/);
  for (const kind of ['morning', 'intraday', 'afternoon']) {
    const signals = gatherBriefSignals(kind, { chains: {}, siteTools: scan,
      picks: { picks: [{ symbol: 'PRIVATE_BRIEF_SENTINEL' }] },
      forcedLiquidation: { summary: 'PRIVATE_BRIEF_SENTINEL' },
    });
    const prompt = briefUserMessage(kind, '2026-10-27', signals);
    assert.doesNotMatch(JSON.stringify(signals) + prompt, /PRIVATE_BRIEF_SENTINEL|NaN|undefined/);
    for (const fact of scan.facts) assert(prompt.includes(fact.text));
    for (const fact of scan.standouts) assert(publicTabs.has(fact.tab));
  }
  const rich = gatherBriefSignals('intraday', { chains: {}, ivTrending: { tickers: [{ symbol: 'RICH', iv: 0.5, mean: 0.4, pctile: 95, elevated: true, tier: null, chg5dPct: -2 }] } });
  assert.equal(rich.ivTrend[0].tier, 'rich');
  const richPrompt = briefUserMessage('intraday', '2026-10-27', rich);
  assert.match(richPrompt, /RICH.*rich premium, not a rising-trend signal/);
  assert.doesNotMatch(richPrompt, /unexplained ramp/);
  const overnight = gatherBriefSignals('morning', { now: new Date('2026-10-27T12:30:00Z'), correlations: {
    context: { priorUs: { date: '2026-10-26', closeMs: Date.parse('2026-10-26T20:00:00Z') } },
    markets: {
      'ES=F': { sym: 'ES=F', chPct: 0.5 },
      '^N225': { sym: '^N225', chPct: 8, asOf: '2026-10-26' },
      '^VIX': { sym: '^VIX', chPct: 9, quoteTimeIso: '2026-10-26T20:00:00Z' },
      '^VIX3M': { sym: '^VIX3M', chPct: 10 },
    },
  } });
  assert.deepEqual(overnight.overnight.map((m) => m.sym), ['ES=F'], 'closed foreign sessions and stale/context-only volatility levels stay out of the overnight movers');
  // Stale/invalid/future/explicitly missing inputs do not fall back to files.
  for (const stamp of ['bad-date', '2026-11-01T00:00:00Z', '2026-10-20T00:00:00Z']) {
    const out = await collectBriefSiteTools({ now, dataDir: dir, payloads: { streaks: { ...payloads.streaks, builtAtIso: stamp } } });
    assert(out.missing.includes('Streaks'));
    assert(!out.facts.some((f) => f.source === 'Streaks'));
    assert(out.missing.includes('Narratives'), 'unavailable themes must not be counted as checked');
  }
  const missing = await collectBriefSiteTools({ now, dataDir: dir, payloads: { streaks: null } });
  assert(missing.missing.includes('Streaks'));
  const sparse = await collectBriefSiteTools({ now, dataDir: resolve(dir, 'missing'), payloads: {
    ram: { ...payloads.ram, retail: { ...payloads.ram.retail, stale: true }, spot: { ...payloads.ram.spot, stale: true } },
    ownership: { ...payloads.ownership, insiderTransactions: { ...payloads.ownership.insiderTransactions, asOf: '2026-10-20T00:00:00Z' } },
    overnight: { ...payloads.overnight, preopen: { today: { ...payloads.overnight.preopen.today, date: '2026-10-26' } } },
    'pattern-lab': { builtAtIso: now.toISOString(), pieces: { divergences: { rows: [{ symbol: 'ACME', indicator: 'rsi', direction: 'bearish' }], record: { rsiBearish: { n: 12, avgPct: 99, baselineAvgPct: -0.5, provisional: true } } } } },
  } });
  assert(!sparse.facts.some((f) => f.source === 'RAM prices' || f.source === 'Overnight markets'));
  assert.doesNotMatch(JSON.stringify(sparse), /open-market purchase|99\.0%/);
  assert.match(JSON.stringify(sparse), /limited or unavailable/);
  console.log('brief public coverage: all public evidence pages mapped, real payload adapters reach all three fact sheets, Owner files excluded, freshness and sample limits passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
