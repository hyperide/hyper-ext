/**
 * AST utilities for modifying dynamic className expressions
 * Handles template literals, cn() calls, and concatenation
 */

import _generate from '@babel/generator';
import * as t from '@babel/types';
import { getConflictingPrefixes } from '../tailwind/generator.js';
import type { ClassNameLocation } from '../types.js';
import { getAttribute, setAttribute } from './mutator.js';

const generate = _generate.default || _generate;

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
export function modifyStringLiteralInPlace(
  stringLiteral: t.StringLiteral,
  newClasses: Record<string, string>,
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
  const newClassString = Object.values(newClasses).join(' ');
  const newValue = [preserved, newClassString].filter(Boolean).join(' ').trim();

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
      `[DynamicClassName] Extracted ${extractedStrings.length} strings:`,
      extractedStrings.map((s) => `${s.slice(0, 30)}...`),
    ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

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
export function modifyByLocations(
  ast: t.File,
  sourceCode: string,
  locations: ClassNameLocation[],
  newClasses: Record<string, string>,
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
export function appendToLastString(
  element: t.JSXElement,
  newClasses: Record<string, string>,
  changedStyleKeys: string[],
): void {
  const attr = getAttribute(element, 'className');
  if (!attr || !t.isJSXExpressionContainer(attr)) return;

  const expr = attr.expression;
  if (!t.isTemplateLiteral(expr)) return;

  const classString = Object.values(newClasses).join(' ');
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
  const newValue = existingInLast ? `${existingInLast} ${classString}` : classString;

  lastQuasi.value.raw = ` ${newValue}`;
  lastQuasi.value.cooked = ` ${newValue}`;
}

/**
 * Wrap expression in concatenation
 * className={expr} -> className={(expr) + ' bg-red-500'}
 */
export function wrapInConcatenation(element: t.JSXElement, newClasses: Record<string, string>): void {
  const attr = getAttribute(element, 'className');
  if (!attr) return;

  const classString = Object.values(newClasses).join(' ');

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

  // Wrap expression in parentheses and add concatenation
  const newExpr = t.binaryExpression('+', t.parenthesizedExpression(expr), t.stringLiteral(` ${classString}`));

  setAttribute(element, 'className', t.jsxExpressionContainer(newExpr));
}

/**
 * Modify static className (fallback to existing logic)
 */
export function modifyStaticClassName(
  element: t.JSXElement,
  newClasses: Record<string, string>,
  changedStyleKeys: string[],
): void {
  const attr = getAttribute(element, 'className');
  if (!attr || !t.isStringLiteral(attr)) return;

  const existingClassName = attr.value;
  const prefixes = getConflictingPrefixes(changedStyleKeys);

  // Remove conflicting classes
  const preservedClasses = removeConflictingClassesFromString(existingClassName, prefixes);

  // Generate new classes
  const newClassString = Object.values(newClasses).join(' ');

  // Combine preserved + new classes
  const finalClassName = [preservedClasses, newClassString].filter(Boolean).join(' ').trim();

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
  newClasses: Record<string, string>,
  changedStyleKeys: string[],
  fallback: 'append' | 'wrap',
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
      wrapInConcatenation(element, newClasses);
    }
  } else {
    // For call expressions and other expressions, always wrap
    wrapInConcatenation(element, newClasses);
  }
}

/**
 * Get className as code string (for debugging)
 */
export function getClassNameCode(element: t.JSXElement): string {
  const attr = getAttribute(element, 'className');
  if (!attr) return '';

  if (t.isStringLiteral(attr)) {
    return `"${attr.value}"`;
  }

  if (t.isJSXExpressionContainer(attr)) {
    const expr = attr.expression;
    if (t.isJSXEmptyExpression(expr)) return '';
    return `{${generate(expr).code}}`;
  }

  return '';
}
