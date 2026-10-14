import { createRequire } from 'node:module';
import type { ConsoleMessage } from 'playwright';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1100 } });
p.on('pageerror', (e: Error) => console.error('PAGEERROR', e.message));
p.on('console', (m: ConsoleMessage) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});
await p.goto(`file://${dist}#/playground`);
await p.waitForTimeout(500);
// click three checkboxes in the prototype column so the log has content
const boxes = await p.$$('.pg-col:nth-child(3) input[type=checkbox]');
console.log('checkboxes found:', boxes.length);
for (const box of boxes.slice(0, 3)) {
  await box.click();
  await p.waitForTimeout(120);
}
await p.waitForTimeout(300);
// undo once, so the undone row is visible
const undo = await p.$('button:has-text("undo")');
if (undo) {
  await undo.click();
  await p.waitForTimeout(250);
}
await p.screenshot({ path: join(here, '.figures/page-playground.png'), fullPage: true });
console.log('shot playground');
await b.close();
