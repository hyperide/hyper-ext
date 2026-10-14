import { href } from './router';

export type ExampleGuide = { id: string; title: string; purpose: string; steps: readonly string[] };
export const GUIDES: Record<string, ExampleGuide> = {
  'read-write': {
    id: 'read-write',
    title: 'Make a change. See what changes.',
    purpose: 'A small task list connects the UI to its state, named action and change record.',
    steps: [
      'Start the example to create the live task list.',
      'Toggle a task. Watch its row update and inspect the action below.',
      'Read the explanation, then open the editor to change the same running example.',
    ],
  },
  derive: {
    id: 'derive',
    title: 'Let a value keep itself up to date.',
    purpose: 'Read tracked values once and see a derived result follow the state it depends on.',
    steps: [
      'Start the example and inspect the live signals.',
      'Change a source value in the workbench.',
      'Compare the derived result with the source and inspect the recorded values.',
    ],
  },
  derived: {
    id: 'derived',
    title: 'Keep a filtered view in sync.',
    purpose: 'A collection view follows changes to its source instead of becoming a disconnected copy.',
    steps: [
      'Start the collection example.',
      'Change a record with the live workbench controls.',
      'Compare the source records with the derived view.',
    ],
  },
  collection: {
    id: 'collection',
    title: 'Update one item, not the whole screen.',
    purpose: 'A live list makes per-item subscriptions visible through row render counters.',
    steps: [
      'Start the example to mount the list.',
      'Toggle just one row and watch its counter.',
      'Inspect the source or compare the same task with another toolkit.',
    ],
  },
  undo: {
    id: 'undo',
    title: 'Give every change a way back.',
    purpose: 'Make edits, undo them, and redo them against the same state and history.',
    steps: [
      'Start the example, then edit the task title or estimate.',
      'Press Undo in the live UI, then Redo.',
      'Inspect forward and inverse patches to connect the history to the state.',
    ],
  },
  optimistic: {
    id: 'optimistic',
    title: 'Try an update before the server agrees.',
    purpose: 'Follow a real prototype optimistic update and its rejection, without contacting a server.',
    steps: [
      'Start the example and observe the proposed change.',
      'Read the rejected result and restored state in the workbench.',
      'Reset and step through the request and rollback one instruction at a time.',
    ],
  },
  cancellation: {
    id: 'cancellation',
    title: 'Stop work when its screen goes away.',
    purpose: 'A scope owns asynchronous tasks and propagates a deliberate cancellation.',
    steps: [
      'Start the example and observe the task timeline.',
      'Use the live scope controls to start or cancel work.',
      'Inspect status and settlement separately; shielded work can finish later.',
    ],
  },
  latest: {
    id: 'latest',
    title: 'Keep the latest request, not a stale answer.',
    purpose: 'See superseded asynchronous work stop while the latest request stays relevant.',
    steps: [
      'Start the example and inspect its task controls.',
      'Start competing work in the live scope workbench.',
      'Compare supersession, cancellation and the final state.',
    ],
  },
  conversion: {
    id: 'conversion',
    title: 'Keep typing separate from valid data.',
    purpose: 'A field links editable text, a valid domain value and its wire representation.',
    steps: [
      'Start the example to create a live field.',
      'Edit the presentation and compare valid and incomplete input.',
      'Inspect the domain value and the serialization boundary.',
    ],
  },
  regions: {
    id: 'regions',
    title: 'Give data a clear lifetime.',
    purpose: 'Regions describe ownership next to the state without creating independent stores.',
    steps: [
      'Start the example and inspect the region workbench.',
      'Change a value using the live controls.',
      'Compare region metadata with snapshots and persistence behavior.',
    ],
  },
  transient: {
    id: 'transient',
    title: 'Keep the keystrokes. Skip the history noise.',
    purpose: 'Type in a real input and compare transient updates with committed history.',
    steps: [
      'Start the example and focus its live input.',
      'Type a few characters and watch the local state.',
      'Compare the action log with the transient changes.',
    ],
  },
  queries: {
    id: 'queries',
    title: 'See a query turn records into a result.',
    purpose: 'Inspect complete source data, a query and the resulting view in one executable scenario.',
    steps: [
      'Start the example to build its source data and query.',
      'Inspect or change the live data with the workbench.',
      'Compare the result with the complete query, not a disconnected expression.',
    ],
  },
  lifecycle: {
    id: 'lifecycle',
    title: 'Disconnect a subscription on purpose.',
    purpose:
      'See exactly what stops updating when a watcher is disposed. This prototype uses the unsubscribe function returned by watch.',
    steps: [
      'Start the example to mount a counter and a subscribed reader.',
      'Increment the source: both values follow it.',
      'Disconnect the reader, then increment again. The source changes; the disposed reader does not.',
    ],
  },
};

export function guideHref(id: string): string {
  return href(`/repl/${id}`, 'guide');
}

/** Only offer a lesson when the source or its owning documentation identifies a relevant topic. */
export function guideFor(source: string, context = '', explicit?: string): ExampleGuide | undefined {
  if (explicit) return GUIDES[explicit];
  const text = `${context}\n${source}`;
  const rules: readonly [RegExp, string][] = [
    [/\b(dispose|unsubscribe|unobserve)\b/i, 'lifecycle'],
    [/\b(optimistic|rollback|outbox)\b/i, 'optimistic'],
    [/\b(undo|redo|inverse|history|jumpTo)\b/i, 'undo'],
    [/\b(takeLatest|supersession|supersede)\b/i, 'latest'],
    [/\b(createScope|TaskContext|Scope|spawn|cancel|shield|race|settled)\b/i, 'cancellation'],
    [/\b(DateType|presented|customType|codec)\b/i, 'conversion'],
    [/\b(transient|keystroke)\b/i, 'transient'],
    [/\b(region|retention|lifetime|persist|storageAdapter)\b/i, 'regions'],
    [/\b(query|groupBy|orderBy|Datalog|SQL|IVM)\b/i, 'queries'],
    [/\b(derive\.collection|deriveCollection)\b/i, 'derived'],
    [/\b(usePath|collection|items)\b/i, 'collection'],
    [/\b(derive|signal|watch|computed|subscribe)\b/i, 'derive'],
    [/\b(createStore|store\.action|snapshot|transaction|patch|state\.)\b/i, 'read-write'],
  ];
  const id = rules.find(([pattern]) => pattern.test(text))?.[1];
  return id ? GUIDES[id] : undefined;
}
