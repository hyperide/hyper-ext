/** Focused static-generation regressions using the existing served bundle, without rebuilding it. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from './browser.mts';
import { prerender, routes } from './prerender.mts';
import { serveStatic } from './static-server.mts';
import { encodeSnippet } from '../src/lib/snippet-transfer.ts';

test('the static route inventory includes standalone deep links', () => {
  for (const route of ['/repl/snippet', '/concepts/practical']) assert.ok(routes.includes(route), route);
});

test('prerendered deep links cold-load without JS and have unique route metadata', { timeout: 60000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'state-prerender-'));
  try {
    await cp(new URL('../dist-served', import.meta.url), out, { recursive: true });
    const selected = ['/', '/requirements', '/repl/snippet', '/concepts/practical'];
    await prerender(
      out,
      selected.filter((route) => routes.includes(route)),
    );
    const server = await serveStatic(out);
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      for (const route of ['/repl/snippet', '/concepts/practical', '/', '/requirements']) {
        const page = await context.newPage();
        const response = await page.goto(`${server.url + route}?reading=1`);
        assert.equal(response?.status(), 200, route);
        assert.ok(await page.locator('h1').first().isVisible(), route);
        assert.equal(await page.locator('link[rel="canonical"]').count(), 1, route);
        assert.equal(new URL((await page.locator('link[rel="canonical"]').getAttribute('href'))!).pathname, route);
        const alternate = page.locator('link[rel="alternate"][type="text/markdown"]');
        assert.equal(await alternate.count(), 1, route);
        assert.equal(await alternate.getAttribute('href'), `${route === '/' ? '/index' : route}.md`);
        await page.close();
      }
      for (const path of ['/absent.js', '/absent.md', '/absent-route'])
        assert.equal((await fetch(server.url + path)).status, 404);
      await context.close();
      const interactive = await browser.newContext();
      const page = await interactive.newPage();
      const code = '// Exact source survives a cold load.\nlog("Привет 🌐");';
      const url = `${server.url}/repl/snippet?reading=1#code-${encodeSnippet({ code, lang: 'js' })}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = attempt === 0 ? await page.goto(url) : await page.reload();
        assert.equal(response?.status(), 200);
        await page.locator('.cm-content').waitFor();
        assert.equal(
          await page
            .locator('.cm-content .cm-line')
            .evaluateAll((lines) => lines.map((line) => line.textContent ?? '').join('\n')),
          code,
        );
        assert.match(await page.locator('pre[aria-live="polite"]').innerText(), /explicit run/);
        assert.equal(new URL(page.url()).search, '?reading=1');
      }
      await interactive.close();
    } finally {
      await browser.close();
      await server.close();
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
