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
      this._write(logs);
    }, 2000);
  }

  async clear(): Promise<void> {
    clearTimeout(this._saveTimer);
    try {
      await fs.unlink(this._filePath);
    } catch {
      // file may not exist
    }
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
