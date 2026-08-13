/**
 * @file D2 frozen BatchStyleWritePlan — one immutable, inspectable plan per batch gesture
 *
 * STATUS (read this): STAGED for the `ast:updateStylesBatch` host handler — NOT yet on the live SaaS
 *   write path. The live path today is useStyleSync.flushQueue → engine.updateASTStylesBatch → the
 *   POST /api/update-component-styles-batch route, which resolves + writes per element freshly server-
 *   side (it does NOT build/freeze a plan or run a client stale guard). The plan's same-source dedupe
 *   IS live: its key comes from the shared `batch-dedupe` helper that the live route also calls, so the
 *   two can never disagree. The frozen-plan/stale-guard pieces below are the v1 contract for the host
 *   handler (HYP-535 transport gate; per-rung channel dispatch HYP-664) and ship behind it, not here.
 *   This is deferred-by-design scaffolding with a tracked landing point — do NOT delete as "unused."
 * Assumptions: per-element routes are resolved from the read-time snapshot before freezing; the
 *   plan never re-routes between debounce/slider ticks (gesture-freeze, §5.2).
 * Architecture: docs/specs/2026-06-11-270-d2-source-routing.md §5
 */

import { sameSourceKey } from '@lib/style-write/batch-dedupe';
import type { CssSystemId, StyleCondition } from '@lib/style-read/types';
import type { SkipReasonCode } from '@lib/style-write/skip-reason-codes';
import type { StyleWriteChannel } from '@lib/style-write/stylability-ladder';

interface BatchWriteRoute {
  cssSystem: CssSystemId;
  /** Ladder rung → write channel: L1 ⇒ 'styles', L0/L2 ⇒ 'props'. */
  channel: StyleWriteChannel;
}

/** One selected element's resolved write target, fed to the plan builder. */
export interface BatchPlanElement {
  elementId: string;
  filePath: string;
  /** Per-element source node ref (D4 cross-file v1). Dedupe key with filePath. */
  elementRef: string;
  /** Resolved write target; null ⇒ this element skips (carries skipReason). */
  route: BatchWriteRoute | null;
  skipReason?: SkipReasonCode;
}

interface BatchStyleWriteEntry {
  elementId: string;
  filePath: string;
  elementRef: string;
  property: string;
  newValue: string;
  route: BatchWriteRoute | null;
  status: 'planned' | 'skipped';
  skipReason?: SkipReasonCode;
}

export interface BatchStyleWritePlan {
  readonly requestId: string;
  /** Monotonic; a later plan supersedes an earlier one (slider ticks). */
  readonly sequence: number;
  /** Selection-store revision captured at read time. */
  readonly selectionRevision: number;
  /** Per-file content/version captured at read time. */
  readonly sourceSnapshot: ReadonlyMap<string, string>;
  /** Single global condition applied uniformly. */
  readonly condition: StyleCondition;
  readonly routingMode: 'auto' | 'override';
  readonly entries: ReadonlyArray<BatchStyleWriteEntry>;
}

export interface BuildBatchStyleWritePlanInput {
  requestId: string;
  sequence: number;
  selectionRevision: number;
  sourceSnapshot: ReadonlyMap<string, string>;
  condition: StyleCondition;
  routingMode: 'auto' | 'override';
  elements: BatchPlanElement[];
  property: string;
  newValue: string;
}

/**
 * Build a frozen plan. Same-source dedupe (§5.4): multiple selected RENDERED instances that resolve
 * to the SAME (filePath, elementRef) source node collapse to ONE planned mutation. A null route
 * yields a `skipped` entry carrying its reason; everything else is `planned`.
 */
export function buildBatchStyleWritePlan(input: BuildBatchStyleWritePlanInput): BatchStyleWritePlan {
  const seenSources = new Set<string>();
  const entries: BatchStyleWriteEntry[] = [];

  for (const element of input.elements) {
    if (element.route === null) {
      entries.push({
        elementId: element.elementId,
        filePath: element.filePath,
        elementRef: element.elementRef,
        property: input.property,
        newValue: input.newValue,
        route: null,
        status: 'skipped',
        skipReason: element.skipReason ?? 'NO_WRITABLE_TARGET',
      });
      continue;
    }

    // Same-source dedupe: collapse repeated instances of one source node to a single mutation.
    // Shared key with the live server route (batch-dedupe.ts) — one definition, two call sites, so the
    // frozen plan and the live write can never disagree on what "same source node" means.
    const dedupeKey = sameSourceKey({ filePath: element.filePath, sourceRef: element.elementRef });
    if (seenSources.has(dedupeKey)) continue;
    seenSources.add(dedupeKey);

    entries.push({
      elementId: element.elementId,
      filePath: element.filePath,
      elementRef: element.elementRef,
      property: input.property,
      newValue: input.newValue,
      route: element.route,
      status: 'planned',
    });
  }

  const plan: BatchStyleWritePlan = {
    requestId: input.requestId,
    sequence: input.sequence,
    selectionRevision: input.selectionRevision,
    // Snapshot a defensive copy: the plan must be immutable once frozen, so later mutation of the
    // caller's Map cannot retroactively defeat isPlanStale (codex finding).
    sourceSnapshot: new Map(input.sourceSnapshot),
    condition: input.condition,
    routingMode: input.routingMode,
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  };

  return Object.freeze(plan);
}

export interface CurrentBatchState {
  selectionRevision: number;
  sourceSnapshot: ReadonlyMap<string, string>;
}

/**
 * Stale guard (§5.3 → STALE_PLAN). Compare the plan's read-time selectionRevision + per-file
 * snapshots against current state. If the selection changed, or any file the plan touches has a
 * changed/missing snapshot, the plan is stale and must abort into the banner (never re-route).
 * Only files actually referenced by `planned` entries are checked.
 */
export function isPlanStale(plan: BatchStyleWritePlan, current: CurrentBatchState): boolean {
  if (plan.selectionRevision !== current.selectionRevision) return true;

  const touchedFiles = new Set<string>();
  for (const entry of plan.entries) {
    if (entry.status === 'planned') touchedFiles.add(entry.filePath);
  }

  for (const filePath of touchedFiles) {
    const planned = plan.sourceSnapshot.get(filePath);
    const now = current.sourceSnapshot.get(filePath);
    if (planned === undefined || now === undefined || planned !== now) return true;
  }

  return false;
}
