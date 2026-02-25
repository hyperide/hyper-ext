/**
 * Serialization utilities for Canvas Engine
 */

import type { DocumentTree } from "../models/types";
import { documentTreeSchema } from "../models/validation";

const CURRENT_VERSION = 1;

export interface SerializedData {
  version: number;
  tree: DocumentTree;
  timestamp: number;
}

/**
 * Serialize document tree to JSON
 */
export function serialize(tree: DocumentTree): string {
  const data: SerializedData = {
    version: CURRENT_VERSION,
    tree,
    timestamp: Date.now(),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Deserialize JSON to document tree
 */
export function deserialize(json: string): DocumentTree {
  try {
    const data = JSON.parse(json) as SerializedData;

    // Validate version
    if (!data.version || data.version > CURRENT_VERSION) {
      throw new Error(
        `Unsupported version: ${data.version}. Current version: ${CURRENT_VERSION}`
      );
    }

    // Migrate if needed
    const migratedTree = migrate(data.tree, data.version, CURRENT_VERSION);

    // Validate tree structure
    const result = documentTreeSchema.safeParse(migratedTree);
    if (!result.success) {
      throw new Error(`Invalid tree structure: ${result.error.message}`);
    }

    return result.data as DocumentTree;
  } catch (error) {
    throw new Error(`Deserialization failed: ${(error as Error).message}`);
  }
}

/**
 * Migrate tree between versions
 */
function migrate(
  tree: DocumentTree,
  fromVersion: number,
  toVersion: number
): DocumentTree {
  let migratedTree = tree;

  // Add migration logic here as versions evolve
  // Example:
  // if (fromVersion === 1 && toVersion === 2) {
  //   migratedTree = migrateV1ToV2(migratedTree);
  // }

  return migratedTree;
}

/**
 * Export tree to downloadable file
 */
export function exportToFile(tree: DocumentTree, filename = "canvas-tree.json"): void {
  const json = serialize(tree);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Import tree from file
 */
export function importFromFile(file: File): Promise<DocumentTree> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const tree = deserialize(json);
        resolve(tree);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsText(file);
  });
}
