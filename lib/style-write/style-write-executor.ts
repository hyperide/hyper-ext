/**
 * @file Shared style-write executor for request routing and AST-backed plan execution
 *
 * Accessed via: VS Code and SaaS style update handlers before mutating user files
 * Assumptions: endpoint callers have already resolved the target JSX element; this module owns
 *   shared source-owner inference, write planning, and AST-local mutation execution.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import path from 'node:path';
import * as t from '@babel/types';
import { getCssModuleClassReferences, getCssModuleImportBindings } from '@lib/ast/css-module-references';
import type { BindingLiteralRewrite, MutatorWriteHints } from '@lib/ast/dynamic-classname-mutator';
import { detectClassNameType, modifyDynamicClassName } from '@lib/ast/dynamic-classname-mutator';
import type { FileIO } from '@lib/ast/file-io';
import { applyInlineStyleUpdate } from '@lib/ast/inline-style-mutator';
import { getAttribute, getAttributeStaticClassName, getAttributeString, setAttribute } from '@lib/ast/mutator';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { createFileParser, printNodeSource, spliceNodeSource } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import type { CssSystemId, RuntimeThemeContext, StyleSourceOwner } from '@lib/style-read/types';
import { removeConflictingClasses } from '@lib/tailwind/parser';
import type { ClassNameLocation as LegacyClassNameLocation } from '@lib/types';
import postcss, { type AtRule, type Declaration, type Root, type Rule } from 'postcss';
import { createDefaultStyleWriteManager } from './default-style-write-manager';
import {
  createCssModuleSourceOwnersFromReferences,
  createStyleWriteContextFromRequest,
  getRequestRoutableCssSystem,
} from './style-write-request-context';
import type {
  AdapterPropPlan,
  CssFilePlan,
  StyleWritePlan,
  StyleWriteResult,
  TailwindPlan,
  TargetStyleValue,
} from './types';
import { errorMessage } from './utils';

/**
 * HYP-544 Phase 3 — a candidate token the empirical color-probe found to DRIVE the element's
 * color. The probe runs in the preview iframe (off-screen-clone verification); the host threads
 * the ranked driving list here. The executor's Tailwind dynamic branch consults it ONLY in the
 * unresolvable case (binding resolution found nothing): an inline/var/module-class driver means
 * a twMerge override is a NO-OP (inline/var wins specificity), so the write is redirected to an
 * inline-style override on the element ref instead. A tailwind-class driver keeps the twMerge path.
 */
export interface ProbeDrivingCandidate {
  kind: 'tailwind-class' | 'inline-style' | 'css-var' | 'module-class';
  token: string;
  locationHint: string;
}

export interface StyleWriteExecutorOptions {
  fileIO?: FileIO;
  projectRoot?: string;
  /**
   * Live applied className from the DOM (HYP-544). Request-scoped — the executor is constructed fresh
   * per request, so this never leaks across requests. Authoritative source of "what color is applied
   * now"; lets the Tailwind writer escalate the residual to a twMerge override when a same-group color
   * reaches the element from an opaque source the static AST cannot rewrite.
   */
  domClasses?: string;
  /**
   * HYP-544 Phase 3 — ranked driving candidates from the empirical color-probe (preview-iframe
   * realm). Present only when the host ran the probe (unresolvable color source). Used to redirect
   * an inline/var/module-driven color write to an inline-style override (a twMerge wrap can't change
   * an inline- or var-driven color). Empty/absent → existing behavior.
   */
  probeDriving?: ProbeDrivingCandidate[];
  /**
   * HYP-544 Phase 3 — the raw requested CSS styles (e.g. `{ backgroundColor: '#dc2626' }`) for this
   * write, retained so the probe-driven inline-style override can write the actual color value (the
   * TailwindPlan only carries the generated class, not the raw value).
   */
  requestedStyles?: Record<string, string>;
}

