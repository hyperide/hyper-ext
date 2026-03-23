import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../path/builder';
import type { SceneGraph } from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import { SVGStringRenderer } from './svg-renderer';

describe('SVGStringRenderer', () => {
  it('should render empty scene to SVG', () => {
    const renderer = new SVGStringRenderer();
    const scene: SceneGraph = { items: [], canvas: { width: 100, height: 100 } };
    const svg = renderer.render(scene);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 100 100"');
  });

  it('should render scene with items', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'item-1',
          path: rect,
          style: { fill: { type: 'solid', color: '#ff0000' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 100, height: 100 },
    };
    const svg = renderer.render(scene);
    expect(svg).toContain('fill="#ff0000"');
  });

  it('should hit test fill inside shape', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'rect-1',
          path: rect,
          style: { fill: { type: 'solid', color: '#ff0000' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 200, height: 200 },
    };
    const result = renderer.hitTest({ x: 50, y: 50 }, scene);
    expect(result).not.toBeNull();
    expect(result?.itemId).toBe('rect-1');
    expect(result?.hitType).toBe('fill');
  });

  it('should return null for miss', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'rect-1',
          path: rect,
          style: { fill: { type: 'solid', color: '#ff0000' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 200, height: 200 },
    };
    expect(renderer.hitTest({ x: 150, y: 150 }, scene)).toBeNull();
  });

  it('should hit test stroke for unfilled shape', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'stroked',
          path: rect,
          style: { stroke: { color: '#000', width: 4, cap: 'round', join: 'round' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 100, height: 100 },
    };
    // Near top edge
    const result = renderer.hitTest({ x: 50, y: 11 }, scene);
    expect(result).not.toBeNull();
    expect(result?.hitType).toBe('stroke');
    // Center — should miss
    expect(renderer.hitTest({ x: 50, y: 50 }, scene)).toBeNull();
  });

  it('should return topmost item for overlapping shapes', () => {
    const renderer = new SVGStringRenderer();
    const rect1 = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const rect2 = new PathBuilder().moveTo(50, 50).lineTo(150, 50).lineTo(150, 150).lineTo(50, 150).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'bottom',
          path: rect1,
          style: { fill: { type: 'solid', color: '#f00' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
        {
          id: 'top',
          path: rect2,
          style: { fill: { type: 'solid', color: '#00f' } },
          transform: IDENTITY_TRANSFORM,
          visible: true,
        },
      ],
      canvas: { width: 200, height: 200 },
    };
    const result = renderer.hitTest({ x: 75, y: 75 }, scene);
    expect(result?.itemId).toBe('top');
  });

  it('should skip invisible items', () => {
    const renderer = new SVGStringRenderer();
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const scene: SceneGraph = {
      items: [
        {
          id: 'hidden',
          path: rect,
          style: { fill: { type: 'solid', color: '#ff0000' } },
          transform: IDENTITY_TRANSFORM,
          visible: false,
        },
      ],
      canvas: { width: 100, height: 100 },
    };
    expect(renderer.hitTest({ x: 50, y: 50 }, scene)).toBeNull();
  });

  it('should dispose without error', () => {
    const renderer = new SVGStringRenderer();
    expect(() => renderer.dispose()).not.toThrow();
  });
});
