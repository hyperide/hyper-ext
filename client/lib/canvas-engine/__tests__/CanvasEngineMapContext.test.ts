/**
 * CanvasEngine map-iteration context plumbing (HYP-290b)
 *
 * Asserts that selecting a `.map()`-rendered child surfaces the map-iteration
 * context — { parentMapId, itemIndex, mapExpression } — to the operation layer,
 * resolved from the selected AST node's `mapItem` plus the per-id itemIndex.
 * No DOM-attribute lookup is involved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setActiveTracer } from '../../element-tracing/active-tracer';
import type { ElementTracer } from '../../element-tracing/element-tracer';
import { CanvasEngine } from '../core/CanvasEngine';
import type { ComponentDefinition } from '../models/types';

describe('CanvasEngine map-iteration context (HYP-290b)', () => {
  let engine: CanvasEngine;

  const buttonDef: ComponentDefinition = {
    type: 'Button',
    label: 'Button',
    fields: { text: { type: 'text', label: 'Text' } },
    defaultProps: { text: 'Click me' },
    render: () => null,
  };

  // Seeds the document-instance tree's AST structure: a plain element plus
  // two map-iteration children sharing one parentMapId.
  function seedAST(): void {
    const root = engine.getRoot();
    root.metadata = {
      ...root.metadata,
      astStructure: [
        {
          id: 'plain-1',
          type: 'Button',
          props: { text: 'Plain' },
          children: [],
        },
        {
          id: 'map-child-0',
          type: 'Card',
          props: {},
          children: [],
          mapItem: { parentMapId: 'map-1', depth: 1, expression: 'items' },
        },
        {
          id: 'map-child-1',
          type: 'Card',
          props: {},
          children: [],
          mapItem: { parentMapId: 'map-1', depth: 1, expression: 'items' },
        },
      ],
    };
  }

  beforeEach(() => {
    engine = new CanvasEngine({ debug: false });
    engine.registerComponent(buttonDef);
    seedAST();
  });

  // Never leak a fake tracer into sibling tests that assume the AST-id path.
  afterEach(() => setActiveTracer(null));

  it('surfaces { parentMapId, itemIndex, mapExpression } for a selected map iteration', () => {
    engine.selectWithItemIndex('map-child-0', 2);

    const ctx = engine.getMapContext('map-child-0');
    expect(ctx).toEqual({
      parentMapId: 'map-1',
      itemIndex: 2,
      mapExpression: 'items',
    });
  });

  it('returns null for a non-map element', () => {
    engine.selectWithItemIndex('plain-1', null);

    expect(engine.getMapContext('plain-1')).toBeNull();
  });

  it('resolves map context for the current single selection without an explicit id', () => {
    engine.selectWithItemIndex('map-child-1', 5);

    expect(engine.getSelectedMapContext()).toEqual({
      parentMapId: 'map-1',
      itemIndex: 5,
      mapExpression: 'items',
    });
  });

  it('returns null map context when the selected element is not a map iteration', () => {
    engine.selectWithItemIndex('plain-1', null);

    expect(engine.getSelectedMapContext()).toBeNull();
  });

  it('does not report a stale itemIndex after a plain select() of the same node', () => {
    // First select an iteration (records itemIndex), then re-select the same AST
    // node via the plain select() path (e.g. from the element tree, no index).
    engine.selectWithItemIndex('map-child-0', 2);
    engine.select('map-child-0');

    expect(engine.getMapContext('map-child-0')).toBeNull();
    expect(engine.getSelectedMapContext()).toBeNull();
  });

  it('bridges a nodeRef (not an AST id) to the map node by source location (production path)', () => {
    // A canvas click selects by nodeRef, NOT the parser-assigned AST id. The AST
    // node carries a source loc; the active tracer maps the nodeRef to that loc.
    const root = engine.getRoot();
    root.metadata = {
      ...root.metadata,
      astStructure: [
        {
          id: 'ast-uuid-not-the-noderef',
          type: 'Card',
          props: {},
          children: [],
          loc: { start: { line: 12, column: 6 } },
          mapItem: { parentMapId: 'map-1', depth: 1, expression: 'items' },
        },
      ],
    };
    setActiveTracer({
      getSourceByNodeRef: (ref: string) => (ref === 'noderef-7' ? { line: 12, column: 6 } : null),
    } as unknown as ElementTracer);

    engine.selectWithItemIndex('noderef-7', 4);

    // findASTNode('noderef-7') misses (id mismatch); the source-loc bridge resolves it.
    expect(engine.getMapContext('noderef-7')).toEqual({
      parentMapId: 'map-1',
      itemIndex: 4,
      mapExpression: 'items',
    });
    expect(engine.getSelectedMapContext()).toEqual({
      parentMapId: 'map-1',
      itemIndex: 4,
      mapExpression: 'items',
    });
  });

  it('resolves map context from sampleStructure when the canvas renders a sample', () => {
    // When a sample drives the canvas, rendered node ids come from sampleStructure.
    const root = engine.getRoot();
    root.metadata = {
      sampleStructure: [
        {
          id: 'sample-map-0',
          type: 'Card',
          props: {},
          children: [],
          mapItem: { parentMapId: 'sample-map', depth: 1, expression: 'data.users' },
        },
      ],
    };

    engine.selectWithItemIndex('sample-map-0', 3);

    expect(engine.getSelectedMapContext()).toEqual({
      parentMapId: 'sample-map',
      itemIndex: 3,
      mapExpression: 'data.users',
    });
  });
});
