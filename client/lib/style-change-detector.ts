/**
 * Style change detection and verification utilities.
 * Captures computed styles before/after AST writes and determines
 * whether visual changes actually took effect (CSS specificity issues).
 */

import { getComputedStylesFromIframe, getPreviewIframe } from './dom-utils';

// Wait after backend response for HMR + React render.
// 300ms is an empirically chosen compromise: usually enough for HMR + React
// to re-render on typical dev machines without making the UI feel sluggish.
export const POST_HMR_DELAY_MS = 300;
// Show "AI analyzing..." toast after this
export const LONG_WAIT_MS = 3000;
// Max wait before giving up
export const SAFETY_TIMEOUT_MS = 15000;
// Timeout for iframe load during style verification
export const IFRAME_LOAD_TIMEOUT_MS = 5000;

/**
 * Mapping from ParsedStyles keys to CSS computed property names.
 * Most are identity (camelCase), special cases listed here.
 */
export const STYLE_TO_CSS_MAP: Record<string, string> = {
  layoutType: 'display',
  shadow: 'boxShadow',
  shadowColor: 'boxShadow',
  shadowOpacity: 'boxShadow',
  shadowX: 'boxShadow',
  shadowY: 'boxShadow',
  shadowBlur: 'boxShadow',
  shadowSpread: 'boxShadow',
  borderRadiusTopLeft: 'borderTopLeftRadius',
  borderRadiusTopRight: 'borderTopRightRadius',
  borderRadiusBottomLeft: 'borderBottomLeftRadius',
  borderRadiusBottomRight: 'borderBottomRightRadius',
  transitionTiming: 'transitionTimingFunction',
  blur: 'filter',
};

/** Get CSS computed property name for a ParsedStyles key */
export function getCSSProperty(styleKey: string): string {
  return STYLE_TO_CSS_MAP[styleKey] ?? styleKey;
}

/** Deduplicate: multiple style keys may map to the same CSS property (all shadow* -> boxShadow) */
export function getUniqueCSSProperties(styleKeys: string[]): string[] {
  return [...new Set(styleKeys.map(getCSSProperty))];
}

/**
 * Capture a snapshot of computed styles for the given element in the preview iframe.
 * Returns null if element is not found in the DOM.
 */
export function captureComputedStyles(
  elementId: string,
  cssProperties: string[],
  instanceId?: string | null,
): Record<string, string> | null {
  const computedStyle = getComputedStylesFromIframe(elementId, instanceId);
  if (!computedStyle) return null;

  // CSSStyleDeclaration is live; snapshot eagerly into plain object
  const snapshot: Record<string, string> = {};
  for (const prop of cssProperties) {
    snapshot[prop] = computedStyle.getPropertyValue(
      // camelCase -> kebab-case for getPropertyValue
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
    );
  }
  return snapshot;
}

/** Returns CSS property names that didn't change between before and after snapshots */
export function detectUnchangedProperties(before: Record<string, string>, after: Record<string, string>): string[] {
  const unchanged: string[] = [];
  for (const prop of Object.keys(before)) {
    if (before[prop] === after[prop]) {
      unchanged.push(prop);
    }
  }
  return unchanged;
}

export interface StyleNotAppliedContext {
  elementId: string;
  filePath: string;
  styles: Record<string, string>;
  unchangedProperties: string[];
}

interface StyleVerificationParams {
  elementId: string;
  filePath: string;
  styles: Record<string, string>;
  cssProperties: string[];
  beforeSnapshot: Record<string, string> | null;
  instanceId?: string | null;
  backendPromise?: Promise<void>;
  onVerified: () => void;
  onNotApplied: (ctx: StyleNotAppliedContext) => void;
  onTimeout: () => void;
  onLongWait?: () => void;
}

/**
 * Start verification pipeline: wait for backend + SSE signals,
 * compare computed styles, force-reload if needed.
 * Returns a cleanup function to cancel everything.
 */
export function startStyleVerification(params: StyleVerificationParams): () => void {
  const {
    elementId,
    filePath,
    styles,
    cssProperties,
    beforeSnapshot,
    instanceId,
    backendPromise,
    onVerified,
    onNotApplied,
    onTimeout,
    onLongWait,
  } = params;

  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cleanups: (() => void)[] = [];

  function addTimer(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      if (!cancelled) fn();
    }, ms);
    timers.push(t);
  }

  function finish(): void {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
    for (const c of cleanups) c();
  }

  // If no beforeSnapshot, can't compare — just resolve after a delay
  if (!beforeSnapshot || cssProperties.length === 0) {
    addTimer(() => {
      onVerified();
    }, POST_HMR_DELAY_MS);
    return finish;
  }

  function verifyStyles(): void {
    if (cancelled) return;
    const afterSnapshot = captureComputedStyles(elementId, cssProperties, instanceId);
    if (!afterSnapshot) {
      // Element gone — HMR removed it. Clear syncing.
      finish();
      onVerified();
      return;
    }
    const unchanged = detectUnchangedProperties(beforeSnapshot, afterSnapshot);
    if (unchanged.length === 0) {
      finish();
      onVerified();
      return;
    }
    // Styles not yet applied — caller will force-reload
    forceReloadAndVerify();
  }

  function forceReloadAndVerify(): void {
    if (cancelled) return;
    const iframe = getPreviewIframe();
    if (!iframe?.contentWindow) {
      finish();
      onNotApplied({ elementId, filePath, styles, unchangedProperties: cssProperties });
      return;
    }

    const handleLoad = () => {
      iframe.removeEventListener('load', handleLoad);
      addTimer(() => {
        if (cancelled) return;
        const afterSnapshot = captureComputedStyles(elementId, cssProperties, instanceId);
        if (!afterSnapshot) {
          finish();
          onVerified();
          return;
        }
        const unchanged = detectUnchangedProperties(beforeSnapshot, afterSnapshot);
        finish();
        if (unchanged.length === 0) {
          onVerified();
        } else {
          onNotApplied({ elementId, filePath, styles, unchangedProperties: unchanged });
        }
      }, POST_HMR_DELAY_MS);
    };

    iframe.addEventListener('load', handleLoad);
    cleanups.push(() => iframe.removeEventListener('load', handleLoad));

    // Timeout for iframe load
    addTimer(() => {
      iframe.removeEventListener('load', handleLoad);
      finish();
      onNotApplied({ elementId, filePath, styles, unchangedProperties: cssProperties });
    }, IFRAME_LOAD_TIMEOUT_MS);

    iframe.contentWindow.location.reload();
  }

  function handleSignal(): void {
    if (cancelled) return;
    addTimer(() => {
      if (cancelled) return;
      verifyStyles();
    }, POST_HMR_DELAY_MS);
  }

  // Primary signal: backendPromise resolves when server wrote the file
  let backendResolved = false;
  if (backendPromise) {
    backendPromise
      .then(() => {
        backendResolved = true;
        handleSignal();
      })
      .catch(() => {
        // Backend error — still try SSE path
      });
  }

  // Backup signal: SSE 'components_updated' from ComponentWatcher
  const handleSSE = () => {
    if (cancelled || backendResolved) return;
    handleSignal();
  };
  window.addEventListener('components_updated', handleSSE);
  cleanups.push(() => window.removeEventListener('components_updated', handleSSE));

  // Long wait timer (3s)
  if (onLongWait) {
    addTimer(() => {
      if (!backendResolved) onLongWait();
    }, LONG_WAIT_MS);
  }

  // Safety timeout (15s)
  addTimer(() => {
    finish();
    onTimeout();
  }, SAFETY_TIMEOUT_MS);

  return finish;
}
