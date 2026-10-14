/** Experimental lazy sequence algebra. Pure synchronous callbacks only; not yet an incremental DB. */
const size = (n) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Nonnegative integer required');
  return n;
};
export const field = (row, key) => key.split('.').reduce((v, k) => v?.[k], row);
export const compare = (a, b) =>
  a === b || (a == null && b == null) ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : 1;
function numbers(values) {
  const a = Array.from(values);
  if (a.some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw new TypeError('Finite numbers required');
  return a;
}
export function quantile(values, p) {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('p must be in [0,1]');
  const a = numbers(values).sort((a, b) => a - b);
  if (!a.length) return null;
  const i = (a.length - 1) * p,
    k = Math.floor(i);
  return a[k] + (a[Math.min(k + 1, a.length - 1)] - a[k]) * (i - k);
}
export function variance(values, { sample = false } = {}) {
  const a = numbers(values);
  if (a.length < 1 + Number(sample)) return null;
  let mean = 0,
    m2 = 0,
    n = 0;
  for (const x of a) {
    n++;
    const d = x - mean;
    mean += d / n;
    m2 += d * (x - mean);
  }
  return m2 / (n - Number(sample));
}
export function histogram(values, boundaries) {
  const edges = numbers(boundaries);
  if (edges.some((x, i) => i && x <= edges[i - 1])) throw new Error('Strictly increasing boundaries');
  const counts = Array.from({ length: edges.length + 1 }, () => 0);
  for (const x of numbers(values)) {
    let lo = 0,
      hi = edges.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (x < edges[m]) hi = m;
      else lo = m + 1;
    }
    counts[lo]++;
  }
  return counts;
}
export function pivot(rows, rowKey, columnKey, value, combine = (a, b) => a + b, initial = 0) {
  const result = new Map();
  for (const row of rows) {
    const rk = rowKey(row),
      ck = columnKey(row);
    if (!result.has(rk)) result.set(rk, new Map());
    const columns = result.get(rk);
    columns.set(ck, combine(columns.has(ck) ? columns.get(ck) : initial, value(row)));
  }
  return [...result].map(([key, columns]) => ({ key, columns: [...columns] }));
}
export function zip(a, b) {
  const left = [...a],
    right = [...b];
  return left.slice(0, Math.min(left.length, right.length)).map((x, i) => [x, right[i]]);
}
export const pick = (row, keys) =>
  Object.fromEntries(keys.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]));
export const omit = (row, keys) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
export function q(iterable) {
  return new Query(() => iterable[Symbol.iterator]());
}
export class Query {
  constructor(factory) {
    this.factory = factory;
  }
  [Symbol.iterator]() {
    return this.factory();
  }
  toArray() {
    return [...this];
  }
  where(fn) {
    const source = this;
    return new Query(function* () {
      for (const x of source) if (fn(x)) yield x;
    });
  }
  select(fn) {
    const source = this;
    return new Query(function* () {
      for (const x of source) yield fn(x);
    });
  }
  flatMap(fn) {
    const source = this;
    return new Query(function* () {
      for (const x of source) yield* fn(x);
    });
  }
  take(n) {
    size(n);
    const source = this;
    return new Query(function* () {
      if (!n) return;
      let i = 0;
      for (const x of source) {
        yield x;
        if (++i === n) return;
      }
    });
  }
  skip(n) {
    size(n);
    const source = this;
    return new Query(function* () {
      let i = 0;
      for (const x of source) if (i++ >= n) yield x;
    });
  }
  distinct(key = (x) => x) {
    const source = this;
    return new Query(function* () {
      const seen = new Set();
      for (const x of source) {
        const k = key(x);
        if (!seen.has(k)) {
          seen.add(k);
          yield x;
        }
      }
    });
  }
  orderBy(terms) {
    const source = this;
    return new Query(function* () {
      const rows = [...source];
      rows.sort((a, b) => {
        for (const [key, direction = 'asc'] of terms) {
          if (!['asc', 'desc'].includes(direction)) throw new Error('Invalid sort direction');
          const x = field(a, key),
            y = field(b, key);
          if (x == null || y == null) {
            const c = compare(x, y);
            if (c) return c;
          } else {
            const c = compare(x, y);
            if (c) return direction === 'desc' ? -c : c;
          }
        }
        return 0;
      });
      yield* rows;
    });
  }
  groupBy(key) {
    const source = this;
    return new Query(function* () {
      const groups = new Map();
      for (const x of source) {
        const k = key(x);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(x);
      }
      for (const [key, rows] of groups) yield { key, rows };
    });
  }
  join(right, leftKey, rightKey, { kind = 'inner', project = (left, right) => ({ left, right }) } = {}) {
    if (!['inner', 'left', 'semi', 'anti'].includes(kind)) throw new Error('Invalid join kind');
    const source = this;
    return new Query(function* () {
      const index = new Map();
      for (const row of right) {
        const k = rightKey(row);
        if (k == null) continue;
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(row);
      }
      for (const left of source) {
        const k = leftKey(left),
          matches = k == null ? undefined : index.get(k);
        if (kind === 'semi') {
          if (matches) yield left;
        } else if (kind === 'anti') {
          if (!matches) yield left;
        } else if (matches) {
          for (const row of matches) yield project(left, row);
        } else if (kind === 'left') yield project(left, null);
      }
    });
  }
  scan(fn, initial) {
    const source = this;
    return new Query(function* () {
      let state = initial;
      for (const x of source) {
        state = fn(state, x);
        yield state;
      }
    });
  }
  window(n) {
    size(n);
    if (n === 0) throw new RangeError('Positive window required');
    const source = this;
    return new Query(function* () {
      const buffer = [];
      for (const x of source) {
        buffer.push(x);
        if (buffer.length > n) buffer.shift();
        if (buffer.length === n) yield [...buffer];
      }
    });
  }
  union(other) {
    return q([this, other])
      .flatMap((x) => x)
      .distinct();
  }
  intersect(other) {
    const set = new Set(other);
    return this.where((x) => set.has(x)).distinct();
  }
  except(other) {
    const set = new Set(other);
    return this.where((x) => !set.has(x)).distinct();
  }
  reduce(fn, initial) {
    let result = initial;
    for (const x of this) result = fn(result, x);
    return result;
  }
  count() {
    return this.reduce((n) => n + 1, 0);
  }
  sum(fn = (x) => x) {
    return this.reduce((s, x) => s + fn(x), 0);
  }
  mean(fn = (x) => x) {
    let s = 0,
      n = 0;
    for (const x of this) {
      s += fn(x);
      n++;
    }
    return n ? s / n : null;
  }
  find(fn) {
    for (const x of this) if (fn(x)) return x;
    return undefined;
  }
  some(fn) {
    for (const x of this) if (fn(x)) return true;
    return false;
  }
  every(fn) {
    for (const x of this) if (!fn(x)) return false;
    return true;
  }
  keyBy(fn) {
    return new Map(Array.from(this, (x) => [fn(x), x]));
  } // Explicitly last value wins.
  partition(fn) {
    const yes = [],
      no = [];
    for (const x of this) (fn(x) ? yes : no).push(x);
    return [yes, no];
  }
}
