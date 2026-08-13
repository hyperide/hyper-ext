/**
 * @file Name collision resolution and identifier utilities for preview generator
 *
 * Accessed via: preview-generator/generator.ts (deriveUniquePrefix)
 * Assumptions: component names are PascalCase valid JS identifiers
 */

import { basename, dirname } from 'node:path';
import type { PreviewComponentEntry } from './generator';

/**
 * Detect name collisions and derive unique prefixes.
 * Two `Button.tsx` in different dirs → `UiButton` / `FormButton`.
 */
export function deriveUniquePrefix(
  entries: PreviewComponentEntry[],
  reservedNames: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const nameToEntries = new Map<string, PreviewComponentEntry[]>();
  for (const entry of entries) {
    const list = nameToEntries.get(entry.componentName) ?? [];
    list.push(entry);
    nameToEntries.set(entry.componentName, list);
  }

  const result = new Map<string, string>();
  for (const [, group] of nameToEntries) {
    if (group.length === 1 && !reservedNames.has(group[0].componentName)) {
      result.set(group[0].componentPath, group[0].componentName);
      continue;
    }

    const prefixed = new Map<string, string>();
    for (const entry of group) {
      const parentDir = basename(dirname(entry.componentPath));
      const prefix = parentDir && parentDir !== '.' ? parentDir.charAt(0).toUpperCase() + parentDir.slice(1) : 'Root';
      prefixed.set(entry.componentPath, `${prefix}${entry.componentName}`);
    }

    const names = [...prefixed.values()];
    const hasDupes = hasAliasConflict(names, reservedNames);

    if (hasDupes) {
      const platformResolved = new Map<string, string>();
      for (const entry of group) {
        const fileBase = basename(entry.componentPath).replace(/\.(tsx?|jsx?)$/, '');
        const dotIdx = fileBase.indexOf('.');
        if (dotIdx !== -1) {
          const platformSegments = fileBase
            .slice(dotIdx + 1)
            .split('.')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
          platformResolved.set(entry.componentPath, `${entry.componentName}${platformSegments.join('')}`);
        }
      }
      const platformAliases = group.map((e) => platformResolved.get(e.componentPath) ?? e.componentName);
      if (!hasAliasConflict(platformAliases, reservedNames)) {
        for (const entry of group) {
          result.set(entry.componentPath, platformResolved.get(entry.componentPath) ?? entry.componentName);
        }
        continue;
      }

      const pathResolved = new Map<string, string>();
      for (const entry of group) {
        const parts = dirname(entry.componentPath)
          .split('/')
          .filter((p) => p && p !== '.');
        const grandparent = parts.length >= 2 ? parts[parts.length - 2] : '';
        const parent = parts[parts.length - 1] ?? '';
        const fileStem = basename(entry.componentPath).replace(/\.(tsx?|jsx?)$/, '');
        const segments = [grandparent, parent, fileStem].filter(Boolean).map(toIdentifierSegment);
        pathResolved.set(entry.componentPath, segments.join('') || `Root${entry.componentName}`);
      }

      const pathAliases = group.map((e) => pathResolved.get(e.componentPath) ?? e.componentName);
      if (!hasAliasConflict(pathAliases, reservedNames)) {
        for (const entry of group) {
          result.set(entry.componentPath, pathResolved.get(entry.componentPath) ?? entry.componentName);
        }
        continue;
      }

      for (const [index, entry] of group.entries()) {
        result.set(entry.componentPath, `${pathResolved.get(entry.componentPath) ?? entry.componentName}${index + 1}`);
      }
    } else {
      for (const [path, name] of prefixed) {
        result.set(path, name);
      }
    }
  }
  return result;
}

function hasAliasConflict(names: string[], reservedNames: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name) || reservedNames.has(name)) return true;
    seen.add(name);
  }
  return false;
}

function toIdentifierSegment(segment: string): string {
  const words = segment.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const value = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  if (!value) return '';
  return /^[0-9]/.test(value) ? `_${value}` : value;
}

export function extractImportedBindings(importLines: string[]): Set<string> {
  const bindings = new Set<string>();
  for (const line of importLines) {
    const namespaceMatch = line.match(/^import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (namespaceMatch?.[1]) {
      bindings.add(namespaceMatch[1]);
      continue;
    }

    const defaultMatch = line.match(/^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|\s+from\b)/);
    if (defaultMatch?.[1]) bindings.add(defaultMatch[1]);

    const namedMatch = line.match(/\{([^}]+)\}/);
    if (!namedMatch?.[1]) continue;
    for (const part of namedMatch[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('type ')) continue;
      const aliasMatch = trimmed.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (aliasMatch?.[1]) {
        bindings.add(aliasMatch[1]);
        continue;
      }
      const nameMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (nameMatch?.[1]) bindings.add(nameMatch[1]);
    }
  }
  return bindings;
}
