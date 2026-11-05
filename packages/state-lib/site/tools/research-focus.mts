import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serveStatic } from './static-server.mts';
import { controllerComparison } from '../src/data/research';
const server = await serveStatic('dist-served', false);
const browser = await chromium.launch();
mkdirSync('tools/artifacts/research-focus', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  await page.goto(server.url + '/');
  assert.equal(await page.locator('a[href^="/blog"]').count(), 0, 'Withdraw premature marketing links');
  for (const slug of ['', '/generate-less-ship-less', '/a-faster-edit-is-not-a-faster-product']) {
    const response = await page.request.get(server.url + '/blog' + slug);
    assert.equal(response.status(), 404, 'Withdraw listing and article HTML, not just navigation');
  }
  for (const file of ['sitemap.xml', 'llms.txt'])
    assert(!readFileSync('dist-served/' + file, 'utf8').includes('/blog'));
  for (const slug of ['generate-less-ship-less', 'a-faster-edit-is-not-a-faster-product'])
    assert(!existsSync('dist-served/blog/' + slug + '.md'));
  await page.goto(server.url + '/bench');
  for (const size of [30, 300, 1200]) {
    await page.locator('[data-research-proof="cow"] select').selectOption(String(size));
    const rows = page.locator('[data-research-proof="cow"] tbody tr');
    for (const [i, row] of controllerComparison(size).entries()) {
      const values = [row.original, row.runtime, row.cow];
      const expected = values.map((value, j) => (value === Math.min(...values) ? j : -1)).filter((j) => j >= 0);
      const actual = await rows
        .nth(i)
        .locator('td[data-metric-cell]')
        .evaluateAll((cells) => cells.flatMap((cell, j) => (cell.hasAttribute('data-best') ? [j] : [])));
      assert.deepEqual(actual, expected, `Best cells for ${size}/${row.operation}`);
    }
  }
  await page
    .locator('#published-research')
    .screenshot({ path: 'tools/artifacts/research-focus/best-cells-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page
    .locator('[data-research-proof="cow"]')
    .screenshot({ path: 'tools/artifacts/research-focus/best-cells-mobile.png' });
  const styles = await page
    .locator('[data-research-proof="cow"] tbody tr')
    .first()
    .evaluate((row) => {
      const best = row.querySelector('td[data-best]'),
        other = row.querySelector('td[data-metric-cell]:not([data-best])');
      if (!best || !other) throw new Error('Expected a best and a non-best measured cell');
      return { best: getComputedStyle(best).backgroundColor, other: getComputedStyle(other).backgroundColor };
    });
  assert.notEqual(styles.best, styles.other, 'Best values must be visually highlighted, not merely tagged');
  await page.goto(server.url + '/spec');
  assert.equal(await page.locator('#algorithm-portfolio').count(), 1, 'Exactly one live portfolio insertion');
  await page.goto(server.url + '/concepts');
  assert.equal(await page.locator('a[href^="/blog"]').count(), 0);
  assert.equal(
    await page.locator('[data-research-concept] .research-figure').count(),
    0,
    'Remove rejected decorative research diagrams',
  );
  const evidence = await page.request.get(server.url + '/research/2026-09-20-evidence.json');
  assert.equal(evidence.status(), 200, 'Withdrawal must retain research observations');
  console.log('PASS: withdrawn posts, retained evidence, correct best-row cells and mobile bounds');
} finally {
  await browser.close();
  await server.close();
}
