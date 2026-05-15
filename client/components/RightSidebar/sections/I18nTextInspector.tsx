/**
 * @file I18nTextInspector — compact i18n text inspector for the right sidebar.
 *
 * Accessed via: Right sidebar text section when selected element has i18n expression children
 * Assumptions: i18nBinding comes from useElementStyleData (populated via StyleReadService in VS Code)
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type { I18nBindingResult } from '@shared/i18n-text/types';
import cn from 'clsx';
import { memo, useEffect, useRef, useState } from 'react';

export interface I18nTextInspectorProps {
  i18nBinding: I18nBindingResult;
  onKeyChange?: (key: string) => void;
  onResolvedTextChange: (text: string) => void;
  onLocaleChange?: (locale: string) => void;
  /** Whether the key field is editable. False until onKeyChange is wired server-side. */
  keyEditable?: boolean;
  /**
   * Whether the user is allowed to create new keys (requires an editable i18n binding).
   * Independent of keyEditable: read-only layouts can still switch JSX to an
   * already-existing key (JSX-only rewrite, no resource write), but cannot create new ones.
   */
  canCreateKeys?: boolean;
  /** Whether locale switching is active. False until onLocaleChange is wired server-side. */
  localeEditable?: boolean;
  /** All available keys from the locale file. When provided + keyEditable, shows a combobox. */
  availableKeys?: string[];
  /** Increments ONLY on write failure. Forces localText rollback when write fails and resolvedText stays unchanged.
   * Must NOT increment on success — doing so snaps localText to stale resolvedText before the RPC re-read returns. */
  rollbackKey?: number;
  /**
   * When true, the key combobox trigger is disabled.
   * Set by the parent while a write is in flight or while the style re-read is loading.
   * Prevents a second key change from firing before the inspector remounts with the
   * updated key (which would cause commitKey to abort via `key === currentKey`).
   */
  keyBusy?: boolean;
}

