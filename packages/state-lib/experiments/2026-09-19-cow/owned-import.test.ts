// Owned import at the external JSON text boundary (spec §4.4, §8.5): a state response is parsed and its document
// field certified once, before any caller can see the raw graph, and the publication adopts exactly that root.
// The general replace(value) contract (always a private certified copy) must stay unchanged beside it.
import { test, expect } from 'bun:test';
import { Runtime } from '../../runtime/src/core';
import * as json from './json-draft.mjs';
import { createDocumentPublication, type DocumentPublication } from './document-publication.mjs';

const text = JSON.stringify({
  version: 7,
  value: { name: 'Board', boards: [{ id: 'a', columns: [{ id: 'c', items: [{ id: '1', done: false, tags: [] }] }] }] },
});
type ProtoDoc = { __proto__: { x: number }; rows: { __proto__: { y: number } }[] };
const importField = <E extends object = { version: number; value: Doc }>(source: unknown, field = 'value') => {
  expect(typeof json.importJsonField).toBe('function');
  return json.importJsonField<E>(source, field);
};
type Item = { id: string; done: boolean; tags: unknown[] };
type Doc = { name: string; boards: { id: string; columns: { id: string; items: Item[] }[] }[] };
const create = (initial: unknown = { name: 'initial', boards: [] }, runtime = new Runtime()) =>
  createDocumentPublication<Doc>(runtime, { initial: initial as Doc, limit: 5 });
// The capability check keeps the RED failure precise when replaceImported does not exist yet.
const adopt = (store: ReturnType<typeof create>, value: unknown) => {
  expect(typeof store.replaceImported).toBe('function');
  store.replaceImported(value as Doc);
};
const deepFrozen = (value: unknown): boolean =>
  value === null || typeof value !== 'object' || (Object.isFrozen(value) && Object.values(value).every(deepFrozen));

test('an imported document root is published by identity with history cleared', () => {
  const store = create();
  store.apply((base) => json.setJsonScalar(base, ['name'], 'edited'), null);
  const envelope = importField(text);
  adopt(store, envelope.value);
  expect(store.read()).toBe(envelope.value);
  expect(store.getSnapshot().document).toBe(envelope.value);
  expect(store.canUndo).toBe(false);
  expect(store.canRedo).toBe(false);
  expect(deepFrozen(envelope.value)).toBe(true);
  // Envelope metadata stays plain caller data; only the selected field is owned.
  expect(envelope.version).toBe(7);
  expect(Object.isFrozen(envelope)).toBe(false);
  expect(json.isOwnedJsonSnapshot(envelope)).toBe(false);
  store.dispose();
});

test('general replace still copies every input, including owned and imported values, and never freezes input', () => {
  const store = create();
  const plain = { name: 'plain', boards: [{ id: 'a', columns: [] }] };
  store.replace(plain);
  expect(store.read()).not.toBe(plain);
  expect(Object.isFrozen(plain)).toBe(false);
  plain.boards[0].id = 'mutated later';
  expect(store.read()!.boards[0].id).toBe('a');
  const imported = importField(text).value;
  store.replace(imported);
  expect(store.read()).not.toBe(imported);
  expect(store.read()!.boards[0]).not.toBe(imported.boards[0]);
  expect(store.read()!.boards[0].columns[0].items[0]).not.toBe(imported.boards[0].columns[0].items[0]);
  expect(store.read()).toEqual(imported);
  const owned = json.ownJson({ name: 'owned', boards: [] });
  store.replace(owned);
  expect(store.read()).not.toBe(owned);
  store.dispose();
});

test('adoption rejects every value that is not an imported tree root and leaves the store unchanged', () => {
  const store = create();
  const before = store.getSnapshot();
  const imported = importField(text).value;
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  };
  const shared = { id: 'shared' };
  const getter = Object.defineProperty({}, 'name', { enumerable: true, get: () => 'changing' });
  const rejected: unknown[] = [
    { name: 'plain', boards: [] },
    // Public flags are caller data, never a certificate.
    deepFreeze({ name: 'flagged', boards: [], owned: true, imported: true, certified: true }),
    importField('{"value":null}').value,
    importField('{"value":5}').value,
    importField('{"value":"text"}').value,
    deepFreeze({ name: 'frozen foreign', boards: [{ id: 'x' }] }),
    json.ownJson({ name: 'certified but not imported', boards: [] }),
    json.ownJson({ left: shared, right: shared }),
    imported.boards,
    imported.boards[0],
    store.read(),
    new Proxy(imported, {}),
    Object.create(imported),
    getter,
    null,
    'text',
    1,
  ];
  for (const value of rejected) {
    expect(() => adopt(store, value)).toThrow(TypeError);
    expect(store.getSnapshot()).toBe(before);
  }
  store.dispose();
});

test('one imported root can be re-adopted after replace and shared by two publications without copying', () => {
  const first = create(),
    second = create();
  const imported = importField(text).value;
  adopt(first, imported);
  first.replace({ name: 'replaced', boards: [] });
  adopt(first, imported);
  adopt(second, imported);
  expect(first.read()).toBe(imported);
  expect(second.read()).toBe(imported);
  first.apply((base) => json.setJsonScalar(base, ['name'], 'first only'), null);
  expect(second.read()!.name).toBe('Board');
  expect(imported.name).toBe('Board');
  first.dispose();
  second.dispose();
});

