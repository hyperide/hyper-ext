/**
 * @file Hook to extract and maintain color list from component preview
 *
 * Accessed via: Internal hook, used by ColorCombobox
 * Assumptions: preview iframe with id="preview-iframe" available in SaaS mode
 *
 * Strategy: reads computed styles from preview iframe DOM (captures all colors
 * including dynamic/conditional ones). Falls back to AST parsing when iframe
 * is unavailable (e.g. VS Code extension).
 */

import { useEffect, useMemo, useState } from 'react';
import type { ASTNode } from '@/lib/canvas-engine/types/ast';
import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import type { TokenSystem } from '../color-utils';
import { type ColorEntry, extractColorsFromPreview, extractComponentColors } from '../extract-component-colors';

export function useComponentColors(
  engine: CanvasEngine | null,
  componentPath: string | null,
  tokenSystem: TokenSystem,
): ColorEntry[] {
  const [treeVersion, setTreeVersion] = useState(0);

  useEffect(() => {
    if (!engine) return;

    const handler = () => setTreeVersion((v) => v + 1);
    engine.events.on('tree:change', handler);
    return () => {
      engine.events.off('tree:change', handler);
    };
  }, [engine]);

  /* eslint-disable react-hooks/exhaustive-deps -- treeVersion triggers recalculation on tree:change */
  return useMemo(() => {
    if (!engine || !componentPath) return [];

    const root = engine.getRoot();
    const astStructure = root?.metadata?.astStructure as ASTNode[] | undefined;

    // Primary: extract from rendered preview iframe (pass AST for line numbers)
    const previewColors = extractColorsFromPreview(tokenSystem, astStructure);
    if (previewColors.length > 0) return previewColors;

    // Fallback: extract from AST (for environments without preview iframe)
    if (!astStructure) return [];
    return extractComponentColors(astStructure, tokenSystem);
  }, [engine, componentPath, tokenSystem, treeVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */
}
