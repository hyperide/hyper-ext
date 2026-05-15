/**
 * @file I18nTextInspector — stub for Task 9 TDD
 *
 * Accessed via: Right sidebar text section when selected element has i18n expression children
 * Assumptions: i18nBinding comes from useElementStyleData (populated via StyleReadService in VS Code)
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 *
 * NOT YET IMPLEMENTED — Task 10 will replace this stub with the real UI.
 * Tests in __tests__/I18nTextInspector.test.tsx fail against this stub intentionally.
 */
import type { I18nBindingResult } from '@shared/i18n-text/types';

export interface I18nTextInspectorProps {
  i18nBinding: I18nBindingResult;
  onKeyChange: (key: string) => void;
  onResolvedTextChange: (text: string) => void;
  onLocaleChange: (locale: string) => void;
}

export function I18nTextInspector(_props: I18nTextInspectorProps): null {
  return null;
}
