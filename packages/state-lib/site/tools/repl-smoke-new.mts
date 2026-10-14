import { chooseScriptedDemo } from './workbench-fixture.mts';
import { chromium } from './browser.mts';
import { EXAMPLES } from '../src/data/examples';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
const failures: string[] = [];
p.on('pageerror', (e) => failures.push(`page: ${e.message}`));
try {
  for (const ex of EXAMPLES) {
    await p.goto(`file://${process.cwd()}/dist/index.html#/repl/${ex.id}`);
    await chooseScriptedDemo(p);
    await p.locator('.pane-primary .runall').click();
    await p.waitForFunction(
      () => !(document.querySelector('.pane-primary .runall') as HTMLButtonElement)?.disabled,
      {},
      { timeout: 15000 },
    );
    await p.waitForTimeout(70);
    const errors = await p.locator('.pane-primary .repl-err').allTextContents();
    if (errors.length) failures.push(`${ex.id}: ${errors.join(';')}`);
    console.log(ex.id, errors.length ? `FAIL ${errors.join(';')}` : 'PASS');
  }
  if (failures.length) throw new Error(failures.join('\n'));
} finally {
  await b.close();
}
