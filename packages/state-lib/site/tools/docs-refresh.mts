/** Served-source, query, API and contextual-figure regression coverage. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';
import { readEditorContents } from './editor-contents.mts';
import { encodeSnippet, decodeSnippet } from '../src/lib/snippet-transfer.ts';
import { GENERATED_API } from '../src/lib/api-docs.generated.ts';
import { asciiToSvg, renderDiagram } from '../../../vector-cli/src/diagram';
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
const base = server.url;
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
  ]) {
    assert.equal((await page.goto(base + path))?.status(), 200);
    assert.equal(await page.locator('h1').first().textContent(), title);
  }
  assert.equal((await fetch(`${base}/diagrams`)).status, 404, 'Unrequested diagram page is removed');
  assert.equal((await fetch(`${base}/diagrams.md`)).status, 404);
  await page.goto(`${base}/api`);
  assert.equal(
    await page.locator('.api-entry .api-badge').filter({ hasText: 'prototype' }).count(),
    Object.keys(GENERATED_API).length,
  );
  await page.locator('#api-search').fill('createScope');
  assert((await page.locator('.api-entry').count()) < 40);
  assert((await page.locator('.api-entry').filter({ hasText: 'createScope' }).count()) > 0);
  await page.screenshot({ path: `${artifacts}api.png` });
  await page.goto(`${base}/selectors-vs-datalog`);
  await page.locator('#query-right').selectOption('Lodash');
  const boxes = await page.locator('.query-pane').evaluateAll((es) =>
    es.map((e) => {
      const rect = e.getBoundingClientRect();
      return { width: rect.width, right: rect.right };
    }),
  );
  assert(Math.abs(boxes[0].width - boxes[1].width) < 2);
  const toc = await page.locator('.toc').first().boundingBox();
  if (toc) assert(boxes[1].right <= toc.x);
  for (const button of await page.getByRole('button', { name: 'Run fixture', exact: true }).all()) await button.click();
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
  const inspectLink = page.locator('.query-pane .code-source').first();
  const sourceUrl = await inspectLink.getAttribute('href');
  assert(sourceUrl);
  const original = decodeSnippet(sourceUrl.split('#code-')[1]).code;
  await inspectLink.click();
  await page.locator('.cm-content').waitFor();
  assert.equal(await readEditorContents(page.locator('.cm-content')), original);
  await page.getByRole('button', { name: 'Run JavaScript', exact: true }).click();
  await expectOutput('g1');
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
  await page.goto(`${base}/concepts/practical#fsm`);
  await page.waitForFunction(() => {
    const blocks = [...document.querySelectorAll('.md pre:not([data-no-try]), .md [data-code-source]')].filter(
      (p) => !p.closest('[data-no-try]'),
    );
    return blocks.length > 0 && blocks.every((p) => p.querySelector('a.code-source'));
  });
  const refs = await page.locator('.md a.code-source').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href') ?? '',
      source:
        link.closest('[data-code-source]')?.getAttribute('data-code-source') ??
        link.closest('pre')?.querySelector('code')?.textContent,
    })),
  );
  assert(refs.length > 0);
  for (const ref of refs) assert.equal(decodeSnippet(ref.href.split('#code-')[1]).code, ref.source);
  const guides = await page
    .locator('.md a.code-repl')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  assert(guides.every((url) => url?.includes('/repl/') && !url.includes('/repl/snippet')));
  // Core safety/output tests survive removal of the unrequested editor page.
  const hostile = renderDiagram([{ type: 'label', x: 0, y: 0, text: '<script>alert(1)</script>' }]);
  assert(!hostile.includes('<script>'));
  assert(hostile.includes('&lt;script&gt;'));
  assert.throws(() => renderDiagram([{ type: 'unknown' } as never]));
  assert.throws(() => asciiToSvg(''));
  await page.goto(`${base}/spec#h-3-architecture-overview`);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#h-3-architecture-overview').count(), 1);
  const architecture = page.locator('.inline-diagram').filter({ hasText: 'build time' }).first();
  assert.equal(await architecture.locator('svg').count(), 1);
  assert.equal(await architecture.locator('script').count(), 0);
  assert((await architecture.getAttribute('data-diagram-source'))?.includes('run time'));
  await architecture.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}diagram.png` });
  assert.deepEqual(errors, []);
  console.info(
    'PASS: API inventory, paired queries, source transfer, Unicode, explicit run/errors, worker stop, contextual SVG and removed route',
  );
} finally {
  await browser.close();
  await server.close();
}
