import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { marked } from 'marked';
import { highlightHtml } from '../src/lib/highlight';

const diagram = '+-------+\n| State |\n+-------+';
const block = `<pre><code class="language-text">${diagram}</code></pre>`;
const cases = [
  { heading: '<em>Safe</em> &amp; sound', text: 'Safe & sound — diagram' },
  { heading: '<a title="a > b">Safe label</a>', text: 'Safe label — diagram' },
  { heading: 'State <script', text: 'State  — diagram' },
  { heading: '<scr<script>ipt>alert(1)</scr</script>ipt> State', text: 'ipt>alert(1)ipt> State — diagram' },
  { heading: '<b><i>Nested formatting</i></b>', text: 'Nested formatting — diagram' },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 850, height: 450 } });
  for (const [index, fixture] of cases.entries()) {
    const rendered = highlightHtml(`<h2>${fixture.heading}</h2>${block}`);
    const figure = rendered.slice(rendered.indexOf('<figure'));
    assert(figure.startsWith('<figure'), 'the fixture must exercise the real diagram path');
    const parsed = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return {
        caption: template.content.querySelector('figcaption')?.textContent,
        active: template.content.querySelectorAll('script,iframe,object,[onerror],[onload]').length,
      };
    }, figure);
    assert.equal(parsed.active, 0, 'captions and source remain inert, including malformed markup');
    if (index === 1) {
      await page.setContent(`<main style="font-family:system-ui;padding:32px">${figure}</main>`);
      mkdirSync('tools/artifacts', { recursive: true });
      await page.screenshot({ path: 'tools/artifacts/heading-caption.png' });
    }
    assert.equal(
      parsed.caption,
      fixture.text,
      'caption extraction must respect quoted attributes and discard unfinished tags',
    );
  }
  for (const [heading, expected] of [
    ["<!-- author's note -->State", 'State — diagram'],
    ['<!-- "quoted > note" -->State<!-- trailing comment -->', 'State — diagram'],
    ['<!-- first -->One <!-- second -->two', 'One two — diagram'],
    ['<a title="<!-- quoted attribute -->">State</a>', 'State — diagram'],
  ]) {
    const markdown = `## ${heading}\n\n\`\`\`text\n${diagram}\n\`\`\`\n`;
    const rendered = highlightHtml(marked.parse(markdown) as string);
    const caption = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return template.content.querySelector('figcaption')?.textContent;
    }, rendered);
    assert.equal(caption, expected, 'real Markdown heading comments must not swallow subsequent text');
  }
  const two = highlightHtml(`<h2>First</h2>${block}<h2><strong>Second</strong></h2>${block}`);
  const captions = await page.evaluate((html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return [...template.content.querySelectorAll('figcaption')].map((node) => node.textContent);
  }, two);
  assert.deepEqual(captions, ['First — diagram', 'Second — diagram']);
} finally {
  await browser.close();
}
console.info('diagram captions remove nested markup without losing text, heading association or final escaping');
