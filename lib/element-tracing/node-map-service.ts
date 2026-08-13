/**
 * @file NodeMapService — orchestrates file parsing, NodeMap building, and source location resolution
 *
 * Accessed via: Internal module — consumed by TracingTransport implementations (SaaS server,
 * VS Code extension) to maintain per-file node maps and resolve React fiber source locations
 * Assumptions: Source files are valid JSX/TSX parseable by Babel with typescript + jsx plugins
 * Tradeoffs: In-memory only — no persistence across process restarts
 * Architecture: https://hyperide.github.io/reports/element-tracing
 */

import { createHash } from 'node:crypto';
import { type ParseResult, parse } from '@babel/parser';
import type * as t from '@babel/types';
import { toProjectRelative } from '../../shared/element-tracing/path-normalization';
import type { NodeMapEntry, NodeMapUpdate, NodeRef, SourceLocation } from '../../shared/element-tracing/types';
import { buildNodeMap } from './node-map-builder';
import { mapNodeRefs } from './stability';

interface FileState {
  entries: NodeMapEntry[];
  version: number;
  hash: string;
  /** Keyed by "fileName:line:column" for fast exact lookup */
  locIndex: Map<string, NodeMapEntry>;
  /** Keyed by nodeRef */
  refIndex: Map<NodeRef, NodeMapEntry>;
}

export class NodeMapService {
  /** Keyed by stored filePath — relative when projectRoot is set, as-passed otherwise. */
  private readonly files = new Map<string, FileState>();
  private projectRoot?: string;

  /**
   * Configure the workspace root used to normalize host-absolute file paths
   * to project-relative form. When set, `parseAndBuild`, `reparseAndUpdate`,
   * `getNodeMap`, `resolveSourceLocation`, etc. accept any of the three forms
   * (host-absolute, sandbox-prefixed, or already-relative) and normalize
   * internally to a single canonical key. When unset, keys stay exactly as
   * passed — preserving legacy behaviour while callers migrate.
   *
   * Sandbox container prefixes (`/app/`) are handled at lookup time in
   * `resolveSourceLocation` regardless of this setting.
   */
  setProjectRoot(projectRoot: string): void {
    if (this.projectRoot === projectRoot) return;
    this.projectRoot = projectRoot;

    // Rebuild any entries that were populated before the root was known so
    // they re-key under the new canonical form. Without this, a file seeded
    // via `onFileChanged` before the initial scan finishes would stay under
    // its absolute key and future lookups would miss. nodeRef hierarchy is
    // rewritten in lockstep to keep `filePath`, `loc.fileName`, and
    // `${nodeRef.prefix}` aligned — inconsistency would break callers that
    // derive the map key from a selected id (e.g. CanvasElementContextMenu).
    if (this.files.size === 0) return;
    const oldStates = [...this.files.values()];
    this.files.clear();
    for (const state of oldStates) {
      if (state.entries.length === 0) continue;
      const oldFileName = state.entries[0].loc.fileName;
      const newKey = this.toStorageKey(oldFileName);
      if (newKey === oldFileName) {
        this.files.set(newKey, state);
        continue;
      }

      const refMap = new Map<NodeRef, NodeRef>();
      const oldPrefix = `${oldFileName}:`;
      for (const entry of state.entries) {
        if (entry.nodeRef.startsWith(oldPrefix)) {
          refMap.set(entry.nodeRef, `${newKey}:${entry.nodeRef.slice(oldPrefix.length)}`);
        }
      }
      const mapRef = (ref: NodeRef): NodeRef => refMap.get(ref) ?? ref;
      const rekeyedEntries: NodeMapEntry[] = state.entries.map((entry) => ({
        ...entry,
        nodeRef: mapRef(entry.nodeRef),
        loc: { ...entry.loc, fileName: newKey },
        endLoc: { ...entry.endLoc, fileName: newKey },
        parentRef: entry.parentRef === null ? null : mapRef(entry.parentRef),
        children: entry.children.map(mapRef),
      }));

      this.files.set(newKey, {
        entries: rekeyedEntries,
        version: state.version,
        hash: state.hash,
        locIndex: buildLocIndex(rekeyedEntries),
        refIndex: buildRefIndex(rekeyedEntries),
      });
    }
  }

  /** Parse `sourceCode` for `filePath`, build entries, and store them. Returns the entry list. */
  parseAndBuild(sourceCode: string, filePath: string): NodeMapEntry[] {
    const key = this.toStorageKey(filePath);
    const ast = this.safeParse(sourceCode, key);
    if (ast === null) return [];

    const entries = buildNodeMap(ast, key);
    const hash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const locIndex = buildLocIndex(entries);
    const refIndex = buildRefIndex(entries);

    this.files.set(key, { entries, version: 1, hash, locIndex, refIndex });
    return entries;
  }

  /**
   * Re-parse `sourceCode` for an already-tracked `filePath`.
   * Computes ref stability mapping from the old entries to the new ones.
   * Returns a `NodeMapUpdate` with the new entries, incremented version, and refMapping.
   *
   * When projectRoot is set, normalizes `filePath` so mutation callsites
   * (host-absolute) and populate callers (sandbox or relative) converge on
   * the same entry. Without projectRoot, behaves as before — key is `filePath`.
   */
  reparseAndUpdate(sourceCode: string, filePath: string): NodeMapUpdate {
    const key = this.toStorageKey(filePath);
    const existing = this.files.get(key);
    const oldEntries = existing?.entries ?? [];
    const oldVersion = existing?.version ?? 0;

    const ast = this.safeParse(sourceCode, key);
    if (ast === null) {
      return {
        type: 'node-map-update',
        filePath: key,
        fileHash: existing?.hash ?? '',
        version: oldVersion,
        nodes: oldEntries,
      };
    }

    const newEntries = buildNodeMap(ast, key);
    const hash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const newVersion = oldVersion + 1;
    const locIndex = buildLocIndex(newEntries);
    const refIndex = buildRefIndex(newEntries);

    this.files.set(key, {
      entries: newEntries,
      version: newVersion,
      hash,
      locIndex,
      refIndex,
    });

    const refMapping = mapNodeRefs(oldEntries, newEntries);

    return {
      type: 'node-map-update',
      filePath: key,
      fileHash: hash,
      version: newVersion,
      nodes: newEntries,
      refMapping,
    };
  }

