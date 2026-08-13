/**
 * AST utilities for modifying dynamic className expressions
 * Handles template literals, cn() calls, and concatenation
 */

import * as t from '@babel/types';
import { getConflictingPrefixes } from '../tailwind/generator.js';
import { removeConflictingClasses } from '../tailwind/parser.js';
import type { ClassNameLocation } from '../types.js';
import { getAttribute, setAttribute } from './mutator.js';

/** Callee names whose first/string arguments hold static Tailwind class literals. */
const CLASS_MERGE_CALLEES = new Set(['cn', 'clsx', 'classnames', 'classNames', 'twMerge', 'cva', 'tw']);

/**
 * Merge callees that resolve Tailwind conflicts last-wins (tailwind-merge backed by convention).
 * For these, appending the new class as the LAST argument already makes it win — no outer twMerge
 * wrap and no extra import are needed.
 */
const TW_BACKED_MERGE_CALLEES = new Set(['cn', 'twMerge', 'cva', 'tw']);

/** Pure-concatenation callees: appending an argument does NOT win Tailwind conflicts. */
const PLAIN_CONCAT_MERGE_CALLEES = new Set(['clsx', 'classnames', 'classNames']);

function getCalleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  if (t.isIdentifier(callee)) return callee.name;
  // twMerge(clsx(...)) or styles.cn(...) — use the trailing member property name
  if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) return callee.property.name;
  return null;
}

/**
 * Detect type of className attribute
 */
export function detectClassNameType(element: t.JSXElement): 'string' | 'template' | 'call' | 'expression' {
  const attr = getAttribute(element, 'className');
  if (!attr) return 'string';

  if (t.isStringLiteral(attr)) return 'string';
  if (t.isJSXExpressionContainer(attr)) {
    const expr = attr.expression;
    if (t.isTemplateLiteral(expr)) return 'template';
    if (t.isCallExpression(expr)) return 'call';
    return 'expression';
  }
  return 'string';
}

/**
 * Modify a string literal in place by applying class removal/addition logic
 * Also handles synthetic StringLiterals created from template quasi (via __quasiRef)
 */
function modifyStringLiteralInPlace(
  stringLiteral: t.StringLiteral,
  newClasses: string,
  changedStyleKeys: string[],
  _specificClassesToRemove?: string[], // kept for API compatibility, not used
): void {
  const oldValue = stringLiteral.value;

  const prefixes = getConflictingPrefixes(changedStyleKeys);

  console.log('[modifyStringLiteralInPlace] Input:', {
    oldValue,
    changedStyleKeys,
    prefixes,
  });

  // Always use prefix-based removal
  // AI's job is to find WHERE the string is, not WHAT to remove
  // specificClassesToRemove is ignored - prefix matching is more reliable
  const preserved = removeConflictingClassesFromString(oldValue, prefixes);
  console.log('[modifyStringLiteralInPlace] After prefix removal, preserved:', preserved);

  // Add new classes
  const newValue = [preserved, newClasses].filter(Boolean).join(' ').trim();

  // Modify in place
  stringLiteral.value = newValue;

  // If this is a synthetic StringLiteral from a template quasi, update the quasi too
  const quasiRef = (stringLiteral as unknown as { __quasiRef?: t.TemplateElement }).__quasiRef;
  if (quasiRef) {
    // Preserve trailing space if quasi had one (for template literal formatting)
    const hadTrailingSpace = quasiRef.value.raw.endsWith(' ');
    quasiRef.value.raw = newValue + (hadTrailingSpace ? ' ' : '');
    quasiRef.value.cooked = quasiRef.value.raw;
    console.log('[modifyStringLiteralInPlace] Updated quasi ref:', quasiRef.value.raw);
  }
}

/**
 * Extract string literals from a ternary expression or complex expression
 * e.g., '(x ? "foo" : "bar") + " baz"' -> ["foo", "bar", " baz"]
 */
