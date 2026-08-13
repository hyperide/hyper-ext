/**
 * @file Unit tests for detectPreviewProviders — the always-on (no-AI) detector
 *       that wraps the isolated preview in the app's real React context providers
 *       so a leaf/App component renders inside them instead of crashing.
 *
 * Accessed via: extension.ts activate() →
 *   createPreviewFileManager → manager.setProviderWrapAsync(detectPreviewProviders(root))
 *   → preview-generator consumes { imports, wrapOpen, wrapClose } in
 *   buildCanvasPreviewBody to wrap the previewed component.
 *
 * Past bug (HYP-782, unsupported-css-smoke provider-heavy cluster): the detector
 * only knew emotion / styled-components / Tamagui / react-navigation / Gallery
 * providers. Component-library apps that wrap <App/> in main.tsx with a provider
 * the detector did NOT know — MantineProvider (react-vite-mantine-discord), a
 * local ThemeProvider (react-vite-vanilla-extract-reddit), NextUIProvider
 * (react-vite-nextui-netflix) — got `undefined`, so the isolated preview rendered
 * <App/> WITHOUT the provider. The mantine hooks/components then threw
 * ("MantineProvider was not found"), the iframe never painted #root content,
 * isPreviewLoaded stayed false and the readonly-stub Continue button never
 * appeared → 360s e2e timeouts. Fix: a generic fallback that replicates whatever
 * provider element(s) wrap <App/> in the entry render tree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import { detectPreviewProviders, walkAst } from '../extension-provider-detection';

async function writeProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return root;
}

describe('detectPreviewProviders — generic App-wrapping provider replication (HYP-782)', () => {
  const roots: string[] = [];

  beforeEach(() => {
    roots.length = 0;
  });

  afterEach(async () => {
    for (const r of roots) await fs.rm(r, { recursive: true, force: true });
  });

  it('replicates a bare-module provider (MantineProvider) that wraps <App/> in main.tsx', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { theme } from './theme/theme';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>discord</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);

    // Was `undefined` before the fix → isolated <App/> rendered with no
    // MantineProvider → mantine hooks/components threw → blank preview.
    expect(wrap).toBeDefined();
    expect(wrap?.imports.some((l) => l.includes("from '@mantine/core'") && l.includes('MantineProvider'))).toBe(true);
    // Faithful replication: the original opening tag (with its attributes) is kept,
    // and the identifier it references (theme) is imported from the same module.
    expect(wrap?.wrapOpen).toContain('<MantineProvider theme={theme} defaultColorScheme="dark">');
    expect(wrap?.imports.some((l) => l.includes('theme') && l.includes('./theme/theme'))).toBe(true);
    expect(wrap?.wrapClose).toContain('</MantineProvider>');
    // StrictMode/App must NOT be replicated — only the providers between them.
    expect(wrap?.wrapOpen).not.toContain('StrictMode');
    expect(wrap?.wrapOpen).not.toContain('<App');
  });

  it('replicates a required-prop data provider (redux <Provider store>) when the prop is importable', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
      'src/store.ts': `export const store = {} as any;`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<Provider store={store}>');
    expect(wrap?.imports.some((l) => l.includes('Provider') && l.includes('react-redux'))).toBe(true);
    expect(wrap?.imports.some((l) => l.includes('store') && l.includes('./store'))).toBe(true);
  });

  it('does NOT replicate a provider whose required prop is a LOCAL const (would drop the prop → bail)', async () => {
    // <QueryClientProvider client={queryClient}> where queryClient is created
    // inline in main.tsx — we can't import it, and dropping `client` would throw.
    // Bailing keeps the current behavior (no wrap) instead of regressing.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeUndefined();
  });

  it('replicates a LOCAL context provider (ThemeProvider) and rebases its import path', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>reddit</div>; }`,
      'src/context/ThemeContext.tsx': `import { createContext } from 'react';
export function ThemeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);

    expect(wrap).toBeDefined();
    // The preview file lives in the same dir as main.tsx (src/), so the local
    // import must rebase to a path relative to src/.
    expect(wrap?.imports.some((l) => l.includes('ThemeProvider') && l.includes('./context/ThemeContext'))).toBe(true);
    expect(wrap?.wrapOpen).toContain('<ThemeProvider');
    expect(wrap?.wrapClose).toContain('</ThemeProvider>');
  });

  it('picks the App render tree, not the injected CanvasPreviewComp tree, in a @hyperide-managed main.tsx', async () => {
    // The extension patches main.tsx with a SECOND render call that mounts
    // <CanvasPreviewComp/> (no providers). The detector must replicate the
    // original App tree's provider, not the injected one.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';

// @hyperide-managed
if (new URLSearchParams(location.search).get("component") && location.pathname.includes("test-preview")) {
  import("./__canvas_preview__").then(m => {
    const CanvasPreviewComp = m.default;
    if (CanvasPreviewComp)
      createRoot(document.getElementById("root")!).render(<CanvasPreviewComp />);
  }).catch(err => { console.error('[HyperIDE] __canvas_preview__ failed to load:', err); });
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MantineProvider>
        <App />
      </MantineProvider>
    </StrictMode>,
  );
}
`,
      'src/App.tsx': `export default function App() { return <div>discord</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toContain('<MantineProvider');
    expect(wrap?.wrapClose).toContain('</MantineProvider>');
    expect(wrap?.wrapOpen).not.toContain('CanvasPreviewComp');
  });

  it('replicates NESTED providers outer→inner with correctly ordered close tags', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextUIProvider } from '@nextui-org/react';
import { ThemeProvider } from './theme';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NextUIProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </NextUIProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>netflix</div>; }`,
      'src/theme.tsx': `export function ThemeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<NextUIProvider><ThemeProvider>');
    expect(wrap?.wrapClose).toBe('</ThemeProvider></NextUIProvider>');
  });

  it('skips a render-only wrapper (Suspense) so its JSX prop does not veto the inner provider', async () => {
    // Suspense's `fallback={<Spinner/>}` is an unresolvable JSX attribute. The
    // detector must descend THROUGH Suspense (not replicate it) and still wrap
    // in the inner MantineProvider — not bail on Suspense's fallback prop.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Spinner } from './Spinner';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Spinner />}>
      <MantineProvider>
        <App />
      </MantineProvider>
    </Suspense>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
      'src/Spinner.tsx': `export function Spinner() { return <div>...</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<MantineProvider>');
    expect(wrap?.wrapClose).toBe('</MantineProvider>');
    expect(wrap?.wrapOpen).not.toContain('Suspense');
  });

  it('descends through a JSXFragment between the provider and <App/> (fragment child preserved)', async () => {
    // Codex P2 (PRRT_kwDOQSPh9M6MyIoe): an entry that inserts a fragment between the
    // provider and the app — `<MantineProvider><><App/></></MantineProvider>` — made the
    // chain walk stop at the provider, because its only child is a JSXFragment that the
    // child collector dropped. The provider was then treated as the LEAF (chain length 1),
    // the fallback returned undefined, and the isolated preview mounted WITHOUT the provider.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <>
        <App />
      </>
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<MantineProvider>');
    expect(wrap?.wrapClose).toBe('</MantineProvider>');
    // The fragment itself must not be replicated — only the provider between it and App.
    expect(wrap?.wrapOpen).not.toContain('<>');
  });

  it('descends through NESTED fragments between the provider and <App/>', async () => {
    // Locks in the JSXFragment loop branch: multiple stacked fragments must all be skipped
    // until the inner <App/> is reached, still yielding the single wrapping provider.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <>
        <>
          <App />
        </>
      </>
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<MantineProvider>');
    expect(wrap?.wrapClose).toBe('</MantineProvider>');
  });

  it('replicates BOTH providers when a fragment sits BETWEEN them (skips the fragment, keeps the stack)', async () => {
    // Locks in that a fragment mid-stack is skipped while the tag builder still collects every
    // provider around it — `<MantineProvider><><ThemeProvider><App/></ThemeProvider></></MantineProvider>`.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ThemeProvider } from './theme';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </>
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
      'src/theme.tsx': `export function ThemeProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.wrapOpen).toBe('<MantineProvider><ThemeProvider>');
    expect(wrap?.wrapClose).toBe('</ThemeProvider></MantineProvider>');
  });

  it('does NOT replicate a provider with a fragment SIBLING of <App/> (ambiguous → bail, safer)', async () => {
    // Review follow-up: now that fragments are counted as children, a provider whose children
    // are a fragment AND <App/> is ambiguous (2 children) → bail, consistent with the element-
    // sibling safety policy below. (Before the fix the fragment was silently dropped and the
    // provider was replicated around App regardless — an inconsistent special-case.)
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <>
        <span />
      </>
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeUndefined();
  });

  it('does NOT replicate an ambiguous multi-child wrapper (safety — leaves behavior unchanged)', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <Notifications />
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeUndefined();
  });

  it('replicates the entry side-effect STYLESHEET imports so the provider-wrapped preview PAINTS (HYP-782)', async () => {
    // The isolated preview entry replaces main.tsx, so a library app's base
    // stylesheet — loaded only as a side-effect import (`import '@mantine/core/
    // styles.css'`) — was dropped. The provider wrap landed and <App/> rendered
    // STRUCTURALLY, but completely UNSTYLED (a blank-looking canvas), so the
    // e2e readonly-stub screenshot never showed a painted preview. Carry the
    // entry's stylesheet side-effects into the wrap so the preview paints.
    // Only stylesheets are carried — a JS side-effect (`./polyfills`) is NOT,
    // since it can run arbitrary setup / re-register globals.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { theme } from './theme';
import App from './App';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './index.css';
import './polyfills';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>discord</div>; }`,
      'src/theme.ts': `export const theme = {};`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeDefined();
    // Package stylesheet side-effects are carried verbatim (no rebase).
    expect(wrap?.imports).toContain("import '@mantine/core/styles.css';");
    expect(wrap?.imports).toContain("import '@mantine/notifications/styles.css';");
    // A local stylesheet is rebased to the preview dir (src/ → same dir here).
    expect(wrap?.imports.some((l) => /^import '\.\/index\.css';$/.test(l))).toBe(true);
    // A non-stylesheet JS side-effect must NOT be replicated.
    expect(wrap?.imports.some((l) => l.includes('polyfills'))).toBe(false);
    // Stylesheets are emitted BEFORE the provider/component imports so the base
    // styles are present by the time the components mount.
    const styleIdx = wrap!.imports.findIndex((l) => l.includes('styles.css'));
    const providerIdx = wrap!.imports.findIndex((l) => l.includes('MantineProvider'));
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(styleIdx).toBeLessThan(providerIdx);
  });

  it('carries the entry stylesheet alongside a HARDCODED-provider wrap too (emotion ThemeProvider)', async () => {
    // The stylesheet replication is not limited to the generic fallback — an app
    // matching a KNOWN provider (here @emotion/react's ThemeProvider) that also
    // loads a base stylesheet via a side-effect import must paint as well.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@emotion/react';
import { theme } from './theme';
import App from './App';
import './reset.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
      'src/theme.ts': `export const theme = {};`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    // Hardcoded emotion path still wins (EmotionThemeProvider), AND the base
    // stylesheet rides along (was dropped before — emotion path never carried CSS).
    expect(wrap?.imports.some((l) => l.includes('EmotionThemeProvider'))).toBe(true);
    expect(wrap?.imports.some((l) => /^import '\.\/reset\.css';$/.test(l))).toBe(true);
  });

  it('carries .scss / subdir / query / hash stylesheets but NOT a value-form CSS import (?inline)', async () => {
    // A bare cache-busted (`?v=1`) / hashed (`#v1`) / non-css-extension (.scss) /
    // subdir stylesheet is a side-effect injection → carried. A value-form import
    // (`import s from './x.css?inline'`) has a binding and is NOT a style
    // injection → must be excluded.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import './theme.css?v=1';
import './reset.css#v1';
import './styles/global.scss';
import inlineCss from './tokens.css?inline';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.imports).toContain("import './theme.css?v=1';");
    expect(wrap?.imports).toContain("import './reset.css#v1';");
    // .scss in a subdir, rebased relative to the preview dir (src/ → ./styles/global.scss).
    expect(wrap?.imports).toContain("import './styles/global.scss';");
    expect(wrap?.imports.some((l) => l.includes('tokens.css'))).toBe(false);
  });

  it('collects stylesheets from the file that actually mounts the app (App.web.tsx entry)', async () => {
    // collectEntryStyleImports returns on the FIRST context file with a render
    // call. Here main.tsx is not the entry (no render); App.web.tsx mounts the
    // app and owns the base stylesheet — its CSS must be the one carried.
    const root = await writeProject({
      'src/App.web.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import App from './App';
import './native-web.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider>
      <App />
    </MantineProvider>
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap?.imports).toContain("import './native-web.css';");
    expect(wrap?.imports.some((l) => l.includes('MantineProvider'))).toBe(true);
  });

  it('does NOT add stylesheet imports when there is no provider to wrap (CSS rides only with a wrap)', async () => {
    // Stylesheet replication rides only with a provider wrap — when there is no
    // provider to replicate we return undefined (unchanged), so we never inject
    // global CSS into an app the preview wasn't going to wrap.
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>x</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeUndefined();
  });

  it('returns undefined when main.tsx renders <App/> with no wrapping provider (unchanged behavior)', async () => {
    const root = await writeProject({
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
      'src/App.tsx': `export default function App() { return <div>plain</div>; }`,
    });
    roots.push(root);

    const wrap = await detectPreviewProviders(root);
    expect(wrap).toBeUndefined();
  });
});

// HYP-880 review finding: walkAst's signature grew from `(n) => void` to
// `(n) => void | false` (returning `false` skips descending into that node's
// children) so preview-wrapper-scaffold.ts can stop at nested function/class
// boundaries. Pin both halves of the contract: existing void-returning visitors
// must keep descending exactly as before (backward compat), and a visitor that
// returns `false` must actually prune.
describe('walkAst', () => {
  it('a void-returning visitor still descends into every node (backward compat)', () => {
    const ast = babelParse('function f() { function g() { return <Inner/>; } return <Outer/>; }', {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const seen: string[] = [];
    walkAst(ast, (n) => {
      if (n.type === 'JSXElement' && n.openingElement.name.type === 'JSXIdentifier') {
        seen.push(n.openingElement.name.name);
      }
      // No return value (void) — must not be treated as a prune signal.
    });
    // Pre-order: `g` (containing Inner) is the FIRST statement in f's body, visited
    // before the second statement (`return <Outer/>`).
    expect(seen).toEqual(['Inner', 'Outer']);
  });

  it('a visitor returning `false` prunes that subtree', () => {
    const ast = babelParse('function f() { function g() { return <Inner/>; } return <Outer/>; }', {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const seen: string[] = [];
    walkAst(ast, (n) => {
      if (n.type === 'FunctionDeclaration' && n.id?.name === 'g') return false; // prune g's body
      if (n.type === 'JSXElement' && n.openingElement.name.type === 'JSXIdentifier') {
        seen.push(n.openingElement.name.name);
      }
    });
    expect(seen).toEqual(['Outer']);
  });
});
