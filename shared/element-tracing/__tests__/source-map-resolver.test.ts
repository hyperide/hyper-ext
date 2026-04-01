import { describe, expect, it } from 'bun:test';
import { resolveInSourceMap, type SourceMapV3 } from '../source-map-resolver';

// ─── VLQ encoding helpers (for constructing test fixtures) ───────────────────

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  // Sign bit in bit 0; magnitude in remaining bits
  let sv = value < 0 ? (-value << 1) | 1 : value << 1;
  let result = '';
  do {
    let digit = sv & 31;
    sv >>= 5;
    if (sv > 0) digit |= 32; // continuation bit
    result += BASE64[digit];
  } while (sv > 0);
  return result;
}

function encodeSegment(fields: number[]): string {
  return fields.map(encodeVlq).join('');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveInSourceMap', () => {
  it('resolves single segment on line 1', () => {
    // Segment: genCol=0, srcIdx=0, srcLine=9 (0-based → line 10), srcCol=4 (0-based)
    const mappings = encodeSegment([0, 0, 9, 4]);
    const sm: SourceMapV3 = { sources: ['src/App.tsx'], mappings };

    const result = resolveInSourceMap(sm, 1, 1); // genLine=1, genCol=1 (1-based)
    expect(result).not.toBeNull();
    expect(result?.fileName).toBe('src/App.tsx');
    expect(result?.line).toBe(10); // 0-based srcLine 9 → 1-based line 10
    expect(result?.column).toBe(4); // stays 0-based
  });

  it('picks the segment closest to target column', () => {
    // Two segments on line 1:
    //   col 0: srcLine=0, srcCol=0
    //   col 10: srcLine=0, srcCol=50
    const seg1 = encodeSegment([0, 0, 0, 0]);
    const seg2 = encodeSegment([10, 0, 0, 50]);
    const sm: SourceMapV3 = { sources: ['src/App.tsx'], mappings: `${seg1},${seg2}` };

    // target genCol=15 → seg2 (col 10) is closest ≤ 15
    const r = resolveInSourceMap(sm, 1, 15);
    expect(r?.column).toBe(50);
  });

  it('picks the first segment when genCol=1 matches col 0', () => {
    const seg1 = encodeSegment([0, 0, 0, 0]);
    const seg2 = encodeSegment([10, 0, 0, 5]);
    const sm: SourceMapV3 = { sources: ['src/App.tsx'], mappings: `${seg1},${seg2}` };

    const r = resolveInSourceMap(sm, 1, 1); // genCol=1, 1-based → 0-based=0, seg1.col=0 ≤ 0 ✓
    expect(r?.column).toBe(0);
  });

  it('returns null when target line exceeds mappings', () => {
    const sm: SourceMapV3 = { sources: ['src/App.tsx'], mappings: encodeSegment([0, 0, 0, 0]) };
    expect(resolveInSourceMap(sm, 99, 1)).toBeNull();
  });

  it('returns null when no segment found on target line', () => {
    // Line 1 has segments, line 2 is empty
    const sm: SourceMapV3 = {
      sources: ['src/App.tsx'],
      mappings: `${encodeSegment([0, 0, 0, 0])};`,
    };
    expect(resolveInSourceMap(sm, 2, 1)).toBeNull();
  });

  it('handles multi-line mappings with delta encoding', () => {
    // Line 1: srcLine=0, srcCol=0  (absolute)
    // Line 2: srcLine delta=+5 → srcLine=5, srcCol delta=+2 → srcCol=2
    const line1 = encodeSegment([0, 0, 0, 0]);
    const line2 = encodeSegment([0, 0, 5, 2]); // deltas carried over from line 1
    const sm: SourceMapV3 = {
      sources: ['src/App.tsx'],
      mappings: `${line1};${line2}`,
    };

    const r = resolveInSourceMap(sm, 2, 1);
    expect(r?.line).toBe(6); // srcLine 0+5=5 → 1-based = 6
    expect(r?.column).toBe(2);
  });

  it('resolves correct source index when multiple sources exist', () => {
    // Segment: genCol=0, srcIdx=1, srcLine=2, srcCol=3
    const seg = encodeSegment([0, 1, 2, 3]);
    const sm: SourceMapV3 = {
      sources: ['first.tsx', 'second.tsx'],
      mappings: seg,
    };

    const r = resolveInSourceMap(sm, 1, 1);
    expect(r?.fileName).toBe('second.tsx');
  });

  it('strips file:// protocol from source paths', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = {
      sources: ['file:///Users/user/project/src/App.tsx'],
      mappings: seg,
    };

    const r = resolveInSourceMap(sm, 1, 1);
    expect(r?.fileName).toBe('Users/user/project/src/App.tsx');
  });

  it('strips webpack:// scheme from source paths', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = {
      sources: ['webpack://[project]/src/App.tsx'],
      mappings: seg,
    };

    const r = resolveInSourceMap(sm, 1, 1);
    expect(r?.fileName).toBe('src/App.tsx');
  });

  it('prepends sourceRoot when present', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = {
      sources: ['App.tsx'],
      sourceRoot: '/project/src',
      mappings: seg,
    };

    const r = resolveInSourceMap(sm, 1, 1);
    // sourceRoot + / + source = /project/src/App.tsx → strip leading /
    expect(r?.fileName).toBe('project/src/App.tsx');
  });

  it('returns null when sources array is empty', () => {
    const sm: SourceMapV3 = { sources: [], mappings: encodeSegment([0, 0, 0, 0]) };
    expect(resolveInSourceMap(sm, 1, 1)).toBeNull();
  });

  it('skips segments without source fields (1-field segments)', () => {
    // Two segments: first has no source fields, second has source fields
    const noSource = encodeVlq(0); // genCol=0 only (1 field)
    const withSource = encodeSegment([5, 0, 3, 2]); // genCol=5, srcIdx=0, srcLine=3, srcCol=2
    const sm: SourceMapV3 = {
      sources: ['src/App.tsx'],
      mappings: `${noSource},${withSource}`,
    };

    // genCol=6 should pick the withSource segment
    const r = resolveInSourceMap(sm, 1, 6);
    expect(r?.line).toBe(4); // 0-based 3 → 1-based 4
    expect(r?.column).toBe(2);
  });

  it('handles large column values (multi-digit VLQ)', () => {
    // genCol=1000 (requires multi-char VLQ encoding), srcLine=0, srcCol=500
    const seg = encodeSegment([1000, 0, 0, 500]);
    const sm: SourceMapV3 = { sources: ['src/App.tsx'], mappings: seg };

    const r = resolveInSourceMap(sm, 1, 1001); // 1001 is 1-based; 0-based=1000 ≤ 1000 ✓
    expect(r?.column).toBe(500);
  });
});

