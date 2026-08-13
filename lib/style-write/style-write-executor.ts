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
import { printNodeSource, spliceNodeSource, spliceStringLiteralValue } from '@lib/ast/parser';
import { createFileParser } from '@lib/ast/parser.node';
import { findElementByPosition } from '@lib/ast/position-finder';
import type { CssSystemId, RuntimeThemeContext, StyleSourceOwner } from '@lib/style-read/types';
import { generateTailwindClasses } from '@lib/tailwind/generator';
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
  StyleLandedFallback,
  StyleWritePlan,
  StyleWriteResult,
  TailwindPlan,
  TargetStyleValue,
} from './types';
import { camelToKebab, errorMessage } from './utils';

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
  /**
   * HYP-1012 monorepo follow-up (review round 2) — widens `resolveFilePath`'s containment
   * allowlist past `projectRoot` alone, mirroring `AstService.setAdditionalWorkspaceRoot` /
   * `resolveWorkspacePath`'s `additionalRoots`. Needed for a monorepo opened at a
   * sub-package LEAF: a CSS Modules import can legitimately point at a SIBLING
   * sub-project outside that leaf (the same supported workflow the extension's own
   * AstService widening restores), and `projectRoot` here is always the leaf, not the
   * wider monorepo root.
   */
  additionalProjectRoots?: string[];
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
  /**
   * UIKit-derived project default for a SURFACELESS element under Auto routing (D2 §4.3). Used only
   * as the floor when the element owns no concrete system; edit-in-place still wins. No silent inline.
   */
  projectDefaultCssSystem?: CssSystemId;
  /** See `StyleWriteExecutorOptions.additionalProjectRoots`. */
  additionalProjectRoots?: string[];
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

/**
 * The WRITE-apply end of the style pipeline: takes a frozen {@link StyleWritePlan} and
 * performs the actual AST-backed file mutation for one element, parsing the source,
 * locating the target JSX node, and applying the plan format-preservingly. It dispatches
 * by `sourceForm` to the per-system execution path (Tailwind className / CSS file rule /
 * inline style object / adapter prop). Construction is pure over an injected {@link FileIO}
 * so it unit-tests without a real filesystem; the host threads in DOM classes, project
 * root, and the color-probe driving list (see {@link ProbeDrivingCandidate}).
 */
export class StyleWriteExecutor {
  private readonly fileParser: ReturnType<typeof createFileParser>;
  private readonly fileIO: FileIO;
  private readonly projectRoot?: string;
  private readonly additionalProjectRoots: string[];
  private readonly domClasses?: string;
  private readonly probeDriving?: ProbeDrivingCandidate[];
  private readonly requestedStyles?: Record<string, string>;

  constructor(options: StyleWriteExecutorOptions = {}) {
    this.fileIO = options.fileIO ?? new NodeFileIO();
    this.fileParser = createFileParser(this.fileIO);
    this.projectRoot = options.projectRoot;
    this.additionalProjectRoots = options.additionalProjectRoots ?? [];
    this.domClasses = options.domClasses;
    this.probeDriving = options.probeDriving;
    this.requestedStyles = options.requestedStyles;
  }

  /**
   * Apply a frozen plan by dispatching on its `sourceForm` to the matching per-system
   * executor. Any thrown error is caught into a `success:false` result so a failed write
   * is a structured verdict, never an unhandled throw (fail-closed, spec §8.4).
   */
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

  /**
   * The Tailwind className write — the single most-exercised, and only genuinely
   * format-preserving, write path on main (master-spec §3.8). Reached for
   * `sourceForm:'elementClass'`. Branches in order: refuse dynamic plans carrying explicit
   * locations (a not-yet-reconciled edit shape, returned as a failure), then a
   * probe-driven inline override (HYP-544 Phase 3 — when the live color is driven by
   * inline/var/module a className append would be a no-op), then the static
   * remove-conflicting-classes + append on the literal className. USER-IMPACT: backs every
   * inspector style edit on a Tailwind element, preserving the user's existing class order.
   */
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

