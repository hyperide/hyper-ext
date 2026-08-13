/**
 * @file Shared StyleReadManager orchestration for inspector source tabs and property sources
 *
 * Accessed via: Properties panel style inspector read path in SaaS and VS Code extension
 * Assumptions: framework readers receive already-collected element facts and runtime
 *   context; this manager only routes active adapters and aggregates their canonical facts.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import type {
  AvailableConditionAxes,
  CssSystemId,
  FrameworkReadResult,
  InspectorSurfaceDecision,
  PropertySource,
  SourceClassIdentity,
  StyleCondition,
  StyleReadContext,
  StyleReadManager,
  StyleReadResult,
  StyleSourceOwner,
  StyleSourceTab,
} from './types';

interface StyleReadManagerOptions {
  adapters: FrameworkStyleAdapter[];
}

const computedCondition: StyleCondition = { state: 'base' };

export class DefaultStyleReadManager implements StyleReadManager {
  private readonly adapters: FrameworkStyleAdapter[];

  constructor(options: StyleReadManagerOptions) {
    this.adapters = options.adapters;
  }

  /**
   * The single public READ entry of the style pipeline (read → map → write).
   * Fans the already-collected element facts out to every active framework reader,
   * then aggregates their canonical facts into the inspector view-model: the source
   * tabs, the merged property rows, the surface decision, and the available condition
   * axes. This is the read-merge model from master-spec §6.1 (SelectionStyleRead) —
   * the inspector never talks to adapters directly, only to this manager.
   *
   * USER-IMPACT: backs the Properties-panel style inspector — which source tabs the
   * user sees (Computed / Tailwind / .module.css / Inline), what each property reads
   * as, and whether the standard style inspector vs the props editor is shown.
   */
  async read(context: StyleReadContext): Promise<StyleReadResult> {
    const readResults = await this.readActiveAdapters(context);
    const sourceTabs = buildSourceTabs(context, readResults);

    return {
      sourceTabs,
      properties: buildProperties(context, readResults),
      surfaceDecision: decideSurface(context, readResults),
      activeConditions: buildActiveConditions(context),
      availableConditionAxes: buildAvailableConditionAxes(context, readResults),
      diagnostics: [],
    };
  }

  /**
   * Route the read to only the adapters whose CSS system the project actually uses
   * (e.g. a Tailwind+CSS-Modules project skips the inline-style reader's work unless
   * registered). Each active reader maps the shared element facts into its own
   * canonical {@link FrameworkReadResult}; readers run in parallel and never touch the
   * filesystem — tracing/IO stays at the platform boundary (see file header).
   */
  private async readActiveAdapters(context: StyleReadContext): Promise<FrameworkReadResult[]> {
    const activeSystemIds = new Set<CssSystemId>(context.projectCapabilities.projectCssSystems);
    const activeReaders = this.adapters.filter((adapter) => adapter.reader && activeSystemIds.has(adapter.id));

    return Promise.all(
      activeReaders.map((adapter) => {
        if (!adapter.reader) {
          throw new Error(`Adapter ${adapter.id} has no reader`);
        }

        return adapter.reader.read({
          elementFacts: context.elementFacts,
          computedStyle: context.computedStyle,
          fiberTrace: context.fiberTrace,
          runtimeThemeContext: context.runtimeThemeContext,
        });
      }),
    );
  }
}

/**
 * Build the inspector's source-tab list: always a synthetic "Computed" tab first
 * (the runtime-overlay display fill, never an editable owner), then one de-duplicated
 * tab per distinct style source discovered — both element-level source owners and each
 * adapter's class identities. Tabs are keyed by `cssSystem:sourceId` so the same source
 * surfaced by both the element facts and an adapter collapses to one tab (which is why a
 * dynamic-branch Tailwind class no longer spawns a second indistinguishable "Tailwind"
 * button — see TailwindV4Reader, HYP-553).
 */