function extractStringLiteralsFromExpression(expr: string): string[] {
  const strings: string[] = [];
  // Match double-quoted strings
  const doubleQuoted = expr.match(/"([^"\\]*(\\.[^"\\]*)*)"/g);
  if (doubleQuoted) {
    for (const match of doubleQuoted) {
      // Remove quotes
      strings.push(match.slice(1, -1));
    }
  }
  // Match single-quoted strings
  const singleQuoted = expr.match(/'([^'\\]*(\\.[^'\\]*)*)'/g);
  if (singleQuoted) {
    for (const match of singleQuoted) {
      // Remove quotes
      strings.push(match.slice(1, -1));
    }
  }
  return strings;
}

/**
 * Find string literal by code line and literal value
 * Algorithm:
 * 1. Search for codeLine in source code
 * 2. If multiple matches, pick closest to hintLine
 * 3. In found line, search for StringLiteral with value === literalValue
 * 4. If codeLine not found, search for literalValue in entire AST
 * 5. If literalValue looks like a ternary, extract individual strings and search for those
 */
function findStringLiteralByCodeLine(
  ast: t.File,
  sourceCode: string,
  codeLine: string,
  literalValue: string,
  hintLine: number,
): t.StringLiteral | null {
  const sourceLines = sourceCode.split('\n');

  // Normalize codeLine for comparison (remove extra whitespace, handle multiline)
  const normalizeString = (s: string) => s.replace(/\s+/g, ' ').trim();
  const normalizedCodeLine = normalizeString(codeLine);

  // Step 1: Find all lines that could contain the codeLine
  // For multiline expressions, we look for lines that contain key parts
  const matchingLineNumbers: number[] = [];

  // First try exact match
  for (let i = 0; i < sourceLines.length; i++) {
    if (sourceLines[i] === codeLine) {
      matchingLineNumbers.push(i + 1); // 1-indexed
    }
  }

  // If no exact match, try normalized comparison for single-line or find by literalValue
  if (matchingLineNumbers.length === 0) {
    for (let i = 0; i < sourceLines.length; i++) {
      const normalizedLine = normalizeString(sourceLines[i]);
      // Check if line contains the literalValue (for inline ternary)
      if (normalizedLine === normalizedCodeLine || sourceLines[i].includes(literalValue)) {
        matchingLineNumbers.push(i + 1);
      }
    }
  }

  // Step 2: Pick closest to hintLine if multiple matches
  let targetLine: number | null = null;
  if (matchingLineNumbers.length === 1) {
    targetLine = matchingLineNumbers[0];
  } else if (matchingLineNumbers.length > 1) {
    // Find closest to hintLine
    targetLine = matchingLineNumbers.reduce((closest, current) => {
      const closestDist = Math.abs(closest - hintLine);
      const currentDist = Math.abs(current - hintLine);
      return currentDist < closestDist ? current : closest;
    });
    // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    console.log(
      `[DynamicClassName] Found ${matchingLineNumbers.length} matches for codeLine, using line ${targetLine} (closest to hint ${hintLine})`,
    );
  }

  // Step 3: If targetLine found, search for literal at or near that line
  if (targetLine !== null) {
    let found: t.StringLiteral | null = null;
    let closestMatch: { node: t.StringLiteral; distance: number } | null = null;

    const traverse = (node: unknown): void => {
      if (!node || typeof node !== 'object' || found) return;

      if (t.isStringLiteral(node as t.Node)) {
        const stringNode = node as t.StringLiteral;
        if (stringNode.loc && stringNode.value === literalValue) {
          const distance = Math.abs(stringNode.loc.start.line - targetLine);
          // Exact line match
          if (distance === 0) {
            found = stringNode;
            return;
          }
          // Track closest match within reasonable range (5 lines for multiline expressions)
          if (distance <= 5 && (!closestMatch || distance < closestMatch.distance)) {
            closestMatch = { node: stringNode, distance };
          }
        }
      }

      for (const key in node as Record<string, unknown>) {
        if (key === 'loc' || key === 'range') continue;
        const value = (node as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const item of value) traverse(item);
        } else if (typeof value === 'object' && value !== null) {
          traverse(value);
        }
      }
    };

    traverse(ast.program);

    if (found) return found;
    // TS strict doesn't track closure mutations — explicit cast needed
    const step3Match = closestMatch as { node: t.StringLiteral; distance: number } | null;
    if (step3Match) {
      // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      console.log(
        `[DynamicClassName] Using closest match at line ${step3Match.node.loc?.start.line} (${step3Match.distance} lines from hint)`,
      );
      return step3Match.node;
    }
  }

  // Step 4: Search near hintLine directly (for multiline ternary where codeLine doesn't match)
  if (hintLine > 0) {
    console.log(`[DynamicClassName] Searching near hintLine ${hintLine} for literalValue`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    let closestMatch: { node: t.StringLiteral; distance: number } | null = null;

    const traverse = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;

      if (t.isStringLiteral(node as t.Node)) {
        const stringNode = node as t.StringLiteral;
        if (stringNode.loc && stringNode.value === literalValue) {
          const distance = Math.abs(stringNode.loc.start.line - hintLine);
          // Within 10 lines of hint
          if (distance <= 10 && (!closestMatch || distance < closestMatch.distance)) {
            closestMatch = { node: stringNode, distance };
          }
        }
      }

      for (const key in node as Record<string, unknown>) {
        if (key === 'loc' || key === 'range') continue;
        const value = (node as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const item of value) traverse(item);
        } else if (typeof value === 'object' && value !== null) {
          traverse(value);
        }
      }
    };

    traverse(ast.program);

    const step4Match = closestMatch as { node: t.StringLiteral; distance: number } | null;
    if (step4Match) {
      // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      console.log(`[DynamicClassName] Found by hintLine at line ${step4Match.node.loc?.start.line}`);
      return step4Match.node;
    }
  }

  // Step 5: Last resort fallback - search for literalValue in entire AST
  console.log('[DynamicClassName] codeLine not found, searching by literalValue in entire AST');
  let found: t.StringLiteral | null = null;

  const traverseStep5 = (node: unknown): void => {
    if (!node || typeof node !== 'object' || found) return;

    if (t.isStringLiteral(node as t.Node)) {
      const stringNode = node as t.StringLiteral;
      if (stringNode.value === literalValue) {
        found = stringNode;
        return;
      }
    }

    for (const key in node as Record<string, unknown>) {
      if (key === 'loc' || key === 'range') continue;
      const value = (node as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) traverseStep5(item);
      } else if (typeof value === 'object' && value !== null) {
        traverseStep5(value);
      }
    }
  };

  traverseStep5(ast.program);
  if (found) return found;

  // Step 6: If literalValue looks like a ternary/complex expression, extract strings and search
  // This handles cases like: (cond ? "foo" : "bar") + " baz"
  if (literalValue.includes('?') || literalValue.includes('+')) {
    console.log('[DynamicClassName] literalValue looks like ternary/complex expression, extracting strings...');
    const extractedStrings = extractStringLiteralsFromExpression(literalValue);
    console.log(
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      `[DynamicClassName] Extracted ${extractedStrings.length} strings:`,
      extractedStrings.map((s) => `${s.slice(0, 30)}...`),
    );

    // Find the longest string that contains classes (most likely the main content)
    // Sort by length descending to prioritize longer strings (they contain more classes)
    const sortedByLength = [...extractedStrings].sort((a, b) => b.length - a.length);

    for (const extractedValue of sortedByLength) {
      let closestToHint: { node: t.StringLiteral; distance: number } | null = null;

      const traverseStep6 = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;

        if (t.isStringLiteral(node as t.Node)) {
          const stringNode = node as t.StringLiteral;
          if (stringNode.value === extractedValue && stringNode.loc) {
            const distance = Math.abs(stringNode.loc.start.line - hintLine);
            // Exact or close match to hint line
            if (distance <= 10) {
              if (!closestToHint || distance < closestToHint.distance) {
                closestToHint = { node: stringNode, distance };
              }
            }
          }
        }

        for (const key in node as Record<string, unknown>) {
          if (key === 'loc' || key === 'range') continue;
          const value = (node as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            for (const item of value) traverseStep6(item);
          } else if (typeof value === 'object' && value !== null) {
            traverseStep6(value);
          }
        }
      };

      traverseStep6(ast.program);

      const step6Match = closestToHint as { node: t.StringLiteral; distance: number } | null;
      if (step6Match) {
        console.log(
          `[DynamicClassName] Found extracted string "${extractedValue.slice(0, 30)}..." at line ${step6Match.node.loc?.start.line}`,
        ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        return step6Match.node;
      }
    }
  }

  // Step 7: If literalValue looks like a template literal, try to find the first quasi
  // Template literals: `p-4 ${cond}` have quasis["p-4 ", ""] - the first quasi contains base classes
  if (literalValue.includes('${')) {
    console.log('[DynamicClassName] literalValue looks like template literal, searching for first quasi...');
    // Extract content before first ${
    const firstPart = literalValue.split('${')[0].trim();
    if (firstPart) {
      console.log(`[DynamicClassName] Looking for first quasi content: "${firstPart.slice(0, 50)}..."`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string;

      // Search for TemplateLiteral with first quasi matching this content
      let foundQuasi: t.TemplateElement | null = null;
      let closestDistance = Infinity;

      const traverseStep7 = (node: unknown): void => {
        if (!node || typeof node !== 'object' || foundQuasi) return;

        if (t.isTemplateLiteral(node as t.Node)) {
          const templateNode = node as t.TemplateLiteral;
          const firstQuasi = templateNode.quasis[0];
          if (firstQuasi?.loc) {
            // Check if first quasi contains or matches our content
            const quasiContent = firstQuasi.value.raw.trim();
            if (quasiContent === firstPart || quasiContent.includes(firstPart) || firstPart.includes(quasiContent)) {
              const distance = Math.abs(firstQuasi.loc.start.line - hintLine);
              if (distance <= 15 && distance < closestDistance) {
                closestDistance = distance;
                foundQuasi = firstQuasi;
                console.log(`[DynamicClassName] Found matching template quasi at line ${firstQuasi.loc.start.line}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
              }
            }
          }
        }

        for (const key in node as Record<string, unknown>) {
          if (key === 'loc' || key === 'range') continue;
          const value = (node as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            for (const item of value) traverseStep7(item);
          } else if (typeof value === 'object' && value !== null) {
            traverseStep7(value);
          }
        }
      };

      traverseStep7(ast.program);

      const step7Match = foundQuasi as t.TemplateElement | null;
      if (step7Match) {
        // Create a synthetic StringLiteral from the quasi for modification
        // This is a hack but allows reusing modifyStringLiteralInPlace
        const syntheticStringLiteral = t.stringLiteral(step7Match.value.raw);
        // Store reference to quasi so we can update it after modification
        (syntheticStringLiteral as unknown as { __quasiRef: t.TemplateElement }).__quasiRef = step7Match;
        console.log('[DynamicClassName] Returning synthetic StringLiteral for quasi modification');
        return syntheticStringLiteral;
      }
    }
  }

  return null;
}

/**
 * Modify className by locations found by AI
 * This modifies the actual variable/string where classes are defined
 * @returns Number of successfully modified string literals
 */
function modifyByLocations(
  ast: t.File,
  sourceCode: string,
  locations: ClassNameLocation[],
  newClasses: string,
  changedStyleKeys: string[],
): number {
  // Group locations by literalValue to handle multiple properties targeting same string
  // AI may return separate locations for each property (e.g., alignItems and justifyItems)
  // but they point to the same string literal
  const groupedLocations = new Map<
    string,
    {
      location: ClassNameLocation;
      allContainsClasses: string[];
    }
  >();

  for (const location of locations) {
    const key = location.literalValue;
    console.log(
      `[DynamicClassName] Location: property=${location.property}, containsClasses=${JSON.stringify(location.containsClasses)}, literalValue="${key.slice(0, 50)}..."`,
    ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string;
    const existing = groupedLocations.get(key);
    if (existing) {
      // Merge containsClasses from multiple locations targeting same string
      console.log(`[DynamicClassName] Merging with existing, adding: ${JSON.stringify(location.containsClasses)}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      existing.allContainsClasses.push(...location.containsClasses);
    } else {
      groupedLocations.set(key, {
        location,
        allContainsClasses: [...location.containsClasses],
      });
    }
  }

  console.log(`[DynamicClassName] Grouped ${locations.length} locations into ${groupedLocations.size} unique strings`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  let successCount = 0;

  // Now modify each unique string literal once with all classes to remove
  for (const [literalValue, { location, allContainsClasses }] of groupedLocations) {
    const stringLiteral = findStringLiteralByCodeLine(
      ast,
      sourceCode,
      location.codeLine,
      literalValue,
      location.startLine,
    );

    if (stringLiteral) {
      // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      console.log(`[DynamicClassName] Found string literal at ${location.variableName}, modifying...`);
      // Use merged containsClasses from all locations targeting this string
      modifyStringLiteralInPlace(stringLiteral, newClasses, changedStyleKeys, allContainsClasses);
      successCount++;
    } else {
      // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      console.warn(
        `[DynamicClassName] Could not find string literal for ${location.variableName} (codeLine: "${location.codeLine}", literalValue: "${literalValue}")`,
      );
    }
  }

  return successCount;
}

/**
 * Remove conflicting Tailwind classes from a class string
 * @param classes - Space-separated Tailwind classes
 * @param prefixes - Array of prefixes to remove (e.g., ['bg-', 'text-'])
 * @returns Filtered class string
 */
function removeConflictingClassesFromString(classes: string, prefixes: string[]): string {
  const classList = classes.split(/\s+/).filter(Boolean);

  const filtered = classList.filter((cls) => {
    for (const prefix of prefixes) {
      if (cls === prefix || cls.startsWith(prefix)) {
        // Special case: don't remove 'border' (border-width) when removing borderColor
        if (prefix === 'border-' && cls === 'border') {
          continue;
        }
        return false;
      }
    }
    return true;
  });

  return filtered.join(' ');
}

/**
 * Append classes to the last quasi of a template literal
 * Also removes conflicting classes from ALL quasis
 * className={`base block ${dynamic}`} -> className={`base ${dynamic} flex`}
 */
function appendToLastString(element: t.JSXElement, newClasses: string, changedStyleKeys: string[]): void {
  const attr = getAttribute(element, 'className');
  if (!attr || !t.isJSXExpressionContainer(attr)) return;

  const expr = attr.expression;
  if (!t.isTemplateLiteral(expr)) return;

  const prefixes = getConflictingPrefixes(changedStyleKeys);

  // Remove conflicting classes from ALL quasis (not just last one)
  // This handles cases like: `block p-4 ${dynamic}` -> `p-4 ${dynamic} flex`
  for (const quasi of expr.quasis) {
    const existingClasses = quasi.value.raw;
    const filtered = removeConflictingClassesFromString(existingClasses, prefixes);
    if (filtered !== existingClasses) {
      // Preserve leading/trailing whitespace structure
      const leadingSpace = existingClasses.match(/^\s*/)?.[0] || '';
      const trailingSpace = existingClasses.match(/\s*$/)?.[0] || '';
      quasi.value.raw = leadingSpace + filtered.trim() + trailingSpace;
      quasi.value.cooked = quasi.value.raw;
    }
  }

  // Get the last quasi (static string part) to append new classes
  const lastQuasi = expr.quasis[expr.quasis.length - 1];

  // Append new classes to last quasi
  const existingInLast = lastQuasi.value.raw.trim();
  const newValue = existingInLast ? `${existingInLast} ${newClasses}` : newClasses;

  lastQuasi.value.raw = ` ${newValue}`;
  lastQuasi.value.cooked = ` ${newValue}`;
}

interface InPlaceReplaceResult {
  /** A conflicting same-property class was found and stripped in at least one static literal. */
  handledConflict: boolean;
  /**
   * After rewrite, the new class is guaranteed to be present at runtime regardless of which
   * conditional branch is taken. When false, the caller must still append the new class so the
   * inspector's intent applies on every code path (e.g. a ternary with a dynamic branch).
   */
  guaranteedNewClass: boolean;
}

/**
 * Strip the conflicting same-property class from the STATIC string literals of a complex className
 * expression (cn()/clsx()/twMerge()/ternary), injecting the new class where a conflict was removed.
 *
 * Reuses the same state-aware conflict detection the plain-string path uses
 * (parser.removeConflictingClasses), so gradients/opacity/non-color bg classes and unrelated state
 * variants are preserved exactly like the string path.
 *
 * Semantics per node:
 * - string literal: if it carries a conflicting class, strip it and inject the new class →
 *   the new class is then unconditionally present in that literal.
 * - cn()/clsx()/... call: arguments are concatenated (additive). The new class is guaranteed if
 *   ANY eligible argument guarantees it. A conflict in any argument counts as handled.
 * - ternary: branches are mutually exclusive. The new class is guaranteed only if BOTH branches
 *   guarantee it; a conflict in either branch counts as handled (and is stripped) but does not by
 *   itself guarantee unconditional presence.
 *
 * Deliberately NOT rewritten (documented limitation): string literals reachable only through a
 * dynamic sub-expression such as `cond && "text-red-500"`, or object/array args. We never mutate
 * those — rewriting an author's conditional would change its runtime semantics (e.g. dropping the
 * color entirely on the false branch). A same-group class living only in such a branch therefore
 * survives; the caller still concat-appends the new class so the inspector's value applies on every
 * path. With plain `clsx` (no twMerge) this can leave both classes in the attribute, and Tailwind's
 * conflict resolution follows generated-CSS order, not attribute order — so the visual result for
 * that residual case is not guaranteed. This is acceptable: inspector-written classes live in the
 * static portion, which is always rewritten correctly.
 */
/**
 * Strip the conflicting same-property class from string literals inside an expression WITHOUT
 * injecting any new class. Used for short-circuit operands (`cond && "text-red-500"`) where the
 * "off" path is colorless, so the conflicting color can be safely removed but the picked class
 * must NOT be planted in the conditional branch (it would only apply on the truthy path) — the
 * caller appends it once outside instead.
 *
 * Recurses parens / nested logical / ternary / concat / merge-call string-literal args so a color
 * nested anywhere inside the branch is still removed. Returns whether any class was stripped.
 */
function stripConflictInLiterals(node: t.Expression, changedStyleKeys: string[], state?: string): boolean {
  if (t.isStringLiteral(node)) {
    const { preserved, removed } = removeConflictingClasses(node.value, changedStyleKeys, state);
    if (removed.length === 0) return false;
    const lead = /^\s*/.exec(node.value)?.[0] ?? '';
    const trail = /\s*$/.exec(node.value)?.[0] ?? '';
    node.value = `${lead}${preserved.trim()}${trail}`;
    return true;
  }
  if (t.isParenthesizedExpression(node)) {
    return stripConflictInLiterals(node.expression, changedStyleKeys, state);
  }
  // The safe rule is POSITION, not truthiness: only rewrite operands that are RENDERED as the
  // class value, never a guard whose own string controls short-circuit evaluation.
  //  - `A && B`: A is a pure guard — clsx receives the value of (A && B) = B when A is truthy, else
  //    a falsy it ignores; A's string is never a class. Recurse RIGHT only (covers a nested logical
  //    value branch in B, e.g. `cond && (a || "text-red-500")`).
  //  - `A || B`: both A (when truthy) and B (fallback) are rendered values. Recurse BOTH, which also
  //    covers a fallback chain like `(cond && "text-red-500") || "text-green-500"` where the
  //    conflict hides in the left operand.
  // (Out of scope: a bare string literal as an `||` LEFT operand, e.g. `"text-red-500" || x` —
  // emptying it would resurrect the dead right side. Such a shape does not occur in real className
  // code and is intentionally not special-cased.)
  if (t.isLogicalExpression(node) && node.operator === '&&') {
    return t.isExpression(node.right) ? stripConflictInLiterals(node.right, changedStyleKeys, state) : false;
  }
  if (t.isLogicalExpression(node) && node.operator === '||') {
    const l = t.isExpression(node.left) ? stripConflictInLiterals(node.left, changedStyleKeys, state) : false;
    const r = t.isExpression(node.right) ? stripConflictInLiterals(node.right, changedStyleKeys, state) : false;
    return l || r;
  }
  if (t.isConditionalExpression(node)) {
    const c = stripConflictInLiterals(node.consequent, changedStyleKeys, state);
    const a = stripConflictInLiterals(node.alternate, changedStyleKeys, state);
    return c || a;
  }
  if (t.isBinaryExpression(node) && node.operator === '+') {
    const l = t.isExpression(node.left) ? stripConflictInLiterals(node.left, changedStyleKeys, state) : false;
    const r = stripConflictInLiterals(node.right, changedStyleKeys, state);
    return l || r;
  }
  if (t.isCallExpression(node)) {
    const calleeName = getCalleeName(node.callee);
    if (calleeName && CLASS_MERGE_CALLEES.has(calleeName)) {
      let stripped = false;
      for (const arg of node.arguments) {
        if (t.isExpression(arg) && stripConflictInLiterals(arg, changedStyleKeys, state)) stripped = true;
      }
      return stripped;
    }
  }
  return false;
}

function replaceConflictingInStaticLiterals(
  expr: t.Expression,
  newClasses: string,
  changedStyleKeys: string[],
  state?: string,
  // HYP-544: when provided, every same-group class stripped from a static literal is recorded here.
  // The caller diffs it against the live DOM conflict to detect a conflict from an OPAQUE source.
  removedSink?: Set<string>,
): InPlaceReplaceResult {
  const visit = (node: t.Expression): InPlaceReplaceResult => {
    if (t.isStringLiteral(node)) {
      const { preserved, removed } = removeConflictingClasses(node.value, changedStyleKeys, state);
      if (removed.length === 0) {
        return { handledConflict: false, guaranteedNewClass: false };
      }
      if (removedSink) for (const cls of removed) removedSink.add(cls);
      // Preserve the literal's leading/trailing whitespace. A concat tail like `' text-red-500'`
      // (the shape the append fallback itself produces) needs its leading space kept, or the new
      // class would glue onto the preceding operand's last class at runtime (`...p-2text-blue-500`).
      const lead = /^\s*/.exec(node.value)?.[0] ?? '';
      const trail = /\s*$/.exec(node.value)?.[0] ?? '';
      const core = newClasses ? [preserved, newClasses].filter(Boolean).join(' ').trim() : preserved.trim();
      node.value = `${lead}${core}${trail}`;
      // After injection the literal unconditionally carries the new class (when there is one).
      return { handledConflict: true, guaranteedNewClass: Boolean(newClasses) };
    }

    if (t.isParenthesizedExpression(node)) {
      return visit(node.expression);
    }

    // String concatenation `(left) + ' classes'` — the exact shape the append fallback below
    // produces. On a SECOND inspector pick the previously-written color now lives inside this
    // BinaryExpression, so we MUST recurse it or the old color is never stripped (the user's
    // "doesn't even find the value it wrote itself" report).
    //
    // Operands appear in the className string left-to-right, so conflict resolution is ordered:
    // the new class is guaranteed-and-winning only if the LAST operand carries it. A later operand
    // we can't fully account for (an opaque `props.className`, or an analyzable operand that didn't
    // unconditionally inject the new class) might contribute a same-group class after ours — so any
    // such trailing operand clears the guarantee and the caller appends the new class last (matching
    // the cn()/clsx() merge-call semantics below).
    if (t.isBinaryExpression(node) && node.operator === '+') {
      const operands: t.Expression[] = [];
      if (t.isExpression(node.left)) operands.push(node.left);
      operands.push(node.right);
      let handledConflict = false;
      let newClassIsLast = false;
      for (const operand of operands) {
        const r = visit(operand);
        handledConflict = handledConflict || r.handledConflict;
        // This operand injected the new class unconditionally → it is (for now) the last one
        // carrying it. Any subsequent operand that does NOT guarantee it clears the flag.
        newClassIsLast = r.guaranteedNewClass;
      }
      return { handledConflict, guaranteedNewClass: newClassIsLast };
    }

    if (t.isConditionalExpression(node)) {
      const consequent = visit(node.consequent);
      const alternate = visit(node.alternate);
      return {
        handledConflict: consequent.handledConflict || alternate.handledConflict,
        // Mutually exclusive branches: guaranteed only if every branch carries the new class.
        guaranteedNewClass: consequent.guaranteedNewClass && alternate.guaranteedNewClass,
      };
    }

    // Short-circuit `cond && "text-red-500"` / `a || "text-red-500"` (HYP-537). Delegate to
    // stripConflictInLiterals, which removes the conflicting color from the RENDERED-value operands
    // only (the right of `&&`, both sides of `||` — never a guard, see its doc), and never injects
    // the new class into a conditional branch (a branch can't unconditionally carry it). So
    // guaranteedNewClass stays false and the caller appends the new class once outside — every
    // runtime path then renders the picked color, and no competing OLD token survives in any value
    // branch. This narrows HYP-515's over-conservative limitation, which feared dropping a color on
    // a branch the author relied on; stripping a value operand drops nothing, because the picked
    // color is appended unconditionally.
    if (t.isLogicalExpression(node) && (node.operator === '&&' || node.operator === '||')) {
      const handledConflict = stripConflictInLiterals(node, changedStyleKeys, state);
      return { handledConflict, guaranteedNewClass: false };
    }

    if (t.isCallExpression(node)) {
      const calleeName = getCalleeName(node.callee);
      if (calleeName && CLASS_MERGE_CALLEES.has(calleeName)) {
        let handledConflict = false;
        let anyArgGuarantees = false;
        // A merge call (cn/clsx/twMerge) resolves last-wins per Tailwind group. Any argument we
        // cannot analyze (a dynamic branch like `cond && "..."`, a spread, a variable) might carry a
        // LATER same-group class that overrides our injected one. If even one such arg exists we
        // cannot claim the new class is guaranteed — the caller must append it last so it wins.
        let hasUnanalyzableArg = false;
        for (const arg of node.arguments) {
          if (t.isStringLiteral(arg)) {
            // A plain string literal is fully analyzable — its classes are exactly what we see.
            const result = visit(arg);
            handledConflict = handledConflict || result.handledConflict;
            anyArgGuarantees = anyArgGuarantees || result.guaranteedNewClass;
          } else if (t.isConditionalExpression(arg) || t.isCallExpression(arg) || t.isLogicalExpression(arg)) {
            // Includes `cond && "text-red-500"` (HYP-537): visit() strips the conflicting color
            // from the short-circuit branch literal but never guarantees the new class there, so
            // the arg still counts as unanalyzable for win-ordering and the caller appends last.
            const result = visit(arg);
            handledConflict = handledConflict || result.handledConflict;
            anyArgGuarantees = anyArgGuarantees || result.guaranteedNewClass;
            // A ternary/nested call/short-circuit only fully guarantees the new class when every
            // path carries it. If it didn't, it may emit a later same-group class we couldn't
            // account for.
            if (!result.guaranteedNewClass) {
              hasUnanalyzableArg = true;
            }
          } else {
            // Spread, object, identifier, member, etc. — opaque.
            hasUnanalyzableArg = true;
          }
        }
        return {
          handledConflict,
          guaranteedNewClass: anyArgGuarantees && !hasUnanalyzableArg,
        };
      }
    }

    return { handledConflict: false, guaranteedNewClass: false };
  };

  return visit(expr);
}

/**
 * HYP-544: the same-property classes the LIVE applied className (from the DOM) carries for the changed
 * properties. `domClasses` is the authoritative "what is applied right now". The caller diffs this set
 * against the classes the static rewrite stripped — whatever remains came from an OPAQUE source (an
 * opaque prop, a dynamic branch) the AST cannot rewrite, and only that residual needs a twMerge override.
 */
function liveDomConflictClasses(domClasses: string | undefined, changedStyleKeys: string[], state?: string): string[] {
  if (!domClasses) return [];
  return removeConflictingClasses(domClasses, changedStyleKeys, state).removed;
}

/**
 * HYP-544 Phase 1: one same-file const literal that binding resolution rewrote in place. The executor
 * splices each `[start, end)` range with the re-printed `node`, alongside the className value's own
 * span — the const lives in a DISJOINT top-level statement the className splice never touches.
 */
export interface BindingLiteralRewrite {
  /** The rewritten init node — a StringLiteral for `const X = '…'`, or the whole concat/ternary init. */
  node: t.Expression;
  start: number;
  end: number;
}

/**
 * HYP-544 Phase 1: out-channel for write hints the executor must honor. `forceFullReprint` is set when a
 * const find-replace coexists with a twMerge override that INJECTED a top-level import (an inserted node
 * with no source range): the splice path can't represent the insertion, so the executor must whole-file
 * recast instead. Recast still preserves every untouched original node's bytes.
 *
 * HYP-544 Phase 2 (§7): `needsInlineFloor` is set when an OPAQUE same-group conflict reached the element
 * (a color the static AST can't strip, contributed by a prop/param/import) AND a twMerge override could
 * NOT be applied because the project does not resolve `tailwind-merge` (`canInjectTwMerge=false`). A
 * concat-append does not win that cascade, so the mutator leaves the className UNTOUCHED and signals the
 * executor to apply the universal §7 floor — an inline `style` override on the element ref (highest
 * specificity short of !important, no import/config dependency). The mutator never touches the `style`
 * attribute itself (it has only the new className, not the raw color value); the executor owns the write.
 */
export interface MutatorWriteHints {
  forceFullReprint: boolean;
  needsInlineFloor?: boolean;
}

/** Collect every Identifier name referenced inside a className expression (cn/clsx args, ternary branches, concat operands). */
function collectIdentifierNames(expr: t.Expression): Set<string> {
  const names = new Set<string>();
  const visit = (node: t.Node | null | undefined): void => {
    if (!node) return;
    if (t.isIdentifier(node)) {
      names.add(node.name);
      return;
    }
    if (t.isParenthesizedExpression(node)) return visit(node.expression);
    if (t.isBinaryExpression(node)) {
      if (t.isExpression(node.left)) visit(node.left);
      visit(node.right);
      return;
    }
    if (t.isConditionalExpression(node)) {
      // Only the BRANCHES contribute class values; the `test` is a condition (a `FLAG` used only as a
      // ternary test must NOT be resolved — rewriting its literal would corrupt a non-class value).
      visit(node.consequent);
      visit(node.alternate);
      return;
    }
    if (t.isLogicalExpression(node)) {
      // `cond && X`: the LEFT is a pure condition (a `FLAG` used only as `FLAG && '...'` must not be
      // resolved — rewriting its literal would corrupt a non-class value), only RIGHT is a class value.
      // `X || fallback` / `X ?? fallback`: the LEFT *is* the rendered class value when truthy/non-null,
      // so BOTH operands are class-value-producing and must be visited.
      if (node.operator !== '&&' && t.isExpression(node.left)) visit(node.left);
      visit(node.right);
      return;
    }
    if (t.isCallExpression(node)) {
      for (const arg of node.arguments) if (t.isExpression(arg)) visit(arg);
      return;
    }
    if (t.isTemplateLiteral(node)) {
      for (const e of node.expressions) if (t.isExpression(e)) visit(e);
      return;
    }
    // Member/object/array etc. are NOT same-file plain consts (case b/c) — don't descend into them.
  };
  visit(expr);
  return names;
}

/**
 * HYP-544 Phase 1: resolve `name` to a SAME-FILE top-level `const`/`let` whose init is a StringLiteral
 * (or a literal reachable through a string-concat / all-literal-ternary init). Deterministic, AI-free.
 *
 * Excludes (→ stays case b/c, twMerge/append):
 * - bindings declared with `var` or re-assigned later at top level (value not statically certain),
 * - destructured / object-member / computed ids (only a plain `id Identifier === name`),
 * - imports (an ImportSpecifier is a master-component value we must not edit),
 * - function/block-scoped shadows (only top-level module bindings are scanned for v1).
 *
 * Returns the init expression (the literal, or the concat/ternary node carrying literals) so the caller
 * can run the existing static-literal visitor on it. Returns null when no such binding exists.
 */
function resolveSameFileLiteralBinding(ast: t.File, name: string): t.Expression | null {
  let foundInit: t.Expression | null = null;
  let declarationCount = 0;

  for (const node of ast.program.body) {
    if (!t.isVariableDeclaration(node)) continue;
    // `var` has function-scope hoisting / re-assignment ambiguity — treat as non-literal (case c).
    if (node.kind === 'var') continue;
    for (const decl of node.declarations) {
      if (!t.isIdentifier(decl.id) || decl.id.name !== name) continue;
      declarationCount += 1;
      if (decl.init && isTriviallyLiteralInit(decl.init)) {
        foundInit = decl.init;
      } else {
        // A matching declarator whose init is NOT a trivially-literal expression → not case (a).
        return null;
      }
    }
  }

  // More than one top-level declarator for the same name should not happen for a const, but if it did
  // the value is ambiguous — bail to the conservative path.
  if (declarationCount !== 1) return null;

  // A later top-level re-assignment makes the value uncertain — bail (only `let` can be reassigned).
  if (foundInit && isReassignedAtTopLevel(ast, name)) return null;

  return foundInit;
}

/** Is `init` a literal, or a string-concat / ternary built only from trivially-literal sub-expressions? */
function isTriviallyLiteralInit(init: t.Expression): boolean {
  if (t.isStringLiteral(init)) return true;
  if (t.isParenthesizedExpression(init)) return isTriviallyLiteralInit(init.expression);
  if (t.isBinaryExpression(init) && init.operator === '+') {
    return t.isExpression(init.left) && isTriviallyLiteralInit(init.left) && isTriviallyLiteralInit(init.right);
  }
  if (t.isConditionalExpression(init)) {
    return isTriviallyLiteralInit(init.consequent) && isTriviallyLiteralInit(init.alternate);
  }
  return false;
}

/**
 * Is `name` ever re-assigned anywhere in the module (an `AssignmentExpression`/`UpdateExpression`
 * targeting it)? A `let X = '...'` re-bound later — directly (`X = ...`) OR inside module-level
 * control flow (`if (cond) X = '...'`, a loop, a try) — has a value the AST can't statically pin, so
 * we must bail. A structural recursive scan (not just top-level expression statements) is required to
 * catch the control-flow cases; we deliberately scan the whole program rather than only `program.body`.
 */
function isReassignedAtTopLevel(ast: t.File, name: string): boolean {
  let reassigned = false;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || reassigned) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const n = node as t.Node;
    if (t.isAssignmentExpression(n) && t.isIdentifier(n.left) && n.left.name === name) {
      reassigned = true;
      return;
    }
    if (t.isUpdateExpression(n) && t.isIdentifier(n.argument) && n.argument.name === name) {
      reassigned = true;
      return;
    }
    for (const key in node as Record<string, unknown>) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'leadingComments') {
        continue;
      }
      visit((node as Record<string, unknown>)[key]);
    }
  };
  visit(ast.program.body);
  return reassigned;
}

/** Does any string literal inside `init` carry a class token present in the live-conflict set? */
function initCarriesLiveConflict(init: t.Expression, liveConflict: Set<string>): boolean {
  let carries = false;
  const visit = (node: t.Expression | null | undefined): void => {
    if (!node || carries) return;
    if (t.isStringLiteral(node)) {
      for (const tok of node.value.split(/\s+/)) {
        if (tok && liveConflict.has(tok)) {
          carries = true;
          return;
        }
      }
      return;
    }
    if (t.isParenthesizedExpression(node)) return visit(node.expression);
    if (t.isBinaryExpression(node) && node.operator === '+') {
      if (t.isExpression(node.left)) visit(node.left);
      visit(node.right);
      return;
    }
    if (t.isConditionalExpression(node)) {
      visit(node.consequent);
      visit(node.alternate);
    }
  };
  visit(init);
  return carries;
}

/**
 * HYP-544 Phase 1 (residual-driven, per spec §2): for each same-group conflict class the LIVE DOM
 * actually applies (`liveConflict`) but the static rewrite did NOT account for, find the SAME-FILE const
 * literal that contributes it and find-replace there — the same `replaceConflictingInStaticLiterals`
 * primitive used on inline literals, run on the const's init. A const so rewritten is recorded in
 * `rewrites` (with its original source range) and its removed classes are added to `staticRemoved`, so
 * the caller drops them from the opaque residual and only STILL-opaque tokens proceed to twMerge.
 *
 * `liveConflict` gates the rewrite to classes that are *currently applied*: a const reachable only
 * through a runtime-false branch (`cond && OPAQUE_BG`) is absent from `domClasses`, so we don't rewrite
 * a value the user isn't actually seeing. When `liveConflict` is empty (no domClasses signal) nothing is
 * rewritten — the residual flows to the existing fallback exactly as before.
 *
 * Returns nothing; mutates `staticRemoved` and `rewrites` in place.
 */
function replaceConflictingInSameFileBindings(
  ast: t.File,
  expr: t.Expression,
  newClasses: string,
  changedStyleKeys: string[],
  state: string | undefined,
  liveConflict: Set<string>,
  staticRemoved: Set<string>,
  rewrites: BindingLiteralRewrite[],
): void {
  // Residual-driven: only same-file consts that contribute a LIVE-applied conflict class are touched.
  if (liveConflict.size === 0) return;

  const names = collectIdentifierNames(expr);
  for (const name of names) {
    const init = resolveSameFileLiteralBinding(ast, name);
    if (!init) continue;

    // The const must actually carry one of the live-applied conflict classes, else it is not the
    // residual's source — skip it (don't rewrite a const the DOM isn't currently showing).
    if (!initCarriesLiveConflict(init, liveConflict)) continue;

    // Capture the init's ORIGINAL source range before mutation — recast keeps `.start/.end` on
    // original nodes; the executor splices this disjoint range with the re-printed node.
    const start = init.start;
    const end = init.end;

    const removedHere = new Set<string>();
    const result = replaceConflictingInStaticLiterals(init, newClasses, changedStyleKeys, state, removedHere);
    if (removedHere.size === 0 || !result.handledConflict) continue; // nothing to rewrite here

    for (const cls of removedHere) staticRemoved.add(cls);

    // Record the rewritten init node for the executor to splice. For a plain `const X = '...'` the init
    // IS the StringLiteral; for a concat/ternary init the whole init node is re-printed. Either way it
    // keeps its original `[start, end)` range, so every untouched byte around it is preserved.
    if (typeof start === 'number' && typeof end === 'number') {
      rewrites.push({ node: init, start, end });
    }
  }
}

/** Find an existing local binding name for `tailwind-merge`'s twMerge (direct or aliased import). */
function findExistingTwMergeBinding(ast: t.File): string | null {
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node) || node.source.value !== 'tailwind-merge') continue;
    // Skip `import type { twMerge } from 'tailwind-merge'` — type-only imports are erased at
    // runtime; using the local name as a callable would break the component.
    if (node.importKind === 'type') continue;
    for (const spec of node.specifiers) {
      if (
        t.isImportSpecifier(spec) &&
        spec.importKind !== 'type' && // skip `import { type twMerge }` form
        t.isIdentifier(spec.imported) &&
        spec.imported.name === 'twMerge'
      ) {
        return spec.local.name;
      }
    }
  }
  return null;
}

