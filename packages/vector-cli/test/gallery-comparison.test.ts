/**
 * Adversarial tests for the same comparator used by the real SVG gallery.
 * Last-bit path differences are allowed; semantic SVG and visible geometry changes are not.
 */
import { describe, expect, it } from 'bun:test';
import { gallerySvgMatches } from './gallery/svg-comparison';

const baseline =
  '<svg viewBox="0 0 128 128" width="128"><path d="M 0 -60 L 30.000000000000007 20 C 1 2 3 4 5 6 Q 7 8 9 10 Z" fill="#123456" stroke-width="2"/></svg>';

describe('gallery SVG comparison', () => {
  it('accepts identical bytes', () => {
    expect(gallerySvgMatches(baseline, baseline)).toBe(true);
  });

  it('accepts last-bit roundoff and near-zero scientific notation', () => {
    const actual = baseline.replace('30.000000000000007', '30.00000000000001').replace('M 0 ', 'M 3.67e-15 ');
    expect(gallerySvgMatches(actual, baseline)).toBe(true);
    expect(gallerySvgMatches(baseline, actual)).toBe(true);
  });

  it('uses a small relative allowance at larger coordinate scales', () => {
    const expected = baseline.replace('M 0 ', 'M 1000 ');
    expect(gallerySvgMatches(expected.replace('M 1000 ', 'M 1000.000000000005 '), expected)).toBe(true);
    expect(gallerySvgMatches(expected.replace('M 1000 ', 'M 1000.00000000002 '), expected)).toBe(false);
  });

  for (const [name, from, to] of [
    ['shape element', '<path', '<polygon'],
    ['command', ' L ', ' M '],
    ['command case', ' L ', ' l '],
    ['coordinate count', ' Z', ' 11 Z'],
    ['coordinate separator', 'L 30', 'L,30'],
    ['meaningful small shift', 'M 0 ', 'M 0.00000001 '],
    ['just outside absolute budget', 'M 0 ', 'M 2e-12 '],
    ['root geometry attribute', 'width="128"', 'width="128.00000000000001"'],
    ['viewBox', '0 0 128 128', '0 0 128 128.00000000000001'],
    ['paint attribute', '#123456', '#123457'],
    ['stroke attribute', 'stroke-width="2"', 'stroke-width="2.000000000000001"'],
    ['attribute name', 'fill=', 'data-fill='],
    ['additional attribute', '<path ', '<path id="1" '],
    ['XML structure', '/></svg>', '/><path d="M 0 0"/></svg>'],
    ['non-finite coordinate', 'M 0 ', 'M 1e999 '],
  ]) {
    it(`rejects a changed ${name}`, () => {
      expect(gallerySvgMatches(baseline.replace(from, to), baseline)).toBe(false);
    });
  }

  it('keeps text, metadata, comments and unsupported geometry strict', () => {
    for (const extra of [
      '<text>version 1.000000000000001</text>',
      '<!-- <path d="M 1.000000000000001 0"/> -->',
      '<metadata d="M 1.000000000000001 0"/>',
      '<path d="M 0 0 A 1.000000000000001 2 0 0 1 3 4"/>',
    ]) {
      const expected = baseline.replace('</svg>', `${extra}</svg>`);
      expect(gallerySvgMatches(expected.replace('1.000000000000001', '1.000000000000002'), expected)).toBe(false);
    }
  });
});