test('an adopted root keeps the copy-on-write draft and builder fast paths and undo restores its identity', () => {
  const store = create();
  const imported = importField(text).value;
  adopt(store, imported);
  expect(json.beginJsonDraft(store.read()).strategy).toBe('cow');
  expect(json.beginJsonCommand(store.read()).strategy).toBe('builder');
  store.apply((base) => json.setJsonScalar(base, ['boards', 0, 'columns', 0, 'items', 0, 'done'], true), null);
  expect(store.read()).not.toBe(imported);
  expect(store.read()!.boards[0].columns[0].items[0].done).toBe(true);
  expect(imported.boards[0].columns[0].items[0].done).toBe(false);
  expect(store.undo()).toBe(true);
  expect(store.read()).toBe(imported);
  store.dispose();
});

test('import rejects syntax errors, non-finite numbers, missing fields and non-text input like the copy path', () => {
  expect(() => importField('{"value":')).toThrow(SyntaxError);
  for (const source of ['{"value":1e999}', '{"value":{"rows":[1,-1e999]}}'])
    expect(() => importField(source)).toThrow('Document snapshots must be acyclic JSON data');
  for (const source of ['{"other":{}}', '[{"value":{}}]', 'null', '5', '"value"', '{"toString":{}}'])
    expect(() => importField(source, source.includes('toString') ? 'valueOf' : 'value')).toThrow(TypeError);
  let coerced = false;
  const notText = {
    toString() {
      coerced = true;
      return text;
    },
  };
  expect(() => importField(notText)).toThrow(TypeError);
  expect(coerced).toBe(false);
});

test('an own __proto__ key stays data and never reaches a prototype', () => {
  const { value } = importField<{ value: ProtoDoc }>('{"value":{"__proto__":{"x":1},"rows":[{"__proto__":{"y":2}}]}}');
  expect(Object.hasOwn(value, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(value.__proto__.x).toBe(1);
  expect(Object.hasOwn(value.rows[0], '__proto__')).toBe(true);
  expect(({} as Record<string, unknown>).x).toBeUndefined();
  expect(({} as Record<string, unknown>).y).toBeUndefined();
});

test('an adopted document with __proto__, -0 and integer-like keys edits and undoes exactly like the copy path', () => {
  type Edge = { n: number; rows: { v: number }[] } & Record<string, unknown>;
  const source = '{"value":{"__proto__":{"x":1},"n":-0,"2":"b","1":"a","rows":[{"__proto__":{"y":2},"v":1}]}}';
  const shape = (value: Edge) => ({
    keys: Object.keys(value),
    rowKeys: Object.keys(value.rows[0]),
    ownProto: Object.hasOwn(value, '__proto__') && Object.hasOwn(value.rows[0], '__proto__'),
    plain:
      Object.getPrototypeOf(value) === Object.prototype && Object.getPrototypeOf(value.rows[0]) === Object.prototype,
    negativeZero: Object.is(value.n, -0),
    v: value.rows[0].v,
  });
  const run = (load: (store: DocumentPublication<Edge>) => void) => {
    const store = createDocumentPublication<Edge>(new Runtime(), { initial: { n: 0, rows: [] }, limit: 5 });
    load(store);
    const loaded = shape(store.read()!);
    store.apply((base) => json.setJsonScalar(base, ['rows', 0, 'v'], 2), null);
    const edited = shape(store.read()!);
    expect(store.undo()).toBe(true);
    const undone = shape(store.read()!);
    store.dispose();
    return { loaded, edited, undone };
  };
  const adopted = run((store) => store.replaceImported(json.importJsonField<{ value: Edge }>(source, 'value').value));
  const copied = run((store) => store.replace(JSON.parse(source).value));
  expect(adopted).toEqual(copied);
  expect(adopted.edited).toEqual({ ...adopted.loaded, v: 2 });
  expect(adopted.undone).toEqual(adopted.loaded);
  expect(adopted.loaded.ownProto && adopted.loaded.plain && adopted.loaded.negativeZero).toBe(true);
});

test('no mutable handoff: the imported graph is frozen before the caller receives it', () => {
  const { value } = importField(text);
  expect(() => {
    value.name = 'late';
  }).toThrow(TypeError);
  expect(() => {
    value.boards[0].columns[0].items.push({ id: '2', done: false, tags: [] });
  }).toThrow(TypeError);
  expect(value.name).toBe('Board');
});

test('adoption inside a shared transaction rolls back and is never observed', () => {
  const runtime = new Runtime();
  const store = create({ name: 'before', boards: [] }, runtime);
  const before = store.getSnapshot();
  let notified = 0;
  store.subscribe(() => notified++);
  const imported = importField(text).value;
  expect(() =>
    runtime.transaction(() => {
      adopt(store, imported);
      throw Error('apply failed after adoption');
    }),
  ).toThrow('apply failed after adoption');
  expect(store.getSnapshot()).toBe(before);
  expect(store.read()).not.toBe(imported);
  expect(notified).toBe(0);
  store.dispose();
});

test('small and empty documents keep the same published content as the copy path', () => {
  for (const source of ['{"value":{}}', '{"value":[]}', '{"value":{"boards":[]}}']) {
    const copied = create(),
      adopted = create();
    copied.replace(JSON.parse(source).value);
    adopt(adopted, importField(source).value);
    expect(adopted.read()).toEqual(copied.read());
    expect(adopted.canUndo).toBe(false);
    copied.dispose();
    adopted.dispose();
  }
});
