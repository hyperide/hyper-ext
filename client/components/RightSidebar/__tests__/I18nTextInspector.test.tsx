/**
 * @file I18nTextInspector UI tests — written before implementation (Task 9)
 *
 * Accessed via: Right sidebar text section when selected element has i18n expression children
 * Assumptions: i18nBinding comes from useElementStyleData (populated via StyleReadService in VS Code)
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 *
 * These tests FAIL until Task 10 implements I18nTextInspector in sections/I18nTextInspector.tsx.
 * Current behavior: the text section only shows raw {} expression editing.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { I18nTextBinding, I18nUnsupportedBinding } from '@shared/i18n-text/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nTextInspector } from '../sections/I18nTextInspector';

const supportedBinding: I18nTextBinding = {
  kind: 'i18n',
  library: 'react-i18next',
  key: 'habits.walks',
  activeLocale: 'en',
  availableLocales: ['en', 'ru'],
  resolvedText: 'Go for a walk',
  editable: true,
  sourceLocation: { filePath: '/src/pages/Index.tsx', line: 5, column: 10 },
};

const unsupportedBinding: I18nUnsupportedBinding = {
  kind: 'unsupported',
  reason: 'dynamic-key',
};

describe('I18nTextInspector', () => {
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
