/**
 * @file HYP-995 — the shared executor REFUSES a dead component-prop write (both platforms).
 *
 * A dimensional (paddingLeft) edit routes to the inline-style channel, which writes `style={{}}` onto
 * the target element. When that element is a custom component that doesn't forward `style`, the write
 * would be dead code (DOM unchanged) AND a TypeScript error. executeStyleWriteRequest must refuse it
 * with a structured `nonForwarding` result and leave the file untouched — while a native element (or a
 * forwarding component) still applies normally.
 */
import { describe, expect, it } from 'bun:test';
import { parseCode } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { executeStyleWriteRequest } from './style-write-executor';
import { InMemoryFileIO } from './testing/in-memory-file-io';

const PAGE = '/project/src/Page.tsx';
const CARD = '/project/src/Card.tsx';

const THEME = { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' } as const;

async function run(pageSource: string, cardSource: string | null, tagLine: number, tagCol: number) {
  const files: Record<string, string> = { [PAGE]: pageSource };
  if (cardSource !== null) files[CARD] = cardSource;
  const fileIO = new InMemoryFileIO(files);
  const ast = parseCode(pageSource);
  const found = findElementByPosition(ast, tagLine, tagCol);
  if (!found) throw new Error('element not found');
  const result = await executeStyleWriteRequest({
    ast,
    sourceFilePath: PAGE,
    element: found.element,
    styles: { paddingLeft: '32px' },
    runtimeThemeContext: THEME,
    fileIO,
    projectRoot: '/project',
  });
  return { result, fileIO };
}

// `  return (<Tag …/>);` — the tag is on line 3, column = index of `<`.
const NON_FORWARDING_CARD = `export function Card({ className, title }: { className?: string; title?: string }) {\n  return <div className={className}>{title}</div>;\n}\n`;
const page = (tag: string, imp = `import { Card } from './Card';\n`) =>
  `${imp}export function Page() {\n  return (<${tag} />);\n}\n`;

describe('HYP-995 executor refuses a dead component-prop write', () => {
  it('refuses an inline `style` write on a className-only-forwarding component (nothing written)', async () => {
    const src = page('Card');
    const { result, fileIO } = await run(src, NON_FORWARDING_CARD, 3, src.split('\n')[2].indexOf('<'));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected refusal');
    expect(result.nonForwarding?.componentName).toBe('Card');
    expect(result.nonForwarding?.requiredProp).toBe('style');
    expect(result.nonForwarding?.definition?.filePath).toBe(CARD);
    // The file is UNTOUCHED — no dead `style={{ paddingLeft }}` prop.
    expect(fileIO.content(PAGE)).toBe(src);
  });

  it('applies normally on a native element (no false refusal)', async () => {
    const src = page('div', '');
    const { result, fileIO } = await run(src, null, 3, src.split('\n')[2].indexOf('<'));
    expect(result.success).toBe(true);
    expect(fileIO.content(PAGE)).toContain('paddingLeft');
  });

  it('applies normally on a component that forwards `style` (no false refusal)', async () => {
    const forwarding = `export function Card({ style }: { style?: object }) {\n  return <div style={style as any} />;\n}\n`;
    const src = page('Card');
    const { result, fileIO } = await run(src, forwarding, 3, src.split('\n')[2].indexOf('<'));
    expect(result.success).toBe(true);
    expect(fileIO.content(PAGE)).toContain('paddingLeft');
  });

  it('refuses a className (Tailwind) write on a style-only-forwarding component with NO partial mutation', async () => {
    // Card forwards `style` but NOT `className`. The element carries a className attr, so the planner
    // routes the paddingLeft edit to the Tailwind `elementClass` channel — which writes `className`,
    // the prop Card drops. The write must be refused with requiredProp:'className' and the file left
    // byte-identical (preflight before any mutation — codex P1 mixed-channel).
    const styleOnly = `export function Card({ style }: { style?: object }) {\n  return <div style={style as any} />;\n}\n`;
    const src = `import { Card } from './Card';\nexport function Page() {\n  return (<Card className="p-2" />);\n}\n`;
    const fileIO = new InMemoryFileIO({ [PAGE]: src, [CARD]: styleOnly });
    const ast = parseCode(src);
    const found = findElementByPosition(ast, 3, src.split('\n')[2].indexOf('<'));
    if (!found) throw new Error('element not found');
    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: PAGE,
      element: found.element,
      styles: { paddingLeft: '32px' },
      runtimeThemeContext: THEME,
      fileIO,
      projectRoot: '/project',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected refusal');
    expect(result.nonForwarding?.requiredProp).toBe('className');
    expect(fileIO.content(PAGE)).toBe(src);
  });

  it('applies normally on a component that spreads ...rest (no false refusal)', async () => {
    const forwarding = `export function Card({ title, ...rest }: { title?: string }) {\n  return <div {...rest}>{title}</div>;\n}\n`;
    const src = page('Card');
    const { result, fileIO } = await run(src, forwarding, 3, src.split('\n')[2].indexOf('<'));
    expect(result.success).toBe(true);
    expect(fileIO.content(PAGE)).toContain('paddingLeft');
  });
});
