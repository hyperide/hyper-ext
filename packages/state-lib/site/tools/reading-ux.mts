import { chooseScriptedDemo, expectVisibleExampleSource } from './workbench-fixture.mts';
import assert from 'node:assert/strict';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';
import { fileURLToPath } from 'node:url';

/** Audit rendered HTML text separately from zoomable SVG labels and prose links. */
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  for (const route of ['/', '/api', '/concepts', '/repl/undo']) {
    await page.goto(server.url + route, { waitUntil: 'networkidle' });
    if (route.startsWith('/repl')) {
      await chooseScriptedDemo(page);
      await page.locator('.pane-primary .runall').click();
      await page.getByLabel('Task title', { exact: true }).waitFor();
      await expectVisibleExampleSource(page);
      await page.locator('.pane-primary .guide-debug > summary').click();
    }
    const failures = await page.evaluate(() => {
      const small = new Map<Element, string>();
      const text = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        const el = node.parentElement;
        if (
          !el ||
          !node.textContent?.trim() ||
          el.closest('svg,script,style,[aria-hidden="true"]') ||
          !el.getClientRects().length
        )
          continue;
        const collapsed = el.closest('details:not([open])');
        if (collapsed && !collapsed.querySelector(':scope > summary')?.contains(el)) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 12.99) small.set(el.closest('pre') ?? el, `${el.tagName}.${el.className}: ${size}px`);
      }
      const targets = [
        ...document.querySelectorAll(
          'button,summary,select,input:not([type="checkbox"]):not([type="radio"]),a.tab,a.chip,.code-source,.code-repl',
        ),
      ]
        .filter((el) => el.getClientRects().length)
        .flatMap((el) => {
          const collapsed = el.closest('details:not([open])');
          if (collapsed && !collapsed.querySelector(':scope > summary')?.contains(el)) return [];
          const box = el.getBoundingClientRect();
          return box.width < 43.99 || box.height < 43.99
            ? [`${el.tagName}.${el.className}: ${box.width.toFixed(1)}×${box.height.toFixed(1)}`]
            : [];
        });
      return { small: [...small.values()].slice(0, 12), targets: targets.slice(0, 12) };
    });
    assert.deepEqual(failures.small, [], `${route}: ordinary reading text must be at least13px`);
    assert.deepEqual(failures.targets, [], `${route}: standalone touch controls must be at least44×44px`);
    const html = await fetch(server.url + route).then((response) => response.text());
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];
    assert(description && description.length >= 70, `${route}: useful description must exist in cold static HTML`);
    console.info(`PASS: ${route} readable HTML text, touch controls and static meta description`);
  }
  const descriptions = new Map<string, string>();
  for (const route of ['/repl/snippet', '/repl', '/playground']) {
    const html = await fetch(`${server.url}${route}`).then((response) => response.text());
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] ?? '';
    descriptions.set(route, description);
    if (route === '/repl/snippet') {
      assert.match(description, /exact source snippet/);
      assert(!description.includes('change the live UI'));
    } else assert.match(description, /interactive state-management example/);
    await page.goto(`${server.url}${route}`);
    assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), description);
  }
  assert.equal(descriptions.get('/playground'), descriptions.get('/repl'));
} finally {
  await browser.close();
  await server.close();
}
