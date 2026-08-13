/**
 * @file TokenCombobox — themed, width-matched token autocomplete for the PropsEditor
 *
 * Accessed via: Properties panel > Component Props > token fields (color/size/space props)
 * Assumptions: rendered in BOTH realms (SaaS web + VS Code ext). Theming relies on the
 *   semantic Tailwind tokens (bg-popover, text-foreground, border-border, bg-accent,
 *   text-muted-foreground) which the ext maps to var(--vscode-*) in
 *   vscode-extension/.../webview/styles.css, so it respects light AND dark VS Code themes.
 *
 * Replaces the native <datalist> autocomplete: that popup was OS-controlled (un-themed,
 * not width-matched to the input, and impossible to screenshot in e2e). This is a real
 * DOM dropdown anchored to the field — it appears in screenshots and themes correctly.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';

interface TokenComboboxProps {
  /** Current field value (the raw string, may be a token like "$blue9" or free text). */
  value: string;
  /** Called on every keystroke and on token selection. */
  onChange: (value: string) => void;
  /** Token list to filter/offer (e.g. tamaguiTokens.color). */
  tokens: string[];
  id?: string;
  placeholder?: string;
  className?: string;
  /** data-testid for the dropdown list (e2e targets the real DOM element, no faked box). */
  listTestId?: string;
}

const MAX_VISIBLE = 100;

/**
 * Inline combobox: the field stays a plain text Input (the typing surface); a themed,
 * width-matched dropdown opens below it with the tokens filtered by what's typed.
 */
export function TokenCombobox({ value, onChange, tokens, id, placeholder, className, listTestId }: TokenComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const autoListId = useId();
  const listId = `${id ?? autoListId}-token-list`;

  // Filter tokens by the typed value (case-insensitive substring). When the value is empty OR
  // already equals a token in the list, show the FULL list — otherwise focusing a field that
  // already holds `$blue9` would filter the dropdown down to just `$blue9`, making it impossible
  // to switch to another token without first deleting part of the value.
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const isExactToken = q !== '' && tokens.some((t) => t.toLowerCase() === q);
    const matches = q === '' || isExactToken ? tokens : tokens.filter((t) => t.toLowerCase().includes(q));
    return matches.slice(0, MAX_VISIBLE);
  }, [tokens, value]);

  // Reset the keyboard cursor whenever the visible options change.
  useEffect(() => {
    setActiveIndex(-1);
  }, [filtered]);

  // Close on outside click (mousedown so it fires before the input re-focuses).
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Keep the active option scrolled into view during keyboard nav.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const select = useCallback(
    (token: string) => {
      onChange(token);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setActiveIndex((i) => (filtered.length === 0 ? -1 : (i + 1) % filtered.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setActiveIndex((i) => (filtered.length === 0 ? -1 : (i - 1 + filtered.length) % filtered.length));
      } else if (e.key === 'Enter') {
        if (open && activeIndex >= 0 && activeIndex < filtered.length) {
          e.preventDefault();
          select(filtered[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActiveIndex(-1);
        }
      }
    },
    [open, filtered, activeIndex, select],
  );

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="w-full h-6 px-2 bg-muted rounded flex items-center">
        <Input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(e) => {
            // Close when focus leaves the field — including keyboard Tab/Shift+Tab, which the
            // outside-mousedown handler never sees. Keep open only if focus moved into the list
            // itself (the options have no tabindex today, but this guards against future changes).
            if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
        />
      </div>

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          data-testid={listTestId}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[180px] overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
        >
          {filtered.map((token, index) => {
            const isActive = index === activeIndex;
            const isSelected = token === value;
            return (
              <li
                key={token}
                role="option"
                aria-selected={isSelected}
                // Select on mousedown so the input's blur/outside-click close doesn't
                // swallow the click before it registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(token);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'cursor-pointer px-2 py-1 text-[11px] text-foreground',
                  isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                  isSelected && 'font-medium',
                )}
              >
                {token}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
