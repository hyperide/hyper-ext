/**
 * @file Design token extraction service.
 *
 * Scans CSS/SCSS files for CSS custom properties (--var: value) and groups them
 * by category so the Inspector can display them in the "no selection" empty state.
 *
 * For monorepos the search root is narrowed to the nearest `package.json` ancestor
 * of `activeFilePath` that still sits inside `projectRoot`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type DesignTokenCategory = 'colors' | 'typography' | 'spacing' | 'shadows' | 'other';

export interface DesignToken {
  /** CSS custom property name, including leading dashes, e.g. `--color-primary` */
  name: string;
  /** Raw value string, e.g. `#ff0000` or `1rem` */
  value: string;
  category: DesignTokenCategory;
}

// ── Category classification ───────────────────────────────────────────────────

const COLOR_VALUE_RE = /^#[0-9a-f]{3,8}$|^rgb|^hsl|^oklch|^lch|^lab|^color\(/i;
const COLOR_NAME_RE =
  /color|background|foreground|border|fill|stroke|tint|shade|hue|palette|primary|secondary|accent|muted|destructive|success|warning|error|surface|canvas|bg$|fg$/;
const TYPOGRAPHY_NAME_RE = /font|text|letter|line-height|tracking|leading|typeface|weight/;
const SPACING_NAME_RE = /space|gap|padding|margin|size|radius|width|height|inset|gutter|offset/;
const SHADOW_NAME_RE = /shadow|blur|elevation|depth/;

function classifyToken(name: string, value: string): DesignTokenCategory {
  const n = name.toLowerCase();
  const v = value.trim();
  if (COLOR_VALUE_RE.test(v) || COLOR_NAME_RE.test(n)) return 'colors';
  if (TYPOGRAPHY_NAME_RE.test(n)) return 'typography';
  if (SPACING_NAME_RE.test(n)) return 'spacing';
  if (SHADOW_NAME_RE.test(n)) return 'shadows';
  return 'other';
}

// ── File discovery ────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', '.git', 'out', 'coverage', '.turbo']);

function findCssFiles(dir: string, maxDepth = 4): string[] {
  if (maxDepth <= 0) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCssFiles(full, maxDepth - 1));
    } else if (/\.(css|scss)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── Token parsing ─────────────────────────────────────────────────────────────

const CSS_VAR_SOURCE = /--([\w-]+)\s*:\s*([^;}\n]+)/g.source;

function extractFromCssContent(content: string): Array<{ name: string; value: string }> {
  const tokens: Array<{ name: string; value: string }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(CSS_VAR_SOURCE, 'g');
  while ((m = re.exec(content)) !== null) {
    const value = m[2].trim();
    if (value) tokens.push({ name: `--${m[1]}`, value });
  }
  return tokens;
}

// ── Monorepo root resolution ──────────────────────────────────────────────────

/**
 * Walk up from `activeFilePath` until we find a `package.json` whose dir is
 * still inside `projectRoot`. Falls back to `projectRoot` when nothing found.
 */
function resolveSearchRoot(projectRoot: string, activeFilePath?: string): string {
  if (!activeFilePath) return projectRoot;
  const root = path.resolve(projectRoot);
  let dir = path.dirname(path.resolve(activeFilePath));
  while (dir !== root) {
    // path.relative returns a '..' prefix when `dir` has escaped above or beside `root`
    // (e.g. /tmp/project-evil satisfies startsWith('/tmp/project') but is outside it).
    if (path.relative(root, dir).startsWith('..')) break;
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return root;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract CSS custom properties from CSS/SCSS files under `projectRoot`.
 *
 * For monorepos, pass `activeFilePath` so the scan is narrowed to the nearest
 * sub-package that contains the currently-open file.
 *
 * Returns at most one token per property name (first occurrence wins).
 */
export function extractDesignTokens(projectRoot: string, activeFilePath?: string): DesignToken[] {
  const searchRoot = resolveSearchRoot(projectRoot, activeFilePath);
  const cssFiles = findCssFiles(searchRoot);
  const seen = new Set<string>();
  const tokens: DesignToken[] = [];

  for (const file of cssFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, value } of extractFromCssContent(content)) {
      if (seen.has(name)) continue;
      seen.add(name);
      tokens.push({ name, value, category: classifyToken(name, value) });
    }
  }
  return tokens;
}
