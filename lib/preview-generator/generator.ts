/**
 * Pure string-template generator for __canvas_preview__.tsx.
 * No I/O — takes structured entries, returns source code string.
 */

import { basename, dirname } from 'node:path';
import type { ContainerSampleJsxBody } from './sample-scaffold';
import type { ExportStyle } from './scanner';

export const PREVIEW_GENERATOR_SCHEMA_MARKER = '@hyperide-preview-schema:fallback-props-v9';

export interface PreviewComponentEntry {
  /** Relative path from project root, e.g. 'src/components/Button.tsx' */
  componentPath: string;
  /** PascalCase component name, e.g. 'Button' */
  componentName: string;
  exportStyle: ExportStyle;
  /** All Sample* export names found in source, e.g. ['SampleDefault', 'SamplePrimary'] */
  sampleExports: string[];
  /** Resolved import path relative to preview file, e.g. './components/Button' */
  importPath: string;
  /** True if component imports SSR data hooks (useLoaderData, useRouteLoaderData) that require router context */
  isSSRRoute?: boolean;
  /**
   * Auto-generated SampleDefault JSX for shadcn-style compound modules that
   * don't ship their own `SampleDefault` export. Populated by `buildEntry`
   * via `buildContainerSampleJsxBody`. When present, the generator emits an
   * inline synthetic SampleDefault in the registry instead of skipping the
   * component entirely.
   */
  syntheticSampleDefault?: ContainerSampleJsxBody;
  /**
   * Snapshot of renderable named exports detected in source — used by the
   * runtime fallback UI to tell the user which exports were found when no
   * sample could be synthesized.
   */
  detectedExports?: string[];
}

/**
 * True if the entry has a renderable sample we can drop into the iframe —
 * either an authored `SampleDefault` export or a synthetic compound scaffold.
 */
export function entryHasRenderableSample(entry: PreviewComponentEntry): boolean {
  return entry.sampleExports.includes('SampleDefault') || entry.syntheticSampleDefault !== undefined;
}

/** Configuration for SSR framework mock wrapping in generated preview. */
export interface SSRMockConfig {
  /** Framework whose data hooks need mock router context */
  framework: 'remix';
}

export interface ProviderWrapConfig {
  /** Import lines for providers, e.g. "import { SafeAreaProvider } from 'react-native-safe-area-context'" */
  imports: string[];
  /** Opening JSX tags, e.g. "<SafeAreaProvider><TamaguiProvider config={config}>" */
  wrapOpen: string;
  /** Closing JSX tags, e.g. "</TamaguiProvider></SafeAreaProvider>" */
  wrapClose: string;
}

export interface GeneratePreviewOptions {
  isNextPagesRouter?: boolean;
  /** Wrap rendered components with project-specific providers (theme, safe area, navigation) */
  providerWrap?: ProviderWrapConfig;
  /** When set, SSR route components are wrapped in a mock router instead of rendered directly */
  ssrMock?: SSRMockConfig;
}

/** Convert 'SampleDefault' → 'default', 'SamplePrimary' → 'primary' */
export function sampleExportToKey(exportName: string): string {
  const withoutPrefix = exportName.replace(/^Sample/, '');
  return withoutPrefix.charAt(0).toLowerCase() + withoutPrefix.slice(1);
}

/**
 * Detect name collisions and derive unique prefixes.
 * Two `Button.tsx` in different dirs → `UiButton` / `FormButton`.
 */
export function deriveUniquePrefix(
  entries: PreviewComponentEntry[],
  reservedNames: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const nameToEntries = new Map<string, PreviewComponentEntry[]>();
  for (const entry of entries) {
    const list = nameToEntries.get(entry.componentName) ?? [];
    list.push(entry);
    nameToEntries.set(entry.componentName, list);
  }

  const result = new Map<string, string>();
  for (const [, group] of nameToEntries) {
    if (group.length === 1 && !reservedNames.has(group[0].componentName)) {
      result.set(group[0].componentPath, group[0].componentName);
      continue;
    }
    // Collision: prepend parent dir name
    const prefixed = new Map<string, string>();
    for (const entry of group) {
      const parentDir = basename(dirname(entry.componentPath));
      // Skip '.' for root-level files — not a valid JS identifier prefix
      const prefix = parentDir && parentDir !== '.' ? parentDir.charAt(0).toUpperCase() + parentDir.slice(1) : 'Root';
      prefixed.set(entry.componentPath, `${prefix}${entry.componentName}`);
    }

    // Check if parent dir prefix resolves all collisions
    const names = [...prefixed.values()];
    const hasDupes = hasAliasConflict(names, reservedNames);

    if (hasDupes) {
      // Try platform-suffix disambiguation before grandparent escalation.
      // App.web.tsx → AppWeb, App.tsx stays App (no extra dot segments → no suffix).
      const platformResolved = new Map<string, string>();
      for (const entry of group) {
        const fileBase = basename(entry.componentPath).replace(/\.(tsx?|jsx?)$/, '');
        const dotIdx = fileBase.indexOf('.');
        if (dotIdx !== -1) {
          const platformSegments = fileBase
            .slice(dotIdx + 1)
            .split('.')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
          platformResolved.set(entry.componentPath, `${entry.componentName}${platformSegments.join('')}`);
        }
      }
      const platformAliases = group.map((e) => platformResolved.get(e.componentPath) ?? e.componentName);
      if (!hasAliasConflict(platformAliases, reservedNames)) {
        for (const entry of group) {
          result.set(entry.componentPath, platformResolved.get(entry.componentPath) ?? entry.componentName);
        }
        continue;
      }

      // Escalate to grandparent/parent/file prefix. The file stem is needed for
      // same-directory collisions where different files export the same component
      // name, e.g. shadcn ui/toaster.tsx and ui/sonner.tsx both exporting Toaster.
      const pathResolved = new Map<string, string>();
      for (const entry of group) {
        const parts = dirname(entry.componentPath)
          .split('/')
          .filter((p) => p && p !== '.');
        const grandparent = parts.length >= 2 ? parts[parts.length - 2] : '';
        const parent = parts[parts.length - 1] ?? '';
        const fileStem = basename(entry.componentPath).replace(/\.(tsx?|jsx?)$/, '');
        const segments = [grandparent, parent, fileStem].filter(Boolean).map(toIdentifierSegment);
        pathResolved.set(entry.componentPath, segments.join('') || `Root${entry.componentName}`);
      }

      const pathAliases = group.map((e) => pathResolved.get(e.componentPath) ?? e.componentName);
      if (!hasAliasConflict(pathAliases, reservedNames)) {
        for (const entry of group) {
          result.set(entry.componentPath, pathResolved.get(entry.componentPath) ?? entry.componentName);
        }
        continue;
      }

      for (const [index, entry] of group.entries()) {
        result.set(entry.componentPath, `${pathResolved.get(entry.componentPath) ?? entry.componentName}${index + 1}`);
      }
    } else {
      for (const [path, name] of prefixed) {
        result.set(path, name);
      }
    }
  }
  return result;
}

