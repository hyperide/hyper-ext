import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import {
  deriveUniquePrefix,
  generatePreviewContent,
  generateStandaloneEntry,
  type PreviewComponentEntry,
  sampleExportToKey,
} from '../generator';

describe('sampleExportToKey', () => {
  it('should convert SampleDefault to default', () => {
    expect(sampleExportToKey('SampleDefault')).toBe('default');
  });

  it('should convert SamplePrimary to primary', () => {
    expect(sampleExportToKey('SamplePrimary')).toBe('primary');
  });

  it('should convert SampleLargeCard to largeCard', () => {
    expect(sampleExportToKey('SampleLargeCard')).toBe('largeCard');
  });
});

describe('sampleExportToKey — edge cases', () => {
  it('should handle bare "Sample" prefix with no suffix', () => {
    // 'Sample' → '' (empty key)
    expect(sampleExportToKey('Sample')).toBe('');
  });

  it('should handle single char after prefix', () => {
    expect(sampleExportToKey('SampleX')).toBe('x');
  });
});

describe('deriveUniquePrefix', () => {
  it('should return component names as-is when no collisions', () => {
    const entries: PreviewComponentEntry[] = [
      makeEntry('src/components/Button.tsx', 'Button'),
      makeEntry('src/components/Card.tsx', 'Card'),
    ];
    const result = deriveUniquePrefix(entries);
    expect(result.get('src/components/Button.tsx')).toBe('Button');
    expect(result.get('src/components/Card.tsx')).toBe('Card');
  });

  it('should prefix with parent dir on collision', () => {
    const entries: PreviewComponentEntry[] = [
      makeEntry('src/ui/Button.tsx', 'Button'),
      makeEntry('src/form/Button.tsx', 'Button'),
    ];
    const result = deriveUniquePrefix(entries);
    expect(result.get('src/ui/Button.tsx')).toBe('UiButton');
    expect(result.get('src/form/Button.tsx')).toBe('FormButton');
  });

  it('should produce valid JS identifier when component is at root level', () => {
    // dirname('Button.tsx') = '.', basename('.') = '.' → prefix should NOT be '.Button'
    const entries: PreviewComponentEntry[] = [makeEntry('Button.tsx', 'Button'), makeEntry('src/Button.tsx', 'Button')];
    const result = deriveUniquePrefix(entries);
    // Both names should be valid JS identifiers (no dots, no leading numbers)
    for (const [, name] of result) {
      expect(name).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
  });

  it('should return empty map for empty input', () => {
    expect(deriveUniquePrefix([])).toEqual(new Map());
  });

  it('should escalate to grandparent prefix when parent dirs also collide', () => {
    const entries: PreviewComponentEntry[] = [
      makeEntry('packages/ui/components/Button.tsx', 'Button'),
      makeEntry('packages/admin/components/Button.tsx', 'Button'),
    ];
    const result = deriveUniquePrefix(entries);
    // Both have parent dir 'components' — should escalate to grandparent
    expect(result.get('packages/ui/components/Button.tsx')).toBe('UiComponentsButton');
    expect(result.get('packages/admin/components/Button.tsx')).toBe('AdminComponentsButton');
  });
});

describe('generatePreviewContent', () => {
  it('should generate valid TypeScript/TSX', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault', 'SamplePrimary'],
        importPath: './components/Button',
      },
    ];

    const content = generatePreviewContent(entries);

    // Should parse without errors
    expect(() =>
      parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }),
    ).not.toThrow();
  });

  it('should include all three maps', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault'],
        importPath: './components/Button',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain('componentRegistry');
    expect(content).toContain('sampleRenderMap');
    expect(content).toContain('sampleRenderersMap');
  });

  it('should generate named import for named export', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault'],
        importPath: './components/Button',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).toContain("import { Button, SampleDefault as ButtonSampleDefault } from './components/Button';");
  });

  it('should generate default import for default export with samples', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Card.tsx',
        componentName: 'Card',
        exportStyle: 'default-named',
        sampleExports: ['SampleDefault'],
        importPath: './components/Card',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).toContain("import Card, { SampleDefault as CardSampleDefault } from './components/Card';");
  });

  it('should generate default-only import when no samples', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Icon.tsx',
        componentName: 'Icon',
        exportStyle: 'default-named',
        sampleExports: [],
        importPath: './components/Icon',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).toContain("import Icon from './components/Icon';");
  });

  it('should generate empty sampleRenderersMap entry for components without samples', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Icon.tsx',
        componentName: 'Icon',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/Icon',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).toContain("'src/components/Icon.tsx': {},");
  });

  it('should include callbackStubs', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];
    const content = generatePreviewContent(entries);
    expect(content).toContain('callbackStubs');
    expect(content).toContain("onClick: () => console.log('[Preview] onClick')");
  });

  it('should handle name collisions with proper import renaming', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/ui/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault'],
        importPath: './ui/Button',
      },
      {
        componentPath: 'src/form/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault'],
        importPath: './form/Button',
      },
    ];

    const content = generatePreviewContent(entries);

    // Should have disambiguated names using `as` rename
    expect(content).toContain(
      "import { Button as UiButton, SampleDefault as UiButtonSampleDefault } from './ui/Button';",
    );
    expect(content).toContain(
      "import { Button as FormButton, SampleDefault as FormButtonSampleDefault } from './form/Button';",
    );

    // Should still be valid TSX
    expect(() =>
      parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }),
    ).not.toThrow();
  });

  it('should generate Next.js pages router variant', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];

    const content = generatePreviewContent(entries, { isNextPagesRouter: true });
    expect(content).toContain("import { useRouter } from 'next/router';");
    expect(content).toContain('const router = useRouter()');
    expect(content).toContain('router.query.component');
  });

  it('should use URLSearchParams in default mode (inside useEffect, not top-level)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];

    const content = generatePreviewContent(entries);
    // URLSearchParams must be inside useEffect to avoid SSR "window is not defined" in Next.js
    const useEffectIndex = content.indexOf('useEffect');
    const urlParamsIndex = content.indexOf('new URLSearchParams(window.location.search)');
    expect(urlParamsIndex).toBeGreaterThan(-1);
    expect(urlParamsIndex).toBeGreaterThan(useEffectIndex);
    expect(content).not.toContain('useRouter');
    // Props interface present so Next.js App Router route can pass component/mode
    expect(content).toContain('interface CanvasPreviewProps');
  });

  it('should generate sampleRenderersMap with all variants', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Button.tsx',
        componentName: 'Button',
        exportStyle: 'named',
        sampleExports: ['SampleDefault', 'SamplePrimary', 'SampleDisabled'],
        importPath: './components/Button',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).toContain("'default': ButtonSampleDefault,");
    expect(content).toContain("'primary': ButtonSamplePrimary,");
    expect(content).toContain("'disabled': ButtonSampleDisabled,");
  });

  it('wraps required-prop components before putting them into the preview registry', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Tweet.tsx',
        componentName: 'Tweet',
        exportStyle: 'default-named',
        sampleExports: [],
        importPath: './components/Tweet',
      },
      {
        componentPath: 'src/components/UserSuggestion.tsx',
        componentName: 'UserSuggestion',
        exportStyle: 'default-named',
        sampleExports: [],
        importPath: './components/UserSuggestion',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain('type PreviewComponent = React.ComponentType<Record<string, unknown>>;');
    expect(content).toContain('function toPreviewComponent<P>(');
    expect(content).toContain("'src/components/Tweet.tsx': toPreviewComponent(Tweet),");
    expect(content).toContain("'src/components/UserSuggestion.tsx': toPreviewComponent(UserSuggestion),");
  });
});

describe('generateStandaloneEntry', () => {
  it('generates standalone entry with createRoot and PreviewWrapper', () => {
    const content = generateStandaloneEntry([makeEntry('src/Button.tsx', 'Button')], '../.hyperide/preview');
    expect(content).toContain('createRoot');
    expect(content).toContain('PreviewWrapper');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('componentRegistry');
    expect(content).toContain("document.getElementById('root')");
    expect(content).toContain('<CanvasPreview />');
  });
});

function makeEntry(path: string, name: string): PreviewComponentEntry {
  return {
    componentPath: path,
    componentName: name,
    exportStyle: 'named',
    sampleExports: [],
    importPath: `./${path.replace('src/', '').replace('.tsx', '')}`,
  };
}
