import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import {
  deriveUniquePrefix,
  generatePreviewContent,
  generateStandaloneEntry,
  isUiPrimitive,
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

  it('should advance the schema marker version so stale already-generated files regenerate (HYP-463)', () => {
    // The @ts-nocheck format change must bump the marker; otherwise the fast path in
    // PreviewFileManager.ensureComponent treats existing (still-erroring) files as
    // current and never rewrites them with @ts-nocheck.
    const versionMatch = PREVIEW_GENERATOR_SCHEMA_MARKER.match(/-v(\d+)$/);
    expect(versionMatch).not.toBeNull();
    expect(Number(versionMatch?.[1])).toBeGreaterThanOrEqual(12);
  });

  it('should emit @ts-nocheck as the very first line so the generated artifact opts out of the user build (HYP-463)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];
    const content = generatePreviewContent(entries);

    // @ts-nocheck only applies file-wide when it is the first line. The schema
    // marker must follow it (still present, still its own line for detection).
    expect(content.split('\n')[0]).toBe('// @ts-nocheck');
    expect(content).toContain(PREVIEW_GENERATOR_SCHEMA_MARKER);
  });

  it('should keep @ts-nocheck on line 1 for the standalone entry too (HYP-463)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];
    const content = generateStandaloneEntry(entries, '../.hyperide/preview');

    expect(content.split('\n')[0]).toBe('// @ts-nocheck');
    // The standalone bootstrap carries the @hyperide-managed marker.
    expect(content).toContain('@hyperide-managed');
  });

  it('should mark ErrorBoundary lifecycle methods with override (noImplicitOverride, HYP-463)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Button.tsx', 'Button')];
    const content = generatePreviewContent(entries);

    expect(content).toContain('override componentDidCatch(');
    expect(content).toContain('override componentDidUpdate(');
    expect(content).toContain('override render()');
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

  describe('HYP-465 — fallback-props filtering by declared prop names', () => {
    it('emits declaredPropNamesMap and the filterFallback helper', () => {
      const entries: PreviewComponentEntry[] = [
        {
          componentPath: 'packages/ui/Button.tsx',
          componentName: 'Button',
          exportStyle: 'named',
          sampleExports: [],
          importPath: './ui/Button',
          declaredPropNames: ['variant', 'children', 'className'],
        },
      ];
      const content = generatePreviewContent(entries);
      expect(content).toContain('const declaredPropNamesMap: Record<string, string[]> = {');
      expect(content).toContain('\'packages/ui/Button.tsx\': ["variant", "children", "className"],');
      expect(content).toContain('function filterFallback(path: string): Record<string, unknown> {');
      expect(content).toContain('if (!declared) return previewFallbackProps;');
      // HYP-465 nit: own-property test, not `k in …`, so a declared prop named
      // `toString`/`hasOwnProperty` can't pull Object.prototype's inherited fn.
      expect(content).toContain('Object.prototype.hasOwnProperty.call(previewFallbackProps, k)');
      expect(content).not.toContain('if (k in previewFallbackProps)');
    });

    it('spreads filterFallback(componentPath) — not the raw blob — at all three render sites', () => {
      const entries: PreviewComponentEntry[] = [makeEntry('packages/ui/Button.tsx', 'Button')];
      const content = generatePreviewContent(entries);
      // single mode (generatedProps still spread LAST and unfiltered)
      expect(content).toContain('<Component {...filterFallback(componentPath)} {...generatedProps} />');
      // multi mode (no SampleComponent)
      expect(content).toContain('<Component {...filterFallback(componentPath)} />');
      // multi-merged (instance props still spread LAST and unfiltered)
      expect(content).toContain('const mergedProps = { ...filterFallback(componentPath), ...props };');
      // the raw blob must no longer be spread directly onto a Component
      expect(content).not.toContain('<Component {...previewFallbackProps}');
      expect(content).not.toContain('...previewFallbackProps, ...props');
    });

    it('omits a declaredPropNamesMap entry when prop names are unknown (no filtering)', () => {
      // declaredPropNames undefined = member-access/HOC/no-params → absent from map → full blob
      const entries: PreviewComponentEntry[] = [makeEntry('packages/ui/Dashboard.tsx', 'Dashboard')];
      const content = generatePreviewContent(entries);
      expect(content).not.toContain("'packages/ui/Dashboard.tsx': [");
    });

    it('emits an empty array for a rest-only / empty destructure', () => {
      const entries: PreviewComponentEntry[] = [
        {
          componentPath: 'packages/ui/Passthrough.tsx',
          componentName: 'Passthrough',
          exportStyle: 'named',
          sampleExports: [],
          importPath: './ui/Passthrough',
          declaredPropNames: [],
        },
      ];
      const content = generatePreviewContent(entries);
      expect(content).toContain("'packages/ui/Passthrough.tsx': [],");
    });

    it('keeps the generated file valid TS/TSX', () => {
      const entries: PreviewComponentEntry[] = [
        {
          componentPath: 'packages/ui/Button.tsx',
          componentName: 'Button',
          exportStyle: 'named',
          sampleExports: [],
          importPath: './ui/Button',
          declaredPropNames: ['variant', 'children', 'className'],
        },
      ];
      const content = generatePreviewContent(entries);
      expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
    });
  });

  describe('app-mode route driver (preview-as-app navigation)', () => {
    const APP_ENTRY: PreviewComponentEntry = {
      componentPath: 'src/App',
      componentName: 'App',
      exportStyle: 'default-named',
      sampleExports: [],
      importPath: './App',
      isAppEntry: true,
    };

    it('emits the strategy-aware navigation primitive and keeps the file valid TS/TSX', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // The strategy-aware primitive + its three branches must be present.
      expect(content).toContain('function _hyperApplyRoute(');
      expect(content).toContain('function _hyperNavStrategy(');
      expect(content).toContain('__hyperOriginalPushState'); // history-bridge: original (un-prefixing) push
      expect(content).toContain('strategy === "basename"'); // basename branch
      // The app entry is registered so app-mode renders it raw.
      expect(content).toContain("const appEntrySet = new Set<string>([\n  'src/App',\n]);");
      // Generated source must still parse.
      expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
    });

    it('routes both the persistent listener and the React effect through _hyperApplyRoute', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // Both navigation paths delegate to the shared primitive (no hardcoded raw pushState left).
      const applyCalls = content.split('_hyperApplyRoute(route)').length - 1;
      expect(applyCalls).toBeGreaterThanOrEqual(2);
    });

    it('CACHES the nav strategy so it survives the boot route rewrite (query-string drop)', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // _driveInitialAppRoute navigates immediately and drops `?nav=`; the strategy must be memoized
      // on a window global before that, so a later navigate (e.g. basename) doesn't fall back to
      // history-bridge. The driver reads/writes `__hyperNavStrategy`.
      expect(content).toContain('__hyperNavStrategy');
      expect(content).toContain('if (w.__hyperNavStrategy) return w.__hyperNavStrategy;');
    });

    it('the boot driver only drives off the mount path — it does not shove a navigated route back to /', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // _driveInitialAppRoute must NO-OP when the app is already on a real route (a remount/HMR after
      // the user navigated to /settings must not reset to "/"). It only drives "/" from the
      // /test-preview mount path (or the unprefixed root).
      expect(content).toContain('const onMountPath =');
      expect(content).toContain('path.indexOf("/test-preview") === 0');
      expect(content).toContain('if (onMountPath) _hyperApplyRoute("/");');
      expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
    });

    it('reports app-initiated navigation back to the host (keeps the address bar in sync)', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // The driver wraps pushState/replaceState + listens to popstate to post the UNPREFIXED route
      // to the host on in-preview navigation (app <Link> / back-forward), so the bar follows.
      expect(content).toContain('function _reportRouteToHost()');
      expect(content).toContain("'hypercanvas:appRouteChanged'");
      expect(content).toContain("window.addEventListener('popstate', function () { _reportRouteToHost(); });");
      expect(content).toContain('hist.pushState = function');
      // The reported route includes the hash so `<Link to="/x#frag">` updates the bar fully.
      expect(content).toContain('path + window.location.search + window.location.hash');
      expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
    });

    it('normalizes the nav strategy with a hasOwnProperty whitelist (matches the bridge; bogus/inherited → default)', () => {
      const content = generatePreviewContent([APP_ENTRY]);
      // The driver and the bridge MUST whitelist/default `nav=` identically so a bogus value is
      // treated the same on both sides (else the app's own <Link> re-prefixes and breaks matching).
      // Uses Object.prototype.hasOwnProperty (not a bare VALID[raw]) so `nav=toString` can't pass.
      expect(content).toContain(
        'const VALID: Record<string, number> = { basename: 1, "history-bridge": 1, "src-swap": 1 };',
      );
      expect(content).toContain('Object.prototype.hasOwnProperty.call(VALID, raw)');
    });
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
    // Use a non-ui/ path so the entries are not filtered by the isUiPrimitive guard
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/notifications/toaster.tsx',
        componentName: 'Toaster',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/notifications/toaster',
      },
      {
        componentPath: 'client/components/notifications/sonner.tsx',
        componentName: 'Toaster',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/notifications/sonner',
      },
    ];

    const content = generatePreviewContent(entries);

    expect(content).toContain(
      "import { Toaster as ComponentsNotificationsToaster } from './components/notifications/toaster';",
    );
    expect(content).toContain(
      "import { Toaster as ComponentsNotificationsSonner } from './components/notifications/sonner';",
    );
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
    expect(content).toContain(
      "if (prop === 'issuesByStatus') return { backlog: [], todo: [], in_progress: [], done: [], cancelled: [] };",
    );

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

  it('ssrRouteSet not emitted when isSSRRoute entries exist but ssrMock option is absent', () => {
    // Bug: buildCanvasPreviewBody used `ssrRoutes.size > 0` to decide whether to emit
    // ssrRouteSet.has() and <RemixMockWrapper /> references, but those identifiers are only
    // declared when needsRemixMock (ssrMock.framework === 'remix') is true. Passing ssrRoutes
    // without needsRemixMock produced references to undeclared identifiers → compile error.
    const ssrEntry = makeSSREntry('app/routes/_index.tsx', 'Index');
    const content = generatePreviewContent([ssrEntry]); // no ssrMock option
    expect(content).not.toContain('ssrRouteSet');
    expect(content).not.toContain('RemixMockWrapper');
    expect(content).not.toContain('react-router-dom');
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

describe('generatePreviewContent — ui-primitive filtering', () => {
  it('excludes components from components/ui/ path from componentRegistry', () => {
    // Bulka has 46 shadcn primitives in its registry. Each crashes on event-like fallback
    // props (Badge passes unknown props to <div> → React warns) and each probe consumes
    // up to 20s of isPreviewLoaded polling. 46 × 20s = 920s >> 360s test budget.
    // components/ui/ entries must be excluded from componentRegistry to prevent this.
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/pages/Index.tsx',
        componentName: 'Index',
        exportStyle: 'default-named',
        sampleExports: [],
        importPath: './pages/Index',
      },
      makeEntry('client/components/ui/badge.tsx', 'Badge'),
      makeEntry('client/components/ui/chart.tsx', 'ChartContainer'),
      makeEntry('client/components/ui/button.tsx', 'Button'),
    ];
    const content = generatePreviewContent(entries);
    // Project-level components must appear in the registry
    expect(content).toContain("'client/pages/Index.tsx'");
    // UI primitives must not appear — they drain the test budget on fallback-prop crashes
    expect(content).not.toContain("'client/components/ui/badge.tsx'");
    expect(content).not.toContain("'client/components/ui/chart.tsx'");
    expect(content).not.toContain("'client/components/ui/button.tsx'");
  });

  it('does not exclude components that are only similarly named but not in a /ui/ directory', () => {
    const entries: PreviewComponentEntry[] = [
      makeEntry('client/components/UserInterface.tsx', 'UserInterface'),
      makeEntry('client/pages/ui-dashboard/Dashboard.tsx', 'Dashboard'),
      makeEntry('client/components/ui/badge.tsx', 'Badge'),
    ];
    const content = generatePreviewContent(entries);
    // Not a components/ui/ path — should remain in registry
    expect(content).toContain("'client/components/UserInterface.tsx'");
    expect(content).toContain("'client/pages/ui-dashboard/Dashboard.tsx'");
    // Actual components/ui/ path without SampleDefault — should be excluded
    expect(content).not.toContain("'client/components/ui/badge.tsx'");
  });

  it('excludes components/ui/ entries with non-default sample exports but no SampleDefault', () => {
    // A UI primitive that exports SamplePrimary (or any named sample) but not SampleDefault
    // must still be excluded — the render path only uses SampleDefault, so without it the
    // component falls through to <Component {...previewFallbackProps} /> and can crash.
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/navigation-menu.tsx',
        componentName: 'NavigationMenu',
        exportStyle: 'named',
        sampleExports: ['SamplePrimary'],
        importPath: './components/ui/navigation-menu',
      },
    ];
    const content = generatePreviewContent(entries);
    expect(content).not.toContain("'client/components/ui/navigation-menu.tsx'");
  });

  it('keeps components/ui/ entries that have SampleDefault exports in the registry', () => {
    // fill-picker, navigation-menu, pagination in this repo live under components/ui/
    // but have SampleDefault exports — they should remain previewable.
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/fill-picker.tsx',
        componentName: 'FillPicker',
        exportStyle: 'named',
        sampleExports: ['SampleDefault'],
        importPath: './components/ui/fill-picker',
      },
      makeEntry('client/components/ui/badge.tsx', 'Badge'),
    ];
    const content = generatePreviewContent(entries);
    // Has SampleDefault — must remain in registry
    expect(content).toContain("'client/components/ui/fill-picker.tsx'");
    // No SampleDefault — must be excluded
    expect(content).not.toContain("'client/components/ui/badge.tsx'");
  });
});

