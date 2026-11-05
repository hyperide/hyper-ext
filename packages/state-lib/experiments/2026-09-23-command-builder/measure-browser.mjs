import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from '../../build-tools/node_modules/playwright/index.mjs';
const root = fileURLToPath(new URL('./', import.meta.url));
const input = JSON.parse(readFileSync(resolve(root, 'results/controller.json'), 'utf8'));
for (const [name, expected] of Object.entries(input.hashes)) {
  const relative = name.startsWith('core/') ? 'src/' + name : 'src/state-lib/dist/' + name.slice('runtime/'.length);
  if (
    createHash('sha256')
      .update(readFileSync(resolve(root, 'fixture', relative)))
      .digest('hex') !== expected
  )
    throw Error('Stale measured input ' + name);
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Synthetic command experiment</title>');
    return;
  }
  const file = resolve(root, '.' + decodeURIComponent(path));
  if (
    !file.startsWith(root) ||
    (!file.endsWith('.mjs') && !file.endsWith('.js')) ||
    !(/\/fixture\//.test(file) || file === resolve(root, 'browser-workload.mjs'))
  ) {
    res.statusCode = 404;
    res.end();
    return;
  }
  try {
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port,
  results = [];
try {
  for (const [name, engine] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.goto(origin);
      const result = await page.evaluate(() => import('/browser-workload.mjs').then((module) => module.run()));
      results.push({ engine: name, version: browser.version(), ...result });
      console.log(
        name,
        browser.version(),
        JSON.stringify(
          result.raw
            .filter((row) => row.count === 1200)
            .map(({ operation, backend, medianMs }) => ({ operation, backend, medianMs })),
        ),
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
  writeFileSync(
    resolve(root, 'results/browser-controller.json'),
    JSON.stringify({ date: new Date().toISOString(), hashes: input.hashes, results }, null, 2) + '\n',
  );
}
