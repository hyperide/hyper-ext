import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { GlobalWindow } from 'happy-dom';
import { TID } from '../../../data-testid-map';
import { ComponentErrorOverlay } from '../ComponentErrorOverlay';

// Same DOM-isolation guard as overlays.test.tsx — other suites repoint globalThis.document.
beforeEach(() => {
  const win = new GlobalWindow({ url: 'http://localhost' });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLDivElement: win.HTMLDivElement,
    HTMLInputElement: win.HTMLInputElement,
    Element: win.Element,
    Node: win.Node,
    Text: win.Text,
    DocumentFragment: win.DocumentFragment,
    Event: win.Event,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
  });
});

describe('ComponentErrorOverlay', () => {
  const baseProps = {
    componentPath: 'src/components/Tweet.tsx',
    errorSeq: 1,
    error: "Cannot read properties of undefined (reading 'author')",
    onCreateSample: () => {},
    onConfigureAIKey: () => {},
    onClose: () => {},
  };

  it('renders the component name (basename, no extension) and the testid', () => {
    const { getByTestId, getByText } = render(<ComponentErrorOverlay {...baseProps} />);
    expect(getByTestId(TID.preview.componentErrorOverlay)).toBeTruthy();
    expect(getByText('Tweet')).toBeTruthy();
  });

  it('shows the attention list when unsatisfiedProps overlap the schema', () => {
    const { getByTestId } = render(
      <ComponentErrorOverlay
        {...baseProps}
        propsSchema={[{ name: 'author', type: 'string', required: true }]}
        unsatisfiedProps={['author']}
      />,
    );
    expect(getByTestId(TID.preview.componentErrorAttentionProps)).toBeTruthy();
  });

  it('invokes onConfigureAIKey when the Configure AI Key button is clicked', () => {
    const onConfigureAIKey = mock(() => {});
    const { getByTestId } = render(<ComponentErrorOverlay {...baseProps} onConfigureAIKey={onConfigureAIKey} />);
    fireEvent.click(getByTestId(TID.preview.componentErrorConfigureAI));
    expect(onConfigureAIKey).toHaveBeenCalledTimes(1);
  });

  it('invokes onCreateSample with SampleDefault when the create button is clicked', () => {
    const onCreateSample = mock((_name: string, _values?: Record<string, unknown>) => {});
    const { getByTestId } = render(<ComponentErrorOverlay {...baseProps} onCreateSample={onCreateSample} />);
    fireEvent.click(getByTestId(TID.preview.componentErrorCreateSample));
    expect(onCreateSample).toHaveBeenCalledTimes(1);
    expect(onCreateSample.mock.calls[0][0]).toBe('SampleDefault');
  });
});
