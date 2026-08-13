/**
 * Dual-mode JSX/DOM dispatch controller for structural ops on a `.map()` iteration
 * (HYP-290c — dual-mode toast UX).
 *
 * When the user performs a structural op (delete/duplicate/reorder) on a rendered
 * `.map()` iteration, the controller:
 *   1. Applies the JSX op IMMEDIATELY (default — operate on the template, current
 *      behavior). The user is never blocked waiting for a choice.
 *   2. Arms a ~3s window and surfaces toast state with a DOM toggle.
 *   3. On `switchToDom()` within the window: UNDOES the JSX op (awaited), then runs the
 *      HYP-290d data-mode op (ASTMapSampleArrayOperation), operating on the Sample-file
 *      array instead of the template. If the DOM op is REFUSED (the server reclassifies
 *      the receiver as not props-from-sample — a client `domEnabled` heuristic cannot
 *      know the true category without the source), the JSX delete is RE-APPLIED so the
 *      user's delete is never silently lost. Shares the undo plumbing the spec requires.
 *   4. On lapse / `dismiss()`: the JSX result is kept.
 *
 * The controller is framework-agnostic and timer-injectable: the toast React shell
 * is thin over this, and the acceptance test is a reducer/state test (no e2e).
 *
 * CRITICAL — captured params, never live selection. The engine clears selection
 * right after the JSX op (`deleteASTElement` → `clearSelection()`), so by the time
 * the user clicks DOM the live `getSelectedMapContext()` is null. The DOM params are
 * snapshotted at construction; the switch dispatches the captured copy.
 *
 * CRITICAL — the switch is async and ordered. `undoJsx` must settle (the server
 * restores the component file) before `applyDom` runs, because the DOM route re-reads
 * the component source to re-classify the receiver. `applyDom` resolves to whether the
 * server accepted; on rejection the controller calls `redoJsx` to restore the delete.
 */

import type { MapLiteralArrayOpParams, MapSampleArrayOpParams } from '../services/ASTApiService';

type MapOpKind = 'delete' | 'duplicate' | 'reorder';

/**
 * Captured DOM-mode params for the dual-mode switch. Either category — the
 * props-from-sample op (HYP-290d) or the in-component literal-array op (HYP-290e) —
 * since HYP-290h routes BOTH through this one controller. The caller (useMapOpToast)
 * picks the category from the classifier and supplies the matching `applyDom` dispatch.
 */
export type MapOpDomParams = MapSampleArrayOpParams | MapLiteralArrayOpParams;

/** Lifecycle of the toast window. */
export type MapOpDispatchStatus =
  /** JSX applied, window open, user may still switch. */
  | 'open'
  /** Switch in flight: JSX undone, DOM op dispatched, awaiting server. */
  | 'switching'
  /** User switched to DOM; the DOM op was accepted. */
  | 'dom'
  /** Window lapsed/dismissed, or the DOM op was refused and JSX re-applied. */
  | 'closed';

export interface MapOpDispatchState {
  operation: MapOpKind;
  /** Whether the DOM toggle is offered (props-from-sample / category 1 only). */
  domEnabled: boolean;
  status: MapOpDispatchStatus;
}

export interface MapOpDispatchOptions {
  operation: MapOpKind;
  /**
   * Whether the DOM toggle is offered. HYP-290h: true only when the classifier routes the
   * receiver to a supported DOM op (`props-from-sample` → sample op, `literal-array` →
   * literal op); `hook-derived`/`generator` are unsupported and keep this false.
   */
  domEnabled: boolean;
  /**
   * Params for the data-mode op, captured at op-fire time. Either category — the caller
   * supplies the matching {@link applyDom} dispatch (HYP-290h classifier-driven routing).
   */
  domParams: MapOpDomParams;
  /** Apply the JSX (template) op — the default, run immediately on start. */
  applyJsx: () => void;
  /** Undo the JSX op (awaited; precedes the DOM dispatch on switch). */
  undoJsx: () => Promise<unknown> | void;
  /**
   * Dispatch the DOM (data-mode) op with the captured params. Resolves to whether the
   * server ACCEPTED the op; `false` triggers the JSX re-apply (the user's delete is
   * never lost when the server reclassifies the receiver as unsupported).
   */
  applyDom: (params: MapOpDomParams) => Promise<boolean>;
  /** Re-apply the JSX op after a refused DOM op (restores the delete). */
  redoJsx: () => Promise<unknown> | void;
  /** Switch window in ms (~3s per spec). */
  windowMs: number;
  /**
   * Schedule the lapse callback; returns a cancel fn. Injected so tests drive the
   * window deterministically. Production passes a setTimeout-backed scheduler.
   */
  schedule: (cb: () => void, ms: number) => () => void;
}

export class MapOpDispatchController {
  private readonly opts: MapOpDispatchOptions;
  /** Deep-copied at construction so a later selection clear / mutation cannot leak in. */
  private readonly domParams: MapOpDomParams;
  private status: MapOpDispatchStatus = 'open';
  private cancelTimer: (() => void) | null = null;
  private started = false;

  constructor(opts: MapOpDispatchOptions) {
    this.opts = opts;
    this.domParams = { ...opts.domParams };
  }

  /** Apply the JSX op and arm the switch window. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.opts.applyJsx();
    this.cancelTimer = this.opts.schedule(() => this.lapse(), this.opts.windowMs);
  }

  /**
   * Switch to DOM mode within the window: undo the JSX op (awaited), then dispatch the
   * DOM op. If the server refuses it, re-apply the JSX op so the delete is not lost.
   * No-op when the toggle is disabled, the window is closed, or already switching.
   *
   * Resolves once the switch settles (accepted → `dom`; refused → `closed`).
   */
  async switchToDom(): Promise<void> {
    if (this.status !== 'open') return;
    if (!this.opts.domEnabled) return;

    this.clearTimer();
    this.status = 'switching';

    // Undo must settle before the DOM op: the server re-reads the component source to
    // re-classify the receiver, so the JSX delete must be reverted first.
    await this.opts.undoJsx();
    const accepted = await this.opts.applyDom(this.domParams);

    if (accepted) {
      this.status = 'dom';
    } else {
      // Server refused (e.g. not props-from-sample). Restore the JSX delete the user
      // actually asked for, and close — the toast already showed JSX semantics.
      await this.opts.redoJsx();
      this.status = 'closed';
    }
  }

  /** Dismiss the toast: close the window, keep the JSX result. */
  dismiss(): void {
    if (this.status !== 'open') return;
    this.clearTimer();
    this.status = 'closed';
  }

  getState(): MapOpDispatchState {
    return {
      operation: this.opts.operation,
      domEnabled: this.opts.domEnabled,
      status: this.status,
    };
  }

  private lapse(): void {
    if (this.status !== 'open') return;
    this.cancelTimer = null;
    this.status = 'closed';
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
