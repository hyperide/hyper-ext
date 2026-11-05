import { expectVisibleExampleSource } from './workbench-fixture.mts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';
import { ROUTES } from '../src/lib/routes';
import { EXAMPLES } from '../src/data/examples';
import { LIBS } from '../src/data/compare';
import { LAB_EXAMPLES } from '../src/data/example-lab/catalogue';
import { markdownPath } from '../src/lib/page-markdown';
export interface ExportManifestEntry {
  route: string;
  title: string;
  markdown: string;
  sha256: string;
}
// Application navigation and public route families are independent of the export manifest.
export const requiredRoutes = new Set([
  '/',
  '/lib',
  '/playground',
  '/validation',
  '/concepts/practical',
  '/repl/snippet',
  ...ROUTES.map(([route]) => route),
  ...EXAMPLES.map(({ id }) => `/repl/${id}`),
  ...LAB_EXAMPLES.map(({ id }) => `/repl/${id}`),
  ...LIBS.filter(({ id }) => id !== 'state').map(({ id }) => `/lib/${id}`),
]);
export function assertExportManifest(manifest: ExportManifestEntry[]): Map<string, ExportManifestEntry> {
  assert.ok(Array.isArray(manifest), 'Export manifest must be an array');
  assert.equal(manifest.length, requiredRoutes.size, 'Export manifest must contain exactly the required routes');
  const byRoute = new Map(manifest.map((row) => [row.route, row]));
  assert.equal(byRoute.size, manifest.length, 'Export manifest contains duplicate routes');
  for (const route of requiredRoutes) {
    const row = byRoute.get(route);
    assert.ok(row, `Export manifest is missing ${route}`);
    assert.equal(row.markdown, markdownPath(route), `Export manifest Markdown path for ${route}`);
  }
  return byRoute;
}
export async function verifyStaticReading(): Promise<void> {
  const manifest = JSON.parse(await readFile('dist-served/export-manifest.json', 'utf8')) as ExportManifestEntry[];
  const byRoute = assertExportManifest(manifest);
  const server = await serveStatic('dist-served');
  try {
    for (const route of requiredRoutes) {
      const response = await fetch(server.url + route);
      assert.equal(response.status, 200, `required served route ${route}`);
      const html = await response.text();
      const canonical = /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/.exec(html);
      assert.ok(canonical, `canonical for ${route}`);
      assert.equal(new URL(canonical[1]).pathname, route);
    }
  } catch (error) {
    await server.close();
    throw error;
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 800, height: 900 } });
    const page = await context.newPage();
    for (const route of requiredRoutes) {
      const row = byRoute.get(route)!;
      const markdown = markdownPath(route);
      const response = await fetch(server.url + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /<h1[ >]/);
      assert.ok(!html.includes('class="js-enabled"'));
      const canonicals = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"[^>]*>/g)];
      assert.equal(canonicals.length, 1, route);
      assert.equal(new URL(canonicals[0][1]).pathname, route);
      const alternates = [
        ...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*type="text\/markdown"[^>]*href="([^"]+)"[^>]*>/g),
      ];
      assert.equal(alternates.length, 1, route);
      assert.equal(alternates[0][1], markdown);
      const md = await fetch(server.url + markdown);
      assert.match(md.headers.get('content-type') ?? '', /text\/markdown/);
      const text = await md.text();
      assert.equal(createHash('sha256').update(text).digest('hex'), row.sha256);
      assert.ok(text.length > 100);
    }
    for (const route of [
      '/',
      '/concepts',
      '/learning',
      '/spec',
      '/repl/writes-batched',
      '/repl/snippet',
      '/concepts/practical',
    ]) {
      assert.equal((await page.goto(server.url + route))?.status(), 200, route);
      assert.ok((await page.locator('body').innerText()).length > 300);
      assert.ok(await page.locator('h1').isVisible());
    }
    await page.goto(`${server.url}/repl/read-write`);
    await expectVisibleExampleSource(page);
    assert.ok((await page.locator('.editor-static').first().innerText()).includes('createStore'));
    assert.ok((await page.locator('.editor-static').nth(1).innerText()).includes("log('left'"));
    const text = await fetch(`${server.url}/repl/read-write.md`).then((r) => r.text());
    assert.ok(text.includes("log('left', left())"));
    assert.ok(text.includes('return <List />'));
    assert.ok(text.includes('```'));
    const llms = await fetch(`${server.url}/llms.txt`);
    assert.match(llms.headers.get('content-type') ?? '', /text\/plain/);
    const index = await llms.text();
    assert.match(index, /^# state documentation/);
    assert.ok(index.includes('/learning.md'));
    assert.equal((await fetch(`${server.url}/missing.js`)).status, 404);
    assert.equal((await fetch(`${server.url}/missing.md`)).status, 404);
    assert.equal((await fetch(`${server.url}/not-a-route`)).status, 404);
    await context.close();
    console.log(
      `PASS: ${manifest.length} HTML routes and Markdown checksums; no-JS reading, complete REPL source, llms index, real 404 responses`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await verifyStaticReading();
}