/**
 * Collect every top-level binding name the program declares. Uses `t.getBindingIdentifiers` per
 * statement so destructured/nested/default patterns (`const { twMerge } = helpers`, `const [twMerge] =
 * …`) are all counted — a hand-rolled enumerator misses these and risks a duplicate-binding inject.
 */
function collectTopLevelBindings(ast: t.File): Set<string> {
  const names = new Set<string>();
  for (const node of ast.program.body) {
    for (const name of Object.keys(t.getBindingIdentifiers(node))) names.add(name);
  }
  return names;
}

/**
 * Resolve a callable twMerge identifier for the file. Reuses an existing `tailwind-merge` import when
 * present (always safe). Injects an import only when the project is known to resolve the dependency
 * (`canInjectTwMerge`) — otherwise returns null so the caller falls back to a safe concat-append
 * rather than writing an import that would break the user's build.
 *
 * Collision-safe: if the local name `twMerge` is already bound to something else (a different import,
 * a `const twMerge = ...`), inject under a non-colliding alias (`twMerge`, `twMerge2`, …) so we never
 * create a duplicate top-level binding that breaks parsing.
 */
function resolveTwMergeBinding(
  ast: t.File,
  canInjectTwMerge: boolean,
): { id: t.Identifier; injectedImport: boolean } | null {
  const existing = findExistingTwMergeBinding(ast);
  if (existing) return { id: t.identifier(existing), injectedImport: false };
  if (!canInjectTwMerge) return null;

  const taken = collectTopLevelBindings(ast);
  let localName = 'twMerge';
  for (let i = 2; taken.has(localName); i++) localName = `twMerge${i}`;

  const importDecl = t.importDeclaration(
    [t.importSpecifier(t.identifier(localName), t.identifier('twMerge'))],
    t.stringLiteral('tailwind-merge'),
  );
  // Insert after the last existing import so the file's import block stays grouped.
  let lastImportIndex = -1;
  for (let i = 0; i < ast.program.body.length; i++) {
    if (t.isImportDeclaration(ast.program.body[i])) lastImportIndex = i;
  }
  ast.program.body.splice(lastImportIndex + 1, 0, importDecl);
  return { id: t.identifier(localName), injectedImport: true };
}

