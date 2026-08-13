import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { GlobalWindow } from 'happy-dom';
import { renderToString } from 'react-dom/server';
import { TID } from '../../../data-testid-map';
import { ConnectionErrorOverlay } from '../ConnectionErrorOverlay';
import { LoadingOverlay } from '../LoadingOverlay';
import { NoComponentOverlay } from '../NoComponentOverlay';
import { OverlayShell } from '../OverlayShell';
import { ParseErrorOverlay } from '../ParseErrorOverlay';
import { PreviewSetupOverlay } from '../PreviewSetupOverlay';
import { RuntimeErrorOverlay } from '../RuntimeErrorOverlay';

function frameworkRowOpeningTag(html: string, name: string): string {
  const testId = TID.preview.unsupportedFrameworkRow(name);
  const testIdIndex = html.indexOf(`data-testid="${testId}"`);
  expect(testIdIndex).toBeGreaterThanOrEqual(0);
  const tagStart = html.lastIndexOf('<div', testIdIndex);
  const tagEnd = html.indexOf('>', testIdIndex);
  return html.slice(tagStart, tagEnd + 1);
}

// Isolation: other test files (e.g. fiber-element-query.test.ts) create a bare
// `new Window()` and re-point `globalThis.document` at it, which breaks @testing-library
// queries (the selector parser calls `this.window.SyntaxError` which ends up undefined).
// Reset the global DOM back to a `GlobalWindow` before every interactive test.
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

describe('OverlayShell', () => {
  it('renders children with backdrop variant', () => {
    const html = renderToString(
      <OverlayShell variant="backdrop" testId="test-overlay">
        <span>content</span>
      </OverlayShell>,
    );
    expect(html).toContain('content');
    expect(html).toContain('data-testid="test-overlay"');
    expect(html).toContain('var(--overlay-backdrop)');
  });

  it('renders with solid variant by default', () => {
    const html = renderToString(
      <OverlayShell>
        <span>solid</span>
      </OverlayShell>,
    );
    expect(html).toContain('solid');
    // Solid variant uses var(--overlay-bg) as background
    expect(html).toContain('var(--overlay-bg)');
  });

  it('applies role="alert" when specified', () => {
    const html = renderToString(
      <OverlayShell role="alert">
        <span>error</span>
      </OverlayShell>,
    );
    expect(html).toContain('role="alert"');
  });

  it('applies aria-live when specified', () => {
    const html = renderToString(
      <OverlayShell ariaLive="polite">
        <span>status</span>
      </OverlayShell>,
    );
    expect(html).toContain('aria-live="polite"');
  });
});

describe('NoComponentOverlay', () => {
  it('renders no-selection variant', () => {
    const html = renderToString(<NoComponentOverlay variant="no-selection" />);
    expect(html).toContain('No component selected');
    expect(html).toContain('Open a .tsx or .jsx file');
  });

  it('renders no-components variant', () => {
    const html = renderToString(<NoComponentOverlay variant="no-components" />);
    expect(html).toContain('No components found');
    expect(html).toContain('Add .tsx components');
  });
});

describe('LoadingOverlay', () => {
  it('renders default message', () => {
    const html = renderToString(<LoadingOverlay />);
    expect(html).toContain('Loading component');
  });

  it('renders custom message', () => {
    const html = renderToString(<LoadingOverlay message="Starting preview..." />);
    expect(html).toContain('Starting preview...');
  });
});

