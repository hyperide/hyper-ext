/**
 * @file TUI launcher — renders the ink App into the terminal
 *
 * Accessed via: bin/vecli.ts (dynamic import in the no-args TTY branch).
 *
 * Assumptions: only ever called in a real TTY. Kept as a thin launcher so the
 * App component stays testable in isolation via ink-testing-library, and so ink
 * /react are never imported on the batch-mode hot path.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { App, type AppProps } from './app';

export async function startTui(props: AppProps = {}): Promise<void> {
  const { waitUntilExit } = render(createElement(App, props));
  await waitUntilExit();
}
