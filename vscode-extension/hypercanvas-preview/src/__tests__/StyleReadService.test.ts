/**
 * @file StyleReadService tests for VS Code inspector source metadata
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts
 * Assumptions: NodeMapService source locations match Babel JSX element positions.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import type { FiberTraceResult, StyleReadContext, StyleReadManager, StyleReadResult } from '@lib/style-read/types';
import { StyleReadService } from '../services/StyleReadService';

const SIMPLE_JSX = `const App = () => <div className="text-red"><span>hello</span></div>;`;
const DYNAMIC_JSX = `const App = ({ active }) => (
  <button className={\`px-4 py-2 \${active ? 'bg-blue' : 'bg-gray'}\`}>Click</button>
);`;
const INLINE_STYLE_JSX = `const App = () => <div style={{ color: 'red', paddingLeft: 4 }}>hello</div>;`;
const CSS_MODULE_JSX = `import styles from './Card.module.css';

const App = () => <article className={styles.card}>hello</article>;`;
const WORKSPACE = '/workspace';
const FILE_PATH = '/workspace/src/App.tsx';
const CARD_FILE_PATH = '/workspace/src/Card.tsx';

function makeFileIO(files: Record<string, string>): FileIO {
  return {
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    writeFile: async () => {},
    access: async (path: string) => {
      if (!(path in files)) throw new Error(`File not found: ${path}`);
    },
  };
}

function getSyntheticRef(relativePath: string, line: number, column: number): string {
  return `${relativePath}:${line}:${column}`;
}

async function captureWarnings<T>(run: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

async function captureErrors<T>(run: () => Promise<T>): Promise<{ result: T; errors: string[] }> {
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    return { result: await run(), errors };
  } finally {
    console.error = originalError;
  }
}

describe('StyleReadService', () => {
  it('resolves element via syntheticRef when NodeMapService is empty (inspector cold start)', async () => {
    // NodeMapService starts empty — simulates cold start before any file edit
    const nodeMap = new NodeMapService();

    // Use a separate NodeMapService just to find the correct line/column for the test
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(SIMPLE_JSX, 'src/App.tsx');
    const divEntry = entries[0]; // div element

    const syntheticRef = getSyntheticRef('src/App.tsx', divEntry.loc.line, divEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.className).toBe('text-red');
    expect(result.tagType).toBe('div');
    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'tailwind-v4:elementClass']);
  });

  it('uses NodeMapService entry when it has the file parsed', async () => {
    const nodeMap = new NodeMapService();
    nodeMap.parseAndBuild(SIMPLE_JSX, FILE_PATH);

    const entries = nodeMap.getNodeMap(FILE_PATH) ?? [];
    const spanEntry = entries[1]; // span element

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    // Use the UUID-style nodeRef from NodeMapService
    const result = await service.readElementClassName('src/App.tsx', spanEntry.nodeRef);

    expect(result.tagType).toBe('span');
  });

  it('syntheticRef resolves span at correct column when two elements on same line', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(SIMPLE_JSX, 'src/App.tsx');
    const spanEntry = entries[1]; // span element

    const syntheticRef = getSyntheticRef('src/App.tsx', spanEntry.loc.line, spanEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.tagType).toBe('span');
  });

  it('returns empty when nodeRef is undefined', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', undefined);

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
  });

  it('returns empty when syntheticRef has wrong line/column (no element at position)', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const { result, warnings } = await captureWarnings(() =>
      service.readElementClassName('src/App.tsx', 'src/App.tsx:999:999'),
    );

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
    expect(warnings).toEqual([
      '[HyperCanvas] Selection lost after HMR — AST element not found at 999:999 for nodeRef: src/App.tsx:999:999',
    ]);
  });

  it('extracts static parts from dynamic template literal className', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(DYNAMIC_JSX, 'src/App.tsx');
    const btnEntry = entries[0]; // button element

    const syntheticRef = getSyntheticRef('src/App.tsx', btnEntry.loc.line, btnEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: DYNAMIC_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.className).toContain('px-4');
    expect(result.className).toContain('py-2');
    expect(result.tagType).toBe('button');
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      id: 'tailwind-v4:elementClass',
      confidence: 'probable',
    });
  });

  it('returns shared inline style source tab when the element has a style prop', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(INLINE_STYLE_JSX, 'src/App.tsx');
    const divEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', divEntry.loc.line, divEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: INLINE_STYLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'inline-style:style']);
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      label: 'Inline',
      cssSystem: 'inline-style',
      sourceForm: 'scriptReactStyleRule',
      confidence: 'exact',
    });
  });

  it('returns CSS Modules source tab for className member expressions', async () => {
    const nodeMap = new NodeMapService();

    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(CSS_MODULE_JSX, 'src/Card.tsx');
    const articleEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/Card.tsx', articleEntry.loc.line, articleEntry.loc.column);

    const fileIO = makeFileIO({ [CARD_FILE_PATH]: CSS_MODULE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const result = await service.readElementClassName('src/Card.tsx', syntheticRef);

    expect(result.styleReadResult?.sourceTabs.map((tab) => tab.id)).toEqual(['computed', 'css-modules:card']);
    expect(result.styleReadResult?.sourceTabs[1]).toMatchObject({
      label: '.card',
      cssSystem: 'css-modules',
      sourceForm: 'cssStyleRule',
      filePath: '/workspace/src/Card.module.css',
      selector: '.card',
      classKey: 'card',
      confidence: 'exact',
    });
  });

  it('returns empty when nodeRef is an opaque UUID and NodeMapService is empty', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const { result, warnings } = await captureWarnings(() =>
      service.readElementClassName('src/App.tsx', 'some-uuid-that-doesnt-exist'),
    );

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
    expect(warnings).toEqual([
      '[HyperCanvas] Selection lost after HMR — element not found for nodeRef: some-uuid-that-doesnt-exist',
    ]);
  });

  it('ignores stale bundle artifact nodeRefs without reading or logging errors', async () => {
    const nodeMap = new NodeMapService();
    const fileIO: FileIO = {
      readFile: mock(async () => {
        throw new Error('readFile should not be called for generated bundle artifacts');
      }),
      writeFile: async () => {},
      access: async () => {},
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);

    const { result, errors } = await captureErrors(() =>
      service.readElementClassName('src/App.tsx', '/workspace/bun-tw-shadcn-sample/_bun/client/index-abc.js:10:5'),
    );

    expect(result.className).toBe('');
    expect(result.tagType).toBe('unknown');
    expect(fileIO.readFile).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});

// =============================================================================
// fiberTrace source-class naming (HYP-545)
// =============================================================================

/**
 * Captures the StyleReadContext handed to the read manager so a test can assert
 * what the service actually puts into fiberTrace, which the public result hides.
 */
