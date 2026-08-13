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
function replaceConflictingInStaticLiterals(
  expr: t.Expression,
  newClasses: string,
  changedStyleKeys: string[],
  state?: string,
): InPlaceReplaceResult {
  const visit = (node: t.Expression): InPlaceReplaceResult => {
    if (t.isStringLiteral(node)) {
      const { preserved, removed } = removeConflictingClasses(node.value, changedStyleKeys, state);
      if (removed.length === 0) {
        return { handledConflict: false, guaranteedNewClass: false };
      }
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
          } else if (t.isConditionalExpression(arg) || t.isCallExpression(arg)) {
            const result = visit(arg);
            handledConflict = handledConflict || result.handledConflict;
            anyArgGuarantees = anyArgGuarantees || result.guaranteedNewClass;
            // A ternary/nested call only fully guarantees the new class when every path carries it.
            // If it didn't, it may emit a later same-group class we couldn't account for.
            if (!result.guaranteedNewClass) {
              hasUnanalyzableArg = true;
            }
          } else {
            // Spread, object, identifier, member, logical (`cond && "..."`), etc. — opaque.
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
 * Wrap expression in concatenation
 * className={expr} -> className={(expr) + ' bg-red-500'}
 *
 * First attempts to replace the conflicting class within the expression's static string literals
 * (so old + new color classes don't both survive). Only when no static literal held a conflicting
 * class does it fall back to appending via concatenation.
 */
function wrapInConcatenation(
  element: t.JSXElement,
  newClasses: string,
  changedStyleKeys: string[],
  state?: string,
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
  // classes never both survive within the expression).
  const { guaranteedNewClass } = replaceConflictingInStaticLiterals(expr, newClasses, changedStyleKeys, state);
  if (guaranteedNewClass) {
    // The new class is now unconditionally present on every runtime branch — no append needed.
    return;
  }

  // The new class is NOT guaranteed on every code path (no static literal held the conflict, or it
  // lived only in some branches / a dynamic sub-expression). Append it so the inspector's intent
  // always applies. Conflicts already stripped above won't duplicate the OLD class; at worst the new
  // class appears twice (harmless — same class).
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
      wrapInConcatenation(element, newClasses, changedStyleKeys, state);
    }
  } else {
    // For call expressions and other expressions, try in-place conflict replacement,
    // falling back to concatenation only when no static literal held the conflicting class.
    wrapInConcatenation(element, newClasses, changedStyleKeys, state);
  }
}