      // HYP-877: splice ONLY the existing literal's span as text, keeping its original quote char.
      // The previous `setAttribute(t.stringLiteral(...)) + writeAST` whole-file reprint churned the
      // quote style (recast prints a fresh literal with `quote:'single'`), re-flowed the enclosing
      // JSX (swallowing users' blank lines between children), and could drop the trailing newline —
      // a one-class edit on a real client repo produced a dirty multi-hunk diff.
      const literalBefore = getAttribute(element, 'className');
      if (t.isStringLiteral(literalBefore)) {
        const sourceCode = await this.fileParser.readFileContent(absolutePath);
        // extra.raw is the literal's original source text INCLUDING its quotes — the splice anchors
        // on it (byte-equality) so recast's offset normalization (CRLF/tabs) can never misplace it.
        const originalRaw = literalBefore.extra?.raw;
        const spliced =
          typeof originalRaw === 'string' && typeof literalBefore.start === 'number'
            ? spliceStringLiteralValue(sourceCode, originalRaw, literalBefore.start, newClassName)
            : null;
        if (spliced !== null) {
          await this.fileIO.writeFile(absolutePath, spliced);
          this.fileParser.invalidate(absolutePath);
          return { success: true, plan, mutatedFiles: [absolutePath] };
        }
      }

      // Safety net (synthetic node / missing offsets / unspliceable value): AST-level write.
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
    const canInjectTwMerge = await this.projectResolvesTailwindMerge(absolutePath, plan.projectRoot);
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

