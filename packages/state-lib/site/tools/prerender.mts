/** Served build = real static HTML + progressive React interactions. No bot-only
 * alternate page, request-time server, or dependency on JavaScript for reading. */
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROUTES } from '../src/lib/routes';
import { EXAMPLES } from '../src/data/examples';
import { LIBS } from '../src/data/compare';
import { serveStatic } from './static-server.mts';
const origin = (process.env.SITE_URL ?? 'https://state-lib.vercel.app').replace(/\/$/, '');
export const routes = [
  ...new Set([
    '/',
    ...ROUTES.map(([r]) => r),
    '/playground',
    '/lib',
    '/validation',
    '/repl/snippet',
    '/concepts/practical',
    ...EXAMPLES.map((e) => `/repl/${e.id}`),
    ...LIBS.filter((l) => l.id !== 'state').map((l) => `/lib/${l.id}`),
  ]),
];
export async function prerender(directory = 'dist-served', selectedRoutes = routes) {
  const out = resolve(directory);
  const server = await serveStatic(out, true);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', (route) =>
    route.request().url().startsWith(server.url) ? route.continue() : route.abort(),
  );
  const manifest: { route: string; title: string; markdown: string; sha256: string; bytes: number }[] = [];
  const all: string[] = [];
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  try {
    for (const route of selectedRoutes) {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(server.url + route, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#page-content h1') && !!window.__STATE_DOCS__);
      if ((route.startsWith('/repl') && route !== '/repl/snippet') || route === '/playground')
        await page.waitForSelector('.cm-editor', { state: 'attached' }); // Editors intentionally begin inside collapsed advanced-source details.
      await page.waitForTimeout(100);
      if (errors.length) throw new Error(`${route}: ${errors.join('; ')}`);
      const markdown = await page.evaluate(() => window.__STATE_DOCS__!.markdown());
      const title =
        EXAMPLES.find((e) => route === `/repl/${e.id}`)?.title ??
        (await page.locator('#page-content h1').first().innerText());
      await page.evaluate(() => {
        document
          .querySelectorAll(
            'link[rel="canonical"], link[rel="alternate"][type="text/markdown"], link[rel="describedby"]',
          )
          .forEach((link) => link.remove());
      });
      const html = await page.content();
      const path = route === '/' ? 'index' : route.slice(1),
        mdPath = `/${path}.md`;
      const filename = resolve(out, `${path}.html`);
      await mkdir(dirname(filename), { recursive: true });
      const clean = html
        .replace(/class="js-enabled"/g, '')
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)} · state</title>`)
        .replace(
          '</head>',
          `<link rel="canonical" href="${escape(origin + route)}"><link rel="alternate" type="text/markdown" href="${mdPath}"><link rel="describedby" href="/llms.txt"></head>`,
        );
      await writeFile(filename, clean);
      await writeFile(resolve(out, `${path}.md`), markdown);
      manifest.push({
        route,
        title,
        markdown: mdPath,
        sha256: createHash('sha256').update(markdown).digest('hex'),
        bytes: Buffer.byteLength(markdown),
      });
      all.push(`<!-- Source: ${origin + route} -->\n\n${markdown}`);
      await page.close();
    }
    const index = `# state documentation\n\n> Client-state toolkit specification, research and executable prototype. Designed and planned APIs are not shipping implementations.\n\nRead a topic page rather than the complete corpus when possible. Examples run locally in the REPL; Electric walkthroughs identify simulation versus a real service.\n\n## Documentation\n\n${manifest
      .filter((m) => !m.route.startsWith('/repl/'))
      .map((m) => `- [${m.title}](${origin + m.markdown}): ${m.route}`)
      .join('\n')}\n\n## Executable examples\n\n${manifest
      .filter((m) => m.route.startsWith('/repl/'))
      .map((m) => `- [${m.title}](${origin + m.markdown}): code, scaffolding and explanation`)
      .join('\n')}\n\n## Optional\n\n- [Complete corpus](${origin}/llms-full.txt): larger combined export\n`;
    await writeFile(resolve(out, 'llms.txt'), index);
    await writeFile(resolve(out, 'llms-full.txt'), all.join('\n\n---\n\n'));
    await writeFile(
      resolve(out, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${manifest
        .map((m) => `<url><loc>${escape(origin + m.route)}</loc></url>`)
        .join('')}</urlset>`,
    );
    await writeFile(resolve(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    await writeFile(resolve(out, 'export-manifest.json'), JSON.stringify(manifest, null, 2));
    await writeFile(
      resolve(out, '404.html'),
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found · state</title><h1>Page not found</h1><p><a href="/">Documentation home</a> · <a href="/llms.txt">Documentation index</a></p></html>',
    );
    console.log(
      `SSG: ${manifest.length} HTML pages, ${manifest.length} Markdown pages, llms.txt, llms-full.txt, sitemap.xml`,
    );
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prerender();
