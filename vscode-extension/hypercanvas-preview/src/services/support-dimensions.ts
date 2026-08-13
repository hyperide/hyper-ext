/**
 * Support-dimension classifier — the per-(sub-)repo support breakdown engine (HYP-788).
 *
 * Accessed via: extension host (gatherSupportDimensions, on project detection) → posted
 *               on ProjectCapabilities.supportDimensions → webview renders one tab per
 *               BLOCKING dimension (SupportDimensionsTabs).
 *
 * Models a project as FIVE independent dimensions, each → {status, reason, evidence}:
 *   1. framework      — render gate (Vue/Svelte/Angular/no-React = unsupported;
 *                       RN-without-react-native-web = needs-setup).
 *   2. bundler        — build/dev-server gate (unknown = unsupported).
 *   3. styleSystem    — EDIT gate, NOT a render gate. CSS-in-JS systems are inspect-only,
 *                       NEVER a hard "unsupported"/readonly (standing product directive).
 *   4. router         — /test-preview route (auto-patched; effectively supported here).
 *   5. packageManager — informational, always supported.
 *
 * This module is PURE (no fs) — all the spec strings live here and are unit-pinned. It is
 * therefore safe to import from the BROWSER webview bundle (PreviewPanelApp uses
 * selectDimensionTabs to filter the posted dimensions). The fs-reading gatherer lives in
 * the host-only `support-dimensions-detect.ts` so node:fs never leaks into the webview
 * bundle (guarded by scripts/check-webview-bundles.mjs).
 *
 * Scope: the CURRENTLY-OPEN simple repo OR the active monorepo sub-repo. Walking the whole
 * monorepo is a SEPARATE capture tool, explicitly NOT this feature.
 */

import { DETECTED_FRAMEWORK_KIND_TO_NAME } from '@shared/framework-support';
import type { CssSystem, ProjectType, SupportDimension, SupportEvidence, SupportStatus } from '../types';

/**
 * CSS systems that have a real native writer in the adapter registry. Kept as a
 * module-local const (NOT imported from the registry) so this pure module stays
 * browser-safe — importing from @lib/style-adapters/registry pulls in the adapter
 * implementations and breaks the webview bundle. Must be kept in sync with the
 * adapters registered in @lib/style-adapters/registry DEFAULT_STYLE_ADAPTERS when
 * new adapters are added.
 */
const WRITABLE_CSS_SYSTEMS: ReadonlySet<CssSystem> = new Set<CssSystem>([
  'tailwind',
  'cssmodules',
  'tamagui',
  'shadcn', // design system on Tailwind → Tailwind writer
  'daisyui', // design system on Tailwind → Tailwind writer
]);

/** Framework render-gate kinds, independent of the RN needs-setup signal. */
export type FrameworkRenderKind = 'react' | 'vue' | 'svelte' | 'angular' | 'react-native' | 'none';

type NonReactFrameworkKind = Extract<FrameworkRenderKind, 'vue' | 'svelte' | 'angular'>;

/** The framework dimension's input: a plain render kind, or an RN fix prompt. */
export type FrameworkGate =
  | { kind: 'react' | 'vue' | 'svelte' | 'angular' | 'none' }
  | { kind: 'react-native'; message: string; fixLabel: string };

