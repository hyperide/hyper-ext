/**
 * @file Framework-reserved file names and preview eligibility constants
 *
 * Accessed via: PreviewFileManager.ensureComponent (filtering out reserved files)
 */

/**
 * Next.js App Router special file names that must not be added to the preview registry.
 * These files have framework-level semantics (metadata exports, error boundaries, etc.)
 * that conflict with being imported as Client Components.
 */
const NEXTJS_APP_ROUTER_RESERVED = new Set([
  'layout.tsx',
  'layout.ts',
  'layout.jsx',
  'layout.js',
  'error.tsx',
  'error.jsx',
  'loading.tsx',
  'loading.jsx',
  'not-found.tsx',
  'not-found.jsx',
  'template.tsx',
  'template.jsx',
  'default.tsx',
  'default.jsx',
]);

/**
 * Remix reserved file names that must not be added to the preview registry.
 * - `root.tsx` renders the full HTML document and uses Remix-specific hooks
 *   (useLoaderData, useNavigate, useLocation) that crash without Remix router context.
 * - `entry.client.tsx` / `entry.server.tsx` are hydration/SSR entry points, not components.
 */
const REMIX_RESERVED = new Set([
  'root.tsx',
  'root.jsx',
  'entry.client.tsx',
  'entry.client.jsx',
  'entry.server.tsx',
  'entry.server.jsx',
]);

/** Check if a filename is a framework-reserved file that must not appear in the preview. */
export function isFrameworkReserved(fileName: string): boolean {
  return NEXTJS_APP_ROUTER_RESERVED.has(fileName) || REMIX_RESERVED.has(fileName);
}

/**
 * Files that look like components by extension+casing but aren't renderable React components:
 *
 * - Platform-specific React Native variants (Foo.native.tsx, Foo.ios.tsx, Foo.android.tsx).
 *   The web bundler resolves the bare `./Foo` to the non-suffixed file. Including the
 *   suffixed variant generates a duplicate `import { Foo } from './Foo.native'` next to
 *   `import { Foo } from './Foo'`, producing "Identifier has already been declared".
 *
 * - vanilla-extract / linaria / stylex style sheets (Foo.css.ts, Foo.css.tsx, Foo.styles.ts,
 *   Foo.module.ts). They start with PascalCase so the basename guard accepts them, but they
 *   export style tokens, not components — `extractComponentName` falls back to the filename
 *   `Foo.css` (with a dot), which then becomes an invalid JS identifier in the import line.
 */
export function isPreviewIneligibleByName(fileName: string): boolean {
  const base = fileName.replace(/\.(tsx?|jsx?)$/, '');
  if (!base.includes('.')) return false;
  const segments = base.split('.');
  const tail = segments.slice(1);
  const PLATFORM_SUFFIXES = new Set(['native', 'ios', 'android']);
  const STYLE_SUFFIXES = new Set(['css', 'styles', 'style', 'module']);
  const TEST_SUFFIXES = new Set(['test', 'spec', 'stories']);
  const SAMPLES_SUFFIXES = new Set(['samples']);
  return tail.some(
    (seg) =>
      PLATFORM_SUFFIXES.has(seg) || STYLE_SUFFIXES.has(seg) || TEST_SUFFIXES.has(seg) || SAMPLES_SUFFIXES.has(seg),
  );
}

export function isExplicitWebAppShell(componentPath: string): boolean {
  return /^App\.web\.[jt]sx$/.test(componentPath);
}
