/**
 * @file StyleWriteExecutor tests — verifies shared style-write plan execution against AST files
 *
 * Accessed via: bun test lib/style-write/style-write-executor.test.ts
 * Assumptions: request execution can infer source owners from the selected JSX element before
 *   delegating to the same plan executor used by StyleWriteManager.
 */
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { parseCode } from '@lib/ast/parser';
import { createFileParser } from '@lib/ast/parser.node';
import { findElementByPosition } from '@lib/ast/position-finder';
import { executeStyleWriteRequest, StyleWriteExecutor } from './style-write-executor';
import { InMemoryFileIO } from './testing/in-memory-file-io';
import type {
  CssModulesFilePlan,
  PlainCssCreateRulePlan,
  PlainCssExistingOwnerPlan,
  ScriptObjectStylePlan,
  TailwindPlan,
} from './types';

async function parseElement(fileIO: FileIO, filePath: string, line: number, column: number) {
  const parser = createFileParser(fileIO);
  const { ast } = await parser.readAndParseFile(filePath);
  const result = findElementByPosition(ast, line, column);
  if (!result) {
    throw new Error(`Element not found at ${line}:${column}`);
  }
  return { ast, element: result.element };
}

function makeTailwindPlan(overrides: Partial<TailwindPlan> = {}): TailwindPlan {
  return {
    id: 'tailwind-plan',
    sourceForm: 'elementClass',
    cssSystem: 'tailwind-v4',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    requestedStyles: { paddingLeft: '16' },
    targetStyles: { paddingLeft: '16' },
    condition: { state: 'base' },
    reason: 'project-primary-system',
    confidence: 'exact',
    diagnostics: [],
    strategy: {
      mode: 'static',
      removeForProperties: ['paddingLeft'],
      addClasses: 'pl-[16px]',
    },
    target: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    ...overrides,
  };
}

function makeInlinePlan(overrides: Partial<ScriptObjectStylePlan> = {}): ScriptObjectStylePlan {
  return {
    id: 'inline-plan',
    sourceForm: 'scriptReactStyleRule',
    cssSystem: 'inline-style',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    requestedStyles: { opacity: '50', paddingLeft: '16' },
    targetStyles: { opacity: '0.5', paddingLeft: '16px' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    target: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
      objectPath: 'JSXAttribute[name=style]',
      styles: { opacity: '0.5', paddingLeft: '16px' },
      mergeMode: 'object',
    },
    ...overrides,
  };
}

