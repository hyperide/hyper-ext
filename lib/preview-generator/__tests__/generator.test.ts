import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import {
  deriveUniquePrefix,
  generatePreviewContent,
  generateStandaloneEntry,
  PREVIEW_GENERATOR_SCHEMA_MARKER,
  type PreviewComponentEntry,
  type SSRMockConfig,
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

  it('should disambiguate platform-suffixed files (App.tsx vs App.web.tsx) via filename segments', () => {
    // Both at root: parent dir is '.', so parent-prefix gives RootApp for both → hasDupes.
    // Platform suffix in filename resolves it: App.web.tsx → AppWeb, App.tsx → App.
    const entries: PreviewComponentEntry[] = [makeEntry('App.tsx', 'App'), makeEntry('App.web.tsx', 'App')];
    const result = deriveUniquePrefix(entries);
    expect(result.get('App.tsx')).toBe('App');
    expect(result.get('App.web.tsx')).toBe('AppWeb');
    // Both must be valid JS identifiers
    for (const [, name] of result) {
      expect(name).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
  });

  it('should disambiguate same-directory files that export the same component name', () => {
    const entries: PreviewComponentEntry[] = [
      makeEntry('client/components/ui/toaster.tsx', 'Toaster'),
      makeEntry('client/components/ui/sonner.tsx', 'Toaster'),
    ];
    const result = deriveUniquePrefix(entries);
    expect(result.get('client/components/ui/toaster.tsx')).toBe('ComponentsUiToaster');
    expect(result.get('client/components/ui/sonner.tsx')).toBe('ComponentsUiSonner');
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

  it('should include the preview generator schema marker', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];
    const content = generatePreviewContent(entries);

    expect(content).toContain(PREVIEW_GENERATOR_SCHEMA_MARKER);
  });

  it('should include React Navigation fallback props', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/screens/ActivityDetailScreen.tsx',
        componentName: 'ActivityDetailScreen',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './screens/ActivityDetailScreen',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain('navigation: {');
    expect(content).toContain('route: {');
    expect(content).toContain('activityId: "preview-activity"');
  });

  it('should include fallback data for prop-required leaf components', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/PlaylistView.tsx',
        componentName: 'PlaylistView',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/PlaylistView',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain('const previewSong = {');
    expect(content).toContain('const previewPlaylist = {');
    expect(content).toContain('const previewProduct = {');
    expect(content).toContain('const previewListing = {');
    expect(content).toContain('const previewFilters = {');
    expect(content).toContain('const previewProject = {');
    expect(content).toContain('const previewData = previewChartData.map');
    expect(content).toContain('songs: [previewSong]');
    expect(content).toContain('playlist: previewPlaylist');
    expect(content).toContain('playerState: { currentSong: previewSong');
    expect(content).toContain('data: previewData');
    expect(content).toContain('path: [previewFileItem]');
    expect(content).toContain('product: previewProduct');
    expect(content).toContain('listing: previewListing');
    expect(content).toContain('filters: previewFilters');
    expect(content).toContain('project: previewProject');
    expect(content).toContain('tags: ["React", "TypeScript"]');
    expect(content).toContain('pickup: previewLocation');
    expect(content).toContain("popTo: (...args: unknown[]) => console.log('[Preview] navigation.popTo', args)");
    expect(content).toContain("onPlaySong: (value: unknown) => console.log('[Preview] onPlaySong', value)");
    expect(content).toContain("onSearchChange: (value: unknown) => console.log('[Preview] onSearchChange', value)");
    expect(content).toContain("onPlayPause: () => console.log('[Preview] onPlayPause')");
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

  it('should generate valid imports for same-directory files that export the same component name', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/toaster.tsx',
        componentName: 'Toaster',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/toaster',
      },
      {
        componentPath: 'client/components/ui/sonner.tsx',
        componentName: 'Toaster',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/sonner',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain("import { Toaster as ComponentsUiToaster } from './components/ui/toaster';");
    expect(content).toContain("import { Toaster as ComponentsUiSonner } from './components/ui/sonner';");
    expect(() =>
      parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }),
    ).not.toThrow();
  });

  it('should avoid aliases that collide with provider wrapper imports', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/Gallery.tsx',
        componentName: 'GalleryProvider',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/Gallery',
      },
    ];

    const content = generatePreviewContent(entries, {
      providerWrap: {
        imports: ["import { GalleryProvider, GalleryLightbox } from '@/components/Gallery';"],
        wrapOpen: '<GalleryProvider>',
        wrapClose: '<GalleryLightbox /></GalleryProvider>',
      },
    });

    expect(content).toContain("import { GalleryProvider as ComponentsGalleryProvider } from './components/Gallery';");
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

  it('includes generic context-shaped prop stubs (state, theme, i18n, etc.)', () => {
    const content = generatePreviewContent([makeEntry('src/components/BoardView.tsx', 'BoardView')]);

    // Each new stub key should be present in previewFallbackProps
    expect(content).toContain('dispatch:');
    expect(content).toContain('state: new Proxy(');
    expect(content).toContain('theme: new Proxy(');
    expect(content).toContain('i18n:');
    expect(content).toContain('session:');
    expect(content).toContain('auth:');
    expect(content).toContain('query:');
    expect(content).toContain('mutation:');
    expect(content).toContain('fetcher:');
    expect(content).toContain('intl:');

    // Existing store proxy must still be present
    expect(content).toContain('store: new Proxy(');

    // Output must still be valid TSX
    expect(() =>
      parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      }),
    ).not.toThrow();
  });

  it('provides calendar fallback props for standalone calendar components', () => {
    const content = generatePreviewContent([makeEntry('src/components/CalendarSidebar.tsx', 'CalendarSidebar')]);

    expect(content).toContain('const previewCalendars = [');
    expect(content).toContain('calendars: previewCalendars,');
    expect(content).toContain('currentDate: previewDate,');
    expect(content).toContain('selectedDate: previewDate,');
    expect(content).toContain('onDateSelect: (value: unknown) => console.log');
    expect(content).toContain('onToggleCalendar: (value: unknown) => console.log');
    expect(content).toContain('onCreateEvent: () => console.log');
  });
});

