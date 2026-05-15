/**
 * @file StyleWritePlanner — routing brain that selects the correct framework adapter and writer
 *
 * Accessed via: StyleWriteManager calls selectTarget() before delegating to a writer
 * Assumptions: adapters are registered at construction time and immutable;
 *   inline-style adapter is always present as the universal fallback
 */
import type { CssSystemId, SourceForm, StyleCondition, StyleSourceOwner } from '@lib/style-read/types';
import type { FrameworkStyleAdapter, FrameworkStyleWriter, StyleWriteContext, StyleWritePlanner } from './types';

interface SelectTargetResult {
  adapter: FrameworkStyleAdapter;
  writer: FrameworkStyleWriter;
  sourceOwner: StyleSourceOwner;
}

interface Diagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface SelectTargetResultWithDiagnostics extends SelectTargetResult {
  diagnostics: Diagnostic[];
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function defaultSourceFormForSystem(system: CssSystemId): SourceForm {
  switch (system) {
    case 'tailwind-v3':
    case 'tailwind-v4':
      return 'elementClass';
    case 'css-modules':
    case 'plain-css':
      return 'cssStyleRule';
    case 'inline-style':
    case 'emotion':
    case 'vanilla-extract':
    case 'mui-system':
    case 'mantine':
      return 'scriptReactStyleRule';
    case 'styled-components':
      return 'scriptNativeStyleRule';
    case 'tamagui':
    case 'chakra-ui':
      return 'adapterKnownElementProp';
  }
}

function conditionsMatch(a: StyleCondition, b: StyleCondition): boolean {
  if (a.state !== b.state) return false;
  if (a.viewport?.key !== b.viewport?.key) return false;
  if (a.container?.key !== b.container?.key) return false;
  const aTheme = a.theme?.map((t) => `${t.axis}:${t.value}`).join(',') ?? '';
  const bTheme = b.theme?.map((t) => `${t.axis}:${t.value}`).join(',') ?? '';
  if (aTheme !== bTheme) return false;
  return true;
}

/** Derive a tab-style ID from a source owner for matching against selectedSourceTabId */
function ownerTabId(owner: StyleSourceOwner): string {
  if (owner.selector) {
    const selectorKey = owner.selector.replace(/^\./, '');
    return `${owner.cssSystem}:${selectorKey}`;
  }
  return owner.cssSystem;
}

const TAILWIND_SYSTEMS = new Set<CssSystemId>(['tailwind-v3', 'tailwind-v4']);

export class DefaultStyleWritePlanner implements StyleWritePlanner {
  private adapterMap: Map<CssSystemId, FrameworkStyleAdapter>;

  constructor(adapters: FrameworkStyleAdapter[]) {
    this.adapterMap = new Map(adapters.map((a) => [a.id, a]));
  }

  selectTarget(ctx: StyleWriteContext): SelectTargetResult {
    const result = this.selectTargetWithDiagnostics(ctx);
    return {
      adapter: result.adapter,
      writer: result.writer,
      sourceOwner: result.sourceOwner,
    };
  }

