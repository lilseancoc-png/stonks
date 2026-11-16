// Browser check for the AI disruption page (2026-11-16): the three public tabs
// render at 1440 light and 390 dark with no page errors, raw values or
// sideways scroll, never ask for an Owner file and carry no stock call; the
// lab, status and company filters narrow the log; the Owner tabs appear only
// after sign-in and the review clicks (confirm, fix, reject, undo) post to the
// review action; the stock page shows the strip for a covered company; a
// missing file degrades to one line. Synthetic data built from the registry;
// nothing here contacts a lab site or the production store.
// Run after regenerating the shell: node scripts/ai-disruption-browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { startSiteServer, launchBrowser, openTab, pageProblems, selfTest, settle } from './browser-harness.mjs';
import { AI_DISRUPTION_KEY, AI_DISRUPTION_OWNER_KEY, AI_DISRUPTION_STATE_KEY, buildDisruptionFiles, emptyState } from '../lib/ai-disruption/log.mjs';
import { AI_DISRUPTION_REVIEW_KEY, applyReviewRequest, emptyReview } from '../lib/ai-disruption/review.mjs';
import { TICKERS } from './build.mjs';

const output = process.env.AI_DISRUPTION_BROWSER_OUT || resolve(tmpdir(), 'stonks-ai-disruption-browser');
await mkdir(output, { recursive: true });

// One collected row (auto), one post the rules could not place, one skipped.
const state = emptyState();
state.lastRunDate = '2026-11-16';
state.lastRunAt = '2026-11-16T14:05:00Z';
state.rows = [{
  id: '2026-11-16-anthropic-claude-meetings', date: '2026-11-16', lab: 'anthropic', product: 'Claude', title: 'Claude takes meeting notes',
  capabilities: ['meeting_notes'], how: 'direct', plans: ['business', 'enterprise'], availability: 'beta', autonomy: 'unattended', coverage: 3,
  source: 'https://support.claude.com/en/articles/12138966-release-notes', link: 'https://support.claude.com/en/articles/12138966-release-notes#nov-16', sourceChecked: '2026-11-16', status: 'auto', collected: true,
}];
state.queue = [{
  id: '2026-11-15-openai-a-note-on-our-next-chapter', date: '2026-11-15', lab: 'openai', source: 'OpenAI news', sourcePage: 'https://openai.com/news/',
  title: 'A note on our next chapter', url: 'https://openai.com/index/next-chapter/', text: 'Today we are sharing what comes next for our products and teams.',
  suggestion: { title: 'A note on our next chapter', product: 'ChatGPT', capabilities: [], plans: [] }, reasons: ['no capability named', 'reads like company news'], seenAt: '2026-11-16T14:05:00Z',
}];
state.skipped = [{ date: '2026-11-14', lab: 'microsoft', title: 'Our partnership with a bank', why: 'reads as company news, not a product' }];
state.health = [
  { lab: 'anthropic', source: 'Claude release notes', url: 'https://support.claude.com/en/articles/12138966-release-notes', ok: true, status: 200, posts: 12, recent: 2 },
  { lab: 'openai', source: 'OpenAI news', url: 'https://openai.com/news/rss.xml', ok: false, status: 403, posts: 0, recent: 0, error: 'HTTP 403' },
];
state.runs = [{ at: '2026-11-16T14:05:00Z', date: '2026-11-16', read: 1, failed: 1, posts: 12, logged: 1, queued: 1, skipped: 1, duplicates: 0 }];
const built = buildDisruptionFiles({ state, review: null, tickers: TICKERS, builtAt: '2026-11-16T15:00:00Z', collected: true });
const pub = built.pub, owner = built.owner;
assert.ok(pub.launches.length === 89 && owner.queue.length === 1, 'fixture: 88 backfill + 1 collected, one queued');