    // Same offset-drift hazard as spliceNodeSource: these spans are recast-normalized offsets, so a
    // '\r'/'\t' BEFORE the last span's end misindexes the raw bytes — whole-file write instead
    // (HYP-877). Chars after every span cannot shift them.
    const lastSpliceEnd = splices.reduce((max, s) => Math.max(max, s.end), 0);
    if (splices.length > 0 && !/[\r\t]/.test(sourceCode.slice(0, lastSpliceEnd))) {
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
    const cssFilePath = this.resolveContainedFilePath(target.cssFilePath, plan.projectRoot);
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

  /**
   * Resolve `filePath` (relative to `planProjectRoot`, or already absolute) to an
   * absolute path. No containment check: `plan.target.filePath` here is always the JSX
   * source file the caller (AstService, via the extension's own `resolveWorkspacePath`
   * containment) already resolved and validated upstream — this is a second, redundant
   * resolution of the SAME already-authorized path, not a new untrusted input. (Also
   * exercised directly by tests with deliberately out-of-root fixture paths for the
   * unrelated `projectResolvesTailwindMerge` dep-walk clamp — HYP-564 — which must keep
   * working unclamped here.) For the one path that IS genuinely untrusted at this layer
   * — the CSS Modules file resolved independently by `executeCssFilePlan` — use
   * `resolveContainedFilePath` instead; see its doc.
   */
  private resolveFilePath(filePath: string, planProjectRoot: string): string {
    if (path.isAbsolute(filePath)) return filePath;

    const root = planProjectRoot || this.projectRoot || process.cwd();
    return path.resolve(root, filePath);
  }

  /**
   * Resolve `filePath` (relative to `planProjectRoot`, or already absolute) and reject
   * (throw) any result that lexically escapes the project root (widened by
   * `additionalProjectRoots` — see that option's doc).
   *
   * HYP-1012 review round 2 (codex) P1: `executeCssFilePlan`'s `target.cssFilePath`, for
   * a `.module.css` import, is derived by `resolveCssImportPath`
   * (`@lib/ast/css-module-references.ts`) via a plain `path.resolve(dirname(importer),
   * importSource)` with NO boundary check of its own — unlike the JSX source path
   * `resolveFilePath` handles, this one is genuinely untrusted at this layer (never
   * independently validated by the extension's `resolveWorkspacePath`). Pre-fix, an
   * authorized component importing `../../secret/Outside.module.css` resolved and wrote
   * straight through. Reject-by-throw contract mirrors `resolveWorkspacePath`:
   * `execute()`'s existing top-level try/catch (fail-closed, spec §8.4) turns this into
   * a `{ success: false }` result.
   */
  private resolveContainedFilePath(filePath: string, planProjectRoot: string): string {
    const root = planProjectRoot || this.projectRoot || process.cwd();
    const resolvedRoot = path.resolve(root);
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(resolvedRoot, filePath);

    // Path-relative containment check (repo convention — see server/lib/path-security.ts),
    // NOT a string prefix: `absolutePath.startsWith(resolvedRoot)` would treat a sibling like
    // `/project-evil` as inside `/project`. `rel === '..' || rel.startsWith('..' + path.sep)`
    // (not a bare `rel.startsWith('..')`, which this file's own pre-existing
    // `projectResolvesTailwindMerge` clamp above uses and which review round 3 (codex P2)
    // caught here too) — a bare prefix check false-rejects a legitimately-named in-root
    // directory that merely starts with the two characters `..` (e.g. `..generated/`).
    const allRoots = [resolvedRoot, ...this.additionalProjectRoots.map((r) => path.resolve(r))];
    const contained = allRoots.some((candidateRoot) => {
      const rel = path.relative(candidateRoot, absolutePath);
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
    });
    if (!contained) {
      throw new Error(`Path resolves outside project root: ${filePath}`);
    }

    return absolutePath;
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
   *
   * Resolves like Node module resolution: walk up from the EDITED file's directory, checking each
   * `package.json` for a `tailwind-merge` declaration, and stop at the project root (HYP-564 — a
   * monorepo leaf package may declare the dep while the workspace root does not; resolving only the
   * workspace root would falsely decline the override). The walk is clamped so it never escapes the
   * project root and stops at the filesystem root.
   * Conservative: any read/parse failure on a given package.json → continue the walk; final fallback false.
   */
  private async projectResolvesTailwindMerge(editedFilePath: string, planProjectRoot: string): Promise<boolean> {
    const root = planProjectRoot || this.projectRoot;
    if (!root) return false;

    const stopAt = path.resolve(root);
    let dir = path.dirname(path.resolve(editedFilePath));
    // Clamp: if the edited file lives outside the project root, start the walk at the root itself.
    // Use a path-relative containment check (repo convention — see server/lib/path-security.ts), NOT a
    // string prefix: `dir.startsWith(stopAt)` would treat a sibling like `/project-old/src` as inside
    // `/project`, letting the walk escape the root and read the wrong package.json (HYP-564 review).
    const rel = path.relative(stopAt, dir);
    const contained = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    if (!contained) dir = stopAt;

    while (true) {
      try {
        const raw = await this.fileIO.readFile(path.join(dir, 'package.json'));
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (pkg.dependencies?.['tailwind-merge'] || pkg.devDependencies?.['tailwind-merge']) {
          return true;
        }
      } catch {
        // No package.json here, or unreadable/unparseable — keep walking up toward the project root.
      }

      if (dir === stopAt) break;
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }

    return false;
  }
}

/**
 * Shared public entry for a single-element style write request used by both the SaaS and
 * VS Code update handlers. Resolves the element ref and the routable CSS system from the
 * selected source tab, infers the source owner, plans the write, and runs it through a
 * {@link StyleWriteExecutor}. The `'auto'` tab id is the multi-select intent sentinel,
 * accepted symmetrically with `'computed'` so the per-element edit-in-place floor runs
 * instead of throwing (D2 §8). Returns a structured {@link StyleWriteResult} either way.
 */
export async function executeStyleWriteRequest(input: ExecuteStyleWriteRequestInput): Promise<StyleWriteResult> {
  const elementRef = getElementRef(input.sourceFilePath, input.element);
  if (!elementRef) {
    return { success: false, error: 'Element location unavailable for shared style write' };
  }

  const cssSystem = getRequestRoutableCssSystem(input.selectedSourceTabId);
  // 'auto' is the multi-select intent sentinel — accepted here symmetric with 'computed' so the
  // per-element edit-in-place floor (request-context) runs instead of throwing (D2 §8).
  if (
    input.selectedSourceTabId &&
    !cssSystem &&
    input.selectedSourceTabId !== 'computed' &&
    input.selectedSourceTabId !== 'auto'
  ) {
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

  const elementCssSystems = getElementCssSystems(
    input.element,
    sourceOwners,
    cssSystem,
    Object.keys(input.styles),
    input.projectDefaultCssSystem,
  );

  // D2 priority cascade (CTO 2026-06-11): under Auto/computed, a property the resolved system can't
  // express must NOT be silently dropped — it falls to inline PER-PROPERTY while the rest stay in the
  // system. inline is an isolated last rung, not "the element became inline". Only Auto/computed
  // cascades; an explicit pinned tab (cssSystem set) keeps its honest all-or-error behavior.
  //
  // Guards (codex review): the split is conservative so it never steals a write the planner would
  // place correctly:
  //   - base state only — inline cannot represent a pseudo-state (hover/focus), so under a non-base
  //     condition we keep everything in the system (TW writes the `hover:`-prefixed class); falling to
  //     inline would turn a hover edit into an always-on base style.
  //   - no css-modules owner — for mixed `cn(styles.root, 'p-2')` the planner may pick the exact
  //     css-modules owner per property; splitting on the Tailwind generator would shadow a
  //     `.module.css` declaration inline. If the element has a css-modules owner, defer to the planner.
  const isBaseState = !input.state || input.state === 'base';
  const hasCssModulesOwner = sourceOwners.some((owner) => owner.cssSystem === 'css-modules');
  const isAutoRouting = !cssSystem;
  const resolvedSystem = elementCssSystems[0];
  const eligibleForCascadeSplit = isAutoRouting && isBaseState && !hasCssModulesOwner && Boolean(resolvedSystem);
  const { expressible, inexpressible } = eligibleForCascadeSplit
    ? splitInexpressibleProperties(resolvedSystem, input.styles)
    : { expressible: input.styles, inexpressible: {} as Record<string, string> };
  const inexpressibleKeys = Object.keys(inexpressible);

  const manager = createDefaultStyleWriteManager({
    executor: new StyleWriteExecutor({
      fileIO: input.fileIO,
      projectRoot: input.projectRoot,
      additionalProjectRoots: input.additionalProjectRoots,
      domClasses: input.domClasses,
      probeDriving: input.probeDriving,
      requestedStyles: expressible,
    }),
  });
  const context = createStyleWriteContextFromRequest({
    filePath: input.sourceFilePath,
    elementRef,
    tagName: getTagName(input.element),
    styles: expressible,
    selectedSourceTabId: input.selectedSourceTabId,
    state: input.state,
    sourceOwners,
    elementCssSystems,
    projectCssSystems: elementCssSystems,
    projectDefaultCssSystem: input.projectDefaultCssSystem,
    runtimeThemeContext: input.runtimeThemeContext,
  });

  // Land the inexpressible properties inline FIRST, on the original (un-reformatted) element
  // position. The subsequent system write re-reads from the fileIO and only touches className, so the
  // inline style survives. Doing inline first avoids resolving the element against a position the
  // system write may have shifted by reprinting. No-op when nothing is inexpressible.
  const inlineMutatedFiles: string[] = [];
  if (inexpressibleKeys.length > 0) {
    const inlineWrite = await applyInlineFallbackWrite({
      fileIO: input.fileIO,
      sourceFilePath: input.sourceFilePath,
      elementRef,
      styles: inexpressible,
    });
    if (!inlineWrite.success) {
      return inlineWrite;
    }
    inlineMutatedFiles.push(...inlineWrite.mutatedFiles);
  }

  // Write the expressible properties to the resolved system. Skip the system write entirely if EVERY
  // requested property was inexpressible there (avoid an empty-class no-op) — the inline write above
  // already landed everything.
  let result: StyleWriteResult;
  if (Object.keys(expressible).length > 0) {
    const plan = await manager.createPlan(context);
    result = await manager.execute(plan);
  } else {
    // Every requested property was inexpressible in the resolved system and landed inline above; no
    // system plan was executed. The inline write is the whole write.
    result = { success: true, mutatedFiles: [] };
  }

  if (result.success === false) {
    return result;
  }
  if (inexpressibleKeys.length === 0) {
    return result;
  }

  const landedOn: StyleLandedFallback[] = inexpressibleKeys.map((key) => ({
    property: camelToKebab(key),
    system: 'inline-style',
    reason: 'inexpressible',
  }));
  const mutatedFiles = [...new Set([...inlineMutatedFiles, ...(result.mutatedFiles ?? [])])];
  return { success: true, plan: result.plan, mutatedFiles, landedOn };
}

/**
 * Split requested styles into those the resolved system can express vs those it cannot (D2 cascade).
 * For Tailwind, expressibility is decided by the generator: a property that yields no utility class
 * (even an arbitrary value) is inexpressible and falls to inline. TW v4 arbitrary values make this
 * rare (shadow-[…], text-[#…] etc. ARE expressible). Non-Tailwind systems express everything they
 * are asked for here (inline/css-modules accept any declaration), so nothing splits out.
 *
 * A property with an EMPTY value is a REMOVAL, never inexpressible (codex review): the Tailwind writer
 * needs the key in `requestedStyles` so `removeForProperties` strips the old utility. The generator
 * yields no class for an empty value, so it must stay expressible or clearing a Tailwind style would
 * silently leave the old class. Callers gate this to base-state, no-css-modules-owner cases.
 */
function splitInexpressibleProperties(
  system: CssSystemId,
  styles: Record<string, string>,
): { expressible: Record<string, string>; inexpressible: Record<string, string> } {
  if (system !== 'tailwind-v4' && system !== 'tailwind-v3') {
    return { expressible: styles, inexpressible: {} };
  }

  const expressible: Record<string, string> = {};
  const inexpressible: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    // Empty value = clear/removal → keep in the system write so the old utility is stripped.
    if (value === '' || value == null) {
      expressible[key] = value;
      continue;
    }
    const generated = generateTailwindClasses({ [key]: value }).trim();
    if (generated.length > 0) {
      expressible[key] = value;
    } else {
      inexpressible[key] = value;
    }
  }
  return { expressible, inexpressible };
}

/** Apply an inline-style override on the element for the inexpressible properties (D2 cascade floor). */
async function applyInlineFallbackWrite(input: {
  fileIO?: FileIO;
  sourceFilePath: string;
  elementRef: string;
  styles: Record<string, string>;
}): Promise<StyleWriteResult> {
  const parser = createFileParser(input.fileIO ?? new NodeFileIO());
  const { ast, absolutePath } = await parser.readAndParseFile(input.sourceFilePath);
  const position = parseElementRef(input.elementRef);
  const element = position ? (findElementByPosition(ast, position.line, position.column)?.element ?? null) : null;
  if (!element) {
    return { success: false, error: `Element not found for inline fallback: ${input.elementRef}` };
  }
  applyInlineStyleUpdate(element, input.styles);
  await parser.writeAST(ast, absolutePath);
  return { success: true, mutatedFiles: [absolutePath] };
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
  projectDefaultCssSystem?: CssSystemId,
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
    // Surfaceless element: floor to the UIKit-derived project default when the client supplied
    // one (D2 §4.3 — NOT a silent inline fallback). inline-style remains the last resort only when
    // no project default is threaded (single-select callers that don't pass one keep today's
    // behavior).
    systems.push(projectDefaultCssSystem ?? 'inline-style');
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
