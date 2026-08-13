/**
 * Unit test for the host router's `emitAstTelemetry` classifier.
 *
 * Run via the extension suite: `bun test src/__tests__/`
 *
 * Asserts each `ast:*` mutation maps to the right host-emitted telemetry event
 * with PII-SAFE props only — and, critically, that NO prop value / edited text /
 * file path ever reaches a prop. We feed fake messages and a capturing `track`.
 */

import { describe, expect, it } from 'bun:test';
import { emitAstTelemetry, emitInspectorElementInspected } from '../preview-panel-message-router';
import type { TelemetryProps } from '../telemetry/events';

interface Captured {
  name: string;
  props: TelemetryProps;
}

function capture(): { track: (name: string, props?: TelemetryProps) => void; events: Captured[] } {
  const events: Captured[] = [];
  return {
    events,
    track: (name, props) => events.push({ name, props: props ?? {} }),
  };
}

describe('emitAstTelemetry', () => {
  it('ast:updateProps → inspector.propEdited with count + valueKind, NO prop names/values', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, {
      type: 'ast:updateProps',
      filePath: '/Users/secret/App.tsx',
      elementId: 'App.tsx:5:2',
      props: { className: 'bg-red-500 p-4', onClick: '() => doThing()' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('inspector.propEdited');
    expect(events[0].props).toEqual({ propCount: 2, valueKind: 'string' });
    // No prop name, no value, no path, no elementId leaked.
    const serialized = JSON.stringify(events[0].props);
    expect(serialized).not.toContain('className');
    expect(serialized).not.toContain('bg-red-500');
    expect(serialized).not.toContain('App.tsx');
  });

  it('ast:updateStyles → inspector.styleEdited with count + state, NO css values', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, {
      type: 'ast:updateStyles',
      filePath: 'x',
      elementId: 'x:1:1',
      styles: { color: '#ff0000', padding: '8px' },
      state: 'hover',
    });
    expect(events[0].name).toBe('inspector.styleEdited');
    expect(events[0].props).toEqual({ styleCount: 2, state: 'hover' });
    expect(JSON.stringify(events[0].props)).not.toContain('#ff0000');
  });

  it('ast:updateStyles defaults state to base when absent', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:updateStyles', styles: {} });
    expect(events[0].props).toEqual({ styleCount: 0, state: 'base' });
  });

  it('ast:updateText → inspector.textEdited with NO text', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:updateText', text: 'secret user copy' });
    expect(events[0].name).toBe('inspector.textEdited');
    expect(JSON.stringify(events[0].props)).not.toContain('secret');
  });

  it('ast:insertElement → canvas.elementInserted with componentType only', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:insertElement', componentType: 'Button', props: { foo: 'bar' } });
    expect(events[0].name).toBe('canvas.elementInserted');
    expect(events[0].props).toEqual({ componentType: 'Button' });
  });

  it('ast:wrapElement → canvas.elementWrapped with wrapperType only', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:wrapElement', wrapperType: 'div' });
    expect(events[0].name).toBe('canvas.elementWrapped');
    expect(events[0].props).toEqual({ wrapperType: 'div' });
  });

  it('ast:deleteElements → canvas.elementDeleted with count', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:deleteElements', elementIds: ['a:1:1', 'b:2:2'] });
    expect(events[0].name).toBe('canvas.elementDeleted');
    expect(events[0].props).toEqual({ count: 2 });
  });

  it('ast:duplicateElement → canvas.elementDuplicated', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:duplicateElement', elementId: 'a:1:1' });
    expect(events[0].name).toBe('canvas.elementDuplicated');
    expect(events[0].props).toEqual({});
  });

  it('ast:moveElement → canvas.elementMoved with the position enum', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:moveElement', sourceId: 'a:1:1', targetId: 'b:2:2', position: 'before' });
    expect(events[0].name).toBe('canvas.elementMoved');
    expect(events[0].props).toEqual({ position: 'before' });
  });

  it('does NOT emit for ast:writeI18nResource (carries user text)', () => {
    const { track, events } = capture();
    emitAstTelemetry(track, { type: 'ast:writeI18nResource', key: 'k', newText: 'Привет' });
    expect(events).toHaveLength(0);
  });

  it('is a no-op when track is null', () => {
    // Must not throw — telemetry can be absent.
    expect(() => emitAstTelemetry(null, { type: 'ast:updateProps', props: {} })).not.toThrow();
  });
});

describe('emitInspectorElementInspected', () => {
  it('emits inspector.elementInspected with count for a non-empty selection, returns the new key', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: ['App.tsx:5:2', 'App.tsx:9:4'] }, null);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('inspector.elementInspected');
    expect(events[0].props).toEqual({ count: 2 });
    expect(key).toBe('App.tsx:5:2,App.tsx:9:4');
    // No selected element id / nodeRef / path leaked into the PROPS.
    const serialized = JSON.stringify(events[0].props);
    expect(serialized).not.toContain('App.tsx');
    expect(serialized).not.toContain('5:2');
  });

  it('does NOT re-emit for the same selection (dedupe via prevKey)', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'] }, null);
    expect(events).toHaveLength(1);
    // Same selection re-crossing the seam (e.g. re-click / programmatic re-emit).
    const key2 = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'] }, key);
    expect(events).toHaveLength(1); // still 1 — deduped
    expect(key2).toBe(key);
  });

  it('emits again when the selection actually changes to a different element', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'] }, null);
    emitInspectorElementInspected(track, { selectedIds: ['b:2:2'] }, key);
    expect(events).toHaveLength(2);
  });

  it('does NOT emit for an insert-panel selection (insertTargetId present)', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'], insertTargetId: 'a:1:1' }, null);
    expect(events).toHaveLength(0);
    expect(key).toBeNull(); // prevKey unchanged
  });

  it('does NOT emit when the selection is cleared (empty array) but RESETS the dedupe key', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: [] }, 'a:1:1');
    expect(events).toHaveLength(0);
    expect(key).toBeNull(); // dedupe reset so a re-inspect of the same element counts
  });

  it('re-emits when the same element is re-inspected after a clear (click A → clear → click A)', () => {
    const { track, events } = capture();
    const k1 = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'] }, null);
    const k2 = emitInspectorElementInspected(track, { selectedIds: [] }, k1); // clear → reset
    const k3 = emitInspectorElementInspected(track, { selectedIds: ['a:1:1'] }, k2); // re-inspect
    expect(events).toHaveLength(2);
    expect(k3).toBe('a:1:1');
  });

  it('keeps the dedupe key for a malformed (non-array) selectedIds', () => {
    const { track, events } = capture();
    const key = emitInspectorElementInspected(track, { selectedIds: undefined }, 'a:1:1');
    expect(events).toHaveLength(0);
    expect(key).toBe('a:1:1'); // unchanged
    emitInspectorElementInspected(track, { selectedIds: 'App.tsx:1:1' }, null);
    expect(events).toHaveLength(0);
  });

  it('is a no-op (no throw) when track is null', () => {
    expect(() => emitInspectorElementInspected(null, { selectedIds: ['a:1:1'] }, null)).not.toThrow();
  });
});
