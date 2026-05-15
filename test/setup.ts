/**
 * @file Global test setup — preloaded before all tests via bunfig.toml
 *
 * Provides DOM environment (happy-dom) and browser API mocks so that both
 * unit tests and component tests (@testing-library/react) work without
 * per-file setup imports.
 */

import { GlobalWindow } from 'happy-dom';

// GlobalWindow re-uses native JS constructors (SyntaxError, Error, etc.) so happy-dom's
// internal selector parser can call `new this.window.SyntaxError(...)` without failing.
const win = new GlobalWindow({ url: 'http://localhost' });

Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  // DOM node types
  HTMLElement: win.HTMLElement,
  HTMLDivElement: win.HTMLDivElement,
  HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  SVGElement: win.SVGElement,
  Element: win.Element,
  Node: win.Node,
  Text: win.Text,
  DocumentFragment: win.DocumentFragment,
  // Events
  Event: win.Event,
  CustomEvent: win.CustomEvent,
  MouseEvent: win.MouseEvent,
  KeyboardEvent: win.KeyboardEvent,
  // Observers & utilities
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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

// Clean up @testing-library/react rendered DOM after each test.
// bun:test does not auto-cleanup like Jest does; without this,
// rendered components from one test file leak into subsequent files
// and cause flaky failures (e.g. getAllByTestId matching stale DOM).
let rtlCleanup: (() => void) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  rtlCleanup = require('@testing-library/react').cleanup;
} catch {
  // @testing-library/react not available — skip
}
if (rtlCleanup && typeof afterEach === 'function') {
  const cleanupFn = rtlCleanup;
  afterEach(() => {
    cleanupFn();
  });
}
