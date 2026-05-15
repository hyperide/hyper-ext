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
  onKeyChange: (key: string) => void;
  onResolvedTextChange: (text: string) => void;
  onLocaleChange: (locale: string) => void;
  /** Whether the key field is editable. False until onKeyChange is wired server-side. */
  keyEditable?: boolean;
  /** Whether locale switching is active. False until onLocaleChange is wired server-side. */
  localeEditable?: boolean;
}

export const I18nTextInspector = memo(function I18nTextInspector({
  i18nBinding,
  onKeyChange,
  onResolvedTextChange,
  onLocaleChange,
  keyEditable = false,
  localeEditable = false,
}: I18nTextInspectorProps) {
  const resolvedText = i18nBinding.kind === 'i18n' ? (i18nBinding.resolvedText ?? '') : '';
  const [localText, setLocalText] = useState(resolvedText);
  // Prevents prop sync from overwriting user input mid-typing.
  const isEditingRef = useRef(false);

  useEffect(() => {
    if (!isEditingRef.current) {
      setLocalText(resolvedText);
    }
  }, [resolvedText]);

  if (i18nBinding.kind === 'unsupported') {
    return (
      <div data-testid="i18n-unsupported-fallback" className="w-full px-4 py-2 text-[11px] text-muted-foreground">
        Raw expression ({i18nBinding.reason})
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-3 border-t border-border flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Key</span>
        <input
          type="text"
          value={i18nBinding.key}
          onChange={(e) => onKeyChange(e.target.value)}
          disabled={!keyEditable}
          className="h-6 w-full rounded bg-muted px-2 text-[11px] text-foreground border-0 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Text</span>
        <input
          type="text"
          value={localText}
          onChange={(e) => {
            isEditingRef.current = true;
            setLocalText(e.target.value);
            onResolvedTextChange(e.target.value);
          }}
          onBlur={() => {
            isEditingRef.current = false;
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
              type="button"
              onClick={() => onLocaleChange(locale)}
              disabled={!localeEditable || locale === i18nBinding.activeLocale}
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
