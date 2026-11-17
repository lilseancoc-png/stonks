// Browser check for the engine history on the site (2026-11-17): Pattern
// lab's "Strategy styles by era" (public), the strips on Booms & busts case
// studies (public) and on Historical Data's events view (Owner), today's
// regime fit in the Regime Lab (Owner) and in the Owner brief, at 1440 light
// and 390 dark, with no page errors, raw values or sideways scroll; the off
// stub and a missing file hide every block. Synthetic data only; nothing here
// contacts a provider or the store.
// Run: node scripts/engines-history-browser.mjs   (after the app.js render)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { enginesHistoryFixture, ENGINES_HISTORY_FIXTURE_TIME } from './fixtures/engines-history.mjs';
import { ENGINES_HISTORY_KEY, CASE_ERAS } from '../lib/engines-history.mjs';
import { patternLabFixture } from './fixtures/pattern-lab.mjs';
import { historyRhymesFixture } from './fixtures/history-rhymes.mjs';
import { regimeLabFixture } from './regime-lab-smoke.mjs';
import { REGIME_LAB_KEY } from '../lib/regime-lab/payload.mjs';
import { buildHistoricalData, packHistoricalData } from '../lib/historical-data.mjs';
import { historicalFixtureBars, historicalEventFixture } from './fixtures/historical-data.mjs';
import { buildHistoricalEvents } from '../lib/historical-events.mjs';
import { buildOwnerMarketBrief, OWNER_BRIEF_KEY } from '../lib/owner-market-brief.mjs';
import { ownerBriefFixture } from './fixtures/owner-market-brief.mjs';

const output = process.env.ENGINES_HISTORY_BROWSER_OUT || resolve(tmpdir(), 'stonks-engines-history-browser');
await mkdir(output, { recursive: true });

const eh = enginesHistoryFixture();
const pattern = patternLabFixture();
const rhymes = historyRhymesFixture().rhymes;
const regime = regimeLabFixture().payload;
const bars = historicalFixtureBars();
const hist = buildHistoricalData({ symbols: Object.fromEntries(['SPY', 'QQQ', 'IWM', 'SHY'].map((s) => [s, bars])), sourceCache: {}, builtAtIso: '2026-10-24T22:00:00Z', sourceBuiltAtIso: null });
hist.events = buildHistoricalEvents({ ...historicalEventFixture(), cutoff: hist.cutoff });
const histWire = packHistoricalData(hist);
const briefIn = ownerBriefFixture();
briefIn.payloads[ENGINES_HISTORY_KEY] = { ...eh, builtAtIso: briefIn.builtAtIso, asOf: briefIn.builtAtIso };
const brief = buildOwnerMarketBrief(briefIn);

