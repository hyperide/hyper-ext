/**
 * @file Builds StyleWriteContext objects from platform style update requests
 *
 * Accessed via: SaaS and VS Code updateStyles handlers before calling StyleWriteManager
 * Assumptions: real source-owner facts will supersede this request-derived context
 *   once StyleReadManager is wired into the platform boundary.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type {
  CssModuleClassReference,
  CssSystemId,
  ProjectStyleCapabilities,
  RuntimeThemeContext,
  SourceForm,
  StyleCondition,
  StylePseudoState,
  StyleSourceOwner,
} from '@lib/style-read/types';
import type { StyleWriteContext } from './types';
import { camelToKebab } from './utils';

const REQUEST_ROUTABLE_SYSTEMS = new Set<CssSystemId>(['tailwind-v4', 'css-modules', 'inline-style']);
/**
 * Non-routable sentinels: no explicit write target → fall back to per-element edit-in-place.
 * 'auto' is the multi-select intent chip (D2 §4); it is treated identically to 'computed'.
 */
const NON_ROUTABLE_SENTINEL_TABS = new Set(['computed', 'auto']);
const PSEUDO_STATES = new Set<StylePseudoState>(['base', 'hover', 'focus', 'active', 'focus-visible', 'disabled']);

const DEFAULT_RUNTIME_THEME_CONTEXT: RuntimeThemeContext = {
  ideThemePreference: 'system',
  resolvedColorScheme: 'light',
  source: 'app-runtime',
};

export interface StyleWriteRequestContextInput {
  filePath: string;
  elementRef: string;
  tagName?: string;
  styles: Record<string, string>;
  selectedSourceTabId?: string;
  state?: string;
  runtimeThemeContext?: RuntimeThemeContext;
  sourceOwners?: StyleSourceOwner[];
  elementCssSystems?: CssSystemId[];
  projectCssSystems?: CssSystemId[];
  /**
   * UIKit-derived project default for a surfaceless element (D2 §4.3). Used ONLY as the floor
   * when the element owns no concrete system — edit-in-place (elementCssSystems[0]) still wins.
   * Threaded from the client (tailwind → tailwind-v4, tamagui → tamagui, else inline-style).
   */
  projectDefaultCssSystem?: CssSystemId;
}

export interface CssModuleSourceOwnersInput {
  references: CssModuleClassReference[];
  selectedSourceTabId?: string;
  elementRef: string;
  styles: Record<string, string>;
  state?: string;
}

function sourceFormForSystem(system: CssSystemId): SourceForm {
  if (system === 'tailwind-v3' || system === 'tailwind-v4') return 'elementClass';
  if (system === 'css-modules' || system === 'plain-css') return 'cssStyleRule';
  return 'scriptReactStyleRule';
}

function conditionFromState(state: string | undefined): StyleCondition {
  if (state && PSEUDO_STATES.has(state as StylePseudoState)) {
    return { state: state as StylePseudoState };
  }

  return { state: 'base' };
}

function capabilitiesForSystem(system: CssSystemId): ProjectStyleCapabilities {
  return {
    projectCssSystems: [system],
    projectUiKits: [],
    componentPropMappers: [],
    cssSyntaxes: ['css'],
    projectThemeCapabilities: { axes: [], mechanisms: [], tokenSources: [] },
    packageEvidence: [],
    configEvidence: [],
    sourceEvidence: [],
  };
}

function createSyntheticOwner(input: StyleWriteRequestContextInput, cssSystem: CssSystemId): StyleSourceOwner {
  const condition = conditionFromState(input.state);
  const firstProperty = camelToKebab(Object.keys(input.styles)[0] ?? '');
  return {
    cssSystem,
    sourceForm: sourceFormForSystem(cssSystem),
    filePath: input.filePath,
    elementRef: input.elementRef,
    property: firstProperty,
    condition,
    confidence: 'probable',
  };
}

function sourceOwnersFromInput(input: StyleWriteRequestContextInput, cssSystem: CssSystemId): StyleSourceOwner[] {
  const sourceOwners = input.sourceOwners ?? [];
  if (sourceOwners.some((owner) => owner.cssSystem === cssSystem)) {
    return sourceOwners;
  }

  return [...sourceOwners, createSyntheticOwner(input, cssSystem)];
}

/**
 * Extract the explicitly routable CSS system from a selected source tab id
 * (`<system>:<sourceId>`), or undefined when the tab is a non-routable sentinel
 * (`computed`/`auto`) or an unknown system. Only tailwind-v4 / css-modules / inline-style
 * are request-routable today; an undefined result tells the caller to run the priority
 * cascade ({@link resolveWriteCascade}) instead of honoring an explicit tab.
 */
export function getRequestRoutableCssSystem(selectedSourceTabId: string | undefined): CssSystemId | undefined {
  const system = selectedSourceTabId?.split(':')[0] as CssSystemId | undefined;
  if (system && REQUEST_ROUTABLE_SYSTEMS.has(system)) return system;
  return undefined;
}

/**
 * One step of the D2 priority cascade — which rung of the ladder the write actually landed on.
 * 'element' = edit-in-place; 'project-default' = UIKit-derived priority system; 'project-system' =
 * a detected (non-UIKit) project system; 'inline' = the universal last rung (CTO 2026-06-11).
 */
type WriteCascadeStep = 'element' | 'project-default' | 'project-system' | 'inline';

