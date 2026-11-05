/** Public research: one set of observations, reused by stories, concepts and benchmarks. */
import evidence from './research-evidence.generated.json';

export const EVIDENCE = evidence;
export const RESEARCH_CONCEPTS = [
  {
    id: 'compile-time-qualification',
    title: 'Compile-time qualification',
    status: 'Build-time specialization',
    summary:
      'Generate a candidate, check its contract and measurements, then ship one implementation—not a runtime decision tree.',
  },
  {
    id: 'snapshot-ownership',
    title: 'Historical snapshots are not live drafts',
    status: 'Immutable ownership',
    summary:
      'A reference to yesterday’s state must keep yesterday’s value, even when a new transaction edits the same entity.',
  },
  {
    id: 'command-shaped-optimization',
    title: 'Optimize the shape of the command',
    status: 'Command generation',
    summary: 'One field, every row and a reorder do different work. A single universal fast path is the wrong target.',
  },
] as const;

const operationNames: Record<string, string> = {
  root: 'Root field',
  item: 'One item',
  sparse: 'Every tenth item',
  all: 'All items',
  move: 'Move item',
  noop: 'No-op command',
  history: 'Undo + redo',
};
export function controllerComparison(count: number) {
  return Object.entries(operationNames).map(([operation, label]) => {
    const pick = (backend: string) => {
      const row = EVIDENCE.controller.rows.find(
        (entry) => entry.count === count && entry.operation === operation && entry.backend === backend,
      );
      if (!row) throw new Error(`Missing research cell: ${count}/${operation}/${backend}`);
      return row;
    };
    const original = pick('baseline'),
      runtime = pick('state-lib'),
      cow = pick('state-lib-cow');
    return {
      operation,
      label,
      count,
      original: original.medianMs,
      runtime: runtime.medianMs,
      cow: cow.medianMs,
      pass: cow.maximumMs <= original.minimumMs,
    };
  });
}

export type ResearchConceptId = (typeof RESEARCH_CONCEPTS)[number]['id'];
export const evidenceDownload = '/research/2026-09-20-evidence.json';
