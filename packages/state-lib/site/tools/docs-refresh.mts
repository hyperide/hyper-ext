/** R93–R98 regressions against the actual served build, not a mocked component. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
import { readEditorContents } from './editor-contents.mts';
import { encodeSnippet, decodeSnippet } from '../src/lib/snippet-transfer.ts';
import { GENERATED_API } from '../src/lib/api-docs.generated.ts';
const root = fileURLToPath(new URL('../dist-served/', import.meta.url));
const mime: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
};
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://test').pathname;
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) {
    res.writeHead(403).end();
    return;
  }
  const asset = extname(pathname) !== '';
  if (asset && !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const target = asset ? file : resolve(root, 'index.html');
  res.setHeader('Content-Type', mime[extname(target)] ?? 'text/plain');
  res.end(readFileSync(target));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
const expectOutput = async (text: string) => {
  await page.waitForFunction((t) => document.querySelector('pre[aria-live="polite"]')?.textContent?.includes(t), text, {
    timeout: 10000,
  });
};
try {
  for (const [path, title] of [
    ['/api', 'API: what exists, and what is designed'],
    ['/adapters', 'Framework adapters'],
    ['/concepts/practical', 'Practical concepts'],
    ['/query-research', 'Query syntax and TanStack DB'],
    ['/diagrams', 'Diagrams, not screenshots'],
  ]) {
    await page.goto(base + path);
    assert.equal(await page.locator('h1').first().textContent(), title);
  }
  console.log('ok — new routes cold-load the intended page, not the home fallback');
  await page.goto(`${base}/api`);
  assert.equal(
    await page.locator('.api-entry .api-badge').filter({ hasText: 'prototype' }).count(),
    Object.keys(GENERATED_API).length,
  );
  await page.locator('#api-search').fill('createScope');
  assert((await page.locator('.api-entry').count()) < 40);
  assert((await page.locator('.api-entry').filter({ hasText: 'createScope' }).count()) > 0);
  await page.screenshot({ path: `${artifacts}api.png` });
  console.log('ok — generated API inventory and search');
  await page.goto(`${base}/selectors-vs-datalog`);
  await page.locator('#query-right').selectOption('Lodash');
  const boxes = await page.locator('.query-pane').evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return { width: r.width, right: r.right };
    }),
  );
  assert(Math.abs(boxes[0].width - boxes[1].width) < 2);
  const toc = await page.locator('.toc').first().boundingBox();
  if (toc) assert(boxes[1].right <= toc.x);
  for (const b of await page.getByRole('button', { name: 'Run fixture', exact: true }).all()) await b.click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.query-pane pre[aria-live="polite"]').length === 2 &&
      [...document.querySelectorAll('.query-pane pre[aria-live="polite"]')].every((p) =>
        p.textContent?.includes('PASS'),
      ),
  );
  await page.locator('.query-stages button').filter({ hasText: 'filter' }).click();
  assert((await page.locator('.query-pane').first().locator('.is-paired').count()) > 0);
  assert((await page.locator('.query-pane').last().locator('.is-paired').count()) > 0);
  assert((await page.locator('#query-hint').innerText()).length > 25);
  await page.locator('.query-panes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}query-pair.png` });
  const tryLink = page.locator('.query-pane a').first();
  const url = await tryLink.getAttribute('href');
  assert(url);
  const original = decodeSnippet(url.split('#code-')[1]).code;
  await tryLink.click();
  await page.locator('.cm-content').waitFor();
  assert.equal(await readEditorContents(page.locator('.cm-content')), original);
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('g1');
  console.log('ok — paired syntax, shared results, exact-source Try link and worker execution');
  const runSource = async (code: string, lang = 'ts') => {
    await page.goto(`${base}/repl/snippet#code-${encodeSnippet({ code, lang })}`);
    await page.locator('.cm-content').waitFor();
    assert.equal(await readEditorContents(page.locator('.cm-content')), code);
    assert((await page.locator('pre[aria-live="polite"]').innerText()).includes('explicit run'));
  };
  await runSource(
    `${Array.from({ length: 300 }, (_, i) => `// virtualized line ${i}: Привет 🌐`).join('\n')}\nlog("last line");`,
  );
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('last line');
  await runSource('import {sum} from "lodash";\nlog("Привет 🌐", sum([2,3,5]));');
  await page.waitForTimeout(250);
  assert((await page.locator('pre[aria-live="polite"]').innerText()).includes('explicit run'));
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('Привет 🌐 10');
  await runSource('import {createStore} from "not-loaded";\nlog(createStore);');
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('Runtime not loaded: not-loaded');
  await runSource('while (true) {}');
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('Stopped after 2 seconds.');
  await runSource('.rows | map(.id)', 'jq');
  assert(await page.getByRole('button', { name: 'Run JavaScript', exact: true }).isDisabled());
  console.log('ok — Unicode, no auto-run, explicit dependency errors, runaway termination and reference language');
  await page.goto(`${base}/concepts/practical#fsm`);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.md pre')].every((p) => p.querySelector('a.code-repl')),
  );
  assert((await page.locator('.md pre').count()) > 0);
  const exact = await page
    .locator('.md pre')
    .evaluateAll((es) => es.every((p) => p.querySelector('.code-repl')?.getAttribute('href')?.includes('#code-')));
  assert(exact);
  console.log('ok — every Markdown snippet has an exact-source Try action');
  await page.goto(`${base}/diagrams`);
  assert((await page.locator('.diagram-preview svg path').count()) > 0);
  await page.getByRole('button', { name: 'Transaction scene', exact: true }).click();
  assert((await page.locator('.diagram-preview svg rect').count()) > 0);
  await page.getByLabel('Diagram source').fill('[{"type":"label","x":0,"y":0,"text":"<script>alert(1)</script>"}]');
  assert.equal(await page.locator('.diagram-preview script').count(), 0);
  assert((await page.locator('.diagram-preview').innerHTML()).includes('&lt;script&gt;'));
  await page.getByRole('button', { name: 'Transaction scene', exact: true }).click();
  await page.locator('.diagram-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}diagram.png` });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'state-diagram.svg');
  await page.getByLabel('Diagram source').fill('not json');
  assert((await page.getByRole('alert').count()) > 0);
  console.log('ok — the actual SVG renderer, escaped text, error display and downloadable SVG');
  await page.goto(`${base}/spec#h-3-architecture-overview`);
  await page.waitForTimeout(700);
  assert((await page.locator('#h-3-architecture-overview').count()) === 1);
  assert((await page.locator('.spec-vector svg').count()) === 1);
  assert.deepEqual(errors, []);
  console.log('ok — architecture SVG and legacy deep link; no application console/page errors');
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
}
