/**
 * @file I18nTextInspector UI tests — VS Code webview variant (Task 9)
 *
 * Accessed via: Right sidebar text section when selected element has i18n expression children
 * Assumptions: i18nBinding forwarded from styles:response via useElementStyleData; same
 *   component is reused in VS Code webview via the shared client bundle
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 *
 * These tests FAIL until Task 10 implements I18nTextInspector in
 * client/components/RightSidebar/sections/I18nTextInspector.tsx.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { I18nTextBinding, I18nUnsupportedBinding } from '@shared/i18n-text/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nTextInspector } from '@/components/RightSidebar/sections/I18nTextInspector';

const supportedBinding: I18nTextBinding = {
  kind: 'i18n',
  library: 'react-i18next',
  key: 'habits.walks',
  activeLocale: 'en',
  availableLocales: ['en', 'ru'],
  resolvedText: 'Go for a walk',
  editable: true,
  writable: true,
  sourceLocation: { filePath: '/src/pages/Index.tsx', line: 5, column: 10 },
};

const unsupportedBinding: I18nUnsupportedBinding = {
  kind: 'unsupported',
  reason: 'dynamic-key',
};

describe('I18nTextInspector (VS Code webview)', () => {
  it('shows the translation key in a combobox when binding is recognized', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    expect(screen.getByDisplayValue('habits.walks')).toBeTruthy();
  });

  it('shows resolved text for the active locale', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    expect(screen.getByDisplayValue('Go for a walk')).toBeTruthy();
  });

  it('shows a language switcher and fires onLocaleChange when switched', () => {
    const onLocaleChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        localeEditable
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={onLocaleChange}
      />,
    );
    const ruButton = screen.getByText('ru');
    expect(ruButton).toBeTruthy();
    fireEvent.click(ruButton);
    expect(onLocaleChange).toHaveBeenCalledWith('ru');
  });

  it('fires onKeyChange when the key input is changed', () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        keyEditable
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    // The key input is uncontrolled (defaultValue) and commits on blur or Enter,
    // not on every keystroke. Mutate the DOM value, then dispatch blur to fire onBlur.
    const input = screen.getByDisplayValue('habits.walks') as HTMLInputElement;
    input.value = 'habits.runs';
    fireEvent.blur(input);
    expect(onKeyChange).toHaveBeenCalledWith('habits.runs');
  });

  it('fires onResolvedTextChange when the text input is changed', () => {
    const onResolvedTextChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={onResolvedTextChange}
        onLocaleChange={mock(() => {})}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('Go for a walk'), { target: { value: 'Take a walk' } });
    expect(onResolvedTextChange).toHaveBeenCalledWith('Take a walk');
  });

  it('renders text input as disabled when editable is false', () => {
    const nonEditableBinding: I18nTextBinding = { ...supportedBinding, resolvedText: null, editable: false };
    render(
      <I18nTextInspector
        i18nBinding={nonEditableBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    const textInput = screen.getByDisplayValue('');
    expect((textInput as HTMLInputElement).disabled).toBe(true);
  });

  // Regression: read-only layouts (canCreateKeys=false) — switch-to-existing
  // must still work (JSX-only rewrite via skipResourceWrite=true), but Create
  // affordance must be hidden so the user cannot push the inspector into a
  // write that the locale-file format would refuse.
  describe('read-only layout existing-key flow', () => {
    it('lets user pick an existing key from the combobox even when canCreateKeys is false', () => {
      const onKeyChange = mock(() => {});
      render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          availableKeys={['habits.walks', 'habits.runs']}
          keyEditable
          canCreateKeys={false}
          onKeyChange={onKeyChange}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      fireEvent.click(screen.getByTestId('i18n-key-input'));
      fireEvent.click(screen.getByText('habits.runs'));
      expect(onKeyChange).toHaveBeenCalledWith('habits.runs');
    });

    it('hides the Create key affordance for an unknown typed key when canCreateKeys is false', () => {
      render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          availableKeys={['habits.walks']}
          keyEditable
          canCreateKeys={false}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      fireEvent.click(screen.getByTestId('i18n-key-input'));
      const searchInput = screen.getByPlaceholderText('Search or create key...');
      fireEvent.change(searchInput, { target: { value: 'brand.new.key' } });
      expect(screen.queryByTestId('i18n-key-create')).toBeNull();
    });
  });

  it('allows creating a key before the available key list has loaded', () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        keyEditable
        canCreateKeys
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
      />,
    );
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'brand.loading.key' } });
    fireEvent.click(screen.getByTestId('i18n-key-create'));
    expect(onKeyChange).toHaveBeenCalledWith('brand.loading.key');
  });

  it('renders raw expression fallback for unsupported bindings and hides i18n controls', () => {
    render(
      <I18nTextInspector
        i18nBinding={unsupportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    expect(screen.queryByDisplayValue('habits.walks')).toBeNull();
    expect(screen.queryByText('en')).toBeNull();
    expect(screen.getByTestId('i18n-unsupported-fallback')).toBeTruthy();
  });
});
