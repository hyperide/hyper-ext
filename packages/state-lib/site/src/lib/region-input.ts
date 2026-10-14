/** Prototype declaration helpers; metadata is removed before creating state.
 * Region names provide defaults, never implicit I/O or access control. */
export type RegionName = 'domain' | 'view' | 'session' | 'draft';
const marker = Symbol('state.region');
export type Regional<T> = { readonly [marker]: RegionName; readonly value: T };
export type RegionData<T> =
  T extends Regional<infer V>
    ? RegionData<V>
    : T extends Date
      ? T
      : T extends readonly unknown[]
        ? { [K in keyof T]: RegionData<T[K]> }
        : T extends object
          ? { [K in keyof T]: RegionData<T[K]> }
          : T;
const mark =
  (name: RegionName) =>
  <T>(value: T): Regional<T> => ({ [marker]: name, value });
export const region = { domain: mark('domain'), view: mark('view'), session: mark('session'), draft: mark('draft') };
export function normalizeRegions<T>(input: T): { data: RegionData<T>; regions: Record<string, RegionName> } {
  const regions: Record<string, RegionName> = {};
  const visiting = new WeakSet<object>();
  const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
  const visit = (value: unknown, path: string): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (marker in value) {
      const annotated = value as Regional<unknown>;
      regions[path] = annotated[marker];
      return visit(annotated.value, path);
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
    if (visiting.has(value)) throw new TypeError('Region declarations require an acyclic initial tree');
    visiting.add(value);
    const out: object = Array.isArray(value) ? [] : {};
    for (const [key, child] of Object.entries(value)) {
      Object.defineProperty(out, key, {
        value: visit(child, `${path}/${escape(key)}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    visiting.delete(value);
    return out;
  };
  return { data: visit(input, '') as RegionData<T>, regions };
}
