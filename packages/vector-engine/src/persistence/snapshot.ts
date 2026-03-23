/**
 * @file Snapshot manager — cache execution results for warm start
 *
 * Accessed via: File open — loads cached node results to skip re-execution
 * Tradeoffs: trades disk space for faster graph re-evaluation on file open
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Undo/Redo Persistence
 */

export interface SnapshotStorage {
  save(key: string, data: string): Promise<void>;
  load(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

export interface ExecutionCache {
  nodeResults: Record<string, { hash: string; result: string }>;
}

export class SnapshotManager {
  constructor(private storage: SnapshotStorage) {}

  async save(graphHash: string, cache: ExecutionCache): Promise<void> {
    await this.storage.save(`snap-${graphHash}`, JSON.stringify(cache));
  }

  async loadBest(graphHash: string, nodeHashes: Record<string, string>): Promise<ExecutionCache | null> {
    // Try exact match first
    const exact = await this.storage.load(`snap-${graphHash}`);
    if (exact) return JSON.parse(exact);

    // Nearest snapshot search — find the one with most matching node hashes
    const keys = await this.storage.list('snap-');
    let bestCache: ExecutionCache | null = null;
    let bestHits = 0;

    for (const key of keys) {
      const data = await this.storage.load(key);
      if (!data) continue;
      const cache: ExecutionCache = JSON.parse(data);
      let hits = 0;
      for (const [nodeId, hash] of Object.entries(nodeHashes)) {
        if (cache.nodeResults[nodeId]?.hash === hash) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestCache = cache;
      }
    }

    return bestCache;
  }

  async cleanup(prefix: string, keepCount: number): Promise<void> {
    const keys = await this.storage.list(prefix);
    if (keys.length <= keepCount) return;
    const toRemove = keys.slice(0, keys.length - keepCount);
    for (const key of toRemove) {
      await this.storage.remove(key);
    }
  }
}
