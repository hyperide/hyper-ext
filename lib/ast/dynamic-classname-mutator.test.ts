/**
 * Tests for modifyDynamicClassName — complex-expression className color replacement.
 *
 * Regression: inspector color picks on a complex-expression className (cn()/clsx()/ternary)
 * must REPLACE the conflicting same-property color class, not APPEND a duplicate.
 */
import _generate from '@babel/generator';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { describe, expect, it } from 'bun:test';
import { modifyDynamicClassName } from './dynamic-classname-mutator.js';

const generate = (_generate as unknown as { default: typeof _generate }).default || _generate;

function parseToAst(code: string): t.File {
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
}

function firstJsxElement(ast: t.File): t.JSXElement {
  let found: t.JSXElement | null = null;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || found) return;
    if (t.isJSXElement(node as t.Node)) {
      found = node as t.JSXElement;
      return;
    }
    for (const key in node as Record<string, unknown>) {
      if (key === 'loc' || key === 'range') continue;
      const value = (node as Record<string, unknown>)[key];
      if (Array.isArray(value)) for (const item of value) walk(item);
      else if (typeof value === 'object' && value !== null) walk(value);
    }
  };
  walk(ast.program);
  if (!found) throw new Error('no JSX element found');
  return found;
}

/**
 * Run the dynamic mutator with no AI-provided locations (the production fallback path)
 * and return the regenerated className expression source.
 */
function writeColor(
  code: string,
  // Test ergonomics: callers pass a {property: class} bag; the property is carried by
  // changedStyleKeys, so we flatten to the space-joined class string the API now takes.
  newClasses: Record<string, string>,
  changedStyleKeys: string[],
  fallback: 'append' | 'wrap' = 'append',
): string {
  const ast = parseToAst(code);
  const element = firstJsxElement(ast);
  modifyDynamicClassName(ast, code, element, [], Object.values(newClasses).join(' '), changedStyleKeys, fallback);

  // Generate only the className expression so failures render the class string,
  // not raw JSX (whose angle brackets break bun's diff renderer).
  const attr = element.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
  );
  const value = attr?.value;
  if (value && t.isJSXExpressionContainer(value) && !t.isJSXEmptyExpression(value.expression)) {
    return generate(value.expression).code;
  }
  if (value && t.isStringLiteral(value)) return value.value;
  return generate(ast).code;
}

