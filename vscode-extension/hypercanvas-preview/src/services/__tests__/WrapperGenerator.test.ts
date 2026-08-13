/**
 * @file Unit tests for ensureIsolationWrapper — the isolated-preview wrapper
 * writer (.hyperide/preview.tsx).
 *
 * Accessed via: extension.ts activate() → onComponentError (HYP-487 auto
 *               recovery) and the scope-change handler (switch to isolated mode).
 * Assumptions: AI generation is reached only when an API key resolves; the
 *              global vscode mock (test/mock-vscode.ts) supplies window/workspace.
 * Past bugs: e2e #11 — when callAI threw (a non-streaming request hit the
 *            stream-only e2e mock → undefined `.content` → crash), the generator
 *            returned null and NOTHING was written to .hyperide/preview.tsx. The
 *            tamagui app then rendered without providers, ComponentErrorBoundary
 *            returned null, and the preview wedged empty (rootChildren:0) for
 *            320s. Fix: always write a valid wrapper — the AI one when it parses,
 *            else a pass-through fallback — so the preview renders the component
 *            (or its own clean error) instead of staying blank.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// vscode is mocked globally by test/mock-vscode.ts — do NOT mock.module it here.

// Controllable AI client. `callAI` resolves/rejects per-test; resolveAIConfig
// returns a truthy config so generatePreviewWrapper proceeds to the AI call.
let aiBehavior: () => Promise<string> = () => Promise.resolve('');
mock.module('@lib/ai-client', () => ({
  callAI: mock(() => aiBehavior()),
  resolveAIConfig: () => ({ provider: 'anthropic', apiKey: 'k', model: 'm' }),
}));

const { ensureIsolationWrapper } = await import('../WrapperGenerator');

/** Minimal ExtensionContext with a secrets store that returns an AI key. */
function fakeContext(apiKey: string | undefined = 'sk-test'): never {
  return {
    secrets: { get: () => Promise.resolve(apiKey) },
  } as never;
}

async function readWrapper(root: string): Promise<string> {
  return fs.readFile(path.join(root, '.hyperide', 'preview.tsx'), 'utf8');
}

async function wrapperExists(root: string): Promise<boolean> {
  return fs
    .access(path.join(root, '.hyperide', 'preview.tsx'))
    .then(() => true)
    .catch(() => false);
}

