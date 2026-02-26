import { describe, expect, it } from 'bun:test';
import { type InstanceConfig, type InstancePosition, isInstanceConfig, toInstanceConfig } from './canvas';

describe('isInstanceConfig', () => {
  it('returns true when props key is present', () => {
    const instance: InstanceConfig = { x: 0, y: 0, props: { color: 'red' } };
    expect(isInstanceConfig(instance)).toBe(true);
  });

  it('returns false for InstancePosition (no props)', () => {
    const instance: InstancePosition = { x: 100, y: 200 };
    expect(isInstanceConfig(instance)).toBe(false);
  });

  it('returns true even with empty props', () => {
    const instance: InstanceConfig = { x: 0, y: 0, props: {} };
    expect(isInstanceConfig(instance)).toBe(true);
  });
});

describe('toInstanceConfig', () => {
  it('adds empty props to InstancePosition', () => {
    const position: InstancePosition = { x: 50, y: 75, width: 200, height: 100 };
    const config = toInstanceConfig(position);
    expect(config.props).toEqual({});
    expect(config.x).toBe(50);
    expect(config.y).toBe(75);
    expect(config.width).toBe(200);
    expect(config.height).toBe(100);
  });

  it('preserves existing InstanceConfig unchanged', () => {
    const config: InstanceConfig = { x: 10, y: 20, props: { label: 'test' } };
    const result = toInstanceConfig(config);
    expect(result).toBe(config); // same reference
  });
});
