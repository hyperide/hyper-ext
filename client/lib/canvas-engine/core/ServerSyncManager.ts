/**
 * Server Sync Manager - synchronizes engine operations with server file system
 */

import type { ComponentInstance } from "../models/types";
import type { Operation } from "../operations/Operation";
import { authFetch } from "@/utils/authFetch";

export interface ServerSyncConfig {
  /**
   * Base URL for API calls (default: empty string for same origin)
   */
  baseUrl?: string;

  /**
   * Get file path for current component
   */
  getFilePath: () => string | null;

  /**
   * Callback when sync fails
   */
  onSyncError?: (error: Error, operation: Operation) => void;
}

/**
 * Manages synchronization between Canvas Engine and server file system
 */
export class ServerSyncManager {
  private config: ServerSyncConfig;
  private baseUrl: string;

  constructor(config: ServerSyncConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "";
  }

  /**
   * Sync insert operation to server
   */
  async syncInsert(
    instance: ComponentInstance,
    parentId: string
  ): Promise<void> {
    const filePath = this.config.getFilePath();
    if (!filePath) {
      throw new Error("No file path available for sync");
    }

    const response = await authFetch(`${this.baseUrl}/api/insert-element`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId,
        filePath,
        componentType: instance.type,
        props: instance.props,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to insert element on server");
    }
  }

  /**
   * Sync delete operation to server
   */
  async syncDelete(elementId: string): Promise<void> {
    const filePath = this.config.getFilePath();
    if (!filePath) {
      throw new Error("No file path available for sync");
    }

    const response = await authFetch(`${this.baseUrl}/api/delete-element`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId,
        filePath,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to delete element on server");
    }
  }

  /**
   * Sync update operation to server
   */
  async syncUpdate(
    elementId: string,
    props: Record<string, any>
  ): Promise<void> {
    const filePath = this.config.getFilePath();
    if (!filePath) {
      throw new Error("No file path available for sync");
    }

    // Update each prop individually (current API design)
    for (const [propName, propValue] of Object.entries(props)) {
      const response = await authFetch(`${this.baseUrl}/api/update-component-props`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedId: elementId,
          filePath,
          propName,
          propValue,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(
          result.error || `Failed to update prop ${propName} on server`
        );
      }
    }
  }

  /**
   * Sync undo/redo operation to server
   * This requires replaying operations or restoring snapshots
   */
  async syncUndoRedo(operations: Operation[]): Promise<void> {
    const filePath = this.config.getFilePath();
    if (!filePath) {
      throw new Error("No file path available for sync");
    }

    // TODO: Implement batch operation endpoint on server
    // For now, we'll need to reparse the file after each undo/redo
    // This is a temporary solution until we implement proper batch operations
    console.warn(
      "[ServerSyncManager] Undo/redo requires file reparse - implement batch endpoint for better performance"
    );
  }

  /**
   * Reparse file to sync engine state with server
   * Called after undo/redo to ensure consistency
   */
  async reparseFile(filePath: string): Promise<any> {
    const response = await authFetch(
      `${this.baseUrl}/api/parse-component?path=${encodeURIComponent(filePath)}&skipSampleDefault=true`
    );

    if (!response.ok) {
      throw new Error("Failed to reparse component file");
    }

    return response.json();
  }
}
