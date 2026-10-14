import { chooseScriptedDemo } from './workbench-fixture.mts';
import assert from 'node:assert/strict';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';
import { mkdirSync, writeFileSync } from 'node:fs';

const local = process.env.UX_BASE_URL ? null : await serveStatic('dist-served', false);
const base = process.env.UX_BASE_URL ?? local!.url;
const browser = await chromium.launch({ headless: true });
const checks: string[] = [];
mkdirSync('tools/artifacts', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 500));
  });
  await page.goto(`${base}/api`, { waitUntil: 'domcontentloaded' });
  const toggle = page.getByRole('button', { name: 'Menu and search', exact: true });
  await toggle.waitFor({ timeout: 10000 });
  const bounds = await page
    .locator('nav.top .brand, nav.top .navcurrent, nav.top .navsection, nav.top .nav-menu-search')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
  assert.equal(bounds.length, 4);
  for (let i = 1; i < bounds.length; i++) assert(bounds[i].x >= bounds[i - 1].right - 1, 'Header order and hit areas');
  assert(bounds[3].right <= 390);
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Menu and search', exact: true });
  await dialog.waitFor();
  assert(await page.getByRole('searchbox', { name: 'Search the site', exact: true }).isVisible());
  assert(await dialog.getByRole('link', { name: 'Home', exact: true }).isVisible());
  assert(await dialog.getByRole('link', { name: 'API', exact: true }).isVisible());
  await page.screenshot({ path: 'tools/artifacts/navigation-site-mobile.png' });
  await page.keyboard.press('Escape');
  assert(await toggle.evaluate((el) => el === document.activeElement));
  checks.push('ordered compact header; combined control opens search and navigation; Escape restores focus');
  await page.locator('.navsection').click();
  const scoped = page.getByRole('searchbox', { name: 'Search this page', exact: true });
  await scoped.waitFor();
  const chip = dialog.getByRole('button', { name: 'Remove In page filter; search the whole site', exact: true });
  assert(await chip.isVisible());
  assert((await scoped.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16);
  assert.equal(await page.evaluate(() => window.visualViewport?.scale ?? 1), 1);
  assert(
    !/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(?:\D|$)/.test(
      (await page.locator('meta[name="viewport"]').getAttribute('content')) ?? '',
    ),
  );
  await scoped.fill('a');
  await scoped.press('Backspace');
  assert(await chip.isVisible());
  await scoped.press('Backspace');
  assert(!(await chip.isVisible()));
  assert(await page.getByRole('searchbox', { name: 'Search the site', exact: true }).isVisible());
  await dialog.getByRole('button', { name: 'Search only API →', exact: true }).click();
  await scoped.fill('no_such_heading_1463');
  await page.waitForTimeout(80);
  assert.equal(await dialog.locator('a[data-search-result]').count(), 0);
  assert(await chip.isVisible());
  await chip.click();
  const global = page.getByRole('searchbox', { name: 'Search the site', exact: true });
  assert.equal(await global.inputValue(), 'no_such_heading_1463');
  assert(await global.evaluate((el) => document.activeElement === el));
  checks.push(
    'page scope is explicit; Backspace only removes an empty chip; cross keeps query and focus; no silent scope widening',
  );
  await global.fill('');
  await dialog.getByRole('button', { name: 'Search only API →', exact: true }).click();
  await page.screenshot({ path: 'tools/artifacts/navigation-in-page-mobile.png' });
  const destination = dialog.locator('a[data-level="2"]').nth(1);
  const heading = await destination.getAttribute('aria-label');
  const target = await destination.getAttribute('href');
  await destination.click();
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#site-menu')?.open);
  assert(page.url().endsWith(target!.slice(target!.indexOf('#'))));
  await page.waitForFunction(
    (text) =>
      document
        .querySelector('.navsection')
        ?.getAttribute('title')
        ?.includes(text ?? ''),
    heading,
  );
  checks.push('heading link closes the panel, scrolls to its real target, and updates the header section');
  await page.locator('.navcurrent').click();
  await dialog.getByRole('link', { name: 'Home', exact: true }).click();
  await page.locator('.landing-demo').waitFor();
  const demo = page.getByRole('region', { name: 'Interactive task and history demo' });
  await demo.getByRole('checkbox', { name: 'Build something useful', exact: true }).check();
  assert.equal(await demo.locator('.demo-count strong').innerText(), '1');
  await demo.getByRole('button', { name: '↶ Undo', exact: true }).click();
  assert.equal(await demo.locator('.demo-count strong').innerText(), '2');
  await demo.getByRole('button', { name: '↷ Redo', exact: true }).click();
  assert.equal(await demo.locator('.demo-count strong').innerText(), '1');
  await page.screenshot({ path: 'tools/artifacts/landing-mobile.png', fullPage: true });
  checks.push('landing runs real task/derived/history behavior');
  await page.goto(`${base}/repl/lifecycle#guide`);
  await chooseScriptedDemo(page);
  await page.locator('.pane-primary .runall').click();
  await page.waitForTimeout(350);
  assert.equal(
    (await page.locator('.pane-primary .repl-err').allTextContents()).join('; '),
    '',
    'Lifecycle execution must not contain a JSX error',
  );
  await page.locator('[data-lifecycle-source]').waitFor();
  await page.getByRole('button', { name: 'Increment source', exact: true }).click();
  assert.equal(await page.locator('[data-lifecycle-reader]').innerText(), '1');
  await page.getByRole('button', { name: 'Disconnect reader', exact: true }).click();
  await page.getByRole('button', { name: 'Increment source', exact: true }).click();
  assert.equal(await page.locator('[data-lifecycle-source]').innerText(), '2');
  assert.equal(await page.locator('[data-lifecycle-reader]').innerText(), '1');
  await page.getByRole('button', { name: 'Reconnect reader', exact: true }).click();
  assert.equal(await page.locator('[data-lifecycle-reader]').innerText(), '2');
  checks.push('dispose-related Try has a complete live subscription/unsubscription lesson');
  await page.screenshot({ path: 'tools/artifacts/lifecycle-mobile.png' });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on('pageerror', (error) => errors.push(error.message));
  await desktop.goto(`${base}/`);
  await desktop.screenshot({ path: 'tools/artifacts/landing-desktop.png', fullPage: true });
  await desktop.getByRole('button', { name: 'Menu and search', exact: true }).click();
  assert(await desktop.locator('dialog input').isVisible());
  for (let i = 0; i < 12; i++) {
    await desktop.keyboard.press('Tab');
    assert(await desktop.evaluate(() => !!document.activeElement?.closest('dialog')));
  }
  await desktop.keyboard.press('Escape');
  assert(!(await desktop.locator('dialog').isVisible()));
  checks.push('desktop panel, native focus containment and Escape');
  await desktop.getByRole('button', { name: 'Menu and search', exact: true }).click();
  await desktop.evaluate(() => {
    const messages: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('.searchempty')) messages.push(node.textContent ?? '');
        }
      document.documentElement.dataset.searchPrematureMisses = JSON.stringify(messages);
    });
    observer.observe(document.querySelector('#site-menu')!, { childList: true, subtree: true });
  });
  await desktop.getByRole('searchbox', { name: 'Search the site', exact: true }).fill('signal');
  await desktop.waitForFunction(
    () =>
      document.querySelectorAll('[data-search-result]').length > 0 &&
      document.querySelector('.navigation-results')?.getAttribute('aria-busy') === 'false',
  );
  for (const term of ['', 'signal', 'sig', 'signal']) {
    await desktop.getByRole('searchbox', { name: 'Search the site', exact: true }).fill(term);
    await desktop.waitForFunction(
      () =>
        document.querySelectorAll('[data-search-result]').length > 0 &&
        document.querySelector('.navigation-results')?.getAttribute('aria-busy') === 'false',
    );
  }
  assert.equal(await desktop.locator('.searchempty').count(), 0);
  assert.equal(
    await desktop.evaluate(() => JSON.parse(document.documentElement.dataset.searchPrematureMisses ?? '[]').length),
    0,
  );
  await desktop.keyboard.press('Escape');
  checks.push('site search never announces a miss before its current query completes');

  assert.equal(errors.length, 0, errors.slice(0, 3).join('; ').slice(0, 600));
  writeFileSync(
    'tools/artifacts/navigation-panel-result.json',
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        environment: 'Desktop Chromium with mobile viewport; not physical iPhone verification',
      },
      null,
      2,
    ),
  );
  console.info(`PASS: ${checks.length} navigation/learning scenarios; no page exceptions`);
} catch (error) {
  await browser
    .contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: 'tools/artifacts/navigation-failure.png', fullPage: true });
  writeFileSync(
    'tools/artifacts/navigation-panel-result.json',
    JSON.stringify({ passed: false, checks, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await local?.close();
}
