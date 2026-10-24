import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { riskStack } from '../lib/risk-stack.mjs';
import { renderAppJs } from './render/app-js.mjs';
import { renderHtml } from './render/html.mjs';
import { renderStylesCss } from './render/styles-css.mjs';

function desk(partial) {
  return Object.assign({
    id: 'heatmap', name: 'Heatmap', tab: 'heatmap', layer: 'session', status: 'ready',
    stance: 0, strength: 'full', structure: null, label: 'Mixed tape', why: 'Breadth is mixed.',
    horizon: 'Today', measures: 'A measure.',
  }, partial);
}

const neutralBoard = [
  desk({ id: 'market', name: 'Market analysis', tab: 'market', layer: 'backdrop', label: 'Neutral', why: 'No coordinated driver.' }),
  desk({ id: 'index-cal', name: 'Index calendar', tab: 'index-cal', layer: 'backdrop', label: 'Mixed', why: '3 of 6 sleeves are positive.' }),
  desk({ id: 'fear-greed', name: 'Fear & Greed', tab: 'fear-greed', layer: 'backdrop', label: 'Neutral', why: 'Composite 50.' }),
  desk({ id: 'heatmap', name: 'Heatmap', layer: 'session', label: 'Mixed tape', why: '51% of names are up.' }),
  desk({ id: 'volume', name: 'Volume', tab: 'volume', layer: 'session', label: 'Mixed', why: 'Sectors are split.' }),
  desk({ id: 'overnight', name: 'Overnight markets', tab: 'overnight', layer: 'session', label: 'No clean edge', why: 'Overnight score 0.' }),
  desk({ id: 'gamma', name: 'Gamma exposure', tab: 'oi', layer: 'structure', label: 'Pinned', structure: 'dampen', why: 'SPY gamma is positive.' }),
];

let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }

check('a severe regime against a neutral tape explains the gap instead of averaging it', () => {
  const desks = neutralBoard.map((d) => d.id === 'market'
    ? Object.assign({}, d, { stance: -2, label: 'Severe risk-off', why: 'Driving it: VIX, dollar, yields.' })
    : d);
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'defensive-unconfirmed');
  assert.match(view.headline, /backdrop is severe/i);
  assert.match(view.headline, /has not confirmed/);
  assert.ok(view.splits.some((s) => /heatmap/i.test(s.lead) && /dollar|yields|Fed/.test(s.mechanism)));
  assert.match(view.picture.join(' '), /not an all-clear/i);
  assert.match(view.picture.join(' '), /dampen/i);
  const html = riskStack.present(desks);
  assert.match(html, /Why the labels disagree/);
  assert.match(html, /Severe risk-off/);
  assert.match(html, /data-risk-go="heatmap"/);
  assert.match(html, /data-risk-go="market"/);
});

check('extreme fear with a calm tape is a sentiment watch, not a crash call', () => {
  const desks = neutralBoard.map((d) => d.id === 'fear-greed'
    ? Object.assign({}, d, { stance: -2, label: 'Extreme Fear', why: 'Composite 18.' })
    : d);
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'sentiment-ahead');
  assert.match(view.headline, /Sentiment is extreme/);
  assert.match(view.picture.join(' '), /not a buy and not a crash call/);
});

check('agreement on defense does not invent a disagreement', () => {
  const desks = neutralBoard.map((d) => Object.assign({}, d, {
    stance: d.id === 'market' ? -2 : -1,
    label: d.id === 'market' ? 'Severe risk-off' : 'Risk-off',
    structure: d.id === 'gamma' ? 'amplify' : null,
  }));
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'aligned-defensive');
  assert.equal(view.splits.length, 0);
  assert.match(view.picture.join(' '), /difference is degree/);
  assert.doesNotMatch(riskStack.present(desks), /Why the labels disagree/);
});

check('a split headline names the camps instead of one arbitrary neutral desk', () => {
  const desks = neutralBoard.map((d) => (d.id === 'market' || d.id === 'fear-greed')
    ? Object.assign({}, d, { stance: -2, label: d.id === 'market' ? 'Severe risk-off' : 'Extreme Fear' })
    : d.id === 'volume'
      ? Object.assign({}, d, { stance: -1, label: 'Leaning bearish' })
      : d);
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'split');
  assert.match(view.headline, /Market analysis and Fear & Greed are severe/);
  assert.match(view.headline, /Heatmap/);
  assert.doesNotMatch(view.headline, /while Index calendar/);
  assert.doesNotMatch(view.headline, /Gamma exposure/);
  const html = riskStack.present(desks);
  assert.match(html, /more disagreement/);
  assert.match(html, /aria-label="Heatmap, Mixed tape/);
});

