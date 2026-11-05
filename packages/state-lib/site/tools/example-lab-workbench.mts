/**
 * Browser checks for the example workbench at /repl/board-commands (HYP-1489).
 *
 * Drives the single-file build (`dist/index.html`) like the other page harnesses:
 * edit and compile, measure, mechanism links, cancellation, an error that keeps the
 * previous result, layout bounds at 375px and 1440px, and the network contract
 * (nothing measurement-related leaves the page until the visitor clicks Share).
 *
 * Run: `bun run build && tsx tools/example-lab-workbench.mts`. It needs the real
 * compiler client, so it cannot run until src/lib/example-lab/client.ts exists.
 * Not registered in check-all.mts on purpose: add it to the page list once integrated.
 */
import assert from 'node:assert/strict';
import { chromium } from './browser.mts';
import type { Page } from 'playwright';
import { serveStatic } from './static-server.mts';
import { mkdirSync } from 'node:fs';

const ROUTE = '/repl/board-commands';
const server = await serveStatic('dist-served', true);
const DIST = server.url;
const URL = server.url + ROUTE;
mkdirSync('tools/artifacts/example-lab', { recursive: true });
const STEP_TIMEOUT = 30_000;
const WORK_TIMEOUT = 120_000;
/** The harness fulfils these two font hosts itself (see browser.mts); they are not application traffic. */
const FONT_HOSTS = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function open(width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(STEP_TIMEOUT);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.locator('.xl-compile').waitFor();
  return { page, errors };
}

/** Focus the editable file's editor, optionally replacing everything, and type. */
async function typeInEditor(page: Page, text: string, replaceAll: boolean) {
  await page.locator('.xl-editor .cm-content').click();
  await page.keyboard.press(replaceAll ? 'ControlOrMeta+a' : 'ControlOrMeta+End');
  await page.keyboard.type(text);
}

async function compile(page: Page, expectRows = 2) {
  await page.locator('.xl-compile').click();
  await page
    .locator('.xl-sizes tbody tr')
    .nth(expectRows - 1)
    .waitFor({ timeout: WORK_TIMEOUT });
  await page.waitForFunction(() => !(document.querySelector('.xl-compile') as HTMLButtonElement)?.disabled, null, {
    timeout: WORK_TIMEOUT,
  });
}

async function setConditions(page: Page, count: string, samples: string, operation?: string) {
  await page.getByLabel('Tasks', { exact: true }).selectOption(count);
  await page.getByLabel('Samples', { exact: true }).selectOption(samples);
  if (operation) await page.getByLabel('Operation', { exact: true }).selectOption(operation);
}

async function measure(page: Page) {
  await page.locator('button.xl-run').click();
  await page.locator('.xl-results').waitFor({ timeout: WORK_TIMEOUT });
  await page.waitForFunction(() => !(document.querySelector('button.xl-run') as HTMLButtonElement)?.disabled, null, {
    timeout: WORK_TIMEOUT,
  });
}

async function compileAndMeasure(page: Page) {
  await compile(page);
  await setConditions(page, '30', '5');
  await measure(page);
}

/** Runs one scenario on a fresh page (fresh sessionStorage), always closing it. */
async function scenario(name: string, size: [number, number], body: (page: Page) => Promise<void>) {
  const { page, errors } = await open(...size);
  try {
    await body(page);
    if (name.startsWith('(f'))
      await page.screenshot({ path: `tools/artifacts/example-lab/workbench-${size[0]}.png`, fullPage: true });
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log(`PASS: ${name}`);
  } finally {
    await page.close();
  }
}

