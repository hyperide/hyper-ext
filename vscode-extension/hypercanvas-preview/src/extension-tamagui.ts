import { loadTamaguiPalette } from '@lib/tamagui/load-palette';
import { setTamaguiPalette } from '@lib/tamagui/values';
import { VSCodeFileIO } from './vscode-file-io';

/**
 * HYP-288: compute the project's Tamagui color palette from its config, or null
 * for non-Tamagui projects and unparseable (spread/imported) configs. Best-effort
 * static analysis only; callers fall back to the hardcoded Radix palette.
 */
async function computeTamaguiPalette(root: string, isTamagui: boolean): Promise<Record<string, string> | null> {
  if (!isTamagui) return null;
  try {
    return (await loadTamaguiPalette(root, new VSCodeFileIO()))?.palette ?? null;
  } catch (err) {
    console.warn('[HyperIDE] Failed to load Tamagui palette:', err);
    return null;
  }
}

/** Dedicated monotonic guard for palette installs. */
let paletteSeq = 0;
export async function applyTamaguiPalette(root: string, isTamagui: boolean): Promise<void> {
  const seq = ++paletteSeq;
  const palette = await computeTamaguiPalette(root, isTamagui);
  if (seq === paletteSeq) setTamaguiPalette(palette);
}
