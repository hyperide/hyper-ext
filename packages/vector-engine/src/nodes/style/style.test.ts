import { describe, expect, it } from 'bun:test';
import { PathBuilder } from '../../path/builder';
import type { NodeValue, StyleValue } from '../../types';
import { blendModeNode } from './blend-mode';
import { blurNode } from './blur';
import { fillNode } from './fill';
import { opacityNode } from './opacity';
import { shadowNode } from './shadow';
import { strokeNode } from './stroke';

describe('Fill node', () => {
  it('should output a style with solid fill', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = fillNode.execute({ path: { type: 'path', value: path } }, { fillType: 'solid', color: '#ff0000' });
    expect((result.path as NodeValue).type).toBe('path');
    expect((result.style as NodeValue).type).toBe('style');
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
  });

  it('should support linear gradient fill', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = fillNode.execute(
      { path: { type: 'path', value: path } },
      {
        fillType: 'linearGradient',
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.fill?.type).toBe('linearGradient');
    if (style.fill?.type === 'linearGradient') {
      expect(style.fill.stops).toHaveLength(2);
    }
  });

  it('should merge with incoming style (composition chaining)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { stroke: { color: '#000', width: 1, cap: 'butt', join: 'miter' } };
    const result = fillNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { fillType: 'solid', color: '#ff0000' },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(style.stroke).toBeDefined();
  });
});

describe('Stroke node', () => {
  it('should output a style with stroke', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = strokeNode.execute(
      { path: { type: 'path', value: path } },
      { color: '#000000', width: 2, cap: 'round', join: 'round' },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.stroke).toMatchObject({ color: '#000000', width: 2 });
  });

  it('should merge with incoming style (fill → stroke chain)', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { fill: { type: 'solid', color: '#ff0000' } };
    const result = strokeNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { color: '#000000', width: 2, cap: 'round', join: 'round' },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(style.stroke).toMatchObject({ color: '#000000', width: 2 });
  });
});

describe('Opacity node', () => {
  it('should output style with opacity value', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = opacityNode.execute({ path: { type: 'path', value: path } }, { value: 0.5 });
    expect((result.path as NodeValue).type).toBe('path');
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.opacity).toBe(0.5);
  });

  it('should merge with incoming style', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { fill: { type: 'solid', color: '#f00' } };
    const result = opacityNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { value: 0.7 },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.opacity).toBe(0.7);
    expect(style.fill).toBeDefined();
  });
});

describe('Shadow node', () => {
  it('should add shadow to style', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).lineTo(100, 100).lineTo(0, 100).close().build();
    const result = shadowNode.execute(
      {
        path: { type: 'path', value: rect },
        style: { type: 'style', value: { fill: { type: 'solid', color: '#ff0000' } } },
      },
      { color: '#000000', offsetX: 2, offsetY: 4, blur: 6 },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.shadow).toEqual({ color: '#000000', offsetX: 2, offsetY: 4, blur: 6 });
    expect(style.fill?.type).toBe('solid');
    expect((result.path as NodeValue).type).toBe('path');
  });

  it('should merge with incoming style', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { opacity: 0.8 };
    const result = shadowNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { color: '#00000080', offsetX: 0, offsetY: 2, blur: 4 },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.opacity).toBe(0.8);
    expect(style.shadow).toBeDefined();
  });
});

describe('Blur node', () => {
  it('should add blur to style', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).close().build();
    const result = blurNode.execute(
      {
        path: { type: 'path', value: rect },
        style: { type: 'style', value: {} },
      },
      { radius: 5 },
    );
    expect((result.style as NodeValue & { value: StyleValue }).value.blur).toBe(5);
    expect((result.path as NodeValue).type).toBe('path');
  });

  it('should preserve existing style properties', () => {
    const rect = new PathBuilder().moveTo(0, 0).lineTo(100, 0).close().build();
    const result = blurNode.execute(
      {
        path: { type: 'path', value: rect },
        style: { type: 'style', value: { opacity: 0.5 } },
      },
      { radius: 3 },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.opacity).toBe(0.5);
    expect(style.blur).toBe(3);
  });
});

describe('Blend mode node', () => {
  it('should output style with blend mode', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const result = blendModeNode.execute({ path: { type: 'path', value: path } }, { mode: 'multiply' });
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.blendMode).toBe('multiply');
  });

  it('should merge with incoming style', () => {
    const path = new PathBuilder().moveTo(0, 0).lineTo(10, 10).build();
    const incomingStyle: StyleValue = { stroke: { color: '#000', width: 2, cap: 'round', join: 'round' } };
    const result = blendModeNode.execute(
      {
        path: { type: 'path', value: path },
        style: { type: 'style', value: incomingStyle },
      },
      { mode: 'screen' },
    );
    const style = (result.style as NodeValue).value as StyleValue;
    expect(style.blendMode).toBe('screen');
    expect(style.stroke).toBeDefined();
  });
});