try {
  await scenario('(a) edit, compile, real sizes, output views', [1440, 1000], async (page) => {
    await typeInEditor(page, '\n// edited by the workbench test\n', false);
    await compile(page);
    const rows = page.locator('.xl-sizes tbody tr');
    assert.equal(await rows.count(), 2, 'two variants in the size table');
    for (const text of await rows.allInnerTexts()) {
      const bytes = [...text.matchAll(/([\d,]+) B/g)].map((m) => Number(m[1].replaceAll(',', '')));
      assert.ok(bytes.length >= 2 && bytes.every((n) => n > 0), `real byte counts in "${text}"`);
    }
    const bestSize = await rows.evaluateAll((elements) =>
      [0, 1].map((column) => {
        const cells = elements.map((row) => row.querySelectorAll('td')[column]);
        const values = cells.map((cell) => Number(cell.textContent.replace(/[^0-9]/g, '')));
        return cells.every(
          (cell, index) => cell.classList.contains('xl-best') === (values[index] === Math.min(...values)),
        );
      }),
    );
    assert.deepEqual(bestSize, [true, true], 'Raw and gzip each highlight their own smallest value');
    const show = page.locator('.xl-view-controls select');
    const shown = async (value: string) => {
      await show.selectOption(value);
      return page.locator('.xl-viewer .xl-code').innerText();
    };
    const readable = await shown('bundle:readable');
    const minified = await shown('bundle:minified');
    assert.ok(readable.length > 0 && minified.length > 0);
    assert.notEqual(readable, minified, 'readable and minified bundles differ');
    const generated = await show.locator('option[value^="generated:"]').first().getAttribute('value');
    assert.ok(generated, 'a generated source file is offered');
    const generatedText = await shown(generated);
    assert.ok(generatedText.length > 0 && generatedText !== minified, 'generated source differs from the bundle');
  });

  await scenario('(b) measure: bars, table, tied-best, equivalent', [1440, 1000], async (page) => {
    await compileAndMeasure(page);
    const bars = page.locator('.xl-bar');
    assert.equal(await bars.count(), 2);
    for (const median of await bars.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-median'))))) {
      assert.ok(median > 0, `bar median ${median} is positive`);
    }
    assert.ok(await page.locator('.xl-results').isVisible());
    assert.ok((await page.locator('.xl-results [data-best]').count()) >= 1, 'a best cell is marked');
    assert.equal(await page.locator('.xl-result').getAttribute('data-equivalent'), 'true');
    assert.match(await page.locator('.xl-verdict').innerText(), /identical state/i);
  });

  await scenario('(c) mechanism links point at exact /spec anchors', [1440, 1000], async (page) => {
    await compileAndMeasure(page);
    const links = await page
      .locator('a[data-mechanism-href]')
      .evaluateAll((els) =>
        els.map((el) => ({ data: el.getAttribute('data-mechanism-href') ?? '', href: el.getAttribute('href') ?? '' })),
      );
    assert.ok(links.length > 0, 'mechanism links are rendered');
    for (const link of links) {
      assert.ok(link.data.startsWith('/spec'), `${link.data} targets the spec`);
      const anchor = link.data.split('#')[1];
      assert.ok(anchor, `${link.data} has an anchor`);
      assert.ok(link.href.endsWith(`#${anchor}`), `${link.href} ends with #${anchor}`);
    }
    await page.locator('a[data-mechanism-href]').first().click();
    await page.waitForFunction(() => location.pathname === '/spec');
    assert.equal(
      await page.getByRole('link', { name: 'Live example contracts', exact: true }).getAttribute('href'),
      '/spec#browser-compiler',
    );
    for (const link of links)
      assert.equal(
        await page.locator(`[id="${link.data.split('#')[1]}"]`).count(),
        1,
        'Every mechanism link has exactly one rendered target',
      );
  });

  await scenario('(d) cancelling a long measurement', [1440, 1000], async (page) => {
    await compile(page);
    await setConditions(page, '10000', '9', 'history');
    await page.locator('button.xl-run').click();
    await page.locator('.xl-cancel-run').waitFor({ timeout: 10_000 });
    await page.locator('.xl-cancel-run').click();
    await page.waitForFunction(() => !(document.querySelector('button.xl-run') as HTMLButtonElement)?.disabled, null, {
      timeout: 15_000,
    });
    assert.equal(await page.locator('[role=alert]').count(), 0, 'a cancelled run shows no error');
  });

  await scenario('(e) a failed compile keeps the previous results', [1440, 1000], async (page) => {
    await compileAndMeasure(page);
    await typeInEditor(page, 'export const = ((( ;', true);
    await page.locator('.xl-compile').click();
    await page.locator('.xl-panel.xl-source .xl-error').waitFor({ timeout: WORK_TIMEOUT });
    assert.ok(await page.locator('.xl-sizes tbody tr').first().isVisible(), 'size table survives the error');
    assert.ok(await page.locator('.xl-results').isVisible(), 'timing result survives the error');
    assert.ok(await page.locator('.xl-bar').first().isVisible());
  });

  await scenario('(f1) no horizontal overflow at 375px', [375, 800], async (page) => {
    await compileAndMeasure(page);
    const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
    assert.ok(scrollWidth <= 375, `document scrollWidth ${scrollWidth} <= 375`);
    const panels = await page.locator('.xl-panel').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    assert.ok(panels.length >= 4);
    for (const box of panels)
      assert.ok(box.left >= 0 && box.right <= 375.5, `panel ${box.left}..${box.right} in viewport`);
  });

  await scenario('(f2) source and board side by side at 1440px', [1440, 1000], async (page) => {
    const box = async (selector: string) => {
      const b = await page.locator(selector).boundingBox();
      assert.ok(b, `${selector} has a box`);
      return b;
    };
    const source = await box('.xl-panel.xl-source');
    const board = await box('.xl-panel.xl-board');
    assert.ok(Math.abs(source.y - board.y) < 2, 'source and board start on one row');
    assert.ok(source.x + source.width <= board.x + 1, 'source and board do not overlap');
    assert.ok(source.y < 1000 && board.y < 1000, 'both are in the first screen');
  });

  await scenario('(g) network: local until the visitor shares', [1440, 1000], async (page) => {
    const seen: string[] = [];
    page.on('request', (request) => seen.push(request.url()));
    // Any endpoint whose name mentions measurements is unreachable in this test.
    await page.route(
      (url) => url.pathname === '/api/measurements',
      (route) => route.abort(),
    );
    await compileAndMeasure(page);
    const external = seen.filter(
      (u) => /^https?:/.test(u) && !u.startsWith(DIST) && !FONT_HOSTS.some((host) => u.startsWith(host)),
    );
    assert.deepEqual(external, [], 'no request leaves for an external origin');
    const early = seen.filter((u) => new globalThis.URL(u).pathname === '/api/measurements');
    assert.deepEqual(early, [], 'nothing measurement-related is requested before Share');
    await page.getByRole('button', { name: 'Share these measurements' }).click();
    await page.locator('.xl-share [role=alert], .xl-share [role=status]').waitFor({ timeout: 15_000 });
    assert.ok(await page.locator('.xl-results').isVisible(), 'the local result stays visible after sharing');
    assert.ok(await page.locator('.xl-bar').first().isVisible());
  });
} finally {
  await browser.close();
  await server.close();
}
