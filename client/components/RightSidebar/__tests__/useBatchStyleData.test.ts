import { describe, expect, it } from 'bun:test';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import { MIXED, mergeStyleData } from '../hooks/useBatchStyleData';

describe('mergeStyleData', () => {
  it('returns single element styles unchanged', () => {
    const styles: Partial<ParsedStyles>[] = [{ backgroundColor: 'red', paddingTop: '16px' }];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.paddingTop).toBe('16px');
  });

  it('returns common values when all elements match', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red', paddingTop: '16px' },
      { backgroundColor: 'red', paddingTop: '16px' },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.paddingTop).toBe('16px');
  });

  it('returns MIXED for differing values', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red', paddingTop: '16px' },
      { backgroundColor: 'blue', paddingTop: '16px' },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe(MIXED);
    expect(result.paddingTop).toBe('16px');
  });

  it('returns empty object for empty input', () => {
    const result = mergeStyleData([]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('treats undefined and missing as equal', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red' },
      { backgroundColor: 'red', paddingTop: undefined },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.paddingTop).toBeUndefined();
  });

  it('marks as MIXED when one element has a value and another does not', () => {
    const styles: Partial<ParsedStyles>[] = [{ backgroundColor: 'red', width: '100px' }, { backgroundColor: 'red' }];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.width).toBe(MIXED);
  });

  it('handles object values (margin) with deep comparison', () => {
    const styles: Partial<ParsedStyles>[] = [
      { margin: { top: '8px', right: '0' } },
      { margin: { top: '8px', right: '0' } },
    ];
    const result = mergeStyleData(styles);
    expect(result.margin).toEqual({ top: '8px', right: '0' });
  });

  it('marks object values as MIXED when they differ', () => {
    const styles: Partial<ParsedStyles>[] = [{ margin: { top: '8px' } }, { margin: { top: '16px' } }];
    const result = mergeStyleData(styles);
    expect(result.margin).toBe(MIXED);
  });

  it('merges border properties — same values stay common', () => {
    const styles: Partial<ParsedStyles>[] = [
      { borderWidth: '1px', borderColor: '#000', borderStyle: 'solid' },
      { borderWidth: '1px', borderColor: '#000', borderStyle: 'solid' },
    ];
    const result = mergeStyleData(styles);
    expect(result.borderWidth).toBe('1px');
    expect(result.borderColor).toBe('#000');
    expect(result.borderStyle).toBe('solid');
  });

  it('marks border properties as MIXED when they differ', () => {
    const styles: Partial<ParsedStyles>[] = [
      { borderWidth: '1px', borderColor: '#000' },
      { borderWidth: '2px', borderColor: '#fff' },
    ];
    const result = mergeStyleData(styles);
    expect(result.borderWidth).toBe(MIXED);
    expect(result.borderColor).toBe(MIXED);
  });

  it('marks layoutType as MIXED when elements have different layouts', () => {
    const styles: Partial<ParsedStyles>[] = [{ layoutType: 'row' }, { layoutType: 'col' }];
    const result = mergeStyleData(styles);
    expect(result.layoutType).toBe(MIXED);
  });

  it('preserves layoutType when all elements have the same layout', () => {
    const styles: Partial<ParsedStyles>[] = [{ layoutType: 'row' }, { layoutType: 'row' }];
    const result = mergeStyleData(styles);
    expect(result.layoutType).toBe('row');
  });
});
