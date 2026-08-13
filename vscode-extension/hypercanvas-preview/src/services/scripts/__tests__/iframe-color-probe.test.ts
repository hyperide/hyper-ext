/**
 * HYP-544 Phase 3 — empirical color-probe unit tests.
 *
 * Two layers:
 *  1. PURE logic (no DOM): rgb-normalize equality + candidate ranking. Runs anywhere.
 *  2. The Tier-1 off-screen-clone probe mechanism, under happy-dom (the root `bun test`
 *     preload provides `document`/`getComputedStyle`). happy-dom resolves inline styles,
 *     class-rule cascade, and CSS vars in getComputedStyle (verified) — so we can prove the
 *     CLONE + measure mechanism with a controlled fixture stylesheet. It is NOT a real
 *     cascade engine and does not ship Tailwind CSS; the real-Tailwind path is proven only
 *     by Docker e2e (real Chromium). These unit tests prove the mechanism, not the cascade.
 */
import { describe, expect, test } from 'bun:test';

import {
  normalizeColor,
  colorsEqual,
  rankCandidates,
  detectColorCandidates,
  probeDrivingCandidates,
  type ColorCandidate,
} from '../iframe-color-probe';

describe('normalizeColor (rgb equality crux — HYP-544 Phase 3)', () => {
  test('hex 6-digit → rgb tuple', () => {
    expect(normalizeColor('#dc2626')).toBe('rgb(220, 38, 38)');
  });
  test('hex 3-digit shorthand expands', () => {
    expect(normalizeColor('#f00')).toBe('rgb(255, 0, 0)');
  });
  test('rgb() passes through canonicalized (spaces normalized)', () => {
    expect(normalizeColor('rgb(220,38,38)')).toBe('rgb(220, 38, 38)');
    expect(normalizeColor('rgb( 220 , 38 , 38 )')).toBe('rgb(220, 38, 38)');
  });
  test('rgba() with full alpha collapses to rgb', () => {
    expect(normalizeColor('rgba(220, 38, 38, 1)')).toBe('rgb(220, 38, 38)');
  });
  test('rgba() with partial alpha kept as rgba', () => {
    expect(normalizeColor('rgba(220, 38, 38, 0.5)')).toBe('rgba(220, 38, 38, 0.5)');
  });
  test('unparseable / color-mix / oklch → null (treated as no-match, §10)', () => {
    expect(normalizeColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(normalizeColor('oklch(0.7 0.15 30)')).toBeNull();
    expect(normalizeColor('')).toBeNull();
  });
});

describe('colorsEqual (normalized tuple comparison)', () => {
  test('hex request equals browser-reported rgb', () => {
    expect(colorsEqual('#dc2626', 'rgb(220, 38, 38)')).toBe(true);
  });
  test('different colors are not equal', () => {
    expect(colorsEqual('#dc2626', 'rgb(37, 99, 235)')).toBe(false);
  });
  test('rgba full-alpha equals rgb', () => {
    expect(colorsEqual('rgba(0, 0, 0, 1)', 'rgb(0, 0, 0)')).toBe(true);
  });
  test('non-normalizable on either side → false (no-match, falls to §7 floor)', () => {
    expect(colorsEqual('color-mix(in srgb, red, blue)', 'rgb(1, 2, 3)')).toBe(false);
    expect(colorsEqual('#dc2626', 'oklch(0.7 0.15 30)')).toBe(false);
  });
});

describe('rankCandidates (§4 rank order)', () => {
  test('Tailwind class first, then inline, then var, then hashed/module', () => {
    const cands: ColorCandidate[] = [
      { kind: 'module-class', token: 'card_abc', locationHint: 'class' },
      { kind: 'css-var', token: '--brand', locationHint: 'computed' },
      { kind: 'inline-style', token: '#1e40af', locationHint: 'style.backgroundColor' },
      { kind: 'tailwind-class', token: 'bg-blue-600', locationHint: 'class' },
    ];
    const ranked = rankCandidates(cands).map((c) => c.kind);
    expect(ranked).toEqual(['tailwind-class', 'inline-style', 'css-var', 'module-class']);
  });
  test('stable within the same kind (preserves detection order)', () => {
    const cands: ColorCandidate[] = [
      { kind: 'tailwind-class', token: 'bg-blue-600', locationHint: 'class' },
      { kind: 'tailwind-class', token: 'bg-sky-500', locationHint: 'class' },
    ];
    expect(rankCandidates(cands).map((c) => c.token)).toEqual(['bg-blue-600', 'bg-sky-500']);
  });
});

// ---- DOM-backed mechanism tests (happy-dom, root preload) ----

function makeStylesheet(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

describe('detectColorCandidates (§4) — DOM enumeration', () => {
  test('detects a Tailwind bg-* class matching the conflict prefix', () => {
    const el = document.createElement('div');
    el.className = 'p-2 bg-blue-600 text-white';
    document.body.appendChild(el);
    const cands = detectColorCandidates(el, ['bg-'], 'backgroundColor');
    expect(cands.some((c) => c.kind === 'tailwind-class' && c.token === 'bg-blue-600')).toBe(true);
    expect(cands.some((c) => c.token === 'p-2')).toBe(false);
    expect(cands.some((c) => c.token === 'text-white')).toBe(false);
  });

  test('detects an arbitrary-value Tailwind class bg-[#1e40af]', () => {
    const el = document.createElement('div');
    el.className = 'bg-[#1e40af]';
    document.body.appendChild(el);
    const cands = detectColorCandidates(el, ['bg-'], 'backgroundColor');
    expect(cands.some((c) => c.kind === 'tailwind-class' && c.token === 'bg-[#1e40af]')).toBe(true);
  });

  test('detects an inline style color', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(30, 64, 175)';
    document.body.appendChild(el);
    const cands = detectColorCandidates(el, ['bg-'], 'backgroundColor');
    expect(cands.some((c) => c.kind === 'inline-style')).toBe(true);
  });

  test('detects a CSS custom property the element reads via var()', () => {
    makeStylesheet(':root { --brand: rgb(30, 64, 175); }');
    const el = document.createElement('div');
    el.style.backgroundColor = 'var(--brand)';
    document.body.appendChild(el);
    const cands = detectColorCandidates(el, ['bg-'], 'backgroundColor');
    expect(cands.some((c) => c.kind === 'css-var' && c.token === '--brand')).toBe(true);
  });
});

describe('probeDrivingCandidates (§5.1 Tier-1 off-screen clone) — mechanism under happy-dom', () => {
  test('identifies the inline-style candidate that drives backgroundColor to the requested red', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(30, 64, 175)'; // blue baseline
    document.body.appendChild(el);

    const candidates: ColorCandidate[] = [
      { kind: 'inline-style', token: 'rgb(30, 64, 175)', locationHint: 'style.backgroundColor' },
    ];
    const driving = probeDrivingCandidates(el, candidates, '#dc2626', 'backgroundColor');
    expect(driving.length).toBe(1);
    expect(driving[0].kind).toBe('inline-style');
  });

  test('identifies the class candidate that drives the color via cascade (rule swap)', () => {
    makeStylesheet(
      '.blue-card { background-color: rgb(30, 64, 175); } .red-req { background-color: rgb(220, 38, 38); }',
    );
    const el = document.createElement('div');
    el.className = 'blue-card';
    document.body.appendChild(el);

    // The probe swaps the candidate class for a request-class that paints the requested red.
    const candidates: ColorCandidate[] = [{ kind: 'tailwind-class', token: 'blue-card', locationHint: 'class' }];
    const driving = probeDrivingCandidates(el, candidates, '#dc2626', 'backgroundColor', {
      requestClass: 'red-req',
    });
    expect(driving.map((c) => c.token)).toEqual(['blue-card']);
  });

  test('identifies a css-var candidate that drives the color when overridden', () => {
    makeStylesheet(':root { --brand: rgb(30, 64, 175); }');
    const el = document.createElement('div');
    el.style.backgroundColor = 'var(--brand)';
    document.body.appendChild(el);

    const candidates: ColorCandidate[] = [{ kind: 'css-var', token: '--brand', locationHint: 'computed' }];
    const driving = probeDrivingCandidates(el, candidates, '#dc2626', 'backgroundColor');
    expect(driving.map((c) => c.token)).toEqual(['--brand']);
  });

  test('a non-driving candidate is rejected (baseline already equals would-be value)', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(220, 38, 38)'; // already red
    document.body.appendChild(el);
    // Candidate is the already-red inline; applying the requested red does not CHANGE it → not "driving".
    const candidates: ColorCandidate[] = [
      { kind: 'inline-style', token: 'rgb(220, 38, 38)', locationHint: 'style.backgroundColor' },
    ];
    const driving = probeDrivingCandidates(el, candidates, '#dc2626', 'backgroundColor');
    expect(driving.length).toBe(0);
  });

  test('caps at 8 candidates', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(30, 64, 175)';
    document.body.appendChild(el);
    const many: ColorCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'inline-style' as const,
      token: `rgb(${i}, 0, 0)`,
      locationHint: 'style.backgroundColor',
    }));
    // none of these is the real driver except via the inline-apply path; assert the probe doesn't iterate >8.
    const driving = probeDrivingCandidates(el, many, '#dc2626', 'backgroundColor');
    // Each inline candidate, when applied as requested, sets the bg to red → all 8 probed "drive".
    expect(driving.length).toBeLessThanOrEqual(8);
  });

  test('the real preview node is never mutated (probe uses a detached clone)', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(30, 64, 175)';
    document.body.appendChild(el);
    const before = el.style.backgroundColor;
    const childCountBefore = document.body.childElementCount;
    probeDrivingCandidates(
      el,
      [{ kind: 'inline-style', token: 'rgb(30, 64, 175)', locationHint: 'style.backgroundColor' }],
      '#dc2626',
      'backgroundColor',
    );
    expect(el.style.backgroundColor).toBe(before); // real node untouched
    expect(document.body.childElementCount).toBe(childCountBefore); // off-screen container cleaned up
  });
});
