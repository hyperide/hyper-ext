/** Shared menu closes on first Escape, including populated type=search on Chromium. */
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mts';
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
let cases = 0;
try {
  for (const browserType of [chromium, webkit]) {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await page.goto(`${server.url}/api`);
      for (const trigger of ['.navcurrent', '.navsection', '.nav-menu-search']) {
        for (const query of ['', 'signal']) {
          await page.locator(trigger).click();
          await page.locator('.searchinput').fill(query);
          await page.locator('.searchinput').press('Escape');
          await page.waitForFunction(() => !document.querySelector('#site-menu[open]'), undefined, { timeout: 1500 });
          assert.equal(
            await page.evaluate((selector) => document.activeElement === document.querySelector(selector), trigger),
            true,
            `${browserType.name()} must restore ${trigger} focus`,
          );
          cases++;
        }
      }
    } finally {
      await browser.close();
    }
  }
  console.info(`PASS: ${cases} empty/populated Escape and originating-trigger focus cases across Chromium/WebKit`);
} finally {
  await server.close();
}