describe('generatePreviewContent — SSR mock (Remix)', () => {
  const ssrMock: SSRMockConfig = { framework: 'remix' };

  function makeSSREntry(path: string, name: string): PreviewComponentEntry {
    return {
      componentPath: path,
      componentName: name,
      exportStyle: 'default-named',
      sampleExports: [],
      importPath: `./${path.replace('app/routes/', '').replace('.tsx', '')}`,
      isSSRRoute: true,
    };
  }

  it('imports createMemoryRouter and RouterProvider from react-router-dom when SSR routes present', () => {
    const entry = makeSSREntry('app/routes/_index.tsx', 'Index');
    const content = generatePreviewContent([entry], { ssrMock });
    expect(content).toContain("import { createMemoryRouter, RouterProvider } from 'react-router-dom'");
  });

  it('emits ssrRouteSet with correct paths', () => {
    const entry = makeSSREntry('app/routes/explore.tsx', 'Explore');
    const content = generatePreviewContent([entry], { ssrMock });
    expect(content).toContain("'app/routes/explore.tsx'");
    expect(content).toContain('const ssrRouteSet = new Set<string>');
  });

  it('emits RemixMockWrapper function', () => {
    const entry = makeSSREntry('app/routes/_index.tsx', 'Index');
    const content = generatePreviewContent([entry], { ssrMock });
    expect(content).toContain('function RemixMockWrapper');
    expect(content).toContain('createMemoryRouter');
    expect(content).toContain('RouterProvider');
  });

  it('uses RemixMockWrapper in single-mode render when ssrRouteSet.has(componentPath)', () => {
    const entry = makeSSREntry('app/routes/_index.tsx', 'Index');
    const content = generatePreviewContent([entry], { ssrMock });
    expect(content).toContain('ssrRouteSet.has(componentPath)');
    expect(content).toContain('<RemixMockWrapper Component={Component} />');
  });

  it('does NOT import react-router-dom when no SSR route entries', () => {
    const entry = makeEntry('src/Button.tsx', 'Button');
    const content = generatePreviewContent([entry], { ssrMock });
    expect(content).not.toContain('react-router-dom');
    expect(content).not.toContain('RemixMockWrapper');
  });

  it('ssrRouteSet not emitted when no entries have isSSRRoute', () => {
    const entry = makeEntry('src/Button.tsx', 'Button');
    const content = generatePreviewContent([entry], { ssrMock });
    // ssrRouteSet is only emitted when there are actual SSR routes (avoids noUnusedLocals error)
    expect(content).not.toContain('ssrRouteSet');
    expect(content).not.toContain('RemixMockWrapper');
  });

  it('mixed entries: only SSR routes in ssrRouteSet', () => {
    const ssrEntry = makeSSREntry('app/routes/explore.tsx', 'Explore');
    const regularEntry = makeEntry('src/Button.tsx', 'Button');
    const content = generatePreviewContent([ssrEntry, regularEntry], { ssrMock });
    // ssrRouteSet contains the SSR route
    const ssrSetMatch = content.match(/const ssrRouteSet = new Set<string>\(\[([\s\S]*?)\]\)/);
    expect(ssrSetMatch).toBeTruthy();
    const ssrSetBody = ssrSetMatch?.[1] ?? '';
    expect(ssrSetBody).toContain("'app/routes/explore.tsx'");
    expect(ssrSetBody).not.toContain("'src/Button.tsx'");
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

describe('generatePreviewContent — missing-component signal', () => {
  it('includes _ComponentMissingSignal function in generated output', () => {
    const content = generatePreviewContent([makeEntry('src/Button.tsx', 'Button')], {});
    expect(content).toContain('_ComponentMissingSignal');
    expect(content).toContain('hypercanvas:componentMissing');
  });

  it('missing-component branch renders placeholder and fires _ComponentMissingSignal', () => {
    const content = generatePreviewContent([makeEntry('src/Button.tsx', 'Button')], {});
    // The branch should NOT contain raw "Error: Component not found"
    expect(content).not.toContain('Error: Component not found');
    // Should render a loading placeholder
    expect(content).toContain('Loading');
    // Should include the missing signal component
    expect(content).toContain('<_ComponentMissingSignal');
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
