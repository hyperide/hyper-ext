import { describe, expect, it } from 'bun:test';
import { resolveInSourceMap, resolveMapSourcePath, type SourceMapV3 } from '../source-map-resolver';

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

  it('keeps absolute path for file:// protocol source paths', () => {
    const seg = encodeSegment([0, 0, 0, 0]);
    const sm: SourceMapV3 = {
      sources: ['file:///Users/user/project/src/App.tsx'],
      mappings: seg,
    };

    const r = resolveInSourceMap(sm, 1, 1);
    expect(r?.fileName).toBe('/Users/user/project/src/App.tsx');
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
    // file:// paths → keep absolute path (file:///abs/path → /abs/path)
    expect(r?.fileName).toBe('/Users/user/project/app/page.tsx');
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

describe('resolveMapSourcePath (HYP-1161)', () => {
  it('resolves a dot-relative bundle-map source against the module URL (/@fs/ dist → package src)', () => {
    // Ground truth (conloca): the prebuilt workspace-package bundle
    // /@fs/<abs>/packages/cms-spa/dist/ui-*.mjs maps to sources like
    // "../src/components/ui/Button.tsx" (relative to dist/). Taken verbatim that string
    // is a useless nodeRef; per the source-map spec it resolves against the module URL.
    expect(
      resolveMapSourcePath(
        '../src/components/ui/Button.tsx',
        'http://localhost:63310/@fs/Users/ultra/work/repo/packages/cms-spa/dist/ui-Cpvb8-tM.mjs',
      ),
    ).toBe('/@fs/Users/ultra/work/repo/packages/cms-spa/src/components/ui/Button.tsx');
  });

  it('resolves a basename-only source against the module directory (Vite transform maps, HYP-594)', () => {
    expect(resolveMapSourcePath('Hero.tsx', 'http://localhost:5173/src/components/Hero.tsx?t=123')).toBe(
      '/src/components/Hero.tsx',
    );
  });

  it('keeps root-absolute and full-URL sources as-is (origin stripped to pathname)', () => {
    expect(resolveMapSourcePath('/src/App.tsx', 'http://localhost:5173/src/main.tsx')).toBe('/src/App.tsx');
    expect(
      resolveMapSourcePath('/@fs/Users/x/mono/packages/ui/src/Card.tsx', 'http://localhost:5173/src/main.tsx'),
    ).toBe('/@fs/Users/x/mono/packages/ui/src/Card.tsx');
  });

  it('returns scheme-carrying sources (webpack://, vite-internal) unchanged', () => {
    expect(
      resolveMapSourcePath('webpack://_N_E/./src/page.tsx', 'http://localhost:3000/_next/static/chunks/p.js'),
    ).toBe('webpack://_N_E/./src/page.tsx');
  });

  it('falls back to the raw source when the base is not a URL', () => {
    expect(resolveMapSourcePath('../src/Button.tsx', 'not-a-url')).toBe('../src/Button.tsx');
  });
});

describe('resolveInSourceMap — baseUrl for ../-escaping bundle sources (HYP-1161)', () => {
  // Real conloca shape: prebuilt workspace-package bundle served via /@fs/…/dist/*.mjs,
  // map sources are dot-relative to dist/ ("../src/components/ui/Button.tsx").
  const CMS_SPA_MODULE = 'http://localhost:64658/@fs/Users/ultra/work/repo/packages/cms-spa/dist/ui-Cpvb8-tM.mjs';
  const CMS_SPA_MAP = `${CMS_SPA_MODULE}.map`;

  function bundleMap(): SourceMapV3 {
    // Single segment at gen line 1, gen col 0 → srcIdx 0, srcLine 42 (0-based → 43), srcCol 8.
    const mappings = encodeSegment([0, 0, 42, 8]);
    return { sources: ['../src/components/ui/Button.tsx'], mappings };
  }

  it('WITHOUT baseUrl: legacy behavior preserved (leading ../ stripped — PanelRouter server-map path)', () => {
    const r = resolveInSourceMap(bundleMap(), 1, 1);
    // The pre-HYP-1161 form: root-ambiguous, kept verbatim for callers with no base URL.
    expect(r?.fileName).toBe('src/components/ui/Button.tsx');
  });

  it('WITH the .map baseUrl: resolves the escape against the map URL per spec → canonical @fs/ path', () => {
    const r = resolveInSourceMap(bundleMap(), 1, 1, CMS_SPA_MAP);
    expect(r).toEqual({
      fileName: '@fs/Users/ultra/work/repo/packages/cms-spa/src/components/ui/Button.tsx',
      line: 43,
      column: 8,
    });
    // Editable per isEditableSourcePath → the click resolves to the element's OWN source
    // instead of collapsing to the host call-site.
  });

  it('WITH the module baseUrl (inline map): same canonicalization', () => {
    const r = resolveInSourceMap(bundleMap(), 1, 1, CMS_SPA_MODULE);
    expect(r?.fileName).toBe('@fs/Users/ultra/work/repo/packages/cms-spa/src/components/ui/Button.tsx');
  });

  it('WITH baseUrl: basename and root-relative sources are untouched by the new branch', () => {
    const basename: SourceMapV3 = { sources: ['HostField.tsx'], mappings: encodeSegment([0, 0, 66, 3]) };
    // Basename sources keep flowing to the caller's URL-dir prefix branch (HYP-594) —
    // resolveInSourceMap must NOT pre-resolve them.
    expect(resolveInSourceMap(basename, 1, 1, CMS_SPA_MAP)?.fileName).toBe('HostField.tsx');
    const rootRel: SourceMapV3 = { sources: ['src/app/App.tsx'], mappings: encodeSegment([0, 0, 9, 4]) };
    expect(resolveInSourceMap(rootRel, 1, 1, CMS_SPA_MAP)?.fileName).toBe('src/app/App.tsx');
  });
});