function makeTraceCapturingManager(): { manager: StyleReadManager; captured: StyleReadContext[] } {
  const captured: StyleReadContext[] = [];
  const emptyResult: StyleReadResult = {
    sourceTabs: [],
    properties: [],
    surfaceDecision: { standardStyleInspector: 'enabled', propsEditor: 'hidden', reasons: [] },
    activeConditions: { state: 'base' },
    availableConditionAxes: { states: [], viewportKeys: [], themeAxes: [], containerKeys: [] },
    diagnostics: [],
  };
  return {
    captured,
    manager: {
      async read(context: StyleReadContext): Promise<StyleReadResult> {
        captured.push(context);
        return emptyResult;
      },
    },
  };
}

describe('StyleReadService — fiberTrace source classes (HYP-545)', () => {
  it('populates the AST-static source-class field, not a misnamed runtime field', async () => {
    // The fiberTrace classes are derived from the JSX className AST (static string +
    // static fragments of dynamic expressions), never from the live DOM. The field name
    // must reflect that: staticSourceClasses, not runtimeClasses.
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(DYNAMIC_JSX, 'src/App.tsx');
    const btnEntry = entries[0]; // button element with template-literal className

    const syntheticRef = getSyntheticRef('src/App.tsx', btnEntry.loc.line, btnEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: DYNAMIC_JSX });
    const { manager, captured } = makeTraceCapturingManager();
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap, manager);

    await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(captured).toHaveLength(1);
    const trace = captured[0].fiberTrace as FiberTraceResult;

    // The new, honest field carries the static source fragments…
    expect(trace.staticSourceClasses).toEqual(['px-4', 'py-2']);
    // …the live-only conditional values are never in there (AST-static, not live DOM).
    expect(trace.staticSourceClasses).not.toContain('bg-blue');
    expect(trace.staticSourceClasses).not.toContain('bg-gray');
    // The misnamed field no longer exists.
    expect('runtimeClasses' in trace).toBe(false);
  });
});

