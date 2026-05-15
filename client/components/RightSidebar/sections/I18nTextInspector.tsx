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
  /** Whether locale switching is active. False until onLocaleChange is wired server-side. */
  localeEditable?: boolean;
  /** All available keys from the locale file. When provided + keyEditable, shows a combobox. */
  availableKeys?: string[];
  /** Increments ONLY on write failure. Forces localText rollback when write fails and resolvedText stays unchanged.
   * Must NOT increment on success — doing so snaps localText to stale resolvedText before the RPC re-read returns. */
  rollbackKey?: number;
}

export const I18nTextInspector = memo(function I18nTextInspector({
  i18nBinding,
  onKeyChange,
  onResolvedTextChange,
  onLocaleChange,
  keyEditable = false,
  localeEditable = false,
  availableKeys,
  rollbackKey,
}: I18nTextInspectorProps) {
  // Local draft prevents snap-back to stale resolvedText during the debounce window.
  // Component is re-keyed in RightSidebar when key/library changes, so this
  // state naturally resets on binding identity change without a useEffect.
  const [localText, setLocalText] = useState(i18nBinding.kind === 'i18n' ? (i18nBinding.resolvedText ?? '') : '');
  const textInputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);
  const resolvedText = i18nBinding.kind === 'i18n' ? (i18nBinding.resolvedText ?? '') : '';

  // Combobox state — only active when keys available and keyEditable
  const [keySearch, setKeySearch] = useState('');
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Track previous rollbackKey to detect write-failure triggers from RightSidebar.
  // Initialized to the first rollbackKey so the initial render never counts as a "key changed" event.
  const prevRollbackKeyRef = useRef<number | undefined>(rollbackKey);

  // Re-sync localText when server pushes a new resolvedText (undo/redo, external file edit).
  // Focus guard prevents snap-back while the user is actively typing — EXCEPT when rollbackKey
  // changes (write failure). On failure resolvedText stays unchanged, so without bypassing the
  // focus guard the rollback never fires while the input is focused.
  // On success rollbackKey does NOT change, so the focus guard keeps localText at what the
  // user typed until the RPC re-read arrives and resolvedText catches up.
  useEffect(() => {
    const isRollback = rollbackKey !== prevRollbackKeyRef.current;
    prevRollbackKeyRef.current = rollbackKey;
    // Use isFocusedRef instead of document.activeElement — in VS Code WebviewView
    // (sidebar iframe) document.activeElement may not reliably reflect the input focus
    // state, causing snap-back while the user is actively typing.
    if (!isRollback && isFocusedRef.current) return;
    setLocalText(resolvedText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedText, rollbackKey]);

  // Close key dropdown when clicking outside
  useEffect(() => {
    if (!showKeyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        keyInputRef.current &&
        !keyInputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowKeyDropdown(false);
        setKeySearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showKeyDropdown]);

  if (i18nBinding.kind === 'unsupported') {
    return (
      <div data-testid="i18n-unsupported-fallback" className="w-full px-4 py-2 text-[11px] text-muted-foreground">
        Raw expression ({i18nBinding.reason})
      </div>
    );
  }

  const currentKey = i18nBinding.key;
  const showCombobox = keyEditable && availableKeys && availableKeys.length > 0;
  const filteredKeys = showCombobox
    ? availableKeys.filter((k) => k.toLowerCase().includes(keySearch.toLowerCase()))
    : [];

  return (
    <div className="w-full px-4 py-3 border-t border-border flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Key</span>

        {showCombobox ? (
          <div className="relative">
            <input
              ref={keyInputRef}
              data-testid="i18n-key-input"
              type="text"
              value={showKeyDropdown ? keySearch : currentKey}
              onChange={(e) => {
                setKeySearch(e.target.value);
                onKeyChange?.(e.target.value);
              }}
              onFocus={() => {
                setKeySearch('');
                setShowKeyDropdown(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowKeyDropdown(false);
                  setKeySearch('');
                  e.currentTarget.blur();
                }
              }}
              placeholder={currentKey}
              className="h-6 w-full rounded bg-muted px-2 text-[11px] text-foreground border-0 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {showKeyDropdown && filteredKeys.length > 0 && (
              <div
                ref={dropdownRef}
                data-testid="i18n-key-dropdown"
                className="absolute z-50 top-7 left-0 right-0 max-h-40 overflow-y-auto rounded-md border bg-popover shadow-md"
              >
                {filteredKeys.map((key) => (
                  <button
                    key={key}
                    data-testid={`i18n-key-option-${key}`}
                    type="button"
                    onMouseDown={(e) => {
                      // mousedown fires before blur, so we can select before dropdown closes
                      e.preventDefault();
                      onKeyChange?.(key);
                      setShowKeyDropdown(false);
                      setKeySearch('');
                    }}
                    className={cn(
                      'w-full text-left px-2 py-1 text-[11px] text-popover-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer',
                      key === currentKey && 'bg-accent/50',
                    )}
                  >
                    {key}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <input
            data-testid="i18n-key-input"
            type="text"
            value={currentKey}
            disabled={!keyEditable}
            onChange={(e) => onKeyChange?.(e.target.value)}
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
            setLocalText(e.target.value);
            onResolvedTextChange(e.target.value);
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
              disabled={!localeEditable || locale === i18nBinding.activeLocale}
              onClick={() => onLocaleChange?.(locale)}
              className={cn(
                'h-5 px-1.5 rounded text-[10px] font-medium transition-colors',
                locale === i18nBinding.activeLocale
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
                localeEditable && locale !== i18nBinding.activeLocale && 'hover:bg-muted/80',
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
