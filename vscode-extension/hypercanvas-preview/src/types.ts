/**
 * Types for HyperCanvas VS Code Extension
 * Defines messages, project types, and shared interfaces
 */

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

/** Describes an unsupported project type that can't render in browser without intervention. */
export interface UnsupportedProjectError {
  /** Discriminant for the unsupported project category */
  type: 'react-native';
  /** Human-readable explanation shown in the error screen */
  message: string;
  /** Button label for the fix action (e.g. "Fix: Add react-native-web") */
  fixLabel: string;
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

/** CSS systems where the extension can read AND write styles via AST */
export const WRITABLE_CSS_SYSTEMS: CssSystem[] = [
  'tailwind',
  'cssmodules',
  'styled-components',
  'emotion',
  'tamagui',
  'shadcn', // built on Tailwind
  'daisyui', // built on Tailwind
  'sass', // className-based, same as plain CSS
];

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
