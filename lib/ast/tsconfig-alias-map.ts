/**
 * @file Build a path-alias map from a project tsconfig for module resolution.
 *
 * Accessed via: VS Code extension `master:goToComponent` handler, which feeds the
 * resulting map into `resolveMasterComponent` so tsconfig path-alias imports
 * (`@/components/Button`) resolve to their definition files (HYP-563).
 *
 * Assumptions: only `compilerOptions.baseUrl` + `compilerOptions.paths` are read.
 * tsconfig `extends` chains and multiple path targets are NOT followed — the first
 * target wins. This is sufficient for the common single-root alias convention; the
 * VS Code definition-provider fallback covers the rest.
 */

import * as path from 'node:path';

/**
 * Strip `//` and block comments + trailing commas so tsconfig (JSONC) parses
 * via JSON.parse. Conservative: skips comment stripping inside string literals.
 */
function stripJsonc(input: string): string {
  let out = '';
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }

  // Remove trailing commas before } or ].
  return out.replace(/,(\s*[}\]])/g, '$1');
}

interface TsconfigShape {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

/**
 * Build an alias map: prefix → absolute directory/file prefix.
 *
 * Wildcard aliases (`@/*` → `src/*`) map the trimmed prefix (`@/`) to the
 * absolute target directory (`/proj/src/`). Exact aliases (`@app` → `src/app`)
 * map the full key to the absolute target.
 *
 * @param tsconfigSource - Raw tsconfig.json contents (JSONC tolerated).
 * @param projectRoot - Absolute path the tsconfig lives in (baseUrl is relative to it).
 */
export function buildAliasMapFromTsconfig(tsconfigSource: string, projectRoot: string): Record<string, string> {
  let parsed: TsconfigShape;
  try {
    parsed = JSON.parse(stripJsonc(tsconfigSource)) as TsconfigShape;
  } catch {
    return {};
  }

  const paths = parsed.compilerOptions?.paths;
  if (!paths) return {};

  const baseUrl = parsed.compilerOptions?.baseUrl ?? '.';
  const baseDir = path.resolve(projectRoot, baseUrl);

  const map: Record<string, string> = {};
  for (const [aliasKey, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target) continue;

    if (aliasKey.endsWith('/*') && target.endsWith('/*')) {
      const prefix = aliasKey.slice(0, -1); // '@/*' → '@/'
      const targetDir = target.slice(0, -2); // 'src/*' → 'src'
      map[prefix] = `${path.join(baseDir, targetDir).replace(/\/$/, '')}/`;
    } else {
      map[aliasKey] = path.join(baseDir, target);
    }
  }

  return map;
}
