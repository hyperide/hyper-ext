/**
 * @file A1 forward-detector — direct unit tests for the two named recognizers (HYP-1229 plan §8
 * step 2: "as separately-testable functions, not folded into the general tracer").
 *
 * Accessed via: bun test lib/style-read/forward-detect-recognizers.test.ts
 */
import * as t from '@babel/types';
import { describe, expect, it } from 'bun:test';
import { parseCode } from '@lib/ast/parser';
import { detectAsChildSlotPattern, detectStyledComponentsPattern } from './forward-detect-recognizers';

function firstFunctionDeclaration(source: string): t.Function {
  const ast = parseCode(source);
  const fn = ast.program.body.find((n): n is t.FunctionDeclaration => t.isFunctionDeclaration(n));
  if (!fn) throw new Error('no top-level function declaration in fixture');
  return fn;
}

function firstVariableInit(source: string): t.Expression | null | undefined {
  const ast = parseCode(source);
  for (const node of ast.program.body) {
    if (!t.isVariableDeclaration(node)) continue;
    const init = node.declarations[0]?.init;
    if (init) return init;
  }
  return undefined;
}

describe('detectAsChildSlotPattern', () => {
  it('matches the ternary-assigned-tag shape', () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ asChild }) {
  const Comp = asChild ? Slot : "button";
  return <Comp />;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(true);
  });

  it('matches the dual early-return shape', () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ asChild }) {
  if (asChild) { return <Slot />; }
  return <button />;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(true);
  });

  it('honors the LOCAL alias when Slot is imported under a different name', () => {
    const source = `
import { Slot as RadixSlot } from '@radix-ui/react-slot';
function Button({ asChild }) {
  const Comp = asChild ? RadixSlot : "button";
  return <Comp />;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(true);
  });

  it('does not match without a Slot import at all', () => {
    const source = `
function Button({ asChild }) {
  const Comp = asChild ? SomeOtherThing : "button";
  return <Comp />;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(false);
  });

  it('does not match a ternary between two host tags (no Slot arm)', () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Button({ variant }) {
  const Comp = variant === 'a' ? "button" : "a";
  return <Comp />;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(false);
  });

  it('does not match a single return with no Slot involvement', () => {
    const source = `
import { Slot } from '@radix-ui/react-slot';
function Widget({ title }) {
  return <div>{title}</div>;
}
`;
    const ast = parseCode(source);
    expect(detectAsChildSlotPattern(firstFunctionDeclaration(source), ast)).toBe(false);
  });
});

describe('detectStyledComponentsPattern', () => {
  it('matches a call-style styled.tag(...) factory', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const Button = styled.button(() => ({}));'))).toBe(true);
  });

  it('matches a tagged-template styled.tag`...` factory', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const Box = styled.div`color: red;`;'))).toBe(true);
  });

  it('matches styled(Component)(...)', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const Fancy = styled(Card)({ color: "red" });'))).toBe(true);
  });

  it('matches a tagged-template styled(Component)`...`', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const Fancy = styled(Card)`color: red;`;'))).toBe(true);
  });

  it('does not match an unrelated call expression', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const X = memo(() => null);'))).toBe(false);
  });

  it('does not match a plain arrow function component', () => {
    expect(detectStyledComponentsPattern(firstVariableInit('const X = () => <div />;'))).toBe(false);
  });

  it('handles a null/undefined initializer without throwing', () => {
    expect(detectStyledComponentsPattern(null)).toBe(false);
    expect(detectStyledComponentsPattern(undefined)).toBe(false);
  });
});
