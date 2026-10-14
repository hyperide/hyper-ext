import { chooseScriptedDemo, expectVisibleExampleSource } from './workbench-fixture.mts';
/**
 * Gate: the editor's hover answers what a debugger's would (R81).
 *
 * Three things, and the third is the one that is easy to lose: the identifier
 * the pointer is over, what it is, and what it held AT THE STEP BEING SHOWN
 * rather than at the end of the run. The last is the only reason to record
 * frames at all, so it is checked at two different steps with different values.
 *
 * Hovering goes through mouse coordinates, not element.hover(): the textarea
 * sits on top of the highlighted layer and intercepts, which is exactly why the
 * page reads its target with elementsFromPoint.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

let bad = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
p.on('pageerror', (e: Error) => {
  bad++;
  console.log(`  FAIL pageerror: ${e.message}`);
});

await p.goto(`file://${dist}#/repl/undo`);
await expectVisibleExampleSource(p);
await p.waitForTimeout(600);
await chooseScriptedDemo(p);
await p.locator('.pane-primary .runall').click();
await p.locator('.pane-primary .guide-debug > summary').click();
await p.waitForTimeout(900);

/** The scrubber is the debugger's cursor: a range input the page reads on `input`. */
const stepTo = async (i: number) => {
  await p.$eval(
    '.repl-scrub',
    (el: Element, v: number) => {
      // React tracks the input's value through the prototype setter; assigning
      // `.value` directly is invisible to it and the change event never fires.
      const r = el as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(r, String(v));
      r.dispatchEvent(new Event('input', { bubbles: true }));
    },
    i,
  );
  await p.waitForTimeout(250);
};
const total = Number(await p.$eval('.repl-scrub', (el: Element) => (el as HTMLInputElement).max).catch(() => '0')) + 1;
check('the run recorded steps', total > 4, String(total));

/**
 * Move the pointer onto an occurrence of `id` in the editor and read whatever
 * popup appears. CodeMirror renders each line as a run of spans with no stable
 * hook per token, so the position is found by measuring the character offset
 * inside the line rather than by selecting an element.
 */
const hoverId = async (id: string) => {
  const found = await p.evaluate((name: string) => {
    // A Range over the actual text node, not the line's box: `.cm-line` is a
    // block that fills the editor's width, so dividing that width by the
    // character count puts the pointer well past the token. Measuring the
    // glyphs is the only way to land on one.
    const walk = document.createTreeWalker(document.querySelector('.source-editor .cm-content')!, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walk.nextNode())) {
      const text = node.textContent ?? '';
      const at = text.indexOf(name);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + name.length);
      // A token below the fold cannot be hovered: the pointer never reaches it.
      // `instant`, not the default: the page has smooth scrolling on, which makes
      // scrollIntoView asynchronous — the rect read on the next line would be
      // measured before the scroll happened, and the pointer would land where the
      // token used to be.
      (node.parentElement as HTMLElement).scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, id);
  if (!found) return null;
  // Leave so any previous tooltip closes, then settle on the token: CodeMirror's
  // hover only fires once the pointer has rested.
  await p.mouse.move(2, 2);
  await p.waitForTimeout(350);
  await p.mouse.move(found.x - 3, found.y);
  await p.mouse.move(found.x, found.y);
  await p.waitForTimeout(700);
  return p.evaluate(() => {
    const h = document.querySelector('.cm-tooltip .repl-hover');
    return h ? { sig: h.querySelector('.repl-hover-sig')?.textContent ?? '', body: h.textContent ?? '' } : null;
  });
};

console.log('\nthe editor is a real editor');
{
  check('CodeMirror mounted', (await p.$$('.cm-editor')).length > 0);
  check('with a line gutter', (await p.$$('.cm-gutters')).length > 0);
}

console.log('\na name the toolkit defines');
{
  const h = await hoverId('snapshot');
  check('shows a signature', !!h && h.sig.includes('snapshot('), h?.sig ?? 'no hover');
  check('and says what it does', !!h && h.body.includes('structuredClone'), (h?.body ?? '').slice(0, 80));
}

console.log("\na member reached through its receiver, with the compiler's own signature");
{
  const h = await hoverId('redo');
  check('store.redo resolves through the receiver', !!h && h.sig.includes('redo(): boolean'), h?.sig ?? 'no hover');
}

console.log('\na name the reader declared');
{
  const h = await hoverId('store');
  check('infers its type from the value', !!h && h.sig.includes('Store'), h?.sig ?? 'no hover');
  check('and shows the value at this step', !!h && h.body.includes('value at this step'), (h?.body ?? '').slice(0, 60));
}

console.log('\nthe debugger marks the line it is stopped on');
{
  await stepTo(3);
  check('the current statement is marked in the editor', (await p.$$('.cm-stepline')).length === 1);
  // Clicking a line in the editor stops on the statement that starts there —
  // this replaced a list that repeated every statement under the editor.
  const target = await p.evaluate(() => {
    const lines = [...document.querySelectorAll('.source-editor .cm-content .cm-line')];
    const last = lines[lines.length - 1] as HTMLElement;
    last.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = last.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2, n: lines.length };
  });
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(300);
  const marked = await p.evaluate(() => {
    const lines = [...document.querySelectorAll('.source-editor .cm-content .cm-line')];
    return lines.findIndex((l) => l.classList.contains('cm-stepline')) + 1;
  });
  check(`clicking the last line stops on it (line ${marked} of ${target.n})`, marked === target.n, String(marked));
}

console.log('\nthe value follows the step, which is the whole point');
{
  await stepTo(1);
  const early = await hoverId('store');
  await stepTo(total - 1);
  const late = await hoverId('store');
  check('both steps report a value', !!early?.body && !!late?.body);
  check('and the two differ', early?.body !== late?.body, 'the hover is showing the same value at every step');
}

console.log('\ncompletion knows the toolkit');
{
  await p.click('.source-editor .cm-content');
  await p.keyboard.press('Control+End');
  await p.keyboard.type('\nstore.sna');
  await p.waitForTimeout(600);
  const opts: string[] = await p.$$eval('.cm-tooltip-autocomplete li', (e: Element[]) =>
    e.map((x) => x.textContent ?? ''),
  );
  check('offers a completion', opts.length > 0, opts.join(' | '));
  check(
    'and it carries the signature',
    opts.some((o) => o.includes('snapshot(')),
    opts.join(' | '),
  );
}

await b.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nthe hover reports type, definition and the value at the step');
process.exit(bad ? 1 : 0);
