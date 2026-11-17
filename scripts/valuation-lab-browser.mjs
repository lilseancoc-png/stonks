// Browser check for the Owner Valuation lab page (2026-11-17): the page
// renders the synthetic valuation file at 1440 light and 390 dark with no page
// errors, raw values or sideways scroll; moving an input or a weight updates
// the value; a scenario button and Reset work; picking another stock works;
// a missing file degrades to one hint; a public visitor never sees the page
// and never asks for the file. Round 2: eight methods, the environments
// (a policy scenario marks its inputs), the range of outcomes and the story
// section with the usual-surprise button. Synthetic data only (the smoke fixture).
// Run: node scripts/valuation-lab-browser.mjs (after the render output is current)
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { valuationPayload } from './valuation-lab-smoke.mjs';
import { VALUATION_LAB_KEY } from '../lib/valuation-lab.mjs';

const output = process.env.VALUATION_LAB_BROWSER_OUT || resolve(tmpdir(), 'stonks-valuation-lab-browser');
await mkdir(output, { recursive: true });
const payload = valuationPayload();
let owner = true, haveFile = true;
const server = await startSiteServer({ owner: () => owner, data: (key) => (key === VALUATION_LAB_KEY ? (haveFile ? payload : null) : null) });
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const JUNK = /undefined|NaN|\[object Object\]|Infinity/;
const modeled = async (page) => (await page.locator('#vl-out .mm-kpi').nth(1).locator('b').innerText()).split('\n')[0];