describe('modifyDynamicClassName — complex expression color replacement', () => {
  it('cn() call: replaces conflicting text color in static string literal', () => {
    const code = 'const C = () => <div className={cn("p-2 text-red-500", cond && "x")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    // unrelated classes preserved
    expect(out).toContain('p-2');
  });

  it('clsx() call: replaces conflicting bg color, preserves bg-gradient / bg-opacity', () => {
    const code = 'const C = () => <div className={clsx("flex bg-gradient-to-r bg-red-500", cond && "y")}>Hi</div>;';
    const out = writeColor(code, { backgroundColor: 'bg-blue-500' }, ['backgroundColor']);
    expect(out).toContain('bg-blue-500');
    expect(out).not.toContain('bg-red-500');
    // gradient + layout classes must survive a bg-color change
    expect(out).toContain('bg-gradient-to-r');
    expect(out).toContain('flex');
  });

  it('ternary: replaces conflicting color in both branches without leaving an empty branch', () => {
    const code = 'const C = () => <div className={active ? "bg-red-500" : "bg-gray-200"}>Hi</div>;';
    const out = writeColor(code, { backgroundColor: 'bg-blue-500' }, ['backgroundColor']);
    expect(out).toContain('bg-blue-500');
    expect(out).not.toContain('bg-red-500');
    expect(out).not.toContain('bg-gray-200');
    // both branches receive the replacement — no empty string branch
    expect(out).toBe('active ? "bg-blue-500" : "bg-blue-500"');
  });

  it('template literal: replaces conflicting color in static quasi', () => {
    const code = 'const C = () => <div className={`flex ${extra} text-red-500`}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    expect(out).toContain('flex');
  });

  it('cn() call: preserves hover: variant when updating base color', () => {
    const code = 'const C = () => <div className={cn("text-red-500 hover:text-green-500", cond && "z")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    // base write must NOT strip the hover variant
    expect(out).toContain('hover:text-green-500');
  });

  it('ternary: updates conflicting color in every static branch', () => {
    const code = 'const C = () => <div className={active ? "p-2 bg-red-500" : "p-4 bg-gray-200"}>Hi</div>;';
    const out = writeColor(code, { backgroundColor: 'bg-blue-500' }, ['backgroundColor']);
    expect(out).toContain('bg-blue-500');
    expect(out).not.toContain('bg-red-500');
    expect(out).not.toContain('bg-gray-200');
    // non-color classes in each branch survive
    expect(out).toContain('p-2');
    expect(out).toContain('p-4');
  });

  it('logical && branch: strips the conflicting color from the consequent literal (HYP-537)', () => {
    // HYP-537: the conflicting color lives in `cond && "text-red-500"`. The `&&` false branch is
    // already colorless, so stripping the color from the consequent drops NOTHING on the false
    // path — it is safe to remove (narrows HYP-515's over-conservative documented limitation,
    // which feared dropping a color on the false branch; that fear does not apply to `&&`).
    // After: `cn("p-2", cond && "")` + appended `text-blue-500` → blue on every runtime path,
    // red gone, no competing token survives (so clsx-vs-twMerge ordering is irrelevant).
    const code = 'const C = () => <div className={cn("p-2", cond && "text-red-500")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    // The old color in the `&&` branch is now stripped (the fix).
    expect(out).not.toContain('text-red-500');
    // The conditional itself is preserved (still a `cond && ...`), and non-color classes survive.
    expect(out).toContain('cond &&');
    expect(out).toContain('p-2');
    // Appended so the false branch also gets the new color.
    expect(out).toContain('+ " text-blue-500"');
  });

  it('logical && branch with extra classes: strips only the conflicting color, keeps siblings', () => {
    // The `&&` branch carries a non-color class alongside the conflicting one; only the color goes.
    const code = 'const C = () => <div className={cn("p-2", cond && "font-bold text-red-500")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    // sibling class in the same branch is untouched
    expect(out).toContain('font-bold');
    expect(out).toContain('cond &&');
  });

  it('logical || branch: strips the conflicting color from the right operand literal', () => {
    const code = 'const C = () => <div className={cn("p-2", maybe || "bg-red-500")}>Hi</div>;';
    const out = writeColor(code, { backgroundColor: 'bg-blue-500' }, ['backgroundColor']);
    expect(out).toContain('bg-blue-500');
    expect(out).not.toContain('bg-red-500');
    expect(out).toContain('maybe ||');
  });

  it('nested logical fallback chain: strips conflicts in BOTH the left && branch and the || fallback', () => {
    // `(cond && "text-red-500") || "text-green-500"` — the conflict hides in the LEFT operand of the
    // outer `||`. Both same-group colors must be stripped, not just the right fallback.
    const code = 'const C = () => <div className={cn((cond && "text-red-500") || "text-green-500")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    expect(out).not.toContain('text-green-500');
    // both conditional operators preserved
    expect(out).toContain('cond &&');
    expect(out).toContain('||');
  });

  it('&& guard operand is NOT rewritten: a string-literal guard keeps its short-circuit semantics', () => {
    // `"text-red-500" && "font-bold"` renders to "font-bold" (left truthy). The left is a GUARD, not
    // a rendered class value — emptying it would flip `&&` to falsy and DROP font-bold. The rule is
    // position-based: for `&&` only the RIGHT (rendered) operand is touched, so the guard literal is
    // left intact and font-bold survives. (The guard's stale color never renders anyway.)
    const code = 'const C = () => <div className={cn("text-red-500" && "font-bold")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    // the rendered (right) operand has no color to strip, and its class survives
    expect(out).toContain('font-bold');
    // the && structure is preserved (guard literal untouched → short-circuit semantics intact)
    expect(out).toContain('&&');
  });

  it('cn() with no static color literal: appends new class (concat fallback)', () => {
    const code = 'const C = () => <div className={cn("p-2 flex")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).toContain('p-2');
    expect(out).toContain('flex');
  });

  it('ternary with a dynamic branch: strips static conflict AND appends so the new class always applies', () => {
    // Only the consequent is a static literal; the alternate is a dynamic variable.
    // Stripping the static branch alone would leave the false-branch with no new color, so the
    // new class must also be appended to guarantee it applies on every runtime path.
    const code = 'const C = () => <div className={cn(active ? "bg-red-500" : dynamicClass)}>Hi</div>;';
    const out = writeColor(code, { backgroundColor: 'bg-blue-500' }, ['backgroundColor']);
    expect(out).toContain('bg-blue-500');
    // old conflicting class stripped from the static branch
    expect(out).not.toContain('bg-red-500');
    // dynamic branch preserved untouched
    expect(out).toContain('dynamicClass');
    // appended outside so the false-branch still gets the new color
    expect(out).toContain('+ " bg-blue-500"');
  });

  it('cn() with a dynamic same-group && branch: strips BOTH the static AND the branch color (HYP-537)', () => {
    // HYP-537 narrows HYP-515's limitation: the same-group color in the `cond && "..."` branch
    // (text-green-500) is now ALSO stripped — the `&&` false path is colorless, so removing it
    // drops nothing. With no competing token left, the appended pick wins regardless of whether
    // cn is twMerge- or plain-clsx-based.
    const code = 'const C = () => <div className={cn("text-red-500", cond && "text-green-500")}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    // static conflict stripped
    expect(out).not.toContain('text-red-500');
    // dynamic-branch conflict now stripped too (the fix)
    expect(out).not.toContain('text-green-500');
    // the `&&` conditional itself is preserved
    expect(out).toContain('cond &&');
    // appended last so the false branch also gets the new color
    expect(out).toContain('+ " text-blue-500"');
  });

  // Re-edit: after the FIRST pick the bug (and even the concat fallback) leaves
  // `(originalExpr) + ' OLD_COLOR'` — a BinaryExpression. The SECOND pick must recurse it and
  // strip the previously-written color. This is the user's emphasized essence:
  // "it doesn't even find the value it wrote itself."
  it('re-edit: concat of a merge call + appended color string replaces the appended color', () => {
    const code = `const C = () => <div className={(cn("flex p-2", y)) + ' text-red-500'}>Hi</div>;`;
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    expect(out).toContain('flex p-2');
    // no double-append: the new class appears exactly once (the previously-appended literal is
    // rewritten in place, not concatenated a second time)
    expect(out.match(/text-blue-500/g)?.length).toBe(1);
  });

  it('re-edit: concat of an opaque base + appended color string strips the old color', () => {
    const code = `const C = () => <div className={base + ' text-red-500'}>Hi</div>;`;
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    // leading space preserved so the class doesn't glue onto `base`'s runtime value
    expect(out).toContain(`base + " text-blue-500"`);
  });

  it('concat: a static literal FOLLOWED by an opaque operand strips the old color AND appends last', () => {
    // `'text-red-500 ' + props.className` — props.className may carry a later same-group color, so
    // ordered resolution requires the inspector class to be appended after the opaque operand.
    const code = `const C = () => <div className={'text-red-500 ' + props.className}>Hi</div>;`;
    const out = writeColor(code, { color: 'text-blue-500' }, ['color']);
    expect(out).toContain('text-blue-500');
    // old color stripped from the static literal
    expect(out).not.toContain('text-red-500');
    // appended last so it applies after the opaque props.className
    expect(out).toContain('+ " text-blue-500"');
  });
});
