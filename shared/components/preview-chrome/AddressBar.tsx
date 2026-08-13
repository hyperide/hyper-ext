/**
 * @file Browser-like address bar for the Hyper Canvas app-preview.
 *
 * Accessed via: the ext preview panel (PreviewPanelApp) and the SaaS canvas chrome, shown
 *   ONLY in app-mode. Lets the user navigate the previewed app's routes by typing an address
 *   or picking a code-derived suggestion. Free text is always allowed; the dropdown suggests
 *   but never restricts, and is not rendered at all when there are zero suggestions.
 * Styling: portable `--overlay-*` vars (no Tailwind) so the ext webview and SaaS render it the
 *   same. Matches the existing preview chrome's pill geometry + popover language.
 * Past intent: HYP — make App.tsx previewable AS AN APP with a code-derived address bar.
 */

import { type CSSProperties, useEffect, useId, useRef } from 'react';
import { RouteSuggestionList } from './RouteSuggestionList';
import type { RouteSuggestionItem } from './types';
import { useAddressBar } from './useAddressBar';

interface AddressBarProps {
  /** The in-app address currently shown in the preview iframe (e.g. `/`, `/settings`). */
  value: string;
  /** Code-derived route suggestions. An empty array means "render no dropdown". */
  suggestions: RouteSuggestionItem[];
  /** Navigate the previewed app to `path` (host posts it into the iframe). */
  onNavigate: (path: string) => void;
  /** Optional test id forwarded to the input for harness/e2e targeting. */
  testId?: string;
}

const containerStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  maxWidth: 420,
  fontFamily: 'var(--overlay-font)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 28,
  padding: '0 10px',
  fontSize: 12,
  fontFamily: 'var(--overlay-font-mono)',
  color: 'var(--overlay-input-fg)',
  background: 'var(--overlay-input-bg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 999,
  outline: 'none',
  boxSizing: 'border-box',
};

export function AddressBar({ value, suggestions, onNavigate, testId }: AddressBarProps) {
  const reactId = useId();
  const listboxId = `address-bar-listbox-${reactId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const bar = useAddressBar({ suggestions, value, onNavigate });

  // Sync the resting value when the app navigates itself (the iframe reports a new address)
  // and the user is not mid-edit. Guarded on `bar.open` so we never clobber a draft.
  const setDraft = bar.setDraft;
  useEffect(() => {
    if (!bar.open) setDraft(value);
  }, [value, bar.open, setDraft]);

  const activeDescendant = bar.activeIndex >= 0 ? `${listboxId}-opt-${bar.activeIndex}` : undefined;

  return (
    <div style={containerStyle}>
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        aria-label="Preview address"
        role="combobox"
        aria-expanded={bar.showList}
        aria-controls={bar.showList ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        data-testid={testId}
        style={inputStyle}
        value={bar.draft}
        placeholder="/"
        onFocus={bar.onFocus}
        onBlur={bar.onBlur}
        onChange={(e) => bar.onChange(e.target.value)}
        onKeyDown={bar.onKeyDown}
      />
      {bar.showList && (
        <RouteSuggestionList
          suggestions={bar.filtered}
          activeIndex={bar.activeIndex}
          onPick={bar.pick}
          onHover={bar.setActiveIndex}
          listboxId={listboxId}
        />
      )}
    </div>
  );
}
