import { describe, expect, test } from 'bun:test';
import { classifySurfaceText, collectReadabilitySamples, hasOwnBackground } from './readability-samples';

interface FakeStyle {
  backgroundColor?: string;
  backgroundImage?: string;
  color?: string;
  display?: string;
  visibility?: string;
  opacity?: string;
}

/**
 * Build a leaf-first element chain with per-node computed styles, no real DOM (the shared suite
 * runs under `bun test` with no jsdom). `getComputedStyle` resolves by node identity.
 */
function makeChain(styles: FakeStyle[]): Element {
  const view = {
    getComputedStyle: (node: unknown) => {
      const st = (node as { style: FakeStyle }).style;
      return {
        backgroundColor: st.backgroundColor ?? 'rgba(0, 0, 0, 0)',
        backgroundImage: st.backgroundImage ?? 'none',
        color: st.color ?? 'rgb(0, 0, 0)',
        display: st.display ?? 'block',
        visibility: st.visibility ?? 'visible',
        opacity: st.opacity ?? '1',
      };
    },
  };
  const doc = { defaultView: view };
  const nodes = styles.map((style) => ({ style, parentElement: null as unknown, ownerDocument: doc }));
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1];
  return nodes[0] as unknown as Element;
}

describe('hasOwnBackground', () => {
  test('true for an opaque background-color', () => {
    expect(hasOwnBackground(makeChain([{ backgroundColor: 'rgb(20, 20, 20)' }]))).toBe(true);
  });
  test('true for a background-image (gradient)', () => {
    expect(hasOwnBackground(makeChain([{ backgroundImage: 'linear-gradient(#fff, #000)' }]))).toBe(true);
  });
  test('false for a transparent root', () => {
    expect(hasOwnBackground(makeChain([{ backgroundColor: 'rgba(0, 0, 0, 0)' }]))).toBe(false);
  });
  test('false for a near-transparent background below the opaque threshold', () => {
    expect(hasOwnBackground(makeChain([{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }]))).toBe(false);
  });
});

