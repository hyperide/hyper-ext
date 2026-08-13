/**
 * @file StyleWriteExecutor tests — verifies shared style-write plan execution against AST files
 *
 * Accessed via: bun test lib/style-write/style-write-executor.test.ts
 * Assumptions: request execution can infer source owners from the selected JSX element before
 *   delegating to the same plan executor used by StyleWriteManager.
 */
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { createFileParser } from '@lib/ast/parser';
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
    expect(fileIO.content(appPath)).toContain("className='text-red-500 pl-[16px]'");
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
    expect(fileIO.content(appPath)).toContain("className='text-red-500 pl-[16px]'");
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
});