const adbe = { symbol: 'ADBE', spot: 400, priceSeries: { t: ['2026-11-13', '2026-11-14'], c: [398, 400] }, fundamentals: {}, technicals: {}, news: {} };
let review = emptyReview();
const posts = [];
let ownerOn = false, haveFile = true;
const server = await startSiteServer({
  owner: () => ownerOn,
  data: (key) => (key === AI_DISRUPTION_KEY ? (haveFile ? pub : null) : key === AI_DISRUPTION_OWNER_KEY ? (ownerOn ? owner : null) : key === 'ADBE.json' ? adbe : null),
  api: async (url, req) => {
    if (url.pathname !== '/api/auth/ai-disruption-review') return undefined;
    if (!ownerOn) return null;
    if (req.method === 'POST') {
      const body = await new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => r(JSON.parse(s || '{}'))); });
      posts.push(body);
      const out = applyReviewRequest(review, body, { at: '2026-11-16T15:30:00Z', by: 'Synthetic owner' });
      if (out.error) return { error: out.error };
      review = out.doc;
    }
    return { decisions: review.decisions, history: review.history.slice(0, 50), updatedAt: review.updatedAt };
  },
});
const browser = await launchBrowser();
let checks = 0;
const check = (test, label) => { assert.ok(test, label); checks++; };
const CALL_RE = /\b(we recommend|you should (buy|sell)|buy now|sell now|strong buy|strong sell|price target|undervalued|overvalued|short (it|the stock))\b/i;
const PUBLIC = ['log', 'board', 'companies'];
const OWNER = ['review', 'scorecard'];
const rootText = (s) => s.page.locator('#aid-root').innerText();

