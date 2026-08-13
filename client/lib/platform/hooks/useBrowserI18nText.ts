/**
 * @file useBrowserI18nText — browser-mode (no-canvas) i18n binding reader for the inspector
 *   (HYP-372 M3 P1 READ path).
 *
 * Why a SEPARATE hook (not a branch inside useElementStyleData): the spec requires the canvas /
 *   VS-Code RPC path to stay BYTE-IDENTICAL — useElementStyleData's existing effects must not be
 *   touched. So this is a standalone top-level hook that NO-OPS whenever a canvas adapter exists
 *   (VS Code mode already populates i18nText via the styles:response RPC). It only does work in
 *   browser mode, where it calls the server scan route (which runs the SAME scanBindings the write
 *   path's capability gating uses) to surface the bound key + the retargetable keys for the combobox.
 *
 * Consumed by RightSidebar via composeBrowserI18nText: in browser mode its scan result is folded
 *   into the inspector's `i18nText` so the i18n key combobox renders, and an existing-key pick
 *   retargets through the already-wired BrowserAdapter→RETARGET_ROUTE path. The VS Code RPC flow
 *   (useElementStyleData) is untouched — this hook NO-OPS there, keeping the canvas path identical.
 */
import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import type { ScannedBinding } from '@shared/i18n-text/retarget/core';
import type { I18nLibrary } from '@shared/i18n-text/types';
import { scanNodePodBindings } from '../nodepod/nodepodRetargetTransport';
import { useNodePodRuntimeStore } from '../nodepod/nodepodRuntimeStore';
import type { CanvasAdapter } from '../types';

/** A retargetable binding that carries a static key — the one definition of a combobox candidate. */
type RetargetableKeyBinding = ScannedBinding & { key: string };

function isRetargetableKey(b: ScannedBinding): b is RetargetableKeyBinding {
  return b.retargetable && typeof b.key === 'string' && b.key.length > 0;
}

export interface BrowserI18nTextResult {
  /** The binding at the selected element's source location, if it is a recognized i18n call. */
  binding: ScannedBinding | null;
  /**
   * Every retargetable binding in the file (static key + its call loc). The consumer picks the
   * one whose call loc falls within the SELECTED ELEMENT's source range — the element loc the
   * canvas engine knows is the wrapping JSXElement, NOT the inner t(...) call, so an exact-loc
   * match against the call is unavailable browser-side; range containment is what bridges them.
   */
  retargetableBindings: RetargetableKeyBinding[];
  /** Every retargetable key in the file — the combobox candidate set for an existing-key retarget. */
  retargetableKeys: string[];
  /**
   * The i18n library the server scan actually ran with (it detects from package.json when the
   * client passes no hint). The consumer forwards this to the retarget route, so scan and write
   * agree on the library. Null when no library could be detected.
   */
  library: I18nLibrary | null;
  loading: boolean;
  /** Set when the scan request failed (vs. "no binding found"), so consumers can distinguish them. */
  error: string | null;
}

const EMPTY: BrowserI18nTextResult = {
  binding: null,
  retargetableBindings: [],
  retargetableKeys: [],
  library: null,
  loading: false,
  error: null,
};

export interface UseBrowserI18nTextOptions {
  /** When a canvas adapter exists we are in VS Code mode — this hook NO-OPS (returns EMPTY). */
  canvas: CanvasAdapter | null;
  /** Project-relative source file of the selected element. */
  filePath: string | null;
  /** The selected element's source location (Babel: 1-based line, 0-based column), if known. */
  sourceLocation: { line: number; column: number } | null;
  /** i18n library hint from project detection. */
  library: I18nLibrary | null;
  /**
   * Bump to force a re-scan of the SAME file/loc — needed after a retarget rewrites the source but
   * the selected element keeps its loc, so without this the combobox would show the pre-write key.
   */
  refreshKey?: number;
}

