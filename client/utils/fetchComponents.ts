/**
 * Shared deduplicating fetch for /api/get-components.
 *
 * Both useComponentsData (sidebar) and useComponentAutoLoad (editor)
 * hit the same endpoint. This utility ensures concurrent calls share
 * one in-flight request and supports cancellation on project switch.
 */
import type { ComponentGroup, SubProject } from '../../lib/component-scanner/types';
import { authFetch } from './authFetch';

export interface ComponentsAPIResponse {
  success: boolean;
  error?: string;
  atomGroups?: ComponentGroup[];
  compositeGroups?: ComponentGroup[];
  pageGroups?: ComponentGroup[];
  isMonorepo?: boolean;
  subProjects?: SubProject[];
}

let inflightPromise: Promise<ComponentsAPIResponse> | null = null;
let inflightProjectId: string | null = null;
let abortController: AbortController | null = null;

let cachedResult: ComponentsAPIResponse | null = null;
let cachedProjectId: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 2000;

/**
 * Fetch and parse /api/get-components. Deduplicates concurrent calls with a 2s TTL cache.
 *
 * The cache and in-flight dedup are keyed by `projectId` (HYP-227): on a project switch
 * the active project changes but `cancelComponentsFetch` is not always called (the editor
 * auto-load path only changes `activeProjectId`), so a project-agnostic cache would hand
 * the previous project's components to the new one within the TTL. Pass the active project
 * id (useProjectActivationStore.activatedProjectId) so a key change forces a re-fetch.
 */
export function fetchComponentsJSON(projectId: string | null): Promise<ComponentsAPIResponse> {
  if (cachedResult && cachedProjectId === projectId && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedResult);
  }

  if (inflightPromise && inflightProjectId === projectId) return inflightPromise;

  abortController = new AbortController();
  inflightProjectId = projectId;
  const thisPromise = authFetch('/api/get-components', { signal: abortController.signal })
    .then((res) => {
      if (!res.ok) {
        const status = res.statusText ? `HTTP ${res.status} ${res.statusText}` : `HTTP ${res.status}`;
        return { success: false, error: status };
      }
      return res
        .json()
        .then((json: ComponentsAPIResponse) => {
          if (json.success) {
            cachedResult = json;
            cachedProjectId = projectId;
            cachedAt = Date.now();
          }
          return json;
        })
        .catch(() => ({ success: false, error: 'Failed to parse components response as JSON' }));
    })
    // Network errors (DNS, timeout, etc.) propagate to callers — all consumers
    // (see JSDoc) catch AbortError separately and handle other errors. No catch here.
    .finally(() => {
      // Only clean up if this is still the active request —
      // a cancel→refetch sequence may have already replaced the handles.
      if (inflightPromise === thisPromise) {
        inflightPromise = null;
        inflightProjectId = null;
        abortController = null;
      }
    });

  inflightPromise = thisPromise;
  return thisPromise;
}

/** Cancel any in-flight request. Call before starting a new fetch on project switch. */
export function cancelComponentsFetch(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
    inflightPromise = null;
    inflightProjectId = null;
  }
  cachedResult = null;
  cachedProjectId = null;
  cachedAt = 0;
}
