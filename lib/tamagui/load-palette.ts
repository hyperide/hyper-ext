/**
 * @file Locate and load a project's Tamagui color palette from its config file.
 *
 * Accessed via: VS Code extension project-detection flow (HYP-288). Pure over an
 * injected FileIO so it unit-tests without a filesystem.
 * Assumptions: best-effort — tries a small set of conventional config locations
 * and returns the first one whose `tokens.color` is statically parseable. Returns
 * null otherwise; callers fall back to the hardcoded Radix palette.
 */

import type { FileIO } from '@lib/ast/file-io';
import { parseTamaguiConfigColors, type TamaguiPalette } from './parse-config-colors';

/** Conventional Tamagui config locations, checked in order (root + monorepo). */
const TAMAGUI_CONFIG_CANDIDATES = [
  'tamagui.config.ts',
  'tamagui.config.tsx',
  'src/tamagui.config.ts',
  'app/tamagui.config.ts',
  'packages/config/src/tamagui.config.ts',
  'packages/config/tamagui.config.ts',
  'packages/ui/src/tamagui.config.ts',
  'apps/next/tamagui.config.ts',
] as const;

export interface LoadedPalette {
  palette: TamaguiPalette;
  /** Absolute path of the config the palette was parsed from (for file watching). */
  configPath: string;
}

/** Join a workspace root and a relative path without pulling in node:path. */
function joinPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, '')}/${rel}`;
}

/**
 * Try each candidate config path under `workspaceRoot`, returning the palette
 * from the first one that exists and yields a statically resolvable
 * `tokens.color`. Returns null when none qualify.
 */
export async function loadTamaguiPalette(workspaceRoot: string, fileIO: FileIO): Promise<LoadedPalette | null> {
  for (const rel of TAMAGUI_CONFIG_CANDIDATES) {
    const configPath = joinPath(workspaceRoot, rel);
    let source: string;
    try {
      await fileIO.access(configPath);
      source = await fileIO.readFile(configPath);
    } catch {
      continue;
    }
    const palette = parseTamaguiConfigColors(source);
    if (palette) return { palette, configPath };
  }
  return null;
}
