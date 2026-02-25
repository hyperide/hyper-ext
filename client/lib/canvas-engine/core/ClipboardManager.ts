/**
 * Clipboard Manager - manages copy/paste operations
 */

import type { DocumentTree } from "./DocumentTree";
import type { ComponentInstance } from "../models/types";

/**
 * Clipboard manager for copy/paste functionality
 */
export class ClipboardManager {
  private clipboard: ComponentInstance | null = null;

  /**
   * Copy instance to clipboard
   */
  copy(tree: DocumentTree, id: string): boolean {
    const instance = tree.getInstance(id);
    if (!instance) {
      return false;
    }

    // Deep clone for clipboard
    this.clipboard = JSON.parse(JSON.stringify(instance));
    return true;
  }

  /**
   * Paste instance from clipboard
   */
  paste(tree: DocumentTree, parentId: string | null = null): string | null {
    if (!this.clipboard) {
      return null;
    }

    try {
      // Clone the clipboard instance
      const clone = tree.insert(
        this.clipboard.type,
        { ...this.clipboard.props },
        parentId
      );

      // Clone children recursively if they exist
      if (this.clipboard.children && this.clipboard.children.length > 0) {
        // Note: This is simplified - in real implementation,
        // we'd need to reconstruct the full tree structure
        // For now, just paste the instance without children
      }

      return clone.id;
    } catch (error) {
      console.error("Paste failed:", error);
      return null;
    }
  }

  /**
   * Check if clipboard has content
   */
  hasContent(): boolean {
    return this.clipboard !== null;
  }

  /**
   * Get clipboard content type
   */
  getContentType(): string | null {
    return this.clipboard?.type ?? null;
  }

  /**
   * Clear clipboard
   */
  clear(): void {
    this.clipboard = null;
  }
}