try {
  await selfTest(browser, server.base);
  for (const vp of [{ width: 1440, height: 1000, theme: 'light', name: 'owner-1440-light' }, { width: 390, height: 844, theme: 'dark', name: 'owner-390-dark' }]) {
    const s = await openTab(browser, server.base, { tab: 'valuation-lab', extra: '&symbol=MEGA', ...vp });
    await s.page.locator('#vl-out .vl-kpis').waitFor({ timeout: 15000 });
    await settle(s.page, 500);
    const text = await s.page.locator('#page-pane-valuation-lab').innerText();
    check(/What is it worth/.test(text) && /Market price/.test(text) && /Modeled value/.test(text), vp.name + ': page intro and the headline numbers');
    check(/What today.s price assumes/.test(text) && /What the market may be seeing/.test(text) && /What the model may be missing/.test(text), vp.name + ': the gap read');
    check(!JUNK.test(text), vp.name + ': no raw values');
    check((await s.page.locator('[data-page-tab="valuation-lab"]').count()) === 1, vp.name + ': sidebar entry');
    check((await s.page.locator('#vl-out .vl-table tbody tr').count()) === 8, vp.name + ': one row per method');
    check((await s.page.locator('#vl-out svg.vl-field circle').count()) === 8, vp.name + ': football field has a dot per method');
    check((await s.page.locator('#vl-out svg.vl-field rect.vl-opt').count()) === 1, vp.name + ': options range on the football field');
    check(/The story: then vs now/.test(text) && /Five views of the same company/.test(text) && /Then vs now/.test(text) && /The analysts. record/.test(text), vp.name + ': story section');
    check(/What the analysts may be missing/.test(text) && /What our model may be missing/.test(text), vp.name + ': the two missing lists');
    check(/Range of outcomes/.test(text) && /Worth more than the price/.test(text) && (await s.page.locator('#vl-out svg.vl-hist rect').count()) > 5, vp.name + ': range of outcomes');
    check((await s.page.locator('#vl-out .vl-grid-t tbody tr').count()) === 5, vp.name + ': rate x growth grid');
    check((await s.page.locator('#vl-inputs [data-vl-input]').count()) >= 24, vp.name + ': every input has a slider');
    check(/Mega Platforms/.test(await s.page.locator('[data-vl-sym]').inputValue().then(() => s.page.locator('[data-vl-sym] option:checked').innerText())), vp.name + ': ?symbol= picks the stock');
    let problems = await pageProblems(s);
    check(problems.length === 0, vp.name + ': ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, `${vp.name}.png`), fullPage: true });
    if (vp.width > 1000) await s.page.locator('#valuation-lab-section').screenshot({ path: resolve(output, `${vp.name}-section.png`) });

    // Raising rates lowers the modeled value.
    const before = await modeled(s.page);
    await s.page.locator('[data-vl-input="rateShiftBp"]').fill('200');
    await settle(s.page, 200);
    const after = await modeled(s.page);
    check(after !== before && parseFloat(after.replace(/[$,]/g, '')) < parseFloat(before.replace(/[$,]/g, '')), vp.name + `: +200bp lowers the value (${before} -> ${after})`);
    check(/\+200bp/.test(await s.page.locator('[data-vl-iv="rateShiftBp"]').innerText()), vp.name + ': the input label follows the slider');
    // Weight to zero on four methods leaves peers alone at 100%.
    for (const k of ['dcf', 'earnings', 'history', 'peg', 'power', 'book', 'street']) await s.page.locator(`[data-vl-weight="${k}"]`).fill('0');
    await settle(s.page, 200);
    const share = await s.page.locator('#vl-out .vl-table tbody tr').nth(2).locator('td').last().innerText();
    check(share.trim() === '100%', vp.name + ': peers carry the whole blend');
    // A scenario button, then Reset.
    await s.page.locator('[data-vl-preset="bear"]').click();
    await settle(s.page, 200);
    check((await s.page.locator('#vl-inputs .vl-changed').count()) >= 4, vp.name + ': bear case marks the inputs it moved');
    await s.page.locator('[data-vl-reset]').click();
    await settle(s.page, 200);
    check((await s.page.locator('#vl-inputs .vl-changed').count()) === 0, vp.name + ': reset returns to the defaults');
    // A policy environment from the folded list, then a party scenario.
    await s.page.locator('.vl-env summary').click();
    await s.page.locator('[data-vl-preset="tariffs"]').click();
    await settle(s.page, 200);
    check(/Tariff escalation:/.test(await s.page.locator('#vl-scn-note').innerText()), vp.name + ': scenario note');
    check((await s.page.locator('#vl-inputs .vl-changed').count()) >= 3 && /\+1\.5 pts/.test(await s.page.locator('[data-vl-iv="tariffPp"]').innerText()), vp.name + ': tariff scenario moves its inputs');
    check((await s.page.locator('[data-vl-preset="dsweep"]').count()) === 1, vp.name + ': party scenarios offered');
    await s.page.locator('[data-vl-preset="dsweep"]').click();
    await settle(s.page, 200);
    check(/\+2\.80?%/.test(await s.page.locator('[data-vl-iv="politicsPct"]').innerText()), vp.name + ': Democratic sweep sets the sector tilt');
    // The usual-surprise button sets the earnings surprise.
    await s.page.locator('[data-vl-reset]').click();
    await settle(s.page, 200);
    await s.page.locator('[data-vl-apply="beat"]').click();
    await settle(s.page, 200);
    check(/^\+\d/.test(await s.page.locator('[data-vl-iv="epsShock"]').innerText()), vp.name + ': usual surprise applied');
    await s.page.locator('[data-vl-reset]').click();
    await settle(s.page, 200);
    // Another stock: a bank has no DCF, and says why.
    await s.page.locator('[data-vl-sym]').selectOption('BANKX');
    await settle(s.page, 300);
    const bankText = await s.page.locator('#vl-out').innerText();
    check(/not a meaningful measure for a bank/.test(bankText), vp.name + ': bank explains the missing DCF');
    // The all-stocks table opens a stock.
    await s.page.locator('.vl-screen summary').click();
    await s.page.locator('[data-vl-go="BURN"]').click();
    await settle(s.page, 300);
    check(/Cash Burner/.test(await s.page.locator('[data-vl-sym] option:checked').innerText()), vp.name + ': screen table opens a stock');
    problems = await pageProblems(s);
    check(problems.length === 0, vp.name + ' after edits: ' + problems.join(' | '));
    await s.context.close();
  }
  // Missing file: one hint, no errors.
  haveFile = false;
  {
    const s = await openTab(browser, server.base, { tab: 'valuation-lab' });
    await s.page.waitForFunction(() => /could not be loaded|No valuation file/.test(document.querySelector('#page-pane-valuation-lab')?.innerText || ''), null, { timeout: 15000 });
    check(s.errors.length === 0, 'missing file: no page errors');
    await s.context.close();
  }
  haveFile = true;
  // Public visitor: no page, no request for the file.
  owner = false;
  {
    const before = server.asks.data.filter((k) => k === VALUATION_LAB_KEY).length;
    const s = await openTab(browser, server.base, { tab: 'valuation-lab' });
    await settle(s.page, 1200);
    check(!(await s.page.locator('#page-pane-valuation-lab').isVisible()), 'public: the page stays hidden');
    check((await s.page.locator('[data-page-tab="valuation-lab"]:visible').count()) === 0, 'public: no sidebar entry');
    check(server.asks.data.filter((k) => k === VALUATION_LAB_KEY).length === before, 'public: the file is never requested');
    await s.context.close();
  }
  console.log(`valuation-lab browser: ${checks} checks passed; screenshots in ${output}`);
} finally {
  await browser.close();
  await server.close?.();
}