function buildSourceTabs(context: StyleReadContext, readResults: FrameworkReadResult[]): StyleSourceTab[] {
  const tabsById = new Map<string, StyleSourceTab>();
  tabsById.set('computed', {
    id: 'computed',
    label: 'Computed',
    condition: computedCondition,
    confidence: 'computed-only',
    isDefault: true,
  });

  for (const owner of context.elementFacts.sourceOwners) {
    const tab = tabFromOwner(owner);
    if (!tabsById.has(tab.id)) {
      tabsById.set(tab.id, tab);
    }
  }

  for (const readResult of readResults) {
    for (const owner of readResult.sourceOwners) {
      const tab = tabFromOwner(owner);
      if (!tabsById.has(tab.id)) {
        tabsById.set(tab.id, tab);
      }
    }

    for (const identity of readResult.classIdentities) {
      const tab = tabFromClassIdentity(identity);
      if (!tabsById.has(tab.id)) {
        tabsById.set(tab.id, tab);
      }
    }
  }

  return [...tabsById.values()];
}

function tabFromOwner(owner: StyleSourceOwner): StyleSourceTab {
  return {
    id: tabIdFromOwner(owner),
    label: owner.selector ?? owner.elementRef ?? owner.cssSystem,
    cssSystem: owner.cssSystem,
    sourceForm: owner.sourceForm,
    cssSyntax: owner.cssSyntax,
    filePath: owner.filePath,
    selector: owner.selector,
    condition: owner.condition,
    cascadeContext: owner.cascadeContext,
    confidence: owner.confidence,
    isDefault: false,
  };
}

function tabFromClassIdentity(identity: SourceClassIdentity): StyleSourceTab {
  return {
    id: identity.sourceTabId ?? tabIdFromClassIdentity(identity),
    label: identity.label,
    cssSystem: identity.cssSystem,
    sourceForm: identity.sourceForm,
    filePath: identity.filePath,
    cssSyntax: identity.cssSyntax,
    selector: identity.selector,
    cssClass: identity.cssClass,
    classKey: identity.classKey,
    sourceRef: identity.sourceRef,
    condition: identity.condition,
    confidence: identity.confidence,
    isDefault: false,
  };
}

function tabIdFromOwner(owner: StyleSourceOwner): string {
  const sourceId = owner.selector ?? owner.elementRef ?? `${owner.filePath}:${owner.property}`;
  return `${owner.cssSystem}:${trimClassPrefix(sourceId)}`;
}

function tabIdFromClassIdentity(identity: SourceClassIdentity): string {
  const sourceId = identity.cssClass ?? identity.classKey ?? identity.selector ?? identity.label;
  return `${identity.cssSystem}:${trimClassPrefix(sourceId)}`;
}

function trimClassPrefix(value: string): string {
  return value.startsWith('.') ? value.slice(1) : value;
}

/**
 * Merge property rows from two layers into the inspector's PropertySource list:
 * the live computed style (every property, `active:true`, attributed to the
 * `computed` tab) plus each source owner's declared value (`active:false`, attributed
 * to that owner's tab). Owner values are looked up under both kebab and camelCase keys
 * because adapters key their value maps inconsistently. Per spec §6.3 the computed layer
 * is a display overlay only — it never makes a property editable, ownership does.
 */
function buildProperties(context: StyleReadContext, readResults: FrameworkReadResult[]): PropertySource[] {
  const computedProperties = Object.entries(context.computedStyle).map(([property, value]) => ({
    property,
    value,
    sourceTabId: 'computed',
    active: true,
  }));

  const sourceProperties = readResults.flatMap((readResult) =>
    readResult.sourceOwners.flatMap((owner) => {
      const value = valueForOwner(readResult, owner);
      if (value === undefined) {
        return [];
      }

      return [
        {
          property: owner.property,
          value,
          sourceTabId: tabIdFromOwner(owner),
          active: false,
        },
      ];
    }),
  );

  return [...computedProperties, ...sourceProperties];
}

function valueForOwner(readResult: FrameworkReadResult, owner: StyleSourceOwner): string | undefined {
  return readResult.values[owner.property] ?? readResult.values[toCamelCase(owner.property)];
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Selection-level routing: decide WHICH inspector surface to show — the standard style
 * inspector, the props editor, or neither — and carry the reasons. This is the AS-IS
 * home of master-spec §6.5's surface decision (the spec quotes this very function,
 * `style-read-manager.ts:194`, and notes there is NO `lib/stylability/` dir — D19).
 *
 * Precedence: a known adapter prop-mapper enables the style inspector with a compact
 * props editor; otherwise any standard style surface (intrinsic element, accepts
 * className/style/css/sx, or a found source owner) enables the inspector with the props
 * editor hidden; otherwise a recursive props schema routes to the full props editor;
 * else nothing is stylable here.
 *
 * NOTE (spec §6.5): the surface decision is SEPARATE from per-field writability — a shown
 * inspector does not imply every property is editable; that is owned per-property elsewhere.
 *
 * USER-IMPACT: decides whether the user gets the visual style controls or the
 * props/JSON editor when they select an element.
 */