describe('isUiPrimitive', () => {
  it('matches forward-slash paths (Unix)', () => {
    expect(isUiPrimitive('client/components/ui/badge.tsx')).toBe(true);
    expect(isUiPrimitive('components/ui/button.tsx')).toBe(true);
  });

  it('matches backslash paths (Windows)', () => {
    expect(isUiPrimitive('client\\components\\ui\\badge.tsx')).toBe(true);
    expect(isUiPrimitive('components\\ui\\button.tsx')).toBe(true);
  });

  it('does not match non-ui/ paths', () => {
    expect(isUiPrimitive('client/components/UserInterface.tsx')).toBe(false);
    expect(isUiPrimitive('client/pages/ui-dashboard/Dashboard.tsx')).toBe(false);
    expect(isUiPrimitive('client/ui/app.tsx')).toBe(false);
  });
});

describe('generatePreviewContent — missing-component signal', () => {
  it('includes _ComponentMissingSignal function in generated output', () => {
    const content = generatePreviewContent([makeEntry('src/Button.tsx', 'Button')], {});
    expect(content).toContain('_ComponentMissingSignal');
    expect(content).toContain('hypercanvas:componentMissing');
  });

  it('missing-component branch renders structured fallback and fires _ComponentMissingSignal', () => {
    const content = generatePreviewContent([makeEntry('src/Button.tsx', 'Button')], {});
    // The branch should NOT contain raw "Error: Component not found"
    expect(content).not.toContain('Error: Component not found');
    // Replaces the bare "Loading…" with a structured fallback heading.
    expect(content).toContain('No sample for this component');
    // Surfaces detected exports so the user can see what the file ships.
    expect(content).toContain('componentExportsMap');
    expect(content).toContain('Detected exports:');
    // Should include the missing signal component
    expect(content).toContain('<_ComponentMissingSignal');
  });
});

