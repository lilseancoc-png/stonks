import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createResearchLabPreview } from './research-lab-preview.mjs';
import { execFileSync } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const preview = await createResearchLabPreview(), out = process.env.QA_OUTPUT || resolve(tmpdir(), 'stonks-research-board-audit');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let checks = 0;
const check = (value, message) => { assert(value, message); checks++; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function unzip(bytes) { const files = new Map(); let i = 0; while (bytes.readUInt32LE(i) === 0x04034b50) { const length = bytes.readUInt16LE(i + 26), extra = bytes.readUInt16LE(i + 28), size = bytes.readUInt32LE(i + 18), start = i + 30 + length + extra; files.set(bytes.subarray(i + 30, i + 30 + length).toString(), bytes.subarray(start, start + size)); i = start + size; } return files; }
async function open(width = 1600) {
  const p = await browser.newPage({ viewport: { width, height: 1100 }, acceptDownloads: true });
  await p.route('**/*', r => new URL(r.request().url()).origin === preview.base ? r.continue() : r.abort());
  await p.goto(preview.base + '/?tab=research-lab'); await p.locator('[data-rb="add-outcome"]').waitFor(); return p;
}
try {
  const p = await open(), root = p.locator('#rl-board'), errors = []; p.on('pageerror', e => errors.push(e.message));
  const click = name => root.locator('[data-rb="' + name + '"]').click();
  const exportAs = async format => { await root.locator('#rb-export-format').selectOption(format); const wait = p.waitForEvent('download', { timeout: 15000 }); await click('export'); let d; try { d = await wait; } catch (error) { await p.screenshot({ path: resolve(out, 'failed-' + format + '.png'), fullPage: true }); throw new Error(format + ' export failed: ' + await p.locator('#rl-message').innerText() + '; browser errors: ' + errors.join(', ') + '; ' + error.message); } const path = resolve(out, d.suggestedFilename()); await d.saveAs(path); return readFile(path); };
  const json = async () => JSON.parse(await exportAs('json'));
  check(await p.locator('.rl-tabs [data-view]:visible').count() === 2, 'Default navigation contains just board and historical studies');
  await click('add-outcome'); await root.locator('[data-rb-field="model"]').selectOption('valuation'); await click('complete-outcome');
  let project = await json();
  check(project.board.nodes.length === 4 && project.board.edges.length === 3, 'Blank-board valuation creates and wires exactly three required inputs');
  check(project.board.nodes.filter(n => n.kind === 'assumption').every(n => n.data.value === null), 'Assumption helper does not invent default values');
  await click('complete-outcome'); check((await json()).board.nodes.length === 4, 'Repeated helper action never duplicates a driver');
  for (const value of ['20', '0', '-10']) { await click('next-piece'); await root.locator('[data-rb-field="value"]').fill(value); await root.locator('[data-rb-field="value"]').press('Tab'); }
  check((await root.locator('.rb-outcomes').innerText()).includes('+8.00%'), 'Guided blank-board workflow produces the exact conditional result');
  await root.locator('.rb-stock-shelf summary').click(); await click('universe'); await root.locator('[data-symbol="NVDA"]').click();
  check(await root.locator('.rb-stock-shelf').getAttribute('open') !== null && await root.locator('#rb-export-format').inputValue() === 'json', 'Shelf disclosure and export choice survive adding a block');
  await click('capture'); await p.waitForFunction(() => document.querySelector('.rb-facts')?.textContent.includes('profit Margin'));
  check((await root.locator('.rb-facts').innerText()).includes('20%'), 'Producer percentage values display as percentages, not fractions');
  check((await root.locator('a', { hasText: 'Open full company' }).getAttribute('href')).includes('s=NVDA'), 'Full-company link opens the selected symbol');
  await root.locator('[data-rb-field="notes"]').fill('First note'); await root.locator('[data-rb-field="notes"]').press('Tab');
  await root.locator('[data-rb-field="notes"]').fill('Second note'); await root.locator('[data-rb-field="notes"]').press('Tab'); await click('undo');
  check((await json()).board.nodes.find(n => n.kind === 'stock').notes === 'First note', 'Undo restores a prior text edit without deleting the block');
  await click('redo'); check((await json()).board.nodes.find(n => n.kind === 'stock').notes === 'Second note', 'Redo restores text');
  const scratch = await browser.newPage(); await scratch.setContent('<h1>Fictional PDF evidence</h1><p>Review as source material.</p>'); const pdf = await scratch.pdf({ format: 'A4' }); await scratch.close();
  const docx = execFileSync('python3', ['-c', `import io,zipfile,sys
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fictional evidence</w:t></w:r></w:p></w:body></w:document>')
sys.stdout.buffer.write(b.getvalue())`]);
  await root.locator('#rb-files').setInputFiles([{ name: 'original.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'original.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }, { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Original text') }, { name: 'source.json', mimeType: 'application/json', buffer: Buffer.from('{"revenue":20}') }]);
  await p.waitForFunction(() => document.querySelectorAll('.rb-node[data-kind=document]').length === 4);
  const imported = await json(); check(imported.attachments.length === 4, 'Real PDF, Word, text and generic JSON import together');
  const count = imported.board.nodes.length;
  await root.locator('#rb-files').setInputFiles([{ name: 'valid.md', mimeType: 'text/markdown', buffer: Buffer.from('Do not partially import me.') }, { name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') }]);
  await p.waitForFunction(() => document.querySelector('#rl-message').textContent.includes('Use PDF'));
  check((await json()).board.nodes.length === count, 'Invalid file in a batch leaves the entire board unchanged');
  // An edited portable project may reuse an attachment ID with different bytes.
  const replacement = structuredClone(imported), file = replacement.attachments.find(a => a.name === 'note.txt');
  file.base64 = Buffer.from('Replacement text').toString('base64'); file.sha256 = sha(Buffer.from('Replacement text'));
  const doc = replacement.board.nodes.find(n => n.kind === 'document' && n.data.attachment_id === file.id); Object.assign(doc.data, { bytes: 16, sha256: file.sha256, text: 'Replacement text' });
  await root.locator('#rb-files').setInputFiles({ name: 'edited-board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) }); await root.locator('[data-rb="import-apply"]').waitFor();
  const backup = p.waitForEvent('download'); await click('import-apply'); await backup;
  await click('undo'); const undone = await json();
  check(Buffer.from(undone.attachments.find(a => a.name === 'note.txt').base64, 'base64').toString() === 'Original text', 'Undo after import retains the original attachment despite reused IDs');
  await click('redo'); const redone = await json(); check(Buffer.from(redone.attachments.find(a => a.name === 'note.txt').base64, 'base64').toString() === 'Replacement text', 'Redo restores the replacement document with a distinct attachment identity');
  const zip = unzip(await exportAs('zip'));
  for (const line of zip.get('checksums.sha256').toString().split('\n')) { const [hash, name] = line.split('  '); check(zip.has(name) && sha(zip.get(name)) === hash, 'Actual ZIP entry matches its declared checksum: ' + name); }
  check([...zip].some(([name, data]) => name.endsWith('.pdf') && data.equals(pdf)), 'Real PDF bytes survive the full bundle');
  const html = (await exportAs('html')).toString(); check(html.includes('marker-end="url(#report-arrow)"') && html.includes('affects'), 'Exported visual preserves connection direction and relationship');
  const again = p.waitForEvent('download'); await root.locator('.rb-download a').click(); const againFile = await again, againPath = resolve(out, 'download-again.html'); await againFile.saveAs(againPath); check((await readFile(againPath)).toString() === html, 'Persistent download link saves exactly the generated file again');
  await click('add-question'); await root.locator('[data-rb-field="title"]').fill('\t=HYPERLINK("bad")'); await root.locator('[data-rb-field="title"]').press('Tab');
  await root.locator('[data-rb-field="notes"]').fill('<img src=x onerror="window.bad=true">'); await root.locator('[data-rb-field="notes"]').press('Tab');
  const csv = (await exportAs('csv')).toString(); check(csv.includes('"\'\t=HYPERLINK'), 'CSV neutralizes a formula hidden behind leading whitespace');
  const escaped = (await exportAs('html')).toString(); check(escaped.includes('&lt;img') && !escaped.includes('<img src=x'), 'HTML export treats document/note markup as text');
  await click('save'); await p.waitForFunction(() => document.querySelector('#rl-message').textContent.includes('Board and attachments saved'));
  // Escape mid-drag must undo the transient move and persist that rollback.
  let dragId;
  await p.exposeFunction('auditPointer', n => { dragId = n; }); await p.evaluate(() => document.querySelector('.rb-scroll').addEventListener('pointerdown', e => window.auditPointer(e.pointerId), { once: true }));
  const beforeDrag = await json(), nodeId = beforeDrag.board.nodes.at(-1).id, originalPosition = beforeDrag.board.nodes.at(-1).position, node = root.locator('[data-rb-node="' + nodeId + '"]'); await node.scrollIntoViewIfNeeded(); const box = await node.boundingBox();
  await p.mouse.move(box.x + 70, box.y + 100); await p.mouse.down(); await p.mouse.move(box.x + 125, box.y + 130, { steps: 5 }); await p.keyboard.press('Escape'); await p.mouse.up();
  check(dragId !== undefined && JSON.stringify((await json()).board.nodes.at(-1).position) === JSON.stringify(originalPosition), 'Escape cancels a live drag rather than leaving a partial move');
  await click('save'); await p.waitForFunction(() => !document.querySelector('[data-rb="save"]').disabled); await p.reload(); await p.locator('.rb-node').first().waitFor();
  check(JSON.stringify((await json()).board.nodes.at(-1).position) === JSON.stringify(originalPosition), 'Canceled drag stays canceled after reload');
  // A malformed retained record must remain recoverable instead of being overwritten.
  await p.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('stonks-research-board-v1'); request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ schema: 'broken-fixture', preserve: 'ORIGINAL_DRAFT' }, 'fixture-owner'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }));
  await p.reload(); await root.locator('[data-rb="recover-draft"]').waitFor(); await click('add-question');
  const recoveryWait = p.waitForEvent('download'); await click('recover-draft'); const recovery = await recoveryWait, recoveryPath = resolve(out, 'recovery.json'); await recovery.saveAs(recoveryPath);
  check(JSON.parse(await readFile(recoveryPath)).preserve === 'ORIGINAL_DRAFT', 'Malformed local draft can be downloaded intact after editing a new board');
  await click('replace-draft'); await p.waitForFunction(() => document.querySelector('#rl-message').textContent.includes('Current board saved')); await p.reload(); await root.locator('.rb-node').first().waitFor();
  check(await root.locator('[data-rb="recover-draft"]').count() === 0, 'Explicit replacement resumes normal local saving');
  check(errors.length === 0, 'No browser exceptions: ' + errors.join(', '));
  await p.screenshot({ path: resolve(out, 'audited-desktop.png'), fullPage: true }); await p.close();
  const nvda = await open(); await nvda.locator('[data-rb="template-nvda"]').click();
  for (const id of ['spending', 'earnings', 'gpu', 'narrative', 'meta-earnings', 'rates-context', 'nvda']) {
    await nvda.locator('[data-rb-node="' + id + '"]').click(); await nvda.locator('[data-rb="capture"]').click();
    await nvda.waitForFunction(id => document.querySelector('[data-rb-node="' + id + '"] .rb-node-summary')?.textContent.includes('source fields'), id);
    check(await nvda.locator('.rb-facts > div').count() > 0, 'NVDA narrative loads actual-shaped source evidence: ' + id);
  }
  for (const [id, value] of [['demand', '20'], ['margin', '0'], ['multiple', '-10']]) { await nvda.locator('[data-rb-node="' + id + '"]').click(); await nvda.locator('[data-rb-field="value"]').fill(value); await nvda.locator('[data-rb-field="value"]').press('Tab'); }
  check((await nvda.locator('.rb-readiness').innerText()).includes('Evidence loaded: 7 / 7') && (await nvda.locator('.rb-outcomes').innerText()).includes('+8.00%'), 'Complete narrative combines seven source cards with explicit outcome assumptions');
  await nvda.locator('#rb-export-format').selectOption('zip'); const narrativeDownload = nvda.waitForEvent('download'); await nvda.locator('[data-rb="export"]').click(); const narrative = await narrativeDownload, narrativePath = resolve(out, 'complete-nvda-puzzle.zip'); await narrative.saveAs(narrativePath);
  const narrativeFiles = unzip(await readFile(narrativePath)), narrativeProject = JSON.parse(narrativeFiles.get('board.json'));
  check(narrativeProject.board.nodes.find(n => n.id === 'spending').data.card.facts.some(f => f.path === 'META.capex_ttm' && f.value === 22000000000), 'Full AI bundle retains META spending amount and units');
  check(narrativeProject.board.nodes.find(n => n.id === 'earnings').data.card.facts.some(f => f.unit === 'decimal_return' && f.value === -.04), 'Full AI bundle preserves earnings-reaction units');
  check(narrativeFiles.get('README_FOR_AI.md').toString().includes('+8.00%'), 'Full AI brief contains the actual conditional outcome');
  execFileSync('python3', ['-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("ZIP verified")', narrativePath]); checks++;
  await nvda.locator('[data-rb="expand"]').click(); await nvda.screenshot({ path: resolve(out, 'complete-nvda-workspace.png') }); await nvda.close();
  for (const width of [390, 768]) {
    const mobile = await open(width); await mobile.locator('[data-rb="add-outcome"]').click(); await mobile.locator('[data-rb-field="model"]').selectOption('duration'); await mobile.locator('[data-rb="complete-outcome"]').click();
    check(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Working scenario has no page overflow at ' + width);
    const sizes = await mobile.locator('#rl-board button:visible, #rl-board input:visible, #rl-board select:visible').evaluateAll(nodes => nodes.map(n => parseFloat(getComputedStyle(n).fontSize)));
    check(sizes.every(n => n >= 12 && n <= 16), 'Controls share a readable type scale at ' + width);
    const selectedId = await mobile.locator('.rb-node.selected').getAttribute('data-rb-node'); await mobile.locator('[data-rb-node="' + selectedId + '"] [data-rb="edit-node"]').click();
    check(await mobile.locator('.rb-inspector').isVisible(), 'Explicit Edit action reaches block details at ' + width);
    await mobile.screenshot({ path: resolve(out, width + '-details-viewport.png') });
    await mobile.screenshot({ path: resolve(out, width + '-working-scenario.png'), fullPage: true }); await mobile.close();
  }
  console.log('Research board workflow audit: ' + checks + ' checks passed. Evidence: ' + out);
} finally { await browser.close(); await new Promise(r => preview.server.close(r)); }
