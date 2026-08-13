/**
 * @file composeBrowserI18nText — the pure browser-mode bridge from a useBrowserI18nText scan
 *   result to the inspector's I18nTextBinding (the shape the RightSidebar i18n combobox + the
 *   existing-key retarget path consume).
 *
 * Why it exists / how it's reached: in VS Code the binding arrives via the styles:response RPC
 *   and useElementStyleData owns `i18nText`. In SaaS browser mode there is no host RPC — the scan
 *   route returns every retargetable binding in the file keyed by its t(...) CALL loc. But the
 *   canvas engine only knows the SELECTED ELEMENT's loc (the wrapping JSXElement), not the inner
 *   call. So an exact loc match is impossible browser-side; this helper instead picks the binding
 *   whose call loc falls WITHIN the selected element's source range. Kept a pure function (no React,
 *   no I/O) so the wiring is unit-testable and useElementStyleData's canvas effects stay untouched.
 *
 * INVARIANT: the produced `sourceLocation.{line,column}` is the t(...) CALL loc (what the retarget
 *   route's bindingLoc must be), NOT the element loc — RightSidebar.handleI18nKeyChange forwards it
 *   straight to RETARGET_ROUTE.
 */
import type { I18nBindingResult } from '@shared/i18n-text/types';
import type { BrowserI18nTextResult } from './useBrowserI18nText';

interface LocPoint {
  /** Babel: 1-based line. */
  line: number;
  /** Babel: 0-based column. */
  column: number;
}

interface Range {
  start: LocPoint;
  end: LocPoint;
}

export interface ComposeBrowserI18nTextOptions {
  /** The browser scan result from useBrowserI18nText. */
  result: BrowserI18nTextResult;
  /** Project-relative source file of the selected element. */
  filePath: string | null;
  /**
   * The selected element's source range plus its DIRECT child element ranges, or null when unknown.
   * childRanges let us reject a binding that belongs to a nested descendant rather than the selected
   * element itself — matching the VS Code read path, which only inspects direct children.
   */
  elementRange: (Range & { childRanges?: Range[] }) | null;
  /** Active locale; forwarded into the binding so the retarget route can resolve the dictionary. */
  activeLocale: string;
}

/** True when `point` is at or after `start` and at or before `end` (lexicographic line→column). */
function isWithinRange(point: LocPoint, start: LocPoint, end: LocPoint): boolean {
  const afterStart = point.line > start.line || (point.line === start.line && point.column >= start.column);
  const beforeEnd = point.line < end.line || (point.line === end.line && point.column <= end.column);
  return afterStart && beforeEnd;
}

/**
 * Fold the browser scan result into an I18nTextBinding for the selected element, or undefined when
 * the element is not an i18n binding (so the inspector simply doesn't render the i18n section —
 * exactly as it behaves today in browser mode). Returns undefined while the scan is loading to
 * avoid flickering a stale binding under a freshly-selected element.
 */
export function composeBrowserI18nText(options: ComposeBrowserI18nTextOptions): I18nBindingResult | undefined {
  const { result, filePath, elementRange, activeLocale } = options;

  if (result.error) return undefined;
  if (!filePath || !elementRange) return undefined;
  if (!result.library) return undefined;
  // While loading with NO bindings yet (initial scan of a fresh selection) bail, so a stale binding
  // never flashes under the new element. But a refreshKey-only re-scan (after a retarget) keeps the
  // prior bindings loaded — there we DON'T bail, so the i18n section the user just used stays
  // mounted and simply updates to the new key when the re-scan resolves.
  if (result.loading && result.retargetableBindings.length === 0) return undefined;

  const childRanges = elementRange.childRanges ?? [];
  // Pick the FIRST retargetable binding whose call loc is inside the selected element's range but
  // NOT inside any direct child element's range — so a binding owned by a nested descendant is
  // attributed to that descendant (when it is selected), never to its parent.
  const match = result.retargetableBindings.find((b) => {
    const loc = b.bindingLoc;
    if (!loc) return false;
    if (!isWithinRange(loc, elementRange.start, elementRange.end)) return false;
    return !childRanges.some((cr) => isWithinRange(loc, cr.start, cr.end));
  });
  if (!match?.bindingLoc) return undefined;

  return {
    kind: 'i18n',
    library: result.library,
    key: match.key,
    activeLocale,
    // Phase 1 surfaces no locale list browser-side (the retarget is JSX-only); the inspector hides
    // the locale row when this is empty, matching "no locale switching yet" for browser mode.
    availableLocales: [],
    // Resolving the translated text is a separate (Phase 2) read; the retarget does not need it.
    resolvedText: null,
    // Text editing is not part of Phase-1 browser mode — only existing-key retarget. The text
    // input stays disabled (editable:false) so the inspector never offers an unimplemented write.
    editable: false,
    // Phase 1 is EXISTING-key retarget only; new-key creation (writable) is deferred. Keeping this
    // false means the combobox offers only the existing retargetable keys, never a "create" path.
    writable: false,
    sourceLocation: { filePath, line: match.bindingLoc.line, column: match.bindingLoc.column },
    confidence: 'package-json',
  };
}