export interface ExecuteStyleWriteRequestInput {
  ast: t.File;
  sourceFilePath: string;
  element: t.JSXElement;
  styles: Record<string, string>;
  state?: string;
  selectedSourceTabId?: string;
  runtimeThemeContext: RuntimeThemeContext;
  fileIO?: FileIO;
  projectRoot?: string;
  /**
   * Live applied className from the DOM (HYP-544). The authoritative "what color is applied now",
   * collected client-side and threaded through the RPC/HTTP body. Used by the Tailwind writer to
   * anchor the replace target on reality and escalate the opaque-source residual to a twMerge override.
   */
  domClasses?: string;
  /**
   * HYP-544 Phase 3 — ranked driving candidates from the empirical color-probe (preview-iframe realm),
   * threaded by the host when the color source is unresolvable. Redirects an inline/var/module-driven
   * color write to an inline-style override (twMerge can't change inline/var-driven colors).
   */
  probeDriving?: ProbeDrivingCandidate[];
}

interface ElementRefPosition {
  line: number;
  column: number;
}

type CssContainer = Root | AtRule;

interface CssRuleTarget {
  mode: 'existing-owner' | 'create-rule';
  cssFilePath: string;
  selector: string;
  declarations: Record<string, string>;
  cascadeContext?: CssFilePlan['target']['cascadeContext'];
}

type CssAtRuleContext = NonNullable<NonNullable<CssRuleTarget['cascadeContext']>['atRuleStack']>[number];

function parseElementRef(elementRef: string): ElementRefPosition | null {
  const match = /^(.+):(\d+):(\d+)$/.exec(elementRef);
  if (!match) return null;

  return {
    line: Number.parseInt(match[2], 10),
    column: Number.parseInt(match[3], 10),
  };
}

function cssSystemLabel(plan: StyleWritePlan): string {
  if ('cssSystem' in plan) return plan.cssSystem;
  return 'none';
}

function tailwindStatePrefix(plan: TailwindPlan): string | undefined {
  if (plan.condition.state === 'base') return undefined;
  return plan.condition.state;
}

function stringifyTargetStyles(styles: Record<string, TargetStyleValue>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    result[key] = String(value);
  }
  return result;
}

export class StyleWriteExecutor {
  private readonly fileParser: ReturnType<typeof createFileParser>;
  private readonly fileIO: FileIO;
  private readonly projectRoot?: string;
  private readonly domClasses?: string;
  private readonly probeDriving?: ProbeDrivingCandidate[];
  private readonly requestedStyles?: Record<string, string>;

  constructor(options: StyleWriteExecutorOptions = {}) {
    this.fileIO = options.fileIO ?? new NodeFileIO();
    this.fileParser = createFileParser(this.fileIO);
    this.projectRoot = options.projectRoot;
    this.domClasses = options.domClasses;
    this.probeDriving = options.probeDriving;
    this.requestedStyles = options.requestedStyles;
  }

  async execute(plan: StyleWritePlan): Promise<StyleWriteResult> {
    try {
      switch (plan.sourceForm) {
        case 'elementClass':
          return await this.executeTailwindPlan(plan);
        case 'cssStyleRule':
          return await this.executeCssFilePlan(plan);
        case 'scriptReactStyleRule':
          return await this.executeInlineStylePlan(plan);
        case 'adapterKnownElementProp':
          return await this.executeAdapterPropPlan(plan);
        default:
          return this.unsupported(plan);
      }
    } catch (error) {
      return {
        success: false,
        plan,
        error: errorMessage(error),
      };
    }
  }