// =============================================================================
// i18n binding detection
// =============================================================================

const I18N_JSX = `const Greeting = () => <p className="text-lg">{t("habits.walks")}</p>;`;
const PKG_WITH_I18N = JSON.stringify({ dependencies: { 'react-i18next': '^13.0.0' } });
const LOCALES_EN = JSON.stringify({ habits: { walks: 'Go for a walk' } });

describe('StyleReadService — i18n binding detection', () => {
  it('detects react-i18next t() call and resolves key from locale file', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0]; // <p> element

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const fileIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': LOCALES_EN,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText).toBeDefined();
    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('react-i18next');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
      expect(result.i18nText.activeLocale).toBe('en');
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('returns unsupported when no i18n library is detected in package.json', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // No package.json — library stays null → detectI18nBinding returns unsupported
    const fileIO = makeFileIO({ [FILE_PATH]: I18N_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText).toBeDefined();
    expect(result.i18nText?.kind).toBe('unsupported');
  });

  it('returns undefined i18nText for elements with plain text children', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(SIMPLE_JSX, FILE_PATH);
    const divEntry = entries[0]; // <div> with text children

    const syntheticRef = getSyntheticRef('src/App.tsx', divEntry.loc.line, divEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: SIMPLE_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    // <div>'s only child is <span>, which is not a known i18n component — i18nText is undefined
    expect(result.i18nText).toBeUndefined();
  });

  it('detects react-intl FormattedMessage JSX child element as i18n binding', async () => {
    const JSX_FM = `const Greeting = () => <p className="text-lg"><FormattedMessage id="habits.walks" /></p>;`;
    const PKG_REACT_INTL = JSON.stringify({ dependencies: { 'react-intl': '^6.0.0' } });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_FM, 'src/App.tsx');
    const pEntry = entries[0]; // <p> element

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const fileIO = makeFileIO({
      [FILE_PATH]: JSX_FM,
      '/workspace/package.json': PKG_REACT_INTL,
      '/workspace/locales/en.json': LOCALES_EN,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText).toBeDefined();
    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('react-intl');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('detects custom i18n from namespaced layout when no known package installed', async () => {
    const JSX_NS = `const Greeting = () => <p className="text-lg">{t("habits.walks", { ns: "common" })}</p>;`;
    const LOCALES_COMMON = JSON.stringify({ 'habits.walks': 'Go for a walk' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_NS, 'src/App.tsx');
    const pEntry = entries[0];
    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_NS,
      '/workspace/locales/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText).toBeDefined();
    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('does not treat a non-i18n hook destructuring t as custom i18n via import-chain', async () => {
    // const { t } = useTheme() — the local name `t` matches an i18n callee, but the hook it
    // comes from is not an i18n hook. The import-chain gate must only accept origins whose hook
    // name looks like i18n (isLikelyI18nOrigin veto); otherwise `useTheme().t` is misclassified
    // as custom i18n. No package.json and no locale files → import-chain is the only path that
    // could fire, so this isolates the veto.
    const JSX_THEME_T = `const Greeting = () => {
  const { t } = useTheme();
  return <p className="text-lg">{t("habits.walks")}</p>;
};`;

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_THEME_T, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const fileIO = makeFileIO({ [FILE_PATH]: JSX_THEME_T });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    // Veto fires: useTheme is not an i18n hook → library stays null → detectI18nBinding
    // reports unsupported instead of a false 'i18n' binding.
    expect(result.i18nText?.kind).not.toBe('i18n');
  });

  it('still detects custom i18n when t comes from an i18n-named hook (veto allows i18n origins)', async () => {
    // Counterpart to the veto test: const { t } = useTranslation() must still be accepted by the
    // import-chain gate, so the veto narrows but does not block legitimate i18n hooks.
    const JSX_USE_TRANSLATION = `const Greeting = () => {
  const { t } = useTranslation();
  return <p className="text-lg">{t("habits.walks")}</p>;
};`;
    const LOCALES_EN_LOCAL = JSON.stringify({ habits: { walks: 'Go for a walk' } });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_USE_TRANSLATION, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // No package.json: import-chain alone must recognise the i18n hook and resolve the key.
    const fileIO = makeFileIO({
      [FILE_PATH]: JSX_USE_TRANSLATION,
      '/workspace/locales/en.json': LOCALES_EN_LOCAL,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
    }
  });

  it('detects namespaced custom layout under src/i18n (multi-dir locale probe)', async () => {
    // The namespaced-layout probe historically only scanned locales/{locale}/{ns}.json. Projects
    // that keep dictionaries under src/i18n/ or messages/ were missed. The probe must iterate all
    // known flat-locale dirs so e.g. src/i18n/en/common.json is discovered.
    const JSX_USE_COPY_NS = `const Greeting = () => {
  const { t } = useCopy();
  return <p className="text-lg">{t("habits.walks", { ns: "common" })}</p>;
};`;
    const LOCALES_COMMON = JSON.stringify({ 'habits.walks': 'Go for a walk' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_USE_COPY_NS, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_USE_COPY_NS,
      '/workspace/src/i18n/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
    }
  });

  it('detects namespaced custom layout under messages/ (multi-dir locale probe)', async () => {
    // Second multi-dir variant: messages/{locale}/{ns}.json must also be probed.
    const JSX_USE_COPY_NS = `const Greeting = () => {
  const { t } = useCopy();
  return <p className="text-lg">{t("habits.walks", { ns: "common" })}</p>;
};`;
    const LOCALES_COMMON = JSON.stringify({ 'habits.walks': 'Go for a walk' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_USE_COPY_NS, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_USE_COPY_NS,
      '/workspace/messages/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
    }
  });

  it('detects namespaced custom layout under public/locales (multi-dir locale probe)', async () => {
    // Regression test for codex P2: NAMESPACED_LOCALE_DIRS omitted public/locales, which
    // FLAT_LOCALE_DIRS in resolve-i18n-resource.ts already supports. A custom hook like
    // useCopy().t(...) in a project with public/locales/{locale}/{ns}.json was misclassified
    // as unsupported because the probe never scanned public/locales/.
    const JSX_USE_COPY_NS = `const Greeting = () => {
  const { t } = useCopy();
  return <p className="text-lg">{t("habits.walks", { ns: "common" })}</p>;
};`;
    const LOCALES_COMMON = JSON.stringify({ 'habits.walks': 'Go for a walk' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_USE_COPY_NS, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_USE_COPY_NS,
      '/workspace/public/locales/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
    }
  });

  it('detects namespaced custom layout under src/locales (multi-dir locale probe)', async () => {
    // Regression test for codex P2: NAMESPACED_LOCALE_DIRS omitted src/locales, which
    // FLAT_LOCALE_DIRS in resolve-i18n-resource.ts already supports. A custom hook like
    // useCopy().t(...) in a project with src/locales/{locale}/{ns}.json was misclassified
    // as unsupported because the probe never scanned src/locales/.
    const JSX_USE_COPY_NS = `const Greeting = () => {
  const { t } = useCopy();
  return <p className="text-lg">{t("habits.walks", { ns: "common" })}</p>;
};`;
    const LOCALES_COMMON = JSON.stringify({ 'habits.walks': 'Go for a walk' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_USE_COPY_NS, 'src/App.tsx');
    const pEntry = entries.find((e) => e.tag === 'p');
    if (!pEntry) throw new Error('<p> not found in fixture');

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_USE_COPY_NS,
      '/workspace/src/locales/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
    }
  });

  it('returns i18nText with null resolvedText when locale file is missing', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // Has package.json (library detected) but no locale files
    const fileIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBeNull();
      expect(result.i18nText.editable).toBe(false);
    }
  });

  it('marks editable=true when active locale file exists but key is missing (user can type to create entry)', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // Locale file exists but does NOT contain the key — typing should create the entry
    const LOCALES_EN_NO_KEY = JSON.stringify({ other: 'value' });
    const fileIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': LOCALES_EN_NO_KEY,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBeNull();
      // Pin availableLocales so a regression that swallows the locale into the
      // catch-fallback (which sets availableLocales: []) fails loudly here.
      expect(result.i18nText.availableLocales).toContain('en');
      // Bug fix: editable must be true so the user can type a translation into the empty slot
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('marks editable=true when key resolves to empty string (user can type the translation)', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // Empty string is a valid translation value (placeholder slot waiting for content).
    // editable must stay true so the user can replace it; the literal "" round-trips as
    // resolvedText so the inspector can show the empty input.
    const LOCALES_EN_EMPTY = JSON.stringify({ habits: { walks: '' } });
    const fileIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': LOCALES_EN_EMPTY,
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.key).toBe('habits.walks');
      expect(result.i18nText.resolvedText).toBe('');
      expect(result.i18nText.editable).toBe(true);
      // Pin writable=true so a regression flipping the JSON layout to read-only
      // fails on the right axis instead of silently changing editable's failure
      // mode (editable = writable && (resolved || missing-key)).
      expect(result.i18nText.writable).toBe(true);
    }
  });

  it('marks editable=true for merged TS translations object files', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/client/lib/translations.ts': `export const translations = { en: { habits: { walks: 'Go for a walk' } }, ru: { habits: { walks: 'Гулять' } } };`,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
      expect(result.i18nText.editable).toBe(true);
      expect(result.i18nText.availableLocales.sort()).toEqual(['en', 'ru']);
    }
  });

  it('resolves selected locale text after DOM-text key lookup finds another locale', async () => {
    const JSX_DYNAMIC_KEY = `const Greeting = ({ keyName }) => <p className="text-lg">{t(keyName)}</p>;`;
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_DYNAMIC_KEY, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_DYNAMIC_KEY,
      '/workspace/client/lib/translations.ts': `export const translations = { ru: { hero: { title: 'Привет! Я собака Булка' } }, en: { hero: { title: 'Hello Bulka' } } };`,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef, 'Привет! Я собака Булка', 'en');

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.key).toBe('hero.title');
      expect(result.i18nText.activeLocale).toBe('en');
      expect(result.i18nText.resolvedText).toBe('Hello Bulka');
      expect(result.i18nText.availableLocales.sort()).toEqual(['en', 'ru']);
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('uses DOM text as primary custom i18n resolution when the source key is dynamic', async () => {
    const JSX_DYNAMIC_KEY = `const Greeting = ({ keyName }) => <p className="text-lg">{t(keyName)}</p>;`;
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_DYNAMIC_KEY, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_DYNAMIC_KEY,
      '/workspace/client/lib/translations.ts': `export const translations = { ru: { hero: { title: 'Привет! Я собака Булка' } }, en: { hero: { title: 'Hello Bulka' } } };`,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef, 'Привет! Я собака Булка', 'ru');

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.key).toBe('hero.title');
      expect(result.i18nText.resolvedText).toBe('Привет! Я собака Булка');
      expect(result.i18nText.editable).toBe(true);
    }
  });

  it('returns kind=i18n with null resolvedText when custom dictionary lacks the key (Gap C)', async () => {
    // Regression Gap C: previously this branch bailed to kind: 'unsupported', causing the
    // hook fallback `i18nText ?? prev.i18nText` to freeze the inspector on the
    // previous key/locale even after the user typed a brand new key. The fix
    // surfaces the binding with resolvedText: null so the inspector shows an
    // empty input and the key field reflects the JSX.
    //
    // Setup: namespaced custom layout (locales/<locale>/<ns>.json) with the requested
    // key absent. detectI18nBinding succeeds (library=custom, key extracted) but
    // resolveI18nResource returns resolvedText: null. Pre-fix: Gap C bail-out →
    // 'unsupported'. Post-fix: kind 'i18n' with null text.
    const JSX_CUSTOM = `const Greeting = () => <p className="text-lg">{t("missing.key", { ns: "common" })}</p>;`;
    const LOCALES_COMMON = JSON.stringify({ 'other.key': 'unrelated value' });

    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(JSX_CUSTOM, 'src/App.tsx');
    const pEntry = entries[0];
    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: JSX_CUSTOM,
      '/workspace/locales/en/common.json': LOCALES_COMMON,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.library).toBe('custom');
      expect(result.i18nText.key).toBe('missing.key');
      expect(result.i18nText.namespace).toBe('common');
      expect(result.i18nText.resolvedText).toBeNull();
      expect(result.i18nText.availableLocales).toContain('en');
      expect(result.i18nText.activeLocale).toBe('en');
    }
  });

  it('marks editable=false when locale file is malformed JSON (parse-error)', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // Locale file exists but is unparseable — writing would corrupt it further, so disable.
    const fileIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': '{ this is not valid json',
    });

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.resolvedText).toBeNull();
      // Distinguishes parse-error from missing-locale-file via availableLocales:
      // resolveI18nResource still discovers the locale even if the file is corrupt.
      expect(result.i18nText.availableLocales).toContain('en');
      expect(result.i18nText.editable).toBe(false);
    }
  });

  it('keeps editable=false through the catch fallback when fileIO throws unexpectedly', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    // FileIO surface error during locale resolution must not flip editable to true.
    const baseIO = makeFileIO({
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
    });
    const throwingIO: typeof baseIO = {
      ...baseIO,
      readFile: async (path: string) => {
        if (path.includes('/locales/')) throw new Error('EIO simulated');
        return baseIO.readFile(path);
      },
    };

    const service = new StyleReadService(WORKSPACE, throwingIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.resolvedText).toBeNull();
      expect(result.i18nText.editable).toBe(false);
    }
  });

  it('marks editable=true for static per-locale TS object files', async () => {
    const nodeMap = new NodeMapService();
    const helper = new NodeMapService();
    const entries = helper.parseAndBuild(I18N_JSX, 'src/App.tsx');
    const pEntry = entries[0];

    const syntheticRef = getSyntheticRef('src/App.tsx', pEntry.loc.line, pEntry.loc.column);

    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/messages/en.ts': `export default { habits: { walks: 'Go for a walk' } } as const;`,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };

    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const result = await service.readElementClassName('src/App.tsx', syntheticRef);

    expect(result.i18nText?.kind).toBe('i18n');
    if (result.i18nText?.kind === 'i18n') {
      expect(result.i18nText.resolvedText).toBe('Go for a walk');
      expect(result.i18nText.editable).toBe(true);
    }
  });
});

