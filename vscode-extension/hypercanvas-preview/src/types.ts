/**
 * Types for HyperCanvas VS Code Extension
 * Defines messages, project types, and shared interfaces
 */

import type { CssSystemId } from '@lib/style-read/types';
import type { I18nLibrary } from '../../../shared/i18n-text/types';
import type { ColorProbeCandidate } from './services/color-probe-types';

// ============================================
// Project Detection
// ============================================

export type ProjectType = 'vite' | 'nextjs' | 'cra' | 'remix' | 'webpack' | 'bun' | 'unknown';

/** Monorepo topology of the workspace */
export type RepoType = 'simple' | 'mono-nx' | 'mono-turbo' | 'mono-pnpm' | 'mono-lerna' | 'mono-generic';

export interface ProjectInfo {
  type: ProjectType;
  devCommand: string;
  defaultPort: number;
  hasTypeScript: boolean;
}

// ============================================
// Unsupported Project Detection
// ============================================

/**
 * Describes a project/component state that the preview cannot render directly.
 * Drives a full-panel blocking screen via the projectError channel.
 */
export interface UnsupportedProjectError {
  /**
   * Discriminant for the blocking-screen category.
   * - 'react-native': renders only after adding react-native-web (offers a fix button).
   * - 'framework': no supported bundler/framework detected — shows the framework
   *   compatibility table instead of a fix button (HYP-442; replaces the old toast).
   *
   * Cross-package library components are no longer a blocking category: they render
   * and edit directly via the re-rooted app target (HYP-443).
   */
  type: 'react-native' | 'framework';
  /** Human-readable explanation shown in the error screen */
  message: string;
  /** Button label for the fix action (e.g. "Fix: Add react-native-web"). Omitted for non-fix screens. */
  fixLabel?: string;
}

/**
 * The opened file cannot be previewed as a component — a ReactDOM entry/bootstrap
 * (`main.tsx`) or any file with no renderable component export. Drives the
 * NonPreviewableFileOverlay (clear error + clickable recommendations) instead of the
 * iframe's infinite "Generating sample…" spinner. Posted to the webview as
 * `previewUnsupportedFile`; cleared by passing null.
 */
export interface NonPreviewableFilePayload {
  /** Project-relative path of the opened, non-previewable file. */
  filePath: string;
  reason: 'entry-file' | 'no-renderable-export';
  /** Renderable component files to recommend, already ranked + capped by the host. */
  recommendations: Array<{ path: string; name: string }>;
}

// ============================================
// Project Capabilities (readonly mode)
// ============================================

/** Detected CSS system in the project */
export type CssSystem =
  | 'tailwind'
  | 'cssmodules'
  | 'styled-components'
  | 'emotion'
  | 'tamagui'
  | 'vanilla-extract'
  | 'pandacss'
  | 'unocss'
  | 'stylex'
  | 'mui'
  | 'antd'
  | 'chakra'
  | 'mantine'
  | 'fluentui'
  | 'nextui'
  | 'daisyui'
  | 'shadcn'
  | 'sass'
  | 'unknown';

/**
 * Maps a detected ext-side {@link CssSystem} to the lib-side `CssSystemId` whose adapter would OWN
 * its writes (or `null` when no `CssSystemId`/adapter concept applies). This is the enum-translation
 * the registry-derived writable gate consults; whether a system is actually editable is then derived
 * from the writer registry (`getWriterBackedCssSystemIds`), NEVER hand-listed here.
 *
 * Ownership-collision rationale (spec §0.3 rule 3 — this map crosses capability domains):
 * - cssFramework vs designSystem (§5.5): the ext `CssSystem` enum folds design systems
 *   (mui/chakra/mantine) and utility layers (daisyui/shadcn) into single detection ids, while the lib
 *   `CssSystemId` keys adapters by authoring channel. `shadcn`/`daisyui` resolve to `tailwind-v4`
 *   because they are className/utility layers ON Tailwind (§5.5: "shadcn is a design system ... it
 *   sits on top of Tailwind") — their writes land through the Tailwind writer, so they stay writable.
 * - typed-but-unbuilt systems (§3.3 / D31): emotion, styled-components, mui→`mui-system`,
 *   chakra→`chakra-ui`, mantine, vanilla-extract map to their OWN ids, which have a type and a default
 *   `sourceForm` but no writer — so the gate reports them NOT-writable (honest readonly) until their
 *   adapters land (Phase C+), instead of silently polluting the file with an inline write.
 * - no-channel systems → `null`: atomic/utility CSS without a JSX-object channel (pandacss, unocss,
 *   stylex) and design systems with no `CssSystemId` (antd, fluentui, nextui) have no native write
 *   target here. `sass` maps to `plain-css`, which is also writer-less today, so it is honest-readonly
 *   too (the same class of lie as emotion: className → stylesheet rule, no `.scss` writer exists).
 */