  /** Returns current entries for a file, or null if not tracked. */
  getNodeMap(filePath: string): NodeMapEntry[] | null {
    return this.files.get(this.toStorageKey(filePath))?.entries ?? null;
  }

  /** Returns the 16-char SHA-256 hash of the last parsed content, or null. */
  getFileHash(filePath: string): string | null {
    return this.files.get(this.toStorageKey(filePath))?.hash ?? null;
  }

  /** Returns all currently tracked file paths. */
  getTrackedFiles(): string[] {
    return [...this.files.keys()];
  }

  /** Remove a file from tracking (e.g. on file deletion). */
  removeFile(filePath: string): void {
    this.files.delete(this.toStorageKey(filePath));
  }

  /**
   * Resolve a source location (from a React fiber's _debugSource) to its NodeMapEntry.
   * Tries an exact locKey match first; then re-tries with the input normalized via
   * the configured projectRoot or sandbox prefix strip; falls back to column=0
   * tolerance and suffix-match for edge cases.
   */
  resolveSourceLocation(source: SourceLocation): NodeMapEntry | null {
    const exactKey = makeLocKey(source.fileName, source.line, source.column);
    for (const state of this.files.values()) {
      const hit = state.locIndex.get(exactKey);
      if (hit) return hit;
    }

    const normalized = toProjectRelative(source.fileName, this.projectRoot);
    if (normalized !== source.fileName) {
      const normKey = makeLocKey(normalized, source.line, source.column);
      for (const state of this.files.values()) {
        const hit = state.locIndex.get(normKey);
        if (hit) return hit;
      }
    }

    if (source.column !== 0) {
      const fallbackKey = makeLocKey(normalized, source.line, 0);
      for (const state of this.files.values()) {
        const hit = state.locIndex.get(fallbackKey);
        if (hit) return hit;
      }
    }

    // TODO: O(N*M) — iterates all entries in all files. Only fires when locIndex misses
    // (e.g. column mismatch from unusual React/bundler versions). Consider a line-only index
    // if this becomes a hot path.
    for (const state of this.files.values()) {
      for (const entry of state.entries) {
        if (entry.loc.fileName === normalized && entry.loc.line === source.line) {
          return entry;
        }
      }
    }

    // Suffix-match: handles the React 19 case where fiber source is relative
    // (`src/App.tsx`) but entries are still stored under absolute paths.
    if (!normalized.startsWith('/') && !normalized.match(/^[A-Za-z]:\//)) {
      const suffix = `/${normalized}`;
      for (const state of this.files.values()) {
        for (const entry of state.entries) {
          if (
            entry.loc.fileName.endsWith(suffix) &&
            entry.loc.line === source.line &&
            entry.loc.column === source.column
          ) {
            return entry;
          }
        }
      }
      for (const state of this.files.values()) {
        for (const entry of state.entries) {
          if (entry.loc.fileName.endsWith(suffix) && entry.loc.line === source.line) {
            return entry;
          }
        }
      }
    }

    return null;
  }

  /** Resolve a nodeRef to its NodeMapEntry across all tracked files. */
  resolveNodeRef(nodeRef: NodeRef): NodeMapEntry | null {
    for (const state of this.files.values()) {
      const entry = state.refIndex.get(nodeRef);
      if (entry) return entry;
    }
    return null;
  }

  /**
   * Build a NodeMapUpdate message for broadcasting to connected clients.
   * Returns null if the file is not tracked.
   */
  buildUpdateMessage(filePath: string): NodeMapUpdate | null {
    const key = this.toStorageKey(filePath);
    const state = this.files.get(key);
    if (!state) return null;
    return {
      type: 'node-map-update',
      filePath: key,
      fileHash: state.hash,
      version: state.version,
      nodes: state.entries,
    };
  }

  private safeParse(sourceCode: string, filePath: string): ParseResult<t.File> | null {
    try {
      return parse(sourceCode, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });
    } catch (error) {
      console.warn(`[NodeMapService] Failed to parse ${filePath}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Normalize `filePath` to its canonical storage key. When projectRoot is not
   * set this returns `filePath` unchanged — preserving legacy behaviour so
   * existing callers see no surprise migrations until they opt in.
   */
  private toStorageKey(filePath: string): string {
    if (this.projectRoot === undefined) return filePath;
    return toProjectRelative(filePath, this.projectRoot);
  }
}

function makeLocKey(fileName: string, line: number, column: number): string {
  return `${fileName}:${line}:${column}`;
}

function buildLocIndex(entries: NodeMapEntry[]): Map<string, NodeMapEntry> {
  const index = new Map<string, NodeMapEntry>();
  for (const entry of entries) {
    const key = makeLocKey(entry.loc.fileName, entry.loc.line, entry.loc.column);
    // First entry at a location wins (outer element for nested same-location cases)
    if (!index.has(key)) {
      index.set(key, entry);
    }
  }
  return index;
}

function buildRefIndex(entries: NodeMapEntry[]): Map<NodeRef, NodeMapEntry> {
  const index = new Map<NodeRef, NodeMapEntry>();
  for (const entry of entries) {
    index.set(entry.nodeRef, entry);
  }
  return index;
}
