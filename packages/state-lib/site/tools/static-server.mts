import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
/** The same file-first semantics as cleanUrls on Vercel. SPA fallback is only
 * used while prerendering, never to answer a missing .md or asset with HTML. */
export async function serveStatic(directory: string, fallback = false, port = 0) {
  const root = resolve(directory);
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.svg': 'image/svg+xml',
  };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      const local = resolve(root, `.${path}`);
      if (local !== root && !local.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const candidates = [local, `${local}.html`, resolve(local, 'index.html')];
      if (fallback && !extname(path)) candidates.push(resolve(root, 'index.html'));
      let file: string | undefined;
      for (const candidate of candidates) {
        try {
          if ((await stat(candidate)).isFile()) {
            file = candidate;
            break;
          }
        } catch {}
      }
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        Link: '</llms.txt>; rel="describedby"',
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(500).end('Unable to read static file');
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
  return { url, close: () => new Promise<void>((r, e) => server.close((error) => (error ? e(error) : r()))) };
}