function decideSurface(context: StyleReadContext, readResults: FrameworkReadResult[]): InspectorSurfaceDecision {
  const { componentFacts, componentPropSurface, elementPropMappers, sourceOwners } = context.elementFacts;

  if (elementPropMappers.length > 0) {
    return {
      standardStyleInspector: 'enabled',
      propsEditor: 'compact',
      reasons: ['adapter-known-prop-mapper'],
    };
  }

  const reasons: InspectorSurfaceDecision['reasons'] = [];
  if (componentFacts?.intrinsicElement) reasons.push('intrinsic-element');
  if (componentPropSurface?.acceptsClassName) reasons.push('accepts-className');
  if (componentPropSurface?.acceptsStyle) reasons.push('accepts-style');
  if (componentPropSurface?.acceptsCssProp) reasons.push('accepts-css-prop');
  if (componentPropSurface?.acceptsSxProp) reasons.push('accepts-sx-prop');
  if (sourceOwners.length > 0 || readResults.some((readResult) => readResult.sourceOwners.length > 0)) {
    reasons.push('source-owner-found');
  }

  if (reasons.length > 0) {
    return {
      standardStyleInspector: 'enabled',
      propsEditor: 'hidden',
      reasons,
    };
  }

  if (componentPropSurface?.recursivePropsSchemaAvailable) {
    return {
      standardStyleInspector: 'disabled',
      propsEditor: 'full',
      reasons: ['props-schema-available', 'no-standard-style-surface'],
    };
  }

  return {
    standardStyleInspector: 'disabled',
    propsEditor: 'hidden',
    reasons: ['no-standard-style-surface'],
  };
}

function buildActiveConditions(context: StyleReadContext): StyleCondition {
  if (!context.runtimeThemeContext.selectedTheme || context.runtimeThemeContext.selectedTheme.length === 0) {
    return { state: 'base' };
  }

  return {
    state: 'base',
    theme: context.runtimeThemeContext.selectedTheme,
  };
}

/**
 * Collect the condition axes the inspector may offer for this selection — states
 * (base/hover/…), viewport keys, theme axes, and container keys — by unioning the
 * project's declared theme capabilities with every condition observed across the read
 * results (owners + class identities). These are the orthogonal axes from master-spec
 * §5.5 (capability taxonomy); they drive which state/breakpoint/theme toggles the user
 * can edit under, not the values themselves.
 */
function buildAvailableConditionAxes(
  context: StyleReadContext,
  readResults: FrameworkReadResult[],
): AvailableConditionAxes {
  const states = new Set<AvailableConditionAxes['states'][number]>(['base']);
  const viewportKeys = new Set<AvailableConditionAxes['viewportKeys'][number]>();
  const themeAxes = new Set<AvailableConditionAxes['themeAxes'][number]>(
    context.projectCapabilities.projectThemeCapabilities.axes.map((axis) => axis.id),
  );
  const containerKeys = new Set<AvailableConditionAxes['containerKeys'][number]>();

  for (const condition of allConditions(readResults)) {
    states.add(condition.state);
    if (condition.viewport) viewportKeys.add(condition.viewport.key);
    if (condition.container?.key) containerKeys.add(condition.container.key);

    for (const theme of condition.theme ?? []) {
      themeAxes.add(theme.axis);
    }
  }

  return {
    states: [...states],
    viewportKeys: [...viewportKeys],
    themeAxes: [...themeAxes],
    containerKeys: [...containerKeys],
  };
}

function allConditions(readResults: FrameworkReadResult[]): StyleCondition[] {
  return readResults.flatMap((readResult) => [
    ...readResult.conditions,
    ...readResult.sourceOwners.map((owner) => owner.condition),
    ...readResult.classIdentities.map((identity) => identity.condition),
  ]);
}
