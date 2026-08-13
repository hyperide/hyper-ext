/**
 * @file ClickRetryQueue — retry-on-resolve for clicks racing source-map warmup (HYP-635)
 *
 * Accessed via: useElementTracer (constructs the queue and pumps it from
 *   ModuleSourceMapResolver.onResolved); useIframeEventHandlers (enqueues missed
 *   design-mode clicks and cancels on every new click).
 * Assumptions: tracer readiness is deliberately NOT gated on source-map warmup — a hung
 *   map fetch must never block selection (deferred codex P2 from #395). Instead, a click
 *   that misses the node map WHILE the clicked element's module map is still fetching is
 *   queued here and re-resolved once that module's map lands. At most one click is queued:
 *   a newer click, a cancel (selection change), or the timeout drops it.
 */

import type { LocalResolveResult } from '../../../shared/canvas-interaction/types';

export interface ClickRetryQueueOptions {
  /** Re-run local click resolution (ElementTracer.resolveClickLocal). */
  resolve: (element: HTMLElement) => LocalResolveResult | null;
  /** True while the element's module source map is still being fetched. */
  isWarming: (element: HTMLElement) => boolean;
  /** Drop a queued click that never resolves after this long. Default 3000ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

interface QueuedClick {
  element: HTMLElement;
  deliver: (result: LocalResolveResult) => void;
}

export class ClickRetryQueue {
  private readonly _options: ClickRetryQueueOptions;
  private _entry: QueuedClick | null = null;
  private _expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ClickRetryQueueOptions) {
    this._options = options;
  }

  /**
   * Queue a click whose local resolution missed. Only queues when the element's module
   * source map is still warming — a miss with a warm (or unresolvable) map has a different
   * cause and the server resolve-element fallback is already in flight for it.
   * Replaces any previously queued click. Returns true if the click was queued.
   */
  enqueue(element: HTMLElement, deliver: (result: LocalResolveResult) => void): boolean {
    this.cancel();
    if (!this._options.isWarming(element)) return false;
    this._entry = { element, deliver };
    this._expiryTimer = setTimeout(() => this.cancel(), this._options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return true;
  }

  /**
   * Pump from ModuleSourceMapResolver.onResolved: some module's source map just landed.
   * If the queued element's module is still warming, the resolution was for an unrelated
   * module — keep waiting (re-resolving now would only spam server resolve-element
   * fallbacks). Once the element's own module is warm, resolution gets exactly one
   * re-run: deliver on hit, drop on miss (more warmup won't help this click).
   */
  notifyResolved(): void {
    const entry = this._entry;
    if (entry === null) return;
    if (this._options.isWarming(entry.element)) return;

    this.cancel();
    const result = this._options.resolve(entry.element);
    if (result !== null) entry.deliver(result);
  }

  /** Drop the queued click (new click, selection change, teardown, expiry). */
  cancel(): void {
    if (this._expiryTimer !== null) {
      clearTimeout(this._expiryTimer);
      this._expiryTimer = null;
    }
    this._entry = null;
  }
}
