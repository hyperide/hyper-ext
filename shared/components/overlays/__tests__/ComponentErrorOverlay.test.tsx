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

  // HYP-876 — runtime-error card: a provider-context crash must NEVER render the
  // props card ("This component requires props to render" / Create Empty Sample).
  describe('runtime-error card (HYP-876)', () => {
    const providerErrorProps = {
      ...baseProps,
      componentPath: 'src/App.tsx',
      error: 'useWorkspace must be used inside <WorkspaceProvider>',
    };

    it('shows the real error message, not the requires-props copy', () => {
      const { getByTestId, queryByText } = render(<ComponentErrorOverlay {...providerErrorProps} />);
      expect(getByTestId(TID.preview.componentErrorRuntimeMessage).textContent).toContain(
        'useWorkspace must be used inside <WorkspaceProvider>',
      );
      expect(queryByText(/requires props to render/)).toBeNull();
      expect(queryByText(/Could not detect required prop names/)).toBeNull();
    });

    it('offers no Create Sample action and is dismissable via the Dismiss button', () => {
      const onClose = mock(() => {});
      const { getByTestId, queryByTestId } = render(
        <ComponentErrorOverlay {...providerErrorProps} onClose={onClose} />,
      );
      expect(queryByTestId(TID.preview.componentErrorCreateSample)).toBeNull();
      fireEvent.click(getByTestId(TID.preview.componentErrorDismiss));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the Configure AI Key action for provider-context errors', () => {
      const onConfigureAIKey = mock(() => {});
      const { getByTestId } = render(
        <ComponentErrorOverlay {...providerErrorProps} onConfigureAIKey={onConfigureAIKey} />,
      );
      fireEvent.click(getByTestId(TID.preview.componentErrorConfigureAI));
      expect(onConfigureAIKey).toHaveBeenCalledTimes(1);
    });

    // tg#5900 — the card states the error plainly; no "not caused by missing
    // props" negation copy.
    it('describes the crash without the "not caused by" negation', () => {
      const { queryByText, getByText } = render(<ComponentErrorOverlay {...providerErrorProps} />);
      expect(getByText('Component crashed at runtime:')).toBeTruthy();
      expect(queryByText(/not caused by/)).toBeNull();
    });

    // HYP-880 — "Generate preview wrapper" scaffolds .hyperide/preview.tsx.
    it('shows Generate preview wrapper for provider errors when the platform wires it', () => {
      const onGeneratePreviewWrapper = mock(() => {});
      const { getByTestId } = render(
        <ComponentErrorOverlay {...providerErrorProps} onGeneratePreviewWrapper={onGeneratePreviewWrapper} />,
      );
      fireEvent.click(getByTestId(TID.preview.componentErrorGenerateWrapper));
      expect(onGeneratePreviewWrapper).toHaveBeenCalledTimes(1);
    });

    it('hides Generate preview wrapper when the callback is not provided (SaaS)', () => {
      const { queryByTestId } = render(<ComponentErrorOverlay {...providerErrorProps} />);
      expect(queryByTestId(TID.preview.componentErrorGenerateWrapper)).toBeNull();
    });

    it('hides Generate preview wrapper for non-provider runtime errors', () => {
      const { queryByTestId } = render(
        <ComponentErrorOverlay
          {...baseProps}
          error="boom from a useEffect"
          propsSchema={[]}
          onGeneratePreviewWrapper={() => {}}
        />,
      );
      expect(queryByTestId(TID.preview.componentErrorGenerateWrapper)).toBeNull();
    });

    it('classifies an empty resolved schema + hint-free error as runtime too', () => {
      const { getByTestId, queryByTestId } = render(
        <ComponentErrorOverlay {...baseProps} error="boom from a useEffect" propsSchema={[]} />,
      );
      expect(getByTestId(TID.preview.componentErrorRuntimeMessage).textContent).toContain('boom from a useEffect');
      // Not a provider error — no AI-wrapper pitch, just an honest dismissable card.
      expect(queryByTestId(TID.preview.componentErrorConfigureAI)).toBeNull();
    });

    it('still renders the props card when the error names props', () => {
      const { getByTestId, queryByTestId } = render(<ComponentErrorOverlay {...baseProps} />);
      expect(getByTestId(TID.preview.componentErrorCreateSample)).toBeTruthy();
      expect(queryByTestId(TID.preview.componentErrorRuntimeMessage)).toBeNull();
    });
  });
});
