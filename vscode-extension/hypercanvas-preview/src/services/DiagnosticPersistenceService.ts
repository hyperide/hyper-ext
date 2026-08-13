/**
 * Persists diagnostic logs to a JSON file in globalStorage.
 *
 * Pattern follows ChatHistoryService: simple file-based persistence
 * with debounced writes to avoid thrashing on every log line.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DiagnosticLogEntry } from '../../../../shared/diagnostic-types';
import { DIAGNOSTIC_LOG_LIMIT } from '../../../../shared/diagnostic-types';

export class DiagnosticPersistenceService {
  private readonly _filePath: string;
  private _saveTimer: ReturnType<typeof setTimeout> | undefined;
  // FIFO write chain: an already-fired debounced write can still be mid-flight (its
  // mkdir/writeFile awaits pending) when a newer saveNow lands — unserialized, the stale
  // write could commit LAST and resurrect retracted state on disk (HYP-943 review finding).
  private _writeChain: Promise<void> = Promise.resolve();

  constructor(globalStoragePath: string) {
    this._filePath = path.join(globalStoragePath, 'diagnostic-logs.json');
  }

  async load(): Promise<DiagnosticLogEntry[]> {
    try {
      const raw = await fs.readFile(this._filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-DIAGNOSTIC_LOG_LIMIT) as DiagnosticLogEntry[];
    } catch {
      return [];
    }
  }

  save(logs: DiagnosticLogEntry[]): void {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._enqueueWrite(logs);
    }, 2000);
  }

  /**
   * Write immediately, superseding any pending debounced save. Used for retractions
   * (HYP-943): a debounced write dropped by dispose() would resurrect a retracted
   * entry from disk on the next session, so retracted state must hit disk now.
   * Returns the chained write promise so tests can await durability.
   */
  saveNow(logs: DiagnosticLogEntry[]): Promise<void> {
    clearTimeout(this._saveTimer);
    return this._enqueueWrite(logs);
  }

  /** Serialize writes so an older in-flight write can never commit after a newer one. */
  private _enqueueWrite(logs: DiagnosticLogEntry[]): Promise<void> {
    // Absorb any prior rejection before chaining: a single rejected link would otherwise
    // poison the chain permanently, silently dropping every future write and clear. _write
    // swallows its own IO errors today, so this is defensive against future callers.
    this._writeChain = this._writeChain.catch(() => {}).then(() => this._write(logs));
    return this._writeChain;
  }

  async clear(): Promise<void> {
    clearTimeout(this._saveTimer);
    // Chained like the writes: an already-in-flight write committing AFTER the unlink
    // would resurrect cleared logs on disk. Absorb a prior rejection so the chain can
    // never be poisoned into skipping the unlink.
    this._writeChain = this._writeChain
      .catch(() => {})
      .then(async () => {
        try {
          await fs.unlink(this._filePath);
        } catch {
          // file may not exist
        }
      });
    return this._writeChain;
  }

  dispose(): void {
    clearTimeout(this._saveTimer);
  }

  private async _write(logs: DiagnosticLogEntry[]): Promise<void> {
    try {
      const dir = path.dirname(this._filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this._filePath, JSON.stringify(logs.slice(-DIAGNOSTIC_LOG_LIMIT)), 'utf-8');
    } catch (err) {
      console.error('[DiagnosticPersistence] Failed to save:', err);
    }
  }
}
