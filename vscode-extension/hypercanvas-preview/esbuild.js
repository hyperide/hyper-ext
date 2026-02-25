const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const rootDir = path.resolve(__dirname, '../..');

const extensions = ['.tsx', '.ts', '.jsx', '.js', ''];

function resolveWithExtensions(basePath) {
  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  // Try index files (when basePath is a directory)
  for (const ext of extensions) {
    if (!ext) continue;
    const indexPath = path.join(basePath, 'index' + ext);
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }
  return basePath;
}

/** Shared resolve aliases for @/, @shared/, @lib/ */
function createResolveAliasesPlugin(extra) {
  return {
    name: 'resolve-aliases',
    setup(build) {
      // Handle @/ imports -> root/client/
      build.onResolve({ filter: /^@\// }, (args) => {
        const resolved = args.path.replace(/^@\//, '');
        return { path: resolveWithExtensions(path.join(rootDir, 'client', resolved)) };
      });

      // Handle @shared/ imports -> root/shared/
      build.onResolve({ filter: /^@shared\// }, (args) => {
        const resolved = args.path.replace(/^@shared\//, '');
        return { path: resolveWithExtensions(path.join(rootDir, 'shared', resolved)) };
      });

      // Handle @lib/ imports -> root/lib/
      build.onResolve({ filter: /^@lib\// }, (args) => {
        const resolved = args.path.replace(/^@lib\//, '');
        return { path: resolveWithExtensions(path.join(rootDir, 'lib', resolved)) };
      });

      if (extra) extra(build);
    },
  };
}

/** Shared esbuild plugins for webview builds (React singleton + authFetch stub) */
function createWebviewPlugins() {
  return [
    createResolveAliasesPlugin((build) => {
      // Force single React instance — prevent duplicate React from
      // @/ and @shared/ imports resolving to root node_modules
      const localNodeModules = path.resolve(__dirname, 'node_modules');
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
        return { path: require.resolve(args.path, { paths: [localNodeModules] }) };
      });

      // Stub out authFetch for webview builds (not needed in VSCode context)
      build.onResolve({ filter: /utils\/authFetch/ }, () => {
        return { path: path.resolve(__dirname, 'src/stubs/authFetch.ts') };
      });

      // Stub out SaaS-only modules for shared LeftSidebar
      build.onResolve({ filter: /contexts\/ComponentMetaContext/ }, () => {
        return { path: path.resolve(__dirname, 'src/stubs/saas-only.ts') };
      });
      build.onResolve({ filter: /stores\/gitStore/ }, () => {
        return { path: path.resolve(__dirname, 'src/stubs/saas-only.ts') };
      });
      build.onResolve({ filter: /components\/SidebarHeader/ }, () => {
        return { path: path.resolve(__dirname, 'src/stubs/SidebarHeader.tsx') };
      });
      build.onResolve({ filter: /components\/SourceControlSection/ }, () => {
        return { path: path.resolve(__dirname, 'src/stubs/SourceControlSection.tsx') };
      });
    }),
  ];
}

async function main() {
  // Extension (Node.js) build
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'info',
    plugins: [createResolveAliasesPlugin()],
  });

  // Webview (browser) build — React app for logs + AI chat panel
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/index.tsx'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview.js',
    jsx: 'automatic',
    logLevel: 'info',
    plugins: createWebviewPlugins(),
  });

  // Webview-left (browser) build — React app for left panel (explorer)
  const webviewLeftCtx = await esbuild.context({
    entryPoints: ['src/webview-left/index.tsx'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview-left.js',
    jsx: 'automatic',
    logLevel: 'info',
    plugins: createWebviewPlugins(),
  });

  // Webview-right (browser) build — React app for right panel (inspector)
  const webviewRightCtx = await esbuild.context({
    entryPoints: ['src/webview-right/index.tsx'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview-right.js',
    jsx: 'automatic',
    logLevel: 'info',
    plugins: createWebviewPlugins(),
  });

  // Webview-preview-panel (browser) build — React app for preview panel
  const webviewPreviewPanelCtx = await esbuild.context({
    entryPoints: ['src/webview-preview-panel/index.tsx'],
    bundle: true,
    format: 'esm',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'out/webview-preview-panel.js',
    jsx: 'automatic',
    logLevel: 'info',
    plugins: createWebviewPlugins(),
  });

  // Iframe interaction script (IIFE) — injected into preview iframe by PreviewProxy
  const iframeInteractionCtx = await esbuild.context({
    entryPoints: ['src/services/scripts/iframe-interaction.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    platform: 'browser',
    outfile: 'out/iframe-interaction.js',
    logLevel: 'info',
    plugins: [createResolveAliasesPlugin()],
  });

  // Iframe error detection script (IIFE) — injected into preview iframe by PreviewProxy
  const iframeErrorDetectionCtx = await esbuild.context({
    entryPoints: ['src/services/scripts/iframe-error-detection.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    platform: 'browser',
    outfile: 'out/iframe-error-detection.js',
    logLevel: 'info',
    plugins: [createResolveAliasesPlugin()],
  });

  const allContexts = [extensionCtx, webviewCtx, webviewLeftCtx, webviewRightCtx, webviewPreviewPanelCtx, iframeInteractionCtx, iframeErrorDetectionCtx];

  if (watch) {
    await Promise.all(allContexts.map(ctx => ctx.watch()));
    console.log('Watching for changes...');
  } else {
    await Promise.all(allContexts.map(ctx => ctx.rebuild()));
    await Promise.all(allContexts.map(ctx => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
