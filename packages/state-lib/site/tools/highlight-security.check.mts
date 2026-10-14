import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { highlight } from '../src/lib/highlight';

const samples = [
  'const x = `<script>${{}}</script>`;',
  '`escaped \\` backtick`',
  '`line\\\ncontinuation`',
  '<Button value="a&b"/>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<img src=x onerror="alert(1)">',
  '&lt;script&gt; &amp; &#60;script&#62;',
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const source of samples) {
    const parsed = await page.evaluate((html) => {
      // Parse in an inert fragment; never attach potentially broken output to the page.
      const template = document.createElement('template');
      template.innerHTML = html;
      return {
        text: template.content.textContent,
        safe: Array.from(template.content.querySelectorAll('*')).every(
          (element) =>
            element.tagName === 'SPAN' &&
            Array.from(element.attributes).every((attr) => attr.name === 'class' || attr.name === 'data-id'),
        ),
      };
    }, highlight(source));
    assert.equal(parsed.text, source);
    assert.equal(parsed.safe, true, 'highlighting must produce only inert token spans');
  }
} finally {
  await browser.close();
}
// A hard process timeout tests nontermination/backtracking, not a speed ranking.
const moduleUrl = new URL('../src/lib/highlight.ts', import.meta.url).href;
const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    `import { highlight } from ${JSON.stringify(moduleUrl)}; highlight('\x60' + '\x24{{}}'.repeat(20000));`,
  ],
  { encoding: 'utf8', timeout: 5000 },
);
assert.equal(result.status, 0, String(result.error ?? result.stderr));
console.log('highlighter emits inert, lossless DOM and terminates on adversarial template text');