  selectTargetWithDiagnostics(ctx: StyleWriteContext): SelectTargetResultWithDiagnostics {
    const diagnostics: Diagnostic[] = [];
    const { elementFacts, selectedSourceTabId, condition, requestedStyles } = ctx;
    const requestedKebabKeys = Object.keys(requestedStyles).map(camelToKebab);

    // Step 1: Explicit source tab — match by full tab identity, then fall back to system prefix
    if (selectedSourceTabId) {
      const exactTabMatch = elementFacts.sourceOwners.find((owner) => ownerTabId(owner) === selectedSourceTabId);
      const systemPrefixMatch =
        exactTabMatch ??
        elementFacts.sourceOwners.find((owner) => owner.cssSystem === selectedSourceTabId.split(':')[0]);
      const matchedOwner = exactTabMatch ?? systemPrefixMatch;

      if (matchedOwner) {
        const result = this.resolveAdapterWriter(matchedOwner.cssSystem, matchedOwner, diagnostics);
        if (result) return result;
      }
    }

    // Step 2: Existing exact owner — property + full condition match
    for (const owner of elementFacts.sourceOwners) {
      if (owner.confidence !== 'exact') continue;
      if (!conditionsMatch(owner.condition, condition)) continue;

      const ownerMatchesProperty = requestedKebabKeys.includes(owner.property);
      if (!ownerMatchesProperty) continue;

      // Case C: Mixed Tailwind + CSS Modules conflict — CSS Modules wins as the explicit semantic owner
      if (owner.cssSystem === 'css-modules' || owner.cssSystem === 'plain-css') {
        const tailwindOwner = elementFacts.sourceOwners.find(
          (o) =>
            TAILWIND_SYSTEMS.has(o.cssSystem) &&
            o.confidence === 'exact' &&
            o.property === owner.property &&
            conditionsMatch(o.condition, condition),
        );

        if (tailwindOwner) {
          diagnostics.push({
            level: 'warning',
            message: 'Property also defined by Tailwind class. Inspector wrote to .module.css owner.',
          });
        }
      }

      // If Tailwind owner comes first in the array but CSS Modules also owns the property,
      // skip Tailwind so the loop continues to the CSS Modules owner
      if (TAILWIND_SYSTEMS.has(owner.cssSystem)) {
        const cssModulesOwner = elementFacts.sourceOwners.find(
          (o) =>
            o.cssSystem === 'css-modules' &&
            o.confidence === 'exact' &&
            o.property === owner.property &&
            conditionsMatch(o.condition, condition),
        );

        if (cssModulesOwner) {
          continue;
        }
      }

      const result = this.resolveAdapterWriter(owner.cssSystem, owner, diagnostics);
      if (result) return result;
    }

    // Step 3: Element primary system — exactly one system
    if (elementFacts.elementCssSystems.length === 1) {
      const system = elementFacts.elementCssSystems[0];
      const syntheticOwner = this.createSyntheticOwner(system, requestedKebabKeys[0], ctx);
      const result = this.resolveAdapterWriter(system, syntheticOwner, diagnostics);
      if (result) return result;
    }

    // Step 4: Mixed system — Tailwind priority for new properties
    if (elementFacts.elementCssSystems.length > 1) {
      const tailwindSystem = elementFacts.elementCssSystems.find((s) => TAILWIND_SYSTEMS.has(s));
      if (tailwindSystem) {
        const hasExactOwnerForRequested = elementFacts.sourceOwners.some(
          (o) =>
            o.confidence === 'exact' &&
            conditionsMatch(o.condition, condition) &&
            requestedKebabKeys.includes(o.property),
        );

        if (!hasExactOwnerForRequested) {
          const syntheticOwner = this.createSyntheticOwner(tailwindSystem, requestedKebabKeys[0], ctx);
          const result = this.resolveAdapterWriter(tailwindSystem, syntheticOwner, diagnostics);
          if (result) return result;
        }
      }
    }

    // Step 5: Project primary system
    const projectSystems = ctx.projectCapabilities.projectCssSystems;
    if (projectSystems.length > 0) {
      // Prefer Tailwind, then CSS Modules, then first available
      const preferredSystem =
        projectSystems.find((s) => TAILWIND_SYSTEMS.has(s)) ??
        projectSystems.find((s) => s === 'css-modules') ??
        projectSystems[0];

      const syntheticOwner = this.createSyntheticOwner(preferredSystem, requestedKebabKeys[0], ctx);
      const result = this.resolveAdapterWriter(preferredSystem, syntheticOwner, diagnostics);
      if (result) return result;
    }

    // Step 6: Inline fallback
    return this.createInlineFallback(requestedKebabKeys[0], ctx, diagnostics);
  }

  private resolveAdapterWriter(
    system: CssSystemId,
    owner: StyleSourceOwner,
    diagnostics: Diagnostic[],
  ): SelectTargetResultWithDiagnostics | undefined {
    const adapter = this.adapterMap.get(system);
    if (!adapter?.writer) return undefined;

    return {
      adapter,
      writer: adapter.writer,
      sourceOwner: owner,
      diagnostics,
    };
  }

  private createSyntheticOwner(system: CssSystemId, firstProperty: string, ctx: StyleWriteContext): StyleSourceOwner {
    return {
      cssSystem: system,
      sourceForm: defaultSourceFormForSystem(system),
      filePath: ctx.elementFacts.sourceOwners[0]?.filePath ?? '',
      elementRef: ctx.elementFacts.sourceOwners[0]?.elementRef,
      property: firstProperty,
      condition: ctx.condition,
      confidence: 'exact',
    };
  }

  private createInlineFallback(
    firstProperty: string,
    ctx: StyleWriteContext,
    diagnostics: Diagnostic[],
  ): SelectTargetResultWithDiagnostics {
    const adapter = this.adapterMap.get('inline-style');
    if (!adapter?.writer) {
      throw new Error('inline-style adapter must be registered as the universal fallback');
    }

    const fallbackOwner: StyleSourceOwner = {
      cssSystem: 'inline-style',
      sourceForm: 'scriptReactStyleRule',
      filePath: ctx.elementFacts.sourceOwners[0]?.filePath ?? '',
      property: firstProperty,
      condition: ctx.condition,
      confidence: 'computed-only',
    };

    return {
      adapter,
      writer: adapter.writer,
      sourceOwner: fallbackOwner,
      diagnostics,
    };
  }
}
