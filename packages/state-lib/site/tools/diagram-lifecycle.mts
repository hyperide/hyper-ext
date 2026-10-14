import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { diagramFrame } from '../../../vector-cli/src/diagram';

/** Test-only figure updates exercise the real viewer without creating a product playground. */
export async function checkDiagramLifecycle(browser: Browser, errors: string[]): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true });
  try {
    await context.addInitScript(() => {
      const owned = new Set<Map<unknown, unknown>>();
      const set = Map.prototype.set;
      Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (key instanceof SVGSVGElement && value instanceof HTMLButtonElement) owned.add(this);
        return set.call(this, key, value);
      };
      window.addEventListener('diagram-ownership-snapshot', () => {
        const nodes = [...owned].flatMap((map) => [...map.keys()]);
        document.documentElement.dataset.diagramOwnership = JSON.stringify({
          entries: nodes.length,
          detached: nodes.filter((node) => node instanceof SVGSVGElement && !node.isConnected).length,
        });
      });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`file://${process.cwd()}/dist/index.html#/init`);
    await page.evaluate(
      (svg) => {
        const host = document.createElement('figure');
        host.className = 'diagram-fixture';
        host.innerHTML = svg;
        document.querySelector('#page-content > .wrap')!.append(host);
      },
      diagramFrame({ title: 'Changing figure', text: 'An SVG rendered by vecli.' }),
    );
    await page.locator('.diagram-fixture .diagram-expand').waitFor();
    const ownership = () =>
      page.evaluate(() => {
        window.dispatchEvent(new Event('diagram-ownership-snapshot'));
        return JSON.parse(document.documentElement.dataset.diagramOwnership ?? '{}');
      });
    assert.deepEqual(await ownership(), { entries: 1, detached: 0 });
    for (let i = 0; i < 200; i++) {
      await page.locator('.diagram-fixture').evaluate(
        (host, svg) => {
          host.innerHTML = svg;
        },
        diagramFrame({ title: 'Changing figure', text: `Revision ${i}` }),
      );
      await page.waitForFunction(() => document.querySelectorAll('.diagram-fixture .diagram-expand').length === 1);
    }
    assert.deepEqual(await ownership(), { entries: 1, detached: 0 }, '200 updates release detached SVG ownership');
    await page.locator('.diagram-fixture .diagram-expand').click();
    await page.locator('.diagram-viewer').waitFor();
    assert.equal(await page.locator('.diagram-transform svg').count(), 1);
    await page.getByRole('button', { name: 'Close ✕', exact: true }).click();
    await page.evaluate(() => {
      location.hash = '/api';
    });
    await page.waitForFunction(() => !document.querySelector('.diagram-fixture'));
    assert.equal(await page.locator('.diagram-expand').count(), 0);
    assert.deepEqual(await ownership(), { entries: 0, detached: 0 }, 'route changes release the figure');
  } finally {
    await context.close();
  }
}
