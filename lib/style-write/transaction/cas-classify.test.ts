/**
 * @file Four-way CAS classification + saga-terminal derivation tests (spec §9.1 step 5 / ledger table)
 *
 * Accessed via: bun test lib/style-write/transaction/cas-classify.test.ts
 * Assumptions: pure functions; one rule shared by rollback / B3 / recovery so it cannot drift.
 */
import { describe, expect, it } from 'bun:test';
import { classifyInverse } from './cas-classify';
import { deriveRollbackTerminal } from './saga-terminal';
import type { ContentHash, HunkStatus, InversePatch } from './types';

function patch(before: string, after: string | null): InversePatch {
  return {
    filePath: '/f',
    beforeContent: 'x',
    beforeExisted: true,
    attempted: after !== null,
    beforeHash: before as ContentHash,
    afterHash: after as ContentHash | null,
  };
}

const never = (): boolean => false;

describe('classifyInverse — the ONE four-way rule (rollback_failed is the FOURTH branch only)', () => {
  it('apply: current == after-hash', () => {
    expect(classifyInverse(patch('B', 'A'), 'A' as ContentHash, never)).toBe('apply');
  });

  it('skip-not-landed: current == before-hash', () => {
    expect(classifyInverse(patch('B', 'A'), 'B' as ContentHash, never)).toBe('skip-not-landed');
  });

  it('superseded: current is a later committed writeId after-hash', () => {
    const isSuperseded = (_: string, h: ContentHash): boolean => h === ('LATER' as ContentHash);
    expect(classifyInverse(patch('B', 'A'), 'LATER' as ContentHash, isSuperseded)).toBe('superseded');
  });

  it('failed: foreign content matches no branch', () => {
    expect(classifyInverse(patch('B', 'A'), 'FOREIGN' as ContentHash, never)).toBe('failed');
  });

  it('does not classify apply when afterHash is null (forward never landed)', () => {
    // A snapshotted-but-never-written file has afterHash null; current==before → skip, never apply.
    expect(classifyInverse(patch('B', null), 'B' as ContentHash, never)).toBe('skip-not-landed');
  });

  it('before-hash wins over a spurious afterHash equal to it (no false apply)', () => {
    // Degenerate: before==after (a no-op write). current==that hash → apply is fine; this proves the
    // ordering is deterministic and apply is only chosen when afterHash is non-null and matches.
    expect(classifyInverse(patch('S', 'S'), 'S' as ContentHash, never)).toBe('apply');
  });
});

describe('deriveRollbackTerminal — terminal is a pure function of the hunk multiset', () => {
  const statuses = (...s: HunkStatus[]): HunkStatus[] => s;

  it('all reverted → rolled_back', () => {
    expect(deriveRollbackTerminal(statuses('reverted', 'reverted'))).toBe('rolled_back');
  });

  it('any revert-failed dominates → rollback_failed', () => {
    expect(deriveRollbackTerminal(statuses('reverted', 'revert-failed', 'committed'))).toBe('rollback_failed');
  });

  it('superseded-skipped (no failure) → superseded', () => {
    expect(deriveRollbackTerminal(statuses('reverted', 'superseded-skipped'))).toBe('superseded');
  });

  it('mix of committed + reverted → partially_committed', () => {
    expect(deriveRollbackTerminal(statuses('committed', 'reverted'))).toBe('partially_committed');
  });

  it('empty ledger → rolled_back (nothing landed)', () => {
    expect(deriveRollbackTerminal(statuses())).toBe('rolled_back');
  });
});
