/**
 * @file ensureIsolationWrapper no-AI paths (HYP-880): with no API key
 * configured, a detected provider chain must yield the static scaffold — not
 * the bare pass-through fallback — and user-edited wrappers must survive.
 *
 * The vscode module is the shared bun mock (test/mock-vscode.ts):
 * getConfiguration().get returns undefined → the AI path is skipped, which is
 * exactly the environment under test.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { ensureIsolationWrapper } from '../services/WrapperGenerator';

/** ensureIsolationWrapper only touches context.secrets.get — a stub suffices. */
const noKeyContext = { secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wrapper-gen-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content, 'utf-8');
  }
  return root;
}

const PROVIDER_MAIN = `import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <App />
  </ThemeProvider>,
);
`;

const BARE_MAIN = `import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`;

const APP = 'export default function App() { return <div/>; }\n';

async function readWrapper(root: string): Promise<string> {
  return readFile(path.join(root, '.hyperide', 'preview.tsx'), 'utf-8');
}

describe('ensureIsolationWrapper — no AI key', () => {
  test('writes the provider scaffold (not the bare fallback) when a chain is detected', async () => {
    const root = await makeWorkspace({ 'src/main.tsx': PROVIDER_MAIN, 'src/App.tsx': APP, 'src/theme.ts': '' });
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('scaffold');
    const written = await readWrapper(root);
    expect(written).toContain('@hyperide-scaffold');
    expect(written).toContain('<ThemeProvider theme={theme}>');
    expect(written).toContain('return children;');
    expect(written).not.toContain('@hyperide-fallback');
  });

  test('falls back to the bare pass-through when no providers are detected', async () => {
    const root = await makeWorkspace({ 'src/main.tsx': BARE_MAIN, 'src/App.tsx': APP });
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  test('is idempotent — a second run over an unedited scaffold rewrites nothing', async () => {
    const root = await makeWorkspace({ 'src/main.tsx': PROVIDER_MAIN, 'src/App.tsx': APP, 'src/theme.ts': '' });
    await ensureIsolationWrapper(root, noKeyContext);
    const first = await readWrapper(root);
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('scaffold');
    expect(await readWrapper(root)).toBe(first);
  });

  test('never clobbers a manual wrapper', async () => {
    const manual = '// my hand-written wrapper\nexport function PreviewWrapper() { return null; }\n';
    const root = await makeWorkspace({
      'src/main.tsx': PROVIDER_MAIN,
      'src/App.tsx': APP,
      'src/theme.ts': '',
      '.hyperide/preview.tsx': manual,
    });
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('exists');
    expect(await readWrapper(root)).toBe(manual);
  });

  // HYP-880 review finding (perf): a real wrapper must short-circuit BEFORE the entry-file
  // parse + BFS test-helper scan — proven here by a workspace with no readable entry files at
  // all: if the fast path were skipped, buildScaffoldSafely would still return null gracefully
  // (no throw), but 'exists' must come back regardless, without needing the entry files.
  test('a manual wrapper short-circuits before any entry-file analysis (no src/ present)', async () => {
    const manual = '// my hand-written wrapper\nexport function PreviewWrapper() { return null; }\n';
    const root = await makeWorkspace({ '.hyperide/preview.tsx': manual });
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('exists');
    expect(await readWrapper(root)).toBe(manual);
  });

  test('never clobbers a scaffold the user has edited (marker intact)', async () => {
    const root = await makeWorkspace({ 'src/main.tsx': PROVIDER_MAIN, 'src/App.tsx': APP, 'src/theme.ts': '' });
    await ensureIsolationWrapper(root, noKeyContext);
    const edited = `${await readWrapper(root)}\n// user note\n`;
    await writeFile(path.join(root, '.hyperide', 'preview.tsx'), edited, 'utf-8');
    const outcome = await ensureIsolationWrapper(root, noKeyContext);
    expect(outcome).toBe('exists');
    expect(await readWrapper(root)).toBe(edited);
  });
});
