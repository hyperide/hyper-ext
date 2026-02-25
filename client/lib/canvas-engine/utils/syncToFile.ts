/**
 * Sync styles to file with debouncing
 */

import { authFetch } from '../../../utils/authFetch';

export interface StyleUpdate {
  selectedId: string;
  instanceId: string;
  filePath: string;
  styles: {
    position?: string;
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
    width?: string;
    height?: string;
    marginTop?: string;
    marginRight?: string;
    marginBottom?: string;
    marginLeft?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderRadius?: string;
    borderRadiusTopLeft?: string;
    borderRadiusTopRight?: string;
    borderRadiusBottomLeft?: string;
    borderRadiusBottomRight?: string;
    overflow?: string;
    display?: string;
    flexDirection?: string;
  };
}

export interface SyncResult {
  success: boolean;
  className?: string;
  error?: string;
}

/**
 * Create debounced sync function with guaranteed last update
 */
export function createDebouncedSync(delay = 300) {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastUpdate: StyleUpdate | null = null;
  let isProcessing = false;

  /**
   * Flush pending update immediately
   */
  const flush = async (): Promise<SyncResult | null> => {
    // Clear any pending timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Return early if no pending update or already processing
    if (!lastUpdate || isProcessing) {
      return null;
    }

    const updateToProcess = lastUpdate;
    lastUpdate = null;
    isProcessing = true;

    try {
      const response = await authFetch("/api/update-component-styles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateToProcess),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to sync styles:", error);
        return {
          success: false,
          error: error.error || "Unknown error",
        };
      }

      const result = await response.json();
      return result as SyncResult;
    } catch (error) {
      console.error("Error syncing styles:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      isProcessing = false;
    }
  };

  /**
   * Schedule sync with debounce
   */
  const sync = (update: StyleUpdate) => {
    // Merge styles if updating the same element
    if (lastUpdate &&
        lastUpdate.selectedId === update.selectedId &&
        lastUpdate.instanceId === update.instanceId &&
        lastUpdate.filePath === update.filePath) {
      // Merge styles
      lastUpdate = {
        ...lastUpdate,
        styles: {
          ...lastUpdate.styles,
          ...update.styles,
        },
      };
    } else {
      // Store the latest update
      lastUpdate = update;
    }

    // Clear previous timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Schedule new flush
    timeoutId = setTimeout(() => {
      flush();
    }, delay);
  };

  // Attach flush method to sync function
  sync.flush = flush;

  return sync;
}
