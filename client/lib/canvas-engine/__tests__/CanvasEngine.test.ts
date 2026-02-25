/**
 * CanvasEngine integration tests
 *
 * Note: Tree operations (insert, update, delete, move, duplicate) were removed
 * as dead code. AST-based operations are tested separately.
 * Tests below cover engine initialization, component registration, and batch mode
 * fundamentals that don't depend on tree operations.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CanvasEngine } from "../core/CanvasEngine";
import type { ComponentDefinition } from "../models/types";

describe("CanvasEngine", () => {
  let engine: CanvasEngine;

  const buttonDef: ComponentDefinition = {
    type: "Button",
    label: "Button",
    fields: {
      text: { type: "text", label: "Text" },
      size: { type: "select", options: ["sm", "md", "lg"] },
    },
    defaultProps: { text: "Click me", size: "md" },
    render: () => null,
  };

  beforeEach(() => {
    engine = new CanvasEngine({ debug: false });
    engine.registerComponent(buttonDef);
  });

  describe("initialization", () => {
    it("should initialize with root instance", () => {
      const root = engine.getRoot();
      expect(root).toBeDefined();
      expect(root.type).toBe("root");
    });
  });

  describe("component registration", () => {
    it("should register component", () => {
      expect(engine.registry.has("Button")).toBe(true);
    });

    it("should unregister component", () => {
      engine.unregisterComponent("Button");
      expect(engine.registry.has("Button")).toBe(false);
    });
  });

  describe("batch mode", () => {
    it("should handle finalizeBatch without startBatch gracefully", () => {
      // Should not throw
      engine.finalizeBatch();
    });

    it("should always emit tree:change on finalize even without events", () => {
      const events: unknown[] = [];
      engine.events.on("tree:change", (payload) => events.push(payload));

      engine.startBatch();
      // No operations
      engine.finalizeBatch();

      // Should still emit tree:change to ensure UI sync
      expect(events.length).toBe(1);
    });
  });
});
