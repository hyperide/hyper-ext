import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, watch } from '../src/lib/proto';

const initial = () => ({ draft: { name: '', amountText: '' }, preview: { open: false }, request: { phase: 'idle' } });
test('a global form field notifies its interested reader, not the unrelated preview reader', () => {
  const store = createStore(initial());
  let fieldReads = 0,
    previewReads = 0;
  const stopField = watch(() => {
    void store.state.draft.name;
    fieldReads++;
  });
  const stopPreview = watch(() => {
    void store.state.preview.open;
    previewReads++;
  });
  const edit = store.action('Edit name', (state, value: string) => {
    state.draft.name = value;
  });
  try {
    edit('Ada');
    assert.equal(fieldReads, 2, 'one initial read plus the relevant update');
    assert.equal(previewReads, 1, 'no unrelated reader update');
    assert.equal(store.snapshot().draft.name, 'Ada');
  } finally {
    stopField();
    stopPreview();
  }
});
test('stories and tests seed isolated store instances; an old snapshot does not change', () => {
  const left = createStore(initial()),
    right = createStore(initial());
  const before = left.snapshot();
  left.action('Type an incomplete decimal', (state) => {
    state.draft.amountText = '1.';
  })();
  assert.equal(left.snapshot().draft.amountText, '1.');
  assert.equal(right.snapshot().draft.amountText, '');
  assert.equal(before.draft.amountText, '');
});
test('a deterministic same-version action fixture rebuilds its model without mounting React', () => {
  // This is an explicit fixture recipe, not a production capture/replay SDK.
  const fixture = JSON.parse(JSON.stringify({ schema: 1, seed: initial(), actions: ['Ada', 'Grace'] })) as {
    schema: number;
    seed: ReturnType<typeof initial>;
    actions: string[];
  };
  const run = () => {
    const store = createStore(fixture.seed);
    const edit = store.action('Edit name', (state, value: string) => {
      state.draft.name = value;
    });
    fixture.actions.forEach(edit);
    return { snapshot: store.snapshot(), names: store.log.map((entry) => entry.name) };
  };
  const first = run(),
    replayed = run();
  assert.deepEqual(first, replayed);
  assert.equal(first.snapshot.draft.name, 'Grace');
  assert.deepEqual(first.names, ['Edit name', 'Edit name']);
});
