type Inspection = { read: () => unknown; subscribe: (notify: () => void) => () => void };
const known = new WeakMap<object, Inspection>();
/** Registered at API creation: inspecting user data never invokes arbitrary methods. */
export function registerInspection<T extends object>(value: T, inspection: Inspection): T {
  known.set(value, inspection);
  return value;
}
export function inspectionOf(value: unknown): Inspection | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? known.get(value) : undefined;
}
const SCOPE_KEY_LIMIT = 100;
const OBJECT_KEY_LIMIT = 200;
const ARRAY_INDEX_LIMIT = 100;
/** Marker keys start with an ellipsis, so they never match a data path (inspectPath only
 *  accepts word characters, `$`, `.`, `-` and `[n]`); they can never be mistaken for data. */
const OMITTED_MARK = '… inspection limit';
/** Exact marker key per snapshot container that actually truncated. A user key that merely
 *  looks like the notice is never consulted: only containers registered here report omission. */
const truncationMarks = new WeakMap<object, string>();
function markerKey(container: object, base: string, taken: readonly string[] = []): string {
  let key = base;
  while (Object.prototype.hasOwnProperty.call(container, key) || taken.includes(key)) key += ' …';
  return key;
}
function isArrayIndex(key: string): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return index < 4294967295;
}
/** The truncation notice stored on a snapshot container, if it dropped fields. */
function omissionNotice(container: object): string | undefined {
  const key = truncationMarks.get(container);
  if (!key) return undefined;
  const value = Object.getOwnPropertyDescriptor(container, key)?.value;
  return typeof value === 'string' ? value : 'Some fields were omitted — inspection limit.';
}
export function scopeValues(scope: Record<string, unknown>): Record<string, unknown> {
  let budget = 1000;
  const seen = new WeakSet<object>();
  const visitArray = (value: unknown[], depth: number): unknown => {
    // Reflection invokes Proxy traps (ownKeys, getOwnPropertyDescriptor, get):
    // a throwing trap degrades to unavailable instead of breaking the snapshot.
    let descriptors: Record<string, PropertyDescriptor>;
    let length: number;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
      length = value.length;
    } catch {
      return '[unavailable]';
    }
    const indices = Object.keys(descriptors).filter((key) => descriptors[key].enumerable && isArrayIndex(key));
    const extras = Object.keys(descriptors).filter(
      (key) => descriptors[key].enumerable && !isArrayIndex(key) && key !== 'length',
    );
    const kept = indices
      .map(Number)
      .filter((index) => index < ARRAY_INDEX_LIMIT)
      .sort((a, b) => a - b);
    const keptExtras = extras.slice(0, Math.max(0, OBJECT_KEY_LIMIT - kept.length));
    const lengthCapped = length > ARRAY_INDEX_LIMIT;
    const omitted = indices.length - kept.length + (extras.length - keptExtras.length);
    if (!lengthCapped && omitted === 0) {
      // A small array is preserved exactly: real indices, real length, real paths.
      // Holes stay holes: only the length is restored, nothing is materialized.
      const result: unknown[] = [];
      for (const index of kept) {
        const descriptor = descriptors[String(index)];
        Object.defineProperty(result, String(index), {
          value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor — not evaluated]',
          enumerable: true,
          configurable: true,
        });
      }
      for (const key of keptExtras) {
        const descriptor = descriptors[key];
        Object.defineProperty(result, key, {
          value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor — not evaluated]',
          enumerable: true,
          configurable: true,
        });
      }
      result.length = length;
      return result;
    }
    // A JSON array serializes every hole up to its length, so a huge or sparse array
    // cannot stay an array: materializing it would explode the snapshot. It becomes a
    // bounded object with the kept prefix at its real indices, the real length, and an
    // explicit notice — never silent holes, never a fabricated element at a data index.
    const result: Record<string, unknown> = Object.create(null);
    for (const index of kept) {
      const descriptor = descriptors[String(index)];
      Object.defineProperty(result, String(index), {
        value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor — not evaluated]',
        enumerable: true,
        configurable: true,
      });
    }
    for (const key of keptExtras) {
      const descriptor = descriptors[key];
      Object.defineProperty(result, key, {
        value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor — not evaluated]',
        enumerable: true,
        configurable: true,
      });
    }
    Object.defineProperty(result, 'length', { value: length, enumerable: true, configurable: true });
    const mark = markerKey(result, OMITTED_MARK, indices.concat(extras));
    Object.defineProperty(result, mark, {
      value: lengthCapped
        ? `array length ${length} exceeds the inspection limit; showing ${kept.length} of ${indices.length} present items — inspection limit`
        : `${omitted} more items omitted — inspection limit`,
      enumerable: true,
      configurable: true,
    });
    truncationMarks.set(result, mark);
    return result;
  };
  const visit = (value: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 8) return '[inspection limit]';
    const inspection = inspectionOf(value);
    if (inspection) {
      try {
        return visit(inspection.read(), depth + 1);
      } catch {
        return '[unavailable]';
      }
    }
    if (typeof value === 'function') return '[function — not evaluated]';
    if (typeof value === 'bigint') return `${value}n`;
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[shared or circular reference]';
    seen.add(value);
    if (Array.isArray(value)) return visitArray(value, depth);
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return '[unavailable]';
    }
    const names = Object.keys(descriptors).filter((key) => descriptors[key].enumerable);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of names.slice(0, OBJECT_KEY_LIMIT)) {
      const descriptor = descriptors[key];
      Object.defineProperty(result, key, {
        value: 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[accessor — not evaluated]',
        enumerable: true,
        configurable: true,
      });
    }
    if (names.length > OBJECT_KEY_LIMIT) {
      const mark = markerKey(result, OMITTED_MARK, names);
      Object.defineProperty(result, mark, {
        value: `${names.length - OBJECT_KEY_LIMIT} more fields omitted — inspection limit`,
        enumerable: true,
        configurable: true,
      });
      truncationMarks.set(result, mark);
    }
    return result;
  };
  const result: Record<string, unknown> = Object.create(null);
  const scopeNames = Object.keys(Object.getOwnPropertyDescriptors(scope)).filter((key) => !key.startsWith('__'));
  for (const key of scopeNames.slice(0, SCOPE_KEY_LIMIT)) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, key);
    if (descriptor) result[key] = 'value' in descriptor ? visit(descriptor.value, 0) : '[accessor — not evaluated]';
  }
  if (scopeNames.length > SCOPE_KEY_LIMIT) {
    const mark = markerKey(result, OMITTED_MARK, scopeNames);
    Object.defineProperty(result, mark, {
      value: `${scopeNames.length - SCOPE_KEY_LIMIT} more scope fields omitted — inspection limit`,
      enumerable: true,
      configurable: true,
    });
    truncationMarks.set(result, mark);
  }
  return result;
}
/** Data-path lookup only: not eval, not a getter/function invocation. */
export function inspectPath(data: unknown, path: string): { found: boolean; value?: unknown; error?: string } {
  if (!path.trim()) return { found: true, value: data };
  if (!/^[\w$]+(?:\.[\w$-]+|\[\d+\])*$/.test(path))
    return { found: false, error: 'Use a data path such as store.tasks.a.done, without () or code.' };
  let value = data;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      return { found: false, error: 'Only own data properties can be inspected.' };
    if (value === null || typeof value !== 'object') return { found: false };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      // A dropped field must not look absent: containers that truncated their keys
      // carry an explicit notice, and a miss inside one reports it.
      const notice = omissionNotice(value);
      return notice ? { found: false, error: notice } : { found: false };
    }
    value = descriptor.value;
  }
  return { found: true, value };
}

/** Compare already-snapshotted data; never read properties from a live user object. */
export function changedValuePaths(before: unknown, after: unknown, path = '', limit = 30): string[] {
  if (Object.is(before, after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object')
    return [path || '(root)'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length)
    changes.push(path ? `${path}.length` : 'length');
  for (const key of keys) {
    if (changes.length >= limit) break;
    const a = Object.getOwnPropertyDescriptor(before, key),
      b = Object.getOwnPropertyDescriptor(after, key);
    const nested = path ? `${path}.${key}` : key;
    if (!a || !b) changes.push(nested);
    else if ('value' in a && 'value' in b)
      changes.push(...changedValuePaths(a.value, b.value, nested, limit - changes.length));
  }
  return changes;
}
