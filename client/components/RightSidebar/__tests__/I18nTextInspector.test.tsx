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
  writable: true,
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
    expect(screen.getByText('en').getAttribute('aria-pressed')).toBe('true');
    expect(ruButton.getAttribute('aria-pressed')).toBe('false');
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

  describe('interaction flow after local edits', () => {
    it('shows the newly selected locale text after editing the previous locale', () => {
      const { rerender } = render(
        <I18nTextInspector
          i18nBinding={{ ...supportedBinding, activeLocale: 'en', availableLocales: ['en', 'ru', 'rs'] }}
          localeEditable
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          onLocaleChange={mock(() => {})}
        />,
      );

      fireEvent.change(screen.getByTestId('i18n-text-input'), { target: { value: 'Edited English' } });
      expect(screen.getByDisplayValue('Edited English')).toBeTruthy();

      rerender(
        <I18nTextInspector
          i18nBinding={{
            ...supportedBinding,
            activeLocale: 'ru',
            availableLocales: ['en', 'ru', 'rs'],
            resolvedText: 'Русский текст',
          }}
          localeEditable
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          onLocaleChange={mock(() => {})}
        />,
      );
      expect(screen.getByDisplayValue('Русский текст')).toBeTruthy();

      fireEvent.change(screen.getByTestId('i18n-text-input'), { target: { value: 'Отредактированный русский' } });
      expect(screen.getByDisplayValue('Отредактированный русский')).toBeTruthy();

      rerender(
        <I18nTextInspector
          i18nBinding={{
            ...supportedBinding,
            activeLocale: 'rs',
            availableLocales: ['en', 'ru', 'rs'],
            resolvedText: 'Srpski tekst',
          }}
          localeEditable
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          onLocaleChange={mock(() => {})}
        />,
      );
      expect(screen.getByDisplayValue('Srpski tekst')).toBeTruthy();
      expect(screen.queryByDisplayValue('Отредактированный русский')).toBeNull();
    });

    it('shows the newly selected key text after editing the previous key', () => {
      const { rerender } = render(
        <I18nTextInspector
          i18nBinding={{ ...supportedBinding, key: 'hero.title', resolvedText: 'Hero title' }}
          keyEditable
          availableKeys={['hero.title', 'hero.subtitle']}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          onLocaleChange={mock(() => {})}
        />,
      );

      fireEvent.change(screen.getByTestId('i18n-text-input'), { target: { value: 'Edited title' } });
      expect(screen.getByDisplayValue('Edited title')).toBeTruthy();

      rerender(
        <I18nTextInspector
          i18nBinding={{ ...supportedBinding, key: 'hero.subtitle', resolvedText: 'Hero subtitle' }}
          keyEditable
          availableKeys={['hero.title', 'hero.subtitle']}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          onLocaleChange={mock(() => {})}
        />,
      );
      expect(screen.getByDisplayValue('Hero subtitle')).toBeTruthy();
      expect(screen.queryByDisplayValue('Edited title')).toBeNull();
    });
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
        canCreateKeys
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
        canCreateKeys
      />,
    );
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'onboarding.step1' } });
    const createBtn = screen.getByText((t) => t.includes('Create key'));
    fireEvent.click(createBtn);
    expect(onKeyChange).toHaveBeenCalledWith('onboarding.step1');
  });

  it('allows creating a key when the available key list is empty', async () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        keyEditable
        canCreateKeys
      />,
    );
    const trigger = screen.getByTestId('i18n-key-input');
    expect(trigger.tagName.toLowerCase()).toBe('button');
    fireEvent.click(trigger);
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'brand.first.key' } });
    fireEvent.click(screen.getByTestId('i18n-key-create'));
    expect(onKeyChange).toHaveBeenCalledWith('brand.first.key');
  });

  it('allows creating a key before the available key list has loaded', async () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={supportedBinding}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        keyEditable
        canCreateKeys
      />,
    );
    const trigger = screen.getByTestId('i18n-key-input');
    expect(trigger.tagName.toLowerCase()).toBe('button');
    fireEvent.click(trigger);
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'brand.loading.key' } });
    fireEvent.click(screen.getByTestId('i18n-key-create'));
    expect(onKeyChange).toHaveBeenCalledWith('brand.loading.key');
  });

  // Regression: non-editable layouts must still allow switching
  // JSX to an already-existing key. AstBridge handles that path with skipResourceWrite=true,
  // so no locale-file write happens and the format restriction does not apply.
  // Only the Create affordance is gated on canCreateKeys.
  describe('read-only layout (canCreateKeys=false) with existing keys', () => {
    it('renders the combobox and lets user pick an existing key', () => {
      const onKeyChange = mock(() => {});
      render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          availableKeys={['habits.walks', 'habits.runs', 'home.title']}
          onKeyChange={onKeyChange}
          onResolvedTextChange={mock(() => {})}
          keyEditable
          canCreateKeys={false}
        />,
      );
      const trigger = screen.getByTestId('i18n-key-input');
      expect(trigger.tagName.toLowerCase()).toBe('button');
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('habits.runs'));
      expect(onKeyChange).toHaveBeenCalledWith('habits.runs');
    });

    it('hides the Create key affordance when typed text does not match', () => {
      render(
        <I18nTextInspector
          i18nBinding={supportedBinding}
          availableKeys={['habits.walks', 'habits.runs']}
          onKeyChange={mock(() => {})}
          onResolvedTextChange={mock(() => {})}
          keyEditable
          canCreateKeys={false}
        />,
      );
      fireEvent.click(screen.getByTestId('i18n-key-input'));
      const searchInput = screen.getByPlaceholderText('Search or create key...');
      fireEvent.change(searchInput, { target: { value: 'brand.new.key' } });
      expect(screen.queryByTestId('i18n-key-create')).toBeNull();
      expect(screen.queryByText((t) => t.includes('Create key'))).toBeNull();
    });
  });

  it('falls back to plain input when keyEditable is true but no creation path is available', () => {
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

  it('displays optimistic key immediately after commitKey', () => {
    const onKeyChange = mock(() => {});
    const { rerender } = render(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'old.key' }}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        canCreateKeys
      />,
    );

    const trigger = screen.getByTestId('i18n-key-input');
    expect(trigger.textContent).toBe('old.key');

    // Open combobox, type new key, click Create — triggers commitKey('new.key') → setOptimisticKey
    fireEvent.click(trigger);
    const searchInput = screen.getByPlaceholderText('Search or create key...');
    fireEvent.change(searchInput, { target: { value: 'new.key' } });
    fireEvent.click(screen.getByTestId('i18n-key-create'));

    // Button must immediately show the new key (optimistic, before any prop update)
    expect(screen.getByTestId('i18n-key-input').textContent).toBe('new.key');
    expect(onKeyChange).toHaveBeenCalledWith('new.key');

    // Simulate prop catching up from RPC round-trip — optimisticKey cleared by useEffect
    rerender(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'new.key' }}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        canCreateKeys
      />,
    );
    expect(screen.getByTestId('i18n-key-input').textContent).toBe('new.key');

    // Verify optimisticKey was cleared: rerender with a different key and it must show that key
    rerender(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'other.key' }}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        canCreateKeys
      />,
    );
    expect(screen.getByTestId('i18n-key-input').textContent).toBe('other.key');
  });

  it('clears optimistic key when binding identity changes (e.g. locale switch)', () => {
    const onKeyChange = mock(() => {});
    const { rerender } = render(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'old.key' }}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        canCreateKeys
      />,
    );
    // Create key → setOptimisticKey('new.key')
    fireEvent.click(screen.getByTestId('i18n-key-input'));
    fireEvent.change(screen.getByPlaceholderText('Search or create key...'), {
      target: { value: 'new.key' },
    });
    fireEvent.click(screen.getByTestId('i18n-key-create'));
    expect(screen.getByTestId('i18n-key-input').textContent).toBe('new.key');

    // Locale changes while library+key stay the same (no remount in prod) — bindingIdentity changes
    rerender(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'old.key', activeLocale: 'fr' }}
        availableKeys={[]}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        canCreateKeys
      />,
    );
    // optimisticKey must be cleared — show new binding's real key, not stale 'new.key'
    expect(screen.getByTestId('i18n-key-input').textContent).toBe('old.key');
  });

  it('shows optimistic key immediately in plain input mode (keyEditable, no combobox)', () => {
    const onKeyChange = mock(() => {});
    render(
      <I18nTextInspector
        i18nBinding={{ ...supportedBinding, key: 'old.key' }}
        onKeyChange={onKeyChange}
        onResolvedTextChange={mock(() => {})}
        keyEditable
      />,
    );
    const keyInput = screen.getByTestId('i18n-key-input') as HTMLInputElement;
    expect(keyInput.tagName.toLowerCase()).toBe('input');

    fireEvent.change(keyInput, { target: { value: 'new.key' } });
    fireEvent.keyDown(keyInput, { key: 'Enter' });

    expect((screen.getByTestId('i18n-key-input') as HTMLInputElement).value).toBe('new.key');
    expect(onKeyChange).toHaveBeenCalledWith('new.key');
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