export const I18nTextInspector = memo(function I18nTextInspector({
  i18nBinding,
  onKeyChange,
  onResolvedTextChange,
  onLocaleChange,
  keyEditable = false,
  canCreateKeys = false,
  localeEditable = false,
  availableKeys,
  rollbackKey,
  keyBusy = false,
}: I18nTextInspectorProps) {
  // Local draft prevents snap-back to stale resolvedText during the debounce window.
  const [localText, setLocalText] = useState(i18nBinding.kind === 'i18n' ? (i18nBinding.resolvedText ?? '') : '');
  const textInputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);
  const resolvedText = i18nBinding.kind === 'i18n' ? (i18nBinding.resolvedText ?? '') : '';
  const bindingIdentity =
    i18nBinding.kind === 'i18n'
      ? `${i18nBinding.library}\0${i18nBinding.namespace ?? ''}\0${i18nBinding.key}\0${i18nBinding.activeLocale}`
      : i18nBinding.kind;

  // Combobox state — only active when keys available and keyEditable
  const [keySearch, setKeySearch] = useState('');
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const [optimisticKey, setOptimisticKey] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Track previous rollbackKey to detect write-failure triggers from RightSidebar.
  // Initialized to the first rollbackKey so the initial render never counts as a "key changed" event.
  const prevRollbackKeyRef = useRef<number | undefined>(rollbackKey);

  // Track the value the user last submitted via onResolvedTextChange. The
  // server round-trip is debounced (~300ms) and HMR can re-render while focus
  // is gone, so we cannot rely on isFocusedRef alone — clicking away after
  // typing previously caused localText to snap back to the OLD resolvedText
  // because the focus guard had already lifted.
  // Until we observe that resolvedText caught up to the pending value (or the
  // value diverged via an external edit), we keep showing what the user typed.
  const pendingTextRef = useRef<string | null>(null);
  const prevBindingIdentityRef = useRef(bindingIdentity);

  // Re-sync localText when server pushes a new resolvedText (undo/redo, external file edit).
  // Three guards stack to avoid snap-back:
  //   - rollbackKey change (explicit failure signal): always re-apply.
  //   - focus held: never overwrite — user is mid-edit.
  //   - pending write: keep localText at the user's value until either the
  //     server confirms (resolvedText === pending) or someone else changes the
  //     value to something different (in which case the external edit wins).
  useEffect(() => {
    const isBindingChange = bindingIdentity !== prevBindingIdentityRef.current;
    prevBindingIdentityRef.current = bindingIdentity;
    if (isBindingChange) {
      pendingTextRef.current = null;
      setLocalText(resolvedText);
      return;
    }

    const isRollback = rollbackKey !== prevRollbackKeyRef.current;
    prevRollbackKeyRef.current = rollbackKey;
    if (isRollback) {
      // Explicit failure — drop the pending guard and snap back so the user sees the truth.
      pendingTextRef.current = null;
      setLocalText(resolvedText);
      return;
    }
    if (isFocusedRef.current) return;
    if (pendingTextRef.current !== null) {
      if (resolvedText === pendingTextRef.current) {
        // Server caught up — clear pending and accept the value.
        pendingTextRef.current = null;
        setLocalText(resolvedText);
      }
      // Otherwise keep showing what the user typed.
      return;
    }
    setLocalText(resolvedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedText, rollbackKey, bindingIdentity]);

  // Auto-focus search when popover opens. No select() — leave the cursor at the
  // end so the user can keep typing immediately without their first keystroke
  // overwriting selected text.
  useEffect(() => {
    if (showKeyDropdown) {
      // requestAnimationFrame avoids a race where the popover renders inside the
      // VS Code WebviewView before the input is reachable for focus.
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [showKeyDropdown]);

  // Close key dropdown when clicking outside
  useEffect(() => {
    if (!showKeyDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setShowKeyDropdown(false);
        setKeySearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showKeyDropdown]);

  // Clear optimistic key once the binding prop catches up.
  const realKey = i18nBinding.kind === 'i18n' ? i18nBinding.key : '';
  useEffect(() => {
    if (optimisticKey !== null && realKey === optimisticKey) {
      setOptimisticKey(null);
    }
  }, [realKey, optimisticKey]);

  if (i18nBinding.kind === 'unsupported') {
    return (
      <div data-testid="i18n-unsupported-fallback" className="w-full px-4 py-2 text-[11px] text-muted-foreground">
        Raw expression ({i18nBinding.reason})
      </div>
    );
  }

  const currentKey = optimisticKey ?? (i18nBinding.kind === 'i18n' ? i18nBinding.key : '');
  const showCombobox = canCreateKeys || (keyEditable && availableKeys !== undefined && availableKeys.length > 0);
  const trimmedSearch = keySearch.trim();
  const filteredKeys = showCombobox
    ? (availableKeys ?? []).filter((k) => k.toLowerCase().includes(trimmedSearch.toLowerCase()))
    : [];
  const isExactMatch = trimmedSearch.length > 0 && (availableKeys ?? []).includes(trimmedSearch);
  // Create affordance gated on canCreateKeys: read-only layouts can switch
  // to an existing key (JSX-only rewrite) but cannot add a new translation entry.
  // Missing/empty key lists still allow creation; the write path adds the key
  // inside an already-resolved editable dictionary.
  const showCreateAffordance = trimmedSearch.length > 0 && !isExactMatch && canCreateKeys;

  const commitKey = (key: string) => {
    if (!key) {
      setShowKeyDropdown(false);
      setKeySearch('');
      return;
    }
    setOptimisticKey(key);
    onKeyChange?.(key);
    setShowKeyDropdown(false);
    setKeySearch('');
  };

  return (
    <div className="w-full px-4 py-3 border-t border-border flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Key</span>

        {showCombobox ? (
          <div className="relative">
            <button
              ref={triggerRef}
              data-testid="i18n-key-input"
              type="button"
              disabled={keyBusy}
              onClick={() => {
                setKeySearch('');
                setShowKeyDropdown((s) => !s);
              }}
              className="h-6 w-full rounded bg-muted px-2 text-[11px] text-foreground border-0 text-left focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {currentKey}
            </button>
            {showKeyDropdown && (
              <div
                ref={popoverRef}
                data-testid="i18n-key-dropdown"
                className="absolute z-50 top-7 left-0 right-0 rounded-md border bg-popover shadow-md flex flex-col"
              >
                <input
                  ref={searchInputRef}
                  type="text"
                  value={keySearch}
                  placeholder="Search or create key..."
                  onChange={(e) => setKeySearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowKeyDropdown(false);
                      setKeySearch('');
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredKeys.length === 1) {
                        commitKey(filteredKeys[0]);
                      } else if (showCreateAffordance) {
                        commitKey(trimmedSearch);
                      } else if (isExactMatch) {
                        commitKey(trimmedSearch);
                      }
                    }
                  }}
                  className="h-7 w-full bg-transparent border-b px-2 text-[11px] text-foreground focus:outline-none"
                />
                <div className="max-h-40 overflow-y-auto">
                  {filteredKeys.map((key) => (
                    <button
                      key={key}
                      data-testid={`i18n-key-option-${key}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commitKey(key)}
                      className={cn(
                        'w-full text-left px-2 py-1 text-[11px] text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer',
                        key === currentKey && 'bg-accent/50',
                      )}
                    >
                      {key}
                    </button>
                  ))}
                  {filteredKeys.length === 0 && !showCreateAffordance && (
                    <div className="px-2 py-1 text-[11px] text-muted-foreground">No keys</div>
                  )}
                </div>
                {showCreateAffordance && (
                  <button
                    data-testid="i18n-key-create"
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitKey(trimmedSearch)}
                    className="border-t px-2 py-1.5 text-left text-[11px] text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer flex items-center gap-1"
                  >
                    <span className="text-muted-foreground">+</span>
                    <span>
                      Create key: <span className="font-mono text-foreground">{trimmedSearch}</span>
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <input
            data-testid="i18n-key-input"
            type="text"
            defaultValue={currentKey}
            key={currentKey}
            disabled={!keyEditable}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = (e.target as HTMLInputElement).value.trim();
                if (v && v !== currentKey) onKeyChange?.(v);
              } else if (e.key === 'Escape') {
                (e.target as HTMLInputElement).value = currentKey;
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== currentKey) onKeyChange?.(v);
              else e.target.value = currentKey;
            }}
            className="h-6 w-full rounded bg-muted px-2 text-[11px] text-foreground border-0 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Text</span>
        <input
          data-testid="i18n-text-input"
          ref={textInputRef}
          type="text"
          value={localText}
          onChange={(e) => {
            const v = e.target.value;
            setLocalText(v);
            pendingTextRef.current = v;
            onResolvedTextChange(v);
          }}
          onFocus={() => {
            isFocusedRef.current = true;
          }}
          onBlur={() => {
            isFocusedRef.current = false;
          }}
          disabled={!i18nBinding.editable}
          className="h-6 w-full rounded bg-muted px-2 text-[11px] text-foreground border-0 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {i18nBinding.availableLocales.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {i18nBinding.availableLocales.map((locale) => (
            <button
              key={locale}
              data-testid={`i18n-locale-button-${locale}`}
              type="button"
              aria-pressed={locale === i18nBinding.activeLocale}
              disabled={!localeEditable || locale === i18nBinding.activeLocale}
              onClick={() => onLocaleChange?.(locale)}
              className={cn(
                'h-5 px-1.5 rounded border text-[10px] font-medium transition-colors',
                locale === i18nBinding.activeLocale
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-transparent bg-transparent text-muted-foreground',
                localeEditable && locale !== i18nBinding.activeLocale && 'hover:bg-muted hover:text-foreground',
                !localeEditable && locale !== i18nBinding.activeLocale && 'opacity-50 cursor-not-allowed',
              )}
            >
              {locale}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
