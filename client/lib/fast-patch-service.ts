/**
 * @file Instant per-property CSS injection into the preview iframe (HYP-403/HYP-411).
 *
 * Accessed via: CanvasEngine.fastPatch, driven by useStyleSync during style edits.
 * Assumptions: the active ElementTracer can resolve a live preview element from a
 *   nodeRef. We tag that element with our own attribute and inject a <style> rule
 *   keyed off the tag — so injection survives the pre-HMR window without depending
 *   on the rendered DOM carrying any particular attribute.
 * Past bugs: HYP-403 — the original targeted `[data-uniq-id]`, removed by HYP-268;
 *   it injected CSS that matched nothing. This rebuild resolves via the tracer
 *   (the same path the inspector uses) instead.
 *
 * Why a <style> rule and not inline styles: the next React render in the preview
 * iframe wipes imperative inline styles. The <style> rule keyed off our tag holds
 * until HMR brings the real change, at which point the caller clears the patch.
 */

import { getElementFromIframe, getPreviewIframe } from '@/lib/dom-utils';

const STYLE_ID = 'hyper-canvas-fast-patch';
const PATCH_ATTR = 'data-fast-patch-id';

/** Converts camelCase CSS property to kebab-case */
function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

interface PatchEntry {
  styles: Record<string, string>;
  patchId: string;
  element: HTMLElement;
}

export class FastPatchService {
  private patches = new Map<string, PatchEntry>();
  private nextId = 1;

  /**
   * Apply an instant CSS patch to the element identified by `elementId`
   * (optionally a specific `.map()` instance via `itemIndex`). Re-resolves and
   * re-tags the live element each call, so it self-heals across re-renders.
   */
  applyPatch(elementId: string, styles: Record<string, string>, itemIndex?: number | null): void {
    const element = getElementFromIframe(elementId, itemIndex);
    if (!element) {
      // Element not in the live DOM (not yet rendered / re-rendering) — nothing
      // to target. Drop any stale entry so we don't emit an orphan rule.
      this.patches.delete(elementId);
      this.flush();
      return;
    }

    const existing = this.patches.get(elementId);
    if (existing && existing.element !== element) {
      // The same nodeRef can resolve to a different DOM node (another .map()
      // item index, or a re-render) — drop the tag from the old node so the
      // shared rule doesn't keep styling it (HYP-651).
      existing.element.removeAttribute(PATCH_ATTR);
    }
    const patchId = existing?.patchId ?? String(this.nextId++);
    element.setAttribute(PATCH_ATTR, patchId);
    this.patches.set(elementId, { styles, patchId, element });
    this.flush();
  }

  clearPatch(elementId: string): void {
    const entry = this.patches.get(elementId);
    if (!entry) return;
    entry.element.removeAttribute(PATCH_ATTR);
    this.patches.delete(elementId);
    this.flush();
  }

  /**
   * Run a synchronous measurement with all patch rules disabled, so callers
   * can read the underlying computed style — what the page renders without
   * the patch (HYP-636: style verification must not be satisfied by the
   * patch's own !important rule). The rules are restored before returning;
   * the browser never paints mid-task, so the user sees no flash.
   */
  measureWithoutPatch<T>(fn: () => T): T {
    const styleEl = this.getStyleElement();
    if (!styleEl) return fn();
    styleEl.disabled = true;
    try {
      return fn();
    } finally {
      styleEl.disabled = false;
    }
  }

  clearAll(): void {
    for (const { element } of this.patches.values()) {
      element.removeAttribute(PATCH_ATTR);
    }
    this.patches.clear();
    this.flush();
  }

  private flush(): void {
    const styleEl = this.getOrCreateStyleElement();
    if (!styleEl) return;

    const rules: string[] = [];
    for (const { styles, patchId } of this.patches.values()) {
      const declarations = Object.entries(styles)
        .map(([prop, value]) => `${toKebab(prop)}: ${value} !important`)
        .join(';\n  ');
      rules.push(`[${PATCH_ATTR}="${patchId}"] {\n  ${declarations};\n}`);
    }

    styleEl.textContent = rules.join('\n');
  }

  private getStyleElement(): HTMLStyleElement | null {
    const iframe = getPreviewIframe();
    const doc = iframe?.contentDocument;
    if (!doc) return null;
    return doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  }

  private getOrCreateStyleElement(): HTMLStyleElement | null {
    const iframe = getPreviewIframe();
    const doc = iframe?.contentDocument;
    if (!doc) return null;

    let el = this.getStyleElement();
    if (!el) {
      el = doc.createElement('style');
      el.id = STYLE_ID;
      doc.head.appendChild(el);
    }
    return el;
  }
}