  private async executeTailwindPlan(plan: TailwindPlan): Promise<StyleWriteResult> {
    if (plan.strategy.mode === 'dynamic' && plan.strategy.locations.length > 0) {
      return this.failure(plan, 'Dynamic Tailwind plan locations are not supported by StyleWriteExecutor yet');
    }

    if (plan.strategy.mode === 'dynamic' && plan.strategy.fallbackStrategy === 'location-only') {
      return this.failure(plan, 'Dynamic Tailwind location-only plan has no executable locations');
    }

    const filePath = this.resolveFilePath(plan.target.filePath, plan.projectRoot);
    const { ast, absolutePath } = await this.fileParser.readAndParseFile(filePath);
    const element = this.findElement(ast, plan.target.elementRef);
    if (!element) {
      return {
        success: false,
        plan,
        error: `Element not found: ${plan.target.elementRef}`,
      };
    }

    // HYP-544 Phase 3: empirical-probe redirect. When the color source was unresolvable and the
    // host's probe found that the driving candidate is an INLINE style, a CSS VAR, or a hashed
    // MODULE class, a twMerge/className override is a no-op (inline/var wins specificity; a var-driven
    // color isn't changed by adding a utility class). Redirect to an inline-style override on the
    // element ref — the universal §7 floor — using the raw requested CSS value. This runs BEFORE the
    // literal-className branch too: `className="bg-blue-600" style={{ background: 'var(--brand)' }}`
    // would otherwise rewrite the class while the inline var still wins the cascade (codex P2). A
    // tailwind-class driver (or no probe result) falls through to the normal className write below.
    const inlineOverride = this.probeDrivenInlineOverride();
    if (inlineOverride) {
      applyInlineStyleUpdate(element, inlineOverride);
      await this.fileParser.writeAST(ast, absolutePath);
      return { success: true, plan, mutatedFiles: [absolutePath] };
    }

    const classNameType = detectClassNameType(element);
    if (classNameType === 'string') {
      const existingClassName = getAttributeString(element, 'className') || '';
      const { preserved } = removeConflictingClasses(
        existingClassName,
        plan.strategy.removeForProperties,
        tailwindStatePrefix(plan),
      );
      const newClassName = [preserved, plan.strategy.addClasses].filter(Boolean).join(' ').trim();
      setAttribute(element, 'className', t.stringLiteral(newClassName));
      await this.fileParser.writeAST(ast, absolutePath);
      return { success: true, plan, mutatedFiles: [absolutePath] };
    }

    // Dynamic className (template / cn()/clsx() / expression). The mutator may REPLACE the className
    // value node (e.g. wrapInConcatenation builds a fresh JSXExpressionContainer). A whole-file
    // recast reprint of a node with no `.original` reformats the enclosing JSX element's untouched
    // text children (HYP-575). Capture the className value's original source range first, then
    // surgically splice only that span — every other byte stays untouched.
    const sourceCode = await this.fileParser.readFileContent(absolutePath);
    const valueBefore = getAttribute(element, 'className');
    const originalStart = valueBefore?.start ?? undefined;
    const originalEnd = valueBefore?.end ?? undefined;

    const locations: LegacyClassNameLocation[] = [];
    const canInjectTwMerge = await this.projectResolvesTailwindMerge(plan.projectRoot);
    // HYP-544 Phase 1: binding resolution may find-replace the conflicting class at a SAME-FILE const's
    // literal — a node in a DISJOINT top-level statement, outside the className value's span. The
    // mutator records each such rewritten literal's original source range here so we can splice it too
    // (the className-value splice below never touches the const).
    const bindingRewrites: BindingLiteralRewrite[] = [];
    const writeHints: MutatorWriteHints = { forceFullReprint: false };
    modifyDynamicClassName(
      ast,
      sourceCode,
      element,
      locations,
      plan.strategy.addClasses,
      plan.strategy.removeForProperties,
      plan.strategy.mode === 'dynamic' && plan.strategy.fallbackStrategy === 'wrap-expression' ? 'wrap' : 'append',
      tailwindStatePrefix(plan),
      this.domClasses,
      canInjectTwMerge,
      bindingRewrites,
      writeHints,
    );

    // HYP-544 Phase 2 (§7): the mutator hit an OPAQUE same-group conflict it could not override (the
    // project has no `tailwind-merge` and the override path bailed rather than write an unresolvable
    // import). A concat-append would not win that cascade, so the mutator left the className UNTOUCHED and
    // signaled the universal §7 floor: write an inline `style` override on the element ref instead. This
    // is the same write the empirical-probe redirect (above) uses — reuse, not a new mechanism. Requires
    // the raw requested CSS value (the TailwindPlan carries only the generated class).
    if (writeHints.needsInlineFloor && this.requestedStyles && Object.keys(this.requestedStyles).length > 0) {
      applyInlineStyleUpdate(element, { ...this.requestedStyles });
      await this.fileParser.writeAST(ast, absolutePath);
      return { success: true, plan, mutatedFiles: [absolutePath] };
    }

    const valueAfter = getAttribute(element, 'className');

    // P1 guard (HYP-544 rebase interaction): whenever the mutator INJECTED a new top-level
    // `import { twMerge } from 'tailwind-merge'` (the #381 opaque-source override on a file with no
    // existing import — with OR without a coexisting same-file const find-replace), the injected import
    // is an inserted node with NO source range. A span-splice write (className span ± const literal
    // spans) cannot represent it and would emit `twMerge(...)` WITHOUT the import — a broken build (the
    // pre-rebase #381 branch always `writeAST`'d, so it never hit this; HYP-575's span-splice did).
    // Whole-file recast in that case — recast still preserves every untouched original node's bytes.
    if (writeHints.forceFullReprint) {
      await this.fileParser.writeAST(ast, absolutePath);
      return { success: true, plan, mutatedFiles: [absolutePath] };
    }

    // Common path (HYP-575, no binding rewrites): a single surgical splice of the className value's own
    // span. Kept verbatim — `spliceNodeSource` re-prints only that node and preserves every other byte.
    if (bindingRewrites.length === 0) {
      const spliced =
        valueAfter && typeof originalStart === 'number' && typeof originalEnd === 'number'
          ? spliceNodeSource(sourceCode, valueAfter, originalStart, originalEnd)
          : null;
      if (spliced !== null) {
        await this.fileIO.writeFile(absolutePath, spliced);
        this.fileParser.invalidate(absolutePath);
      } else {
        // Safety net: no usable source range (synthetic node / missing offsets) — fall back to the
        // whole-file recast print. Still format-preserving for every node recast can round-trip.
        await this.fileParser.writeAST(ast, absolutePath);
      }
      return { success: true, plan, mutatedFiles: [absolutePath] };
    }

    // HYP-544 Phase 1: binding resolution rewrote one or more SAME-FILE const literals — each lives in a
    // DISJOINT top-level statement, so the className-value splice alone never touches them. Collect every
    // disjoint splice (the className span plus each const literal span), each an original node with valid
    // offsets, and apply them to the ONE original source in DESCENDING start order so an earlier splice
    // never shifts the offsets of a later one.
    const splices: { start: number; end: number; replacement: string }[] = [];
    if (valueAfter && typeof originalStart === 'number' && typeof originalEnd === 'number') {
      splices.push({ start: originalStart, end: originalEnd, replacement: printNodeSource(valueAfter) });
    }
    for (const rewrite of bindingRewrites) {
      if (
        Number.isInteger(rewrite.start) &&
        Number.isInteger(rewrite.end) &&
        rewrite.start >= 0 &&
        rewrite.end <= sourceCode.length &&
        rewrite.start <= rewrite.end
      ) {
        splices.push({ start: rewrite.start, end: rewrite.end, replacement: printNodeSource(rewrite.node) });
      }
    }

    if (splices.length > 0) {
      let out = sourceCode;
      for (const s of splices.sort((a, b) => b.start - a.start)) {
        out = out.slice(0, s.start) + s.replacement + out.slice(s.end);
      }
      await this.fileIO.writeFile(absolutePath, out);
      this.fileParser.invalidate(absolutePath);
    } else {
      await this.fileParser.writeAST(ast, absolutePath);
    }
    return { success: true, plan, mutatedFiles: [absolutePath] };
  }

