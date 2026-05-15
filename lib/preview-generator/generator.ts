/**
 * Pure string-template generator for __canvas_preview__.tsx.
 * No I/O — takes structured entries, returns source code string.
 */

import { basename, dirname } from 'node:path';
import type { ExportStyle } from './scanner';

export const PREVIEW_GENERATOR_SCHEMA_MARKER = '@hyperide-preview-schema:fallback-props-v5';

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
export function deriveUniquePrefix(entries: PreviewComponentEntry[]): Map<string, string> {
  const nameToEntries = new Map<string, PreviewComponentEntry[]>();
  for (const entry of entries) {
    const list = nameToEntries.get(entry.componentName) ?? [];
    list.push(entry);
    nameToEntries.set(entry.componentName, list);
  }

  const result = new Map<string, string>();
  for (const [, group] of nameToEntries) {
    if (group.length === 1) {
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
    const hasDupes = new Set(names).size !== names.length;

    if (hasDupes) {
      // Escalate to grandparent/parent prefix
      for (const entry of group) {
        const parts = dirname(entry.componentPath)
          .split('/')
          .filter((p) => p && p !== '.');
        const grandparent = parts.length >= 2 ? parts[parts.length - 2] : '';
        const parent = parts[parts.length - 1] ?? '';
        const combined = grandparent
          ? `${grandparent.charAt(0).toUpperCase()}${grandparent.slice(1)}${parent.charAt(0).toUpperCase()}${parent.slice(1)}`
          : parent
            ? `${parent.charAt(0).toUpperCase()}${parent.slice(1)}`
            : 'Root';
        result.set(entry.componentPath, `${combined}${entry.componentName}`);
      }
    } else {
      for (const [path, name] of prefixed) {
        result.set(path, name);
      }
    }
  }
  return result;
}

/** Generate the full __canvas_preview__.tsx content */
export function generatePreviewContent(entries: PreviewComponentEntry[], options?: GeneratePreviewOptions): string {
  const uniqueNames = deriveUniquePrefix(entries);
  const lines: string[] = [];

  // 1. React import + InstanceEntry type for multi-instance mode
  lines.push(`// ${PREVIEW_GENERATOR_SCHEMA_MARKER}`);
  lines.push("import React from 'react';");

  // Next.js pages router import
  if (options?.isNextPagesRouter) {
    lines.push("import { useRouter } from 'next/router';");
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
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(buildImportLine(entry, alias));
  }

  lines.push('');

  // 3. componentRegistry
  lines.push('const componentRegistry: Record<string, PreviewComponent> = {');
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    lines.push(`  '${entry.componentPath}': toPreviewComponent(${alias}),`);
  }
  lines.push('};');
  lines.push('');

  // 4. sampleRenderMap (SampleDefault only)
  lines.push('const sampleRenderMap: Record<string, React.FC> = {');
  for (const entry of entries) {
    if (entry.sampleExports.includes('SampleDefault')) {
      const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
      lines.push(`  '${entry.componentPath}': ${alias}SampleDefault,`);
    }
  }
  lines.push('};');
  lines.push('');

  // 5. sampleRenderersMap (all variants)
  lines.push('const sampleRenderersMap: Record<string, Record<string, React.FC>> = {');
  for (const entry of entries) {
    const alias = uniqueNames.get(entry.componentPath) ?? entry.componentName;
    if (entry.sampleExports.length > 0) {
      lines.push(`  '${entry.componentPath}': {`);
      for (const exp of entry.sampleExports) {
        lines.push(`    '${sampleExportToKey(exp)}': ${alias}${exp},`);
      }
      lines.push('  },');
    } else {
      lines.push(`  '${entry.componentPath}': {},`);
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
  lines.push('  id: 1,');
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
  // messages, notifications) get empty arrays; everything else is undefined.
  // This keeps BoardView-shaped components rendering instead of throwing on
  // destructure when no real store is supplied.
  lines.push('  store: new Proxy({}, {');
  lines.push('    get: (_target, prop) => {');
  lines.push("      if (typeof prop !== 'string') return undefined;");
  lines.push(
    "      if (prop.startsWith('set') || prop.startsWith('toggle') || prop.startsWith('on') || prop.startsWith('add') || prop.startsWith('remove') || prop.startsWith('update') || prop.startsWith('clear') || prop.startsWith('reset') || prop.startsWith('open') || prop.startsWith('close') || prop.startsWith('select')) {",
  );
  lines.push('        return () => {};');
  lines.push('      }');
  lines.push(
    "      if (['issues', 'items', 'rows', 'tags', 'users', 'comments', 'messages', 'notifications', 'cards', 'columns', 'tasks', 'lists', 'projects', 'labels', 'filters', 'priorities', 'statuses'].includes(prop)) return [];",
  );
  lines.push(
    "      if (prop === 'commandPaletteOpen' || prop === 'isOpen' || prop === 'isLoading' || prop === 'isError') return false;",
  );
  lines.push('      return undefined;');
  lines.push('    },');
  lines.push('  }),');
  lines.push('};');
  lines.push('');

  // 9. Error boundary to catch component render crashes (e.g. missing required props)
  // Without this, a crash in one component kills the entire React tree and all subsequent
  // component switches via postMessage silently fail (black canvas).
  lines.push(...buildErrorBoundary());
  lines.push('');

  // 10. CanvasPreview component
  if (options?.isNextPagesRouter) {
    lines.push(...buildCanvasPreviewNextPages(options?.providerWrap));
  } else {
    lines.push(...buildCanvasPreviewURLParams(options?.providerWrap));
  }

  return `${lines.join('\n')}\n`;
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

function buildImportLine(entry: PreviewComponentEntry, alias: string): string {
  const sampleImports = entry.sampleExports.map((exp) => `${exp} as ${alias}${exp}`);

  if (entry.exportStyle === 'default-named' || entry.exportStyle === 'default-anonymous') {
    if (sampleImports.length > 0) {
      return `import ${alias}, { ${sampleImports.join(', ')} } from '${entry.importPath}';`;
    }
    return `import ${alias} from '${entry.importPath}';`;
  }

  // Named export — if alias differs from actual export name, rename it
  const componentImport = alias !== entry.componentName ? `${entry.componentName} as ${alias}` : alias;
  const allImports = [componentImport, ...sampleImports];
  return `import { ${allImports.join(', ')} } from '${entry.importPath}';`;
}

function buildCanvasPreviewURLParams(providerWrap?: ProviderWrapConfig): string[] {
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
    ...buildCanvasPreviewBody(providerWrap),
    '}',
    '',
  ];
}

function buildCanvasPreviewNextPages(providerWrap?: ProviderWrapConfig): string[] {
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
    ...buildCanvasPreviewBody(providerWrap),
    '}',
    '',
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
    '  componentDidUpdate(prevProps: { componentPath: string }) {',
    '    // Reset error state when switching to a different component',
    '    if (prevProps.componentPath !== this.props.componentPath && this.state.error) {',
    '      this.setState({ error: null });',
    '    }',
    '  }',
    '  render() {',
    '    if (this.state.error) {',
    '      // Notify parent webview about the error — UI renders in the overlay layer, not here',
    '      window.parent.postMessage({',
    "        type: 'hypercanvas:componentError',",
    '        componentPath: this.props.componentPath,',
    '        error: this.state.error.message,',
    "      }, '*');",
    '      return null;',
    '    }',
    '    return this.props.children;',
    '  }',
    '}',
  ];
}

function buildCanvasPreviewBody(providerWrap?: ProviderWrapConfig): string[] {
  const wo = providerWrap?.wrapOpen ?? '';
  const wc = providerWrap?.wrapClose ?? '';
  return [
    '  if (!componentPath) {',
    "    return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '      <h2>Error: No component specified</h2>',
    '      <p>Add ?component=... to URL</p>',
    '    </div>;',
    '  }',
    '',
    '  const Component = componentRegistry[componentPath];',
    '  const sampleRenderers = sampleRenderersMap[componentPath] || {};',
    '',
    "  if (mode !== 'multi') {",
    '    const SampleDefault = sampleRenderMap[componentPath];',
    '    if (!SampleDefault && !Component) {',
    "      return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>",
    '        <h2>Error: Component not found</h2>',
    '        <p>Component &quot;{componentPath}&quot; is not available</p>',
    '      </div>;',
    '    }',
    `    return ${wo}<ComponentErrorBoundary componentPath={componentPath}><div style={{ padding: 20 }}>{SampleDefault ? <SampleDefault /> : <Component {...previewFallbackProps} />}</div></ComponentErrorBoundary>${wc};`,
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
    '              <Component {...mergedProps} />',
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
    '                <Component {...previewFallbackProps} />',
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
    '    </div>',
    `    </ComponentErrorBoundary>${wc}`,
    '  );',
  ];
}