function hasAliasConflict(names: string[], reservedNames: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name) || reservedNames.has(name)) return true;
    seen.add(name);
  }
  return false;
}

function toIdentifierSegment(segment: string): string {
  const words = segment.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const value = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  if (!value) return '';
  return /^[0-9]/.test(value) ? `_${value}` : value;
}

// Shadcn/ui and similar primitive libraries land in components/ui/.
// These components crash when event-like fallback props are spread into them
// (Badge passes unknown props to <div> → React warns), and each probe can
// consume up to 20 s of isPreviewLoaded polling. Exclude them from the
// componentRegistry so the E2E probing loop only iterates actual project
// components, keeping total probe time within the test budget.
export function isUiPrimitive(componentPath: string): boolean {
  return /(\/|\\|^)components[/\\]ui[/\\]/i.test(componentPath);
}

/** Generate the full __canvas_preview__.tsx content */
export function generatePreviewContent(entries: PreviewComponentEntry[], options?: GeneratePreviewOptions): string {
  // Exclude UI primitives that have no renderable sample — they crash on fallback-prop spread.
  // Keep UI primitives that DO have a SampleDefault export OR a synthesized container
  // scaffold (compound shadcn-style modules like Carousel/Alert).
  const registryEntries = entries.filter((e) => !isUiPrimitive(e.componentPath) || entryHasRenderableSample(e));
  const uniqueNames = deriveUniquePrefix(
    registryEntries,
    extractImportedBindings(options?.providerWrap?.imports ?? []),
  );
  const lines: string[] = [];

  // 1. React import + InstanceEntry type for multi-instance mode
  lines.push(`// ${PREVIEW_GENERATOR_SCHEMA_MARKER}`);
  lines.push("import React from 'react';");

  // Next.js pages router import
  if (options?.isNextPagesRouter) {
    lines.push("import { useRouter } from 'next/router';");
  }

  // Remix SSR mock: import createMemoryRouter + RouterProvider when any entry uses loader data hooks
  const ssrRoutes = new Set(registryEntries.filter((e) => e.isSSRRoute).map((e) => e.componentPath));
  const needsRemixMock = options?.ssrMock?.framework === 'remix' && ssrRoutes.size > 0;
  if (needsRemixMock) {
    lines.push("import { createMemoryRouter, RouterProvider } from 'react-router-dom';");
  }

  // Provider imports for project-specific wrapping (theme, safe area, navigation)
  if (options?.providerWrap?.imports.length) {
    for (const imp of options.providerWrap.imports) {
      lines.push(imp);
    }
  }

  lines.push('');
  lines.push('type InstanceEntry = { x?: number; y?: number; props?: Record<string, unknown> };');
  lines.push('type PreviewComponent = React.ComponentType<Record<string, unknown>>;');
  lines.push('');
  lines.push('function toPreviewComponent<P>(component: React.ComponentType<P>): PreviewComponent {');
  lines.push('  return component as unknown as PreviewComponent;');
  lines.push('}');
  lines.push('');

  // 2. Component imports
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(buildImportLine(entry, alias));
    // Synthetic SampleDefault references multiple named exports from the same
    // module (e.g. Carousel + CarouselContent + CarouselItem). Pull them in via
    // a namespace import so the inline arrow can reference any subcomponent
    // without bloating the named-import list with shadcn-only identifiers.
    if (entry.syntheticSampleDefault) {
      const safePath = entry.importPath.replace(/'/g, "\\'");
      lines.push(`import * as ${alias}Module from '${safePath}';`);
    }
  }

  lines.push('');

  // 3. componentRegistry
  lines.push('const componentRegistry: Record<string, PreviewComponent> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(`  '${entry.componentPath.replace(/'/g, "\\'")}': toPreviewComponent(${alias}),`);
  }
  lines.push('};');
  lines.push('');

  // 4. sampleRenderMap (SampleDefault only — authored or synthesized)
  lines.push('const sampleRenderMap: Record<string, React.FC> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    const safeKey = entry.componentPath.replace(/'/g, "\\'");
    if (entry.sampleExports.includes('SampleDefault')) {
      lines.push(`  '${safeKey}': ${alias}SampleDefault,`);
    } else if (entry.syntheticSampleDefault) {
      const inline = renderSyntheticSampleArrow(entry.syntheticSampleDefault, `${alias}Module`);
      lines.push(`  '${safeKey}': ${inline},`);
    }
  }
  lines.push('};');
  lines.push('');

  // 4b. componentExportsMap — used by the runtime fallback UI to tell the user
  //     which named exports were detected when no sample could be synthesized.
  lines.push('const componentExportsMap: Record<string, string[]> = {');
  for (const entry of registryEntries) {
    if (!entry.detectedExports || entry.detectedExports.length === 0) continue;
    const safeKey = entry.componentPath.replace(/'/g, "\\'");
    const exportsList = entry.detectedExports.map((n) => JSON.stringify(n)).join(', ');
    lines.push(`  '${safeKey}': [${exportsList}],`);
  }
  lines.push('};');
  lines.push('');

  // 5. sampleRenderersMap (all variants)
  lines.push('const sampleRenderersMap: Record<string, Record<string, React.FC>> = {');
  for (const entry of registryEntries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    if (entry.sampleExports.length > 0) {
      lines.push(`  '${entry.componentPath.replace(/'/g, "\\'")}': {`);
      for (const exp of entry.sampleExports) {
        lines.push(`    '${sampleExportToKey(exp)}': ${alias}${exp},`);
      }
      lines.push('  },');
    } else {
      lines.push(`  '${entry.componentPath.replace(/'/g, "\\'")}': {},`);
    }
  }
  lines.push('};');
  lines.push('');

  // 6. callbackStubs
  lines.push('const callbackStubs = {');
  lines.push("  onClick: () => console.log('[Preview] onClick'),");
  lines.push(
    "  onChange: (e: React.SyntheticEvent) => console.log('[Preview] onChange', (e?.target as HTMLInputElement)?.value),",
  );
  lines.push("  onSubmit: (e: React.SyntheticEvent) => { e?.preventDefault?.(); console.log('[Preview] onSubmit'); },");
  lines.push("  onBlur: () => console.log('[Preview] onBlur'),");
  lines.push("  onFocus: () => console.log('[Preview] onFocus'),");
  lines.push("  onNavChange: (value: unknown) => console.log('[Preview] onNavChange', value),");
  lines.push("  onNavigate: (value: unknown) => console.log('[Preview] onNavigate', value),");
  lines.push("  onNext: () => console.log('[Preview] onNext'),");
  lines.push("  onOpen: (value: unknown) => console.log('[Preview] onOpen', value),");
  lines.push("  onClose: (value: unknown) => console.log('[Preview] onClose', value),");
  lines.push("  onAddToCart: (...args: unknown[]) => console.log('[Preview] onAddToCart', args),");
  lines.push("  onCreateEvent: () => console.log('[Preview] onCreateEvent'),");
  lines.push("  onDateSelect: (value: unknown) => console.log('[Preview] onDateSelect', value),");
  lines.push("  onFilterChange: (value: unknown) => console.log('[Preview] onFilterChange', value),");
  lines.push("  onFiltersChange: (value: unknown) => console.log('[Preview] onFiltersChange', value),");
  lines.push("  onPlayPause: () => console.log('[Preview] onPlayPause'),");
  lines.push("  onPlayAll: () => console.log('[Preview] onPlayAll'),");
  lines.push("  onPlaySong: (value: unknown) => console.log('[Preview] onPlaySong', value),");
  lines.push("  onPrevious: () => console.log('[Preview] onPrevious'),");
  lines.push("  onPress: (value: unknown) => console.log('[Preview] onPress', value),");
  lines.push("  onQuickView: (value: unknown) => console.log('[Preview] onQuickView', value),");
  lines.push("  onSearchChange: (value: unknown) => console.log('[Preview] onSearchChange', value),");
  lines.push("  onSeek: (value: unknown) => console.log('[Preview] onSeek', value),");
  lines.push("  onSectionChange: (value: unknown) => console.log('[Preview] onSectionChange', value),");
  lines.push("  onSelect: (value: unknown) => console.log('[Preview] onSelect', value),");
  lines.push("  onToggleCalendar: (value: unknown) => console.log('[Preview] onToggleCalendar', value),");
  lines.push("  onVolumeChange: (value: unknown) => console.log('[Preview] onVolumeChange', value),");
  lines.push("  onViewChange: (value: unknown) => console.log('[Preview] onViewChange', value),");
  lines.push('};');
  lines.push('');

  // 7. Shared fallback data for prop-required components without SampleDefault.
  lines.push('const previewSong = {');
  lines.push('  id: "preview-song",');
  lines.push('  title: "Preview Song",');
  lines.push('  artist: "Preview Artist",');
  lines.push('  album: "Preview Album",');
  lines.push('  duration: "3:24",');
  lines.push('  durationSeconds: 204,');
  lines.push('  coverUrl: "https://picsum.photos/seed/hyper-preview-song/96/96",');
  lines.push('};');
  lines.push('');
  lines.push('const previewPlaylist = {');
  lines.push('  id: "preview-playlist",');
  lines.push('  name: "Preview Playlist",');
  lines.push('  description: "Preview playlist for isolated component rendering.",');
  lines.push('  coverUrl: "https://picsum.photos/seed/hyper-preview-playlist/300/300",');
  lines.push('  songs: [previewSong],');
  lines.push('};');
  lines.push('');
  lines.push('const previewFileItem = {');
  lines.push('  id: "preview-folder",');
  lines.push('  name: "Preview Folder",');
  lines.push('  type: "folder",');
  lines.push('  modified: "Today",');
  lines.push('  owner: "Preview",');
  lines.push('  starred: false,');
  lines.push('  shared: false,');
  lines.push('  parentId: null,');
  lines.push('};');
  lines.push('');
  lines.push('const previewLocation = { id: "preview-location", name: "Preview Location", address: "1 Preview St" };');
  lines.push('const previewRideType = { id: "preview-ride", name: "Preview Ride", eta: 4, price: "$12.00" };');
  lines.push('const previewTrip = {');
  lines.push('  id: "preview-trip",');
  lines.push('  pickup: previewLocation,');
  lines.push('  destination: { ...previewLocation, id: "preview-destination", name: "Preview Destination" },');
  lines.push('  rideType: previewRideType,');
  lines.push('};');
  lines.push('');
  lines.push('const previewListing = {');
  lines.push('  id: "preview-listing",');
  lines.push('  title: "Preview Stay",');
  lines.push('  location: "Preview City",');
  lines.push('  country: "Preview Country",');
  lines.push('  distance: "1 km away",');
  lines.push('  dates: "Apr 24-29",');
  lines.push('  price: 120,');
  lines.push('  currency: "USD",');
  lines.push('  rating: 4.9,');
  lines.push('  reviewCount: 12,');
  lines.push('  images: ["#B7D5E8", "#D5E8B7"],');
  lines.push('  isFavorite: false,');
  lines.push('  isGuestFavorite: true,');
  lines.push('  guests: 2,');
  lines.push('  bedrooms: 1,');
  lines.push('  beds: 1,');
  lines.push('  baths: 1,');
  lines.push('  description: "Preview listing description.",');
  lines.push('  amenities: ["Wifi", "Kitchen"],');
  lines.push('  host: { name: "Preview Host", avatar: "#82A8C4", isSuperhost: true, joinedDate: "2024" },');
  lines.push(
    '  reviews: [{ id: "preview-review", author: "Preview Guest", avatar: "#A8C482", date: "Today", rating: 5, comment: "Preview review." }],',
  );
  lines.push('  category: "Preview",');
  lines.push('};');
  lines.push('');
  lines.push('const previewProduct = {');
  lines.push('  id: "1",');
  lines.push('  name: "Preview Product",');
  lines.push('  price: 29.99,');
  lines.push('  originalPrice: 39.99,');
  lines.push('  category: "sale",');
  lines.push('  image: "#B7D5E8",');
  lines.push('  rating: 4.5,');
  lines.push('  reviewCount: 24,');
  lines.push('  description: "Preview product description.",');
  lines.push('  sizes: ["M"],');
  lines.push('  colors: ["Blue"],');
  lines.push('  brand: "Preview Brand",');
  lines.push('  onSale: true,');
  lines.push('};');
  lines.push('');
  lines.push('const previewFilters = {');
  lines.push('  search: "",');
  lines.push('  status: "all",');
  lines.push('  device: "all",');
  lines.push('  country: "all",');
  lines.push('  selectedBrands: [],');
  lines.push('  selectedColor: null,');
  lines.push('  priceRange: [0, 100],');
  lines.push('};');
  lines.push('');
  lines.push('const previewProject = {');
  lines.push('  id: "preview-project",');
  lines.push('  title: "Preview Project",');
  lines.push('  description: "Preview project description.",');
  lines.push('  tags: ["React", "TypeScript"],');
  lines.push('  image: "#B7D5E8",');
  lines.push('  url: "https://example.com",');
  lines.push('};');
  lines.push('');
  lines.push('const previewChartData = [');
  lines.push(
    '  { date: "Mon", pageViews: 1000, uniqueVisitors: 700, bounceRate: 32, avgSessionDuration: 180, conversions: 24, revenue: 1200 },',
  );
  lines.push(
    '  { date: "Tue", pageViews: 1200, uniqueVisitors: 840, bounceRate: 30, avgSessionDuration: 190, conversions: 28, revenue: 1500 },',
  );
  lines.push('];');
  lines.push('');
  lines.push('const previewData = previewChartData.map((row, index) => ({');
  lines.push('  ...row,');
  lines.push('  id: "preview-row-" + (index + 1),');
  lines.push('  title: row.date,');
  lines.push('  name: row.date,');
  lines.push('  label: row.date,');
  lines.push('  value: row.pageViews,');
  lines.push('  status: "active",');
  lines.push('  items: [],');
  lines.push('  children: [],');
  lines.push('}));');
  lines.push('');
  lines.push('const previewWeatherDetails = {');
  lines.push('  uvIndex: 4,');
  lines.push('  uvLabel: "Moderate",');
  lines.push('  windSpeed: 12,');
  lines.push('  windDirection: "NW",');
  lines.push('  humidity: 55,');
  lines.push('  dewPoint: 8,');
  lines.push('  pressure: 1013,');
  lines.push('  visibility: 10,');
  lines.push('};');
  lines.push('');
  lines.push('const previewDate = new Date("2026-04-24T09:00:00Z");');
  lines.push('const previewCalendars = [');
  lines.push('  { type: "work", label: "Work", color: "#4285F4", enabled: true },');
  lines.push('  { type: "personal", label: "Personal", color: "#0B8043", enabled: true },');
  lines.push('  { type: "birthdays", label: "Birthdays", color: "#F4511E", enabled: true },');
  lines.push('  { type: "holidays", label: "Holidays", color: "#F6BF26", enabled: true },');
  lines.push('];');
  lines.push('');

  // 8. Fallback props for components without SampleDefault.
  // Extra props are harmless for React components that do not read them, and
  // they keep prop-required leaf components renderable in the preview.
  // Stable stub caches: Proxy get traps must return the same function/array
  // reference on every call so React hook dependency arrays don't trigger
  // infinite re-renders when components use [store.setX] or [state.items] as deps.
  lines.push('const _storeStubs: Record<string, unknown> = {};');
  lines.push('const _stateStubs: Record<string, unknown> = {};');
  lines.push('const previewFallbackProps: Record<string, unknown> = {');
  lines.push('  ...callbackStubs,');
  lines.push('  activeNav: "dashboard",');
  lines.push('  activeSection: "dashboard",');
  lines.push('  count: 1,');
  lines.push('  chartData: previewChartData,');
  lines.push('  calendars: previewCalendars,');
  lines.push('  currentDate: previewDate,');
  lines.push('  data: previewData,');
  lines.push('  description: "Preview description",');
  lines.push('  details: previewWeatherDetails,');
  lines.push('  driver: { id: "preview-driver", name: "Preview Driver", rating: 4.9, vehicle: "Preview Car" },');
  lines.push('  events: previewChartData,');
  lines.push('  files: [previewFileItem],');
  lines.push('  filters: previewFilters,');
  lines.push('  headings: [],');
  lines.push('  hours: previewChartData,');
  lines.push('  index: 1,');
  lines.push('  items: [],');
  lines.push('  label: "Preview",');
  lines.push('  listing: previewListing,');
  lines.push('  listings: [previewListing],');
  lines.push('  currentSongId: "preview-song",');
  lines.push('  navigation: {');
  lines.push("    navigate: (...args: unknown[]) => console.log('[Preview] navigation.navigate', args),");
  lines.push("    goBack: () => console.log('[Preview] navigation.goBack'),");
  lines.push("    back: () => console.log('[Preview] navigation.back'),");
  lines.push("    push: (...args: unknown[]) => console.log('[Preview] navigation.push', args),");
  lines.push("    popTo: (...args: unknown[]) => console.log('[Preview] navigation.popTo', args),");
  lines.push("    reset: (value: unknown) => console.log('[Preview] navigation.reset', value),");
  lines.push("    replace: (...args: unknown[]) => console.log('[Preview] navigation.replace', args),");
  lines.push("    setOptions: (options: unknown) => console.log('[Preview] navigation.setOptions', options),");
  lines.push("    dispatch: (action: unknown) => console.log('[Preview] navigation.dispatch', action),");
  lines.push('  },');
  lines.push('  path: [previewFileItem],');
  lines.push('  playerState: { currentSong: previewSong, isPlaying: false, progress: 0.25, volume: 0.8 },');
  lines.push('  playlist: previewPlaylist,');
  lines.push('  playlists: [previewPlaylist],');
  lines.push('  product: previewProduct,');
  lines.push('  products: [previewProduct],');
  lines.push('  project: previewProject,');
  lines.push('  projects: [previewProject],');
  lines.push('  rows: [],');
  lines.push('  route: {');
  lines.push('    key: "preview-route",');
  lines.push('    name: "Preview",');
  lines.push('    params: {');
  lines.push('      id: "preview-id",');
  lines.push('      activityId: "preview-activity",');
  lines.push('      contactId: "preview-contact",');
  lines.push('      conversationId: "preview-conversation",');
  lines.push('      destination: { ...previewLocation, id: "preview-destination", name: "Preview Destination" },');
  lines.push('      itemId: "preview-item",');
  lines.push('      menuItemId: "preview-menu-item",');
  lines.push('      pickup: previewLocation,');
  lines.push('      restaurantId: "preview-restaurant",');
  lines.push('      rideType: previewRideType,');
  lines.push('      transactionId: "preview-transaction",');
  lines.push('      trip: previewTrip,');
  lines.push('    },');
  lines.push('  },');
  lines.push('  searchQuery: "",');
  lines.push('  selectedDate: previewDate,');
  lines.push('  song: previewSong,');
  lines.push('  songs: [previewSong],');
  lines.push('  tags: ["React", "TypeScript"],');
  lines.push('  title: "Preview",');
  lines.push('  value: "Preview",');
  lines.push('  block: { id: "preview-block", type: "paragraph", content: "Preview block", checked: false },');
  lines.push('  page: {');
  lines.push('    id: "preview-page",');
  lines.push('    title: "Preview Page",');
  lines.push('    icon: "Preview",');
  lines.push('    coverGradient: "linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)",');
  lines.push('    parentId: null,');
  lines.push('    isFavorite: false,');
  lines.push('    lastEdited: "Preview",');
  lines.push('    blocks: [{ id: "preview-block", type: "paragraph", content: "Preview block" }],');
  lines.push('  },');
  lines.push('  metric: { label: "Preview", value: "1,024", change: "+12%", trend: "up" },');
  lines.push(
    '  row: { id: "preview-row", name: "Preview row", status: "Done", priority: "Medium", date: "2026-01-01" },',
  );
  // Generic Zustand-style store stub. Components that destructure `store.xxx`
  // for setters (setCommandPaletteOpen, toggleX, addY, …) get no-op functions;
  // collection-like reads (issues, items, rows, tags, users, comments,
  // messages, notifications) get empty arrays; grouped status maps get empty
  // arrays for common workflow columns; everything else is undefined.
  // This keeps BoardView-shaped components rendering instead of throwing on
  // destructure when no real store is supplied.
  lines.push('  store: new Proxy({}, {');
  lines.push('    get: (_target, prop) => {');
  lines.push("      if (typeof prop !== 'string') return undefined;");
  lines.push('      if (/^(?:set|toggle|on|add|remove|update|clear|reset|open|close)[A-Z]/.test(prop)) {');
  lines.push('        return (_storeStubs[prop] ??= () => {});');
  lines.push('      }');
  lines.push(
    "      if (['issues', 'items', 'rows', 'tags', 'users', 'comments', 'messages', 'notifications', 'cards', 'columns', 'tasks', 'lists', 'projects', 'labels', 'filters', 'priorities', 'statuses'].includes(prop)) return (_storeStubs[prop] ??= []);",
  );
  lines.push(
    "      if (prop === 'issuesByStatus') return { backlog: [], todo: [], in_progress: [], done: [], cancelled: [] };",
  );
  lines.push(
    "      if (prop === 'commandPaletteOpen' || prop === 'isOpen' || prop === 'isLoading' || prop === 'isError') return false;",
  );
  lines.push('      return undefined;');
  lines.push('    },');
  lines.push('  }),');
  // Generic context-shaped prop stubs for components that destructure
  // common React/Remix/Redux/i18n/query patterns directly (not via store).
  // These keep BoardView({ store, dispatch, theme }) and similar shapes
  // rendering instead of crashing on undefined member access.
  lines.push('  dispatch: () => {},');
  lines.push('  reducer: () => {},');
  lines.push('  state: new Proxy({}, {');
  lines.push('    get: (_target, prop) => {');
  lines.push("      if (typeof prop !== 'string') return undefined;");
  lines.push('      if (/^(?:set|toggle|on|add|remove|update|clear|reset|open|close)[A-Z]/.test(prop)) {');
  lines.push('        return (_stateStubs[prop] ??= () => {});');
  lines.push('      }');
  lines.push(
    "      if (['issues', 'items', 'rows', 'tags', 'users', 'comments', 'messages', 'notifications', 'cards', 'columns', 'tasks', 'lists', 'projects', 'labels', 'filters', 'priorities', 'statuses'].includes(prop)) return (_stateStubs[prop] ??= []);",
  );
  lines.push(
    "      if (prop === 'issuesByStatus') return { backlog: [], todo: [], in_progress: [], done: [], cancelled: [] };",
  );
  lines.push(
    "      if (prop === 'commandPaletteOpen' || prop === 'isOpen' || prop === 'isLoading' || prop === 'isError') return false;",
  );
  lines.push('      return undefined;');
  lines.push('    },');
  lines.push('  }),');
  lines.push('  theme: new Proxy({ colors: {}, spacing: {}, fontSizes: {}, shadows: {}, breakpoints: {} }, {');
  lines.push('    get: (target, prop) => {');
  lines.push("      if (typeof prop !== 'string') return undefined;");
  lines.push('      if (prop in target) return (target as Record<string, unknown>)[prop];');
  lines.push('      return {};');
  lines.push('    },');
  lines.push('  }),');
  lines.push("  i18n: { t: (key: string) => key, language: 'en', changeLanguage: () => {} },");
  lines.push("  session: { user: null, isAuthenticated: false, sessionId: 'preview-session' },");
  lines.push("  auth: { user: null, isAuthenticated: false, sessionId: 'preview-session' },");
  lines.push('  query: { data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} },');
  lines.push('  mutation: { mutate: () => {}, mutateAsync: async () => {}, isPending: false, isError: false },');
  lines.push("  fetcher: { submit: () => {}, load: () => {}, data: undefined, state: 'idle' },");
  lines.push("  intl: { formatMessage: (m: { defaultMessage?: string }) => m?.defaultMessage ?? '', locale: 'en' },");
  lines.push('};');
  lines.push('');

  // 9. SSR route set + RemixMockWrapper (only for Remix projects with SSR route components)
  if (needsRemixMock) {
    lines.push('const ssrRouteSet = new Set<string>([');
    for (const routePath of ssrRoutes) {
      lines.push(`  '${routePath.replace(/'/g, "\\'")}',`);
    }
    lines.push(']);');
    lines.push('');
    lines.push(...buildRemixMockWrapper());
    lines.push('');
  }

  // 10. Error boundary to catch component render crashes (e.g. missing required props)
  // Without this, a crash in one component kills the entire React tree and all subsequent
  // component switches via postMessage silently fail (black canvas).
  lines.push(...buildErrorBoundary());
  lines.push('');

  // 10b. Success signal — fires after component renders without error, clears stale overlays.
  lines.push(...buildComponentSuccessSignal());
  lines.push('');

  // 10c. Missing signal — fires when component is not in registry, triggers self-healing.
  lines.push(...buildComponentMissingSignal());
  lines.push('');

  // 11. CanvasPreview component
  // Only pass ssrRoutes when needsRemixMock is true — the body builders emit
  // ssrRouteSet.has() and <RemixMockWrapper /> references that are only declared
  // when needsRemixMock is true. Passing routes with needsRemixMock=false would
  // generate references to undeclared identifiers (compile error).
  const ssrRoutesForBody = needsRemixMock ? ssrRoutes : undefined;
  if (options?.isNextPagesRouter) {
    lines.push(...buildCanvasPreviewNextPages(options?.providerWrap, ssrRoutesForBody));
  } else {
    lines.push(...buildCanvasPreviewURLParams(options?.providerWrap, ssrRoutesForBody));
  }

  return `${lines.join('\n')}\n`;
}

function extractImportedBindings(importLines: string[]): Set<string> {
  const bindings = new Set<string>();
  for (const line of importLines) {
    const namespaceMatch = line.match(/^import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (namespaceMatch?.[1]) {
      bindings.add(namespaceMatch[1]);
      continue;
    }

    const defaultMatch = line.match(/^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|\s+from\b)/);
    if (defaultMatch?.[1]) bindings.add(defaultMatch[1]);

    const namedMatch = line.match(/\{([^}]+)\}/);
    if (!namedMatch?.[1]) continue;
    for (const part of namedMatch[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('type ')) continue;
      const aliasMatch = trimmed.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (aliasMatch?.[1]) {
        bindings.add(aliasMatch[1]);
        continue;
      }
      const nameMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (nameMatch?.[1]) bindings.add(nameMatch[1]);
    }
  }
  return bindings;
}

/**
 * Generate __canvas_preview__.tsx as a standalone entry (Isolated mode).
 * Includes createRoot and imports PreviewWrapper from .hyperide/preview.tsx.
 *
 * @hyperide-managed — generated file, do not edit
 */
export function generateStandaloneEntry(
  entries: PreviewComponentEntry[],
  wrapperImportPath: string,
  options?: GeneratePreviewOptions,
): string {
  const baseContent = generatePreviewContent(entries, options);

  const bootstrap = `
// @hyperide-managed
import { createRoot } from 'react-dom/client';
import { PreviewWrapper } from '${wrapperImportPath}';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <PreviewWrapper>
      <CanvasPreview />
    </PreviewWrapper>
  );
}
`;
  return baseContent + bootstrap;
}

/**
 * Render a synthetic SampleDefault as an inline arrow function. The body
 * comes from `buildContainerSampleJsxBody`; we prefix every referenced
 * component identifier with `${moduleAlias}.` so the JSX resolves through
 * the namespace import added in step 2.
 */
function renderSyntheticSampleArrow(synthetic: ContainerSampleJsxBody, moduleAlias: string): string {
  let body = synthetic.body;
  for (const name of synthetic.referencedNames) {
    // nosemgrep: detect-non-literal-regexp -- name comes from the source-code AST scanner
    // (not user input) and is restricted to /^[A-Z][\w]*$/ by isValidJsxComponentName,
    // so the resulting regex is safe to construct.
    const re = new RegExp(`(<\\/?)\\s*${name}\\b`, 'g');
    body = body.replace(re, `$1${moduleAlias}.${name}`);
  }
  // Indent body inside the arrow expression
  const indented = body
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return `() => (\n${indented}\n    )`;
}

function buildImportLine(entry: PreviewComponentEntry, alias: string): string {
  const sampleImports = entry.sampleExports.map((exp) => `${exp} as ${alias}${exp}`);

  const safePath = entry.importPath.replace(/'/g, "\\'");
  if (entry.exportStyle === 'default-named' || entry.exportStyle === 'default-anonymous') {
    if (sampleImports.length > 0) {
      return `import ${alias}, { ${sampleImports.join(', ')} } from '${safePath}';`;
    }
    return `import ${alias} from '${safePath}';`;
  }

  // Named export — if alias differs from actual export name, rename it
  const componentImport = alias !== entry.componentName ? `${entry.componentName} as ${alias}` : alias;
  const allImports = [componentImport, ...sampleImports];
  return `import { ${allImports.join(', ')} } from '${safePath}';`;
}

function buildCanvasPreviewURLParams(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  return [
    'interface CanvasPreviewProps {',
    '  component?: string | null;',
    "  mode?: 'single' | 'multi' | null;",
    '}',
    '',
    'export default function CanvasPreview({ component: componentProp, mode: modeProp }: CanvasPreviewProps = {}) {',
    '  const [componentPath, setComponentPath] = React.useState<string | null>(componentProp ?? null);',
    "  const [mode, setMode] = React.useState<'single' | 'multi'>(modeProp ?? 'single');",
    '',
    '  // Sync props to state when parent re-renders with new searchParams (Next.js App Router)',
    '  React.useEffect(() => {',
    '    if (componentProp != null) setComponentPath(componentProp);',
    '  }, [componentProp]);',
    '',
    '  // Read URL params on client mount (Vite / CSR environments without prop injection)',
    '  React.useEffect(() => {',
    '    if (componentProp != null) return;',
    '    const params = new URLSearchParams(window.location.search);',
    "    const urlComponent = params.get('component');",
    '    if (urlComponent) setComponentPath(urlComponent);',
    "    const urlMode = params.get('mode');",
    "    if (urlMode) setMode(urlMode as 'single' | 'multi');",
    '  }, []);',
    '',
    '  // Listen for component switches via postMessage (no iframe reload needed)',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        // Sync URL so HMR full-reload / Fast Refresh remount picks up the current component',
    '        try {',
    '          const url = new URL(window.location.href);',
    "          url.searchParams.set('component', e.data.component);",
    "          window.history.replaceState(null, '', url.toString());",
    '        } catch { /* ignore */ }',
    '      }',
    '    }',
    "    window.addEventListener('message', onMessage);",
    "    return () => window.removeEventListener('message', onMessage);",
    '  }, []);',
    '',
    ...buildCanvasPreviewBody(providerWrap, ssrRoutes),
    '}',
    '',
  ];
}

function buildCanvasPreviewNextPages(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  return [
    'export default function CanvasPreview() {',
    '  const router = useRouter();',
    "  const mode = router.query.mode as 'single' | 'multi';",
    '  const [componentPath, setComponentPath] = React.useState(router.query.component as string);',
    '',
    '  // Sync with router query changes',
    '  React.useEffect(() => {',
    '    if (router.query.component) setComponentPath(router.query.component as string);',
    '  }, [router.query.component]);',
    '',
    '  // Listen for component switches via postMessage (no iframe reload needed)',
    '  React.useEffect(() => {',
    '    function onMessage(e: MessageEvent) {',
    "      if (e.data?.type === 'hypercanvas:setComponent' && e.data.component) {",
    '        setComponentPath(e.data.component);',
    '        // Sync URL so HMR full-reload / Fast Refresh remount picks up the current component',
    '        try {',
    '          const url = new URL(window.location.href);',
    "          url.searchParams.set('component', e.data.component);",
    "          window.history.replaceState(null, '', url.toString());",
    '        } catch { /* ignore */ }',
    '      }',
    '    }',
    "    window.addEventListener('message', onMessage);",
    "    return () => window.removeEventListener('message', onMessage);",
    '  }, []);',
    '',
    ...buildCanvasPreviewBody(providerWrap, ssrRoutes),
    '}',
    '',
  ];
}

function buildComponentSuccessSignal(): string[] {
  return [
    'function _ComponentSuccessSignal({ componentPath }: { componentPath: string }) {',
    '  React.useEffect(() => {',
    "    window.parent.postMessage({ type: 'hypercanvas:componentRenderSucceeded', componentPath }, '*');",
    '  }, [componentPath]);',
    '  return null;',
    '}',
  ];
}

function buildComponentMissingSignal(): string[] {
  return [
    'function _ComponentMissingSignal({ componentPath }: { componentPath: string }) {',
    '  React.useEffect(() => {',
    "    window.parent.postMessage({ type: 'hypercanvas:componentMissing', componentPath }, '*');",
    '  }, [componentPath]);',
    '  return null;',
    '}',
  ];
}

function buildErrorBoundary(): string[] {
  return [
    'class ComponentErrorBoundary extends React.Component<',
    '  { children: React.ReactNode; componentPath: string },',
    '  { error: Error | null }',
    '> {',
    '  constructor(props: { children: React.ReactNode; componentPath: string }) {',
    '    super(props);',
    '    this.state = { error: null };',
    '  }',
    '  static getDerivedStateFromError(error: Error) {',
    '    return { error };',
    '  }',
    '  componentDidCatch(error: Error) {',
    '    window.parent.postMessage({',
    "      type: 'hypercanvas:componentError',",
    '      componentPath: this.props.componentPath,',
    '      error: error.message,',
    "    }, '*');",
    '  }',
    '  componentDidUpdate(prevProps: { componentPath: string }) {',
    '    // Reset error state when switching to a different component',
    '    if (prevProps.componentPath !== this.props.componentPath && this.state.error) {',
    '      this.setState({ error: null });',
    '    }',
    '  }',
    '  render() {',
    '    if (this.state.error) {',
    '      return null;',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
  ];
}

function buildRemixMockWrapper(): string[] {
  return [
    'function RemixMockWrapper({ Component }: { Component: React.ComponentType<Record<string, unknown>> }) {',
    '  const router = createMemoryRouter([',
    '    {',
    "      id: 'root',",
    "      path: '/',",
    '      loader: () => ({}),',
    '      Component: React.Fragment,',
    '      children: [{',
    "        path: 'preview',",
    '        Component: Component as React.ComponentType,',
    '        loader: () => ({}),',
    '      }],',
    '    },',
    "  ], { initialEntries: ['/preview'] });",
    '  return <RouterProvider router={router} />;',
    '}',
  ];
}

function buildCanvasPreviewBody(providerWrap?: ProviderWrapConfig, ssrRoutes?: Set<string>): string[] {
  const wo = providerWrap?.wrapOpen ?? '';
  const wc = providerWrap?.wrapClose ?? '';
  const hasSSR = ssrRoutes && ssrRoutes.size > 0;
  // Runtime fallback render: use RemixMockWrapper for SSR routes, direct render otherwise
  const singleRender = hasSSR
    ? `{SampleDefault ? <SampleDefault /> : ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...previewFallbackProps} />}`
    : `{SampleDefault ? <SampleDefault /> : <Component {...previewFallbackProps} />}`;
  const multiRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...previewFallbackProps} />}`
    : `<Component {...previewFallbackProps} />`;
  const multiMergedRender = hasSSR
    ? `{ssrRouteSet.has(componentPath) ? <RemixMockWrapper Component={Component} /> : <Component {...mergedProps} />}`
    : `<Component {...mergedProps} />`;
  return [
    '  if (!componentPath) {',
    "    return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '      <h2>Loading preview...</h2>',
    '      <p>Waiting for component selection</p>',
    '    </div>;',
    '  }',
    '',
    '  const Component = componentRegistry[componentPath];',
    '  const sampleRenderers = sampleRenderersMap[componentPath] || {};',
    '',
    "  if (mode !== 'multi') {",
    '    const SampleDefault = sampleRenderMap[componentPath];',
    '    if (!SampleDefault && !Component) {',
    '      // Component not yet in the registry. Emit the missing signal so',
    "      // extension.ts's recovery path runs `previewManager.ensureComponent`",
    '      // and re-renders. Show a structured fallback instead of a bare',
    '      // "Loading…" so the user can see the path/exports that were detected.',
    '      const detectedExports = componentExportsMap[componentPath] ?? [];',
    '      return (',
    '        <div style={{ padding: 20, fontFamily: "sans-serif", color: "#666" }}>',
    '          <_ComponentMissingSignal componentPath={componentPath} />',
    '          <h2 style={{ margin: 0, fontSize: 16, color: "#333" }}>No sample for this component</h2>',
    '          <p style={{ marginTop: 8 }}>{componentPath}</p>',
    '          {detectedExports.length > 0 ? (',
    '            <p style={{ marginTop: 8 }}>Detected exports: {detectedExports.join(", ")}</p>',
    '          ) : (',
    '            <p style={{ marginTop: 8 }}>Generating sample…</p>',
    '          )}',
    '        </div>',
    '      );',
    '    }',
    `    return ${wo}<ComponentErrorBoundary componentPath={componentPath}><div style={{ padding: 20 }}>${singleRender}<_ComponentSuccessSignal componentPath={componentPath} /></div></ComponentErrorBoundary>${wc};`,
    '  }',
    '',
    '  const instances = ((window.parent as unknown) as { __CANVAS_INSTANCES__?: Record<string, InstanceEntry> }).__CANVAS_INSTANCES__ || {};',
    '',
    '  return (',
    `    ${wo}<ComponentErrorBoundary componentPath={componentPath}>`,
    "    <div style={{ position: 'relative', width: 10000, height: 10000 }}>",
    '      {Object.entries(instances).map(([id, instance]: [string, InstanceEntry]) => {',
    '        const { x = 0, y = 0, props } = instance;',
    '',
    '        if (props && Object.keys(props).length > 0 && Component) {',
    '          const mergedProps = { ...previewFallbackProps, ...props };',
    '          return (',
    '            <div key={id} data-canvas-instance-id={id}',
    "                 style={{ position: 'absolute', left: x, top: y }}>",
    `              ${multiMergedRender}`,
    '            </div>',
    '          );',
    '        }',
    '',
    '        const SampleComponent = sampleRenderers[id] || sampleRenderMap[componentPath];',
    '        if (!SampleComponent) {',
    '          if (Component) {',
    '            return (',
    '              <div key={id} data-canvas-instance-id={id}',
    "                   style={{ position: 'absolute', left: x, top: y }}>",
    `                ${multiRender}`,
    '              </div>',
    '            );',
    '          }',
    '          return null;',
    '        }',
    '',
    '        return (',
    '          <div key={id} data-canvas-instance-id={id}',
    "               style={{ position: 'absolute', left: x, top: y }}>",
    '            <SampleComponent />',
    '          </div>',
    '        );',
    '      })}',
    '      <_ComponentSuccessSignal componentPath={componentPath} />',
    '    </div>',
    `    </ComponentErrorBoundary>${wc}`,
    '  );',
  ];
}