let owner = false, ehMode = 'on';
const server = await startSiteServer({
  owner: () => owner,
  data: (key) => {
    if (key === ENGINES_HISTORY_KEY) return ehMode === 'on' ? eh : ehMode === 'off' ? { version: 1, builtAtIso: ENGINES_HISTORY_FIXTURE_TIME, enabled: false } : null;
    if (key === 'pattern-recognition.json') return pattern;
    if (key === 'history-rhymes.json') return rhymes;
    if (key === REGIME_LAB_KEY) return owner ? regime : null;
    if (key === 'historical-data.json') return owner ? histWire : null;
    if (key === OWNER_BRIEF_KEY) return owner ? brief : null;
    return null;
  },
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const ADVICE_RE = /\b(we recommend|you should (buy|sell)|buy now|sell now|strong buy|strong sell)\b/i;
const VIEWS = [{ width: 1440, height: 1000, theme: 'light' }, { width: 390, height: 900, theme: 'dark' }];
const shot = (s, name, v) => s.page.screenshot({ path: resolve(output, name + '-' + v.width + '-' + v.theme + '.png'), fullPage: true });
async function clean(s, label) {
  const problems = await pageProblems(s);
  check(problems.length === 0, label + ': ' + problems.join(' | '));
}

try {
  await selfTest(browser, server.base);

  for (const v of VIEWS) {
    const tag = v.width + ' ' + v.theme;
    // Pattern lab (public): styles by era.
    owner = false; ehMode = 'on';
    {
      const askedBefore = server.asks.data.length;
      const s = await openTab(browser, server.base, { tab: 'pattern-lab', ...v });
      const card = s.page.locator('#pattern-lab-root .eh-card');
      await card.waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      check((await card.locator('.eh-total').count()) === 6, tag + ': six style totals');
      check((await card.locator('tbody tr').count()) === eh.results.eras.length, tag + ': one row per era');
      const text = await card.innerText();
      check(/Strategy styles by era/.test(text) && /Dip buying/.test(text) && /2008 financial crisis/.test(text), tag + ': titles, styles and eras named');
      check(/Nothing here beat simply holding the S&P 500/.test(text), tag + ': says nothing beat buy-and-hold');
      check(!/Reversion|\bREV\b/.test(text), tag + ': public card uses style names, not engine names');
      check(!ADVICE_RE.test(text), tag + ': no advice wording');
      await clean(s, 'pattern lab ' + tag);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: resolve(output, 'pattern-lab-card-' + v.width + '-' + v.theme + '.png') });
      check(!server.asks.data.slice(askedBefore).some((k) => /owner|engines\.json|engines-record/.test(k)), tag + ': public visit asks for no Owner file');
      await s.context.close();
    }
    // Booms & busts (public): strips on the telecom, housing and AI cases; none on railroads.
    for (const [view, eras] of [['telecom', CASE_ERAS['rhymes:telecom']], ['housing', CASE_ERAS['rhymes:housing']], ['ai', CASE_ERAS['rhymes:ai-buildout']], ['railroads', []]]) {
      const s = await openTab(browser, server.base, { tab: 'history-rhymes', extra: '&view=' + view, ...v });
      await s.page.locator('#history-rhymes-root .hr-case').waitFor({ timeout: 15000 });
      await settle(s.page, 700);
      const strip = s.page.locator('#history-rhymes-root .eh-strip');
      if (eras.length) {
        await strip.waitFor({ timeout: 10000 });
        check((await strip.locator('.eh-era').count()) === eras.length, tag + ' ' + view + ': one card per era');
        const text = await strip.innerText();
        for (const e of eras) check(text.includes(e), tag + ' ' + view + ': ' + e);
        check((await strip.locator('.eh-era').first().locator('li').count()) === 6, tag + ' ' + view + ': six styles per era');
        if (view === 'telecom') { await strip.scrollIntoViewIfNeeded(); await strip.screenshot({ path: resolve(output, 'rhymes-telecom-strip-' + v.width + '-' + v.theme + '.png') }); }
      } else {
        check((await strip.count()) === 0, tag + ' railroads: no strip (no era in the test)');
      }
      await clean(s, 'booms & busts ' + view + ' ' + tag);
      await s.context.close();
    }

    // Owner: Regime Lab, today's regime fit.
    owner = true;
    {
      const s = await openTab(browser, server.base, { tab: 'quant', ...v });
      await s.page.locator('#owner-tab-regime').waitFor({ state: 'visible', timeout: 15000 });
      await s.page.locator('#owner-tab-regime').click();
      const fit = s.page.locator('#rgl-today .eh-fit');
      await fit.waitFor({ timeout: 15000 });
      await settle(s.page, 500);
      const text = await fit.innerText();
      check(/Today's regime fit/.test(text) && /Context, not a vote/i.test(text), tag + ': fit title and context label');
      check((await fit.locator('.eh-cellchip').count()) === 5, tag + ': five state chips');
      check((await fit.locator('tbody tr').count()) === 6, tag + ': six engines');
      check(/Reversion/.test(text) && /up\/normal/.test(text), tag + ': engine names and the cell');
      await clean(s, 'regime lab ' + tag);
      await fit.scrollIntoViewIfNeeded();
      await fit.screenshot({ path: resolve(output, 'regime-fit-' + v.width + '-' + v.theme + '.png') });
      await s.context.close();
    }
    // Owner: Historical Data events, the selected event's eras and the five crises.
    {
      const s = await openTab(browser, server.base, { tab: 'historical-data', now: '2026-10-24T22:30:00Z', ...v });
      const root = s.page.locator('#historical-data-root');
      await root.locator('[data-history-view="events"]').waitFor({ timeout: 15000 });
      await root.locator('[data-history-view="events"]').click();
      await root.locator('.h-library').waitFor({ timeout: 10000 });
      await root.locator('.h-library [data-history-event="oil"]').click();
      await settle(s.page, 700);
      const strips = root.locator('.eh-strip');
      check((await strips.count()) === 2, tag + ': event strip and crises strip');
      const t1 = await strips.nth(0).innerText(), t2 = await strips.nth(1).innerText();
      check(/1973-74 oil shock bear/.test(t1) && /1979-80/.test(t1), tag + ': oil event shows the two oil eras');
      for (const e of CASE_ERAS.crises) check(t2.includes(e), tag + ': crises strip has ' + e);
      await clean(s, 'historical data ' + tag);
      await strips.nth(1).scrollIntoViewIfNeeded();
      await shot(s, 'historical-events', v);
      await s.context.close();
    }
    // Owner brief: the regime fit finding.
    {
      const s = await openTab(browser, server.base, { tab: 'owner-market-brief', now: briefIn.builtAtIso, ...v });
      const root = s.page.locator('#owner-market-brief-root');
      await root.locator('.omb-idea, .omb-finding, section').first().waitFor({ timeout: 15000 });
      await settle(s.page, 700);
      check(/Today's regime fit/.test(await root.innerText()), tag + ': Owner brief shows the regime fit');
      await clean(s, 'owner brief ' + tag);
      await s.context.close();
    }
  }

  // Off and missing: every block hides, nothing breaks.
  for (const mode of ['off', 'missing']) {
    ehMode = mode; owner = false;
    const s = await openTab(browser, server.base, { tab: 'pattern-lab', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#pattern-lab-root [data-pat-study]').waitFor({ timeout: 15000 });
    await settle(s.page, 900);
    check((await s.page.locator('.eh-card').count()) === 0, mode + ': no card');
    check(await s.page.locator('#pattern-lab-root [data-eh]').evaluateAll((els) => els.every((e) => e.hidden)), mode + ': placeholder stays hidden');
    await clean(s, 'pattern lab ' + mode);
    await s.context.close();
    const r = await openTab(browser, server.base, { tab: 'history-rhymes', extra: '&view=telecom', width: 390, height: 900, theme: 'dark' });
    await r.page.locator('#history-rhymes-root .hr-case').waitFor({ timeout: 15000 });
    await settle(r.page, 900);
    check((await r.page.locator('.eh-strip').count()) === 0, mode + ': no strip on Booms & busts');
    await clean(r, 'booms & busts ' + mode);
    await r.context.close();
  }
  console.log(`engines-history browser: ${checks} checks passed; screenshots in ${output}`);
} finally {
  await browser.close();
  await server.close();
}
