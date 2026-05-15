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

const REQUEST_ROUTABLE_SYSTEMS = new Set<CssSystemId>(['tailwind-v4', 'css-modules', 'inline-style']);
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
}

export interface CssModuleSourceOwnersInput {
  references: CssModuleClassReference[];
  selectedSourceTabId?: string;
  elementRef: string;
  styles: Record<string, string>;
  state?: string;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
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

export function getRequestRoutableCssSystem(selectedSourceTabId: string | undefined): CssSystemId | undefined {
  const system = selectedSourceTabId?.split(':')[0] as CssSystemId | undefined;
  if (system && REQUEST_ROUTABLE_SYSTEMS.has(system)) return system;
  return undefined;
}

function resolveRequestCssSystem(input: StyleWriteRequestContextInput): CssSystemId {
  const selectedSystem = getRequestRoutableCssSystem(input.selectedSourceTabId);
  if (selectedSystem) return selectedSystem;

  if (input.selectedSourceTabId && input.selectedSourceTabId !== 'computed') {
    throw new Error(`Unsupported style source tab for request routing: ${input.selectedSourceTabId}`);
  }

  return input.elementCssSystems?.[0] ?? input.projectCssSystems?.[0] ?? 'inline-style';
}

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
