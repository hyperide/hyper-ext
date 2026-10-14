import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import ts from 'typescript';
import { chromium } from './browser.mts';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<main></main>');
  const source = readFileSync(new URL('../src/lib/page-markdown.ts', import.meta.url), 'utf8').replace(/export function/g, 'function');
  await page.addScriptTag({content: ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText});
  const fixtures = [String.raw`one\|two`, String.raw`two\\|three`, String.raw`C:\temp`, 'plain|pipe'];
  for (const inlineCode of [false, true]) {
    const markdown = await page.evaluate(({fixtures, inlineCode}) => {
      const main = document.querySelector('main')!;
      main.replaceChildren();
      const table = document.createElement('table');
      const tr = document.createElement('tr');
      for (const value of fixtures) {
        const td = document.createElement('td');
        const content = inlineCode ? document.createElement('code') : td;
        content.textContent = value;
        if (inlineCode) td.append(content);
        tr.append(td);
      }
      table.append(tr); main.append(table);
      return (window as unknown as {pageMarkdown(root: Element, url: string): string}).pageMarkdown(main, 'https://state.test/');
    }, {fixtures, inlineCode});
    const html = await marked.parse(markdown);
    const recovered = await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(parsed.querySelectorAll('th'), td => td.textContent?.trim());
    }, html);
    assert.deepEqual(recovered, fixtures, `inlineCode=${inlineCode}\n${markdown}`);
  }
  const ordered = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    main.innerHTML = '<ol start="0"><li>zero</li><li value="7">seven</li><li>eight</li></ol><ol reversed><li>three</li><li>two</li><li>one</li></ol>';
    return (window as unknown as {pageMarkdown(root: Element, url: string): string}).pageMarkdown(main, 'https://state.test/');
  });
  for (const line of ['0. zero', '7. seven', '8. eight', '3. three', '2. two', '1. one']) assert(ordered.includes(line), ordered);
  console.log('Markdown export preserves table code/prose and ordered-list counters');
} finally { await browser.close(); }