// =============================================================================
// getAvailableKeys
// =============================================================================

const FLAT_LOCALES_EN = JSON.stringify({
  'habits.walks': 'Go for a walk',
  'habits.runs': 'Go for a run',
  greeting: 'Hello',
});
const NESTED_LOCALES_EN = JSON.stringify({
  habits: { walks: 'Go for a walk', runs: 'Go for a run' },
  greeting: 'Hello',
});

describe('StyleReadService — getAvailableKeys', () => {
  it('returns all leaf keys from a flat locale file', async () => {
    const nodeMap = new NodeMapService();
    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': FLAT_LOCALES_EN,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en');
    expect(keys).toContain('habits.walks');
    expect(keys).toContain('habits.runs');
    expect(keys).toContain('greeting');
    expect(keys.length).toBe(3);
  });

  it('returns dot-path keys from a nested locale file', async () => {
    const nodeMap = new NodeMapService();
    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.json': NESTED_LOCALES_EN,
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en');
    expect(keys).toContain('habits.walks');
    expect(keys).toContain('habits.runs');
    expect(keys).toContain('greeting');
    expect(keys.length).toBe(3);
  });

  it('returns dot-path keys from a static per-locale TypeScript dictionary', async () => {
    const nodeMap = new NodeMapService();
    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.ts': 'export default { habits: { walks: "Go for a walk" }, greeting: "Hello" };',
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en');
    expect(keys).toContain('habits.walks');
    expect(keys).toContain('greeting');
    expect(keys.length).toBe(2);
  });

  it('returns dot-path keys from a react-i18next TypeScript locale file via ReactI18nextAdapter', async () => {
    const nodeMap = new NodeMapService();
    const files: Record<string, string> = {
      [FILE_PATH]: I18N_JSX,
      '/workspace/package.json': PKG_WITH_I18N,
      '/workspace/locales/en.ts': 'export default { habits: { walks: "Go for a walk" }, greeting: "Hello" };',
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en', 'react-i18next');
    expect(keys).toContain('habits.walks');
    expect(keys).toContain('greeting');
    expect(keys.length).toBe(2);
  });

  it('returns empty array when locale file is missing', async () => {
    const nodeMap = new NodeMapService();
    const fileIO = makeFileIO({ [FILE_PATH]: I18N_JSX });
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en');
    expect(keys).toEqual([]);
  });

  it('returns empty array on parse error', async () => {
    const nodeMap = new NodeMapService();
    const files: Record<string, string> = {
      '/workspace/locales/en.json': 'not valid json',
    };
    const fileIO: FileIO & { listFiles: (dir: string, exts: string[]) => Promise<string[]> } = {
      ...makeFileIO(files),
      listFiles: async (dir: string, exts: string[]) => {
        return Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && exts.some((e) => f.endsWith(e)));
      },
    };
    const service = new StyleReadService(WORKSPACE, fileIO, nodeMap);
    const keys = await service.getAvailableKeys(undefined, 'en');
    expect(keys).toEqual([]);
  });
});
