/**
 * useMapOpToast — dual-mode JSX/DOM toast for structural ops on a `.map()` iteration
 * (HYP-290c / HYP-290h).
 *
 * When a single selected element is a `.map()` iteration, a structural op (delete for
 * now; duplicate/reorder are follow-ups) runs in JSX mode by default (operate on the
 * template — current behavior) and raises a toast offering a switch to DOM mode within
 * a ~3s window.
 *
 * HYP-290h — classifier-driven routing. The data-source category is classified
 * server-side by parse-component and carried on `mapContext.category`. {@link
 * resolveMapOpRoute} routes on it:
 *   - `props-from-sample` → the Sample-array op (HYP-290d), targeting the RESOLVED active
 *     sample file (inline component file today, not a hardcoded sibling `*.samples.tsx`).
 *   - `literal-array` → the in-component literal-array op (HYP-290e), targeting the
 *     component file itself.
 *   - `hook-derived` / `generator` / unknown → DOM mode is UNSUPPORTED; the toggle is
 *     disabled. This is the P2 fix: an unsupported source no longer enables the toggle
 *     and falls through to the destructive JSX re-apply when the server refuses.
 *
 * The dual-mode decision/window logic lives in MapOpDispatchController (engine-side,
 * unit-tested without React). This hook is the thin presentation shell: it resolves the
 * route, builds the params, creates the controller, and wires the toast action/dismiss.
 */

import { useCallback } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import type { CanvasEngine } from '@/lib/canvas-engine/core/CanvasEngine';
import type { MapOpDomParams } from '@/lib/canvas-engine/core/MapOpDispatchController';
import type { MapLiteralArrayOpParams, MapSampleArrayOpParams } from '@/lib/canvas-engine/services/ASTApiService';
import type { MapDataSourceCategory } from '@lib/services/map-datasource-classifier';

const SWITCH_WINDOW_MS = 3000;

/**
 * Derive the colocated Sample file path from the component file path
 * (`Foo.tsx` → `Foo.samples.tsx`), matching the `*.samples.tsx` convention the
 * server route accepts. Used only as a FALLBACK when parse-component did not report a
 * resolved sample path; the server resolves + validates the file regardless.
 */
export function deriveSampleFilePath(componentFilePath: string): string {
  return componentFilePath.replace(/\.(tsx|jsx|ts|js)$/, '.samples.$1');
}

/**
 * A `.map()` receiver is DOM-mode-eligible only if it is a bare identifier
 * (`items`) — the same shape the server route requires to resolve the Sample prop
 * name. Retained as a precondition guard for the Sample-array route; the classifier
 * (`category`) is now the primary gate (HYP-290h).
 */
export function isBareMapReceiver(mapExpression: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(mapExpression.trim());
}

/** Inputs to {@link resolveMapOpRoute}: the classified map context + file identities. */
export interface MapOpRouteInput {
  category: MapDataSourceCategory | undefined;
  componentFilePath: string;
  /** Resolved active sample file (HYP-290h); null → fall back to the derived sibling. */
  sampleFilePath: string | null;
  sampleName: string;
  mapExpression: string;
  itemIndex: number;
  operation: 'delete' | 'duplicate' | 'reorder';
}

/** The DOM-mode route the classifier selected, or `null` when DOM mode is unsupported. */
export interface MapOpRoute {
  /** Whether the DOM toggle should be offered for this source. */
  domEnabled: boolean;
  /** Which server op the switch dispatches, or `null` when unsupported. */
  dispatch: 'sample' | 'literal' | null;
  /** Sample-array op params (category 1), or null. */
  sampleParams: MapSampleArrayOpParams | null;
  /** Literal-array op params (category 3), or null. */
  literalParams: MapLiteralArrayOpParams | null;
}

/**
 * HYP-290h — route a `.map()` structural op to its DOM-mode handler from the classifier
 * category. Pure, so the routing + toggle-gating is unit-tested without React.
 *
 * `props-from-sample` → Sample-array op against the resolved sample file (or the derived
 * sibling fallback). `literal-array` → in-component literal-array op. Everything else
 * (`hook-derived`, `generator`, unknown) → DOM mode unsupported, toggle disabled. This is
 * the gate that stops an unsupported source from reaching the destructive JSX re-apply.
 */