try {
  await selfTest(browser, server.base);

  // Public, desktop, light: every tab and the filters.
  {
    const s = await openTab(browser, server.base, { tab: 'ai-disruption', width: 1440, height: 1000, theme: 'light' });
    await s.page.locator('#aid-root .aid-body').waitFor({ timeout: 15000 });
    await settle(s.page, 600);
    check((await s.page.locator('#aid-root .vn-tabs .ui-tab').count()) === 3, 'three public tabs');
    check((await s.page.locator('#aid-root .mm-kpi').count()) >= 3, 'headline tiles rendered');
    for (const tab of PUBLIC) {
      await s.page.locator('[data-aid-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const text = await rootText(s);
      check(text.length > 300, tab + ': content rendered');
      check(!CALL_RE.test(text), tab + ': no stock call wording');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' desktop light: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'public-1440-' + tab + '.png'), fullPage: true });
    }
    await s.page.locator('[data-aid-tab="log"]').click();
    await settle(s.page, 300);
    check(/auto/i.test(await s.page.locator('#aid-root .aid-badge-auto').first().innerText()), 'log: rows carry the auto badge');
    check(/Claude takes meeting notes/.test(await rootText(s)), 'log: the collected launch is listed');
    await s.page.locator('[data-aid-lab="openai"]').click();
    await settle(s.page, 300);
    const labs = await s.page.locator('#aid-root .aid-log tbody tr:not(.vt-detail) .aid-lab').allInnerTexts();
    check(labs.length > 0 && labs.every((t) => /OpenAI/.test(t)), 'log: the lab chip narrows to OpenAI');
    await s.page.locator('[data-aid-lab="all"]').click();
    await s.page.locator('#aid-root select[data-aid-cap]').selectOption('slides');
    await settle(s.page, 300);
    const capRows = await s.page.locator('#aid-root .aid-log tbody tr:not(.vt-detail)').count();
    check(capRows > 0 && capRows < 30, 'log: the capability menu narrows the rows');
    await s.page.locator('#aid-root select[data-aid-cap]').selectOption('all');
    await settle(s.page, 200);
    await s.page.locator('[data-aid-tab="board"]').click();
    await settle(s.page, 300);
    check((await s.page.locator('#aid-root .aid-cell').count()) >= 32, 'board: a cell per capability and lab');
    await s.page.locator('[data-aid-goto-cap]').first().click();
    await settle(s.page, 300);
    check((await s.page.locator('[data-aid-tab="log"][aria-selected="true"]').count()) === 1, 'board: a capability opens the filtered log');
    await s.page.locator('#aid-root select[data-aid-cap]').selectOption('all');
    await s.page.locator('[data-aid-tab="companies"]').click();
    await settle(s.page, 300);
    check(/Adobe/.test(await rootText(s)), 'companies: covered companies listed');
    await s.page.locator('#aid-root [data-aid-company="ADBE"]').first().click();
    await settle(s.page, 300);
    check(/Targets ADBE/.test(await rootText(s)), 'companies: a count opens the log for that company');
    check(/not read/i.test(await s.page.locator('#aid-root .crd-sources').last().textContent()), 'sources: a failed source is shown');
    const asks = server.asks.data.slice();
    check(!asks.includes(AI_DISRUPTION_OWNER_KEY) && !asks.includes(AI_DISRUPTION_STATE_KEY) && !asks.includes(AI_DISRUPTION_REVIEW_KEY), 'public: no Owner, state or review file was requested');
    check(asks.includes(AI_DISRUPTION_KEY), 'public: ai-disruption.json was requested');
    check(!server.asks.api.some((p) => p.startsWith('/api/auth/ai-disruption-review')), 'public: the review action is never called');
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.page.locator('#aid-root .aid-body').waitFor({ timeout: 15000 });
    check((await s.page.locator('[data-aid-tab="log"][aria-selected="true"]').count()) === 1, 'tab choice remembered');
    await s.context.close();
  }

  // Public, phone, dark, deep link to one company.
  {
    const s = await openTab(browser, server.base, { tab: 'ai-disruption', width: 390, height: 844, theme: 'dark', extra: '&company=CRM' });
    await s.page.locator('#aid-root .aid-body').waitFor({ timeout: 15000 });
    await settle(s.page, 400);
    check(/Targets CRM/.test(await rootText(s)), 'deep link: ?company= filters the log');
    for (const tab of PUBLIC) {
      await s.page.locator('[data-aid-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' phone dark: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'public-390-dark-' + tab + '.png'), fullPage: true });
    }
    await s.context.close();
  }

  // Stock page: the strip for a covered company.
  {
    const s = await openTab(browser, server.base, { tab: 'stock', width: 1280, height: 1000, theme: 'light', extra: '&s=ADBE' });
    await s.page.locator('#stp-aid:not([hidden])').waitFor({ timeout: 15000 });
    const text = await s.page.locator('#stp-aid').innerText();
    check(/AI launches aimed at what it sells/.test(text) && /Adobe sells/.test(text), 'stock page: the strip names what the company sells');
    check(!CALL_RE.test(text), 'stock page: no stock call wording');
    check((await s.page.locator('#stp-aid a[href*="tab=ai-disruption"][href*="company=ADBE"]').count()) === 1, 'stock page: links to the filtered log');
    const problems = (await pageProblems(s)).filter((p) => !/console error/.test(p));
    check(problems.length === 0, 'stock page: ' + problems.join(' | '));
    await s.page.locator('#stp-aid').screenshot({ path: resolve(output, 'stock-adbe-strip.png') });
    await s.context.close();
  }

  // Public, file not written yet.
  {
    haveFile = false;
    const s = await openTab(browser, server.base, { tab: 'ai-disruption', width: 1200, height: 900, theme: 'light' });
    await s.page.waitForFunction(() => /could not load/.test(document.querySelector('#aid-root')?.textContent || ''), null, { timeout: 15000 });
    check(s.errors.length === 0, 'missing file: no page errors');
    const problems = (await pageProblems(s)).filter((p) => !/blank/.test(p));
    check(problems.length === 0, 'missing file: ' + problems.join(' | '));
    await s.context.close();
    haveFile = true;
  }

  // Owner: the review and scorecard tabs, and the review clicks.
  {
    ownerOn = true;
    server.asks.data.length = 0;
    const s = await openTab(browser, server.base, { tab: 'ai-disruption', width: 1440, height: 1000, theme: 'light', extra: '&view=review' });
    await s.page.locator('[data-aid-tab="review"]').waitFor({ timeout: 15000 });
    await s.page.locator('#aid-root .aid-q').waitFor({ timeout: 15000 });
    check((await s.page.locator('#aid-root .vn-tabs .ui-tab').count()) === 5, 'owner: five tabs');
    for (const tab of OWNER) {
      await s.page.locator('[data-aid-tab="' + tab + '"]').click();
      await settle(s.page, 500);
      const text = await rootText(s);
      check(!/Loading the review queue/.test(text), tab + ': Owner data rendered');
      const problems = await pageProblems(s);
      check(problems.length === 0, tab + ' owner: ' + problems.join(' | '));
      await s.page.screenshot({ path: resolve(output, 'owner-1440-' + tab + '.png'), fullPage: true });
    }
    await s.page.locator('[data-aid-tab="review"]').click();
    await settle(s.page, 300);
    check(/A note on our next chapter/.test(await rootText(s)) && /no capability named/.test(await rootText(s)), 'review: the queued post shows why it is there');
    check(/Skipped as not a launch \(1\)/.test(await rootText(s)), 'review: skipped posts listed');
    // Confirm the collected row.
    const id = '2026-11-16-anthropic-claude-meetings';
    await s.page.locator('[data-aid-act="confirm"][data-aid-id="' + id + '"]').click();
    await s.page.waitForFunction((x) => /applies next update/.test(document.querySelector('#aid-root')?.textContent || '') && !!document.querySelector('[data-aid-act="undo"][data-aid-id="' + x + '"]'), id, { timeout: 15000 });
    check(posts.at(-1)?.act === 'confirm' && posts.at(-1)?.id === id, 'review: confirm posts to the review action');
    await s.page.locator('[data-aid-act="undo"][data-aid-id="' + id + '"]').click();
    await s.page.waitForFunction((x) => !!document.querySelector('[data-aid-act="confirm"][data-aid-id="' + x + '"]'), id, { timeout: 15000 });
    check(posts.at(-1)?.act === 'undo' && !review.decisions[id], 'review: undo clears the decision');
    // Fix the queued post into the log.
    const qid = '2026-11-15-openai-a-note-on-our-next-chapter';
    await s.page.locator('.aid-q [data-aid-act="fix"][data-aid-id="' + qid + '"]').click();
    const form = s.page.locator('form[data-aid-fix="' + qid + '"]');
    await form.waitFor({ timeout: 5000 });
    await form.locator('input[name="title"]').fill('ChatGPT builds slide decks');
    await form.locator('input[name="cap"][value="slides"]').check();
    await form.locator('input[name="plan"][value="consumer"]').check();
    await form.locator('select[name="availability"]').selectOption('ga');
    await form.locator('button[type="submit"]').click();
    await s.page.waitForFunction((x) => !document.querySelector('form[data-aid-fix="' + x + '"]'), qid, { timeout: 15000 });
    const sent = posts.at(-1);
    check(sent?.act === 'edit' && sent.fields.capabilities.includes('slides') && sent.fields.title === 'ChatGPT builds slide decks', 'review: a fix posts the edited fields');
    check(review.decisions[qid]?.act === 'edit', 'review: the fix is saved');
    // Reject an auto row.
    const rid = pub.launches.find((l) => l.status === 'auto' && l.id !== id).id;
    await s.page.locator('[data-aid-act="reject"][data-aid-id="' + rid + '"]').click();
    await s.page.waitForFunction((x) => !!document.querySelector('[data-aid-act="undo"][data-aid-id="' + x + '"]'), rid, { timeout: 15000 });
    check(review.decisions[rid]?.act === 'reject', 'review: reject is saved');
    const problems = await pageProblems(s);
    check(problems.length === 0, 'review after clicks: ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, 'owner-1440-review-after.png'), fullPage: true });
    check(server.asks.data.includes(AI_DISRUPTION_OWNER_KEY), 'owner: ai-disruption-owner.json requested');
    check(!server.asks.data.includes(AI_DISRUPTION_STATE_KEY) && !server.asks.data.includes(AI_DISRUPTION_REVIEW_KEY), 'owner: the state and review files are never read as data');
    await s.context.close();
  }

  // Owner, phone, dark: review tab fits.
  {
    const s = await openTab(browser, server.base, { tab: 'ai-disruption', width: 390, height: 844, theme: 'dark', extra: '&view=review' });
    await s.page.locator('#aid-root .aid-q').waitFor({ timeout: 15000 });
    await s.page.locator('.aid-q [data-aid-act="reject"]').first().waitFor({ timeout: 5000 }).catch(() => {});
    const problems = await pageProblems(s);
    check(problems.length === 0, 'review owner phone dark: ' + problems.join(' | '));
    await s.page.screenshot({ path: resolve(output, 'owner-390-dark-review.png'), fullPage: true });
    await s.context.close();
    ownerOn = false;
  }
  console.log(`ai-disruption browser: ok (${checks} checks; screenshots in ${output})`);
} finally {
  await browser.close();
  await server.close();
}
