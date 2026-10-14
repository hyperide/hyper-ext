import { FIXTURE, type Variant } from '../data/query-comparison';
import { View, view } from './view-plan';
/** Executes only the authored comparison fixture, after the reader presses Run.
 * Tests call this SAME path. There is no substitute/emulation for missing engines. */
export async function runQueryFixture(v: Variant): Promise<unknown> {
  if (v.status !== 'executable') throw new Error('This language is a reference, not an installed runtime.');
  const { rows, users, excluded } = structuredClone(FIXTURE);
  const [{ default: _ }, R, I, { produce }] = await Promise.all([
    import('lodash'),
    import('ramda'),
    import('immutable'),
    import('immer'),
  ]);
  const db = v.code.includes('db.queryOnce') ? await import('@tanstack/db') : undefined;
  const collection = db?.createCollection(
    db.localOnlyCollectionOptions({ getKey: (r: (typeof rows)[number]) => r.id, initialData: rows }),
  );
  const userCollection = db?.createCollection(
    db.localOnlyCollectionOptions({ getKey: (u: (typeof users)[number]) => u.id, initialData: users }),
  );
  try {
    if (db && collection) {
      collection.createIndex((r) => r.ownerId, { indexType: db.BasicIndex });
      collection.createIndex((r) => r.rank, { indexType: db.BasicIndex });
    }
    const fn = new (Object.getPrototypeOf(async function () {}).constructor)(
      'rows',
      'users',
      'excluded',
      '_',
      'R',
      'I',
      'produce',
      'view',
      'db',
      'collection',
      'userCollection',
      v.code,
    );
    const result = await fn(rows, users, excluded, _, R, I, produce, view, db, collection, userCollection);
    // Materialize only our own plan type, not an ordinary result's `run` field.
    // Complete deferred execution before checking the no-input-mutation contract.
    const materialized = result instanceof View ? await result.run() : result;
    if (JSON.stringify({ rows, users, excluded }) !== JSON.stringify(FIXTURE))
      throw new Error('The snippet mutated the input fixture.');
    return materialized;
  } finally {
    await collection?.cleanup();
    await userCollection?.cleanup();
  }
}
