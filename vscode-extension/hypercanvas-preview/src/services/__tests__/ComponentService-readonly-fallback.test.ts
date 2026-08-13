/**
 * @file Unit tests for ComponentService's graceful degradation on component
 *       shapes the static AST analyzer can't handle (unsupported-CSS-framework
 *       projects: antd / mui / mantine / vanilla-extract / stylex / …).
 *
 * Accessed via: the Explorer (scanComponents / getComponent) and the Inspector
 *               element tree (parseStructure) for ANY project the user opens.
 * Assumptions: the global vscode mock (test/mock-vscode.ts) supplies
 *              `workspace.fs.readFile`, overridden per-test to feed source bytes.
 *
 * Past bug (unsupported-css-smoke cluster, 8 projects): these parse/traverse
 * failures are CAUGHT and the methods degrade gracefully (empty tree / null), but
 * they were logged at `console.error`. The e2e harness flags any Extension-Host
 * console.error as an unexpected diagnostic, so a HANDLED fallback failed the test
 * ("saw N unexpected iframe/diagnostic error(s): [ComponentService] Error parsing
 * structure …"). They are now logged at `console.warn` — these tests pin that a
 * recoverable fallback emits NO console.error.
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

  it('parseStructure returns an empty tree (no console.error) on antd duplicate-Layout binding', async () => {
    setFileContent(antdDuplicateLayoutSource);
    const service = new ComponentService(ROOT, async () => undefined);

    // Must not throw — the duplicate binding makes @babel/traverse fail.
    const tree = await service.parseStructure('app/root.tsx');

    expect(tree).toEqual([]);
    // The fix: a HANDLED fallback must not be reported at error severity.
    expect(errorSpy).not.toHaveBeenCalled();
    // And it must still leave a breadcrumb at warn severity.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('getComponent returns null (no console.error) on mui duplicate-Box binding', async () => {
    setFileContent(muiDuplicateBindingSource);
    const service = new ComponentService(ROOT, async () => undefined);

    const info = await service.getComponent('src/Layout.tsx');

    expect(info).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('scanComponents skips an unparseable file without console.error and keeps going', async () => {
    setFileContent(antdDuplicateLayoutSource);
    const service = new ComponentService(ROOT, async () => undefined);
    // Drive _parseComponentFile directly (scanComponents uses vscode.workspace.findFiles,
    // which the mock returns empty for). The private method is the per-file unit under test.
    const result = await (
      service as unknown as { _parseComponentFile: (uri: vscode.Uri) => Promise<unknown> }
    )._parseComponentFile(vscode.Uri.file(`${ROOT}/app/root.tsx`));

    expect(result).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