/** Pure inputs the classifier needs — gathered once from the active (sub-)repo. */
export interface SupportFacts {
  frameworkGate: FrameworkGate;
  bundler: ProjectType;
  /** The COMPLETE set of CSS systems for THIS member (detectCssSystems), not a winner. */
  cssSystems: CssSystem[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

/**
 * CSS-in-JS / component-library systems that render+inspect but are not yet AST-editable.
 * These include emotion and styled-components (formerly in the old WRITABLE_CSS_SYSTEMS
 * but honoured as non-writable by HYP-796) and sass (className/stylesheet channel with
 * no write adapter). All must render 'inspect-only', never 'unsupported' (standing
 * product directive: they render and inspect today; full edit is in progress).
 */
const INSPECT_ONLY_CSS_SYSTEMS: ReadonlySet<CssSystem> = new Set<CssSystem>([
  // CSS-in-JS with no write adapter yet (HYP-796 / Phase C+)
  'emotion',
  'styled-components',
  'vanilla-extract',
  // Component libraries (design systems)
  'mui',
  'antd',
  'chakra',
  'mantine',
  'fluentui',
  'nextui',
  // Atomic/utility CSS (no JSX-object channel)
  'pandacss',
  'unocss',
  'stylex',
  // Preprocessor: className/stylesheet with no .scss writer today
  'sass',
]);

/** Bundlers the extension can drive (dev server + HMR round-trip). */
const SUPPORTED_BUNDLERS: ReadonlySet<ProjectType> = new Set<ProjectType>([
  'vite',
  'cra',
  'webpack',
  'nextjs',
  'bun',
  'remix',
]);

const NON_REACT_FRAMEWORK_REASON: Record<NonReactFrameworkKind, string> = {
  vue: 'Vue.js projects not supported',
  svelte: 'Svelte projects not supported',
  angular: 'Angular projects not supported',
};

const FRAMEWORK_DEP_EVIDENCE: Record<NonReactFrameworkKind, string> = {
  vue: 'vue',
  svelte: 'svelte',
  angular: '@angular/core',
};

// ── framework dimension ──────────────────────────────────────────────────────

function classifyFramework(gate: FrameworkGate): SupportDimension {
  const base = { id: 'framework', title: 'Framework' } as const;

  if (gate.kind === 'react') {
    return { ...base, status: 'supported', reason: 'React project — renders in the canvas.', evidence: [] };
  }
  if (gate.kind === 'react-native') {
    return {
      ...base,
      status: 'needs-setup',
      reason: gate.message,
      fixLabel: gate.fixLabel,
      evidence: [
        { label: 'Detected framework', detail: 'React Native' },
        { label: 'Missing', detail: 'react-native-web (+ a Vite config) to render in a browser' },
        { label: 'Fix', detail: gate.fixLabel },
      ],
    };
  }
  if (gate.kind === 'none') {
    return {
      ...base,
      status: 'unsupported',
      reason: 'No React components found',
      evidence: [
        { label: 'Detected framework', detail: 'none (no React dependency, no .tsx/.jsx source)' },
        { label: 'Why', detail: 'HyperIDE canvas renders React components; this project exposes none.' },
      ],
    };
  }
  return {
    ...base,
    status: 'unsupported',
    reason: NON_REACT_FRAMEWORK_REASON[gate.kind],
    detectedFrameworkName: DETECTED_FRAMEWORK_KIND_TO_NAME[gate.kind],
    evidence: [
      { label: 'Detected framework', detail: capitalize(gate.kind) },
      { label: 'Dependency', detail: FRAMEWORK_DEP_EVIDENCE[gate.kind] },
      { label: 'Why', detail: 'The canvas renders React components; this framework cannot mount in it.' },
    ],
  };
}

// ── bundler dimension ────────────────────────────────────────────────────────

function classifyBundler(bundler: ProjectType): SupportDimension {
  const base = { id: 'bundler', title: 'Build / Bundler' } as const;
  if (SUPPORTED_BUNDLERS.has(bundler)) {
    return {
      ...base,
      status: 'supported',
      reason: `${bundler} — dev server and HMR are drivable.`,
      evidence: [{ label: 'Detected bundler', detail: bundler }],
    };
  }
  return {
    ...base,
    status: 'unsupported',
    reason: 'HyperIDE could not detect a supported framework in this project.',
    evidence: [
      { label: 'Detected bundler', detail: 'unknown' },
      { label: 'Supported', detail: 'Vite, CRA, webpack, Next.js, Remix, Bun' },
      { label: 'Why', detail: 'Without a known bundler the preview dev server cannot be started.' },
    ],
  };
}

// ── styleSystem dimension (EDIT gate; never a hard unsupported) ───────────────

function classifyStyleSystem(cssSystems: CssSystem[]): SupportDimension {
  const base = { id: 'styleSystem', title: 'Style system' } as const;
  if (cssSystems.length === 0) {
    return {
      ...base,
      status: 'unknown',
      reason: 'No CSS system detected.',
      evidence: [{ label: 'Detected', detail: 'none' }],
    };
  }

  const editable = cssSystems.filter((s) => WRITABLE_CSS_SYSTEMS.has(s));
  const inspectOnly = cssSystems.filter((s) => INSPECT_ONLY_CSS_SYSTEMS.has(s));
  const detail = { label: 'Detected', detail: cssSystems.join(', ') };

  // CSS-in-JS present → inspect-only. NEVER 'unsupported' (standing directive: these
  // render + inspect today and full edit is in progress).
  if (inspectOnly.length > 0) {
    return {
      ...base,
      status: 'inspect-only',
      reason: `Inspect now, full edit in progress: ${inspectOnly.join(', ')}.`,
      evidence: [
        detail,
        { label: 'Inspect-only', detail: inspectOnly.join(', ') },
        ...(editable.length > 0 ? [{ label: 'Editable now', detail: editable.join(', ') }] : []),
      ],
    };
  }

  return {
    ...base,
    status: 'supported',
    reason: `Editable via AST: ${editable.join(', ')}.`,
    evidence: [detail],
  };
}

// ── router + packageManager (informational) ──────────────────────────────────

function classifyRouter(): SupportDimension {
  return {
    id: 'router',
    title: 'Router',
    status: 'supported',
    reason: 'The /test-preview route is patched automatically.',
    evidence: [{ label: 'Route', detail: '/test-preview (auto-managed)' }],
  };
}

function classifyPackageManager(pm: SupportFacts['packageManager']): SupportDimension {
  return {
    id: 'packageManager',
    title: 'Package manager',
    status: 'supported',
    reason: `${pm} is supported.`,
    evidence: [{ label: 'Detected', detail: pm }],
  };
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Classify all five support dimensions for a (sub-)repo. PURE — no fs. The spec strings
 * and the status rules live here; gatherSupportDimensions feeds it real facts.
 */
export function classifySupportDimensions(facts: SupportFacts): SupportDimension[] {
  return [
    classifyFramework(facts.frameworkGate),
    classifyBundler(facts.bundler),
    classifyStyleSystem(facts.cssSystems),
    classifyRouter(),
    classifyPackageManager(facts.packageManager),
  ];
}

/** Severity order — higher = worse. Drives overall + which dimensions become tabs. */
const STATUS_SEVERITY: Record<SupportStatus, number> = {
  supported: 0,
  unknown: 1,
  'inspect-only': 2,
  'needs-setup': 3,
  unsupported: 4,
};

/** Statuses that surface as a dimension tab (a table of WHY). */
function isBlocking(status: SupportStatus): boolean {
  return status === 'unsupported' || status === 'needs-setup';
}

/**
 * The dimensions that become tabs: only the blocking ones (unsupported | needs-setup),
 * worst-first. inspect-only / unknown / supported never tab.
 */
export function selectDimensionTabs(dims: SupportDimension[]): SupportDimension[] {
  return dims.filter((d) => isBlocking(d.status)).sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);
}

/** Overall status = the worst of the dimensions. */
export function overallSupportStatus(dims: SupportDimension[]): SupportStatus {
  let worst: SupportStatus = 'supported';
  for (const d of dims) {
    if (STATUS_SEVERITY[d.status] > STATUS_SEVERITY[worst]) worst = d.status;
  }
  return worst;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Companion re-exports: consumers of the classifier annotate its results
 * (a dimension and its WHY-table rows) from this module without also
 * importing ../types.
 * @public
 */
export type { SupportDimension, SupportEvidence };
