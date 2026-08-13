import { describe, expect, test } from 'bun:test';
import { pickReadableSurface, readabilitySignature, type SurfaceCandidate, type TextSample } from './readable-surface';

const LIGHT: SurfaceCandidate = { id: 'light', hex: '#ffffff' };
const DARK: SurfaceCandidate = { id: 'dark', hex: '#020617' };
const CANDIDATES = [LIGHT, DARK];

const s = (...hexes: string[]): TextSample[] => hexes.map((hex) => ({ hex }));

describe('pickReadableSurface', () => {
  test('no samples → leaves the surface alone', () => {
    const d = pickReadableSurface([], DARK, CANDIDATES);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('no-samples');
  });

  test('clearly-broken dark text on a dark surface → flips to light', () => {
    // #333 on near-black is ~1.66:1 (below trigger); on white it is ~12:1.
    const d = pickReadableSurface(s('#333333'), DARK, CANDIDATES);
    expect(d.surfaceId).toBe('light');
    expect(d.reason).toBe('switch');
    expect(d.minContrastBefore).toBeLessThan(2.0);
    expect(d.minContrastAfter).toBeGreaterThanOrEqual(3.0);
  });

  test('clearly-broken light text on a light surface → flips to dark (symmetry)', () => {
    const d = pickReadableSurface(s('#eeeeee'), LIGHT, CANDIDATES);
    expect(d.surfaceId).toBe('dark');
    expect(d.reason).toBe('switch');
  });

  test('already-readable text → no flip', () => {
    // white text on the dark surface is ~21:1.
    const d = pickReadableSurface(s('#ffffff'), DARK, CANDIDATES);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('already-readable');
  });

  test('mixed light+dark text broken on every surface → no flip', () => {
    // #333 is broken on white? no — but on dark it is broken; #ccc is broken on white.
    // No single surface lifts BOTH to targetMin, so we correctly leave it alone.
    const d = pickReadableSurface(s('#333333', '#cccccc'), DARK, CANDIDATES);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('no-improvement');
  });

  test('merely-mediocre (sub-AA but above trigger) text does NOT flip', () => {
    // A colour whose min contrast on the current surface is between triggerBelow (2.0) and
    // AA (4.5) must be left alone — the aid is not a WCAG enforcer.
    // #7a7a7a on white ≈ 3.7:1 (sub-AA, above trigger).
    const d = pickReadableSurface(s('#7a7a7a'), LIGHT, CANDIDATES);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('already-readable');
    expect(d.minContrastBefore).toBeGreaterThan(2.0);
    expect(d.minContrastBefore).toBeLessThan(4.5);
  });

  describe('hysteresis (original surface supplied)', () => {
    test('holds an active flip while the original is only marginally readable', () => {
      // Currently on the flipped LIGHT surface, original is DARK. Text #cbd5e1 reads well on
      // dark (~11:1)... use a colour that is above trigger on dark but below revertAbove.
      // #64748b on dark #020617 ≈ 4.0:1 (>trigger 2.0, <revert 4.5) → hold the flip.
      const d = pickReadableSurface(s('#64748b'), LIGHT, CANDIDATES, { original: DARK });
      expect(d.surfaceId).toBeNull();
      expect(d.reason).toBe('held-by-hysteresis');
    });

    test('reverts to the original once it is comfortably readable', () => {
      // On the flipped LIGHT surface, text #7a7a7a reads ~4.29:1 (above trigger, so not broken);
      // the original DARK surface gives it ~4.70:1 (≥ revertAbove 4.5) → revert to dark.
      const d = pickReadableSurface(s('#7a7a7a'), LIGHT, CANDIDATES, { original: DARK });
      expect(d.surfaceId).toBe('dark');
      expect(d.reason).toBe('switch');
      expect(d.minContrastAfter).toBeGreaterThanOrEqual(4.5);
    });
  });

  test('translucent text is judged per-surface (composited over each candidate)', () => {
    // 50%-black text: on the dark surface it renders ~dark-grey (broken), on white it renders
    // mid-grey (readable). A pre-composited-over-white sample would have hidden the dark breakage.
    const translucent: TextSample[] = [{ hex: '#000000', alpha: 0.5 }];
    const d = pickReadableSurface(translucent, DARK, CANDIDATES);
    expect(d.reason).toBe('switch');
    expect(d.surfaceId).toBe('light');
    // Fully-opaque behaviour is unchanged (alpha omitted === alpha 1).
    const opaque = pickReadableSurface([{ hex: '#000000' }], DARK, CANDIDATES);
    expect(opaque.surfaceId).toBe('light');
  });

  test('empty candidate list → no-improvement (never throws)', () => {
    const d = pickReadableSurface(s('#111111'), DARK, []);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('no-improvement');
  });

  test('best candidate equals current → no-improvement (never flips to itself)', () => {
    // Broken white-ish text on dark, but the only candidate is the current dark surface.
    const d = pickReadableSurface(s('#111111'), DARK, [DARK]);
    expect(d.surfaceId).toBeNull();
    expect(d.reason).toBe('no-improvement');
  });

  test('thresholds are overridable', () => {
    // Loosen the trigger so a mediocre case now flips.
    const d = pickReadableSurface(s('#7a7a7a'), LIGHT, CANDIDATES, {
      triggerBelow: 4.5,
      targetMin: 3.0,
      minImprovement: 1.0,
    });
    expect(d.surfaceId).toBe('dark');
    expect(d.reason).toBe('switch');
  });
});

describe('readabilitySignature', () => {
  test('is order-independent and de-duplicates', () => {
    expect(readabilitySignature(s('#111111', '#eeeeee'))).toBe(readabilitySignature(s('#eeeeee', '#111111')));
    expect(readabilitySignature(s('#111111', '#111111'))).toBe(readabilitySignature(s('#111111')));
  });

  test('distinguishes different content and different alpha', () => {
    expect(readabilitySignature(s('#111111'))).not.toBe(readabilitySignature(s('#222222')));
    expect(readabilitySignature([{ hex: '#111111', alpha: 0.5 }])).not.toBe(readabilitySignature(s('#111111')));
  });

  test('empty samples → empty signature', () => {
    expect(readabilitySignature([])).toBe('');
  });
});
