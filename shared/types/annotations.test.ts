import { describe, expect, it } from 'bun:test';
import {
  type AnnotationElement,
  type ArrowAnnotation,
  generateAnnotationId,
  isArrowAnnotation,
  isTextAnnotation,
  type TextAnnotation,
} from './annotations';

const arrow: ArrowAnnotation = {
  id: 'a1',
  type: 'arrow',
  version: 1,
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 100,
  startBinding: null,
  endBinding: null,
  strokeColor: '#000',
  strokeWidth: 2,
};

const text: TextAnnotation = {
  id: 't1',
  type: 'text',
  version: 1,
  x: 50,
  y: 50,
  text: 'Hello',
  fontSize: 16,
  color: '#000',
};

describe('isArrowAnnotation', () => {
  it('returns true for arrow type', () => {
    expect(isArrowAnnotation(arrow)).toBe(true);
  });

  it('returns false for text type', () => {
    expect(isArrowAnnotation(text as AnnotationElement)).toBe(false);
  });
});

describe('isTextAnnotation', () => {
  it('returns true for text type', () => {
    expect(isTextAnnotation(text)).toBe(true);
  });

  it('returns false for arrow type', () => {
    expect(isTextAnnotation(arrow as AnnotationElement)).toBe(false);
  });
});

describe('generateAnnotationId', () => {
  it('returns a string starting with "ann-"', () => {
    const id = generateAnnotationId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('ann-')).toBe(true);
  });

  it('returns unique values on repeated calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateAnnotationId()));
    expect(ids.size).toBe(50);
  });
});
