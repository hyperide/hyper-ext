import { chooseScriptedDemo, expectVisibleExampleSource } from './workbench-fixture.mts';
import { checkDiagramLifecycle } from './diagram-lifecycle.mts';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from './browser.mts';
// A fresh directory makes this harness portable and safe for parallel CI jobs.
const outputDir = process.env.STATE_SCREENSHOTS_DIR || (await mkdtemp(join(tmpdir(), 'state-diagrams-')));
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const url = `file://${process.cwd()}/dist/index.html#/concepts`;
const errors: string[] = [];
try {
  await checkDiagramLifecycle(browser, errors);
  const desktop = await browser.newContext({
    viewport: { width: 800, height: 700 },
    screen: { width: 1800, height: 1100 },
  });
  const page = await desktop.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`file://${process.cwd()}/dist/index.html#/repl/sync-kanban`);
  await expectVisibleExampleSource(page);
  assert(await page.locator('.pane-primary .cm-editor').nth(2).isVisible());
  const liveSource = `function GalleryFixture() {
    const [second, setSecond] = useState(true);
    return <div>
      <button onClick={() => setSecond(false)}>Remove second SVG</button>
      <figure><svg viewBox="0 0 400 200" aria-label="Remaining live SVG"><text x="20" y="100">Remaining live SVG</text></svg></figure>
      {second && <figure><svg viewBox="0 0 400 200" aria-label="Selected live SVG"><text x="20" y="100">Selected live SVG</text></svg></figure>}
    </div>;
  }
  return <GalleryFixture />;`;
  const jsxEditor = page.locator('.pane-primary .cm-content').last();
  await jsxEditor.fill(liveSource);
  assert.equal(await jsxEditor.innerText(), liveSource);
  await chooseScriptedDemo(page);
  await page.locator('.pane-primary .runall').click();
  await page.waitForFunction(() => document.querySelectorAll('.diagram-expand').length === 2);
  const livePopupPromise = page.waitForEvent('popup');
  await page.locator('.diagram-expand').nth(1).click();
  let livePopup = await livePopupPromise;
  livePopup.on('pageerror', (e) => errors.push(e.message));
  await livePopup.locator('.diagram-transform svg[aria-label="Selected live SVG"]').waitFor();
  assert.match(await livePopup.locator('.diagram-toolbar span').innerText(), /^2\/2/);
  await livePopup.screenshot({ path: join(outputDir, 'diagram-selection-before.png') });
  await page.getByRole('button', { name: 'Remove second SVG', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.diagram-expand').length === 1);
  await page.locator('.diagram-expand').click();
  await page.waitForTimeout(100);
  assert.equal(errors.length, 0, 'replacing the live figures must not dereference a stale selection');
  assert.equal(livePopup.isClosed(), false, 'shorter list reuses the live popup');
  assert.equal(desktop.pages().length, 2, 'selection does not create another popup');
  await livePopup.locator('.diagram-transform svg[aria-label="Remaining live SVG"]').waitFor();
  assert.match(await livePopup.locator('.diagram-toolbar span').innerText(), /^1\/1/);
  for (const key of ['ArrowRight', 'ArrowLeft']) {
    await livePopup.keyboard.press(key);
    assert.match(await livePopup.locator('.diagram-toolbar span').innerText(), /^1\/1/);
  }
  const liveZoom = await livePopup.getByLabel('Zoom level').innerText();
  await livePopup.keyboard.press('+');
  assert.notEqual(await livePopup.getByLabel('Zoom level').innerText(), liveZoom);
  await livePopup.getByRole('button', { name: 'Fit · 0', exact: true }).click();
  assert.equal(await livePopup.getByLabel('Zoom level').innerText(), liveZoom);
  await livePopup.getByRole('button', { name: 'Close ✕', exact: true }).focus();
  await livePopup.keyboard.press('Shift+Tab');
  assert.equal(await livePopup.locator('.diagram-stage').evaluate((el) => el === document.activeElement), true);
  await livePopup.keyboard.press('Tab');
  assert.equal(
    await livePopup
      .getByRole('button', { name: 'Close ✕', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await livePopup.screenshot({ path: join(outputDir, 'diagram-selection-after.png') });
  await livePopup.getByRole('button', { name: 'Close ✕', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(livePopup.isClosed(), true);
  assert.equal(
    await page.locator('.diagram-expand').evaluate((el) => el === document.activeElement),
    true,
    'close restores focus to the remaining SVG trigger',
  );
  const emptyPopupPromise = page.waitForEvent('popup');
  await page.locator('.diagram-expand').click();
  livePopup = await emptyPopupPromise;
  livePopup.on('pageerror', (e) => errors.push(e.message));
  await livePopup.locator('.diagram-viewer').waitFor();
  // A retained handler can run after its SVG disappears, before observer cleanup.
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.diagram-expand');
    document.querySelector('#page-content svg')?.remove();
    button?.click();
  });
  assert.equal(livePopup.isClosed(), false, 'empty refresh preserves the current gallery');
  assert.equal(await livePopup.locator('.diagram-transform svg[aria-label="Remaining live SVG"]').count(), 1);
  await livePopup.getByRole('button', { name: 'Close ✕', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(livePopup.isClosed(), true);
  assert.equal(errors.length, 0);
  // An empty first expansion must not open a popup or modal either.
  await chooseScriptedDemo(page);
  await page.locator('.pane-primary .runall').click();
  await page.waitForFunction(() => document.querySelectorAll('.diagram-expand').length === 2);
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.diagram-expand');
    document.querySelectorAll('#page-content svg').forEach((svg) => svg.remove());
    button?.click();
  });
  await page.waitForTimeout(100);
  assert.equal(desktop.pages().length, 1);
  assert.equal(await page.locator('.diagram-viewer').count(), 0);
  assert.equal(errors.length, 0);
  console.log(
    'PASS: live React two-to-one SVG selection, popup reuse, selected SVG, navigation, zoom, fit, focus trap, close and empty-list guards',
  );
  await page.goto(url);
  // Browser screen geometry is supplied by the context; the real popup API is used.
  const popupPromise = page.waitForEvent('popup');
  await page.locator('.diagram-expand').first().click();
  const popup = await popupPromise;
  popup.on('pageerror', (e) => errors.push(e.message));
  await popup.locator('.diagram-viewer').waitFor();
  await popup.waitForFunction(() => document.activeElement?.textContent === 'Close ✕');
  const before = await popup.getByLabel('Zoom level').innerText();
  await popup.keyboard.press('+');
  await popup.waitForFunction((before) => document.querySelector('output')?.textContent !== before, before);
  assert.notEqual(await popup.getByLabel('Zoom level').innerText(), before);
  await popup.screenshot({ path: join(outputDir, 'diagram-popup-desktop.png') });
  // Expanding again must reuse the live portal without clearing its DOM or zoom.
  const zoomed = await popup.getByLabel('Zoom level').innerText();
  await page.locator('.diagram-expand').first().click();
  await page.waitForTimeout(100);
  assert.equal(popup.isClosed(), false, 'repeated expand keeps the popup open');
  assert.equal(await popup.locator('.diagram-viewer').count(), 1, 'repeated expand retains the viewer');
  assert.equal(await popup.getByLabel('Zoom level').innerText(), zoomed);
  await page.locator('.diagram-expand').nth(1).click();
  await popup.waitForFunction(() =>
    document.querySelector('.diagram-toolbar span')?.textContent?.trim().startsWith('2/'),
  );
  await popup.keyboard.press('ArrowRight');
  await page.locator('.diagram-expand').nth(1).click();
  await popup.waitForFunction(() =>
    document.querySelector('.diagram-toolbar span')?.textContent?.trim().startsWith('2/'),
  );
  await popup.getByRole('button', { name: 'Close ✕', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok(popup.isClosed());
  assert.equal(
    await page
      .locator('.diagram-expand')
      .nth(1)
      .evaluate((el) => el === document.activeElement),
    true,
  );
  for (let cycle = 0; cycle < 2; cycle++) {
    const reopenedPromise = page.waitForEvent('popup');
    await page.locator('.diagram-expand').first().click();
    const reopened = await reopenedPromise;
    reopened.on('pageerror', (e) => errors.push(e.message));
    await reopened.locator('.diagram-viewer').waitFor();
    await reopened.screenshot({ path: join(outputDir, `diagram-popup-reopened-${cycle}.png`) });
    if (cycle === 0) {
      await reopened.close({ runBeforeUnload: true });
      await page.waitForTimeout(100);
    } else {
      await page.evaluate(() => {
        location.hash = '/init';
      });
      await reopened.waitForEvent('close');
    }
  }
  // Model only the browser boundary: denial, or a window already closed on return.
  for (const outcome of ['blocked', 'closed'] as const) {
    const fallback = await desktop.newPage();
    fallback.on('pageerror', (e) => errors.push(e.message));
    await fallback.goto(url);
    await fallback.evaluate((outcome) => {
      const open = window.open.bind(window);
      window.open = (...args) => {
        if (outcome === 'blocked') return null;
        const result = open(...args);
        result?.close();
        return result;
      };
    }, outcome);
    await fallback.locator('.diagram-expand').first().click();
    await fallback.locator('.diagram-viewer').waitFor();
    assert.equal(await fallback.locator('#root').evaluate((el) => el instanceof HTMLElement && el.inert), true);
    await fallback.keyboard.press('+');
    await fallback.keyboard.press('Escape');
    await fallback.locator('.diagram-viewer').waitFor({ state: 'detached' });
    assert.equal(await fallback.locator('#root').evaluate((el) => el instanceof HTMLElement && el.inert), false);
    assert.equal(
      await fallback
        .locator('.diagram-expand')
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await fallback.close();
  }
  await desktop.close();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const phone = await mobile.newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(url);
  await phone.locator('.navsection').waitFor();
  await phone.screenshot({ path: join(outputDir, 'concepts-phone.png') });
  await phone.locator('.diagram-expand').first().tap();
  await phone.locator('.diagram-viewer').waitFor();
  await phone.getByRole('button', { name: 'Rotate 90°', exact: true }).tap();
  assert.match((await phone.locator('.diagram-transform').getAttribute('style')) ?? '', /rotate\(90deg\)/);
  // CDP touch events exercise actual pointer handlers, rather than setting React state.
  const cdp = await mobile.newCDPSession(phone);
  const box = await phone.locator('.diagram-stage').boundingBox();
  assert.ok(box);
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  const zoom = await phone.getByLabel('Zoom level').innerText();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 25, y, id: 1 },
      { x: x + 25, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 65, y, id: 1 },
      { x: x + 65, y, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await phone.waitForTimeout(100);
  assert.notEqual(await phone.getByLabel('Zoom level').innerText(), zoom);
  await phone.screenshot({ path: join(outputDir, 'diagram-phone.png') });
  await phone.getByRole('button', { name: 'Close ✕', exact: true }).tap();
  assert.equal(await phone.locator('.diagram-viewer').count(), 0);
  await phone.goto(`file://${process.cwd()}/dist/index.html#/repl/sync-kanban`);
  await chooseScriptedDemo(phone);
  await phone.locator('.runall').first().tap();
  await phone.locator('.shape-lab').waitFor();
  await phone.locator('.shape-lab').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: join(outputDir, 'sync-repl-phone.png') });
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    0,
  );
  await mobile.close();
  assert.equal(errors.length, 0);
  console.log(
    'PASS: 200 edits retain one live SVG entry and zero detached entries; popup reuse, selection, zoom, focus, close/reopen and route cleanup; blocked/closed popup fallback; touch TOC, rotate, pinch, close; mobile sync REPL width',
  );
} finally {
  await browser.close();
}
