import { describe, expect, test } from 'bun:test';
import { collectBackgroundLayers, computeEffectiveBackgroundColor } from './effective-background';

/**
 * Build a minimal fake element chain (leaf-first) where each node reports a
 * `background-color`. Avoids a real DOM so the test runs under bun without jsdom.
 */
function makeChain(backgrounds: string[]): Element {
  const nodes = backgrounds.map((bg) => ({ bg, parentElement: null as unknown as Element | null }));
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].parentElement = nodes[i + 1] as unknown as Element;
  }
  const view = {
    getComputedStyle: (node: unknown) => ({ backgroundColor: (node as { bg: string }).bg }),
  };
  for (const n of nodes) {
    (n as Record<string, unknown>).ownerDocument = { defaultView: view };
  }
  return nodes[0] as unknown as Element;
}

describe('collectBackgroundLayers', () => {
  test('walks ancestors top-first', () => {
    const leaf = makeChain(['rgba(0, 0, 0, 0)', 'rgb(22, 24, 28)', 'rgb(0, 0, 0)']);
    expect(collectBackgroundLayers(leaf)).toEqual(['rgba(0, 0, 0, 0)', 'rgb(22, 24, 28)', 'rgb(0, 0, 0)']);
  });

  test('returns empty when no defaultView is reachable', () => {
    const orphan = { parentElement: null, ownerDocument: { defaultView: null } } as unknown as Element;
    expect(collectBackgroundLayers(orphan)).toEqual([]);
  });
});

describe('computeEffectiveBackgroundColor', () => {
  test('transparent leaf over a black page resolves to black (TweetComposer textarea)', () => {
    const leaf = makeChain(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)']);
    expect(computeEffectiveBackgroundColor(leaf)).toBe('#000000');
  });

  test('transparent leaf over a white page resolves to white', () => {
    const leaf = makeChain(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)']);
    expect(computeEffectiveBackgroundColor(leaf)).toBe('#ffffff');
  });

  test('opaque leaf wins regardless of ancestors', () => {
    const leaf = makeChain(['rgb(29, 155, 240)', 'rgb(0, 0, 0)']);
    expect(computeEffectiveBackgroundColor(leaf)).toBe('#1d9bf0');
  });

  test('fully transparent cascade falls back to the white canvas', () => {
    const leaf = makeChain(['transparent', 'rgba(0, 0, 0, 0)']);
    expect(computeEffectiveBackgroundColor(leaf)).toBe('#ffffff');
  });
});
