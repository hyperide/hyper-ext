import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../path/builder';
import type { SceneGraph, SceneItem, TransformMatrix } from '../types';
import { sceneToSvg } from './svg';

function makeItem(overrides: Partial<SceneItem> = {}): SceneItem {
  return {
    id: 'test',
    path: new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 50).lineTo(0, 50).close().build(),
    style: { fill: { type: 'solid', color: '#ff0000' } },
    transform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
    visible: true,
    ...overrides,
  };
}

describe('sceneToSvg', () => {
  it('should produce valid SVG with viewBox', () => {
    const scene: SceneGraph = {
      items: [makeItem()],
      canvas: { width: 800, height: 600 },
    };
    const svg = sceneToSvg(scene);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('should include path element with d attribute', () => {
    const scene: SceneGraph = {
      items: [makeItem()],
      canvas: { width: 100, height: 100 },
    };
    const svg = sceneToSvg(scene);
    expect(svg).toContain('<path');
    expect(svg).toContain('d="M 0 0 L 100 0 L 100 50 L 0 50 Z"');
  });

  it('should apply fill color', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { fill: { type: 'solid', color: '#3b82f6' } } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('fill="#3b82f6"');
  });

  it('should apply stroke', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            stroke: { color: '#000', width: 2, cap: 'round', join: 'round' },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain('stroke-width="2"');
  });

  it('should apply transform matrix', () => {
    const svg = sceneToSvg({
      items: [makeItem({ transform: [1, 0, 0, 1, 10, 20] as TransformMatrix })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('transform="matrix(1 0 0 1 10 20)"');
  });

  it('should skip invisible items', () => {
    const svg = sceneToSvg({
      items: [makeItem({ visible: false })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).not.toContain('<path');
  });

  it('should render background color', () => {
    const svg = sceneToSvg({
      items: [],
      canvas: { width: 100, height: 100 },
      background: '#ffffff',
    });
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('should handle linear gradient fills', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'linearGradient',
              stops: [
                { offset: 0, color: '#000' },
                { offset: 1, color: '#fff' },
              ],
              from: { x: 0, y: 0 },
              to: { x: 100, y: 0 },
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('<stop');
    expect(svg).toContain('</defs>');
  });

  it('should handle opacity', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { opacity: 0.5 } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('opacity="0.5"');
  });

  it('should apply blend mode via mix-blend-mode style', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { blendMode: 'multiply' } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('mix-blend-mode:multiply');
  });

  it('should convert camelCase blend modes to hyphenated CSS keywords', () => {
    const cases: Array<[string, string]> = [
      ['colorDodge', 'color-dodge'],
      ['colorBurn', 'color-burn'],
      ['hardLight', 'hard-light'],
      ['softLight', 'soft-light'],
    ];
    for (const [blendMode, expected] of cases) {
      const svg = sceneToSvg({
        items: [makeItem({ style: { blendMode: blendMode as 'colorDodge' } })],
        canvas: { width: 100, height: 100 },
      });
      expect(svg).toContain(`mix-blend-mode:${expected}`);
    }
  });

  it('should render shadow as SVG filter', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: { shadow: { color: '#000', offsetX: 2, offsetY: 2, blur: 4 } },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<filter');
    expect(svg).toContain('feDropShadow');
  });

  it('should render blur as SVG filter', () => {
    const svg = sceneToSvg({
      items: [makeItem({ style: { blur: 5 } })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<filter');
    expect(svg).toContain('feGaussianBlur');
  });

  it('should handle radial gradient fill', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'radialGradient',
              stops: [
                { offset: 0, color: '#f00' },
                { offset: 1, color: '#00f' },
              ],
              center: { x: 50, y: 50 },
              radius: 50,
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<radialGradient');
    expect(svg).toContain('<stop');
  });

  it('should handle conic gradient fill (approximated)', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            fill: {
              type: 'conicGradient',
              stops: [
                { offset: 0, color: '#f00' },
                { offset: 1, color: '#0f0' },
              ],
              center: { x: 50, y: 50 },
            },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    // Conic gradient has no direct SVG equivalent — falls back to first stop color
    expect(svg).toContain('<path');
  });

  it('should apply clipPath', () => {
    const clipPath = new PathBuilder().moveTo(10, 10).lineTo(90, 10).lineTo(90, 90).lineTo(10, 90).close().build();
    const svg = sceneToSvg({
      items: [makeItem({ clipPath })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('clip-path="url(');
  });

  it('should render SceneGroup as <g> with children', () => {
    const svg = sceneToSvg({
      items: [
        {
          id: 'group1',
          children: [makeItem({ id: 'child1' }), makeItem({ id: 'child2' })],
          transform: [1, 0, 0, 1, 10, 20] as TransformMatrix,
          visible: true,
        },
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<g');
    expect(svg).toContain('</g>');
    const pathCount = (svg.match(/<path/g) || []).length;
    expect(pathCount).toBe(2);
  });

  it('should apply dashArray and dashOffset on stroke', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            stroke: { color: '#000', width: 2, cap: 'butt', join: 'miter', dashArray: [5, 3], dashOffset: 2 },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain('stroke-dashoffset="2"');
  });

  it('should omit transform attribute for identity matrix', () => {
    const svg = sceneToSvg({
      items: [makeItem({ transform: [1, 0, 0, 1, 0, 0] as TransformMatrix })],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).not.toContain('transform=');
  });

  it('should produce nested <g> elements for SceneGroup containing another SceneGroup', () => {
    const svg = sceneToSvg({
      items: [
        {
          id: 'outer',
          children: [
            {
              id: 'inner',
              children: [makeItem({ id: 'leaf' })],
              transform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
              visible: true,
            },
          ],
          transform: [1, 0, 0, 1, 5, 5] as TransformMatrix,
          visible: true,
        },
      ],
      canvas: { width: 100, height: 100 },
    });
    // Outer <g> with transform, inner <g> nested, single <path> inside
    expect(svg).toContain('transform="matrix(1 0 0 1 5 5)"');
    const gCount = (svg.match(/<g/g) || []).length;
    expect(gCount).toBe(2);
    const pathCount = (svg.match(/<path/g) || []).length;
    expect(pathCount).toBe(1);
  });

  it('should produce <clipPath> def and clip-path attribute on <g> for group with clipPath', () => {
    const clipPath = new PathBuilder().moveTo(0, 0).lineTo(50, 0).lineTo(50, 50).lineTo(0, 50).close().build();
    const svg = sceneToSvg({
      items: [
        {
          id: 'clipped-group',
          children: [makeItem({ id: 'inside' })],
          transform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
          visible: true,
          clipPath,
        },
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('<clipPath');
    expect(svg).toContain('clip-path="url(#clip-clipped-group)"');
    expect(svg).toContain('<defs>');
  });

  it('should produce opacity attribute on <g> for group with opacity', () => {
    const svg = sceneToSvg({
      items: [
        {
          id: 'opaque-group',
          children: [makeItem({ id: 'child' })],
          transform: [1, 0, 0, 1, 0, 0] as TransformMatrix,
          visible: true,
          opacity: 0.4,
        },
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('opacity="0.4"');
  });

  it('should not duplicate gradient defs when two items reference the same gradient ID', () => {
    const gradientFill = {
      type: 'linearGradient' as const,
      stops: [
        { offset: 0, color: '#000' },
        { offset: 1, color: '#fff' },
      ],
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
    };
    // Both items share the same id so they produce the same gradient id
    const svg = sceneToSvg({
      items: [
        makeItem({ id: 'shared', style: { fill: gradientFill } }),
        makeItem({ id: 'shared', style: { fill: gradientFill } }),
      ],
      canvas: { width: 100, height: 100 },
    });
    const gradCount = (svg.match(/<linearGradient/g) || []).length;
    expect(gradCount).toBe(1);
  });

  it('should produce valid SVG with no item children when scene is empty and has no background', () => {
    const svg = sceneToSvg({
      items: [],
      canvas: { width: 200, height: 150 },
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 200 150"');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('<path');
    expect(svg).not.toContain('<defs>');
    expect(svg).not.toContain('<rect');
  });

  it('should map all camelCase blend modes to hyphenated CSS keywords', () => {
    const cases: Array<[string, string]> = [
      ['normal', 'normal'],
      ['multiply', 'multiply'],
      ['screen', 'screen'],
      ['overlay', 'overlay'],
      ['darken', 'darken'],
      ['lighten', 'lighten'],
      ['colorDodge', 'color-dodge'],
      ['colorBurn', 'color-burn'],
      ['hardLight', 'hard-light'],
      ['softLight', 'soft-light'],
      ['difference', 'difference'],
      ['exclusion', 'exclusion'],
    ];
    for (const [blendMode, expected] of cases) {
      const svg = sceneToSvg({
        items: [makeItem({ style: { blendMode: blendMode as 'colorDodge' } })],
        canvas: { width: 100, height: 100 },
      });
      if (blendMode === 'normal') {
        // 'normal' is the default — style attribute should be omitted
        expect(svg).not.toContain('mix-blend-mode');
      } else {
        expect(svg).toContain(`mix-blend-mode:${expected}`);
      }
    }
  });

  it('should use shadow filter when item has both shadow and blur (shadow wins)', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            shadow: { color: '#000', offsetX: 3, offsetY: 3, blur: 6 },
            blur: 10,
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('feDropShadow');
    expect(svg).not.toContain('feGaussianBlur');
  });

  it('should produce fill="none" for item with stroke only and no fill', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({
          style: {
            stroke: { color: '#333', width: 1, cap: 'butt', join: 'miter' },
          },
        }),
      ],
      canvas: { width: 100, height: 100 },
    });
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#333"');
  });

  it('should produce separate filter defs for two items each with their own shadow', () => {
    const svg = sceneToSvg({
      items: [
        makeItem({ id: 'item-a', style: { shadow: { color: '#f00', offsetX: 1, offsetY: 1, blur: 2 } } }),
        makeItem({ id: 'item-b', style: { shadow: { color: '#00f', offsetX: 4, offsetY: 4, blur: 8 } } }),
      ],
      canvas: { width: 100, height: 100 },
    });
    const filterCount = (svg.match(/<filter/g) || []).length;
    expect(filterCount).toBe(2);
    expect(svg).toContain('id="shadow-item-a"');
    expect(svg).toContain('id="shadow-item-b"');
  });
});
