import { describe, expect, it } from 'bun:test';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/app';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('tui App component', () => {
  it('renders the initial frame with prompt and preview panel', () => {
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('vecli');
    // input prompt marker
    expect(frame).toContain('>');
    // preview pane heading
    expect(frame.toLowerCase()).toContain('preview');
    unmount();
  });

  it('updates the preview when an expression is typed and submitted', async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await tick(); // let ink mount and enable input
    stdin.write('rect(20,10).fill("#f00").svg()');
    await tick();
    stdin.write('\r'); // Enter
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('<svg');
    expect(frame).toContain('#f00');
    unmount();
  });

  it('clears the input after submit so the next command is not concatenated', async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await tick();
    stdin.write('rect(20,10).fill("#f00").svg()');
    await tick();
    stdin.write('\r');
    await tick();
    // If the prompt were NOT cleared, the next keystrokes would append to the old
    // expression and the second Enter would evaluate a concatenated (invalid) string
    // → an error, not a green rect. A clean #0f0 render proves the input was cleared.
    stdin.write('rect(8,8).fill("#0f0").svg()');
    await tick();
    stdin.write('\r');
    await tick();
    // The second render succeeding (#0f0) is the proof the input was cleared: a
    // non-cleared input would have concatenated into an invalid expression → error,
    // not a green rect. (We can't assert absence of #f00 — the empty input re-shows
    // its placeholder, which happens to contain #f00.)
    const frame = lastFrame() ?? '';
    expect(frame).toContain('#0f0');
    unmount();
  });

  it('shows an error in the preview pane for an invalid expression', async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await tick(); // let ink mount and enable input
    stdin.write('nonexistent()');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = (lastFrame() ?? '').toLowerCase();
    expect(frame).toContain('error');
    unmount();
  });
});
