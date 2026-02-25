/**
 * Heuristic-based project structure analysis.
 * Extracted from server/services/project-analyzer.ts
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { filterChildPaths } from './directory-tree.js';
import type { ProjectStructure } from './types.js';

/**
 * Analyze project structure using directory name heuristics (no AI).
 * Identifies atom/composite/page directories and UI component files.
 */
export async function analyzeWithHeuristics(projectPath: string, tree: string): Promise<ProjectStructure> {
  console.log('[ComponentScanner] Using heuristics fallback');

  const lines = tree.split('\n');
  const dirPaths: string[] = [];
  const pathStack: string[] = [];

  for (const line of lines) {
    if (!line.includes('\u{1F4C1}')) continue;

    const indent = line.match(/^\s*/)?.[0].length || 0;
    const depth = Math.floor(indent / 2);

    const match = line.match(/\u{1F4C1}\s+([^\s/]+)\//u);
    if (!match) continue;

    const dirName = match[1];
    pathStack.length = depth;
    pathStack.push(dirName);
    dirPaths.push(pathStack.join('/'));
  }

  console.log('[ComponentScanner] All directory paths:', dirPaths);

  // Atom components
  const atomPatterns = ['components', 'ui', 'atoms', 'elements', 'primitives'];
  let atomPaths = dirPaths
    .filter((p) => {
      const lowerPath = p.toLowerCase();
      if (lowerPath.includes('project-preview')) return false;
      if (!atomPatterns.some((pattern) => lowerPath.includes(pattern))) return false;
      const excludePatterns = ['examples', 'modules', 'features', 'pages', 'routes', 'screens', 'views'];
      if (excludePatterns.some((pattern) => lowerPath.includes(pattern))) return false;
      return true;
    })
    .sort((a, b) => b.split('/').length - a.split('/').length);

  atomPaths = filterChildPaths(atomPaths);

  // Composite components
  const compositePatterns = ['examples', 'modules', 'composites', 'molecules', 'features'];
  let compositePaths = dirPaths
    .filter((p) => {
      const lowerPath = p.toLowerCase();
      if (lowerPath.includes('project-preview')) return false;
      if (atomPaths.some((atomPath) => p === atomPath || p.startsWith(`${atomPath}/`))) return false;
      return compositePatterns.some((pattern) => lowerPath.includes(pattern));
    })
    .sort((a, b) => b.split('/').length - a.split('/').length);

  compositePaths = filterChildPaths(compositePaths);

  // Pages
  let pagesPaths = dirPaths
    .filter((p) => {
      const lowerPath = p.toLowerCase();
      const dirName = p.split('/').pop()?.toLowerCase() || '';
      if (lowerPath.includes('project-preview')) return false;
      if (atomPaths.some((atomPath) => p === atomPath || p.startsWith(`${atomPath}/`))) return false;
      if (compositePaths.some((compPath) => p === compPath || p.startsWith(`${compPath}/`))) return false;
      if (dirName === 'pages' || dirName === 'routes') return true;
      if (
        lowerPath.includes('/pages') ||
        lowerPath.includes('/routes') ||
        lowerPath.includes('/screens') ||
        lowerPath.includes('/views')
      )
        return true;
      return false;
    })
    .sort((a, b) => {
      const aName = a.split('/').pop()?.toLowerCase() || '';
      const bName = b.split('/').pop()?.toLowerCase() || '';
      const aExact = aName === 'pages' || aName === 'routes' ? 1 : 0;
      const bExact = bName === 'pages' || bName === 'routes' ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return b.split('/').length - a.split('/').length;
    });

  pagesPaths = filterChildPaths(pagesPaths);
  pagesPaths = pagesPaths.slice(0, 2);

  const uiComponents = await findUIComponents(projectPath, atomPaths);

  return {
    atomComponentsPaths: atomPaths.length > 0 ? atomPaths.map((p) => join(projectPath, p)) : [],
    compositeComponentsPaths: compositePaths.length > 0 ? compositePaths.map((p) => join(projectPath, p)) : [],
    pagesPaths: pagesPaths.length > 0 ? pagesPaths.map((p) => join(projectPath, p)) : [],
    textComponentPath: uiComponents.textComponentPath,
    linkComponentPath: uiComponents.linkComponentPath,
    buttonComponentPath: uiComponents.buttonComponentPath,
    imageComponentPath: uiComponents.imageComponentPath,
    containerComponentPath: uiComponents.containerComponentPath,
  };
}

/**
 * Search atom directories for common UI component files (Button, Text, etc.)
 */
export async function findUIComponents(
  projectPath: string,
  atomPaths: string[],
): Promise<{
  textComponentPath: string | null;
  linkComponentPath: string | null;
  buttonComponentPath: string | null;
  imageComponentPath: string | null;
  containerComponentPath: string | null;
}> {
  const uiComponents = {
    textComponentPath: null as string | null,
    linkComponentPath: null as string | null,
    buttonComponentPath: null as string | null,
    imageComponentPath: null as string | null,
    containerComponentPath: null as string | null,
  };

  const patterns = {
    text: ['text.tsx', 'typography.tsx', 'label.tsx', 'paragraph.tsx'],
    link: ['link.tsx', 'anchor.tsx'],
    button: ['button.tsx', 'btn.tsx'],
    image: ['image.tsx', 'picture.tsx', 'img.tsx'],
    container: ['flex.tsx', 'box.tsx', 'stack.tsx', 'container.tsx', 'group.tsx'],
  };

  const excludeForContainer = ['card', 'panel', 'section', 'modal', 'dialog'];

  for (const atomPath of atomPaths) {
    const absolutePath = join(projectPath, atomPath);

    try {
      const entries = await readdir(absolutePath, { withFileTypes: true, recursive: true });

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;

        const fileName = entry.name.toLowerCase();
        const fullPath = entry.parentPath ? join(entry.parentPath, entry.name) : join(absolutePath, entry.name);
        const relativePath = fullPath.replace(`${projectPath}/`, '');

        if (!uiComponents.textComponentPath && patterns.text.includes(fileName)) {
          uiComponents.textComponentPath = relativePath;
        }
        if (!uiComponents.linkComponentPath && patterns.link.includes(fileName)) {
          uiComponents.linkComponentPath = relativePath;
        }
        if (!uiComponents.buttonComponentPath && patterns.button.includes(fileName)) {
          uiComponents.buttonComponentPath = relativePath;
        }
        if (!uiComponents.imageComponentPath && patterns.image.includes(fileName)) {
          uiComponents.imageComponentPath = relativePath;
        }
        if (!uiComponents.containerComponentPath && patterns.container.includes(fileName)) {
          if (!excludeForContainer.some((pattern) => fileName.includes(pattern))) {
            uiComponents.containerComponentPath = relativePath;
          }
        }

        if (
          uiComponents.textComponentPath &&
          uiComponents.linkComponentPath &&
          uiComponents.buttonComponentPath &&
          uiComponents.imageComponentPath &&
          uiComponents.containerComponentPath
        ) {
          return uiComponents;
        }
      }
    } catch (error) {
      console.error(`[ComponentScanner] Error scanning directory ${absolutePath}:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    }
  }

  return uiComponents;
}
