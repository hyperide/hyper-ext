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
import { twMerge } from 'tailwind-merge';
import {
  type BindingLiteralRewrite,
  modifyDynamicClassName,
  replaceExistingConflictingClass,
} from './dynamic-classname-mutator.js';

/**
 * Evaluate a rewritten className expression source against real runtime helpers so we can assert
 * the *resolved* class string (what the browser would see), not just the generated AST text.
 * `cn` and `clsx` are stubbed; opaque identifiers (e.g. `titleClassName`) are injected via `scope`.
 */
function resolveRuntimeClassName(exprSource: string, scope: Record<string, unknown> = {}): string {
  const clsx = (...args: unknown[]): string => args.flat(Infinity).filter(Boolean).join(' ');
  const cn = (...args: unknown[]): string => twMerge(clsx(...args));
  const scopeKeys = Object.keys(scope);
  const fn = new Function('twMerge', 'clsx', 'cn', 'classnames', 'classNames', ...scopeKeys, `return (${exprSource});`);
  return fn(twMerge, clsx, cn, clsx, clsx, ...scopeKeys.map((k) => scope[k])) as string;
}

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
  // Live applied className from the DOM (HYP-544). When an opaque arg contributes a same-group
  // color at runtime, the mutator escalates the residual concat-append to a twMerge override.
  domClasses?: string,
  // Whether the edited project resolves `tailwind-merge` (gates injecting a new import).
  canInjectTwMerge = true,
): string {
  const ast = parseToAst(code);
  const element = firstJsxElement(ast);
  modifyDynamicClassName(
    ast,
    code,
    element,
    [],
    Object.values(newClasses).join(' '),
    changedStyleKeys,
    fallback,
    undefined,
    domClasses,
    canInjectTwMerge,
  );

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

/**
 * HYP-544 Phase 1: run the mutator and return the WHOLE regenerated file plus the collected
 * binding rewrites. The const find-replace lands in a DISJOINT top-level statement, so the
 * className-only `writeColor` can't observe it — this helper regenerates the full AST and exposes
 * the `bindingRewrites` sink so tests can assert "the const literal was rewritten in place".
 */
function writeColorFull(
  code: string,
  newClasses: Record<string, string>,
  changedStyleKeys: string[],
  fallback: 'append' | 'wrap' = 'append',
  domClasses?: string,
  canInjectTwMerge = true,
): { file: string; classNameExpr: string; bindingRewrites: BindingLiteralRewrite[] } {
  const ast = parseToAst(code);
  const element = firstJsxElement(ast);
  const bindingRewrites: BindingLiteralRewrite[] = [];
  modifyDynamicClassName(
    ast,
    code,
    element,
    [],
    Object.values(newClasses).join(' '),
    changedStyleKeys,
    fallback,
    undefined,
    domClasses,
    canInjectTwMerge,
    bindingRewrites,
  );
  const attr = element.openingElement.attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
  );
  const value = attr?.value;
  let classNameExpr = '';
  if (value && t.isJSXExpressionContainer(value) && !t.isJSXEmptyExpression(value.expression)) {
    classNameExpr = generate(value.expression).code;
  } else if (value && t.isStringLiteral(value)) {
    classNameExpr = value.value;
  }
  return { file: generate(ast).code, classNameExpr, bindingRewrites };
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

/**
 * HYP-544: DOM-anchored residual. When a same-group color lives only in an OPAQUE argument
 * (e.g. `titleClassName` under plain clsx) the AST cannot see it, so the static-literal rewrite
 * cannot strip it and a plain concat-append does NOT guarantee the new color wins (clsx is pure
 * concatenation; Tailwind conflict resolution follows generated-CSS order, not attribute order).
 *
 * The live applied className from the DOM IS the authoritative "what color is applied now". When it
 * shows a same-group class the AST can't account for, the mutator escalates to a twMerge override so
 * the inspector value wins IN PLACE at the selected element — without editing the opaque prop/parent.
 */
describe('modifyDynamicClassName — DOM-anchored twMerge residual (HYP-544)', () => {
  it('clsx + opaque arg with live DOM conflict: wraps in twMerge so the new color wins in place', () => {
    // titleClassName is opaque; DOM shows it contributed text-red-500 at runtime.
    const code = 'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500');

    // The rewrite must route through twMerge with the new class as the LAST arg so it wins.
    expect(out).toContain('twMerge');
    expect(out).toContain('text-blue-500');
    // The opaque prop is NOT edited — its identifier survives untouched.
    expect(out).toContain('titleClassName');

    // Resolved at runtime: the opaque arg supplies text-red-500, twMerge must let blue win.
    const resolved = resolveRuntimeClassName(out, { titleClassName: 'text-red-500' });
    expect(resolved).toContain('text-blue-500');
    expect(resolved).not.toContain('text-red-500');
  });

  it('discriminating: SAME source, no live DOM conflict → NO twMerge wrap (minimal blast radius)', () => {
    // Identical AST as above, but the DOM shows titleClassName carried NO color. There is nothing
    // to beat, so the mutator must NOT introduce a twMerge wrap — it falls back to plain append.
    const code = 'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2');

    expect(out).toContain('text-blue-500');
    // No live same-group conflict → no escalation.
    expect(out).not.toContain('twMerge');
  });

  it('static literal carries the conflict (opaque arg contributes none): strips in place, NO twMerge wrap', () => {
    // DOM is just `text-red-500` and that color lives in the STATIC literal, not in titleClassName.
    // The static rewrite strips it, so there is no opaque residual to beat — wrapping in twMerge
    // (and injecting tailwind-merge into a project that may not depend on it) would be wrong.
    const code = 'const C = () => <div className={clsx("text-red-500", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'text-red-500');

    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500');
    // The conflict was editable (static) → no twMerge escalation, no new import.
    expect(out).not.toContain('twMerge');
    expect(out).toContain('titleClassName');
  });

  it('cn() + opaque arg with live DOM conflict: appends new class as last cn arg (cn is tw-backed, no wrap)', () => {
    // cn === twMerge(clsx(...)) by convention, so appending the new class as the last arg already
    // wins per Tailwind group — no outer twMerge wrap, no extra import needed.
    const code = 'const C = () => <div className={cn("p-2", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500');

    expect(out).toContain('text-blue-500');
    expect(out).toContain('titleClassName');
    // No double wrapping — cn already merges, so we must NOT introduce twMerge(cn(...)).
    expect(out).not.toContain('twMerge(cn');

    const resolved = resolveRuntimeClassName(out, { titleClassName: 'text-red-500' });
    expect(resolved).toContain('text-blue-500');
    expect(resolved).not.toContain('text-red-500');
  });

  it('raw identifier expr with live DOM conflict: wraps in twMerge(expr, newClass)', () => {
    const code = 'const C = () => <div className={titleClassName}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'text-red-500');

    expect(out).toContain('twMerge');
    expect(out).toContain('text-blue-500');
    expect(out).toContain('titleClassName');

    const resolved = resolveRuntimeClassName(out, { titleClassName: 'text-red-500' });
    expect(resolved).toContain('text-blue-500');
    expect(resolved).not.toContain('text-red-500');
  });

  it('MIXED static + opaque same-group conflict: strips static AND twMerge-overrides the opaque residual', () => {
    // The static `text-red-500` is rewritten in place, but the live DOM also shows `text-green-500`
    // coming from the opaque `titleClassName`. A plain concat-append would lose to that green; the
    // override must still apply so the inspector blue wins. (Regression guard: a boolean
    // "did we strip a static conflict" gate would wrongly skip the override here.)
    const code = 'const C = () => <div className={clsx("text-red-500", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'text-red-500 text-green-500');

    expect(out).toContain('twMerge');
    expect(out).toContain('text-blue-500');
    expect(out).not.toContain('text-red-500'); // static conflict stripped

    const resolved = resolveRuntimeClassName(out, { titleClassName: 'text-green-500' });
    expect(resolved).toContain('text-blue-500');
    expect(resolved).not.toContain('text-green-500'); // opaque residual beaten by twMerge
    expect(resolved).not.toContain('text-red-500');
  });

  it('destructured `twMerge` binding already taken: injects under a non-colliding alias', () => {
    // `const { twMerge } = helpers` binds twMerge via an ObjectPattern. A naive collector misses it
    // and would inject a duplicate `import { twMerge }`, breaking parsing. Must alias instead.
    const code = [
      'const { twMerge } = helpers;',
      'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;',
    ].join('\n');
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500', true);

    expect(out).toContain('twMerge2');
    expect(out).toContain('text-blue-500');
  });

  it('clsx + opaque conflict but project lacks tailwind-merge: falls back to concat-append, NO import', () => {
    // The project does NOT resolve tailwind-merge (canInjectTwMerge=false). Writing
    // `import { twMerge } ...` would break the build, so we must NOT — fall back to the safe
    // concat-append (documented limitation: the hard case doesn't fully resolve here).
    const code = 'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;';
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500', false);

    expect(out).toContain('text-blue-500');
    // No twMerge wrap, no new import — the user's build stays intact.
    expect(out).not.toContain('twMerge');
    expect(out).toContain('titleClassName');
  });

  it('clsx + opaque conflict when `twMerge` name is already taken: injects under a non-colliding alias', () => {
    // The file already binds `twMerge` to something unrelated. Injecting `import { twMerge }` would
    // create a duplicate top-level binding and break parsing — alias the import instead.
    const code = [
      'const twMerge = (x) => x;',
      'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;',
    ].join('\n');
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500', true);

    // The override references the aliased binding, not the colliding `twMerge`.
    expect(out).toContain('twMerge2');
    expect(out).toContain('text-blue-500');
  });

  it('clsx + opaque conflict reuses an EXISTING twMerge import even when canInject=false (no build risk)', () => {
    // When the file already imports twMerge, reusing it is always safe regardless of canInject.
    const code = [
      "import { twMerge } from 'tailwind-merge';",
      'const C = () => <div className={clsx("p-2", titleClassName)}>Hi</div>;',
    ].join('\n');
    const out = writeColor(code, { color: 'text-blue-500' }, ['color'], 'append', 'p-2 text-red-500', false);

    expect(out).toContain('twMerge');
    expect(out).toContain('text-blue-500');
  });
});

