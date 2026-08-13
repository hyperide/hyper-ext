/**
 * Recursively drop function values from a generated sample-prop tree so the result
 * is structured-clone safe for `webview.postMessage`. Functions can appear at any
 * depth (generateSamplePropValues recurses into objectFields), and structured clone
 * throws on the whole payload if any survive. Object keys whose value is a function
 * are omitted entirely; arrays drop function items. Non-plain objects (Date, etc.)
 * are passed through — structured clone handles them. Feature #210.
 */
export function stripFunctions(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    return value.map(stripFunctions).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = stripFunctions(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}