// ─── Indexed source map tests (sections format — Turbopack / Next.js) ─────────

describe('resolveInSourceMap — indexed (sections) format', () => {
  it('resolves position in indexed map with zero offset', () => {
    // Single section covering from line 0 (0-based)
    const seg = encodeSegment([0, 0, 9, 4]); // genCol=0, srcIdx=0, srcLine=9, srcCol=4
    const sm: SourceMapV3 = {
      sources: [],
      sections: [
        {
          offset: { line: 0, column: 0 },
          map: { sources: ['src/App.tsx'], mappings: seg },
        },
      ],
    };

    const r = resolveInSourceMap(sm, 1, 1); // genLine=1, genCol=1 (1-based)
    expect(r).not.toBeNull();
    expect(r?.fileName).toBe('src/App.tsx');
    expect(r?.line).toBe(10); // srcLine 9 (0-based) → 10 (1-based)
    expect(r?.column).toBe(4);
  });

  it('resolves position in indexed map with non-zero line offset (Turbopack style)', () => {
    // Section covers from 0-based line 4 (= generated line 5, 1-based).
    // Generated line 5 in outer = generated line 1 in inner map (offset.line=4, genLine=5: 5-4=1).
    const seg = encodeSegment([0, 0, 2, 7]); // srcLine=2 (0-based), srcCol=7
    const sm: SourceMapV3 = {
      sources: [],
      sections: [
        {
          offset: { line: 4, column: 0 },
          map: { sources: ['app/page.tsx'], mappings: seg },
        },
      ],
    };

    // genLine=5 (1-based) → inner line = 5 - 4 = 1
    const r = resolveInSourceMap(sm, 5, 1);
    expect(r).not.toBeNull();
    expect(r?.fileName).toBe('app/page.tsx');
    expect(r?.line).toBe(3); // srcLine 2 (0-based) → 3 (1-based)
    expect(r?.column).toBe(7);
  });

  it('picks the section with the largest offset preceding the target line', () => {
    const seg1 = encodeSegment([0, 0, 0, 0]); // srcLine=0, srcCol=0
    const seg2 = encodeSegment([0, 0, 10, 0]); // srcLine=10 (0-based), srcCol=0
    const sm: SourceMapV3 = {
      sources: [],
      sections: [
        { offset: { line: 0, column: 0 }, map: { sources: ['first.tsx'], mappings: seg1 } },
        { offset: { line: 5, column: 0 }, map: { sources: ['second.tsx'], mappings: seg2 } },
      ],
    };

    // genLine=6 (1-based) → genLine0=5 → section 2 (offset.line=5 ≤ 5)
    // inner line = 6 - 5 = 1 → seg2 maps to srcLine=10 in second.tsx
    const r = resolveInSourceMap(sm, 6, 1);
    expect(r?.fileName).toBe('second.tsx');
    expect(r?.line).toBe(11); // srcLine 10 (0-based) → 11 (1-based)
  });

  it('returns null when target line precedes all sections', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = {
      sources: [],
      sections: [
        {
          offset: { line: 10, column: 0 },
          map: { sources: ['app/page.tsx'], mappings: seg },
        },
      ],
    };

    // genLine=5 (1-based) → 0-based=4, offset=10 → 4 < 10 → no section found
    expect(resolveInSourceMap(sm, 5, 1)).toBeNull();
  });

  it('handles Turbopack file:// source paths via sections format', () => {
    // Turbopack source map with file:// absolute paths in the inner map
    const seg = encodeSegment([0, 0, 5, 0]); // srcLine=5 (0-based)
    const sm: SourceMapV3 = {
      sources: [],
      sections: [
        {
          offset: { line: 3, column: 0 },
          map: {
            sources: ['file:///Users/user/project/app/page.tsx'],
            mappings: seg,
          },
        },
      ],
    };

    // genLine=4 (1-based) → inner line = 4 - 3 = 1
    const r = resolveInSourceMap(sm, 4, 1);
    expect(r).not.toBeNull();
    expect(r?.line).toBe(6); // srcLine 5 (0-based) → 6 (1-based)
    // file:// paths → strip leading / → 'Users/user/project/app/page.tsx'
    expect(r?.fileName).toBe('Users/user/project/app/page.tsx');
  });

  it('returns null for indexed map with empty sections array', () => {
    const sm: SourceMapV3 = { sources: [], sections: [] };
    expect(resolveInSourceMap(sm, 1, 1)).toBeNull();
  });

  it('returns null for sections that use url form (no inline map)', () => {
    // Spec allows sections with `url` instead of `map`; we cannot resolve those without fetching
    const sm = {
      sources: [],
      sections: [{ offset: { line: 0, column: 0 } }], // no `map` field
    } as unknown as SourceMapV3;
    expect(resolveInSourceMap(sm, 1, 1)).toBeNull();
  });

  // Ensure existing flat-map tests still work when sections is absent
  it('still resolves flat map (mappings present, sections absent)', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = { sources: ['flat.tsx'], mappings: seg };
    const r = resolveInSourceMap(sm, 1, 1);
    expect(r?.fileName).toBe('flat.tsx');
  });
});
