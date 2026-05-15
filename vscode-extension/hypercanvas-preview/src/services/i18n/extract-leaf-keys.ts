/**
 * @file Shared utility: extract all leaf translation keys from a nested JSON object.
 *
 * Accessed via: ReactI18nextAdapter, CustomJsonAdapter, TsMergedAdapter
 * Assumptions: input is a parsed JSON locale object; non-string leaves (numbers, booleans, arrays) are skipped
 */

/** Recursively extract all leaf keys from a JSON object, producing dot-path strings. */
export function extractLeafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      keys.push(path);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...extractLeafKeys(v, path));
    }
  }
  return keys;
}
