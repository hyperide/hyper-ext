/**
 * @file HYP-901 hardening unit tests — the static forwarding classifier and the auto-wrap style
 * builder, exercised directly (not through the AstService integration path in
 * __tests__/AstServiceStyleWriteHyp901.test.ts).
 *
 * Covers two review findings on the original HYP-901 change:
 *  - style-forwarding-check.ts unwrapped ANY call expression as if it were memo()/forwardRef(),
 *    so a styled-components factory (`styled.button(({ theme }) => …)`) was misread as
 *    `not-forwarding` and wrongly routed to auto-wrap/warn. Only real transparent HOCs
 *    (memo/forwardRef) should be unwrapped; everything else is `unknown`.
 *  - style-wrap-retry.ts built the wrapper `style` object key with `t.identifier(key)`, emitting
 *    invalid code for a CSS custom property (`--brand`). Non-identifier keys must be quoted.
 */
import _generate from '@babel/generator';
import { describe, expect, it } from 'bun:test';
import { parseCode } from '@lib/ast/parser';
import { findAllJSXElements } from '@lib/ast/traverser';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { FindElementResult } from '@lib/types';
import { checkStyleForwarding } from './style-forwarding-check';
import { applyWrapCandidate, hasOnlyChildVerifiableProperties, unwrapStyleWrapper } from './style-wrap-retry';
import { extractComputedStyleForProperties } from './scripts/dom-utils';

const generate = (_generate as unknown as { default: typeof _generate }).default || _generate;

const FILE_PATH = '/workspace/src/Page.tsx';

async function classifyTag(source: string, tagName: string) {
  const ast = parseCode(source);
  const element = findAllJSXElements(ast).find(
    (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === tagName,
  )?.element;
  if (!element) throw new Error(`no <${tagName}> element in fixture`);
  const fileIO = new InMemoryFileIO({ [FILE_PATH]: source });
  return checkStyleForwarding({ ast, filePath: FILE_PATH, element, fileIO, aliasMap: {} });
}

describe('checkStyleForwarding — transparent-HOC unwrapping', () => {
  it('treats a styled-components factory as UNKNOWN, not a positive not-forwarding verdict', async () => {
    const source = `const Button = styled.button(({ theme }) => ({ color: theme.fg }));
export function Page() {
  return <Button>hi</Button>;
}
`;
    // Pre-fix this returned { kind: 'not-forwarding' } — the { theme } callback param was
    // misread as Button's props destructure. styled.button(...) is not a transparent wrapper.
    expect(await classifyTag(source, 'Button')).toEqual({ kind: 'unknown' });
  });

  it('still unwraps a real memo() component and sees it forwards style', async () => {
    const source = `import { memo } from 'react';
const Card = memo(({ style, children }) => <div style={style}>{children}</div>);
export function Page() {
  return <Card>hi</Card>;
}
`;
    expect(await classifyTag(source, 'Card')).toEqual({ kind: 'forwards' });
  });

  it('still flags a plain custom component that drops style as not-forwarding', async () => {
    const source = `const Box = ({ title }: { title: string }) => <div>{title}</div>;
export function Page() {
  return <Box title="x" />;
}
`;
    const result = await classifyTag(source, 'Box');
    // HYP-990 (codex full panel) — a same-file (inline) component IS pinpointed, so it now carries a
    // definition location (line 1 here); the classification + display name are unchanged.
    expect(result).toEqual(expect.objectContaining({ kind: 'not-forwarding', displayName: 'Box' }));
    expect(result.kind === 'not-forwarding' && result.definition?.line).toBe(1);
  });
});

describe('checkStyleForwarding — HYP-987 P1 #7 cross-file same-line resolution', () => {
  it('does not mistake a same-line sibling export for the imported component', async () => {
    // `export const Forward = ({ style }) => …, Drop = () => …;` — both declarators on ONE line.
    // Importing `Drop` (which drops style) must NOT be classified by `Forward`'s params (matching
    // by line alone would). Pre-fix this returned `forwards` (Forward's `{ style }`), leaving a
    // dead prop on a non-forwarding component. Post-fix it matches by the resolved name + line.
    const importerPath = '/workspace/src/Page.tsx';
    const widgetsPath = '/workspace/src/widgets.tsx';
    const importerSource = `import { Drop } from './widgets';
export function Page() {
  return <Drop />;
}
`;
    const widgetsSource = `export const Forward = ({ style }: { style?: object }) => <div style={style} />, Drop = () => <span />;
`;
    const ast = parseCode(importerSource);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Drop',
    )?.element;
    if (!element) throw new Error('no <Drop> element in fixture');
    const fileIO = new InMemoryFileIO({ [importerPath]: importerSource, [widgetsPath]: widgetsSource });

    const result = await checkStyleForwarding({ ast, filePath: importerPath, element, fileIO, aliasMap: {} });
    // HYP-990 M2 — the not-forwarding result now also pinpoints the component definition (for the
    // AI-fix diagnosis); the classification + display name are unchanged.
    expect(result).toEqual(expect.objectContaining({ kind: 'not-forwarding', displayName: 'Drop' }));
    expect(result.kind === 'not-forwarding' && result.definition?.filePath).toBe(widgetsPath);
  });

  it('still classifies a same-line sibling that DOES forward as forwarding', async () => {
    // The dual of the above — importing `Forward` (which forwards style) must resolve to Forward,
    // not the non-forwarding `Drop` on the same line.
    const importerPath = '/workspace/src/Page.tsx';
    const widgetsPath = '/workspace/src/widgets.tsx';
    const importerSource = `import { Forward } from './widgets';
export function Page() {
  return <Forward />;
}
`;
    const widgetsSource = `export const Drop = () => <span />, Forward = ({ style }: { style?: object }) => <div style={style} />;
`;
    const ast = parseCode(importerSource);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Forward',
    )?.element;
    if (!element) throw new Error('no <Forward> element in fixture');
    const fileIO = new InMemoryFileIO({ [importerPath]: importerSource, [widgetsPath]: widgetsSource });

    const result = await checkStyleForwarding({ ast, filePath: importerPath, element, fileIO, aliasMap: {} });
    expect(result).toEqual({ kind: 'forwards' });
  });
});

