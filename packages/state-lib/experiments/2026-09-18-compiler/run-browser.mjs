import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '../../build-tools/node_modules/playwright/index.mjs';
const root = new URL('./', import.meta.url),
  results = [];
const allowed = new Set(['compute.mjs', 'worker.mjs', 'browser-probe.mjs', 'numeric.wasm', 'strings.wasm', 'simd.wasm']);
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost'),
    isolatedResource = url.pathname.startsWith('/isolated/'),
    path = isolatedResource ? url.pathname.slice('/isolated'.length) : url.pathname;
  if (isolatedResource) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/' || path === '/isolated') {
    response.setHeader('Content-Type', 'text/html');
    return response.end('<!doctype html><title>Isolated state research</title><h1>Local synthetic state research</h1>');
  }
  if (!allowed.has(path.slice(1))) {
    response.statusCode = 404;
    return response.end('Not found');
  }
  response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  response.end(readFileSync(new URL(path.slice(1), root)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ]) {
    if(process.env.STATE_ENGINES && !process.env.STATE_ENGINES.split(',').includes(name)) continue;
    let browser;
    try {
      browser = await type.launch();
    } catch (error) {
      results.push({ browser: name, status: 'unavailable', reason: String(error).split('\n')[0] });
      continue;
    }
    try {
      for (const isolated of [false, true]) {
        if(process.env.STATE_ISOLATED==='only' && !isolated)continue;
        const context = await browser.newContext(),
          page = await context.newPage();
        await page.goto(base + (isolated ? '/isolated/' : '/'));
        const result = await page.evaluate(() => import(new URL('browser-probe.mjs', location.href).href).then((module) => module.run()));
        results.push({
          browser: name,
          version: browser.version(),
          isolationRequested: isolated,
          status: 'measured',
          ...result,
        });
        console.log(
          name,
          isolated,
          result.capability,
          result.numeric
            .filter((r) => r.count === 1000000)
            .map((r) => ({
              executor: r.executor,
              medianMs: r.medianMs,
              p95Ms: r.p95Ms,
              startupMs: r.startupAndIngestMs,
            })),
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
  writeFileSync(
    new URL('./results/'+(process.env.STATE_RESULT_NAME||'browser-platform')+'.json', root),
    JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2) + '\n',
  );
}