export const CSS_SYSTEM_TO_ADAPTER_ID: Record<CssSystem, CssSystemId | null> = {
  tailwind: 'tailwind-v4',
  cssmodules: 'css-modules',
  'styled-components': 'styled-components', // typed-only, no writer → readonly (§3.3 / D31)
  emotion: 'emotion', // typed-only, no writer → readonly (§3.3 / D31)
  tamagui: 'tamagui',
  'vanilla-extract': 'vanilla-extract', // typed-only, no writer → readonly
  pandacss: null, // atomic/utility CSS; no dedicated CssSystemId/adapter
  unocss: null, // atomic/utility CSS; no dedicated CssSystemId/adapter
  stylex: null, // compile-time atomic; not in the 12-id taxonomy
  mui: 'mui-system', // typed-only, no writer → readonly
  antd: null, // ant-design; not in the 12-id taxonomy
  chakra: 'chakra-ui', // typed-only, no writer → readonly
  mantine: 'mantine', // typed-only, no writer → readonly
  fluentui: null, // designSystem; no CssSystemId/adapter
  nextui: null, // designSystem; no CssSystemId/adapter
  daisyui: 'tailwind-v4', // built on Tailwind → Tailwind writer (stays writable)
  shadcn: 'tailwind-v4', // design system on Tailwind (§5.5) → Tailwind writer (stays writable)
  sass: 'plain-css', // className/stylesheet; plain-css has no writer → readonly
  unknown: null,
};

// ============================================
// Support Dimensions (per-(sub-)repo support breakdown — HYP-788)
// ============================================

/**
 * Support status for a single dimension of a project, worst-to-best:
 * - 'unsupported': HyperIDE cannot handle this dimension at all (Vue render gate,
 *   unknown bundler). A hard block — surfaced as a dimension tab.
 * - 'needs-setup': supported once a one-time fix is applied (react-native-web, a
 *   /test-preview route patch). Surfaced as a dimension tab (often with a Fix action).
 * - 'inspect-only': renders + inspects today, full edit in progress. CSS-in-JS systems
 *   (MUI/Chakra/Mantine/…) live here — NOT a hard "unsupported"/readonly. NOT a tab.
 * - 'supported': fully works.
 * - 'unknown': could not be determined (e.g. no CSS system detected). NOT a tab.
 */
export type SupportStatus = 'supported' | 'inspect-only' | 'needs-setup' | 'unsupported' | 'unknown';

/**
 * The five support dimensions classified per (sub-)repo. Public vocabulary
 * keyed by {@link SupportDimension.id}.
 * @public
 */
export type SupportDimensionId = 'framework' | 'bundler' | 'styleSystem' | 'router' | 'packageManager';

/** A single row in a dimension's WHY table — what was detected and where. */
export interface SupportEvidence {
  /** Short label for the row (e.g. "Detected framework", "Dependency", "Why"). */
  label: string;
  /** The value / explanation for the label. */
  detail: string;
}

/**
 * One dimension's support classification — {status, reason, evidence} — for the
 * currently-open (sub-)repo. Rendered as a tab (a table of WHY) when the status is a
 * blocking one (unsupported | needs-setup). See lib `support-dimensions.ts`.
 */
export interface SupportDimension {
  id: SupportDimensionId;
  /** Human-readable tab title (e.g. "Framework", "Build / Bundler", "Style system"). */
  title: string;
  status: SupportStatus;
  /** One-line reason for the status — the dimension's headline. */
  reason: string;
  /** Table rows explaining the classification. */
  evidence: SupportEvidence[];
  /** Optional auto-fix action label for needs-setup (e.g. "Fix: Add react-native-web"). */
  fixLabel?: string;
}

/** What the extension can do with this project */
export interface ProjectCapabilities {
  /** Detected CSS framework */
  cssSystem: CssSystem;
  /** Detected UI kit ('tailwind' | 'tamagui' | 'none') — backward compat */
  uiKit: 'tailwind' | 'tamagui' | 'none';
  /** Detected project/bundler type */
  projectType?: ProjectType;
  /** Monorepo topology of the workspace */
  repoType?: RepoType;
  /** Whether the extension can write styles (AST mutations) */
  canWriteStyles: boolean;
  /** Whether the preview can render (Vite/webpack dev server works) */
  canRender: boolean;
  /** If true, show readonly badge instead of full editing UI */
  readonly: boolean;
  /**
   * Per-(sub-)repo support breakdown across the five dimensions (HYP-788). Additive:
   * absent on older hosts. The webview renders one tab per blocking dimension
   * (unsupported | needs-setup) — a table of WHY — for the currently-open repo / active
   * monorepo sub-repo. The whole-monorepo traversal is explicitly NOT this feature.
   */
  supportDimensions?: SupportDimension[];
}

// ============================================
// Dev Server
// ============================================

export type DevServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface DevServerState {
  status: DevServerStatus;
  port?: number;
  url?: string;
  error?: string;
  /**
   * HYP-370 Phase 3 — explicit recompile sub-state. True while a webpack/parcel
   * recompile gate is armed (after an entry-file patch, before the fresh
   * `compiled successfully`). `status` stays `running`; this flag lets consumers
   * distinguish stable-serving from mid-recompile without reaching into the gate
   * promise. Additive/optional — absence means "not recompiling".
   */
  recompiling?: boolean;
}