export function resolveMapOpRoute(input: MapOpRouteInput): MapOpRoute {
  const disabled: MapOpRoute = { domEnabled: false, dispatch: null, sampleParams: null, literalParams: null };

  if (input.category === 'props-from-sample') {
    // The Sample prop name is the bare receiver identifier; a non-bare receiver cannot be
    // resolved by the server route, so keep DOM mode disabled rather than enable a refusal.
    if (!isBareMapReceiver(input.mapExpression)) return disabled;
    const sampleParams: MapSampleArrayOpParams = {
      filePath: input.sampleFilePath ?? deriveSampleFilePath(input.componentFilePath),
      componentFilePath: input.componentFilePath,
      sampleName: input.sampleName,
      mapExpression: input.mapExpression,
      itemIndex: input.itemIndex,
      operation: input.operation,
    };
    return { domEnabled: true, dispatch: 'sample', sampleParams, literalParams: null };
  }

  if (input.category === 'literal-array') {
    const literalParams: MapLiteralArrayOpParams = {
      componentFilePath: input.componentFilePath,
      sampleName: input.sampleName,
      mapExpression: input.mapExpression,
      itemIndex: input.itemIndex,
      operation: input.operation,
    };
    return { domEnabled: true, dispatch: 'literal', sampleParams: null, literalParams };
  }

  // hook-derived / generator / undefined → DOM mode unsupported for this data source.
  return disabled;
}

interface MapOpMeta {
  filePath?: string;
  sampleFilePath?: string | null;
}

export function useMapOpToast(engine: CanvasEngine | null, meta: MapOpMeta | null, sampleName: string | null) {
  const { toast } = useToast();

  /**
   * Delete the selected elements. When the single selection is a `.map()` iteration,
   * apply JSX delete and raise the dual-mode toast; otherwise fall back to the plain
   * template delete. Returns true iff the dual-mode (map-aware) path was taken.
   */
  const deleteSelected = useCallback(
    (selectedIds: string[], filePath: string): boolean => {
      if (!engine) return false;

      const mapContext = selectedIds.length === 1 ? engine.getSelectedMapContext() : null;
      const componentFilePath = meta?.filePath;

      // Plain (non-map) delete — unchanged behavior.
      if (!mapContext || !componentFilePath || !sampleName) {
        engine.deleteASTElements(selectedIds, filePath);
        return false;
      }

      // HYP-290h: route by the classifier category, NOT the receiver syntax. An
      // unsupported source (hook-derived/generator/unknown) disables the toggle so the
      // user never reaches the destructive JSX re-apply on a server refusal.
      const route = resolveMapOpRoute({
        category: mapContext.category,
        componentFilePath,
        sampleFilePath: meta?.sampleFilePath ?? null,
        sampleName,
        mapExpression: mapContext.mapExpression,
        itemIndex: mapContext.itemIndex,
        operation: 'delete',
      });

      const domParams: MapOpDomParams | null = route.sampleParams ?? route.literalParams;

      // Bind the DOM dispatch the classifier selected (sample vs literal). When DOM mode
      // is unsupported there are no params; the controller never dispatches (toggle off).
      const applyDom = (params: MapOpDomParams): Promise<boolean> =>
        route.dispatch === 'literal'
          ? engine.dispatchMapLiteralArrayOp(params as MapLiteralArrayOpParams)
          : engine.dispatchMapSampleArrayOp(params as MapSampleArrayOpParams);

      const controller = engine.createMapOpDispatchController({
        operation: 'delete',
        domEnabled: route.domEnabled,
        // A disabled toggle never dispatches; pass a harmless placeholder param shape.
        domParams: domParams ?? {
          componentFilePath,
          sampleName,
          mapExpression: mapContext.mapExpression,
          itemIndex: mapContext.itemIndex,
          operation: 'delete',
        },
        applyDom,
        applyJsx: () => engine.deleteASTElements(selectedIds, filePath),
        windowMs: SWITCH_WINDOW_MS,
      });

      controller.start();

      // The controller's own ~3s timer is the source of truth for the lapse; the
      // toast is purely visual. (use-toast overrides onOpenChange internally, so the
      // window cannot be driven off the toast lifecycle — keep it on the controller.)
      const { dismiss } = toast({
        title: 'Deleted this item (template mode)',
        description: route.domEnabled
          ? 'This affects every item in the list. Switch to data mode to delete just this one.'
          : 'This affects every item in the list. Data mode is not supported for this data source.',
        duration: SWITCH_WINDOW_MS,
        action: (
          <ToastAction
            altText="Switch to data mode"
            disabled={!route.domEnabled}
            onClick={() => {
              controller.switchToDom();
              dismiss();
            }}
          >
            Switch to data
          </ToastAction>
        ),
      });

      return true;
    },
    [engine, meta, sampleName, toast],
  );

  return { deleteSelected };
}
