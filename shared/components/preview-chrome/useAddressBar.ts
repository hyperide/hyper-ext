/**
 * @file State + keyboard logic for the app-preview address bar.
 *
 * Accessed via: AddressBar (this directory). Extracted so the component stays presentational.
 * Behavior contract:
 *   - The dropdown opens on focus/click and only when there is >=1 matching suggestion.
 *   - Free text is always allowed: Enter submits the current input value verbatim.
 *   - Esc closes the dropdown (and, if already closed, blurs). Blur closes.
 *   - Arrow keys move a highlight; -1 means "the typed value", so Enter on -1 submits free text.
 */

import { useCallback, useMemo, useState } from 'react';
import type { RouteSuggestionItem } from './types';

interface UseAddressBarArgs {
  /** All code-derived suggestions for the current app (may be empty). */
  suggestions: RouteSuggestionItem[];
  /** The address currently shown in the iframe (controls the input's resting value). */
  value: string;
  /** Navigate the previewed app to `path`. Called on Enter or on picking a suggestion. */
  onNavigate: (path: string) => void;
}

interface UseAddressBarResult {
  draft: string;
  setDraft: (next: string) => void;
  open: boolean;
  activeIndex: number;
  /** Suggestions filtered by the current draft (case-insensitive substring of the path). */
  filtered: RouteSuggestionItem[];
  /** True when the popover should render: open AND at least one filtered suggestion. */
  showList: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (next: string) => void;
  onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
  pick: (path: string) => void;
  setActiveIndex: (index: number) => void;
}

function filterSuggestions(suggestions: RouteSuggestionItem[], draft: string): RouteSuggestionItem[] {
  const needle = draft.trim().toLowerCase();
  if (!needle || needle === '/') return suggestions;
  return suggestions.filter((s) => s.path.toLowerCase().includes(needle));
}

export function useAddressBar({ suggestions, value, onNavigate }: UseAddressBarArgs): UseAddressBarResult {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filtered = useMemo(() => filterSuggestions(suggestions, draft), [suggestions, draft]);
  const showList = open && filtered.length > 0;

  const submit = useCallback(
    (path: string) => {
      const next = path.trim();
      if (!next) return;
      setDraft(next);
      setOpen(false);
      setActiveIndex(-1);
      onNavigate(next.startsWith('/') ? next : `/${next}`);
    },
    [onNavigate],
  );

  const pick = useCallback((path: string) => submit(path), [submit]);

  const onFocus = useCallback(() => setOpen(true), []);
  const onBlur = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const onChange = useCallback((next: string) => {
    setDraft(next);
    setOpen(true);
    setActiveIndex(-1);
  }, []);

  const onKeyDown = useCallback(
    (e: { key: string; preventDefault: () => void }) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length === 0) return;
        setOpen(true);
        setActiveIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length === 0) return;
        setOpen(true);
        setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = activeIndex >= 0 && activeIndex < filtered.length ? filtered[activeIndex].path : draft;
        submit(chosen);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    },
    [activeIndex, draft, filtered, submit],
  );

  return {
    draft,
    setDraft,
    open,
    activeIndex,
    filtered,
    showList,
    onFocus,
    onBlur,
    onChange,
    onKeyDown,
    pick,
    setActiveIndex,
  };
}
