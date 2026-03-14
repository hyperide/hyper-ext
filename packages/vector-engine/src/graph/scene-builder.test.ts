import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../path/builder';
import type { TerminalNodeOutput } from '../types';
import { IDENTITY_TRANSFORM } from '../types';
import { buildScene } from './scene-builder';

describe('buildScene', () => {
  it('should create scene items from terminal node results', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build();

    const terminal: TerminalNodeOutput = {
      id: 'n1',
      name: 'Rectangle',
      path,
      style: { fill: { type: 'solid', color: '#ff0000' } },
      transform: IDENTITY_TRANSFORM,
      visible: true,
    };

    const scene = buildScene({
      terminalNodes: [terminal],
      canvas: { width: 800, height: 600 },
    });

    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({ id: 'n1', visible: true });
    expect(scene.canvas).toEqual({ width: 800, height: 600 });
  });

  it('should preserve order (back-to-front)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const base: TerminalNodeOutput = {
      id: '',
      path,
      style: {},
      transform: IDENTITY_TRANSFORM,
      visible: true,
    };
    const scene = buildScene({
      terminalNodes: [
        { ...base, id: 'back', name: 'Back' },
        { ...base, id: 'front', name: 'Front' },
      ],
      canvas: { width: 100, height: 100 },
    });

    expect(scene.items[0].id).toBe('back');
    expect(scene.items[1].id).toBe('front');
  });

  it('should handle empty terminal nodes', () => {
    const scene = buildScene({
      terminalNodes: [],
      canvas: { width: 100, height: 100 },
    });
    expect(scene.items).toHaveLength(0);
  });
});