/**
 * Escalate the residual to a twMerge override so the inspector's class wins IN PLACE at the selected
 * element (HYP-544 / Option A). Mutates `element`'s className in place. Returns true when an override
 * was applied; false when the shape isn't handled OR injecting an import would break the user's build,
 * in which case the caller falls back to the safe concat-append.
 *
 * - tailwind-merge-backed merge call (cn/cva/twMerge): append the new class as the LAST argument —
 *   it already wins per Tailwind group, no outer wrap, no import. Always safe.
 * - plain-concat merge call (clsx/classnames) / raw expr / identifier / `+` concat: wrap in
 *   `twMerge(<expr>, '<newClass>')` so the new class wins last. Reuses an existing import; injects one
 *   only when the project resolves `tailwind-merge` (`canInjectTwMerge`) — otherwise returns false so
 *   the caller appends instead of writing an unresolvable import (which would break the build).
 *
 * The opaque source (prop/parent) is never edited — only the edited element's expression is rewritten.
 */
interface TwMergeOverrideResult {
  /** True when an override was applied (false → caller falls back to concat-append). */
  applied: boolean;
  /** True when a NEW `import { twMerge } from 'tailwind-merge'` was inserted into program.body. */
  injectedImport: boolean;
}

function applyTwMergeOverride(
  ast: t.File,
  element: t.JSXElement,
  expr: t.Expression,
  newClasses: string,
  canInjectTwMerge: boolean,
): TwMergeOverrideResult {
  if (t.isCallExpression(expr)) {
    const calleeName = getCalleeName(expr.callee);
    if (calleeName && TW_BACKED_MERGE_CALLEES.has(calleeName)) {
      // tw-backed merge call resolves last-wins — append the new class, no import needed.
      expr.arguments.push(t.stringLiteral(newClasses));
      setAttribute(element, 'className', t.jsxExpressionContainer(expr));
      return { applied: true, injectedImport: false };
    }
    if (calleeName && PLAIN_CONCAT_MERGE_CALLEES.has(calleeName)) {
      const twMerge = resolveTwMergeBinding(ast, canInjectTwMerge);
      if (!twMerge) return { applied: false, injectedImport: false }; // not resolvable — caller appends
      const wrapped = t.callExpression(twMerge.id, [expr, t.stringLiteral(newClasses)]);
      setAttribute(element, 'className', t.jsxExpressionContainer(wrapped));
      return { applied: true, injectedImport: twMerge.injectedImport };
    }
  }

  // Raw identifier / member / binary-concat / parenthesized: wrap the whole expression in twMerge so
  // the new class is the last same-group token and wins regardless of the opaque source's order.
  const twMerge = resolveTwMergeBinding(ast, canInjectTwMerge);
  if (!twMerge) return { applied: false, injectedImport: false }; // not resolvable — caller appends
  const wrapped = t.callExpression(twMerge.id, [expr, t.stringLiteral(newClasses)]);
  setAttribute(element, 'className', t.jsxExpressionContainer(wrapped));
  return { applied: true, injectedImport: twMerge.injectedImport };
}