describe('ConnectionErrorOverlay', () => {
  it('renders error message', () => {
    const html = renderToString(<ConnectionErrorOverlay message="502 Bad Gateway" />);
    expect(html).toContain('502 Bad Gateway');
    expect(html).toContain('role="alert"');
  });

  it('renders retry count', () => {
    const html = renderToString(<ConnectionErrorOverlay message="Timeout" retryCount={3} maxRetries={10} />);
    expect(html).toContain('3');
    expect(html).toContain('10');
  });

  it('hides retry count when zero', () => {
    const html = renderToString(<ConnectionErrorOverlay message="Error" retryCount={0} />);
    expect(html).not.toContain('Connection attempts');
  });

  it('renders no action button by default', () => {
    const { container } = render(<ConnectionErrorOverlay message="Error" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders the action button with label and testid', () => {
    const html = renderToString(
      <ConnectionErrorOverlay
        message="Dev server disconnected"
        action={{ label: 'Start Dev Server', onClick: () => {}, testId: 'start-server-btn' }}
      />,
    );
    expect(html).toContain('Start Dev Server');
    expect(html).toContain('data-testid="start-server-btn"');
  });

  it('action button click invokes onClick', () => {
    const onClick = mock(() => {});
    const { getByText } = render(
      <ConnectionErrorOverlay message="Dev server disconnected" action={{ label: 'Start Dev Server', onClick }} />,
    );
    fireEvent.click(getByText('Start Dev Server'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies a custom root testId', () => {
    const html = renderToString(<ConnectionErrorOverlay message="Error" testId="hyper-preview-reconnecting" />);
    expect(html).toContain('data-testid="hyper-preview-reconnecting"');
  });

  it('keeps the default root testId when not overridden', () => {
    const html = renderToString(<ConnectionErrorOverlay message="Error" />);
    expect(html).toContain('data-testid="connection-error-overlay"');
  });
});

describe('ParseErrorOverlay', () => {
  it('renders error message', () => {
    const html = renderToString(<ParseErrorOverlay error="Unexpected token at line 5" />);
    expect(html).toContain('Failed to parse component');
    expect(html).toContain('Unexpected token at line 5');
    expect(html).toContain('role="alert"');
  });

  it('renders retry button when callback provided', () => {
    const html = renderToString(<ParseErrorOverlay error="Parse error" onRetry={() => {}} />);
    expect(html).toContain('Retry');
  });

  it('renders auto-fix button when callback provided', () => {
    const html = renderToString(<ParseErrorOverlay error="Parse error" onAutoFix={() => {}} />);
    expect(html).toContain('Auto Fix');
  });

  it('Retry button click invokes onRetry', () => {
    const onRetry = mock(() => {});
    const { getByText } = render(<ParseErrorOverlay error="Parse error" onRetry={onRetry} />);
    fireEvent.click(getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Auto Fix button click invokes onAutoFix with the error message', () => {
    const onAutoFix = mock((_prompt: string) => {});
    const { getByText } = render(<ParseErrorOverlay error="Unexpected token at line 5" onAutoFix={onAutoFix} />);
    fireEvent.click(getByText('Auto Fix'));
    expect(onAutoFix).toHaveBeenCalledTimes(1);
    expect(onAutoFix.mock.calls[0][0]).toContain('Unexpected token at line 5');
  });

  it('Retry button is hidden when onRetry is not provided', () => {
    const { queryByText } = render(<ParseErrorOverlay error="err" />);
    expect(queryByText('Retry')).toBeNull();
  });
});

describe('PreviewSetupOverlay', () => {
  it('renders needs-patch variant', () => {
    const html = renderToString(<PreviewSetupOverlay status="needs-patch" />);
    expect(html).toContain('Router setup required');
  });

  it('renders unsupported variant with framework table', () => {
    const html = renderToString(
      <PreviewSetupOverlay
        status="unsupported"
        frameworkSupport={[
          { name: 'Next.js', level: 'supported' },
          { name: 'Remix', level: 'planned' },
        ]}
      />,
    );
    expect(html).toContain('Framework not supported');
    expect(html).toContain('Next.js');
    expect(html).toContain('Supported');
    expect(html).toContain('Planned');
  });

  it('renders dismiss button when onDismiss provided', () => {
    const html = renderToString(<PreviewSetupOverlay status="unsupported" onDismiss={() => {}} />);
    expect(html).toContain('Dismiss');
  });

  it('renders auto-fix button in the needs-patch variant when onAutoFix provided', () => {
    const html = renderToString(<PreviewSetupOverlay status="needs-patch" onAutoFix={() => {}} />);
    expect(html).toContain('Auto Fix');
    expect(html).toContain(`data-testid="${TID.preview.supportAutoFixButton}"`);
  });

  it('Dismiss button click invokes onDismiss', () => {
    const onDismiss = mock(() => {});
    const { getByText } = render(<PreviewSetupOverlay status="unsupported" onDismiss={onDismiss} />);
    fireEvent.click(getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Auto Fix click in needs-patch variant invokes onAutoFix with FALLBACK_PROMPT', () => {
    const onAutoFix = mock((_prompt: string) => {});
    const { getByText } = render(<PreviewSetupOverlay status="needs-patch" onAutoFix={onAutoFix} />);
    fireEvent.click(getByText('Auto Fix'));
    expect(onAutoFix).toHaveBeenCalledTimes(1);
    expect(onAutoFix.mock.calls[0][0]).toContain('/test-preview');
  });

  it('Fix Setup button click invokes onManualFix', () => {
    const onManualFix = mock(() => {});
    const { getByText } = render(<PreviewSetupOverlay status="unsupported" onManualFix={onManualFix} />);
    fireEvent.click(getByText('Fix Setup'));
    expect(onManualFix).toHaveBeenCalledTimes(1);
  });

  it('does not render an Auto Fix button in the unsupported variant even when onAutoFix is provided', () => {
    const html = renderToString(<PreviewSetupOverlay status="unsupported" onAutoFix={() => {}} />);
    expect(html).not.toContain('Auto Fix');
    expect(html).not.toContain(`data-testid="${TID.preview.supportAutoFixButton}"`);
  });

  it('does not render any action button when no callbacks provided', () => {
    const { queryByText } = render(<PreviewSetupOverlay status="unsupported" />);
    expect(queryByText('Dismiss')).toBeNull();
    expect(queryByText('Fix Setup')).toBeNull();
    expect(queryByText('Auto Fix')).toBeNull();
  });

  it('renders a custom description in the unsupported variant', () => {
    const html = renderToString(
      <PreviewSetupOverlay status="unsupported" description="No supported bundler found in package.json." />,
    );
    expect(html).toContain('No supported bundler found in package.json.');
    expect(html).not.toContain('HyperIDE could not detect a supported framework');
  });

  it('renders a custom description in the needs-patch variant', () => {
    const html = renderToString(<PreviewSetupOverlay status="needs-patch" description="Custom router explanation." />);
    expect(html).toContain('Custom router explanation.');
    expect(html).not.toContain('HyperIDE could not find a React Router configuration file');
  });

  it('applies a custom root testId', () => {
    const html = renderToString(
      <PreviewSetupOverlay status="unsupported" testId="hyper-preview-unsupported-framework" />,
    );
    expect(html).toContain('data-testid="hyper-preview-unsupported-framework"');
  });

  it('keeps the default root testId when not overridden', () => {
    const html = renderToString(<PreviewSetupOverlay status="unsupported" />);
    expect(html).toContain('data-testid="preview-setup-overlay"');
  });

  it('emits per-framework row testids from the shared testid map', () => {
    const html = renderToString(
      <PreviewSetupOverlay
        status="unsupported"
        frameworkSupport={[
          { name: 'Next.js', level: 'supported' },
          { name: 'Remix', level: 'planned' },
        ]}
      />,
    );
    expect(html).toContain(`data-testid="${TID.preview.unsupportedFrameworkRow('Next.js')}"`);
    expect(html).toContain(`data-testid="${TID.preview.unsupportedFrameworkRow('Remix')}"`);
  });

  it('marks only the detected framework row as current', () => {
    const html = renderToString(
      <PreviewSetupOverlay
        status="unsupported"
        detectedFrameworkName="Vue"
        frameworkSupport={[
          { name: 'Vue', level: 'planned' },
          { name: 'Angular', level: 'not-planned' },
        ]}
      />,
    );

    expect(frameworkRowOpeningTag(html, 'Vue')).toContain('aria-current="true"');
    expect(frameworkRowOpeningTag(html, 'Angular')).not.toContain('aria-current');
  });
});

describe('RuntimeErrorOverlay', () => {
  it('renders runtime error with framework badge', () => {
    const html = renderToString(
      <RuntimeErrorOverlay
        error={{
          framework: 'vite',
          type: 'Build Error',
          message: 'Module not found',
          fullText: 'Module not found: ./missing.ts',
        }}
      />,
    );
    expect(html).toContain('vite');
    expect(html).toContain('Build Error');
    expect(html).toContain('Module not found');
    expect(html).toContain('role="alert"');
  });

  it('renders file and line info', () => {
    const html = renderToString(
      <RuntimeErrorOverlay
        error={{
          framework: 'nextjs',
          type: 'SyntaxError',
          message: 'Unexpected token',
          file: './src/App.tsx',
          line: 42,
          fullText: 'Unexpected token at line 42',
        }}
      />,
    );
    expect(html).toContain('./src/App.tsx');
    expect(html).toContain('42');
  });

  it('renders codeframe when provided', () => {
    const html = renderToString(
      <RuntimeErrorOverlay
        error={{
          framework: 'vite',
          type: 'Error',
          message: 'err',
          codeframe: 'const x = ;',
          fullText: 'const x = ;',
        }}
      />,
    );
    expect(html).toContain('const x = ;');
  });

  it('Dismiss button click invokes onDismiss', () => {
    const onDismiss = mock(() => {});
    const { getByText } = render(
      <RuntimeErrorOverlay
        error={{ framework: 'vite', type: 'Build Error', message: 'err', fullText: 'err' }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Auto Fix click invokes onAutoFix with the full error text', () => {
    const onAutoFix = mock((_prompt: string) => {});
    const { getByText } = render(
      <RuntimeErrorOverlay
        error={{ framework: 'vite', type: 'Build Error', message: 'short', fullText: 'full error text' }}
        onAutoFix={onAutoFix}
      />,
    );
    fireEvent.click(getByText('Auto Fix'));
    expect(onAutoFix).toHaveBeenCalledTimes(1);
    expect(onAutoFix.mock.calls[0][0]).toContain('full error text');
  });
});