function makeCssModulesPlan(overrides: Partial<CssModulesFilePlan> = {}): CssModulesFilePlan {
  return {
    id: 'css-modules-plan',
    sourceForm: 'cssStyleRule',
    cssSystem: 'css-modules',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    requestedStyles: { paddingLeft: '16' },
    targetStyles: { paddingLeft: '16px' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    target: {
      cssFilePath: 'src/App.module.css',
      cssSyntax: 'css',
      selector: '.root',
      declarations: { 'padding-left': '16px' },
      importSource: './App.module.css',
      importLocalName: 'styles',
      classKey: 'root',
    },
    ...overrides,
  };
}

function makePlainCssExistingPlan(overrides: Partial<PlainCssExistingOwnerPlan> = {}): PlainCssExistingOwnerPlan {
  return {
    id: 'plain-css-existing-plan',
    sourceForm: 'cssStyleRule',
    cssSystem: 'plain-css',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    requestedStyles: { color: 'blue' },
    targetStyles: { color: 'blue' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    target: {
      mode: 'existing-owner',
      cssFilePath: 'src/App.css',
      cssSyntax: 'css',
      selector: '.card',
      declarations: { color: 'blue' },
      cascadeOwner: {
        cssSystem: 'plain-css',
        sourceForm: 'cssStyleRule',
        filePath: 'src/App.css',
        selector: '.card',
        property: 'color',
        condition: { state: 'base' },
        confidence: 'exact',
      },
    },
    ...overrides,
  };
}

function makePlainCssCreatePlan(overrides: Partial<PlainCssCreateRulePlan> = {}): PlainCssCreateRulePlan {
  return {
    id: 'plain-css-create-plan',
    sourceForm: 'cssStyleRule',
    cssSystem: 'plain-css',
    projectRoot: '/project',
    sourceElement: {
      filePath: 'src/App.tsx',
      elementRef: 'src/App.tsx:3:4',
    },
    requestedStyles: { color: 'blue' },
    targetStyles: { color: 'blue' },
    condition: { state: 'base' },
    reason: 'css-rule-not-found',
    confidence: 'fallback',
    diagnostics: [],
    target: {
      mode: 'create-rule',
      cssFilePath: 'src/App.css',
      cssSyntax: 'css',
      selector: '.card',
      declarations: { color: 'blue' },
      createMode: {
        reason: 'explicit-new-selector',
        insertionHint: 'append-to-file',
      },
    },
    ...overrides,
  };
}

describe('StyleWriteExecutor', () => {
  it('executes static Tailwind plans by replacing conflicting classes', async () => {
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="pl-2 text-red-500">Hi</div>
  );
}
`,
    });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(makeTailwindPlan());

    expect(result).toEqual({
      success: true,
      plan: makeTailwindPlan(),
      mutatedFiles: [appPath],
    });
    // HYP-877: the original double quotes survive — only the class list changes.
    expect(fileIO.content(appPath)).toContain('className="text-red-500 pl-[16px]"');
  });

  describe('static className write is byte-surgical (HYP-877)', () => {
    // Mirrors the conloca repro: blank lines between JSX children, double-quoted attributes.
    // A one-class edit must not churn quotes, swallow blank lines, or drop the trailing newline.
    const makeFixture = (quote: string, trailingNewline: boolean) =>
      `export function AccountPage() {
  return (
    <div className=${quote}host-account min-h-screen bg-grey-12 text-grey-01${quote}>
      <header className=${quote}host-account__strip flex items-center${quote}>
        <button type=${quote}button${quote}>Back</button>
      </header>

      <div className=${quote}host-account__main flex flex-col${quote}>
        <h1 className=${quote}text-2xl font-semibold${quote}>Account</h1>
      </div>
    </div>
  );
}${trailingNewline ? '\n' : ''}`;

    const makeBgPlan = () =>
      makeTailwindPlan({
        requestedStyles: { backgroundColor: '#fde047' },
        targetStyles: { backgroundColor: '#fde047' },
        strategy: {
          mode: 'static',
          removeForProperties: ['backgroundColor'],
          addClasses: 'bg-yellow-300',
        },
      });

    async function runEdit(original: string): Promise<string> {
      const appPath = '/project/src/App.tsx';
      const fileIO = new InMemoryFileIO({ [appPath]: original });
      const executor = new StyleWriteExecutor({ fileIO });
      const result = await executor.execute(makeBgPlan());
      expect(result.success).toBe(true);
      return fileIO.content(appPath);
    }

    function expectOnlyTargetLiteralChanged(original: string, content: string, quote: string) {
      // The intended change happened.
      expect(content).toContain('bg-yellow-300');
      expect(content).not.toContain('bg-grey-12');
      // Every byte outside the target literal is identical: reconstruct the expected file by
      // splicing ONLY the new class list into the original source, then compare whole files.
      const expected = original.replace(
        `className=${quote}host-account min-h-screen bg-grey-12 text-grey-01${quote}`,
        `className=${quote}host-account min-h-screen text-grey-01 bg-yellow-300${quote}`,
      );
      expect(content).toBe(expected);
    }

    it('keeps double quotes, blank lines, and the trailing newline byte-identical', async () => {
      const original = makeFixture('"', true);
      const content = await runEdit(original);
      expectOnlyTargetLiteralChanged(original, content, '"');
    });

    it('keeps single quotes as single quotes', async () => {
      const original = makeFixture("'", true);
      const content = await runEdit(original);
      expectOnlyTargetLiteralChanged(original, content, "'");
    });

    it('does not add a trailing newline to a file that has none', async () => {
      const original = makeFixture('"', false);
      expect(original.endsWith('\n')).toBe(false);
      const content = await runEdit(original);
      expectOnlyTargetLiteralChanged(original, content, '"');
      expect(content.endsWith('\n')).toBe(false);
    });

    it('keeps offsets exact on CRLF line endings', async () => {
      const original = makeFixture('"', true).replaceAll('\n', '\r\n');
      const content = await runEdit(original);
      expectOnlyTargetLiteralChanged(original, content, '"');
      // CRLF endings outside the target literal are untouched (no LF normalization).
      expect(content).toContain('</header>\r\n\r\n');
    });

    it('switches to the alternate quote when the value clashes with the original quote char', async () => {
      // Tailwind arbitrary values can carry quotes: bg-[url('x.png')] cannot sit inside a
      // single-quoted attribute (JSX has no escapes), so the splice re-quotes JUST this literal
      // with double quotes — still byte-identical everywhere else, and valid JSX.
      const appPath = '/project/src/App.tsx';
      const original = `export function App() {
  return (
    <div className='pl-2 bg-grey-12'>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({ [appPath]: original });
      const executor = new StyleWriteExecutor({ fileIO });
      const result = await executor.execute(
        makeTailwindPlan({
          requestedStyles: { backgroundImage: "url('x.png')" },
          targetStyles: { backgroundImage: "url('x.png')" },
          strategy: {
            mode: 'static',
            removeForProperties: ['backgroundColor', 'backgroundImage'],
            addClasses: "bg-[url('x.png')]",
          },
        }),
      );
      expect(result.success).toBe(true);
      expect(fileIO.content(appPath)).toBe(
        original.replace(`className='pl-2 bg-grey-12'`, `className="pl-2 bg-[url('x.png')]"`),
      );
    });

    it('falls back to the AST write when the element has no className yet', async () => {
      const appPath = '/project/src/App.tsx';
      const original = `export function App() {
  return (
    <div>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({ [appPath]: original });
      const executor = new StyleWriteExecutor({ fileIO });
      const result = await executor.execute(makeBgPlan());
      expect(result.success).toBe(true);
      expect(fileIO.content(appPath)).toContain('bg-yellow-300');
    });
  });

  it('preserves untouched JSX formatting when rewriting a dynamic className (HYP-575)', async () => {
    const appPath = '/project/src/App.tsx';
    const original = `import cn from 'clsx';

export function OpaqueColorFixture() {
  return (
    <div className={cn("text-red-500 p-4", isActive && "font-bold")}>
      Hello opaque color world
    </div>
  );
}
`;
    const plan = makeTailwindPlan({
      sourceElement: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:5:4',
      },
      requestedStyles: { color: 'blue' },
      targetStyles: { color: 'blue' },
      strategy: {
        mode: 'dynamic',
        locations: [],
        addClasses: 'text-blue-500',
        removeForProperties: ['color'],
        fallbackStrategy: 'wrap-expression',
        analysis: {
          engine: 'shared-deterministic-analyzer',
        },
      },
      target: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:5:4',
      },
    });
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result.success).toBe(true);
    const content = fileIO.content(appPath);

    // The intended className change happened: blue replaced red.
    expect(content).toContain('text-blue-500');
    expect(content).not.toContain('text-red-500');

    // Every byte OUTSIDE the className attribute is byte-identical: the JSX text child keeps its
    // own line + indentation and the closing </div> stays on its own indented line. Reconstruct the
    // expected file by splicing ONLY the new className expression back into the original source.
    const newClassNameMatch = /className=(\{[\s\S]*?\}|"[^"]*")/.exec(content);
    expect(newClassNameMatch).not.toBeNull();
    const expected = original.replace(
      'className={cn("text-red-500 p-4", isActive && "font-bold")}',
      `className=${newClassNameMatch?.[1]}`,
    );
    expect(content).toBe(expected);

    // Explicit guards against the observed regression symptoms.
    expect(content).toContain('\n      Hello opaque color world\n');
    expect(content).toContain('\n    </div>\n');
  });

  it('still applies a dynamic className edit on a CRLF source (offset-drift fallback, HYP-877)', async () => {
    // spliceNodeSource refuses CRLF sources (normalized offsets misindex raw bytes), so the write
    // must land through the whole-file AST fallback: the change APPLIES and the file stays valid —
    // a silent no-op or a corrupted splice would both fail this.
    const appPath = '/project/src/App.tsx';
    const original = `import cn from 'clsx';

export function OpaqueColorFixture() {
  return (
    <div className={cn("text-red-500 p-4", isActive && "font-bold")}>
      Hello opaque color world
    </div>
  );
}
`.replaceAll('\n', '\r\n');
    const plan = makeTailwindPlan({
      sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:5:4' },
      requestedStyles: { color: 'blue' },
      targetStyles: { color: 'blue' },
      strategy: {
        mode: 'dynamic',
        locations: [],
        addClasses: 'text-blue-500',
        removeForProperties: ['color'],
        fallbackStrategy: 'wrap-expression',
        analysis: { engine: 'shared-deterministic-analyzer' },
      },
      target: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:5:4' },
    });
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result.success).toBe(true);
    const content = fileIO.content(appPath);
    expect(content).toContain('text-blue-500');
    expect(content).not.toContain('text-red-500');
    expect(() => parseCode(content)).not.toThrow();
  });

  it('preserves untouched JSX formatting for in-place template-literal className edits (HYP-575)', async () => {
    // Template-literal append mutates quasis IN PLACE (no node replacement). Verify the surgical
    // splice path also leaves the multi-line JSX child untouched for this distinct mutation shape.
    const appPath = '/project/src/App.tsx';
    const original = `export function TemplateFixture() {
  return (
    <span className={\`text-red-500 px-2 \${tone}\`}>
      first line
      second line
    </span>
  );
}
`;
    const plan = makeTailwindPlan({
      sourceElement: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:3:4',
      },
      requestedStyles: { color: 'blue' },
      targetStyles: { color: 'blue' },
      strategy: {
        mode: 'dynamic',
        locations: [],
        addClasses: 'text-blue-500',
        removeForProperties: ['color'],
        fallbackStrategy: 'append',
        analysis: {
          engine: 'shared-deterministic-analyzer',
        },
      },
      target: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:3:4',
      },
    });
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result.success).toBe(true);
    const content = fileIO.content(appPath);
    expect(content).toContain('text-blue-500');
    expect(content).not.toContain('text-red-500');

    // The multi-line JSX text child and the closing tag indentation are byte-identical.
    expect(content).toContain('\n      first line\n      second line\n    </span>\n');
  });

  it('fails dynamic Tailwind plans with precise locations until location mapping exists', async () => {
    const appPath = '/project/src/App.tsx';
    const original = `import cn from 'clsx';

export function App() {
  return (
    <div className={cn("pl-2 text-red-500")}>Hi</div>
  );
}
`;
    const plan = makeTailwindPlan({
      sourceElement: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:5:4',
      },
      strategy: {
        mode: 'dynamic',
        locations: [
          {
            filePath: 'src/App.tsx',
            line: 5,
            column: 24,
            expressionPath: 'JSXAttribute[name=className]/CallExpression/arguments/0',
          },
        ],
        addClasses: 'pl-[16px]',
        removeForProperties: ['paddingLeft'],
        fallbackStrategy: 'location-only',
        analysis: {
          engine: 'shared-deterministic-analyzer',
        },
      },
      target: {
        filePath: 'src/App.tsx',
        elementRef: 'src/App.tsx:5:4',
      },
    });
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result).toEqual({
      success: false,
      plan,
      error: 'Dynamic Tailwind plan locations are not supported by StyleWriteExecutor yet',
    });
    expect(fileIO.content(appPath)).toBe(original);
  });

  it('executes inline style object plans by merging style properties', async () => {
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div style={{ opacity: "0.2", color: "red" }}>Hi</div>
  );
}
`,
    });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(makeInlinePlan());

    expect(result).toEqual({
      success: true,
      plan: makeInlinePlan(),
      mutatedFiles: [appPath],
    });
    const content = fileIO.content(appPath);
    expect(content).toContain("opacity: '0.5'");
    expect(content).toContain('color: "red"');
    expect(content).toContain("paddingLeft: '16px'");
    expect(content).not.toContain('opacity: "0.2"');
  });

  it('executes CSS Modules file plans by updating the selected rule', async () => {
    const cssPath = '/project/src/App.module.css';
    const original = `.root {
  color: red;
}
`;
    const plan = makeCssModulesPlan();
    const fileIO = new InMemoryFileIO({ [cssPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result).toEqual({
      success: true,
      plan,
      mutatedFiles: [cssPath],
    });
    const content = fileIO.content(cssPath);
    expect(content).toContain('color: red');
    expect(content).toContain('padding-left: 16px');
  });

  it('executes plain CSS existing-owner plans inside matching at-rules', async () => {
    const cssPath = '/project/src/App.css';
    const original = `@media (min-width: 768px) {
  .card {
    color: red;
  }
}
`;
    const plan = makePlainCssExistingPlan({
      target: {
        mode: 'existing-owner',
        cssFilePath: 'src/App.css',
        cssSyntax: 'css',
        selector: '.card',
        declarations: { color: 'blue' },
        cascadeOwner: {
          cssSystem: 'plain-css',
          sourceForm: 'cssStyleRule',
          filePath: 'src/App.css',
          selector: '.card',
          property: 'color',
          condition: { state: 'base' },
          confidence: 'exact',
        },
        cascadeContext: {
          atRuleStack: [{ name: 'media', params: '(min-width: 768px)' }],
        },
      },
    });
    const fileIO = new InMemoryFileIO({ [cssPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result).toEqual({
      success: true,
      plan,
      mutatedFiles: [cssPath],
    });
    const content = fileIO.content(cssPath);
    expect(content).toContain('@media (min-width: 768px)');
    expect(content).toContain('color: blue');
    expect(content).not.toContain('color: red');
  });

  it('executes plain CSS create-rule plans by appending a rule', async () => {
    const cssPath = '/project/src/App.css';
    const original = `.existing {
  color: red;
}
`;
    const plan = makePlainCssCreatePlan();
    const fileIO = new InMemoryFileIO({ [cssPath]: original });
    const executor = new StyleWriteExecutor({ fileIO });

    const result = await executor.execute(plan);

    expect(result).toEqual({
      success: true,
      plan,
      mutatedFiles: [cssPath],
    });
    const content = fileIO.content(cssPath);
    expect(content).toContain('.existing');
    expect(content).toContain('.card');
    expect(content).toContain('color: blue');
  });

  it('routes computed writes to Tailwind when the element owns className styles', async () => {
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="pl-2 text-red-500">Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { paddingLeft: '16' },
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    expect(fileIO.content(appPath)).toContain('className="text-red-500 pl-[16px]"');
  });

  it('routes a cn() color write through the production planner and strips a short-circuit-branch color (HYP-537)', async () => {
    // Regression guard for the ROUTING, not just the mutator: prove the deterministic planner emits
    // a mode:'static' TailwindPlan (TailwindV4Writer always does), so executeTailwindPlan reaches
    // modifyDynamicClassName rather than bailing on the unsupported mode:'dynamic'+locations path.
    // The conflicting color lives only in `cond && "text-red-500"` — the HYP-537 case.
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `import cn from 'clsx';

export function App() {
  return (
    <div className={cn("p-2", cond && "text-red-500")}>Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 5, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '#3b82f6' },
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    const written = fileIO.content(appPath);
    // The old color in the `&&` branch is stripped (the fix reaches production routing).
    expect(written).not.toContain('text-red-500');
    // The conditional branch and the non-color base class are preserved.
    expect(written).toContain('cond &&');
    expect(written).toContain('p-2');
    // A new text color class is written.
    expect(written).toMatch(/text-\[#3b82f6\]|text-blue-500/);
  });

  it('routes computed writes to inline styles when no class source exists', async () => {
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div>Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { paddingLeft: '16' },
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    expect(fileIO.content(appPath)).toContain("paddingLeft: '16px'");
  });

  it('does not classify a DOM element with a matching attribute as Tamagui (HYP-637)', async () => {
    // <img width> is an HTML dimension attribute, not a Tamagui style prop. A width
    // style write must NOT route to the Tamagui prop writer just because the
    // requested style key collides with an existing DOM attribute name.
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <img src='/hero.png' width='200' />
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { width: '300' },
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    const written = fileIO.content(appPath);
    // Routed to the inline-style fallback — the HTML width attribute is untouched.
    expect(written).toContain("width: '300px'");
    expect(written).toContain("width='200'");
  });

  it('rejects unsupported explicit source tabs instead of falling back to Tailwind mutation', async () => {
    const appPath = '/project/src/App.tsx';
    const original = `export function App() {
  return (
    <div className="pl-2">Hi</div>
  );
}
`;
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { paddingLeft: '16' },
      selectedSourceTabId: 'tamagui:props',
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result).toEqual({
      success: false,
      error: 'Unsupported style source tab for request routing: tamagui:props',
    });
    expect(fileIO.content(appPath)).toBe(original);
  });

  // HYP-544: the live applied className (domClasses) must reach the writer and DECIDE the outcome.
  // The opaque-prop case: `clsx('p-2', titleClassName)`. The static AST cannot see what
  // titleClassName contributes, so the residual outcome depends entirely on the live DOM.
  describe('domClasses anchors the opaque-source residual (HYP-544)', () => {
    const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;

    async function writeColorWithDom(
      domClasses: string | undefined,
      pkg: Record<string, unknown> | null = { dependencies: { 'tailwind-merge': '^2.6.0' } },
    ): Promise<string> {
      const appPath = '/project/src/App.tsx';
      const files: Record<string, string> = { [appPath]: source };
      if (pkg) files['/project/package.json'] = JSON.stringify(pkg);
      const fileIO = new InMemoryFileIO(files);
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { color: '#3b82f6' },
        domClasses,
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'test-fixture',
        },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      return fileIO.content(appPath);
    }

    it('live DOM shows opaque arg contributed a same-group color → twMerge override applied', async () => {
      const out = await writeColorWithDom('p-2 text-red-500');
      // The opaque conflict the AST cannot strip forces a twMerge override so the new class wins.
      expect(out).toContain('twMerge');
      expect(out).toContain('text-blue-500');
      // The opaque prop is untouched.
      expect(out).toContain('titleClassName');
      // The wrap references twMerge, so the INJECTED import MUST also be written (a span-splice that
      // dropped it would emit twMerge(...) with no import → broken build). Regression guard for the
      // HYP-575 span-splice / #381 import-injection rebase interaction.
      expect(out).toMatch(/import\s*\{\s*twMerge[^}]*\}\s*from\s*['"]tailwind-merge['"]/);
    });

    it('tailwind-merge declared in the NEAREST package.json (monorepo leaf), not workspace root → twMerge override applied (HYP-564)', async () => {
      // Monorepo: the edited file is at apps/web/src/App.tsx. The workspace-root /project/package.json
      // does NOT declare tailwind-merge, but the leaf /project/apps/web/package.json DOES. The dep
      // check must resolve from the nearest package.json (walking up from the edited file), not only
      // the workspace root — otherwise canInjectTwMerge=false and the override degrades to the inline
      // floor even though the import would resolve fine in the leaf package.
      const appPath = '/project/apps/web/src/App.tsx';
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
        '/project/apps/web/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { color: '#3b82f6' },
        domClasses: 'p-2 text-red-500',
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'test-fixture',
        },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // The opaque conflict the AST cannot strip forces a twMerge override so the new class wins.
      expect(out).toContain('twMerge');
      expect(out).toContain('text-blue-500');
      // The wrap references twMerge, so the INJECTED import MUST also be written.
      expect(out).toMatch(/import\s*\{\s*twMerge[^}]*\}\s*from\s*['"]tailwind-merge['"]/);
      // The opaque prop is untouched.
      expect(out).toContain('titleClassName');
    });

    it('sibling dir whose name prefixes the project root must NOT be consulted by the dep walk (HYP-564)', async () => {
      // The edited file lives in a SIBLING /project-old whose path string is prefixed by the project
      // root /project. /project (and its subtree) does NOT declare tailwind-merge; the sibling
      // /project-old DOES. A string-prefix containment guard (dir.startsWith(stopAt)) wrongly treats
      // /project-old/src as "inside" /project, so the clamp is bypassed and the upward walk reads the
      // sibling's package.json — falsely injecting twMerge based on the wrong package. The walk must be
      // clamped with a path-relative containment check (start at the root when the file is outside it).
      const appPath = '/project-old/src/App.tsx';
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
        '/project-old/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { color: '#3b82f6' },
        domClasses: 'p-2 text-red-500',
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'test-fixture',
        },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // /project resolves no tailwind-merge and the sibling must not be consulted → inline §7 floor,
      // never an unresolvable twMerge import keyed off the wrong package.
      expect(out).not.toContain('twMerge');
      expect(out).not.toContain('tailwind-merge');
      expect(out).toMatch(/style=\{\{[^}]*[Cc]olor[^}]*#3b82f6/);
      expect(out).toContain('titleClassName');
    });

    it('SAME source, live DOM shows NO conflict → no twMerge override (minimal blast radius)', async () => {
      const out = await writeColorWithDom('p-2');
      expect(out).toContain('text-blue-500');
      // Nothing to beat → must not escalate to twMerge. Flipping domClasses flips the outcome,
      // proving the plumbed value is load-bearing (not dead plumbing).
      expect(out).not.toContain('twMerge');
    });

    it('domClasses absent → behaves as before (no escalation)', async () => {
      const out = await writeColorWithDom(undefined);
      expect(out).toContain('text-blue-500');
      expect(out).not.toContain('twMerge');
    });

    it('live conflict but project lacks tailwind-merge → inline-style floor, no unresolvable import (HYP-544 Phase 2 §7)', async () => {
      // No tailwind-merge in the edited project's package.json: injecting the import would break the
      // build. Pre-Phase-2 this fell back to a concat-append — but for an OPAQUE conflict (a same-group
      // color the static AST cannot strip, contributed by `titleClassName`) a concat-append does NOT win
      // the cascade (Tailwind resolves by generated-CSS order, not attribute order), so the inspector's
      // edit would silently not apply. §7's universal floor: drop to an inline `style` override on the
      // element ref — highest specificity short of !important, no import/config dependency.
      const out = await writeColorWithDom('p-2 text-red-500', { dependencies: { clsx: '^2.1.1' } });
      // The raw requested color lands as an inline style (the universal §7 floor).
      expect(out).toMatch(/style=\{\{[^}]*[Cc]olor[^}]*#3b82f6/);
      // No unresolvable import was written...
      expect(out).not.toContain('twMerge');
      expect(out).not.toContain('tailwind-merge');
      // ...and the opaque prop className is left intact (we did not rewrite/append the class expression).
      expect(out).toContain('titleClassName');
      expect(out).toContain("'p-2'");
    });
  });

  // HYP-544 Phase 3: when the empirical probe found that the color is driven by a CSS var / inline
  // style / hashed module class (NOT a Tailwind utility), a twMerge className wrap is a NO-OP
  // (inline/var wins specificity / a var-driven color isn't changed by adding a utility class). The
  // writer must redirect to an inline-style override on the element ref instead (the universal §7
  // floor), using the raw requested CSS value.
  describe('empirical-probe inline-override redirect (HYP-544 Phase 3)', () => {
    const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;

    async function writeWithProbe(
      probeDriving: Array<{
        kind: 'tailwind-class' | 'inline-style' | 'css-var' | 'module-class';
        token: string;
        locationHint: string;
      }>,
    ): Promise<string> {
      const appPath = '/project/src/App.tsx';
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        // A live conflict exists (so the static path WOULD twMerge), but the probe says a var drives it.
        domClasses: 'p-2 bg-blue-600',
        probeDriving,
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'test-fixture',
        },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      return fileIO.content(appPath);
    }

    it('css-var driver → inline-style override written, NO twMerge wrap', async () => {
      const out = await writeWithProbe([{ kind: 'css-var', token: '--brand', locationHint: 'computed' }]);
      // The raw requested color lands as an inline style on the element (specificity floor).
      expect(out).toMatch(/style=\{\{[^}]*[Bb]ackground[^}]*#dc2626/);
      // A twMerge className wrap would not change a var-driven color → must NOT be emitted.
      expect(out).not.toContain('twMerge');
      // The opaque prop className is left intact (we did not rewrite the class expression).
      expect(out).toContain('titleClassName');
    });

    it('inline-style driver → inline-style override written', async () => {
      const out = await writeWithProbe([{ kind: 'inline-style', token: 'rgb(30,64,175)', locationHint: 'style' }]);
      expect(out).toMatch(/style=\{\{[^}]*#dc2626/);
      expect(out).not.toContain('twMerge');
    });

    it('tailwind-class driver → NO inline redirect (keeps the existing twMerge path)', async () => {
      const out = await writeWithProbe([{ kind: 'tailwind-class', token: 'bg-blue-600', locationHint: 'class' }]);
      // A utility-class driver is handled by the className twMerge override, not an inline style.
      expect(out).toContain('twMerge');
      expect(out).not.toMatch(/style=\{\{/);
    });

    // codex P2: a LITERAL className plus an inline var that wins the cascade must take the inline-override
    // redirect — NOT rewrite the literal class (which the inline var would still override). The redirect
    // therefore runs BEFORE the `classNameType === 'string'` literal-rewrite branch.
    it('literal className + var driver → inline override, literal class NOT rewritten', async () => {
      const appPath = '/project/src/App.tsx';
      const litSource = `export function App() {
  return (
    <div className="p-2 bg-blue-600" style={{ backgroundColor: 'var(--brand)' }}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: litSource,
        '/project/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        domClasses: 'p-2 bg-blue-600',
        probeDriving: [{ kind: 'css-var', token: '--brand', locationHint: 'computed' }],
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // Inline override lands the new red...
      expect(out).toMatch(/style=\{\{[^}]*#dc2626/);
      // ...and the literal class is NOT rewritten to red (the var would have overridden it anyway).
      expect(out).toContain('bg-blue-600');
      expect(out).not.toContain('bg-red-600');
    });

    // The redirect is LOAD-BEARING: the SAME literal-class + inline-var element, WITHOUT a probe result,
    // takes the static path and rewrites `bg-blue-600 → bg-red-600` — which the inline var still wins, so
    // the visible color would not change. This is exactly the pre-Phase-3 failure the e2e fixture proves.
    it('SAME element WITHOUT probeDriving → rewrites the bg class (the broken pre-probe behavior)', async () => {
      const appPath = '/project/src/App.tsx';
      const litSource = `export function App() {
  return (
    <div className="p-2 bg-blue-600" style={{ backgroundColor: 'var(--brand)' }}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: litSource,
        '/project/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        domClasses: 'p-2 bg-blue-600',
        // no probeDriving
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // Static path rewrites the class (the var would still override it → no visible change). The probe
      // redirect (test above) is what fixes this — confirming the redirect is not dead plumbing.
      expect(out).toContain('bg-red-600');
      expect(out).not.toMatch(/style=\{\{[^}]*#dc2626/);
    });
  });

  // HYP-544 Phase 1: a same-file const literal that contributes the conflicting color is find-replaced
  // AT THE CONST (deterministic, AI-free) instead of escalating to a twMerge wrap. The const lives in a
  // DISJOINT top-level statement, so the rewrite goes through a second surgical splice — every byte
  // outside the className value's span AND outside the const literal's span must stay byte-identical.
  describe('same-file const binding resolution + surgical splice (HYP-544 Phase 1)', () => {
    const source = `import clsx from 'clsx';

const OPAQUE_BG = 'bg-blue-600';

export function App() {
  return (
    <div className={clsx('p-2', OPAQUE_BG)}>
      Hello opaque const world
    </div>
  );
}
`;

    async function writeBgConst(
      domClasses: string | undefined,
      pkg: Record<string, unknown> | null = { dependencies: { 'tailwind-merge': '^2.6.0' } },
    ): Promise<string> {
      const appPath = '/project/src/App.tsx';
      const files: Record<string, string> = { [appPath]: source };
      if (pkg) files['/project/package.json'] = JSON.stringify(pkg);
      const fileIO = new InMemoryFileIO(files);
      const { ast, element } = await parseElement(fileIO, appPath, 7, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#ef4444' }, // → bg-red-* family
        domClasses,
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'test-fixture',
        },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      return fileIO.content(appPath);
    }

    it('find-replaces the conflict at the const, NO twMerge, NO import, JSX bytes preserved', async () => {
      // The live DOM shows the const contributes bg-blue-600 (the opaque residual). Phase 1 follows the
      // binding and rewrites the const literal in place rather than wrapping the className in twMerge.
      const out = await writeBgConst('p-2 bg-blue-600');

      // The const literal carries the new background color; the old one is gone.
      expect(out).toMatch(/const OPAQUE_BG = ['"][^'"]*bg-red-[0-9]+[^'"]*['"]/);
      expect(out).not.toContain('bg-blue-600');
      // No twMerge wrap on the className and no tailwind-merge import injected.
      expect(out).not.toContain('twMerge');
      expect(out).not.toContain('tailwind-merge');
      // The className expression is the clean, untouched clsx call — no concat-append.
      expect(out).toContain("className={clsx('p-2', OPAQUE_BG)}");

      // BYTE PRESERVATION (HYP-575 splice property): everything outside the const literal span is
      // byte-identical. Reconstruct the expected file by splicing only the new const literal back into
      // the original, and assert full equality — this guards both the multi-line JSX child and the
      // import line against an accidental whole-file reprint.
      const newConstMatch = /const OPAQUE_BG = (['"][^'"]*['"]);/.exec(out);
      expect(newConstMatch).not.toBeNull();
      const expected = source.replace("'bg-blue-600'", newConstMatch?.[1] ?? '');
      expect(out).toBe(expected);

      // Explicit guards against the observed reprint symptoms.
      expect(out).toContain('\n      Hello opaque const world\n');
      expect(out).toContain('\n    </div>\n');
      expect(out).toContain("import clsx from 'clsx';");
    });

    it('still find-replaces at the const even when the project lacks tailwind-merge (no import needed)', async () => {
      // The const path never needs tailwind-merge — it edits the value directly. So a project without
      // the dependency still gets the clean const rewrite (NOT a concat-append fallback).
      const out = await writeBgConst('p-2 bg-blue-600', { dependencies: { clsx: '^2.1.1' } });
      expect(out).toMatch(/const OPAQUE_BG = ['"][^'"]*bg-red-[0-9]+[^'"]*['"]/);
      expect(out).not.toContain('bg-blue-600');
      expect(out).not.toContain('twMerge');
    });

    it('CODEX P1: mixed const-rewrite + opaque-prop residual writes twMerge WITH its injected import', async () => {
      // Both a same-file const (OPAQUE_BG, blue) and an opaque prop (props.bg, green) contribute live
      // same-group conflicts. The const is find-replaced AND the prop residual escalates to a twMerge
      // override that INJECTS `import { twMerge }`. The executor must whole-file recast in this mixed
      // case so the injected import actually reaches disk — a splice-only write would emit twMerge(...)
      // with no import, breaking the build.
      const mixedSource = `import clsx from 'clsx';

const OPAQUE_BG = 'bg-blue-600';

export function App(props) {
  return (
    <div className={clsx('p-2', OPAQUE_BG, props.bg)}>Hi</div>
  );
}
`;
      const appPath = '/project/src/App.tsx';
      const fileIO = new InMemoryFileIO({
        [appPath]: mixedSource,
        '/project/package.json': JSON.stringify({ dependencies: { 'tailwind-merge': '^2.6.0' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 7, 4);
      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#ef4444' },
        domClasses: 'p-2 bg-blue-600 bg-green-600',
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);

      // twMerge override present in the className...
      expect(out).toContain('twMerge');
      expect(out).toContain('bg-red-');
      // ...AND its import was actually written (the P1 bug would omit this).
      expect(out).toMatch(/import\s*\{\s*twMerge[^}]*\}\s*from\s*['"]tailwind-merge['"]/);
      // The same-file const was also rewritten in place (no longer blue).
      expect(out).not.toContain('bg-blue-600');
    });
  });

  // HYP-544 Phase 2 — the per-CSS-approach last-resort floor (spec §7). When find-replace finds no
  // same-file const, it's not a clean import→twMerge, and the probe found no driving candidate (or
  // twMerge isn't resolvable), apply the override-of-last-resort PER CSS APPROACH using the executor's
  // EXISTING plan machinery. The UNIVERSAL FLOOR is an inline `style` override on the element ref —
  // always available, highest specificity short of !important, no import/config dependency.
  describe('per-CSS-approach last-resort floor (HYP-544 Phase 2 §7)', () => {
    // (1) Tailwind project, twMerge UNAVAILABLE → inline `style` floor, NOT an unresolvable import.
    it('Tailwind + opaque conflict + no tailwind-merge → inline-style floor (NOT an import)', async () => {
      const appPath = '/project/src/App.tsx';
      const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        // No tailwind-merge — injecting `import { twMerge }` would break the user's build.
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        // Live DOM shows an opaque same-group color the static AST can't strip (from titleClassName).
        domClasses: 'p-2 bg-blue-600',
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // Universal floor: inline style override carries the raw requested color.
      expect(out).toMatch(/style=\{\{[^}]*[Bb]ackground[^}]*#dc2626/);
      // Never an unresolvable import / twMerge wrap.
      expect(out).not.toContain('twMerge');
      expect(out).not.toContain('tailwind-merge');
      // The opaque className expression is left intact — the floor does not append/rewrite it.
      expect(out).toContain('titleClassName');
      expect(out).toContain("'p-2'");
      expect(out).not.toContain('bg-blue-600'); // we never added the live class into source
    });

    // (4) Universal inline floor pins the final className state: a pure-opaque conflict leaves the
    // className node byte-untouched; only an inline `style` attribute is added. Guards against a future
    // static-strip interaction silently rewriting the expression.
    it('inline floor leaves the className expression untouched (only adds style)', async () => {
      const appPath = '/project/src/App.tsx';
      const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        domClasses: 'p-2 bg-blue-600',
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // className expression is byte-identical to the original (no append, no twMerge, no strip).
      expect(out).toContain("className={clsx('p-2', titleClassName)}");
      expect(out).toMatch(/style=\{\{/);
    });

    // NO live conflict → no floor: when domClasses shows nothing to beat, the floor must NOT fire. A
    // clean static color edit takes the normal append/strip path. Load-bearing guard: the floor must
    // not flood inline styles onto every dynamic-className edit.
    it('no live conflict → normal class write, NO inline floor', async () => {
      const appPath = '/project/src/App.tsx';
      const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        domClasses: 'p-2', // nothing same-group to beat
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // The class is appended/written; no inline style floor.
      expect(out).toMatch(/bg-red-600|bg-\[#dc2626\]/);
      expect(out).not.toMatch(/style=\{\{/);
    });

    // codex P2: an inline `style` is UNCONDITIONAL — it cannot express a state variant. A `hover:bg-*`
    // edit with no tailwind-merge must NOT floor to a plain inline `backgroundColor` (which would be
    // always-active and clobber the hover utility); it falls through to the legacy concat-append instead.
    it('state-variant edit (hover) does NOT floor to inline style', async () => {
      const appPath = '/project/src/App.tsx';
      const source = `export function App() {
  return (
    <div className={clsx('p-2', titleClassName)}>Hi</div>
  );
}
`;
      const fileIO = new InMemoryFileIO({
        [appPath]: source,
        '/project/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' } }),
      });
      const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

      const result = await executeStyleWriteRequest({
        ast,
        sourceFilePath: appPath,
        element,
        styles: { backgroundColor: '#dc2626' },
        state: 'hover',
        domClasses: 'p-2 hover:bg-blue-600',
        runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
        fileIO,
        projectRoot: '/project',
      });
      expect(result.success).toBe(true);
      const out = fileIO.content(appPath);
      // No unconditional inline background — a state variant cannot be expressed inline.
      expect(out).not.toMatch(/style=\{\{[^}]*[Bb]ackground/);
      // The state-prefixed class is preserved via the legacy concat-append path.
      expect(out).toMatch(/hover:bg-red-600|hover:bg-\[#dc2626\]/);
    });

    // (2) CSS Modules floor — a module-rule declaration is appended/overridden in the right rule via
    // executeCssFilePlan (postcss). This approach's floor is ALREADY wired through the existing CssFilePlan
    // path; this test pins it as the §7 CSS-Modules terminal.
    it('CSS Modules → postcss declaration appended/overridden in the source rule', async () => {
      const cssPath = '/project/src/App.module.css';
      const original = `.root {
  color: red;
}
`;
      const plan = makeCssModulesPlan();
      const fileIO = new InMemoryFileIO({ [cssPath]: original });
      const executor = new StyleWriteExecutor({ fileIO });

      const result = await executor.execute(plan);

      expect(result.success).toBe(true);
      const content = fileIO.content(cssPath);
      // The declaration lands in the resolved SOURCE selector's rule (`.root`, not a runtime hash).
      expect(content).toMatch(/\.root\s*\{/);
      expect(content).toContain('padding-left: 16px');
    });

    // (3) vanilla CSS floor — a declaration is added/overridden in the matched rule via executeCssFilePlan.
    it('vanilla CSS → declaration added/overridden in the matched rule', async () => {
      const cssPath = '/project/src/App.css';
      const original = `.card {
  color: red;
}
`;
      const plan = makePlainCssExistingPlan({
        target: {
          mode: 'existing-owner',
          cssFilePath: 'src/App.css',
          cssSyntax: 'css',
          selector: '.card',
          declarations: { color: 'blue' },
          cascadeOwner: {
            cssSystem: 'plain-css',
            sourceForm: 'cssStyleRule',
            filePath: 'src/App.css',
            selector: '.card',
            property: 'color',
            condition: { state: 'base' },
            confidence: 'exact',
          },
        },
      });
      const fileIO = new InMemoryFileIO({ [cssPath]: original });
      const executor = new StyleWriteExecutor({ fileIO });

      const result = await executor.execute(plan);

      expect(result.success).toBe(true);
      const content = fileIO.content(cssPath);
      expect(content).toContain('color: blue');
      expect(content).not.toContain('color: red');
    });
  });
});

describe('executeStyleWriteRequest — D2 priority cascade, per-property inexpressible fallback (CTO 2026-06-11)', () => {
  it('an inexpressible property falls to inline with a landedOn badge, while expressible props stay in Tailwind', async () => {
    // mixBlendMode has no Tailwind utility (the generator returns no class for it); color does
    // (text-[#f00]). The write must NOT silently drop mixBlendMode and must NOT skip the element —
    // it lands mixBlendMode inline (as an isolated per-property last resort) and keeps color in TW.
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="pl-2">Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '#ff0000', mixBlendMode: 'multiply' },
      selectedSourceTabId: 'auto',
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    const written = fileIO.content(appPath);
    // color stayed in Tailwind (arbitrary value), mixBlendMode landed inline.
    expect(written).toMatch(/text-\[#ff0000\]|text-red-500/);
    expect(written).toContain("mixBlendMode: 'multiply'");
    // The "where it landed" transparency signal names the inline-redirected property.
    expect(result.success === true && result.landedOn).toEqual([
      expect.objectContaining({ property: 'mix-blend-mode', system: 'inline-style', reason: 'inexpressible' }),
    ]);
  });

  it('a fully-expressible Tailwind write reports no landedOn fallback', async () => {
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="pl-2">Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '#ff0000' },
      selectedSourceTabId: 'auto',
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    expect(result.success === true && (result.landedOn ?? [])).toEqual([]);
  });

  it('an explicit pinned unsupported tab still errors — the cascade is for Auto/computed only', async () => {
    // A user who explicitly pins an unsupported target gets an honest error, not a silent inline
    // cascade. The always-writes cascade only governs Auto resolution.
    const appPath = '/project/src/App.tsx';
    const original = `export function App() {
  return (
    <div className="pl-2">Hi</div>
  );
}
`;
    const fileIO = new InMemoryFileIO({ [appPath]: original });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '#ff0000', mixBlendMode: 'multiply' },
      selectedSourceTabId: 'tamagui:props',
      runtimeThemeContext: {
        ideThemePreference: 'system',
        resolvedColorScheme: 'light',
        source: 'test-fixture',
      },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(false);
    expect(fileIO.content(appPath)).toBe(original);
  });

  it('clearing a Tailwind style (empty value) is a removal, NOT an inexpressible inline fallback (codex P1)', async () => {
    // Empty value = clear. It must stay on the Tailwind write so the old utility is stripped, never
    // dropped as an inline no-op (which would leave the class in place and falsely report success).
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="text-red-500 pl-2">Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '' },
      selectedSourceTabId: 'auto',
      runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    const written = fileIO.content(appPath);
    expect(written).not.toContain('text-red-500');
    // Not coerced into a bogus inline color.
    expect(written).not.toContain('color:');
    expect(result.success === true && (result.landedOn ?? [])).toEqual([]);
  });

  it('does NOT fall to inline under a pseudo-state — inline cannot represent hover (codex P2)', async () => {
    // mixBlendMode is inexpressible in TW, but under state=hover an inline fallback would become an
    // always-on base style. The split is gated to base state, so under hover the property stays in the
    // system write (no inline style attribute appears).
    const appPath = '/project/src/App.tsx';
    const fileIO = new InMemoryFileIO({
      [appPath]: `export function App() {
  return (
    <div className="pl-2">Hi</div>
  );
}
`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 3, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { color: '#ff0000', mixBlendMode: 'multiply' },
      selectedSourceTabId: 'auto',
      state: 'hover',
      runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
      fileIO,
      projectRoot: '/project',
    });

    expect(result.success).toBe(true);
    const written = fileIO.content(appPath);
    // No inline pseudo-state coercion — mixBlendMode did not land as a base inline style.
    expect(written).not.toContain('mixBlendMode');
    expect(result.success === true && (result.landedOn ?? [])).toEqual([]);
  });

  it('defers to the planner when the element has a CSS Modules owner — no inline shadowing (codex P2)', async () => {
    // cn(styles.root, 'p-2'): elementCssSystems[0] is Tailwind, but the planner may own a property via
    // the .module.css. The cascade split must NOT steal it to inline; with a css-modules owner present
    // the split is skipped entirely so the planner routes per-property.
    const appPath = '/project/src/App.tsx';
    const cssPath = '/project/src/App.module.css';
    const fileIO = new InMemoryFileIO({
      [appPath]: `import styles from './App.module.css';
export function App() {
  return (
    <div className={cn(styles.root, 'p-2')}>Hi</div>
  );
}
`,
      [cssPath]: `.root {\n  color: red;\n}\n`,
    });
    const { ast, element } = await parseElement(fileIO, appPath, 4, 4);

    const result = await executeStyleWriteRequest({
      ast,
      sourceFilePath: appPath,
      element,
      styles: { mixBlendMode: 'multiply' },
      selectedSourceTabId: 'auto',
      runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
      fileIO,
      projectRoot: '/project',
    });

    // The write resolved through the normal planner (css-modules owner present), not the inline split.
    // No cascade inline-fallback landedOn was emitted for it.
    expect(result.success === true && (result.landedOn ?? [])).toEqual([]);
  });
});