describe('classifySurfaceText', () => {
  test('surface-backed dark text → sample with its computed colour', () => {
    // text element transparent, ancestor transparent → paintedBy null → surface-backed.
    const el = makeChain([
      { color: 'rgb(51, 51, 51)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      { backgroundColor: 'rgba(0, 0, 0, 0)' },
    ]);
    expect(classifySurfaceText(el)).toEqual({ hex: '#333333' });
  });

  test('badge exclusion: text on its own opaque backing → null (never in the decision set)', () => {
    // The "web" badge case: text sits on an element with a solid background.
    const badgeText = makeChain([
      { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(37, 99, 235)' },
      { backgroundColor: 'rgba(0, 0, 0, 0)' },
    ]);
    expect(classifySurfaceText(badgeText)).toBeNull();
  });

  test('hidden text (visibility:hidden) → null', () => {
    const el = makeChain([{ color: 'rgb(51, 51, 51)', visibility: 'hidden' }]);
    expect(classifySurfaceText(el)).toBeNull();
  });

  test('display:none text → null', () => {
    const el = makeChain([{ color: 'rgb(51, 51, 51)', display: 'none' }]);
    expect(classifySurfaceText(el)).toBeNull();
  });

  test('semi-transparent text keeps its straight colour + alpha (composited later, per-surface)', () => {
    const el = makeChain([{ color: 'rgba(0, 0, 0, 0.5)', backgroundColor: 'rgba(0, 0, 0, 0)' }]);
    const sample = classifySurfaceText(el);
    expect(sample).toEqual({ hex: '#000000', alpha: 0.5 });
  });

  test('effectively-invisible text (alpha ~0) → null (never a readability sample)', () => {
    // Fully transparent text composites to ~the surface on every candidate (contrast ≈ 1:1); if
    // sampled it would pin the decision and suppress a flip the visible text needs.
    expect(classifySurfaceText(makeChain([{ color: 'rgba(255, 255, 255, 0)' }]))).toBeNull();
    expect(classifySurfaceText(makeChain([{ color: 'rgba(0, 0, 0, 0.02)' }]))).toBeNull();
  });

  test('hidden ANCESTOR (display:none) excludes its text', () => {
    // text element itself is visible, but a wrapper is display:none → renders nothing.
    const el = makeChain([
      { color: 'rgb(51, 51, 51)', backgroundColor: 'rgba(0, 0, 0, 0)' },
      { display: 'none' },
    ]);
    expect(classifySurfaceText(el)).toBeNull();
  });
});

describe('collectReadabilitySamples', () => {
  test('short-circuits with no samples when the root paints its own background', () => {
    const root = makeChain([{ backgroundColor: 'rgb(255, 255, 255)' }]);
    expect(collectReadabilitySamples(root)).toEqual({ hasOwnBackground: true, samples: [] });
  });

  test('walks text nodes and de-duplicates colours (badge excluded)', () => {
    const view = {
      getComputedStyle: (node: unknown) => {
        const st = (node as { style: FakeStyle }).style;
        return {
          backgroundColor: st.backgroundColor ?? 'rgba(0, 0, 0, 0)',
          backgroundImage: 'none',
          color: st.color ?? 'rgb(0, 0, 0)',
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        };
      },
    };

    // Header (transparent root) with: "Sample title" + "Sign in" (surface-backed dark text)
    // and a "web" badge (own blue backing → excluded).
    const surfaceStyle: FakeStyle = { color: 'rgb(51, 51, 51)', backgroundColor: 'rgba(0, 0, 0, 0)' };
    const title = { style: surfaceStyle };
    const signIn = { style: surfaceStyle };
    const badge = { style: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(37, 99, 235)' } };
    const textNodes = [
      { nodeValue: 'Sample title', parentElement: title },
      { nodeValue: '   ', parentElement: title }, // whitespace-only → skipped
      { nodeValue: 'Sign in', parentElement: signIn },
      { nodeValue: 'web', parentElement: badge },
    ];
    for (const n of [title, signIn, badge]) (n as Record<string, unknown>).ownerDocument = { defaultView: view };

    let i = 0;
    const doc = {
      defaultView: view,
      createTreeWalker: () => ({ nextNode: () => textNodes[i++] ?? null }),
    };
    const root = { ownerDocument: doc, style: { backgroundColor: 'rgba(0, 0, 0, 0)' } } as unknown as Element;

    const result = collectReadabilitySamples(root);
    expect(result.hasOwnBackground).toBe(false);
    // Two surface-backed nodes share the same colour → de-duplicated to one; badge excluded.
    expect(result.samples).toEqual([{ hex: '#333333' }]);
  });

  test('keeps opaque and translucent same-RGB text as distinct samples (alpha in de-dup)', () => {
    const view = {
      getComputedStyle: (node: unknown) => {
        const st = (node as { style: FakeStyle }).style;
        return {
          backgroundColor: st.backgroundColor ?? 'rgba(0, 0, 0, 0)',
          backgroundImage: 'none',
          color: st.color ?? 'rgb(0, 0, 0)',
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        };
      },
    };

    // An opaque white label followed by a translucent white one (same RGB). Keying the de-dup on
    // hex alone would drop the translucent variant — the one actually unreadable on a dark canvas.
    const opaque = { style: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgba(0, 0, 0, 0)' } };
    const faint = { style: { color: 'rgba(255, 255, 255, 0.15)', backgroundColor: 'rgba(0, 0, 0, 0)' } };
    const textNodes = [
      { nodeValue: 'Opaque label', parentElement: opaque },
      { nodeValue: 'Faint label', parentElement: faint },
    ];
    for (const n of [opaque, faint]) (n as Record<string, unknown>).ownerDocument = { defaultView: view };

    let i = 0;
    const doc = {
      defaultView: view,
      createTreeWalker: () => ({ nextNode: () => textNodes[i++] ?? null }),
    };
    const root = { ownerDocument: doc, style: { backgroundColor: 'rgba(0, 0, 0, 0)' } } as unknown as Element;

    const result = collectReadabilitySamples(root);
    expect(result.samples).toEqual([{ hex: '#ffffff' }, { hex: '#ffffff', alpha: 0.15 }]);
  });
});