export function useBrowserI18nText(options: UseBrowserI18nTextOptions): BrowserI18nTextResult {
  const { canvas, filePath, sourceLocation, library, refreshKey } = options;
  // Subscribe to the active runtime so the scan effect RE-RUNS when it resolves (e.g. the store is
  // still at its Docker default the moment the hook first mounts on a NodePod project, then flips to
  // nodepod). Reading getActiveRuntime() imperatively inside the effect without these deps would let
  // the first scan run against the wrong (Docker) transport and never retrigger → stale scan.
  const mode = useNodePodRuntimeStore((s) => s.mode);
  const projectId = useNodePodRuntimeStore((s) => s.projectId);
  const [result, setResult] = useState<BrowserI18nTextResult>(EMPTY);
  // The target (file + loc) of the last scan, so a refreshKey-only re-scan (same target) can keep
  // the current bindings on screen while loading instead of clearing — see the setResult below.
  const prevTargetRef = useRef<{
    filePath: string;
    line: number;
    column: number;
    mode: string;
    projectId: string | null;
  } | null>(null);

  // Depend on the PRIMITIVE loc fields, not the sourceLocation object. Callers pass a fresh object
  // literal each render; depending on its identity would re-run the effect every render and loop
  // (setState → re-render → new object → effect → setState …).
  const line = sourceLocation?.line ?? null;
  const column = sourceLocation?.column ?? null;

  useEffect(() => {
    // NO-OP in VS Code mode — the canvas RPC path owns i18nText there.
    if (canvas) {
      setResult(EMPTY);
      return;
    }
    if (!filePath || line == null || column == null) {
      setResult(EMPTY);
      return;
    }

    let cancelled = false;
    // On a NEW target (different file/loc OR a different active runtime) clear the prior binding so a
    // stale one never renders under the new selection — including the docker→nodepod transition,
    // where the Docker scan's bindings must NOT stay visible while the NodePod scan loads (they read
    // different filesystems and may disagree). On a SAME-target re-scan (only refreshKey changed —
    // e.g. after a retarget rewrote the file) KEEP the current bindings while loading: otherwise the
    // i18n section (and the combobox the user just used) would unmount and flash back, not flicker.
    setResult((prev) => {
      const sameTarget =
        prevTargetRef.current?.filePath === filePath &&
        prevTargetRef.current?.line === line &&
        prevTargetRef.current?.column === column &&
        prevTargetRef.current?.mode === mode &&
        prevTargetRef.current?.projectId === projectId;
      prevTargetRef.current = { filePath, line, column, mode, projectId };
      return sameTarget
        ? { ...prev, loading: true, error: null }
        : { binding: null, retargetableBindings: [], retargetableKeys: [], library: null, loading: true, error: null };
    });

    void (async () => {
      try {
        // One scan call, the active runtime decides the source: NodePod (serverless) scans the
        // in-browser OPFS file with the SAME shared scanBindings; Docker hits the server route.
        // Without this, a NodePod scan would read the Docker filesystem (stale/absent), so the
        // combobox would never see the project's real bindings.
        let data: { success: boolean; bindings?: ScannedBinding[]; library?: I18nLibrary | null };
        if (mode === 'nodepod') {
          const scan = await scanNodePodBindings(
            { filePath, library: library ?? null },
            { projectId: projectId ?? '' },
          );
          if (!scan.success) throw new Error(scan.error ?? 'NodePod scan failed');
          data = { success: scan.success, bindings: scan.bindings, library: scan.library };
        } else {
          const response = await authFetch('/api/scan-i18n-bindings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath, library: library ?? undefined }),
          });
          if (!response.ok) throw new Error(response.statusText);
          data = (await response.json()) as {
            success: boolean;
            bindings?: ScannedBinding[];
            library?: I18nLibrary | null;
          };
        }
        if (cancelled) return;

        const bindings = data.bindings ?? [];
        const retargetableBindings = bindings.filter(isRetargetableKey);
        // The binding at the selected element: a retargetable call whose loc matches exactly.
        const binding =
          retargetableBindings.find((b) => b.bindingLoc?.line === line && b.bindingLoc?.column === column) ?? null;
        const retargetableKeys = retargetableBindings.map((b) => b.key);
        setResult({
          binding,
          retargetableBindings,
          retargetableKeys,
          // Prefer the server's detected library; fall back to the caller's hint.
          library: data.library ?? library ?? null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!cancelled)
          setResult({
            binding: null,
            retargetableBindings: [],
            retargetableKeys: [],
            library: null,
            loading: false,
            error: String(err),
          });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canvas, filePath, line, column, library, refreshKey, mode, projectId]);

  return result;
}