  private async executeCssFilePlan(plan: CssFilePlan): Promise<StyleWriteResult> {
    const target = cssRuleTarget(plan);
    const cssFilePath = this.resolveFilePath(target.cssFilePath, plan.projectRoot);
    await this.fileIO.access(cssFilePath);

    const source = await this.fileIO.readFile(cssFilePath);
    const root = postcss.parse(source, { from: cssFilePath });
    const rule = target.mode === 'create-rule' ? createRule(root, target) : findRule(root, target);

    if (!rule) {
      return this.failure(plan, `CSS selector not found: ${target.selector}`);
    }

    applyDeclarations(rule, target.declarations);
    await this.fileIO.writeFile(cssFilePath, root.toString());
    return { success: true, plan, mutatedFiles: [cssFilePath] };
  }

  private async executeInlineStylePlan(
    plan: Extract<StyleWritePlan, { sourceForm: 'scriptReactStyleRule' }>,
  ): Promise<StyleWriteResult> {
    const filePath = this.resolveFilePath(plan.target.filePath, plan.projectRoot);
    const { ast, absolutePath } = await this.fileParser.readAndParseFile(filePath);
    const elementRef = plan.target.elementRef ?? plan.sourceElement.elementRef;
    const element = this.findElement(ast, elementRef);
    if (!element) {
      return {
        success: false,
        plan,
        error: `Element not found: ${elementRef}`,
      };
    }

    applyInlineStyleUpdate(element, stringifyTargetStyles(plan.target.styles));
    await this.fileParser.writeAST(ast, absolutePath);
    return { success: true, plan, mutatedFiles: [absolutePath] };
  }