describe('replaceExistingConflictingClass — replace-only sync for the probe-driven inline-override redirect (HYP-1222)', () => {
  function replaceExisting(
    code: string,
    newClasses: string,
    changedStyleKeys: string[],
  ): { changed: boolean; expr: string } {
    const ast = parseToAst(code);
    const element = firstJsxElement(ast);
    const changed = replaceExistingConflictingClass(element, newClasses, changedStyleKeys);
    const attr = element.openingElement.attributes.find(
      (a): a is t.JSXAttribute => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'className',
    );
    const value = attr?.value;
    let expr = '';
    if (value && t.isJSXExpressionContainer(value) && !t.isJSXEmptyExpression(value.expression)) {
      expr = generate(value.expression).code;
    } else if (value && t.isStringLiteral(value)) {
      expr = value.value;
    }
    return { changed, expr };
  }

  it('plain string className with a matching class: replaces in place, reports changed=true', () => {
    const code = '<div className="p-2 bg-blue-500">Hi</div>;';
    const { changed, expr } = replaceExisting(code, 'bg-green-500', ['backgroundColor']);
    expect(changed).toBe(true);
    expect(expr).toContain('bg-green-500');
    expect(expr).not.toContain('bg-blue-500');
    expect(expr).toContain('p-2');
  });

  it('plain string className with NO matching class: no-op, reports changed=false, nothing injected', () => {
    const code = '<div className="p-2 rounded">Hi</div>;';
    const { changed, expr } = replaceExisting(code, 'bg-green-500', ['backgroundColor']);
    expect(changed).toBe(false);
    expect(expr).not.toContain('bg-green-500');
    expect(expr).toBe('p-2 rounded');
  });

  it('cn()+concat dynamic expression with a matching tail class: replaces in place (HYP-1222 fixture shape)', () => {
    const code = "<div className={cn('px-6 py-4 m-4 rounded font-semibold text-white', y) + ' bg-blue-500'}>Hi</div>;";
    const { changed, expr } = replaceExisting(code, 'bg-green-500', ['backgroundColor']);
    expect(changed).toBe(true);
    expect(expr).toContain('bg-green-500');
    expect(expr).not.toContain('bg-blue-500');
    expect(expr).toContain('px-6 py-4 m-4 rounded font-semibold text-white');
  });

  it('cn()+concat dynamic expression with NO matching class: no-op, never appends/wraps', () => {
    const tail = "cn('px-6 py-4 m-4 rounded font-semibold text-white', y) + ' m-1'";
    const code = `<div className={${tail}}>Hi</div>;`;
    const { changed, expr } = replaceExisting(code, 'bg-green-500', ['backgroundColor']);
    expect(changed).toBe(false);
    expect(expr).not.toContain('bg-green-500');
    // Untouched — no append/wrap fallback: the expression is byte-identical to the input tail
    // (aside from generator whitespace), not extended with a new operand.
    expect(expr.replace(/\s+/g, ' ')).toBe(tail.replace(/\s+/g, ' '));
  });

  // HYP-1292: the narrow replace-only helper above only ever looked at inline literals in the
  // className expression — a same-file const IDENTIFIER (the HYP-544 shape `const STYLES =
  // 'bg-blue-500'; className={cn(STYLES)}`) was invisible to it, so this exact shape reproduced
  // the original HYP-1222 "second consecutive pick doesn't replace" symptom. These three cases
  // pin the fix: sync when a live conflict says the const IS the driver, stay a no-op when it
  // isn't, and never regress a caller that doesn't opt into the new binding context.
  describe('same-file const-binding identifier (HYP-1292)', () => {
    const code = ["const STYLES = 'bg-blue-500';", 'const C = () => <div className={cn(STYLES)}>Hi</div>;'].join(
      '\n',
    );

    it('const contributes the LIVE conflict class: replaces at the const definition', () => {
      const ast = parseToAst(code);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(true);
      const file = generate(ast).code;
      expect(file).toContain('bg-green-500');
      expect(file).not.toContain('bg-blue-500');
      // The className expression itself is untouched — the sync happened at the const, not here.
      expect(file).toContain('className={cn(STYLES)}');
    });

    it('no domClasses signal (no live-conflict evidence): no-op, const left untouched', () => {
      const ast = parseToAst(code);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: undefined,
      });
      expect(changed).toBe(false);
      expect(generate(ast).code).toContain('bg-blue-500');
    });

    it('no bindingContext argument at all: unchanged legacy no-op (backward-compatible default)', () => {
      const { changed, expr } = replaceExisting(code, 'bg-green-500', ['backgroundColor']);
      expect(changed).toBe(false);
      expect(expr).toBe('cn(STYLES)');
    });

    // Review finding (Fable): a mixed expression where an INLINE literal handles one occurrence of
    // the conflict must not short-circuit past a DIFFERENT occurrence that only a const binding
    // carries — reproduces the HYP-1222 symptom on the mixed shape if it does. Unaffected by the
    // netting design (see `replaceExistingConflictingClass`'s doc): the DEAD branch here carries a
    // DIFFERENT class token ('bg-red-500') than the live one ('bg-blue-500', from STYLES), so
    // nothing nets it out of the residual either way.
    it('mixed expression: an inline-literal hit does not suppress the still-live const sync', () => {
      // `isActive` is false at runtime, so the inline 'bg-red-500' branch never actually renders —
      // the LIVE class (per domClasses) is the one STYLES contributes.
      const mixedCode = [
        "const STYLES = 'bg-blue-500';",
        "const isActive = false;",
        "const C = () => <div className={cn(STYLES, isActive && 'bg-red-500')}>Hi</div>;",
      ].join('\n');
      const ast = parseToAst(mixedCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500', // the DOM shows STYLES' class, not the never-rendered literal
      });
      expect(changed).toBe(true);
      const file = generate(ast).code;
      // The real (live) driver — the const — was updated.
      expect(file).toContain("const STYLES = \"bg-green-500\"");
      expect(file).not.toContain('bg-blue-500');
    });

    // Review rounds 3→4 (Opus, then Opus+codex again): the SAME conflict class token duplicated
    // across an inline literal AND a const — `cn('bg-blue-500', STYLES)` with `STYLES =
    // 'bg-blue-500'`. Round 3 found the netted design leaves STYLES stale here (it's the LAST
    // cn() argument, so twMerge's last-wins-per-group semantics make it the one that actually
    // renders — reproducing HYP-1222's "second pick doesn't replace" symptom). Removing the
    // netting to fix that (round 3's own next iteration) turned out to be UNSAFE in the other
    // direction: round 4 found and confirmed (two independent models, live repro) that an
    // unconditional binding pass wrongly rewrites a const sitting in a DEAD conditional branch
    // that shares the SAME token as something else that's genuinely live — a worse bug, since the
    // const's blast radius is file-wide (every other element referencing it changes too), not
    // scoped to this element. Netting was restored (see the doc on `replaceExistingConflictingClass`)
    // because the dead-branch case is far more common and far more dangerous than this duplicate-
    // token case is common. **KNOWN, ACCEPTED LIMITATION, not fixed by this ticket**: pinning the
    // CURRENT (imperfect but safe-by-default) behavior — the const stays stale here — rather than
    // silently losing coverage of this shape. A real fix needs branch-reachability analysis this
    // helper's coarse, whole-program style does not attempt; tracked as a follow-up.
    it('KNOWN LIMITATION: the same conflict class duplicated in an unconditional literal AND a const — the const stays stale', () => {
      const dupCode = [
        "const STYLES = 'bg-blue-500';",
        "const C = () => <div className={cn('bg-blue-500', STYLES)}>Hi</div>;",
      ].join('\n');
      const ast = parseToAst(dupCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      // The literal occurrence updates (handled by the static-literal pass, unaffected by this
      // limitation)...
      expect(changed).toBe(true);
      const file = generate(ast).code;
      expect(file).toContain('bg-green-500');
      // ...but the const — netted out of the residual because the literal already accounted for
      // the token — is NOT updated. If this assertion starts failing because the const now DOES
      // update, that's good news: it means the limitation above was closed, so also flip this
      // test's expectations and update the doc comment on `replaceExistingConflictingClass`.
      expect(file).toContain("const STYLES = 'bg-blue-500'");
    });

    // Review round 4 (Opus + codex, independently, live-confirmed): a const referenced inside a
    // conditional branch that DOESN'T currently render must NOT be rewritten just because its
    // token happens to match something ELSE that's live in the same expression. This is exactly
    // the case netting protects — the regression the round-3→round-4 revert closes.
    it('a const inside a dead conditional branch sharing a token with a live literal: the const is NOT rewritten', () => {
      const deadBranchCode = [
        "const STYLES = 'bg-blue-500';",
        'const isActive = false;',
        "const C = () => <div className={cn('bg-blue-500', isActive && STYLES)}>Hi</div>;",
      ].join('\n');
      const ast = parseToAst(deadBranchCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        // The DOM shows ONLY what the always-present literal contributes — isActive's branch
        // never rendered, so its class was never applied.
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(true);
      const file = generate(ast).code;
      // The live literal updates...
      expect(file).toContain('bg-green-500');
      // ...but STYLES — never actually live here — is left completely untouched, including for
      // every OTHER element in the file that might reference it.
      expect(file).toContain("const STYLES = 'bg-blue-500'");
    });

    // Review finding (codex, P1): `resolveSameFileLiteralBinding` matches by name against
    // top-level declarations only, with no notion of the reference site's own scope. A function
    // parameter (or a nested local) with the same name as a top-level const SHADOWS it — resolving
    // to the top-level declaration in that case would rewrite an unrelated value.
    it('SHADOWED identifier (same name as a function parameter): bails, never rewrites the wrong declaration', () => {
      const shadowedCode = [
        "const STYLES = 'bg-blue-500';",
        'function C({ STYLES }) {',
        '  return <div className={cn(STYLES)}>Hi</div>;',
        '}',
      ].join('\n');
      const ast = parseToAst(shadowedCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(false);
      // The unrelated top-level const must be left completely untouched.
      expect(generate(ast).code).toContain("const STYLES = 'bg-blue-500'");
    });

    it('SHADOWED identifier (nested const inside the component body): also bails', () => {
      const shadowedCode = [
        "const STYLES = 'bg-blue-500';",
        'function C() {',
        "  const STYLES = 'local-only';",
        '  return <div className={cn(STYLES)}>Hi</div>;',
        '}',
      ].join('\n');
      const ast = parseToAst(shadowedCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(false);
      expect(generate(ast).code).toContain("const STYLES = 'bg-blue-500'");
    });

    // Review finding (Fable, #4 — verification requested): a member-expression property name
    // (`styles.primary`) must NOT be treated as an identifier reference to an unrelated top-level
    // const of the same name. `collectIdentifierNames` already excludes member expressions
    // entirely (doc comment: "Member/object/array etc. ... don't descend into them") — this pins
    // that the const-binding path inherits the same exclusion, not just the primary write path.
    it('member-expression property access is NOT resolved as an identifier binding (no false-positive rewrite)', () => {
      const memberCode = [
        "const primary = 'bg-blue-500';", // unrelated top-level const, same name as the property below
        'const C = (props) => <div className={cn(props.styles.primary)}>Hi</div>;',
      ].join('\n');
      const ast = parseToAst(memberCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(false);
      expect(generate(ast).code).toContain("const primary = 'bg-blue-500'");
    });

    // Review round 2 (k3, Fable finding #3): the shadow guard originally only checked function
    // params and nested VariableDeclarations — a catch-clause param or a nested named
    // function/class declaration also shadows and was missed (the unsafe direction: a false
    // resolve, not a false bail).
    it('SHADOWED identifier (catch-clause param): bails, never rewrites the wrong declaration', () => {
      const shadowedCode = [
        "const STYLES = 'bg-blue-500';",
        'function C() {',
        '  try {',
        '    doSomething();',
        '  } catch (STYLES) {',
        '    return <div className={cn(STYLES)}>Hi</div>;',
        '  }',
        '}',
      ].join('\n');
      const ast = parseToAst(shadowedCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(false);
      expect(generate(ast).code).toContain("const STYLES = 'bg-blue-500'");
    });

    it('SHADOWED identifier (nested named function declaration reusing the name): bails', () => {
      const shadowedCode = [
        "const STYLES = 'bg-blue-500';",
        'function C() {',
        '  function STYLES() { return null; }',
        '  return <div className={cn(STYLES)}>Hi</div>;',
        '}',
      ].join('\n');
      const ast = parseToAst(shadowedCode);
      const element = firstJsxElement(ast);
      const changed = replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(changed).toBe(false);
      expect(generate(ast).code).toContain("const STYLES = 'bg-blue-500'");
    });

    // Review round 2 (Opus "blocking", Fable, k3): an `export const` top-level statement must not
    // itself be misclassified as a shadow of its own name — the wrapped declaration is still the
    // SAME top-level statement. (The overall sync still doesn't reach an exported const end-to-end
    // — `resolveSameFileLiteralBinding` doesn't see through the export wrapper either, a separate,
    // pre-existing, shared-code limitation this ticket does not extend — so `changed` stays
    // `false` either way; this test pins that the GUARD specifically no longer contributes a
    // second, independent reason for that no-op, which matters the moment the resolver gap closes.)
    it('export const at the top level: the guard does not treat it as shadowing itself', () => {
      const code = [
        "export const STYLES = 'bg-blue-500';",
        'const C = () => <div className={cn(STYLES)}>Hi</div>;',
      ].join('\n');
      const ast = parseToAst(code);
      const element = firstJsxElement(ast);
      // Not asserting `changed` here (see comment above) — asserting the export wrapper is
      // untouched either way, i.e. nothing crashed and no unrelated mutation happened.
      replaceExistingConflictingClass(element, 'bg-green-500', ['backgroundColor'], undefined, {
        ast,
        domClasses: 'bg-blue-500',
      });
      expect(generate(ast).code).toContain("export const STYLES = 'bg-blue-500'");
    });
  });
});

describe('modifyDynamicClassName — same-file const binding resolution (HYP-544 Phase 1)', () => {
  it('clsx + same-file const literal: find-replaces AT THE CONST, no twMerge, no import', () => {
    // The motivating bug: OPAQUE_BG is "opaque" only because the walker never resolved the binding.
    // Phase 1 follows the binding to the same-file const literal and rewrites the color there.
    const code = [
      "const OPAQUE_BG = 'bg-blue-600';",
      'const C = () => <div className={clsx("p-2", OPAQUE_BG)}>Hi</div>;',
    ].join('\n');
    const { file, classNameExpr, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600', // live DOM: the const contributes bg-blue-600
    );

    // The const literal is rewritten in place: blue → red. (babel-generator emits double quotes;
    // the production path uses recast with single quotes — assert the value, not the quote style.)
    expect(file).toMatch(/const OPAQUE_BG = ["']bg-red-600["']/);
    expect(file).not.toContain('bg-blue-600');
    // NO twMerge wrap and NO tailwind-merge import — the value was directly replaceable.
    expect(file).not.toContain('twMerge');
    expect(file).not.toContain('tailwind-merge');
    // The className expression is untouched (still the clean clsx call, no concat-append).
    expect(classNameExpr).toBe('clsx("p-2", OPAQUE_BG)');
    // The executor splice contract: exactly one const literal range was recorded.
    expect(bindingRewrites).toHaveLength(1);
    expect(bindingRewrites[0].start).toBeGreaterThanOrEqual(0);
    expect(bindingRewrites[0].end).toBeGreaterThan(bindingRewrites[0].start);
  });

  it('raw identifier expr bound to a same-file const literal: find-replaces at the const', () => {
    const code = ["const BTN = 'bg-blue-600 px-4';", 'const C = () => <div className={BTN}>Hi</div>;'].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'bg-blue-600 px-4',
    );

    // The const literal carries the new color; the non-conflicting px-4 is preserved (order may shift,
    // Tailwind resolves by generated-CSS order not attribute order).
    expect(file).toMatch(/const BTN = ["'][^"']*bg-red-600[^"']*["']/);
    expect(file).toContain('px-4');
    expect(file).not.toContain('bg-blue-600');
    expect(file).not.toContain('twMerge');
    expect(bindingRewrites).toHaveLength(1);
  });

  it('NEGATIVE: imported const → stays the #381 twMerge path, NOT find-replaced', () => {
    // An imported binding's value lives in ANOTHER file (a master component) we must not edit.
    const code = [
      "import { OPAQUE_BG } from './tokens';",
      'const C = () => <div className={clsx("p-2", OPAQUE_BG)}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600',
    );

    // No same-file const to rewrite → no binding rewrite recorded.
    expect(bindingRewrites).toHaveLength(0);
    // The import is untouched and the residual escalates to twMerge (case b, #381 path).
    expect(file).toContain("import { OPAQUE_BG } from './tokens'");
    expect(file).toContain('twMerge');
    expect(file).toContain('bg-red-600');
  });

  it('NEGATIVE: prop-member residual (props.bg) is not a same-file const → not find-replaced', () => {
    // A member expression is never a plain same-file const (case c). Binding resolution does not
    // fire; #381's existing path runs (twMerge override since the DOM shows an opaque conflict).
    const code = 'const C = (props) => <div className={clsx("p-2", props.bg)}>Hi</div>;';
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600',
    );

    expect(bindingRewrites).toHaveLength(0);
    // props.bg is never rewritten — the member access survives untouched.
    expect(file).toContain('props.bg');
    // The opaque residual escalates to twMerge (canInject default true here).
    expect(file).toContain('twMerge');
  });

  it('NEGATIVE: same-file `let` re-assigned at top level → value uncertain, not find-replaced', () => {
    const code = [
      "let DYN = 'bg-blue-600';",
      "DYN = someCondition ? 'bg-green-600' : DYN;",
      'const C = () => <div className={clsx("p-2", DYN)}>Hi</div>;',
    ].join('\n');
    const { bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600',
    );
    // Re-assigned → bail to the conservative path (no binding rewrite).
    expect(bindingRewrites).toHaveLength(0);
  });

  it('NEGATIVE: const init is a call (cva/object) → not a literal, not find-replaced', () => {
    const code = [
      "const STYLES = cva('bg-blue-600');",
      'const C = () => <div className={clsx("p-2", STYLES)}>Hi</div>;',
    ].join('\n');
    const { bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600',
    );
    expect(bindingRewrites).toHaveLength(0);
  });

  it('RESIDUAL-DRIVEN: const reachable only via a runtime-false branch (absent from DOM) is NOT rewritten', () => {
    // `cond && OPAQUE_BG` — at the captured moment the const is NOT applied (the live DOM does not show
    // bg-blue-600), so binding resolution must NOT rewrite a value the user isn't currently seeing.
    // Spec §2: the rewrite is residual-driven (keyed off liveDomConflictClasses), not "any matching const".
    const code = [
      "const OPAQUE_BG = 'bg-blue-600';",
      'const C = () => <div className={clsx("p-2", cond && OPAQUE_BG)}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2', // live DOM: only p-2 — the conditional const is NOT applied right now
    );
    expect(bindingRewrites).toHaveLength(0);
    // The const literal is untouched.
    expect(file).toContain("const OPAQUE_BG = 'bg-blue-600'");
  });

  it('RESIDUAL-DRIVEN: no domClasses signal → no const rewrite (residual unknown)', () => {
    // Without a live-DOM signal there is no residual to drive the rewrite — fall back to existing
    // behavior (the append path), never speculatively rewrite the const.
    const code = [
      "const OPAQUE_BG = 'bg-blue-600';",
      'const C = () => <div className={clsx("p-2", OPAQUE_BG)}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(code, { color: 'bg-red-600' }, ['backgroundColor'], 'append');
    expect(bindingRewrites).toHaveLength(0);
    expect(file).toContain("const OPAQUE_BG = 'bg-blue-600'");
  });

  it('LOGICAL ||: the LEFT operand IS a class value → a same-file const there IS find-replaced', () => {
    // `BTN || 'p-2'` renders BTN's value when truthy, so BTN is a class value (not a condition). Binding
    // resolution must follow it and find-replace the live conflict at the const.
    const code = ["const BTN = 'bg-blue-600';", 'const C = () => <div className={BTN || "p-2"}>Hi</div>;'].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'bg-blue-600',
    );
    expect(bindingRewrites).toHaveLength(1);
    expect(file).toMatch(/const BTN = ['"][^'"]*bg-red-600[^'"]*['"]/);
    expect(file).not.toContain('bg-blue-600');
  });

  it('LOGICAL &&: the LEFT operand is a CONDITION → a const used only there is NOT resolved', () => {
    // `GATE && 'p-2'` — GATE is a pure condition. Even if GATE's literal carried the conflict, rewriting
    // it would corrupt a non-class value. The inline literal carries the live conflict instead.
    const code = [
      "const GATE = 'bg-blue-600';",
      'const C = () => <div className={clsx("bg-blue-600", GATE && "p-2")}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'bg-blue-600 p-2',
    );
    expect(bindingRewrites).toHaveLength(0);
    expect(file).toContain("const GATE = 'bg-blue-600'");
  });

  it('CODEX P2: a const used only as a TERNARY TEST is never resolved (no value corruption)', () => {
    // `FLAG ? 'p-2' : 'p-4'` — FLAG is a condition, not a class value. Even if FLAG's literal happens to
    // contain the conflict class, rewriting it would corrupt a non-class value. The inline literal
    // 'bg-blue-600' carries the conflict and is the real residual source.
    const code = [
      "const FLAG = 'bg-blue-600';",
      'const C = () => <div className={clsx("bg-blue-600", FLAG ? "p-2" : "p-4")}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'bg-blue-600 p-2',
    );
    // FLAG (a ternary test) is NOT rewritten — its literal stays bg-blue-600.
    expect(bindingRewrites).toHaveLength(0);
    expect(file).toContain("const FLAG = 'bg-blue-600'");
    // The inline literal carried the conflict and was stripped/replaced there.
    expect(file).toContain('bg-red-600');
  });

  it('CODEX P2: a class already handled by an inline static literal does NOT trigger a const rewrite', () => {
    // The inline 'bg-blue-600' is stripped+replaced by the static rewrite (it's in staticRemoved). The
    // residual passed to binding resolution is liveConflict − staticRemoved = ∅, so the same-file const
    // SAME (which also happens to hold bg-blue-600) is left untouched.
    const code = [
      "const SAME = 'bg-blue-600';",
      'const C = () => <div className={clsx("bg-blue-600 p-2", cond && SAME)}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'bg-blue-600 p-2', // live DOM: only the inline bg-blue-600 is applied (cond false → SAME absent)
    );
    expect(bindingRewrites).toHaveLength(0);
    expect(file).toContain("const SAME = 'bg-blue-600'");
  });

  it('CODEX P2: control-flow re-assignment of a `let` (if-block) → value uncertain, not rewritten', () => {
    const code = [
      "let DYN = 'bg-blue-600';",
      "if (cond) { DYN = 'bg-green-600'; }",
      'const C = () => <div className={clsx("p-2", DYN)}>Hi</div>;',
    ].join('\n');
    const { file, bindingRewrites } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600',
    );
    // Reassigned inside control flow → bail (the top-level-only scan must catch this).
    expect(bindingRewrites).toHaveLength(0);
    expect(file).toContain("let DYN = 'bg-blue-600'");
  });

  it('CODEX P1: mixed same-file const + opaque-prop residual → twMerge override WITH its import (no broken build)', () => {
    // The const OPAQUE_BG is find-replaced, but props.bg ALSO contributes a live same-group conflict the
    // AST cannot strip → the residual escalates to a twMerge override. The injected `import { twMerge }`
    // MUST be present (the executor must whole-file recast in this mixed case, not splice-only).
    const code = [
      "const OPAQUE_BG = 'bg-blue-600';",
      'const C = (props) => <div className={clsx("p-2", OPAQUE_BG, props.bg)}>Hi</div>;',
    ].join('\n');
    const { file } = writeColorFull(
      code,
      { color: 'bg-red-600' },
      ['backgroundColor'],
      'append',
      'p-2 bg-blue-600 bg-green-600', // both the const (blue) and props.bg (green) are live
      true,
    );
    // twMerge override applied for the opaque props.bg residual.
    expect(file).toContain('twMerge');
    expect(file).toContain('bg-red-600');
    // The const was also rewritten in place (no longer blue).
    expect(file).not.toContain('bg-blue-600');
  });
});
