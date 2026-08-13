/**
 * @file Unit tests for resolveComponentIdentifier — the state-bus boundary
 * that turns a `currentComponent` patch into the identifier fed to the sample
 * scaffold / JSX tag.
 *
 * Accessed via: extension.ts handleComponentSelected — consumes
 *               patch.currentComponent.{name,path} arriving over the StateHub
 *               message bus.
 * Assumptions: in-extension producers (PreviewPanel._setCurrentComponent,
 *              onOpenComponent) already strip the file extension from `name`,
 *              but EXTERNAL senders (SaaS bridge, MCP, RightPanelProvider
 *              `component:open`, a future client, or a raw state patch) may put
 *              a bare filename like `Foo.tsx` or `components/Foo.tsx` onto the
 *              bus. The boundary must not trust `name` verbatim.
 * Past bugs: HYP-460 — a raw `Foo.tsx` name leaked `.tsx` into the JSX tag of
 *            the generated sample. normalizeSampleComponentName now strips it as
 *            defense-in-depth; HYP-459 re-derives the identifier from `path` at
 *            the bus boundary so the smell is fixed at the source of truth.
 */
import { describe, expect, it } from 'bun:test';
import { resolveComponentIdentifier } from '../extension-utils';

describe('resolveComponentIdentifier', () => {
  it('keeps a clean PascalCase name verbatim', () => {
    expect(resolveComponentIdentifier('Button', 'src/components/Button.tsx')).toBe('Button');
  });

  it('re-derives from path basename when name is a raw filename (Foo.tsx)', () => {
    expect(resolveComponentIdentifier('Foo.tsx', 'src/components/Foo.tsx')).toBe('Foo');
  });

  it('re-derives from path when name carries a path separator (components/Foo.tsx)', () => {
    expect(resolveComponentIdentifier('components/Foo.tsx', 'src/components/Foo.tsx')).toBe('Foo');
  });

  it('strips the extension from the path basename when re-deriving', () => {
    expect(resolveComponentIdentifier('user-card.jsx', 'src/user-card.jsx')).toBe('user-card');
  });

  it('falls back to the raw name when path is empty (no source of truth to re-derive from; normalizeSampleComponentName cleans it downstream)', () => {
    expect(resolveComponentIdentifier('Foo.tsx', '')).toBe('Foo.tsx');
  });

  it('handles an absolute path basename', () => {
    expect(resolveComponentIdentifier('Sidebar.tsx', '/repo/src/Sidebar.tsx')).toBe('Sidebar');
  });

  it('preserves a dotted member-expression name (Accordion.Item) — no file ext', () => {
    expect(resolveComponentIdentifier('Accordion.Item', 'src/Accordion.tsx')).toBe('Accordion.Item');
  });
});