describe('generatePreviewContent — synthetic SampleDefault', () => {
  it('emits an inline arrow + namespace import for UI primitives with synthetic compound scaffold', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/alert.tsx',
        componentName: 'Alert',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/alert',
        syntheticSampleDefault: {
          body: '<Alert>\n    <AlertTitle>Preview title</AlertTitle>\n</Alert>',
          referencedNames: ['Alert', 'AlertTitle'],
        },
        detectedExports: ['Alert', 'AlertTitle', 'AlertDescription'],
      },
    ];

    const content = generatePreviewContent(entries);

    // Namespace import for synthetic JSX references
    expect(content).toContain("import * as AlertModule from './components/ui/alert';");
    // Inline arrow registered in sampleRenderMap with prefixed component refs
    expect(content).toContain("'client/components/ui/alert.tsx':");
    expect(content).toContain('<AlertModule.Alert>');
    expect(content).toContain('<AlertModule.AlertTitle>');
    expect(content).toContain('</AlertModule.Alert>');
    // Detected exports surface in the embedded map
    expect(content).toContain('\'client/components/ui/alert.tsx\': ["Alert", "AlertTitle", "AlertDescription"]');
    // Should still parse as valid TS/TSX
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('keeps a UI primitive in the registry when it has a synthetic SampleDefault', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/alert.tsx',
        componentName: 'Alert',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/alert',
        syntheticSampleDefault: {
          body: '<Alert>\n    <AlertTitle>Preview title</AlertTitle>\n</Alert>',
          referencedNames: ['Alert', 'AlertTitle'],
        },
      },
    ];

    const content = generatePreviewContent(entries);
    // Without the renderable-sample carve-out, the registry filter would drop
    // every UI primitive without an authored SampleDefault.
    expect(content).toContain("'client/components/ui/alert.tsx': toPreviewComponent(Alert)");
  });

  it('drops UI primitives that have neither authored nor synthetic SampleDefault', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/divider.tsx',
        componentName: 'Divider',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/divider',
      },
    ];

    const content = generatePreviewContent(entries);
    expect(content).not.toContain("'client/components/ui/divider.tsx'");
  });

  it('still emits detectedExports in componentExportsMap for UI primitives that were filtered from the registry', () => {
    // A primitive without authored OR synthetic SampleDefault gets dropped
    // from componentRegistry / sampleRenderMap, but the iframe fallback UI
    // still needs its detectedExports to render "Detected exports: …".
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/divider.tsx',
        componentName: 'Divider',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/divider',
        detectedExports: ['Divider', 'DividerLabel'],
      },
    ];

    const content = generatePreviewContent(entries);

    // Registry / sampleRenderMap exclusion holds.
    const registrySection = content.slice(
      content.indexOf('const componentRegistry'),
      content.indexOf('const sampleRenderMap'),
    );
    const sampleRenderMapSection = content.slice(
      content.indexOf('const sampleRenderMap'),
      content.indexOf('const componentExportsMap'),
    );
    expect(registrySection).not.toContain('client/components/ui/divider.tsx');
    expect(sampleRenderMapSection).not.toContain('client/components/ui/divider.tsx');

    // componentExportsMap MUST still carry the detected names.
    const exportsSection = content.slice(
      content.indexOf('const componentExportsMap'),
      content.indexOf('const sampleRenderersMap'),
    );
    expect(exportsSection).toContain("'client/components/ui/divider.tsx'");
    expect(exportsSection).toContain('"Divider"');
    expect(exportsSection).toContain('"DividerLabel"');
  });

  it('references a DEFAULT-EXPORT compound parent via its direct alias, not Module.<Parent> (undefined at runtime)', () => {
    // A compound module whose PARENT is the default export and whose subcomponents
    // are named exports. buildContainerSampleJsxBody puts the parent in
    // referencedNames[0], so renderSyntheticSampleArrow prefixes EVERY name —
    // including the parent — with `${alias}Module.`. For a named-export parent,
    // `Module.Alert` resolves. For a DEFAULT-export parent, the component lives at
    // `Module.default` — `Module.Alert` is `undefined` → React "Element type is
    // invalid" at runtime → ComponentErrorBoundary renders null → blank preview.
    // @ts-nocheck hides the type error but does nothing at runtime.
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'src/components/Disclosure.tsx',
        componentName: 'Disclosure',
        exportStyle: 'default-named',
        sampleExports: [],
        importPath: './components/Disclosure',
        syntheticSampleDefault: {
          body: '<Disclosure>\n    <DisclosurePanel>Preview content</DisclosurePanel>\n</Disclosure>',
          referencedNames: ['Disclosure', 'DisclosurePanel'],
        },
      },
    ];

    const content = generatePreviewContent(entries);

    // The default export is imported as the bare `Disclosure` alias
    // (`import Disclosure, { ... } from '...'`). The synthetic arrow MUST render
    // <Disclosure>, NOT <DisclosureModule.Disclosure> — the latter resolves to
    // the module's `Disclosure` named export, which does not exist for a
    // default-export parent, so it is `undefined` at runtime.
    expect(content).not.toContain('<DisclosureModule.Disclosure>');
    expect(content).not.toContain('</DisclosureModule.Disclosure>');
    // The named subcomponent is still correctly namespaced.
    expect(content).toContain('DisclosureModule.DisclosurePanel');
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('regex-prefixes referenced names safely when one name is a prefix of another', () => {
    // Two referenced names where the shorter is a prefix of the longer
    // (Carousel and CarouselContent). The synthetic-arrow regex must rewrite
    // each tag exactly once and not double-prefix the inner CarouselContent.
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'client/components/ui/carousel.tsx',
        componentName: 'Carousel',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './components/ui/carousel',
        syntheticSampleDefault: {
          body: '<Carousel>\n    <CarouselContent>x</CarouselContent>\n</Carousel>',
          referencedNames: ['Carousel', 'CarouselContent'],
        },
      },
    ];

    const content = generatePreviewContent(entries);
    // Both tags must be prefixed with the namespace alias exactly once.
    expect(content).toContain('<CarouselModule.Carousel>');
    expect(content).toContain('<CarouselModule.CarouselContent>');
    expect(content).toContain('</CarouselModule.CarouselContent>');
    expect(content).toContain('</CarouselModule.Carousel>');
    // No double-prefixing.
    expect(content).not.toContain('CarouselModule.CarouselModule.');
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });
});

