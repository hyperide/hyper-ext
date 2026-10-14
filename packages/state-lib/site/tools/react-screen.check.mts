import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleById } from '../src/data/examples';
import { createStepSession } from '../src/lib/step-session';
import { replApi } from '../src/lib/repl-api';
import { scopeValues, inspectPath } from '../src/lib/repl-inspection';

for (const id of ['task-screen', 'zustand-task-screen']) {
  test(`${id}: setup creates real state and a React component without running the demo`, async () => {
    const example = exampleById(id)!;
    assert.match(example.ui!, /function TaskScreen/);
    assert.match(example.ui!, /return <TaskScreen/);
    const session = await createStepSession(example.setup, example.code, example.ui!, replApi);
    try {
      assert.equal(inspectPath(scopeValues(session.scope), 'store.tasks.a.done').value, false);
      assert.equal(inspectPath(scopeValues(session.scope), 'store.tasks.b.done').value, false);
      assert(session.ui);
      assert.equal(session.frames.length, 0);
      await session.run();
      assert.equal(inspectPath(scopeValues(session.scope), 'store.tasks.a.done').value, true);
      assert.equal(inspectPath(scopeValues(session.scope), 'store.tasks.b.done').value, true);
      assert.equal(inspectPath(scopeValues(session.scope), 'store.filter').value, 'all');
    } finally {
      session.cancel();
    }
  });
}

import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement } from 'react';

test('the presentational screen renders a story fixture without a store or connected wrapper', async () => {
  const example = exampleById('task-screen')!;
  const fixtureUi = example.ui!.replace(
    'return <TaskScreen />',
    'return <TaskView a={true} b={false} filter="all" onToggle={() => {}} onFilter={() => {}} onComplete={() => {}} />',
  );
  assert.notEqual(fixtureUi, example.ui);
  const session = await createStepSession('', '', fixtureUi, replApi);
  try {
    assert(!('store' in session.scope));
    assert(isValidElement(session.ui));
    const html = renderToStaticMarkup(session.ui);
    assert.match(html, /Draft the announcement/);
    assert.match(html, /Review the release/);
    assert.match(html, /<strong>1<\/strong> tasks left/);
  } finally {
    session.cancel();
  }
});

import { inspectionOf } from '../src/lib/repl-inspection';
import type * as zustandVanilla from 'zustand/vanilla';
test('Zustand inspection preserves direct and curried store creation', () => {
  const { zustand } = replApi(
    () => {},
    () => {},
  ) as { zustand: typeof zustandVanilla };
  const direct = zustand.createStore(() => ({ count: 1 }));
  const curried = zustand.createStore<{ count: number }>()(() => ({ count: 2 }));
  for (const store of [direct, curried]) {
    const inspection = inspectionOf(store);
    assert(inspection);
    let changes = 0;
    const stop = inspection.subscribe(() => {
      changes++;
    });
    store.setState({ count: 3 });
    assert.deepEqual(inspection.read(), { count: 3 });
    assert.equal(changes, 1);
    stop();
    store.setState({ count: 4 });
    assert.equal(changes, 1);
  }
});
