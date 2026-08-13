/**
 * @file Shared types for the "New component" flow (HYP-1184).
 *
 * Accessed via: the guided CreateComponentDialog (client), the SaaS server
 *   route (server/routes/createComponent.ts) and the VS Code extension host
 *   (PanelRouter 'component:create'). Single source of truth so ext and SaaS
 *   stay at parity.
 * Assumptions: pure types + UI copy only — safe to import from browser bundles.
 */

/** The three kinds of component a user can create. */
export type ComponentKind = 'atom' | 'composite' | 'page';

export interface CreateComponentRequest {
  kind: ComponentKind;
  /** PascalCase component name, e.g. "ProfileCard". */
  name: string;
  /**
   * Project-root-relative target directory. Optional — when omitted the host
   * picks the conventional directory for the kind (see resolve-target-dir).
   */
  dirPath?: string;
}

export interface CreatedComponent {
  /** Component name as written to disk, e.g. "ProfileCard". */
  name: string;
  /** Project-root-relative file path with forward slashes, e.g. "src/components/ProfileCard.tsx". */
  relativePath: string;
}

/** Plain-language picker copy, shared so both platforms show identical text. */
export const COMPONENT_KIND_META: Record<ComponentKind, { label: string; description: string }> = {
  atom: {
    label: 'Building block',
    description: 'A small reusable piece — like a button, a badge, or an input.',
  },
  composite: {
    label: 'Section',
    description: 'A bigger piece built from smaller ones — like a header, a card, or a pricing table.',
  },
  page: {
    label: 'Page',
    description: 'A full screen people navigate to — like a dashboard or a settings page.',
  },
};

export const COMPONENT_KINDS: ComponentKind[] = ['atom', 'composite', 'page'];
