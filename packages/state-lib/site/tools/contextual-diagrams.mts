import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';
import { normalizeAsciiDiagram } from '../../../vector-cli/src/diagram';
const built = fileURLToPath(new URL('../dist-served/', import.meta.url));
const server = await serveStatic(built, false);
const browser = await chromium.launch();
const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
const errors: string[] = [];
try {
  for (const suffix of ['/diagrams', '/diagrams.md', '/diagrams/anything'])
    assert.equal((await fetch(server.url + suffix)).status, 404);
  for (const name of ['sitemap.xml', 'llms.txt', 'llms-full.txt']) {
    const text = await fetch(`${server.url}/${name}`).then((r) => r.text());
    assert(
      !/https?:\/\/state-lib\.vercel\.app\/diagrams(?:[\s#<".]|$)/.test(text),
      `${name} must not advertise the removed page`,
    );
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}/spec`);
  const source = readFileSync(
    new URL('../../../vector-cli/examples/diagrams/architecture.txt', import.meta.url),
    'utf8',
  ).trim();
  const diagram = page.locator('.inline-diagram').filter({ hasText: 'build time' }).first();
  assert.equal((await diagram.getAttribute('data-diagram-source'))?.trim(), source);
  assert.equal(await diagram.locator('svg [data-ascii-frame]').count(), 2);
  await diagram.scrollIntoViewIfNeeded();
  await diagram.screenshot({ path: `${artifacts}architecture-repaired.png` });
  await diagram.locator('.diagram-expand').click();
  await page.locator('.diagram-viewer').waitFor();
  assert.equal(await page.locator('.diagram-transform svg').count(), 1);
  await page.getByRole('button', { name: 'Close ✕', exact: true }).click();
  await diagram.locator('summary').click();
  assert.equal((await diagram.locator('pre code').textContent())?.trim(), source);
  const md = await fetch(`${server.url}/spec.md`).then((r) => r.text());
  assert(md.includes(source), 'Markdown preserves original diagram source, not normalized replacement text');
  assert.equal(normalizeAsciiDiagram(normalizeAsciiDiagram(source)), normalizeAsciiDiagram(source));
  await diagram.locator('summary').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await diagram.scrollIntoViewIfNeeded();
  assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
  await page.screenshot({ path: `${artifacts}architecture-context-mobile.png` });
  await page.goto(`${server.url}/concepts/practical`);
  assert((await page.locator('.inline-diagram').count()) > 0, 'Other explanations reuse the same renderer');
  assert.equal(await page.locator('a[href="/diagrams"]').count(), 0);
  assert.deepEqual(errors, []);
  console.info(
    'PASS: removed routes/index entries; repaired contextual architecture and guide diagrams; original Markdown; viewer and mobile bounds',
  );
} finally {
  await browser.close();
  await server.close();
}