describe('ensureIsolationWrapper', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wrapgen-'));
    aiBehavior = () => Promise.resolve('');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes a valid pass-through fallback when the AI call throws (e2e #11)', async () => {
    aiBehavior = () => Promise.reject(new Error("Cannot read properties of undefined (reading '0')"));

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('fallback');
    expect(await wrapperExists(root)).toBe(true);
    const written = await readWrapper(root);
    expect(written).toContain('export function PreviewWrapper');
    expect(written).toContain('@hyperide-managed');
  });

  it('writes the fallback when no API key is configured', async () => {
    const outcome = await ensureIsolationWrapper(root, fakeContext(undefined));

    expect(outcome).toBe('fallback');
    expect(await wrapperExists(root)).toBe(true);
    expect(await readWrapper(root)).toContain('export function PreviewWrapper');
  });

  it('writes the AI wrapper verbatim when it is syntactically valid', async () => {
    const aiWrapper = [
      '// @hyperide-managed',
      "import type { ReactNode } from 'react';",
      "import { TamaguiProvider } from 'tamagui';",
      '',
      'export function PreviewWrapper({ children }: { children: ReactNode }) {',
      '  return <TamaguiProvider>{children}</TamaguiProvider>;',
      '}',
    ].join('\n');
    aiBehavior = () => Promise.resolve(aiWrapper);

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('written');
    expect(await readWrapper(root)).toBe(aiWrapper);
  });

  it('falls back when the AI wrapper does not parse (parse-check guard)', async () => {
    // Unbalanced JSX / missing brace — must NOT be written to disk.
    aiBehavior = () => Promise.resolve('export function PreviewWrapper({ children } { return <>{children}</>');

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('fallback');
    const written = await readWrapper(root);
    // Canonical fallback is JSX-free (return children) so it works under the
    // classic JSX runtime without a runtime React import.
    expect(written).toContain('return children;');
    expect(written).toContain('export function PreviewWrapper');
    expect(written).not.toContain('({ children } {');
  });

  // unsupported-css-smoke cluster (vanilla-extract-reddit): a wrapper that fails the
  // parse-check is a HANDLED outcome — the generator writes the pass-through fallback.
  // It must therefore NOT be logged at error severity (the e2e harness flags any
  // Extension-Host console.error as an unexpected diagnostic, failing the smoke test on
  // a fallback that actually worked). Pin: fallback emits a warn, never a console.error.
  it('falls back via console.warn (never console.error) when the AI wrapper does not parse', async () => {
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      aiBehavior = () => Promise.resolve('export function PreviewWrapper({ children } { return <>{children}</>');

      const outcome = await ensureIsolationWrapper(root, fakeContext());

      expect(outcome).toBe('fallback');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('failed parse-check'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does not clobber an existing manual wrapper', async () => {
    const manual = '// my hand-written wrapper\nexport function PreviewWrapper({ children }) { return children; }';
    await fs.mkdir(path.join(root, '.hyperide'), { recursive: true });
    await fs.writeFile(path.join(root, '.hyperide', 'preview.tsx'), manual, 'utf8');

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('exists');
    expect(await readWrapper(root)).toBe(manual);
  });

  // P1 (codex review): a fallback must be REPLACEABLE — once an AI key is
  // configured, a later run upgrades the pass-through to a real provider wrapper
  // instead of being permanently blocked by the existence guard.
  it('upgrades a prior fallback to the AI wrapper once generation succeeds', async () => {
    // First run: no key → fallback written.
    const first = await ensureIsolationWrapper(root, fakeContext(undefined));
    expect(first).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');

    // Second run: key + valid AI wrapper → must REPLACE the fallback.
    const aiWrapper = [
      '// @hyperide-managed',
      "import type { ReactNode } from 'react';",
      "import { TamaguiProvider } from 'tamagui';",
      'export function PreviewWrapper({ children }: { children: ReactNode }) {',
      '  return <TamaguiProvider>{children}</TamaguiProvider>;',
      '}',
    ].join('\n');
    aiBehavior = () => Promise.resolve(aiWrapper);

    const second = await ensureIsolationWrapper(root, fakeContext());
    expect(second).toBe('written');
    expect(await readWrapper(root)).toBe(aiWrapper);
    expect(await readWrapper(root)).not.toContain('@hyperide-fallback');
  });

  // P2 (codex review): the preview bundle does `import { PreviewWrapper }`, so an
  // AI default-export or a missing export parses but breaks the bundle. Reject it.
  it('falls back when the AI wrapper uses a default export (no named PreviewWrapper)', async () => {
    aiBehavior = () =>
      Promise.resolve(
        '// @hyperide-managed\nexport default function PreviewWrapper({ children }) { return <>{children}</>; }',
      );

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  it('falls back when the AI wrapper has no PreviewWrapper export at all', async () => {
    aiBehavior = () => Promise.resolve('// @hyperide-managed\nexport function SomethingElse() { return null; }');

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  // R2 (codex re-review): a COMMENTED-OUT export must not satisfy the named-export
  // check. The AST walk (not a regex) makes this a real default-only export.
  it('falls back when the only PreviewWrapper export is inside a comment', async () => {
    aiBehavior = () =>
      Promise.resolve(
        [
          '// @hyperide-managed',
          '// export function PreviewWrapper() {}',
          'export default function W() { return null; }',
        ].join('\n'),
      );

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  // R2: a re-export specifier (`export { PreviewWrapper }`) is a valid named export.
  it('accepts a re-export specifier (export { PreviewWrapper })', async () => {
    const aiWrapper = [
      '// @hyperide-managed',
      "import type { ReactNode } from 'react';",
      'function PreviewWrapper({ children }: { children: ReactNode }) { return <>{children}</>; }',
      'export { PreviewWrapper };',
    ].join('\n');
    aiBehavior = () => Promise.resolve(aiWrapper);

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('written');
    expect(await readWrapper(root)).toBe(aiWrapper);
  });

  // R1 (codex re-review): a fallback the USER has edited (marker intact) must be
  // PRESERVED — only the byte-exact canonical fallback is replaceable.
  it('preserves a user-edited fallback that still carries the marker', async () => {
    const editedFallback = [
      '// @hyperide-managed @hyperide-fallback',
      "import type { ReactNode } from 'react';",
      "import { TamaguiProvider } from 'tamagui';",
      '// user added a provider by hand',
      'export function PreviewWrapper({ children }: { children: ReactNode }) {',
      '  return <TamaguiProvider>{children}</TamaguiProvider>;',
      '}',
    ].join('\n');
    await fs.mkdir(path.join(root, '.hyperide'), { recursive: true });
    await fs.writeFile(path.join(root, '.hyperide', 'preview.tsx'), editedFallback, 'utf8');

    // Even with a valid AI wrapper available, the user's edit must win.
    aiBehavior = () => Promise.resolve('// @hyperide-managed\nexport function PreviewWrapper() { return null; }');

    const outcome = await ensureIsolationWrapper(root, fakeContext());

    expect(outcome).toBe('exists');
    expect(await readWrapper(root)).toBe(editedFallback);
  });

  // P1a (codex final review): a non-ENOENT read failure (e.g. the path is
  // unreadable) must NOT be treated as "no wrapper" and clobbered. Simulate it
  // by making preview.tsx a DIRECTORY → readFile throws EISDIR (not ENOENT) →
  // ensureIsolationWrapper rethrows and writes nothing.
  it('does not clobber an existing wrapper when the read fails (non-ENOENT)', async () => {
    // Make .hyperide/preview.tsx a directory so reading it throws EISDIR.
    await fs.mkdir(path.join(root, '.hyperide', 'preview.tsx'), { recursive: true });
    aiBehavior = () => Promise.resolve('// @hyperide-managed\nexport function PreviewWrapper() { return null; }');

    await expect(ensureIsolationWrapper(root, fakeContext())).rejects.toThrow();
    // The path is still a directory — nothing was written over it.
    const stat = await fs.stat(path.join(root, '.hyperide', 'preview.tsx'));
    expect(stat.isDirectory()).toBe(true);
  });

  // P1b (codex final review): TS-erased "exports" don't survive to runtime, so
  // the preview's `import { PreviewWrapper }` would still be undefined. Reject them.
  it('falls back on a type-only export declaration (export type { PreviewWrapper })', async () => {
    aiBehavior = () =>
      Promise.resolve('// @hyperide-managed\ntype PreviewWrapper = unknown;\nexport type { PreviewWrapper };');

    expect(await ensureIsolationWrapper(root, fakeContext())).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  it('falls back on a type-only export specifier (export { type PreviewWrapper })', async () => {
    aiBehavior = () =>
      Promise.resolve('// @hyperide-managed\ntype PreviewWrapper = unknown;\nexport { type PreviewWrapper };');

    expect(await ensureIsolationWrapper(root, fakeContext())).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });

  it('falls back on an ambient declare export (export declare const PreviewWrapper)', async () => {
    aiBehavior = () =>
      Promise.resolve('// @hyperide-managed\nexport declare const PreviewWrapper: (p: unknown) => unknown;');

    expect(await ensureIsolationWrapper(root, fakeContext())).toBe('fallback');
    expect(await readWrapper(root)).toContain('@hyperide-fallback');
  });
});