// ============================================
// Platform Messages (webview <-> extension)
// ============================================

// AST operations (local). The rest of the legacy webview message protocol
// (EditorMessage, ComponentMessage, the *Response/*Delta/*Tool interfaces, and
// the PlatformMessage union) was removed in HYP-489: it was an orphaned parallel
// definition superseded by @/lib/platform/types (PlatformMessage) and the
// per-bridge message types (EditorBridge.ts's own EditorMessage). AstMessage /
// AstResponse below remain because PanelRouter and AstBridge import them.
export type AstMessage =
  | {
      type: 'ast:updateStyles';
      requestId: string;
      filePath: string;
      elementId: string;
      styles: Record<string, string>;
      state?: string; // hover, focus, etc.
      selectedSourceTabId?: string;
      domClasses?: string; // Live applied className from the DOM (HYP-544) — authoritative replace target
      // HYP-544 Phase 3: ranked driving candidates from the empirical color-probe (set by PanelRouter
      // when the color source is unresolvable). Redirects an inline/var/module-driven write to an
      // inline-style override (a twMerge wrap can't change inline/var-driven colors).
      probeDriving?: ColorProbeCandidate[];
    }
  | {
      type: 'ast:updateProps';
      requestId: string;
      filePath: string;
      elementId: string;
      props: Record<string, unknown>;
    }
  | {
      type: 'ast:insertElement';
      requestId: string;
      filePath: string;
      parentId: string | null;
      componentType: string;
      props: Record<string, unknown>;
      index?: number;
      targetId?: string;
      componentFilePath?: string;
    }
  | {
      type: 'ast:deleteElements';
      requestId: string;
      filePath: string;
      elementIds: string[];
    }
  | {
      type: 'ast:duplicateElement';
      requestId: string;
      filePath: string;
      elementId: string;
    }
  | {
      type: 'ast:updateText';
      requestId: string;
      filePath: string;
      elementId: string;
      text: string;
    }
  | {
      type: 'ast:wrapElement';
      requestId: string;
      filePath: string;
      elementId: string;
      wrapperType: string;
      wrapperProps?: Record<string, unknown>;
    }
  | {
      /**
       * Move a JSX element from any place to any place.
       * Source and target need NOT share a JSX parent — same-file, cross-file,
       * cross-component, or leaf-target moves are all supported.
       * See `AstService.moveElement` / `MoveResult` for the contract.
       */
      type: 'ast:moveElement';
      requestId: string;
      /** Hint for resolving sourceId — typically the source's file. */
      filePath: string;
      /** nodeRef of element to move */
      sourceId: string;
      /** nodeRef of element to move relative to (may live in a different file) */
      targetId: string;
      position: 'before' | 'after';
    }
  | {
      /**
       * Swap two JSX elements' positions (visual-foundation spec Part C, Task 8).
       * The container-swap gesture — distinct from `ast:moveElement` (reparent).
       * Same-file only; the two refs may sit in different parents (lifted to the
       * common-ancestor swap unit). See `AstService.swapElements`.
       */
      type: 'ast:swapElements';
      requestId: string;
      /** Hint for resolving the refs — the file both elements live in. */
      filePath: string;
      /** nodeRef of the first element. */
      aId: string;
      /** nodeRef of the second element. */
      bId: string;
    }
  | {
      /** Write a translated value for a given i18n key in the active locale resource file. */
      type: 'ast:writeI18nResource';
      requestId: string;
      /** Ignored — extension uses its own workspace root */
      projectRoot?: string;
      library: I18nLibrary;
      key: string;
      namespace?: string;
      activeLocale: string;
      newText: string;
      /**
       * When the key itself changes (user picks a different key from the dropdown),
       * provide the source file + element so the JSX child expression can be updated.
       */
      filePath?: string;
      elementId?: string;
      previousKey?: string;
      /**
       * When true, skip writing to the locale JSON file and only update the JSX expression.
       * Used when switching to an existing key — we don't want to overwrite its translation.
       */
      skipResourceWrite?: boolean;
    };

// AST response
export interface AstResponse {
  type: 'ast:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Runtime error detected from iframe preview (via PreviewProxy script injection)
export interface DevServerRuntimeError {
  framework: 'nextjs' | 'vite' | 'bun' | 'unknown';
  type: string;
  message: string;
  file?: string;
  line?: number;
  codeframe?: string;
  fullText: string;
}

// ============================================
// Canvas Composition Storage
// ============================================

interface CanvasInstance {
  id: string;
  name: string;
  props: Record<string, unknown>;
}

export interface CanvasComposition {
  componentPath: string;
  instances: CanvasInstance[];
  updatedAt: string;
}

// ============================================
// AI Chat Storage
// ============================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    name: string;
    input: unknown;
    result: unknown;
  }>;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// AST Types (re-exported from lib/types.ts)
// ============================================

export type { SharedEditorState } from '@lib/types';
