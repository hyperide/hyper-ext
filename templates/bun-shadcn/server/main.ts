import { serve } from 'bun';

const server = serve({
  port: 8080,

  // Enable HMR
  development: {
    hmr: true,
    console: true,
  },

  // HTML routes with automatic bundling and HMR
  routes: {
    '/': './index.html',
  },

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Serve static files from client directory
    if (pathname.startsWith('/client/')) {
      const filePath = `.${pathname}`;
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // Serve index.html for SPA routing
    if (pathname === '/' || !pathname.includes('.')) {
      const indexFile = Bun.file('./index.html');
      const html = await indexFile.text();

      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[Bun] Server running on http://localhost:${server.port}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
