import { chooseScriptedDemo, expectVisibleExampleSource } from './workbench-fixture.mts';
import assert from 'node:assert/strict';
import { chromium } from './browser.mts';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 800, height: 900 }, reducedMotion: 'reduce' });
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
const url = (route: string) => `file://${process.cwd()}/dist/index.html#${route}`;
try {
  await p.goto(url('/compare'));
  await p.locator('.cmp-row').first().hover();
  await p.waitForSelector('.cmp-detail.open', { state: 'visible' });
  const sheet = await p.locator('.cmp-detail').boundingBox();
  assert.ok(sheet && sheet.x === 0 && Math.abs(sheet.width - 800) < 2);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.cmp-detail.open').count(), 0);
  await p.goto(url('/concepts'));
  await p.locator('.toc-ribbon a').first().waitFor();
  const ribbon = await p.locator('.toc-ribbon').boundingBox();
  assert.ok(ribbon);
  const max = await p.locator('.toc-ribbon').evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(max > 0);
  await p.mouse.move(ribbon!.x + ribbon!.width - 5, ribbon!.y + ribbon!.height / 2);
  await p.waitForTimeout(300);
  assert.ok(
    Math.abs((await p.locator('.toc-ribbon').evaluate((el) => el.scrollLeft)) - max) < 5,
    'edge hover reaches final TOC item',
  );
  await p.mouse.move(790, 650);
  await p.locator('#glossary').scrollIntoViewIfNeeded();
  await p.evaluate(() => document.getElementById('glossary')?.scrollIntoView());
  await p.waitForTimeout(200);
  assert.match(await p.locator('.toc-ribbon a[aria-current]').innerText(), /Glossary/);
  // Explicitly simulate a blocked popup to test the full-page fallback.
  await p.evaluate(() => {
    window.open = () => null;
  });
  await p.locator('.diagram-expand').first().click();
  await p.locator('[role=dialog][aria-label="Diagram gallery"]').waitFor();
  const before = await p.getByLabel('Zoom level').innerText();
  await p.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.notEqual(await p.getByLabel('Zoom level').innerText(), before);
  await p.getByRole('button', { name: 'Next diagram', exact: true }).click();
  assert.match(await p.locator('.diagram-toolbar').innerText(), /2\//);
  await p.getByRole('button', { name: 'Close ✕', exact: true }).click();
  assert.equal(await p.locator('.diagram-viewer').count(), 0);
  assert.equal(
    await p.locator('#root').evaluate((el) => {
      if (!(el instanceof HTMLElement)) throw new Error('Expected HTML app root');
      return el.inert;
    }),
    false,
  );
  await p.goto(url('/repl/writes-unbatched'));
  await p.locator('.guide-debug > summary').first().click();
  assert(await p.locator('.reset-session').isDisabled());
  await p.locator('.step-once').click();
  await p.waitForFunction(() => !(document.querySelector('.step-once') as HTMLButtonElement)?.disabled);
  assert.ok((await p.locator('.repl-out').innerText()).includes('200'));
  assert.ok(!(await p.locator('.repl-out').innerText()).includes('160'));
  await chooseScriptedDemo(p);
  await p.locator('.runall').click();
  await p.waitForFunction(() => !(document.querySelector('.runall') as HTMLButtonElement)?.disabled);
  assert.ok((await p.locator('.repl-out').innerText()).includes('160'));
  await p.locator('.reset-session').click();
  assert(await p.locator('.reset-session').isDisabled());
  await p.goto(url('/repl/read-write'));
  await expectVisibleExampleSource(p);
  assert(await p.locator('.pane-primary .cm-editor').nth(2).isVisible());
  const editor = p.locator('.cm-editor').nth(2);
  await editor.locator('.cm-line').filter({ hasText: 'store.usePath' }).first().scrollIntoViewIfNeeded();
  const token = editor.getByText('usePath', { exact: true }).first();
  await token.hover();
  await p.waitForSelector('.cm-tooltip-hover', { timeout: 3000 });
  assert.match(await p.locator('.cm-tooltip-hover').innerText(), /usePath|React|subscrib/i);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'PASS: narrow bottom sheet, TOC edge reach and active heading, diagram fallback/zoom/gallery/focus, real Step and JSX hover',
  );
} finally {
  await b.close();
}
