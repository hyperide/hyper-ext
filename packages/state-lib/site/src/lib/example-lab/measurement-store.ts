import { measurementIdentity } from '../../../server/measurement-identity.mjs';
import { sha256 } from './core';
import type { BenchmarkResult } from './types';
export async function measurementKey(result: BenchmarkResult): Promise<string> {
  return sha256(measurementIdentity(result));
}
export async function saveLocalMeasurement(result: BenchmarkResult): Promise<{ stored: boolean; duplicate: boolean }> {
  const id = await measurementKey(result);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('state-example-measurements', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('runs', { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction('runs', 'readwrite'),
        store = tx.objectStore('runs'),
        lookup = store.get(id);
      let duplicate = false;
      lookup.onsuccess = () => {
        const old = lookup.result;
        duplicate = Boolean(old);
        store.put({ id, result, observations: (old?.observations ?? 0) + 1, lastSeen: new Date().toISOString() });
      };
      tx.oncomplete = () => {
        db.close();
        resolve({ stored: !duplicate, duplicate });
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
