/**
 * @file StyleWritePlanner — routing brain that selects the correct framework adapter and writer
 *
 * Accessed via: StyleWriteManager calls selectTarget() before delegating to a writer
 * Assumptions: adapters are registered at construction time and immutable;
 *   inline-style adapter is always present as the universal fallback
 */
import type { CssSystemId, SourceForm, StyleCondition, StyleSourceOwner } from '@lib/style-read/types';
import type { FrameworkStyleAdapter, FrameworkStyleWriter, StyleWriteContext, StyleWritePlanner } from './types';
import { camelToKebab } from './utils';

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

/**
 * Map a CSS system to the transport `SourceForm` its writes physically take when no
 * existing owner dictates one — i.e. the "where the value lives" half of the §7.3 style
 * identity tuple. Tailwind → `elementClass` (className), CSS Modules / plain CSS →
 * `cssStyleRule` (a rule in a `.css` file), inline / emotion / vanilla-extract / MUI /
 * Mantine → `scriptReactStyleRule` (a JS style object), styled-components →
 * `scriptNativeStyleRule`, Tamagui / Chakra → `adapterKnownElementProp` (a JSX prop).
 * Used only to synthesize an owner (steps 3-5) when none was found.
 */
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

/**
 * The write-routing brain: given a write request, decide WHICH CSS system / adapter
 * writer + source owner the edit should land on. This is the AS-IS realization of the
 * priority chain from master-spec §7.1 (resolved per property / per state), collapsed
 * to the channels available today. The selected target is then handed to that writer to
 * MAP into a frozen plan ("frozen plan, dumb dispatch", §7.4).
 *
 * USER-IMPACT: decides where an inspector style edit is written — into a Tailwind class,
 * a `.module.css` rule, a Tamagui prop, or an inline `style={{}}` — and therefore both
 * the file that changes and the blast radius of the change.
 */
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

  /**
   * Resolve the write target via the ordered priority chain, recording any
   * blast-radius / ambiguity warnings as diagnostics. Steps, most-preferred first:
   *
   *   1. Explicit selected source tab — honor what the user picked in the inspector
   *      (exact tab identity, else system prefix).
   *   2. Existing exact owner — an owner that already declares this `(property,
   *      condition)` with `confidence:'exact'`. Edit-in-place of the incumbent.
   *   3. Element primary system — the element uses exactly one CSS system: write there.
   *   4. Mixed system, new property — Tailwind wins for a property no owner declares yet.
   *   5. Project primary system — prefer Tailwind, then CSS Modules, then first available.
   *   6. Inline fallback — the universal floor (spec §8.3): inline `style={{}}`.
   *
   * OWNERSHIP / COLLISION (the load-bearing case in step 2): when BOTH a Tailwind class
   * and a CSS-Modules/plain-CSS rule own the same `(property, condition)`, CSS Modules is
   * treated as the explicit semantic owner and WINS — Tailwind owners are skipped so the
   * loop falls through to the module owner, and a `warning` diagnostic tells the user the
   * Tailwind class still also defines this property. This avoids a silent split where the
   * inspector edits one channel while the cascade is actually driven by the other. The
   * realm/source-form mapping (system → `SourceForm`) is owned by
   * {@link defaultSourceFormForSystem}.
   */
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

  /**
   * Fabricate a source owner for a system that has no existing incumbent owner for the
   * requested property (chain steps 3-5). Confidence is `exact` because the system was
   * positively detected on the element/project; the source form comes from
   * {@link defaultSourceFormForSystem}, and the file/element ref is borrowed from any
   * existing owner so the writer knows which node to target.
   */
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

  /**
   * The universal floor (chain step 6, spec §8.3): when no CSS system can be resolved,
   * route to the inline-style writer so an edit always has SOME landing target. The
   * synthetic owner's confidence is `computed-only` to signal this is a fallback, not a
   * located source. Throws if the inline-style adapter was not registered — it is a
   * hard invariant that it always is (see createDefaultStyleWriteManager).
   */
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
