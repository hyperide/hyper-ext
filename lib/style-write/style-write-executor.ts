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
import { detectClassNameType, modifyDynamicClassName } from '@lib/ast/dynamic-classname-mutator';
import type { FileIO } from '@lib/ast/file-io';
import { applyInlineStyleUpdate } from '@lib/ast/inline-style-mutator';
import { getAttribute, getAttributeStaticClassName, getAttributeString, setAttribute } from '@lib/ast/mutator';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { createFileParser } from '@lib/ast/parser';
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

export interface StyleWriteExecutorOptions {
  fileIO?: FileIO;
  projectRoot?: string;
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

  constructor(options: StyleWriteExecutorOptions = {}) {
    this.fileIO = options.fileIO ?? new NodeFileIO();
    this.fileParser = createFileParser(this.fileIO);
    this.projectRoot = options.projectRoot;
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
    } else {
      const sourceCode = await this.fileParser.readFileContent(absolutePath);
      const locations: LegacyClassNameLocation[] = [];
      modifyDynamicClassName(
        ast,
        sourceCode,
        element,
        locations,
        plan.strategy.addClasses,
        plan.strategy.removeForProperties,
        plan.strategy.mode === 'dynamic' && plan.strategy.fallbackStrategy === 'wrap-expression' ? 'wrap' : 'append',
        tailwindStatePrefix(plan),
      );
    }

    await this.fileParser.writeAST(ast, absolutePath);
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
  // (e.g. <YStack backgroundColor={...}> uses backgroundColor as a prop, not className/style)
  if (requestedStyleKeys.some((key) => getAttribute(element, key) !== null)) {
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
