/**
 * @file Unit tests for ComponentService's handling of component shapes with
 *       duplicate top-level bindings (unsupported-CSS-framework projects: antd /
 *       mui / mantine / vanilla-extract / stylex / …).
 *
 * Accessed via: the Explorer (scanComponents / getComponent) and the Inspector
 *               element tree (parseStructure) for ANY project the user opens.
 * Assumptions: the global vscode mock (test/mock-vscode.ts) supplies
 *              `workspace.fs.readFile`, overridden per-test to feed source bytes.
 *
 * Pre-#542 behavior: antd `Layout` and mui `Box` fixtures had duplicate top-level
 * bindings that caused @babel/traverse's scope builder to throw
 * `TypeError: Duplicate declaration "…"`. The catch block returned fallback values
 * (empty tree / null) and emitted console.warn.
 *
 * Post-#542 (c767b15d): traverseWithoutScope(noScope:true) bypasses scope
 * construction entirely — no TypeError is thrown, real data is returned, and no
 * console.warn/error is emitted. These tests pin the successful-parse behavior.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import * as vscode from 'vscode';
import { ComponentService } from '../ComponentService';

const ROOT = '/test-workspace';

function setFileContent(source: string): void {
  (vscode.workspace.fs.readFile as unknown as Mock<() => Promise<Uint8Array>>).mockImplementation(() =>
    Promise.resolve(new TextEncoder().encode(source)),
  );
}

// antd shape — Remix `app/root.tsx` in react/remix-antd-jira: a named import of
// `Layout` from antd PLUS a same-name `export function Layout`. That is a duplicate
// top-level binding, which @babel/traverse's scope builder rejects with
// `TypeError: Duplicate declaration "Layout"` when ComponentService walks the AST.
const antdDuplicateLayoutSource = `
import { ConfigProvider, Layout, Menu } from 'antd';
const { Header, Content } = Layout;
export function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <ConfigProvider>{children}</ConfigProvider>
      </body>
    </html>
  );
}
export default function App() {
  return (
    <Layout>
      <Header />
      <Content />
    </Layout>
  );
}
`;

// mui shape — a duplicate `Box` binding (import { Box } from '@mui/material' +
// const Box = ...). A second, distinct framework shape that triggers the same
// scope-collision recovery path, per "cover at least 2 of the 8 framework shapes".
const muiDuplicateBindingSource = `
import { Box, ThemeProvider } from '@mui/material';
const Box = (props) => <div {...props} />;
export default function Layout() {
  return (
    <ThemeProvider theme={{}}>
      <Box>Inbox</Box>
    </ThemeProvider>
  );
}
`;

describe('ComponentService — graceful readonly fallback for unsupported-framework shapes', () => {
  let errorSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('parseStructure parses successfully (no console.warn/error) on antd duplicate-Layout binding', async () => {
    setFileContent(antdDuplicateLayoutSource);
    const service = new ComponentService(ROOT, async () => undefined);

    // Post-#542: traverseWithoutScope bypasses scope-builder so no TypeError is thrown.
    const tree = await service.parseStructure('app/root.tsx');

    // Parsing succeeds — real JSX tree returned, not an empty fallback.
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].label).toBe('Layout');
    // No warn/error emitted because no exception was caught.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('getComponent returns ComponentInfo (no console.warn/error) on mui duplicate-Box binding', async () => {
    setFileContent(muiDuplicateBindingSource);
    const service = new ComponentService(ROOT, async () => undefined);

    // Post-#542: traverseWithoutScope bypasses scope-builder so no TypeError is thrown.
    const info = await service.getComponent('src/Layout.tsx');

    // Parsing succeeds — real ComponentInfo returned, not null fallback.
    expect(info).not.toBeNull();
    expect(info!.name).toBe('Layout');
    expect(info!.path).toBe('src/Layout.tsx');
    // No warn/error emitted because no exception was caught.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('_parseComponentFile parses successfully (no console.warn/error) on antd duplicate-Layout binding', async () => {
    setFileContent(antdDuplicateLayoutSource);
    const service = new ComponentService(ROOT, async () => undefined);
    // Drive _parseComponentFile directly (scanComponents uses vscode.workspace.findFiles,
    // which the mock returns empty for). The private method is the per-file unit under test.
    const result = await (
      service as unknown as { _parseComponentFile: (uri: vscode.Uri) => Promise<unknown> }
    )._parseComponentFile(vscode.Uri.file(`${ROOT}/app/root.tsx`));

    // Post-#542: traverseWithoutScope bypasses scope-builder so no TypeError is thrown.
    // Real ComponentInfo returned — not null fallback.
    expect(result).not.toBeNull();
    expect((result as { name: string }).name).toBe('App');
    // No warn/error emitted because no exception was caught.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
