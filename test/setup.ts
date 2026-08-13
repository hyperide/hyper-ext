/**
 * Global test setup for browser API mocks
 * This file is preloaded before all tests run
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem(key: string): string | null {
      return store[key] || null;
    },
    setItem(key: string, value: string): void {
      store[key] = value.toString();
    },
    removeItem(key: string): void {
      delete store[key];
    },
    clear(): void {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key(index: number): string | null {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
})();

// Assign to globalThis so it's available in all test environments
globalThis.localStorage = localStorageMock as Storage;

// Clear localStorage before each test to ensure test isolation
if (typeof beforeEach === 'function') {
  beforeEach(() => {
    localStorage.clear();
  });
}
