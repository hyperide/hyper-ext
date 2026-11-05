import type { ExampleMetadata } from '../../lib/example-lab/types';
const shared = [
  {
    id: 'publication',
    title: 'Atomic state and history',
    href: '/spec#document-publication',
    affects: ['point', 'dense', 'sparse', 'move', 'history'],
  },
  {
    id: 'compiler',
    title: 'The same compiler in your browser',
    href: '/spec#browser-compiler',
    affects: ['source', 'generated'],
  },
  {
    id: 'size',
    title: 'Shared helpers and complete entry size',
    href: '/spec#entry-size-budget',
    affects: ['rawBytes', 'gzipBytes'],
  },
];
export const LAB_EXAMPLES: ExampleMetadata[] = [
  {
    id: 'board-commands',
    title: 'Move cards, keep their data',
    summary:
      'Edit cards, move them between columns and undo changes. Compare ordinary draft commands with generated immutable updates on the same board.',
    origin:
      'https://github.com/hyperide/hyper-saas/blob/dbdfc07d0b25fa12f6f395305a25d88b6b838052/packages/state-lib/experiments/2026-09-23-command-builder/measure.mjs',
    operations: ['point', 'dense', 'sparse', 'move', 'history'],
    mechanisms: [
      { id: 'paths', title: 'Copy the changed path', href: '/spec#command-path-copying', affects: ['point'] },
      { id: 'order', title: 'Move order, keep card identity', href: '/spec#command-order-moves', affects: ['move'] },
      ...shared,
    ],
  },
  {
    id: 'issue-triage',
    title: 'Triage a backlog in one transaction',
    summary:
      'Keep issue records separate from column order. Update a backlog, move IDs without copying issue details, and inspect the complete generated program.',
    origin:
      'https://github.com/hyperide/hyper-saas/blob/dbdfc07d0b25fa12f6f395305a25d88b6b838052/packages/state-lib/experiments/2026-09-19-cow/document-publication.mjs',
    operations: ['point', 'dense', 'sparse', 'move', 'history'],
    mechanisms: [
      {
        id: 'batch',
        title: 'Build only changed rows',
        href: '/spec#command-batch-construction',
        affects: ['dense', 'sparse'],
      },
      { id: 'paths', title: 'Copy the changed path', href: '/spec#command-path-copying', affects: ['point'] },
      ...shared,
    ],
  },
];
