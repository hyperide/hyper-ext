/**
 * @file Extract prop names from common React error messages and decide when to
 *   auto-create an empty sample.
 *
 * Accessed via: ComponentErrorOverlay — used to pre-populate the PropsForm with
 *   prop names extracted from a runtime render error (e.g. "Cannot read likes of
 *   undefined" -> offers to fill in a `likes` prop). The extension's auto-sample
 *   path uses `shouldAutoCreateEmptySampleFromError` to skip the overlay entirely
 *   when the component truly has no props (HYP-649 recovery pipeline).
 */

import { isProviderContextError } from './classify-render-error';
import type { SimplePropInfo } from './PropsForm';

/**
 * Extract prop names from common React error messages.
 * - "Cannot read properties of undefined (reading 'likes')" -> ['likes']
 * - "Cannot read properties of null (reading 'name')" -> ['name']
 * - "tweet is not defined" -> ['tweet']
 * - "props.title is not a function" -> ['title']
 * - Multiple "reading 'x'" in one message -> all extracted, deduplicated
 */
export function extractPropsFromError(errorMsg: string): string[] {
  // "Cannot read properties of undefined/null (reading 'propName')"
  const readingMatches = [...errorMsg.matchAll(/reading '(\w+)'/g)];
  if (readingMatches.length > 0) {
    return [...new Set(readingMatches.map((m) => m[1]))];
  }

  // "someVar is not defined" / "someVar is undefined"
  const undefinedMatch = errorMsg.match(/(\w+) is (?:not defined|undefined)/);
  if (undefinedMatch) return [undefinedMatch[1]];

  // "props.X is not a function" / "Cannot read X of undefined"
  const propsDotMatch = errorMsg.match(/props\.(\w+)/);
  if (propsDotMatch) return [propsDotMatch[1]];

  return [];
}

/**
 * Decide whether the overlay should skip the PropsForm dialog and silently
 * create an empty sample. True only when:
 *   - The component's real propsSchema is loaded AND empty (not undefined — that
 *     means still loading).
 *   - The error message does not mention any specific prop names.
 *   - The error is NOT a provider-context error (HYP-876): a missing
 *     `<XProvider>` cannot be fixed by a sample, so writing one only pollutes
 *     the user's source file and re-fires the same crash.
 */
export function shouldAutoCreateEmptySampleFromError(
  propsSchema: SimplePropInfo[] | null | undefined,
  error: string,
): boolean {
  if (!Array.isArray(propsSchema) || propsSchema.length !== 0) return false;
  if (isProviderContextError(error)) return false;
  return extractPropsFromError(error).length === 0;
}
