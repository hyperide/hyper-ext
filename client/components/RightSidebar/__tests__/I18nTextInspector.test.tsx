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
        localeEditable
      />,
    );
    const ruButton = screen.getByText('ru');
    expect(ruButton).toBeTruthy();
    fireEvent.click(ruButton);
    expect(onLocaleChange).toHaveBeenCalledWith('ru');
  });

  it('disables locale buttons when localeEditable is false (default)', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    const ruButton = screen.getByText('ru') as HTMLButtonElement;
    expect(ruButton.disabled).toBe(true);
  });

  it('fires onKeyChange when the key input is committed (Enter / blur)', () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
        keyEditable
      />,
    );
    const input = screen.getByDisplayValue('habits.walks') as HTMLInputElement;
    // Per-keystroke change MUST NOT trigger onKeyChange — that previously caused
    // the inspector to apply a partial key before the user finished typing.
    fireEvent.change(input, { target: { value: 'habits.runs' } });
    expect(onKeyChange).not.toHaveBeenCalled();
    // Commit on blur is the canonical apply path.
    fireEvent.blur(input);
    expect(onKeyChange).toHaveBeenCalledWith('habits.runs');
  });

  it('disables key input when keyEditable is false (default)', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        onLocaleChange={mock(() => {})}
      />,
    );
    const keyInput = screen.getByDisplayValue('habits.walks') as HTMLInputElement;
    expect(keyInput.disabled).toBe(true);
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

  // Combobox key picker tests (only active when availableKeys + keyEditable are both provided)
  it('renders a button trigger instead of an input when availableKeys and keyEditable are provided', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={['habits.walks', 'habits.runs', 'home.title']}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    const trigger = screen.getByTestId('i18n-key-input');
    expect(trigger.tagName.toLowerCase()).toBe('button');
    expect(trigger.textContent).toBe('habits.walks');
  });

  it('opens the combobox popover on trigger click', async () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={['habits.walks', 'habits.runs', 'home.title']}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    const trigger = screen.getByTestId('i18n-key-input');
    fireEvent.click(trigger);
    // After opening, all matching keys should be visible in the list
    expect(screen.getByText('habits.runs')).toBeTruthy();
    expect(screen.getByText('home.title')).toBeTruthy();
  });

  it('fires onKeyChange with the selected key when an existing key is clicked', async () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={['habits.walks', 'habits.runs', 'home.title']}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    fireEvent.click(screen.getByText('habits.runs'));
    expect(onKeyChange).toHaveBeenCalledWith('habits.runs');
  });

  it('shows "Create key" affordance when typed text does not match any key', async () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={['habits.walks', 'habits.runs']}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    // Type a key that doesn't exist
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'brand.new.key' } });
    expect(screen.getByText((t) => t.includes('Create key'))).toBeTruthy();
    expect(screen.getByText((t) => t.includes('brand.new.key'))).toBeTruthy();
  });

  it('fires onKeyChange with typed value when "Create key" is clicked', async () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={['habits.walks']}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'onboarding.step1' } });
    const createBtn = screen.getByText((t) => t.includes('Create key'));
    fireEvent.click(createBtn);
    expect(onKeyChange).toHaveBeenCalledWith('onboarding.step1');
  });

  it('falls back to plain input when keyEditable is true but no availableKeys provided', () => {
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={mock(() => {})}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    const keyInput = screen.getByTestId('i18n-key-input');
    expect(keyInput.tagName.toLowerCase()).toBe('input');
  });

  // Snap-back resilience after blur. The original isFocusedRef guard prevented
  // snap-back only while focus was held; if the user typed and then clicked
  // away before the server returned the new resolvedText, the input snapped
  // back to the OLD resolvedText (because the focus guard had already lifted).
  // Fix tracks expected text so the rollback effect skips stale-server props
  // until the round-trip is acknowledged.
  describe('text input survives blur with stale server prop', () => {
    it('keeps user-typed text after blur even if resolvedText prop is still the old value', () => {
      const { rerender } = render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      const textInput = screen.getByDisplayValue('Go for a walk') as HTMLInputElement;
      // User focuses, types, then blurs (e.g. clicks away before debounce flushes)
      fireEvent.focus(textInput);
      fireEvent.change(textInput, { target: { value: 'Updated text' } });
      fireEvent.blur(textInput);
      // Server has not yet returned the new resolvedText — re-render with the
      // SAME stale prop. Without the fix, the rollback effect snaps localText
      // back to 'Go for a walk' because focus is gone.
      rerender(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      expect(textInput.value).toBe('Updated text');
    });

    it('still applies external server updates after the round-trip catches up', () => {
      const { rerender } = render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      const textInput = screen.getByDisplayValue('Go for a walk') as HTMLInputElement;
      fireEvent.focus(textInput);
      fireEvent.change(textInput, { target: { value: 'Updated text' } });
      fireEvent.blur(textInput);
      // Server eventually echoes our update — input must reflect that value.
      rerender(
        <I18nTextInspector
          i18nBinding={{ ...supportedBinding, resolvedText: 'Updated text' }}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      expect(textInput.value).toBe('Updated text');
      // Now an external edit (someone else changes the file) — that must propagate.
      rerender(
        <I18nTextInspector
          i18nBinding={{ ...supportedBinding, resolvedText: 'External edit' }}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
        />,
      );
      expect(textInput.value).toBe('External edit');
    });
  });
});