/**
 * Wrap expression in concatenation
 * className={expr} -> className={(expr) + ' bg-red-500'}
 *
 * First attempts to replace the conflicting class within the expression's static string literals
 * (so old + new color classes don't both survive). Only when no static literal held a conflicting
 * class does it fall back to appending via concatenation.
 *
 * HYP-544: when a same-group color reaches the element from an OPAQUE source (visible in the live
 * `domClasses` but not in any static literal we can rewrite), a plain concat-append does not win
 * (clsx/raw concat keep both classes; Tailwind resolves by generated-CSS order, not attribute order).
 * In that case escalate to a twMerge override so the inspector's class wins in place.
 */
function wrapInConcatenation(
  element: t.JSXElement,
  newClasses: string,
  changedStyleKeys: string[],
  state?: string,
  ast?: t.File,
  domClasses?: string,
  canInjectTwMerge = false,
  // HYP-544 Phase 1: each same-file const literal that binding resolution rewrote in place is recorded
  // here so the executor can splice its disjoint source range. Undefined when the caller has no splice
  // pipeline (the whole-file recast path still picks up the mutated nodes).
  bindingRewrites?: BindingLiteralRewrite[],
  // HYP-544 Phase 1: out-channel for the "force whole-file recast" hint (mixed const + import-injecting
  // twMerge override). Undefined when the caller doesn't splice.
  writeHints?: MutatorWriteHints,
): void {
  const attr = getAttribute(element, 'className');
  if (!attr) return;

  let expr: t.Expression;

  if (t.isStringLiteral(attr)) {
    // className="base" -> className={"base" + " bg-red-500"}
    expr = attr;
  } else if (t.isJSXExpressionContainer(attr)) {
    if (t.isJSXEmptyExpression(attr.expression)) return;
    expr = attr.expression as t.Expression;
  } else {
    return;
  }

  // Strip the conflicting same-property class from the static literals first (so old + new color
  // classes never both survive within the expression). Record exactly which classes we stripped so we
  // can tell a static conflict apart from one contributed by an opaque source.
  const staticRemoved = new Set<string>();
  const { guaranteedNewClass } = replaceConflictingInStaticLiterals(
    expr,
    newClasses,
    changedStyleKeys,
    state,
    staticRemoved,
  );
  if (guaranteedNewClass) {
    // The new class is now unconditionally present on every runtime branch — no append needed.
    return;
  }

  // The same-group classes the LIVE DOM applies for the changed property. Both Phase 1 binding
  // resolution and the twMerge escalation key off this set.
  const liveConflict = new Set(liveDomConflictClasses(domClasses, changedStyleKeys, state));

  // HYP-544 Phase 1: before any twMerge escalation, try to account for the OPAQUE residual — the live
  // conflict classes NOT already handled by an inline static literal — by resolving contributing
  // identifiers to a SAME-FILE const literal and find-replacing the conflict AT THE DEFINITION
  // (deterministic, AI-free). Passing `liveConflict − staticRemoved` keeps it residual-driven: a class
  // an inline literal already carried must not trigger an unrelated const rewrite. Each const so
  // rewritten adds its removed classes to `staticRemoved`, so a residual fully explained by const
  // literals never escalates to twMerge.
  let didBindingRewrite = false;
  if (ast && newClasses) {
    const opaqueResidual = new Set([...liveConflict].filter((cls) => !staticRemoved.has(cls)));
    const localRewrites: BindingLiteralRewrite[] = [];
    replaceConflictingInSameFileBindings(
      ast,
      expr,
      newClasses,
      changedStyleKeys,
      state,
      opaqueResidual,
      staticRemoved,
      localRewrites,
    );
    didBindingRewrite = localRewrites.length > 0;
    if (bindingRewrites) for (const r of localRewrites) bindingRewrites.push(r);
  }

  // Escalate to a twMerge override ONLY for a same-group conflict that comes from an OPAQUE source:
  // a class the LIVE DOM shows but neither the static rewrite NOR binding resolution accounted for (set
  // difference). This handles the mixed case `clsx('text-red-500', titleClassName)` where the static
  // `text-red-500` is rewritten but `titleClassName` (an import / prop / param) still contributes
  // `text-green-500` — the concat-append would lose to it. A same-file const conflict is now in
  // `staticRemoved`, so it does NOT escalate; a purely-static conflict needs no override either.
  if (ast && newClasses) {
    const opaqueConflict = [...liveConflict].some((cls) => !staticRemoved.has(cls));
    if (opaqueConflict) {
      const override = applyTwMergeOverride(ast, element, expr, newClasses, canInjectTwMerge);
      if (override.applied) {
        // A twMerge override that INJECTED a new top-level `import { twMerge }` is an inserted node with
        // NO source range — a span-splice write (className span ± const literal spans) cannot represent
        // it and would emit `twMerge(...)` WITHOUT the import, breaking the build. Force a whole-file
        // recast in that case (recast still preserves every untouched original node's bytes; only the
        // import + className reprint). The tw-backed append (cn/cva) and reuse-existing-import cases
        // inject nothing, so they stay on the byte-preserving span-splice path. Span-splice is valid
        // ONLY when the mutation is confined to the className node; an injected import is not confined.
        if (override.injectedImport && writeHints) writeHints.forceFullReprint = true;
        return;
      }

      // HYP-544 Phase 2 (§7): the override could NOT be applied — `resolveTwMergeBinding` returned null
      // because the project has no existing `tailwind-merge` import AND `canInjectTwMerge` is false. A
      // concat-append does NOT win an opaque same-group conflict (Tailwind resolves by generated-CSS
      // order, not attribute order), so the inspector's edit would silently not apply. Signal the
      // executor to apply the universal §7 inline-style floor instead, and leave the className UNTOUCHED
      // (do not fall through to the append below). The executor owns the inline write — it alone has the
      // raw requested color value. If the caller passes no `writeHints` sink (no inline-floor pipeline),
      // fall through to the legacy concat-append so behavior degrades safely.
      //
      // BASE STATE ONLY (codex P2): an inline `style` is unconditional — it cannot express a state
      // variant (`hover:`, `focus:`, …). Flooring a `hover:bg-*` edit to a plain `backgroundColor` would
      // make it always-active AND clobber the hover utility. For a non-base state we therefore do NOT
      // floor; fall through to the legacy concat-append (which at least preserves the state-prefixed
      // class). `state` is undefined for base writes (`tailwindStatePrefix` returns undefined for 'base').
      if (writeHints && !state) {
        writeHints.needsInlineFloor = true;
        return;
      }
    }

    // HYP-544 Phase 1: a same-file const literal was find-replaced AND no opaque residual remains — the
    // inspector's intent now applies at the const definition. Returning here avoids the concat-append
    // below, which would otherwise double the new class onto the expression on top of the clean const
    // rewrite. Scoped to `didBindingRewrite` so #381's existing append-path for the no-rewrite case is
    // unchanged.
    if (didBindingRewrite && !opaqueConflict) return;
  }

  // No live conflict known (or shape unhandled): append it so the inspector's intent always applies.
  // Conflicts already stripped above won't duplicate the OLD class; at worst the new class appears
  // twice (harmless — same class).
  const newExpr = t.binaryExpression('+', t.parenthesizedExpression(expr), t.stringLiteral(` ${newClasses}`));

  setAttribute(element, 'className', t.jsxExpressionContainer(newExpr));
}

