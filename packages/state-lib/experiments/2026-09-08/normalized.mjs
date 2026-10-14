/** A tested access/transaction experiment, not a replacement for all existing lab features.
 * Physical rows contain scalar values and foreign keys only. Validators are injected AOT functions.
 * compile-access.mjs removes runtime table registration; fallback .state registers ordinary getters.
 */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const safeName = (n) => {
  if (typeof n !== 'string' || !n || ['__proto__', 'constructor', 'prototype'].includes(n))
    throw new TypeError('Invalid schema name');
  return n;
};
const idKey = (table, id) => JSON.stringify([table, id]);
const fieldKey = (table, id, field) => JSON.stringify([table, id, field]);
const viewInfo = new WeakMap();
export class NormalizedStore {
  #schema;
  #tables = new Map();
  #views = new Map();
  #generations = new Map();
  #draft = null;
  #state;
  #shape = 0;
  #stateShape = -1;
  #observers = new Set();
  #observer = null;
  #queue = new Set();
  #flushing = false;
  version = 0;
  log = [];
  constructor(schema, data, { compiled = false, logLimit = 100 } = {}) {
    if (!Number.isInteger(logLimit) || logLimit < 1) throw new RangeError('Positive log limit');
    this.compiled = compiled;
    this.logLimit = logLimit;
    this.#schema = Object.fromEntries(
      Object.entries(schema).map(([table, s]) => {
        safeName(table);
        if (typeof s.validate !== 'function') throw new TypeError(`AOT validator required for ${table}`);
        const fields = Object.freeze([...s.fields]);
        for (const field of fields) safeName(field);
        if (!fields.includes('id')) throw new TypeError('id field required');
        const relations = Object.fromEntries(
          Object.entries(s.relations ?? {}).map(([name, r]) => {
            safeName(name);
            if (fields.includes(name) || !fields.includes(r.key) || !schema[r.table])
              throw new TypeError('Invalid relation');
            return [name, Object.freeze({ ...r })];
          }),
        );
        return [table, Object.freeze({ ...s, fields, relations: Object.freeze(relations) })];
      }),
    );
    Object.freeze(this.#schema);
    for (const table of Object.keys(this.#schema)) {
      const map = new Map();
      this.#tables.set(table, map);
      for (const row of data[table] ?? []) {
        this.#validate(table, row);
        if (map.has(row.id)) throw new Error('Duplicate ID');
        map.set(row.id, Object.freeze({ ...row }));
      }
    }
    for (const [table, map] of this.#tables) for (const row of map.values()) this.#references(table, row);
  }
  #model(table) {
    const model = this.#schema[table];
    if (!model) throw new Error(`Unknown table ${table}`);
    return model;
  }
  #validate(table, row) {
    const m = this.#model(table);
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Expected row');
    if (typeof row.id !== m.idType || (m.idType === 'number' && !Number.isSafeInteger(row.id)))
      throw new TypeError('Invalid ID');
    for (const f of Object.keys(row)) if (!m.fields.includes(f)) throw new TypeError(`Unknown field ${f}`);
    for (const v of Object.values(row))
      if (v !== null && !['number', 'boolean', 'string', 'undefined'].includes(typeof v))
        throw new TypeError('Rows are scalar and foreign-key only');
    m.validate(row);
  }
  #row(table, id) {
    this.#model(table);
    const key = idKey(table, id);
    return this.#draft?.rows.has(key) ? this.#draft.rows.get(key).row : this.#tables.get(table).get(id);
  }
  #track(key) {
    if (this.#observer) this.#observer.deps.add(key);
  }
  #references(table, row) {
    for (const r of Object.values(this.#model(table).relations)) {
      const id = row[r.key];
      if (id == null && r.nullable) continue;
      if (!this.#row(r.table, id)) throw new Error(`Missing relation ${table}.${r.key} -> ${r.table}:${id}`);
    }
  }
  #readField(table, id, field) {
    const row = this.#row(table, id);
    this.#track(fieldKey(table, id, '$exists'));
    if (!row) throw new Error('Missing entity');
    this.#track(fieldKey(table, id, field));
    return row[field];
  }
  #view(table, id) {
    this.#track(fieldKey(table, id, '$exists'));
    if (!this.#row(table, id)) return undefined;
    const key = idKey(table, id),
      generation = this.#generations.get(key) ?? 0;
    let view = this.#views.get(key);
    if (view && viewInfo.get(view).generation === generation) return view;
    const m = this.#model(table);
    view = {};
    const info = { owner: this, table, id, generation };
    viewInfo.set(view, info);
    const check = () => {
      if ((this.#generations.get(key) ?? 0) !== generation || !this.#row(table, id))
        throw new Error('Stale entity view');
    };
    for (const field of m.fields)
      Object.defineProperty(view, field, {
        enumerable: true,
        get: () => {
          check();
          return this.#readField(table, id, field);
        },
        ...(field === 'id'
          ? {}
          : {
              set: (value) => {
                check();
                this.#writeField(table, id, field, value);
              },
            }),
      });
    for (const [name, r] of Object.entries(m.relations))
      Object.defineProperty(view, name, {
        enumerable: true,
        get: () => {
          check();
          const target = this.#readField(table, id, r.key);
          return target == null ? null : this.#view(r.table, target);
        },
        set: (target) => {
          check();
          if (target === null && r.nullable) {
            this.#writeField(table, id, r.key, null);
            return;
          }
          const other = viewInfo.get(target);
          if (!other || other.owner !== this || other.table !== r.table)
            throw new TypeError('Relation requires a view of the target table in this store');
          if (
            (this.#generations.get(idKey(other.table, other.id)) ?? 0) !== other.generation ||
            !this.#row(other.table, other.id)
          )
            throw new Error('Stale relation target');
          this.#writeField(table, id, r.key, other.id);
        },
      });
    Object.freeze(view);
    this.#views.set(key, view);
    return view;
  }
  /** Runtime fallback: O(N) membership registration on structural change; compiler path avoids this. */
  get state() {
    if (this.compiled) throw new Error('This build requires compile-access; do not enumerate runtime tables');
    if (this.#stateShape !== this.#shape) {
      const root = Object.create(null);
      for (const [table, map] of this.#tables) {
        const entries = Object.create(null);
        for (const id of map.keys())
          Object.defineProperty(entries, String(id), { enumerable: true, get: () => this.#view(table, id) });
        root[table] = Object.freeze(entries);
      }
      this.#state = Object.freeze(root);
      this.#stateShape = this.#shape;
    }
    return this.#state;
  }
  /** Internal targets for compiler output; paths must have statically named relation/field steps. */
  $read(table, id, path = []) {
    let value = this.#view(table, id);
    for (const part of path) {
      if (value == null) throw new Error('Missing relation');
      value = value[part];
    }
    return value;
  }
  $ref(table, id, path) {
    if (!path.length) throw new Error('Assign fields, not table entries');
    let view = this.#view(table, id);
    for (const p of path.slice(0, -1)) {
      if (view == null) throw new Error('Missing relation');
      view = view[p];
    }
    const field = path.at(-1);
    if (!view || !own(view, field) || field === 'id') throw new Error('Unknown/immutable field');
    // Resolve the target BEFORE evaluating the RHS: preserves ordinary JS assignment order.
    return {
      get value() {
        return view[field];
      },
      set value(next) {
        view[field] = next;
      },
    };
  }
  #writeField(table, id, field, value) {
    if (field === 'id' || !this.#model(table).fields.includes(field)) throw new Error('Unknown/immutable field');
    const change = () => {
      const before = this.#row(table, id);
      if (!before) throw new Error('Missing entity');
      this.#draft.rows.set(idKey(table, id), { table, id, row: { ...before, [field]: value } });
    };
    if (this.#draft) change();
    else this.$commit('$assign', change);
  }
  put(table, row) {
    this.#model(table);
    const change = () => this.#draft.rows.set(idKey(table, row.id), { table, id: row.id, row: { ...row } });
    if (this.#draft) change();
    else this.$commit('$put', change);
  }
  remove(table, id) {
    this.#model(table);
    const change = () => this.#draft.rows.set(idKey(table, id), { table, id, row: null });
    if (this.#draft) change();
    else this.$commit('$remove', change);
  }
  action(name, fn) {
    if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction')
      throw new TypeError('Synchronous action required; await outside');
    return (...args) => this.$commit(name, () => fn(...args));
  }
  /** Internal synchronous commit primitive; the public action API is a factory. */
  $commit(name, fn) {
    if (this.#draft) throw new Error('Nested actions are not supported; reuse the outer action');
    if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction')
      throw new TypeError('Synchronous action required; await outside');
    this.#draft = { rows: new Map() };
    let pending, result;
    try {
      result = fn();
      if (result && typeof result.then === 'function') throw new TypeError('Cannot hold an action across await');
      for (const p of this.#draft.rows.values())
        if (p.row) {
          this.#validate(p.table, p.row);
          this.#references(p.table, p.row);
        }
      // Deletion restriction is deliberately O(N) in this experiment. A reverse FK index is planned.
      if ([...this.#draft.rows.values()].some((p) => !p.row))
        for (const [table, map] of this.#tables)
          for (const id of map.keys()) {
            const row = this.#row(table, id);
            if (row) this.#references(table, row);
          }
      pending = [...this.#draft.rows.values()];
    } finally {
      this.#draft = null;
    }
    const changed = new Set(),
      patches = [];
    let structural = false;
    for (const p of pending) {
      const map = this.#tables.get(p.table),
        before = map.get(p.id),
        after = p.row ? Object.freeze(p.row) : undefined;
      if (!before && !after) continue;
      const fields = this.#model(p.table).fields.filter((f) => !Object.is(before?.[f], after?.[f]));
      if (before && after && !fields.length) continue;
      if (after) map.set(p.id, after);
      else map.delete(p.id);
      if (!before !== !after) {
        structural = true;
        changed.add(fieldKey(p.table, p.id, '$exists'));
        if (!after) {
          const key = idKey(p.table, p.id);
          this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
          this.#views.delete(key);
        }
      }
      for (const f of fields) changed.add(fieldKey(p.table, p.id, f));
      patches.push(
        Object.freeze({
          table: p.table,
          id: p.id,
          before: before ?? null,
          after: after ?? null,
          fields: Object.freeze(fields),
        }),
      );
    }
    if (!patches.length) return result;
    if (structural) this.#shape++;
    this.log.push(Object.freeze({ id: ++this.version, action: name, patches: Object.freeze(patches) }));
    if (this.log.length > this.logLimit) this.log.shift();
    for (const o of this.#observers) if ([...o.deps].some((k) => changed.has(k))) this.#queue.add(o);
    this.#flush();
    return result;
  }
  observe(fn) {
    const observer = { fn, deps: new Set(), disposed: false };
    this.#observers.add(observer);
    try {
      this.#run(observer);
    } catch (e) {
      this.#observers.delete(observer);
      throw e;
    }
    return () => {
      observer.disposed = true;
      this.#observers.delete(observer);
      this.#queue.delete(observer);
    };
  }
  #run(observer) {
    observer.deps.clear();
    const previous = this.#observer;
    this.#observer = observer;
    try {
      observer.fn();
    } finally {
      this.#observer = previous;
    }
  }
  #flush() {
    if (this.#flushing) return;
    this.#flushing = true;
    const errors = [];
    try {
      let turns = 0;
      while (this.#queue.size) {
        if (++turns > 1000) {
          this.#queue.clear();
          throw new Error('Reactive cycle');
        }
        for (const o of Array.from(this.#queue)) {
          this.#queue.delete(o);
          if (!o.disposed)
            try {
              this.#run(o);
            } catch (e) {
              errors.push(e);
            }
        }
      }
    } finally {
      this.#flushing = false;
    }
    if (errors.length) throw new AggregateError(errors, 'Committed state; observer failed');
  }
  /** Explicit O(N) inspection. This is not the rendering path. No nested relation copies. */
  inspect() {
    return Object.freeze(
      Object.fromEntries([...this.#tables].map(([t, rows]) => [t, Object.freeze(Object.fromEntries(rows))])),
    );
  }
}