  private async executeAdapterPropPlan(plan: AdapterPropPlan): Promise<StyleWriteResult> {
    const filePath = this.resolveFilePath(plan.target.filePath, plan.projectRoot);
    const { ast, absolutePath } = await this.fileParser.readAndParseFile(filePath);
    const element = this.findElement(ast, plan.target.elementRef);
    if (!element) {
      return { success: false, plan, error: `Element not found: ${plan.target.elementRef}` };
    }
    for (const [key, value] of Object.entries(plan.target.props)) {
      setAttribute(element, key, t.stringLiteral(String(value)));
    }
    await this.fileParser.writeAST(ast, absolutePath);
    return { success: true, plan, mutatedFiles: [absolutePath] };
  }

  private unsupported(plan: StyleWritePlan): StyleWriteResult {
    return this.failure(plan, `Unsupported style write plan: ${plan.sourceForm}/${cssSystemLabel(plan)}`);
  }

  private failure(plan: StyleWritePlan, error: string): StyleWriteResult {
    return { success: false, plan, error };
  }

  private resolveFilePath(filePath: string, planProjectRoot: string): string {
    if (path.isAbsolute(filePath)) return filePath;

    const root = planProjectRoot || this.projectRoot || process.cwd();
    return path.resolve(root, filePath);
  }

  private findElement(ast: t.File, elementRef: string): t.JSXElement | null {
    const position = parseElementRef(elementRef);
    if (!position) return null;

    const result = findElementByPosition(ast, position.line, position.column);
    return result?.element ?? null;
  }

  /**
   * HYP-544 Phase 3 — if the empirical probe found that this color is driven by an inline style,
   * a CSS var, or a hashed module class (NOT a Tailwind utility), return the inline-style override
   * to write (`{ backgroundColor: '#dc2626' }`); else null. A twMerge className wrap can't change an
   * inline/var-driven color (specificity / it doesn't touch the var), so we redirect to the universal
   * inline-style floor (§7). A tailwind-class driver returns null → keep the existing twMerge path.
   * Requires the raw requested CSS styles (the TailwindPlan only carries the generated class).
   */
  private probeDrivenInlineOverride(): Record<string, string> | null {
    const first = this.probeDriving?.[0];
    if (!first) return null;
    if (first.kind === 'tailwind-class') return null; // twMerge path handles utility drivers
    if (!this.requestedStyles || Object.keys(this.requestedStyles).length === 0) return null;
    return { ...this.requestedStyles };
  }

  /**
   * Does the EDITED project resolve `tailwind-merge`? Gates whether the residual override may inject a
   * new `import { twMerge } from 'tailwind-merge'`. Reading the project's own package.json (not
   * HyperIDE's) is what keeps a color edit from breaking the user's build with an unresolvable import.
   * Conservative: any read/parse failure → false (fall back to the safe concat-append).
   */
  private async projectResolvesTailwindMerge(planProjectRoot: string): Promise<boolean> {
    const root = planProjectRoot || this.projectRoot;
    if (!root) return false;
    try {
      const raw = await this.fileIO.readFile(path.join(root, 'package.json'));
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Boolean(pkg.dependencies?.['tailwind-merge'] || pkg.devDependencies?.['tailwind-merge']);
    } catch {
      return false;
    }
  }
}

