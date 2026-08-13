/**
 * @file Surfaceless-element write floor — a Tailwind project must land a class, not inline
 *
 * Accessed via: bun test lib/style-write/surfaceless-tailwind-floor.test.ts
 * Regression: conloca (Tailwind v4) — a surfaceless element (no existing className/style) edited via
 *   the VS Code extension wrote a silent inline `style={{}}` because the host never threaded the
 *   UIKit-derived `projectDefaultCssSystem` the SaaS batch route already carries. This pins the
 *   executor contract: WITH the Tailwind default the write floors to a Tailwind class (D2 §4.3);
 *   WITHOUT any default it falls to inline (the genuine last rung).
 */
import { describe, expect, it } from 'bun:test';
import { createFileParser } from '@lib/ast/parser.node';
import { findElementByPosition } from '@lib/ast/position-finder';
import type { CssSystemId } from '@lib/style-read/types';
import { executeStyleWriteRequest } from './style-write-executor';
import { InMemoryFileIO } from './testing/in-memory-file-io';

const SURFACELESS = `export function C() {\n  return (<div>hi</div>);\n}\n`;

async function editPadding(projectDefaultCssSystem?: CssSystemId) {
  const p = '/project/src/C.tsx';
  const fileIO = new InMemoryFileIO({ [p]: SURFACELESS });
  const parser = createFileParser(fileIO);
  const { ast } = await parser.readAndParseFile(p);
  const element = findElementByPosition(ast, 2, 10)?.element;
  if (!element) throw new Error('div not found');

  const res = await executeStyleWriteRequest({
    ast,
    sourceFilePath: p,
    element,
    styles: { paddingTop: '24' },
    projectDefaultCssSystem,
    runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
    fileIO,
    projectRoot: '/project',
  });
  return { sourceForm: res.plan?.sourceForm, after: await fileIO.readFile(p) };
}

describe('surfaceless element write floor', () => {
  it('WITH a Tailwind project default → lands a Tailwind class (not inline)', async () => {
    const { sourceForm, after } = await editPadding('tailwind-v4');
    expect(sourceForm).toBe('elementClass');
    expect(after).toContain('className');
    expect(after).toContain('pt-[24px]');
    expect(after).not.toContain('style=');
  });

  it('WITHOUT any project default → falls to inline (documents the un-threaded regression)', async () => {
    const { sourceForm, after } = await editPadding(undefined);
    expect(sourceForm).toBe('scriptReactStyleRule');
    expect(after).toContain('style=');
  });
});