export interface WriteCascadeResult {
  /** The system the write lands in. ALWAYS defined — the cascade never refuses to write (CTO 2026-06-11). */
  system: CssSystemId;
  /** Which rung resolved it (drives the "where it landed" transparency badge, D2 §4.4). */
  step: WriteCascadeStep;
  /** true when the write did NOT land on the element's own system (a lower-priority rung). */
  isFallback: boolean;
  /**
   * true ONLY for the genuine "project has no styling system at all" case: no element system, no
   * UIKit default, no detected project system. The client should prompt ("set up Tailwind?") before
   * accepting the inline floor; declined → inline (the `system` already returned here). Never a skip.
   */
  needsProjectSystemPrompt?: boolean;
}

/**
 * D2 priority cascade (CTO 2026-06-11) — resolves the write target so the writer ALWAYS lands a
 * value; "unknown" / surfaceless is never a skip. Priority order, per the HYP-581 comment:
 *   element-own system → project priority (UIKit) default → detected project system →
 *   (no system at all → prompt the user; declined →) inline.
 * inline is a legitimate last rung, not dirt. The only real skip is STALE/safety, handled upstream
 * at the source-resolution boundary (the route), not here.
 */
export function resolveWriteCascade(input: StyleWriteRequestContextInput): WriteCascadeResult {
  const elementSystem = input.elementCssSystems?.[0];
  if (elementSystem) {
    return { system: elementSystem, step: 'element', isFallback: false };
  }

  if (input.projectDefaultCssSystem) {
    return { system: input.projectDefaultCssSystem, step: 'project-default', isFallback: true };
  }

  const detectedProjectSystem = input.projectCssSystems?.[0];
  if (detectedProjectSystem) {
    return { system: detectedProjectSystem, step: 'project-system', isFallback: true };
  }

  // No element system, no UIKit default, no detected project system — the project genuinely has no
  // styling system. Floor to inline so the write still lands, and signal the client to offer "set up
  // Tailwind?" before accepting it. Inline here is the declined-floor, never a skip.
  return { system: 'inline-style', step: 'inline', isFallback: true, needsProjectSystemPrompt: true };
}

function resolveRequestCssSystem(input: StyleWriteRequestContextInput): CssSystemId {
  const selectedSystem = getRequestRoutableCssSystem(input.selectedSourceTabId);
  if (selectedSystem) return selectedSystem;

  if (input.selectedSourceTabId && !NON_ROUTABLE_SENTINEL_TABS.has(input.selectedSourceTabId)) {
    throw new Error(`Unsupported style source tab for request routing: ${input.selectedSourceTabId}`);
  }

  // Auto / computed → run the priority cascade. Edit-in-place wins; surfaceless cascades down to the
  // project default, a detected project system, and finally inline (CTO 2026-06-11 — always writes,
  // never a silent skip). The cascade step + isFallback are surfaced separately for the badge.
  return resolveWriteCascade(input).system;
}

/**
 * Turn the CSS-Modules class references found on an element (from
 * {@link getCssModuleClassReferences}) into `exact` source owners the planner can write to —
 * one per referenced module class, carrying its `.css` file path + selector. When the user
 * picked a specific `css-modules:<classKey>` tab, only that class's references are kept so the
 * edit lands on the chosen rule rather than every module class on the element.
 */
export function createCssModuleSourceOwnersFromReferences(input: CssModuleSourceOwnersInput): StyleSourceOwner[] {
  const selectedClassKey = input.selectedSourceTabId?.startsWith('css-modules:')
    ? input.selectedSourceTabId.slice('css-modules:'.length)
    : undefined;
  const references = selectedClassKey
    ? input.references.filter((reference) => reference.classKey === selectedClassKey)
    : input.references;
  const property = camelToKebab(Object.keys(input.styles)[0] ?? '');
  const condition = conditionFromState(input.state);

  return references.map((reference) => ({
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    cssSyntax: reference.cssSyntax,
    filePath: reference.cssFilePath,
    elementRef: input.elementRef,
    selector: reference.selector,
    property,
    condition,
    confidence: 'exact',
  }));
}

/**
 * Assemble the {@link StyleWriteContext} the StyleWriteManager/planner consume from a raw
 * platform update request: resolve the target CSS system (explicit tab, else the D2 priority
 * cascade), normalize the state into a condition, ensure a source owner exists for that system
 * (synthesizing a `probable` one if the request carried none), and project the capability set.
 * This is the bridge from a thin transport request to the rich context the write pipeline needs;
 * once StyleReadManager is wired at the platform boundary, real owner facts supersede the
 * synthesized ones (see file header).
 */
export function createStyleWriteContextFromRequest(input: StyleWriteRequestContextInput): StyleWriteContext {
  const cssSystem = resolveRequestCssSystem(input);
  const condition = conditionFromState(input.state);
  const sourceOwners = sourceOwnersFromInput(input, cssSystem);
  const projectCssSystems = input.projectCssSystems ?? [...new Set([cssSystem, ...(input.elementCssSystems ?? [])])];

  return {
    projectCapabilities: {
      ...capabilitiesForSystem(cssSystem),
      projectCssSystems,
    },
    elementFacts: {
      elementCssSystems: input.elementCssSystems ?? [cssSystem],
      elementUiKits: [],
      elementPropMappers: [],
      sourceOwners,
      componentFacts: input.tagName ? { intrinsicElement: input.tagName } : undefined,
    },
    runtimeThemeContext: input.runtimeThemeContext ?? DEFAULT_RUNTIME_THEME_CONTEXT,
    selectedSourceTabId: input.selectedSourceTabId,
    condition,
    requestedStyles: input.styles,
  };
}
