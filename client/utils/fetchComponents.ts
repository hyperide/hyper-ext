/**
 * Shared deduplicating fetch for /api/get-components.
 *
 * Both useComponentsData (sidebar) and useComponentAutoLoad (editor)
 * hit the same endpoint. This utility ensures concurrent calls share
 * one in-flight request and supports cancellation on project switch.
 */
import type { ComponentGroup } from '../../lib/component-scanner/types';
import { authFetch } from './authFetch';

export interface ComponentsAPIResponse {
  success: boolean;
  error?: string;
  atomGroups?: ComponentGroup[];
  compositeGroups?: ComponentGroup[];
  pageGroups?: ComponentGroup[];
}

let inflightPromise: Promise<ComponentsAPIResponse> | null = null;
let abortController: AbortController | null = null;

let cachedResult: ComponentsAPIResponse | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 2000;

/** Fetch and parse /api/get-components. Deduplicates concurrent calls with a 2s TTL cache. */
export function fetchComponentsJSON(): Promise<ComponentsAPIResponse> {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return Promise.resolve(cachedResult);
  }

  if (inflightPromise) return inflightPromise;

  abortController = new AbortController();
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
            cachedAt = Date.now();
          }
          return json;
        })
        .catch(() => ({ success: false, error: 'Failed to parse components response as JSON' }));
    })
    // Network errors (DNS, timeout, etc.) propagate to callers — useComponentsData
    // catches AbortError separately and logs everything else. No catch needed here.
    .finally(() => {
      // Only clean up if this is still the active request —
      // a cancel→refetch sequence may have already replaced the handles.
      if (inflightPromise === thisPromise) {
        inflightPromise = null;
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
  }
  cachedResult = null;
  cachedAt = 0;
}
