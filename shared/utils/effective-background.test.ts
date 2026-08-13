import { describe, expect, test } from 'bun:test';
import {
  collectBackgroundLayers,
  computeEffectiveBackgroundColor,
  computeEffectiveBackgroundLayers,
} from './effective-background';

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

/**
 * Build a leaf-first chain whose fake `getComputedStyle` also reports `backgroundImage`, and
 * return every node so a test can assert WHICH node became `paintedBy`.
 */
function makeChainNodes(specs: { bg: string; bgImage?: string }[]): Element[] {
  const nodes = specs.map((s) => ({
    bg: s.bg,
    bgImage: s.bgImage ?? 'none',
    parentElement: null as unknown as Element | null,
  }));
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1] as unknown as Element;
  const view = {
    getComputedStyle: (node: unknown) => ({
      backgroundColor: (node as { bg: string }).bg,
      backgroundImage: (node as { bgImage: string }).bgImage,
    }),
  };
  for (const n of nodes) (n as Record<string, unknown>).ownerDocument = { defaultView: view };
  return nodes as unknown as Element[];
}

describe('computeEffectiveBackgroundLayers — paintedBy', () => {
  test('paintedBy is null when the whole cascade is transparent (surface-backed)', () => {
    const [leaf] = makeChainNodes([{ bg: 'rgba(0, 0, 0, 0)' }, { bg: 'rgba(0, 0, 0, 0)' }]);
    const result = computeEffectiveBackgroundLayers(leaf);
    expect(result.paintedBy).toBeNull();
    expect(result.hex).toBe('#ffffff');
  });

  test('paintedBy is the nearest opaque ancestor (the badge backing)', () => {
    const nodes = makeChainNodes([{ bg: 'rgba(0, 0, 0, 0)' }, { bg: 'rgb(37, 99, 235)' }, { bg: 'rgb(0, 0, 0)' }]);
    const result = computeEffectiveBackgroundLayers(nodes[0]);
    expect(result.paintedBy).toBe(nodes[1]);
    expect(result.hex).toBe('#2563eb');
  });

  test('paintedBy is the element itself when it has an opaque background', () => {
    const nodes = makeChainNodes([{ bg: 'rgb(20, 20, 20)' }]);
    const result = computeEffectiveBackgroundLayers(nodes[0]);
    expect(result.paintedBy).toBe(nodes[0]);
  });

  test('a background-image ancestor counts as opaque backing', () => {
    const nodes = makeChainNodes([
      { bg: 'rgba(0, 0, 0, 0)' },
      { bg: 'rgba(0, 0, 0, 0)', bgImage: 'linear-gradient(#fff, #000)' },
    ]);
    const result = computeEffectiveBackgroundLayers(nodes[0]);
    expect(result.paintedBy).toBe(nodes[1]);
  });

  test('a near-transparent background below the opaque threshold does not bottom the stack', () => {
    const nodes = makeChainNodes([{ bg: 'rgba(0, 0, 0, 0.5)' }, { bg: 'rgba(0, 0, 0, 0)' }]);
    const result = computeEffectiveBackgroundLayers(nodes[0]);
    expect(result.paintedBy).toBeNull();
  });

  test('a 90%-opaque layer still lets the layer below bleed into the colour (no early cut)', () => {
    // Regression guard: paintedBy marks the 90% layer, but `hex` must composite the FULL stack —
    // 90% red over black is #e60000, NOT 90% red over the white base (#ff1a1a).
    const nodes = makeChainNodes([{ bg: 'rgba(255, 0, 0, 0.9)' }, { bg: 'rgb(0, 0, 0)' }]);
    const result = computeEffectiveBackgroundLayers(nodes[0]);
    expect(result.paintedBy).toBe(nodes[0]);
    expect(result.hex).toBe('#e60000');
    expect(computeEffectiveBackgroundColor(nodes[0])).toBe('#e60000');
  });
});