export async function executeStyleWriteRequest(input: ExecuteStyleWriteRequestInput): Promise<StyleWriteResult> {
  const elementRef = getElementRef(input.sourceFilePath, input.element);
  if (!elementRef) {
    return { success: false, error: 'Element location unavailable for shared style write' };
  }

  const cssSystem = getRequestRoutableCssSystem(input.selectedSourceTabId);
  if (input.selectedSourceTabId && !cssSystem && input.selectedSourceTabId !== 'computed') {
    return { success: false, error: `Unsupported style source tab for request routing: ${input.selectedSourceTabId}` };
  }

  const sourceOwners = getRequestSourceOwners({
    ast: input.ast,
    element: input.element,
    sourceFilePath: input.sourceFilePath,
    elementRef,
    styles: input.styles,
    state: input.state,
    selectedSourceTabId: input.selectedSourceTabId,
  });
  if (cssSystem === 'css-modules' && !sourceOwners.some((owner) => owner.cssSystem === 'css-modules')) {
    return { success: false, error: 'CSS Modules source owner unavailable for selected source tab' };
  }

  const elementCssSystems = getElementCssSystems(input.element, sourceOwners, cssSystem, Object.keys(input.styles));
  const manager = createDefaultStyleWriteManager({
    executor: new StyleWriteExecutor({
      fileIO: input.fileIO,
      projectRoot: input.projectRoot,
      domClasses: input.domClasses,
      probeDriving: input.probeDriving,
      requestedStyles: input.styles,
    }),
  });
  const context = createStyleWriteContextFromRequest({
    filePath: input.sourceFilePath,
    elementRef,
    tagName: getTagName(input.element),
    styles: input.styles,
    selectedSourceTabId: input.selectedSourceTabId,
    state: input.state,
    sourceOwners,
    elementCssSystems,
    projectCssSystems: elementCssSystems,
    runtimeThemeContext: input.runtimeThemeContext,
  });

  const plan = await manager.createPlan(context);
  return manager.execute(plan);
}

function getElementRef(filePath: string, element: t.JSXElement): string | null {
  const loc = element.loc?.start;
  if (!loc) return null;
  return `${filePath}:${loc.line}:${loc.column}`;
}

function getTagName(element: t.JSXElement): string | undefined {
  const name = element.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  return undefined;
}

function getRequestSourceOwners(input: {
  ast: t.File;
  element: t.JSXElement;
  sourceFilePath: string;
  elementRef: string;
  styles: Record<string, string>;
  state?: string;
  selectedSourceTabId?: string;
}): StyleSourceOwner[] {
  return createCssModuleSourceOwnersFromReferences({
    references: getCssModuleClassReferences(input.element, getCssModuleImportBindings(input.ast, input.sourceFilePath)),
    selectedSourceTabId: input.selectedSourceTabId,
    elementRef: input.elementRef,
    styles: input.styles,
    state: input.state,
  });
}

function getElementCssSystems(
  element: t.JSXElement,
  sourceOwners: StyleSourceOwner[],
  selectedSystem: CssSystemId | undefined,
  requestedStyleKeys: string[] = [],
): CssSystemId[] {
  const systems: CssSystemId[] = [];

  if (selectedSystem) {
    systems.push(selectedSystem);
  }

  const hasCssModules = sourceOwners.some((owner) => owner.cssSystem === 'css-modules');
  const classNameAttribute = getAttribute(element, 'className');
  const staticClassName = getAttributeStaticClassName(element);
  const hasTailwindClassName = Boolean(classNameAttribute && (staticClassName || !hasCssModules));

  if (hasTailwindClassName) {
    systems.push('tailwind-v4');
  }
  if (hasCssModules) {
    systems.push('css-modules');
  }
  if (getAttribute(element, 'style')) {
    systems.push('inline-style');
  }

  // Detect Tamagui/RN-style elements: style properties written as direct JSX props
  // (e.g. <YStack backgroundColor={...}> uses backgroundColor as a prop, not className/style).
  // Only applies to user-defined components (uppercase or member-expression tag names) —
  // DOM elements like <img width='200'> must not be classified as Tamagui (HYP-637).
  const tagNameNode = element.openingElement.name;
  const isUserDefinedTag =
    (tagNameNode.type === 'JSXIdentifier' && /^[A-Z]/.test(tagNameNode.name)) ||
    tagNameNode.type === 'JSXMemberExpression';
  if (isUserDefinedTag && requestedStyleKeys.some((key) => getAttribute(element, key) !== null)) {
    systems.push('tamagui');
  }

  if (systems.length === 0) {
    systems.push('inline-style');
  }

  return [...new Set(systems)];
}

