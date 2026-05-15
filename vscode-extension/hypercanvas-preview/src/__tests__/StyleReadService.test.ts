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

  it('preserves editable=false through the catch fallback when fileIO throws unexpectedly', async () => {
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