/**
 * Modify static className (fallback to existing logic)
 */
function modifyStaticClassName(element: t.JSXElement, newClasses: string, changedStyleKeys: string[]): void {
  const attr = getAttribute(element, 'className');
  if (!attr || !t.isStringLiteral(attr)) return;

  const existingClassName = attr.value;
  const prefixes = getConflictingPrefixes(changedStyleKeys);

  // Remove conflicting classes
  const preservedClasses = removeConflictingClassesFromString(existingClassName, prefixes);

  // Combine preserved + new classes
  const finalClassName = [preservedClasses, newClasses].filter(Boolean).join(' ').trim();

  setAttribute(element, 'className', t.stringLiteral(finalClassName));
}

/**
 * Main function to modify dynamic className
 */
export function modifyDynamicClassName(
  ast: t.File,
  sourceCode: string,
  element: t.JSXElement,
  locations: ClassNameLocation[],
  newClasses: string,
  changedStyleKeys: string[],
  fallback: 'append' | 'wrap',
  state?: string,
  // HYP-544: live applied className from the DOM. Authoritative source of "what color is applied
  // now"; lets the residual escalate to a twMerge override only when a real same-group conflict
  // reaches the element from an opaque source.
  domClasses?: string,
  // HYP-544: whether the EDITED project resolves `tailwind-merge`. Gates injecting a new import — when
  // false the residual falls back to a safe concat-append instead of writing an unresolvable import.
  canInjectTwMerge = false,
  // HYP-544 Phase 1: sink for same-file const literals rewritten by binding resolution. The executor
  // splices each one's disjoint source range (the className-value splice never touches the const).
  bindingRewrites?: BindingLiteralRewrite[],
  // HYP-544 Phase 1: out-channel for write hints (e.g. "force whole-file recast" for a mixed const +
  // import-injecting twMerge override the splice path can't represent).
  writeHints?: MutatorWriteHints,
): void {
  const type = detectClassNameType(element);

  if (type === 'string') {
    // Use existing static logic
    modifyStaticClassName(element, newClasses, changedStyleKeys);
    return;
  }

  // If AI found locations, try to modify by locations
  if (locations.length > 0) {
    const successCount = modifyByLocations(ast, sourceCode, locations, newClasses, changedStyleKeys);
    if (successCount > 0) {
      // Success! Return early, don't use fallback
      return;
    }
    // modifyByLocations failed to find any string literals - fall through to fallback
    console.log('[DynamicClassName] modifyByLocations found 0 strings, using fallback');
  }

  // Fallback strategies (when AI didn't find locations or modifyByLocations failed)
  if (type === 'template') {
    if (fallback === 'append') {
      appendToLastString(element, newClasses, changedStyleKeys);
    } else {
      wrapInConcatenation(
        element,
        newClasses,
        changedStyleKeys,
        state,
        ast,
        domClasses,
        canInjectTwMerge,
        bindingRewrites,
        writeHints,
      );
    }
  } else {
    // For call expressions and other expressions, try in-place conflict replacement,
    // falling back to concatenation only when no static literal held the conflicting class.
    wrapInConcatenation(
      element,
      newClasses,
      changedStyleKeys,
      state,
      ast,
      domClasses,
      canInjectTwMerge,
      bindingRewrites,
      writeHints,
    );
  }
}
