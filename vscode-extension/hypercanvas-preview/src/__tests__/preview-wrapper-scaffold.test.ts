/**
 * @file Unit tests for the static preview-wrapper scaffold generator (HYP-880).
 *
 * Fixtures are real files in a mkdtemp workspace (the generator reads from
 * disk). The conloca-app fixture mirrors the real repo that motivated the
 * feature: providers split across src/main.tsx and src/app/App.tsx, all
 * provider attrs referencing locals (unresolvable → TODO stubs, HYP-880), plus a
 * test-utils render helper the scaffold must point at.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { parse as babelParse } from '@babel/parser';
import { buildPreviewWrapperScaffold, findTestRenderHelper } from '../services/preview-wrapper-scaffold';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wrapper-scaffold-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content, 'utf-8');
  }
  return root;
}

/** The generated file must at least parse as TSX and export PreviewWrapper. */
function expectValidWrapperModule(content: string): void {
  expect(() => babelParse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  expect(content).toContain('export function PreviewWrapper({ children }: { children: ReactNode })');
  expect(content).toContain('return children;');
  expect(content.startsWith('// @hyperide-managed @hyperide-scaffold')).toBe(true);
}

// ============================================================================
// conloca-app shaped fixture (the motivating real project, tg#5871 / HYP-876)
// ============================================================================

const CONLOCA_MAIN = `import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { HostClientProvider, HttpHostClientOptionsProvider, httpHostClient } from './app/host-client';
import { hostQueryClient } from './app/queries/host-query-client';

const httpOptions = { backendHost: 'http://localhost:8787' };
const hostClient = httpHostClient(httpOptions);

createRoot(document.getElementById('app-root')!).render(
  <StrictMode>
    <QueryClientProvider client={hostQueryClient}>
      <HttpHostClientOptionsProvider options={httpOptions}>
        <HostClientProvider client={hostClient}>
          <App />
        </HostClientProvider>
      </HttpHostClientOptionsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
`;

const CONLOCA_APP = `import { Toaster } from '@conloca/cms-spa/toast';
import AppErrorBoundary from './AppErrorBoundary';
import { AuthProvider } from './auth/use-auth';
import { FeatureFlagsProvider } from './feature-flags';
import WorkspaceRouter from './workspace/WorkspaceRouter';

export default function App({ initialAuthState }: { initialAuthState?: unknown } = {}) {
  const flagSearch = undefined;
  return (
    <>
      <AppErrorBoundary>
        <FeatureFlagsProvider search={flagSearch}>
          <AuthProvider initialState={initialAuthState}>
            <WorkspaceRouter />
          </AuthProvider>
        </FeatureFlagsProvider>
      </AppErrorBoundary>
      <Toaster />
    </>
  );
}
`;

async function makeConlocaWorkspace(): Promise<string> {
  return makeWorkspace({
    'src/main.tsx': CONLOCA_MAIN,
    'src/app/App.tsx': CONLOCA_APP,
    'src/app/test-utils/render-with-host-providers.tsx': '// test render helper fixture\n',
  });
}

describe('buildPreviewWrapperScaffold — conloca-app shaped project', () => {
  test('collects the full provider chain across main.tsx AND App.tsx, outer → inner', async () => {
    const scaffold = await buildPreviewWrapperScaffold(await makeConlocaWorkspace());
    expect(scaffold).not.toBeNull();
    expect(scaffold!.providerNames).toEqual([
      'QueryClientProvider',
      'HttpHostClientOptionsProvider',
      'HostClientProvider',
      'FeatureFlagsProvider',
      'AuthProvider',
    ]);
    expect(scaffold!.sourceFiles).toEqual(['src/main.tsx', 'src/app/App.tsx']);
  });

  test('emits a valid pass-through module with the stack commented out', async () => {
    const scaffold = await buildPreviewWrapperScaffold(await makeConlocaWorkspace());
    expectValidWrapperModule(scaffold!.content);
    // The stack keeps the original attributes verbatim inside the commented JSX.
    expect(scaffold!.content).toContain('//   <QueryClientProvider client={hostQueryClient}>');
    expect(scaffold!.content).toContain(`//   ${'  '.repeat(5)}{children}`);
    expect(scaffold!.content).toContain('//   </QueryClientProvider>');
    // StrictMode / AppErrorBoundary / Toaster are NOT providers — never scaffolded.
    expect(scaffold!.content).not.toContain('StrictMode');
    expect(scaffold!.content).not.toContain('AppErrorBoundary');
    expect(scaffold!.content).not.toContain('Toaster');
  });

  test('rebases provider imports relative to .hyperide/ and keeps package imports verbatim', async () => {
    const scaffold = await buildPreviewWrapperScaffold(await makeConlocaWorkspace());
    expect(scaffold!.content).toContain("// import { QueryClientProvider } from '@tanstack/react-query';");
    expect(scaffold!.content).toContain("// import { HostClientProvider } from '../src/app/host-client';");
    expect(scaffold!.content).toContain("// import { AuthProvider } from '../src/app/auth/use-auth';");
    expect(scaffold!.content).toContain("// import { FeatureFlagsProvider } from '../src/app/feature-flags';");
  });

  test('lists every unresolvable attr value as a TODO stub with its source file (HYP-880)', async () => {
    const scaffold = await buildPreviewWrapperScaffold(await makeConlocaWorkspace());
    expect(scaffold!.content).toContain('Stub data you need to provide:');
    expect(scaffold!.content).toContain('`httpOptions` — defined locally in src/main.tsx');
    expect(scaffold!.content).toContain('`hostClient` — defined locally in src/main.tsx');
    expect(scaffold!.content).toContain('`flagSearch` — defined locally in src/app/App.tsx');
    expect(scaffold!.content).toContain('`initialAuthState` — defined locally in src/app/App.tsx');
  });

  test('points at the detected test render helper', async () => {
    const scaffold = await buildPreviewWrapperScaffold(await makeConlocaWorkspace());
    expect(scaffold!.testRenderHelper).toBe('src/app/test-utils/render-with-host-providers.tsx');
    expect(scaffold!.content).toContain('TIP: src/app/test-utils/render-with-host-providers.tsx');
  });

  test('is deterministic — two runs over the same files produce identical bytes', async () => {
    const root = await makeConlocaWorkspace();
    const first = await buildPreviewWrapperScaffold(root);
    const second = await buildPreviewWrapperScaffold(root);
    expect(first!.content).toBe(second!.content);
  });
});

// ============================================================================
// Other entry shapes
// ============================================================================

describe('buildPreviewWrapperScaffold — entry variants', () => {
  test('simple vite app: importable theme attr becomes a commented import, not a stub', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <App />
  </ThemeProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }\n',
      'src/theme.ts': 'export const theme = {};\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['ThemeProvider']);
    expect(scaffold!.content).toContain("// import { ThemeProvider } from 'styled-components';");
    expect(scaffold!.content).toContain("// import { theme } from '../src/theme';");
    expect(scaffold!.content).not.toContain('Stub data you need to provide:');
  });

  // HYP-880 review finding: the entry's global stylesheet (Mantine/Tamagui/etc.
  // depend on it to look right) was dropped from the static scaffold even though
  // the AI-generation prompt already asks for it — a correctly-filled-in provider
  // stack could still render unstyled. The import must be LIVE (not commented —
  // a bare CSS side-effect import can't crash, unlike a provider needing stub data).
  test("entry's global stylesheet import is preserved and left LIVE (not commented)", async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <MantineProvider>
    <App />
  </MantineProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['MantineProvider']);
    expect(scaffold!.content).toContain("import '../src/index.css';");
    expect(scaffold!.content).not.toContain("// import '../src/index.css';");
  });

  test('no providers anywhere → null (caller keeps the plain fallback)', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': 'export default function App() { return <div>hi</div>; }\n',
    });
    expect(await buildPreviewWrapperScaffold(root)).toBeNull();
  });

  test('no entry render call at all → null', async () => {
    const root = await makeWorkspace({
      'src/util.ts': 'export const x = 1;\n',
    });
    expect(await buildPreviewWrapperScaffold(root)).toBeNull();
  });

  test('App as arrow-function default export, provider inside App only', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { IntlProvider } from 'react-intl';
const App = () => (
  <IntlProvider locale="en">
    <main>content</main>
  </IntlProvider>
);
export default App;
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['IntlProvider']);
    // String-literal attr needs no import and no stub.
    expect(scaffold!.content).toContain('//   <IntlProvider locale="en">');
    expect(scaffold!.content).not.toContain('Stub data you need to provide:');
  });

  // HYP-880 review finding (PR #618 codex): `const App = memo(() => ...)` is a common
  // perf-guard pattern for a router/layout root. The call-expression initializer used to
  // fail every ArrowFunctionExpression/FunctionExpression check, so findComponentRootJsx
  // returned null and the scaffold silently fell back to the bare wrapper.
  test('App wrapped in memo(...), provider inside the wrapped function', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { memo } from 'react';
import { AuthProvider } from './auth';
const App = memo(() => (
  <AuthProvider>
    <main>content</main>
  </AuthProvider>
));
export default App;
`,
      'src/auth.ts': 'export const AuthProvider = ({ children }: { children: unknown }) => children;\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
  });

  // Same HOC-unwrap requirement, but the memo() call wraps the default export directly
  // instead of a separately-declared local const.
  test('App as `export default memo(function App() {...})`, provider inside', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { memo } from 'react';
import { ThemeProvider } from 'styled-components';
export default memo(function App() {
  return (
    <ThemeProvider theme={{}}>
      <main>content</main>
    </ThemeProvider>
  );
});
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['ThemeProvider']);
  });

  // forwardRef is the other transparent HOC codex called out; a layout root forwarding a
  // DOM ref to its outer element is a common reason an App/Layout root gets wrapped in it.
  test('App wrapped in forwardRef(...), provider inside the wrapped function', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { forwardRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
const App = forwardRef((_props, ref) => (
  <QueryClientProvider client={queryClient}>
    <main ref={ref}>content</main>
  </QueryClientProvider>
));
export default App;
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['QueryClientProvider']);
  });

  // HYP-880 review finding: firstReturnedJsx used to walk the WHOLE subtree in pre-order and
  // grab the first `return <JSX/>` it found — including one inside a nested closure, and
  // including an early loading/error guard written before the main render. Both are common
  // real-world React shapes; either would have silently dropped the provider chain.
  test('App with a loading guard before the main return: the provider render wins, not the guard', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

export default function App() {
  const ready = useReady();
  if (!ready) {
    return <div className="spinner">Loading…</div>;
  }
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
    expect(scaffold!.content).not.toContain('spinner');
  });

  // HYP-880 review finding: a guard branch that ITSELF contains a provider (rarer, but
  // not the same as "no providers at all") must not automatically win just for being
  // non-empty — the richer (main) render should still be picked over a thinner guard.
  test('App with a provider in BOTH the guard and the main return: the richer (main) render wins', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';
import { FeatureFlagsProvider } from './feature-flags';

export default function App() {
  const ready = useReady();
  if (!ready) {
    return (
      <AuthProvider>
        <div className="spinner">Loading…</div>
      </AuthProvider>
    );
  }
  return (
    <AuthProvider>
      <FeatureFlagsProvider>
        <Main />
      </FeatureFlagsProvider>
    </AuthProvider>
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider', 'FeatureFlagsProvider']);
    expect(scaffold!.content).not.toContain('spinner');
  });

  // HYP-880 review finding: a ternary is the most common alternative spelling of the
  // `if (!ready) return <Spinner/>;` guard — `return cond ? <Providers>… : <Spinner/>`
  // — and was invisible to firstReturnedJsx (it only matched a bare `return <JSX/>`).
  test('App with a ternary return (cond ? providers : spinner): the provider arm wins', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

export default function App() {
  const ready = useReady();
  return ready ? (
    <AuthProvider>
      <Main />
    </AuthProvider>
  ) : (
    <div className="spinner">Loading…</div>
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
    expect(scaffold!.content).not.toContain('spinner');
  });

  // The arrow-expression-body variant of the same ternary idiom (no `return` keyword).
  test('App as an arrow with a ternary expression body: the provider arm wins', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

const App = () =>
  useReady() ? (
    <AuthProvider>
      <Main />
    </AuthProvider>
  ) : (
    <div className="spinner">Loading…</div>
  );
export default App;
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
    expect(scaffold!.content).not.toContain('spinner');
  });

  // `cond && <JSX/>` (no else arm) is the other common conditional-render idiom.
  test('App with a logical-AND return (cond && <Providers/>): the provider JSX is found', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

export default function App() {
  return (
    ready && (
      <AuthProvider>
        <Main />
      </AuthProvider>
    )
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
  });

  test("App with a nested closure that itself returns JSX: the closure's return is not mistaken for App's own", async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

function renderRow(item: { id: string }) {
  return <li key={item.id}>{item.id}</li>;
}

export default function App() {
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
  });

  // HYP-880 review finding: main.tsx importing App via a tsconfig path alias
  // (`@/App`, the common Vite/Next convention — this very repo uses `@/*`) used to
  // stop the cross-file walk entirely (only relative imports were followed),
  // silently losing every provider living inside App.
  test('App imported via a tsconfig path alias (@/App): the walk still follows it', async () => {
    const root = await makeWorkspace({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from '@/App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './auth';

export default function App() {
  return (
    <AuthProvider>
      <Main />
    </AuthProvider>
  );
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
  });

  test('member-expression provider tags (<Theme.Provider>) are collected with the object import', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { Theme } from './theme-context';
import App from './App';
createRoot(document.getElementById('root')!).render(
  <Theme.Provider value="dark">
    <App />
  </Theme.Provider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div/>; }\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['Theme.Provider']);
    expect(scaffold!.content).toContain("// import { Theme } from '../src/theme-context';");
    expect(scaffold!.content).toContain('//   <Theme.Provider value="dark">');
    expect(scaffold!.content).toContain('//   </Theme.Provider>');
  });

  test('alias (non-relative) import specifiers are kept verbatim', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { StoreProvider } from '@/store';
import App from './App';
createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div/>; }\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.content).toContain("// import { StoreProvider } from '@/store';");
  });

  test('locally-declared provider (no import) gets a not-importable TODO note (HYP-880)', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';

function LocalProvider({ children }: { children: React.ReactNode }) {
  return children;
}

createRoot(document.getElementById('root')!).render(
  <LocalProvider>
    <App />
  </LocalProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div/>; }\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['LocalProvider']);
    expect(scaffold!.content).toContain('`LocalProvider` is not importable — it is local to src/main.tsx');
  });

  test('multi-line provider attributes are collapsed to a single commented line', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';
createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    theme={{
      token: { colorPrimary: '#00b96b' },
    }}
  >
    <App />
  </ConfigProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div/>; }\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['ConfigProvider']);
    // Whitespace-collapsed single line; the complex expression is a stub note.
    const stackLine = scaffold!.content.split('\n').find((l) => l.includes('<ConfigProvider'));
    expect(stackLine).toBeDefined();
    expect(stackLine!).not.toContain('\n');
    expect(scaffold!.content).toContain('Stub data you need to provide:');
    expect(scaffold!.content).toContain('`theme={');
  });

  test('does not descend INTO a collected provider (its internal Context.Provider is noise)', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
      'src/App.tsx': `import { AuthProvider } from './use-auth';
export default function App() {
  return (
    <AuthProvider>
      <main>content</main>
    </AuthProvider>
  );
}
`,
      'src/use-auth.tsx': `import { createContext } from 'react';
const AuthContext = createContext(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = null;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
`,
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    // AuthProvider is the public surface; its internal AuthContext.Provider
    // (what AuthProvider itself provides) must not be double-scaffolded.
    expect(scaffold!.providerNames).toEqual(['AuthProvider']);
    expect(scaffold!.content).not.toContain('AuthContext.Provider');
  });

  test('picks the render mount with providers when an unrelated bare mount exists too', async () => {
    const root = await makeWorkspace({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme';
import App from './App';
import Probe from './Probe';

createRoot(document.getElementById('probe')!).render(<Probe />);
createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <App />
  </ThemeProvider>,
);
`,
      'src/App.tsx': 'export default function App() { return <div/>; }\n',
      'src/Probe.tsx': 'export default function Probe() { return <div/>; }\n',
      'src/theme.ts': 'export const theme = {};\n',
    });
    const scaffold = await buildPreviewWrapperScaffold(root);
    expect(scaffold!.providerNames).toEqual(['ThemeProvider']);
  });
});

describe('findTestRenderHelper', () => {
  test('finds a render-with helper under nested src dirs', async () => {
    const root = await makeWorkspace({
      'src/app/test-utils/render-with-host-providers.tsx': '// helper\n',
    });
    expect(await findTestRenderHelper(root)).toBe('src/app/test-utils/render-with-host-providers.tsx');
  });

  test('ignores .test./.spec. files and returns null when nothing matches', async () => {
    const root = await makeWorkspace({
      'src/app/test-utils/seed-workspace.test.ts': '// a test, not a helper\n',
      'src/components/Button.tsx': 'export const Button = () => null;\n',
    });
    // seed-workspace.test.ts is excluded by the .test. filter, but the test-utils
    // DIRECTORY still matches the pattern for non-test files placed inside it.
    expect(await findTestRenderHelper(root)).toBeNull();
  });

  test('returns null for a workspace without test helpers', async () => {
    const root = await makeWorkspace({ 'src/main.tsx': '// entry\n' });
    expect(await findTestRenderHelper(root)).toBeNull();
  });
});
