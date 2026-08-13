/**
 * Regression test for the Remix `app/root.tsx` duplicate-`Layout` parse crash (HYP-784).
 *
 * Reproduces the exact e2e failure on `remix-antd-jira`:
 *   `[ComponentService] Error parsing structure for app/root.tsx:
 *    TypeError: Duplicate declaration "Layout"`
 *
 * A Remix v2 `app/root.tsx` legitimately exports a `Layout` document-shell. The
 * remix-antd-jira fixture ALSO imports antd's `Layout` — a genuine top-level name
 * collision in the user's source. `@babel/parser` tolerates it, but `@babel/traverse`'s
 * scope crawl rejects it with `TypeError: Duplicate declaration "Layout"`. ComponentService's
 * structure/props walks are purely node-type based (they never read `path.scope`), so the
 * scope crawl is dead weight that only crashes them → `console.error("[ComponentService]
 * Error parsing structure …")` → tripped the preview's console.error gate (×14, 847s timeout).
 *
 * The walks now traverse with `noScope: true`, so the structure is read and nothing is logged.
 *
 * This file imports the real `ComponentService` (not the pure parser twin) so it covers the
 * literal reported path. bun's `--isolate` test mode keeps it free of other files' `mock.module`;
 * it still relies on the shared `mock-vscode` preload (wired via `bunfig.toml`) for the `vscode`
 * module mock.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as vscode from 'vscode';
import { ComponentService } from '../ComponentService';

// Minimal Remix root.tsx with the antd-`Layout` import / Remix-`Layout` export collision.
const REMIX_ROOT_SOURCE = `
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { ConfigProvider, Layout, Menu } from 'antd';

const { Header, Sider, Content } = Layout;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><Meta /><Links /></head>
      <body><ConfigProvider>{children}</ConfigProvider><ScrollRestoration /><Scripts /></body>
    </html>
  );
}

export default function App() {
  return (
    <Layout>
      <Header>header</Header>
      <Content><Outlet /></Content>
    </Layout>
  );
}
`;

describe('ComponentService — Remix root.tsx Layout collision (HYP-784)', () => {
  let service: ComponentService;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    service = new ComponentService('/test-workspace', async () => undefined);
    (vscode.workspace.fs.readFile as ReturnType<typeof spyOn>).mockImplementation(() =>
      Promise.resolve(new TextEncoder().encode(REMIX_ROOT_SOURCE)),
    );
    // Suppress + capture the error log so the assertion is on its absence, with pristine output.
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    // mock-vscode's global beforeEach mockClears fs.readFile but does NOT reset its impl, so
    // restore the empty default to keep this override from leaking into later tests.
    (vscode.workspace.fs.readFile as ReturnType<typeof spyOn>).mockImplementation(() =>
      Promise.resolve(new Uint8Array()),
    );
  });

  it('parseStructure reads the JSX tree without a Duplicate-declaration crash', async () => {
    const tree = await service.parseStructure('app/root.tsx');

    // The App default export returns a <Layout> subtree — assert the actual structure is read
    // (not just non-empty: a stub/partial tree from a downstream crash must not pass).
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain('Layout');
    expect(serialized).toMatch(/Header|Content|Outlet/);

    // The reported gate-tripping log must NOT fire.
    const parseErrorLogged = errorSpy.mock.calls.some((args) => String(args[0]).includes('Error parsing structure'));
    expect(parseErrorLogged).toBe(false);
  });

  it('getComponent resolves the default-export component (App) without crashing', async () => {
    const info = await service.getComponent('app/root.tsx');

    expect(info?.name).toBe('App');
    const componentErrorLogged = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes('Error parsing component'),
    );
    expect(componentErrorLogged).toBe(false);
  });
});
