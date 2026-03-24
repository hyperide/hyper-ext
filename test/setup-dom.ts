/**
 * @file DOM environment setup for tests using renderHook / @testing-library/react
 *
 * Import this at the top of test files that need a DOM environment.
 * Uses happy-dom for lightweight DOM simulation.
 */

import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost' });

// Assign DOM globals needed by React and @testing-library/react
Object.assign(globalThis, {
  document: win.document,
  window: win,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  HTMLDivElement: win.HTMLDivElement,
  HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  Element: win.Element,
  Node: win.Node,
  Text: win.Text,
  DocumentFragment: win.DocumentFragment,
  MutationObserver: win.MutationObserver,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});
