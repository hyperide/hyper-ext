import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { GlobalWindow } from 'happy-dom';
import { TID } from '../../../data-testid-map';
import { NonPreviewableFileOverlay } from '../NonPreviewableFileOverlay';

// Same DOM-isolation guard as the sibling overlay suites — other suites repoint globalThis.document.
beforeEach(() => {
  const win = new GlobalWindow({ url: 'http://localhost' });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLDivElement: win.HTMLDivElement,
    HTMLButtonElement: win.HTMLButtonElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
  });
});

const recommendations = [
  { path: 'src/App.tsx', name: 'App' },
  { path: 'src/components/Feed.tsx', name: 'Feed' },
];

describe('NonPreviewableFileOverlay', () => {
  it('renders the entry-file message, the file name, and recommendation buttons', () => {
    const { getByTestId, getByText } = render(
      <NonPreviewableFileOverlay
        filePath="src/main.tsx"
        reason="entry-file"
        recommendations={recommendations}
        onSelect={() => {}}
      />,
    );
    expect(getByTestId(TID.preview.nonPreviewableRoot)).toBeTruthy();
    expect(getByText('Can’t preview main.tsx')).toBeTruthy();
    expect(getByText('App')).toBeTruthy();
    expect(getByText('Feed')).toBeTruthy();
  });

  it('invokes onSelect with the clicked recommendation', () => {
    const onSelect = mock((_rec: { path: string; name: string }) => {});
    const { getByTestId } = render(
      <NonPreviewableFileOverlay
        filePath="src/main.tsx"
        reason="entry-file"
        recommendations={recommendations}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(getByTestId(TID.preview.nonPreviewableRecommendation('src/App.tsx')));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual({ path: 'src/App.tsx', name: 'App' });
  });

  it('omits the recommendation list when there are none', () => {
    const { queryByText } = render(
      <NonPreviewableFileOverlay
        filePath="src/vite-env.d.ts"
        reason="no-renderable-export"
        recommendations={[]}
        onSelect={() => {}}
      />,
    );
    expect(queryByText('Open a component to preview instead:')).toBeNull();
  });
});