function cssRuleTarget(plan: CssFilePlan): CssRuleTarget {
  if (plan.cssSystem === 'css-modules') {
    return {
      mode: 'existing-owner',
      cssFilePath: plan.target.cssFilePath,
      selector: plan.target.selector,
      declarations: plan.target.declarations,
      cascadeContext: plan.target.cascadeContext,
    };
  }

  if (plan.target.mode === 'create-rule') {
    return {
      mode: 'create-rule',
      cssFilePath: plan.target.cssFilePath,
      selector: plan.target.selector,
      declarations: plan.target.declarations,
      cascadeContext: plan.target.cascadeContext,
    };
  }

  return {
    mode: 'existing-owner',
    cssFilePath: plan.target.cssFilePath,
    selector: plan.target.selector,
    declarations: plan.target.declarations,
    cascadeContext: plan.target.cascadeContext,
  };
}

function normalizeAtRuleName(name: string): string {
  return name.replace(/^@/, '');
}

function atRuleMatches(rule: AtRule, expected: CssAtRuleContext) {
  return normalizeAtRuleName(rule.name) === normalizeAtRuleName(expected.name) && rule.params === expected.params;
}

function matchingCascadeContainers(root: Root, target: CssRuleTarget): CssContainer[] {
  const atRuleStack = target.cascadeContext?.atRuleStack;
  if (!atRuleStack?.length) return [root];

  let containers: CssContainer[] = [root];
  for (const expected of atRuleStack) {
    const nextContainers: CssContainer[] = [];
    for (const container of containers) {
      for (const child of container.nodes ?? []) {
        if (child.type === 'atrule' && atRuleMatches(child, expected)) {
          nextContainers.push(child);
        }
      }
    }
    containers = nextContainers;
  }

  return containers;
}

function ruleMatches(rule: Rule, selector: string): boolean {
  return rule.selectors.map((candidate) => candidate.trim()).includes(selector.trim());
}

function findRule(root: Root, target: CssRuleTarget): Rule | undefined {
  let matchedRule: Rule | undefined;
  for (const container of matchingCascadeContainers(root, target)) {
    container.walkRules((rule) => {
      if (ruleMatches(rule, target.selector)) {
        matchedRule = rule;
        return false;
      }
    });
    if (matchedRule) return matchedRule;
  }
  return undefined;
}

function ensureCascadeContainer(root: Root, target: CssRuleTarget): CssContainer {
  const atRuleStack = target.cascadeContext?.atRuleStack;
  if (!atRuleStack?.length) return root;

  let container: CssContainer = root;
  for (const expected of atRuleStack) {
    let matchingAtRule: AtRule | undefined;
    for (const child of container.nodes ?? []) {
      if (child.type === 'atrule' && atRuleMatches(child, expected)) {
        matchingAtRule = child;
        break;
      }
    }

    if (!matchingAtRule) {
      matchingAtRule = postcss.atRule({
        name: normalizeAtRuleName(expected.name),
        params: expected.params,
      });
      container.append(matchingAtRule);
    }

    container = matchingAtRule;
  }

  return container;
}

function createRule(root: Root, target: CssRuleTarget): Rule {
  const container = ensureCascadeContainer(root, target);
  const rule = postcss.rule({ selector: target.selector });
  container.append(rule);
  return rule;
}

function findDeclaration(rule: Rule, prop: string): Declaration | undefined {
  return rule.nodes?.find((node): node is Declaration => node.type === 'decl' && node.prop === prop);
}

function applyDeclarations(rule: Rule, declarations: Record<string, string>): void {
  for (const [prop, value] of Object.entries(declarations)) {
    const existingDeclaration = findDeclaration(rule, prop);
    if (existingDeclaration) {
      existingDeclaration.value = value;
    } else {
      rule.append({ prop, value });
    }
  }
}
