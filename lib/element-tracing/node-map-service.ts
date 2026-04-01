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
  private readonly files = new Map<string, FileState>();
  private containerPrefix = '';
  private hostPrefix = '';

  /**
   * Configure Docker/container path normalization.
   * Incoming source locations that start with `containerPrefix` will have
   * that prefix replaced with `hostPrefix` before lookup.
   */
  setPathMapping(containerPrefix: string, hostPrefix: string): void {
    this.containerPrefix = containerPrefix;
    this.hostPrefix = hostPrefix;
    // Rebuild locIndex for all files with new path mapping
    for (const [, state] of this.files) {
      state.locIndex = buildLocIndex(state.entries, containerPrefix, hostPrefix);
    }
  }

  /** Parse `sourceCode` for `filePath`, build entries, and store them. Returns the entry list. */
  parseAndBuild(sourceCode: string, filePath: string): NodeMapEntry[] {
    const ast = this.safeParse(sourceCode, filePath);
    if (ast === null) return [];

    const entries = buildNodeMap(ast, filePath);
    const hash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const locIndex = buildLocIndex(entries, this.containerPrefix, this.hostPrefix);
    const refIndex = buildRefIndex(entries);

    this.files.set(filePath, { entries, version: 1, hash, locIndex, refIndex });
    return entries;
  }

  /**
   * Re-parse `sourceCode` for an already-tracked `filePath`.
   * Computes ref stability mapping from the old entries to the new ones.
   * Returns a `NodeMapUpdate` with the new entries, incremented version, and refMapping.
   */
  reparseAndUpdate(sourceCode: string, filePath: string): NodeMapUpdate {
    const existing = this.files.get(filePath);
    const oldEntries = existing?.entries ?? [];
    const oldVersion = existing?.version ?? 0;

    const ast = this.safeParse(sourceCode, filePath);
    if (ast === null) {
      return {
        type: 'node-map-update',
        filePath,
        fileHash: existing?.hash ?? '',
        version: oldVersion,
        nodes: oldEntries,
      };
    }

    const newEntries = buildNodeMap(ast, filePath);
    const hash = createHash('sha256').update(sourceCode).digest('hex').slice(0, 16);
    const newVersion = oldVersion + 1;
    const locIndex = buildLocIndex(newEntries, this.containerPrefix, this.hostPrefix);
    const refIndex = buildRefIndex(newEntries);

    this.files.set(filePath, {
      entries: newEntries,
      version: newVersion,
      hash,
      locIndex,
      refIndex,
    });

    const refMapping = mapNodeRefs(oldEntries, newEntries);

    return {
      type: 'node-map-update',
      filePath,
      fileHash: hash,
      version: newVersion,
      nodes: newEntries,
      refMapping,
    };
  }

  /** Returns current entries for a file, or null if not tracked. */
  getNodeMap(filePath: string): NodeMapEntry[] | null {
    return this.files.get(filePath)?.entries ?? null;
  }

  /** Returns the 16-char SHA-256 hash of the last parsed content, or null. */
  getFileHash(filePath: string): string | null {
    return this.files.get(filePath)?.hash ?? null;
  }

  /** Returns all currently tracked file paths. */
  getTrackedFiles(): string[] {
    return [...this.files.keys()];
  }

  /** Remove a file from tracking (e.g. on file deletion). */
  removeFile(filePath: string): void {
    this.files.delete(filePath);
  }

  /**
   * Resolve a source location (from a React fiber's _debugSource) to its NodeMapEntry.
   * Normalizes the fileName via the configured path mapping, then tries an exact locKey
   * match across all files, falling back to column=0 tolerance.
   */
  resolveSourceLocation(source: SourceLocation): NodeMapEntry | null {
    const normalized = this.normalizeFileName(source.fileName);
    const locKey = makeLocKey(normalized, source.line, source.column);

    // Try exact match first — iterate all files since normalized name may not match filePath key
    for (const state of this.files.values()) {
      const exact = state.locIndex.get(locKey);
      if (exact) return exact;
    }

    // Fallback: column=0 tolerance (some React versions report column as 0)
    if (source.column !== 0) {
      const fallbackKey = makeLocKey(normalized, source.line, 0);
      for (const state of this.files.values()) {
        const fallback = state.locIndex.get(fallbackKey);
        if (fallback) return fallback;
      }
    }

    // TODO: O(N*M) — iterates all entries in all files. Only fires when locIndex misses
    // (e.g. column mismatch from unusual React/bundler versions). Consider a line-only index
    // if this becomes a hot path.
    for (const state of this.files.values()) {
      for (const entry of state.entries) {
        if (
          normalizeFileName(entry.loc.fileName, this.containerPrefix, this.hostPrefix) === normalized &&
          entry.loc.line === source.line
        ) {
          return entry;
        }
      }
    }

    // Suffix-match fallback for React 19: parseDebugStack returns relative paths like 'src/App.tsx'
    // while NodeMapService stores absolute paths like '/workspace/project/src/App.tsx'.
    // Two-pass: first exact line+column, then line-only (handles column=0 tolerance).
    if (!normalized.startsWith('/') && !normalized.match(/^[A-Za-z]:\\/)) {
      const suffix = `/${normalized}`;
      for (const state of this.files.values()) {
        for (const entry of state.entries) {
          const normalizedEntry = normalizeFileName(entry.loc.fileName, this.containerPrefix, this.hostPrefix);
          if (
            normalizedEntry.endsWith(suffix) &&
            entry.loc.line === source.line &&
            entry.loc.column === source.column
          ) {
            return entry;
          }
        }
      }
      // Line-only fallback for column=0 tolerance or bundler-variant column values
      for (const state of this.files.values()) {
        for (const entry of state.entries) {
          const normalizedEntry = normalizeFileName(entry.loc.fileName, this.containerPrefix, this.hostPrefix);
          if (normalizedEntry.endsWith(suffix) && entry.loc.line === source.line) {
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
    const state = this.files.get(filePath);
    if (!state) return null;
    return {
      type: 'node-map-update',
      filePath,
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

  private normalizeFileName(fileName: string): string {
    return normalizeFileName(fileName, this.containerPrefix, this.hostPrefix);
  }
}

function normalizeFileName(fileName: string, containerPrefix: string, hostPrefix: string): string {
  if (containerPrefix && fileName.startsWith(containerPrefix)) {
    return hostPrefix + fileName.slice(containerPrefix.length);
  }
  return fileName;
}

function makeLocKey(fileName: string, line: number, column: number): string {
  return `${fileName}:${line}:${column}`;
}

function buildLocIndex(
  entries: NodeMapEntry[],
  containerPrefix: string,
  hostPrefix: string,
): Map<string, NodeMapEntry> {
  const index = new Map<string, NodeMapEntry>();
  for (const entry of entries) {
    const normalized = normalizeFileName(entry.loc.fileName, containerPrefix, hostPrefix);
    const key = makeLocKey(normalized, entry.loc.line, entry.loc.column);
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