describe('generatePreviewContent — in-memory generated props (#210)', () => {
  it('holds generated props in React state fed by a postMessage listener (cross-origin safe)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);

    // State, not a parent-window global (a cross-origin window.parent read throws).
    expect(content).toContain('generatedPropsMap');
    expect(content).toContain('setGeneratedPropsMap');
    expect(content).toContain("e.data?.type !== 'hypercanvas:setGeneratedProps'");
    // The render reads the per-path entry from state.
    expect(content).toContain('const generatedProps = generatedPropsMap[componentPath] ?? {};');
  });

  it('does NOT read generated props from a cross-origin parent-window global', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);
    // window.parent.__CANVAS_GENERATED_PROPS__ would throw SecurityError in the
    // extension's cross-origin iframe — must never appear.
    expect(content).not.toContain('__CANVAS_GENERATED_PROPS__');
  });

  it('resets the ErrorBoundary when generated props arrive (no permanent latch)', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);
    // The boundary takes an optional propsReady prop and clears the error on its
    // false→true transition, so a bare first render that crashed before props
    // arrived re-renders with the props instead of latching the overlay.
    expect(content).toContain('propsReady?: boolean');
    expect(content).toContain('const propsJustArrived = !prevProps.propsReady && this.props.propsReady === true;');
    expect(content).toContain('propsReady={generatedPropsReady}');
  });

  it('does NOT block rendering behind a readiness placeholder (would strand SaaS)', () => {
    // SaaS never sends hypercanvas:setGeneratedProps, so a hard gate that holds a
    // placeholder until props arrive would strand SaaS unsampled components forever.
    // The boundary-reset approach must NOT introduce such a gate. (Note: the
    // pre-existing missing-component fallback legitimately says "Generating sample…",
    // so we assert on the gate CONDITION, not the placeholder text.)
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);
    expect(content).not.toContain('!generatedPropsReady');
    expect(content).not.toContain('Component && !generatedPropsReady');
  });

  it('merges generated props after previewFallbackProps so generated values win', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);

    // Generated props are spread last → override the (now filtered) fallback props.
    // HYP-465: the fallback blob is narrowed via filterFallback(componentPath).
    expect(content).toContain('<Component {...filterFallback(componentPath)} {...generatedProps} />');
  });

  it('does NOT bake any generated prop VALUES into the generated file', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);

    // The generated file must only contain generic state-read code, never the
    // computed sample values (those are posted in at runtime). The string "Sample "
    // is what generateSamplePropValues emits for string props — never in the file.
    expect(content).not.toContain('Sample title');
    expect(content).not.toContain('Sample name');
  });

  it('injects generated props into the SSR fallback render path too', () => {
    const entries: PreviewComponentEntry[] = [
      {
        componentPath: 'app/routes/feed.tsx',
        componentName: 'Feed',
        exportStyle: 'named',
        sampleExports: [],
        importPath: './routes/feed',
        isSSRRoute: true,
      },
    ];
    const content = generatePreviewContent(entries, { ssrMock: { framework: 'remix' } });

    // Non-SSR fallback in the SSR-enabled body still merges generated props.
    // HYP-465: the fallback blob is narrowed via filterFallback(componentPath).
    expect(content).toContain('<Component {...filterFallback(componentPath)} {...generatedProps} />');
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('wires the generated-props listener into the Next.js pages-router CanvasPreview too', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries, { isNextPagesRouter: true });
    expect(content).toContain("e.data?.type !== 'hypercanvas:setGeneratedProps'");
    expect(content).toContain('const generatedProps = generatedPropsMap[componentPath] ?? {};');
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('still produces valid TS/TSX with the generated-props state + listener', () => {
    const entries: PreviewComponentEntry[] = [makeEntry('src/components/Tweet.tsx', 'Tweet')];
    const content = generatePreviewContent(entries);
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
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

describe('generatePreviewContent — HYP-446 React Native single-mode height', () => {
  const rnEntries: PreviewComponentEntry[] = [makeEntry('App.tsx', 'App')];

  it('gives the single-mode wrapper a definite-height flex column for RN projects', () => {
    // RN is detected via the SafeAreaProvider import in the provider wrap.
    const content = generatePreviewContent(rnEntries, {
      providerWrap: {
        imports: ["import { SafeAreaProvider } from 'react-native-safe-area-context';"],
        wrapOpen: '<SafeAreaProvider>',
        wrapClose: '</SafeAreaProvider>',
      },
    });

    // Wrapper must establish a definite height so react-native-web's flex:1 chain
    // (navigator screen + FlatList VirtualizedList scroll container) resolves and
    // the rows render at non-zero height. min-height (not height) so tall
    // content-flow previews still grow & scroll.
    expect(content).toContain("minHeight: '100vh'");
    expect(content).toContain("flexDirection: 'column'");
    // Still parses as valid TSX.
    expect(() => parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).not.toThrow();
  });

  it('detects RN via React Navigation imports even without SafeAreaProvider', () => {
    const content = generatePreviewContent(rnEntries, {
      providerWrap: {
        imports: [
          "import { NavigationContainer } from '@react-navigation/native';",
          "import { NavigationIndependentTree } from '@react-navigation/core';",
        ],
        wrapOpen: '<NavigationContainer><NavigationIndependentTree>',
        wrapClose: '</NavigationIndependentTree></NavigationContainer>',
      },
    });

    expect(content).toContain("minHeight: '100vh'");
    expect(content).toContain("flexDirection: 'column'");
  });

  it('keeps the plain block wrapper (no 100vh) for non-RN projects', () => {
    const content = generatePreviewContent([makeEntry('src/components/Button.tsx', 'Button')], {
      providerWrap: {
        imports: ["import { ThemeProvider } from '@emotion/react';"],
        wrapOpen: '<ThemeProvider theme={theme}>',
        wrapClose: '</ThemeProvider>',
      },
    });

    expect(content).not.toContain("minHeight: '100vh'");
    expect(content).toContain('padding: 20');
  });

  it('keeps the plain block wrapper when there is no provider wrap at all', () => {
    const content = generatePreviewContent([makeEntry('src/components/Button.tsx', 'Button')]);
    expect(content).not.toContain("minHeight: '100vh'");
  });
});