describe('extractComputedStyleForProperties — HYP-987 P1 #2 custom properties + P1 #1 effective bg', () => {
  it('includes CSS custom property keys (incl. underscores) and always the effective background', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      const snap = extractComputedStyleForProperties(el, ['backgroundColor', '--brand', '--brand_color']);
      // `--brand` used to be rejected by the letters-only regex → verify never saw it → a `--brand`
      // wrap was always rolled back + false-warned. It must now be present as a key.
      expect(Object.keys(snap)).toContain('--brand');
      // Underscores are valid in CSS idents (`--brand_color`) — must not be dropped either.
      expect(Object.keys(snap)).toContain('--brand_color');
      expect(Object.keys(snap)).toContain('backgroundColor');
      // The visibility signal for the wrap verify (P1 #1) is always present.
      expect(Object.keys(snap)).toContain('effectiveBackgroundColor');
    } finally {
      el.remove();
    }
  });

  it('rejects the bare prototype-chain key and returns a null-prototype object (RPI barrier)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      const snap = extractComputedStyleForProperties(el, ['__proto__', 'backgroundColor']);
      // The dangerous key is the BARE `__proto__` — neither regex accepts it (the camelCase regex
      // rejects underscores, and it has no `--` prefix). Combined with the null-prototype result
      // object, no caller-supplied key can ever reach Object.prototype.
      expect(Object.keys(snap)).not.toContain('__proto__');
      expect(Object.getPrototypeOf(snap)).toBeNull();
    } finally {
      el.remove();
    }
  });
});

