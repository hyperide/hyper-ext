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

async function classifyTag(source: string, tagName: string, files: Record<string, string> = {}) {
  const ast = parseCode(source);
  const element = findAllJSXElements(ast).find(
    (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === tagName,
  )?.element;
  if (!element) throw new Error(`no <${tagName}> element in fixture`);
  const fileIO = new InMemoryFileIO({ [FILE_PATH]: source, ...files });
  return checkStyleForwarding({ ast, filePath: FILE_PATH, element, fileIO, aliasMap: {} });
}

describe('checkStyleForwarding — native tags', () => {
  it('admits a plain native (lowercase) DOM tag through the rewired detector', async () => {
    // The old code special-cased `facts.kind === 'native'` → `{ kind: 'forwards' }` directly. The
    // rewired detector relies on `detectForwarding` reporting a HIGH-confidence positive on both
    // channels for a native tag (`forward-detect.ts`'s own `isCustomComponentTag` gate) — pinning
    // that here so a future change to that gate can't silently degrade a native tag to `unknown`.
    const source = `export function Page() { return <div className="x" />; }\n`;
    expect(await classifyTag(source, 'div')).toEqual({ kind: 'forwards' });
  });
});

describe('checkStyleForwarding — transparent-HOC unwrapping', () => {
  it('treats a styled-components factory as a POSITIVE forwarding verdict (HYP-1235)', async () => {
    const source = `const Button = styled.button(({ theme }) => ({ color: theme.fg }));
export function Page() {
  return <Button>hi</Button>;
}
`;
    // Pre-HYP-901-fix this returned { kind: 'not-forwarding' } — the { theme } callback param was
    // misread as Button's props destructure. styled.button(...) is not a transparent wrapper, so
    // the OLD coarser check fell back to { kind: 'unknown' } instead. HYP-1235 rewired this onto
    // the richer A1 detector, which recognizes `styled.tag(...)` as a KNOWN library contract that
    // always injects its generated className onto a real DOM node — a confident POSITIVE, more
    // accurate than the old detector's "can't tell" fallback.
    expect(await classifyTag(source, 'Button')).toEqual({ kind: 'forwards' });
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

describe('checkStyleForwarding — HYP-1234 styled(Component) diagnosis pinpoint (review finding, P1)', () => {
  // HYP-1234 made `styled(Base)` reach a real `not-forwarding` verdict for the first time (traced
  // through `Base`, never through `Fancy` itself — `Fancy`'s own declaration has no `fnNode`).
  // `resolveNotForwardingDefinition` MUST re-resolve one more level and point the AI-fix diagnosis
  // at `Base`'s definition, not `Fancy`'s one-line `styled(Base)(...)` call site — the swallowed
  // prop lives in `Base`'s render body, and an AI-fix aimed at the `styled(...)` call edits the
  // wrong file.
  it('points the definition at the WRAPPED component, not the styled(...) call site', async () => {
    const source = `function Base({ title }: { title: string }) {
  return <div>{title}</div>;
}
const Fancy = styled(Base)({ color: 'red' });
export function Page() {
  return <Fancy title="x" />;
}
`;
    const result = await classifyTag(source, 'Fancy');
    expect(result).toEqual(expect.objectContaining({ kind: 'not-forwarding', displayName: 'Fancy' }));
    // Line 1 is `function Base(...)` — NOT line 4, where `const Fancy = styled(Base)(...)` sits.
    expect(result.kind === 'not-forwarding' && result.definition).toEqual({ filePath: FILE_PATH, line: 1 });
  });

  // codex review finding (P2, round 2): the same-file test above can't distinguish a correct
  // `{ ast: located.fileAst, filePath: located.declarationFilePath }` handoff from one that
  // silently reused the OUTER (`Fancy`'s) ast/filePath by accident, since both are identical when
  // `Base` lives in the same file. `Base` imported from a separate module closes that gap — the
  // diagnosis must land in `Base.tsx`, not `Page.tsx`.
  it('points the definition at the WRAPPED component even when it is imported from another file', async () => {
    const basePath = '/workspace/src/Base.tsx';
    const source = `import { Base } from './Base';
const Fancy = styled(Base)({ color: 'red' });
export function Page() {
  return <Fancy title="x" />;
}
`;
    const baseSource = `export function Base({ title }: { title: string }) {
  return <div>{title}</div>;
}
`;
    const result = await classifyTag(source, 'Fancy', { [basePath]: baseSource });
    expect(result).toEqual(expect.objectContaining({ kind: 'not-forwarding', displayName: 'Fancy' }));
    expect(result.kind === 'not-forwarding' && result.definition).toEqual({ filePath: basePath, line: 1 });
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

describe('checkStyleForwarding — HYP-1235 root-vs-descendant (A1 unification regression case)', () => {
  it('excludes a component that attaches className to a NESTED element, not its returned root', async () => {
    // The OLD coarser check only inspected the param-destructure shape: `className` IS
    // destructured, so it classified this `not-forwarding`-eligible component as `forwards` —
    // a blind write would land on the wrapping <div>, never reach the <span> that actually reads
    // it. The richer A1 detector traces the render body and sees `className` attached to a
    // DESCENDANT, not the root — a `forwards-non-root-only` high-confidence exclusion. Neither
    // channel is destructured to the root here (`style` isn't destructured at all), so this is a
    // genuine `not-forwarding` pre-write exclusion end to end.
    const source = `const Box = ({ className }: { className?: string }) => (
  <div>
    <span className={className}>content</span>
  </div>
);
export function Page() {
  return <Box />;
}
`;
    const result = await classifyTag(source, 'Box');
    expect(result).toEqual(expect.objectContaining({ kind: 'not-forwarding', displayName: 'Box' }));
  });
});

describe('checkStyleForwarding — HYP-1235 mixed-confidence collapse (one channel high-negative, one low)', () => {
  it('admits (unknown) rather than excludes when only ONE channel is a proven high-confidence negative', async () => {
    // `classifyForwarding`'s admit/exclude gate requires BOTH channels to be a proven high-confidence
    // negative before returning `not-forwarding` (an `&&`, not an `||`) — a mutant flipping that
    // operator would still pass every other test in this file (they only cover both-negative and
    // both-positive), so this pins the mixed case directly.
    //
    // `style` is never destructured at all → a structurally-impossible-to-reach HIGH-confidence
    // negative (`no-host-forward`) — settled before the render body is even inspected.
    // `className` IS destructured and DOES carry on one alternative (`cond` true), but the OTHER
    // alternative is an opaque, non-JSX return the tracer can't see into — per spec §9.2a "a trace
    // lost in a conditional... is low", so `className` downgrades to LOW confidence (uncertain, not
    // proven either way), never a false negative for the branch that didn't render.
    const source = `function opaque() { return null as any; }
const Widget = ({ className, cond }: { className?: string; cond: boolean }) => {
  if (cond) return <div className={className} />;
  return opaque();
};
export function Page() {
  return <Widget cond={true} />;
}
`;
    const result = await classifyTag(source, 'Widget');
    expect(result).toEqual({ kind: 'unknown' });
  });
});

describe('checkStyleForwarding — HYP-1235 local monorepo workspace-package resolution', () => {
  // The regression a 3-model `review diff` round on HYP-1235 caught: the rewired gate's OWN
  // `detectForwarding` call resolves declarations through `locateComponentDeclaration`, which
  // initially lacked the workspace-package fallback the OLD coarse check had (via
  // `resolveComponentForwarding`). `forward-detect.test.ts` already pins the fallback at the
  // `detectForwarding` level; this test pins it at THIS layer — the one that actually broke — so a
  // future rewiring of `checkStyleForwarding` onto a different resolver can't silently lose it again
  // without a test noticing here specifically.
  it('resolves a workspace-package component and excludes it when it does not forward', async () => {
    const importerPath = '/workspace/src/Page.tsx';
    const importerSource = `import { Card } from '@acme/ui';\nexport function Page() {\n  return <Card />;\n}\n`;
    const fileIO = new InMemoryFileIO({
      [importerPath]: importerSource,
      '/workspace/node_modules/@acme/ui/package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      '/workspace/node_modules/@acme/ui/src/index.ts': `export { Card } from './Card';\n`,
      '/workspace/node_modules/@acme/ui/src/Card.tsx': `export function Card({ title, children }: { title?: string; children?: unknown }) {\n  return <div>{title}{children as any}</div>;\n}\n`,
    });
    const ast = parseCode(importerSource);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Card',
    )?.element;
    if (!element) throw new Error('no <Card> element in fixture');

    const result = await checkStyleForwarding({ ast, filePath: importerPath, element, fileIO, aliasMap: {} });
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'not-forwarding',
        displayName: 'Card',
        definition: expect.objectContaining({ filePath: '/workspace/node_modules/@acme/ui/src/Card.tsx' }),
      }),
    );
  });
});

describe('checkStyleForwarding — HYP-1235 definitionLine recast quirk (export default function)', () => {
  // The actual bug `LocatedComponent.definitionLine` was added to fix: recast (the parser
  // `@lib/ast/parser.ts` wraps) strips `.loc` from a `FunctionDeclaration` when it's the
  // `declaration` of `export default function Foo() {}` — the OUTER `ExportDefaultDeclaration`
  // keeps its `.loc`, the inner node doesn't. Every other test asserting `definition?.line` in this
  // file uses a `const X = (...) => ...` (VariableDeclarator) shape, which doesn't hit this quirk —
  // this pins the LINE NUMBER specifically for the export-default-function shape (a P2 flagged by a
  // 3-model review round: the fix's own bug fix had no direct assertion on the value it produces).
  it('pinpoints the correct declaration line for a same-file export default function', async () => {
    const source = `interface BoxProps { title: string }

export default function Box({ title }: BoxProps) {
  return <div>{title}</div>;
}
export function Page() {
  return <Box title="x" />;
}
`;
    const result = await classifyTag(source, 'Box');
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'not-forwarding',
        displayName: 'Box',
        definition: { filePath: FILE_PATH, line: 3 },
      }),
    );
  });

  it('pinpoints the correct declaration line for a CROSS-FILE export default function', async () => {
    const importerPath = '/workspace/src/Page.tsx';
    const boxPath = '/workspace/src/Box.tsx';
    const importerSource = `import Box from './Box';\nexport function Page() {\n  return <Box title="x" />;\n}\n`;
    const boxSource = `interface BoxProps { title: string }

export default function Box({ title }: BoxProps) {
  return <div>{title}</div>;
}
`;
    const ast = parseCode(importerSource);
    const element = findAllJSXElements(ast).find(
      (e) => e.element.openingElement.name.type === 'JSXIdentifier' && e.element.openingElement.name.name === 'Box',
    )?.element;
    if (!element) throw new Error('no <Box> element in fixture');
    const fileIO = new InMemoryFileIO({ [importerPath]: importerSource, [boxPath]: boxSource });

    const result = await checkStyleForwarding({ ast, filePath: importerPath, element, fileIO, aliasMap: {} });
    expect(result).toEqual(
      expect.objectContaining({ kind: 'not-forwarding', displayName: 'Box', definition: { filePath: boxPath, line: 3 } }),
    );
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
