/**
 * @file Tests for resolveOrderWritePlan (iframe-drag-order.ts).
 *
 * Runs under the root `bun test` preload (happy-dom), so `document` / `HTMLElement`
 * are real and `getBoundingClientRect` returns zero-rects (fine: `position` only
 * needs a deterministic comparison, and these tests assert the persisted className).
 *
 * Regression (review: Codex High): the drag script adds `DRAG_SOURCE_CLASS` to the
 * live dragged element during a gesture. resolveOrderWritePlan reads each sibling's
 * live `class` attribute into SiblingInfo.className, and the order-rewrite path
 * persists that className back to the user's JSX. Without stripping, `hyper-drag-source`
 * would be baked into source and style-injector's `pointer-events:none` rule would
 * permanently disable the element. This test proves the transient class never reaches
 * the write plan.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { DRAG_SOURCE_CLASS } from '@shared/canvas-interaction/drag-class-names';
import { resolveOrderWritePlan } from '../iframe-drag-order';
import type { SourceLocation } from '@shared/element-tracing/types';

let cleanup: HTMLElement[] = [];
afterEach(() => {
  for (const el of cleanup) el.remove();
  cleanup = [];
});

/** Build a flex parent with two `order-*` siblings; return [parent, source, target]. */
function makeOrderRow(): { parent: HTMLElement; source: HTMLElement; target: HTMLElement } {
  const parent = document.createElement('div');
  parent.style.display = 'flex';
  const source = document.createElement('div');
  source.setAttribute('class', `px-2 order-1 ${DRAG_SOURCE_CLASS}`); // transient class present
  const target = document.createElement('div');
  target.setAttribute('class', 'px-2 order-2');
  parent.append(source, target);
  document.body.appendChild(parent);
  cleanup.push(parent);
  return { parent, source, target };
}

describe('resolveOrderWritePlan transient-class stripping', () => {
  test('never persists DRAG_SOURCE_CLASS into the order-rewrite plan', () => {
    const { source, target } = makeOrderRow();
    const SRC: SourceLocation = { fileName: '/src/App.tsx', line: 5, column: 2 };
    const TGT: SourceLocation = { fileName: '/src/App.tsx', line: 9, column: 2 };
    const locs = new Map<HTMLElement, SourceLocation>([
      [source, SRC],
      [target, TGT],
    ]);

    const plan = resolveOrderWritePlan(source, target, 100, 100, {
      getSourceLocation: (el) => locs.get(el) ?? null,
      isHorizontalLayout: () => true,
    });

    expect(plan).not.toBeNull();
    // No entry's new className may carry the transient drag class.
    for (const entry of plan!.entries) {
      expect(entry.newClassName).not.toContain(DRAG_SOURCE_CLASS);
    }
    // And the source element's own rewritten className must keep its real classes.
    const sourceId = `${SRC.fileName}:${SRC.line}:${SRC.column}`;
    const sourceEntry = plan!.entries.find((e) => e.elementId === sourceId);
    if (sourceEntry) {
      expect(sourceEntry.newClassName).toContain('px-2');
      expect(sourceEntry.newClassName).toContain('order-');
    }
  });
});