describe('unwrapStyleWrapper — HYP-987 P1 (codex) surgical-rollback safety', () => {
  const STYLES = { backgroundColor: '#ff00aa' };

  it('unwraps a unique OWNED wrapper (data-hc-autowrap), replacing it with its child', () => {
    const ast = parseCode(
      `export const P = () => <div data-hc-autowrap style={{ backgroundColor: "#ff00aa" }}><Card /></div>;\n`,
    );
    expect(unwrapStyleWrapper(ast, STYLES, 'Card')).toBe('removed');
    const code = generate(ast).code;
    expect(code).not.toContain('backgroundColor');
    expect(code).toContain('<Card');
  });

  it('refuses to unwrap when two identical OWNED wrappers are ambiguous', () => {
    const ast = parseCode(
      `export const P = () => <><div data-hc-autowrap style={{ backgroundColor: "#ff00aa" }}><Card /></div><div data-hc-autowrap style={{ backgroundColor: "#ff00aa" }}><Card /></div></>;\n`,
    );
    // Cannot tell which one THIS op created → leave both untouched rather than unwrap the wrong one.
    expect(unwrapStyleWrapper(ast, STYLES, 'Card')).toBe('ambiguous');
  });

  it('NEVER unwraps a user div with the same style but NO ownership marker (codex full panel)', () => {
    const ast = parseCode(`export const P = () => <div style={{ backgroundColor: "#ff00aa" }}><Card /></div>;\n`);
    // No data-hc-autowrap → this is user JSX, must not be removed.
    expect(unwrapStyleWrapper(ast, STYLES, 'Card')).toBe('absent');
    expect(generate(ast).code).toContain('backgroundColor');
  });

  it('refuses to unwrap an OWNED div that also holds sibling content (not our single-child shape)', () => {
    const ast = parseCode(
      `export const P = () => <div data-hc-autowrap style={{ backgroundColor: "#ff00aa" }}>KEEP ME<Card /></div>;\n`,
    );
    expect(unwrapStyleWrapper(ast, STYLES, 'Card')).toBe('absent');
    expect(generate(ast).code).toContain('KEEP ME');
  });

  it('reports ABSENT when the style object does not match (our wrapper is not present)', () => {
    const ast = parseCode(
      `export const P = () => <div data-hc-autowrap style={{ backgroundColor: "#000000" }}><Card /></div>;\n`,
    );
    expect(unwrapStyleWrapper(ast, STYLES, 'Card')).toBe('absent');
  });
});

describe('hasOnlyChildVerifiableProperties — HYP-987 verifiable-property gate', () => {
  it('accepts backgroundColor, inherited props, and CSS custom properties', () => {
    expect(hasOnlyChildVerifiableProperties({ backgroundColor: '#fff' })).toBe(true);
    expect(hasOnlyChildVerifiableProperties({ color: 'red', fontSize: '12px' })).toBe(true);
    // Custom properties inherit → child-verifiable (opus/codex P2 — must not bail before the wrap).
    expect(hasOnlyChildVerifiableProperties({ '--brand': '#fff' })).toBe(true);
  });

  it('rejects non-inherited visuals the child cannot reflect (opacity, borders, shadow)', () => {
    expect(hasOnlyChildVerifiableProperties({ opacity: '0.5' })).toBe(false);
    expect(hasOnlyChildVerifiableProperties({ borderWidth: '2px' })).toBe(false);
    expect(hasOnlyChildVerifiableProperties({ boxShadow: '0 0 4px black' })).toBe(false);
    // Mixed: one unverifiable property taints the whole edit.
    expect(hasOnlyChildVerifiableProperties({ color: 'red', opacity: '0.5' })).toBe(false);
  });
});

describe('applyWrapCandidate — style object key quoting', () => {
  it('quotes a CSS custom-property key so the wrapper emits valid code', () => {
    const ast = parseCode(`export function Page() {
  return <Widget />;
}
`);
    const found = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Widget',
    );
    if (!found) throw new Error('no <Widget> element in fixture');

    applyWrapCandidate(found as FindElementResult, { '--brand': '#ffffff', backgroundColor: '#000000' }, 'w1');

    const code = generate(ast).code;
    // `--brand` is not a valid identifier — it must be a quoted string key, never `--brand: …`.
    expect(code).toContain('"--brand": "#ffffff"');
    expect(code).toContain('backgroundColor: "#000000"');
    expect(code).toContain('<div');
    // HYP-990 C2 — the wrapper carries the write-scoped marker.
    expect(code).toContain('data-hc-writeid="w1"');
  });
});
