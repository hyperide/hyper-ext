/**
 * @file A1 forward-detector — named recognizers for known library idioms (HYP-1229 plan §4/§5).
 *
 * Each recognizer matches a SPECIFIC, narrow syntactic shape tied to a known library contract —
 * not a general dataflow tracer. `detectAsChildSlotPattern` is the shadcn/Radix flagship case
 * (review finding #2): Radix's `Slot` always merges whatever props it receives (including
 * `className`/`style`) onto its single child via `cloneElement`.
 *
 * NOT wired as a verification bypass in `forward-detect.ts` (retired, PR #719 P2 review finding):
 * recognizing the shape alone is not evidence a channel is actually forwarded — `const Comp =
 * asChild ? Slot : "button"; return <Comp />;` (zero attributes) matches the shape but forwards
 * nothing. `forward-detect-trace.ts`'s general tracer now walks every top-level return AND every
 * ternary/`&&` arm as its own mutually-exclusive alternative, so it fully covers both shapes below
 * WITH real per-channel attribute verification on its own — this module is currently exercised
 * only by its own tests, kept for the HYP-1235 unification with the ext's older
 * `style-forwarding-check.ts` copy. Deliberately does NOT generalize to arbitrary `cloneElement`
 * usage outside this idiom (documented non-goal, plan §5).
 */
import * as t from '@babel/types';
import { classifyStyledComponentsExpression } from './forward-detect-locate';

/**
 * Matches either shadcn idiom (see the file header for why this is no longer a verification
 * bypass — kept as a pure shape recognizer):
 *   (a) `const Comp = asChild ? Slot : "button"` — a ternary-assigned tag identifier, used
 *       directly as a JSX tag (`<Comp ... />`).
 *   (b) `if (asChild) return <Slot ...>...</Slot>; return <button ...>...</button>;` — TWO
 *       early-return branches.
 * Returns true only when the imported `Slot` identifier is found AND one of the two shapes matches.
 */
export function detectAsChildSlotPattern(fnNode: t.Function, fileAst: t.File): boolean {
  const slotLocalName = findImportedLocalName(fileAst, 'Slot');
  if (!slotLocalName) return false;
  return hasTagTernaryShape(fnNode, slotLocalName) || hasDualReturnSlotShape(fnNode, slotLocalName);
}

/** Standalone, separately-testable wrapper around the styled-components classifier (plan §8 step 2). */
export function detectStyledComponentsPattern(initializer: t.Node | null | undefined): boolean {
  return classifyStyledComponentsExpression(initializer).matched;
}

function findImportedLocalName(ast: t.File, importedName: string): string | null {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    for (const spec of node.specifiers) {
      if (!t.isImportSpecifier(spec)) continue;
      const imported = spec.imported;
      const name = t.isIdentifier(imported) ? imported.name : imported.value;
      if (name === importedName) return spec.local.name;
    }
  }
  return null;
}

function hasTagTernaryShape(fnNode: t.Function, slotLocalName: string): boolean {
  const body = fnNode.body;
  if (!t.isBlockStatement(body)) return false;
  return body.body.some((stmt) => variableDeclarationHasSlotTernary(stmt, slotLocalName));
}

function variableDeclarationHasSlotTernary(stmt: t.Statement, slotLocalName: string): boolean {
  if (!t.isVariableDeclaration(stmt)) return false;
  return stmt.declarations.some((d) => {
    const init = d.init;
    return (
      !!init && t.isConditionalExpression(init) && isSlotVsHostPair(init.consequent, init.alternate, slotLocalName)
    );
  });
}

function isSlotVsHostPair(a: t.Expression, b: t.Expression, slotLocalName: string): boolean {
  const aIsSlot = t.isIdentifier(a) && a.name === slotLocalName;
  const bIsSlot = t.isIdentifier(b) && b.name === slotLocalName;
  return (aIsSlot && t.isStringLiteral(b)) || (bIsSlot && t.isStringLiteral(a));
}

function hasDualReturnSlotShape(fnNode: t.Function, slotLocalName: string): boolean {
  const body = fnNode.body;
  if (!t.isBlockStatement(body)) return false;

  let slotBranchFound = false;
  let hostBranchFound = false;
  for (const stmt of body.body) {
    if (t.isIfStatement(stmt) && !stmt.alternate) {
      const ret = singleReturnIn(stmt.consequent);
      if (ret && jsxRootTagName(ret) === slotLocalName) slotBranchFound = true;
    }
    if (t.isReturnStatement(stmt)) {
      const tag = jsxRootTagName(stmt.argument ?? undefined);
      if (tag && isLowercaseTag(tag)) hostBranchFound = true;
    }
  }
  return slotBranchFound && hostBranchFound;
}

function singleReturnIn(stmt: t.Statement): t.Expression | null | undefined {
  if (t.isReturnStatement(stmt)) return stmt.argument;
  if (t.isBlockStatement(stmt)) {
    const ret = stmt.body.find((s): s is t.ReturnStatement => t.isReturnStatement(s));
    return ret?.argument;
  }
  return undefined;
}

function jsxRootTagName(expr: t.Expression | null | undefined): string | null {
  if (!expr || !t.isJSXElement(expr)) return null;
  const name = expr.openingElement.name;
  return t.isJSXIdentifier(name) ? name.name : null;
}

function isLowercaseTag(name: string): boolean {
  return /^[a-z]/.test(name);
}
