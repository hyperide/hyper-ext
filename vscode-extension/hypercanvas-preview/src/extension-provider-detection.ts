import { access, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { detectFramework } from '@lib/preview-generator/framework-routing';
import type { SSRMockConfig } from '@lib/preview-generator';
import type { ProviderWrapConfig } from '@lib/preview-generator/types';
import { VSCodeFileIO } from './vscode-file-io';

interface ProviderContextFile {
  relativePath: string;
  content: string;
}

interface ThemeImport {
  importPath: string;
  importedName: string;
  localName: string;
  defaultImport: boolean;
}

export async function detectPreviewProviders(root: string): Promise<ProviderWrapConfig | undefined> {
  try {
    const previewDir = await getPreviewDir(root);
    const contextFiles = await readProviderContextFiles(root);
    if (contextFiles.length === 0) return undefined;

    const imports: string[] = [];
    let wrapOpen = '';
    let wrapClose = '';

    const pushImport = (line: string) => {
      if (!imports.includes(line)) imports.push(line);
    };

    const appendWrapper = (open: string, close: string) => {
      wrapOpen += open;
      wrapClose = `${close}${wrapClose}`;
    };

    const emotionTheme = findThemeProvider(contextFiles, '@emotion/react');
    if (emotionTheme) {
      pushImport("import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';");
      pushImport(buildThemeImport(root, previewDir, emotionTheme.file, emotionTheme.themeImport));
      appendWrapper(`<EmotionThemeProvider theme={${emotionTheme.themeImport.localName}}>`, '</EmotionThemeProvider>');
    }

    const styledTheme = findThemeProvider(contextFiles, 'styled-components');
    if (styledTheme) {
      pushImport("import { ThemeProvider as StyledThemeProvider } from 'styled-components';");
      pushImport(buildThemeImport(root, previewDir, styledTheme.file, styledTheme.themeImport));
      appendWrapper(`<StyledThemeProvider theme={${styledTheme.themeImport.localName}}>`, '</StyledThemeProvider>');
    }

    const appContent = contextFiles.map((file) => file.content).join('\n');
    const appFile = contextFiles.find((file) => file.content.includes('TamaguiProvider')) ?? contextFiles[0];

    const tamaguiCfg = appFile.content.match(
      /import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+['"]([^'"]*tamagui\.config[^'"]*)['"]/,
    );
    if (tamaguiCfg && appContent.includes('TamaguiProvider')) {
      const cfgVar = tamaguiCfg[1] || tamaguiCfg[2];
      const cfgPath = rebaseImportPath(root, previewDir, appFile.relativePath, tamaguiCfg[3]);
      const themeMatch = appContent.match(/defaultTheme=["'](\w+)["']/);
      const theme = themeMatch?.[1] || 'dark';
      pushImport("import { TamaguiProvider } from 'tamagui';");
      pushImport(tamaguiCfg[1] ? `import { ${cfgVar} } from '${cfgPath}';` : `import ${cfgVar} from '${cfgPath}';`);
      appendWrapper(`<TamaguiProvider config={${cfgVar}} defaultTheme="${theme}">`, '</TamaguiProvider>');
    }

    if (appContent.includes('SafeAreaProvider')) {
      pushImport("import { SafeAreaProvider } from 'react-native-safe-area-context';");
      wrapOpen = `<SafeAreaProvider>${wrapOpen}`;
      wrapClose = `${wrapClose}</SafeAreaProvider>`;
    }

    if (appContent.includes('NavigationContainer')) {
      pushImport("import { NavigationContainer } from '@react-navigation/native';");
      pushImport("import { NavigationIndependentTree } from '@react-navigation/core';");
      const tamaguiIdx = wrapOpen.indexOf('<TamaguiProvider');
      if (tamaguiIdx >= 0) {
        wrapOpen = `${wrapOpen.slice(0, tamaguiIdx)}<NavigationContainer><NavigationIndependentTree>${wrapOpen.slice(tamaguiIdx)}`;
        const tamaguiCloseIdx = wrapClose.indexOf('</TamaguiProvider>');
        if (tamaguiCloseIdx >= 0) {
          wrapClose = `${wrapClose.slice(0, tamaguiCloseIdx + '</TamaguiProvider>'.length)}</NavigationIndependentTree></NavigationContainer>${wrapClose.slice(tamaguiCloseIdx + '</TamaguiProvider>'.length)}`;
        }
      } else {
        wrapOpen = `<NavigationContainer><NavigationIndependentTree>${wrapOpen}`;
        wrapClose = `${wrapClose}</NavigationIndependentTree></NavigationContainer>`;
      }
    }

    if (appContent.includes('GalleryProvider')) {
      const galleryImportLine = contextFiles
        .flatMap((f) => f.content.split('\n'))
        .find((line) => line.includes('GalleryProvider') && line.trimStart().startsWith('import'));
      if (galleryImportLine) {
        const pathMatch = galleryImportLine.match(/from\s+['"]([^'"]+)['"]/);
        if (pathMatch) {
          const galleryPath = pathMatch[1];
          const hasLightbox = appContent.includes('GalleryLightbox');
          if (hasLightbox) {
            pushImport(`import { GalleryProvider, GalleryLightbox } from '${galleryPath}';`);
            appendWrapper('<GalleryProvider>', '<GalleryLightbox /></GalleryProvider>');
          } else {
            pushImport(`import { GalleryProvider } from '${galleryPath}';`);
            appendWrapper('<GalleryProvider>', '</GalleryProvider>');
          }
        }
      }
    }

    if (imports.length === 0) return undefined;
    return { imports, wrapOpen, wrapClose };
  } catch {
    return undefined;
  }
}

export async function detectSSRMockConfig(root: string): Promise<SSRMockConfig | undefined> {
  try {
    const { framework } = await detectFramework(root, new VSCodeFileIO());
    return framework === 'remix' ? { framework: 'remix' } : undefined;
  } catch {
    return undefined;
  }
}

async function detectFrontendRoot(root: string): Promise<string> {
  try {
    const html = await readFile(join(root, 'index.html'), 'utf-8'); // nosemgrep: path-join-resolve-traversal
    for (const scriptTag of html.matchAll(/<script\b([^>]*)>/g)) {
      const attrs = scriptTag[1];
      if (!/\btype=["']module["']/.test(attrs)) continue;
      const srcMatch = attrs.match(/\bsrc=["']\/([^/"']+)\/main\.[jt]sx?["']/);
      if (srcMatch && srcMatch[1] !== 'src') return srcMatch[1];
    }
  } catch {
    /* no index.html */
  }
  return 'src';
}

async function getPreviewDir(root: string): Promise<string> {
  try {
    await access(join(root, 'apps/next')); // nosemgrep: path-join-resolve-traversal
    return join(root, 'apps/next'); // nosemgrep: path-join-resolve-traversal
  } catch {
    const frontendRoot = await detectFrontendRoot(root);
    return join(root, frontendRoot); // nosemgrep: path-join-resolve-traversal
  }
}

async function readProviderContextFiles(root: string): Promise<ProviderContextFile[]> {
  const result: ProviderContextFile[] = [];
  const frontendRoot = await detectFrontendRoot(root);
  const rootPrefixes = frontendRoot !== 'src' ? [frontendRoot, 'src'] : ['src'];
  const fileNames = ['main.tsx', 'main.ts', 'App.web.tsx', 'App.tsx', 'app.tsx'];
  const candidates = [
    ...rootPrefixes.flatMap((r) => fileNames.map((f) => `${r}/${f}`)),
    'App.web.tsx',
    'App.tsx',
    'main.tsx',
    'main.ts',
  ];

  const seen = new Set<string>();
  for (const relativePath of candidates) {
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    try {
      const content = await readFile(join(root, relativePath), 'utf-8'); // nosemgrep: path-join-resolve-traversal
      result.push({ relativePath, content });
    } catch {
      /* file doesn't exist — try next */
    }
  }
  return result;
}

function findThemeProvider(
  files: ProviderContextFile[],
  packageName: '@emotion/react' | 'styled-components',
): { file: ProviderContextFile; themeImport: ThemeImport } | null {
  const escapedPackageName = packageName.replace('/', '\\/');
  const providerImport = new RegExp(`import\\s+[^;]*\\bThemeProvider\\b[^;]*from\\s+['"]${escapedPackageName}['"]`); // nosemgrep: detect-non-literal-regexp -- escaped constrained package-name literal, not user input

  for (const file of files) {
    if (!providerImport.test(file.content)) continue;
    const themeImport = extractThemeImport(file.content);
    if (themeImport) return { file, themeImport };
  }
  return null;
}

function extractThemeImport(source: string): ThemeImport | null {
  const namedImport = source.match(/import\s+\{([^}]*\btheme\b[^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
  if (namedImport) {
    const spec = namedImport[1]
      .split(',')
      .map((part) => part.trim())
      .find((part) => part === 'theme' || part.startsWith('theme as '));
    if (spec) {
      const alias = spec.match(/^theme\s+as\s+(\w+)$/);
      return {
        importPath: namedImport[2],
        importedName: 'theme',
        localName: alias?.[1] ?? 'theme',
        defaultImport: false,
      };
    }
  }

  const defaultImport = source.match(/import\s+(\w+)\s+from\s+['"]([^'"]*theme[^'"]*)['"]/);
  if (defaultImport) {
    return {
      importPath: defaultImport[2],
      importedName: defaultImport[1],
      localName: defaultImport[1],
      defaultImport: true,
    };
  }

  return null;
}

function buildThemeImport(
  root: string,
  previewDir: string,
  file: ProviderContextFile,
  themeImport: ThemeImport,
): string {
  const importPath = rebaseImportPath(root, previewDir, file.relativePath, themeImport.importPath);
  if (themeImport.defaultImport) {
    return `import ${themeImport.localName} from '${importPath}';`;
  }
  const spec =
    themeImport.importedName === themeImport.localName
      ? themeImport.importedName
      : `${themeImport.importedName} as ${themeImport.localName}`;
  return `import { ${spec} } from '${importPath}';`;
}

function rebaseImportPath(root: string, previewDir: string, sourceRelativePath: string, importPath: string): string {
  if (!importPath.startsWith('.')) return importPath;
  const absImportPath = resolve(dirname(join(root, sourceRelativePath)), importPath);
  let rebased = relative(previewDir, absImportPath);
  if (!rebased.startsWith('.')) rebased = `./${rebased}`;
  return rebased.replace(/\\/g, '/');
}