check('extreme greed without a confirming tape stays a crowded-sentiment warning', () => {
  const desks = neutralBoard.map((d) => d.id === 'fear-greed'
    ? Object.assign({}, d, { stance: 2, label: 'Extreme Greed', why: 'Composite 82.' })
    : d);
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'sentiment-hot');
  assert.match(view.headline, /extremely greedy/);
  assert.match(view.picture.join(' '), /not permission to chase/);
});

check('positive gamma dampens and does not cast a directional vote', () => {
  const pinned = riskStack.gammaRead({ posGamma: true, dir: 'bull', volTier: 1, dirLabel: 'Upward pull' });
  assert.equal(pinned.stance, 0);
  assert.equal(pinned.structure, 'dampen');
  assert.equal(pinned.label, 'Dampening');
  const crash = riskStack.gammaRead({ posGamma: false, dir: 'bear', volTier: 3 });
  assert.equal(crash.stance, -2);
  assert.equal(crash.structure, 'amplify');
  const chase = riskStack.gammaRead({ posGamma: false, dir: 'volatile', volTier: 2 });
  assert.equal(chase.stance, 0);
});

check('a defensive session inside a calm backdrop stays a split', () => {
  const desks = neutralBoard.map((d) => {
    if (d.layer === 'session') return Object.assign({}, d, { stance: -1, label: 'Risk-off' });
    if (d.id === 'gamma') return Object.assign({}, d, { stance: 1, label: 'Upward pull', structure: 'dampen' });
    return d;
  });
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'split');
  assert.ok(view.splits.length);
});

check('stale and missing desks do not vote', () => {
  const desks = [
    desk({ id: 'market', name: 'Market analysis', layer: 'backdrop', stance: -2, status: 'stale', label: 'Severe risk-off' }),
    desk({ id: 'heatmap', stance: 0, label: 'Mixed tape' }),
    desk({ id: 'volume', name: 'Volume', tab: 'volume', stance: null, status: 'loading', label: 'Loading' }),
    desk({ id: 'overnight', name: 'Overnight markets', tab: 'overnight', stance: 0, label: 'No clean edge' }),
  ];
  const view = riskStack.assess(desks);
  assert.equal(view.position, 'thin');
  assert.match(view.headline, /Not enough current desks/);
  assert.match(view.coverage, /reference only/);
  assert.equal(view.splits.length, 0);
});

check('desk evidence is escaped', () => {
  const html = riskStack.present([
    desk({ id: 'market', name: 'Market analysis', layer: 'backdrop', stance: -2, label: '<Severe>', why: '<script>alert(1)</script>' }),
    desk({ stance: 0 }),
    desk({ id: 'volume', name: 'Volume', tab: 'volume', stance: 0, label: 'Mixed' }),
  ]);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;Severe&gt;/);
});

check('empty input does not throw', () => {
  const view = riskStack.assess(null);
  assert.equal(view.position, 'thin');
  assert.equal(riskStack.present(undefined).includes('Market position'), true);
});

const html = renderHtml({
  symbols: [],
  builtAt: 'test',
  builtAtIso: '2026-10-23T00:00:00.000Z',
  renderedAtIso: '2026-10-23T00:01:00.000Z',
  assetVersions: { styles: 'sha256-styles', app: 'sha256-app', streaks: 'sha256-streaks' },
});
assert.match(html, /id="risk-stack"/);
assert.match(html, /data-page-tab="risk"/);
assert.match(html, /Risk analysis/);
const css = renderStylesCss();
assert.match(css, /\.risk-stack \{/);
assert.match(css, /\.risk-position-warn \{/);
const app = renderAppJs({ riskFreeRate: 0.04 });
assert.match(app, /function renderRiskStack\(/);
assert.match(app, /function riskHeatmapDesk\(/);
assert.match(app, /id: 'gamma'/);
const dir = await mkdtemp(resolve(tmpdir(), 'stonks-risk-stack-'));
try {
  const file = resolve(dir, 'app.js');
  await writeFile(file, app);
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
} finally {
  await rm(dir, { recursive: true, force: true });
}
checks++;
console.log('PASS generated shell, script, and stylesheet include the market-position read');

console.log(checks + ' risk-stack checks passed');
