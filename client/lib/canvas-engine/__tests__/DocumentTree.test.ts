/**
 * DocumentTree unit tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { DocumentTree } from "../core/DocumentTree";

describe("DocumentTree", () => {
  let tree: DocumentTree;

  beforeEach(() => {
    tree = new DocumentTree();
  });

  describe("initialization", () => {
    it("should create root instance", () => {
      const root = tree.getRoot();
      expect(root).toBeDefined();
      expect(root.type).toBe("root");
      expect(root.parentId).toBeNull();
      expect(root.children).toEqual([]);
    });

    it("should have root ID", () => {
      const rootId = tree.getRootId();
      expect(rootId).toBeDefined();
      expect(typeof rootId).toBe("string");
    });
  });

  describe("insert", () => {
    it("should insert instance as root child", () => {
      const instance = tree.insert("Button", { text: "Click me" });

      expect(instance).toBeDefined();
      expect(instance.type).toBe("Button");
      expect(instance.props).toEqual({ text: "Click me" });
      expect(instance.parentId).toBe(tree.getRootId());

      const root = tree.getRoot();
      expect(root.children).toContain(instance.id);
    });

    it("should insert instance with specific parent", () => {
      const parent = tree.insert("Container", {});
      const child = tree.insert("Button", { text: "Click me" }, parent.id);

      expect(child.parentId).toBe(parent.id);

      const parentInstance = tree.getInstance(parent.id);
      expect(parentInstance?.children).toContain(child.id);
    });

    it("should insert instance at specific index", () => {
      const child1 = tree.insert("Button", { text: "1" });
      const child2 = tree.insert("Button", { text: "2" });
      const child3 = tree.insert("Button", { text: "3" }, null, 1);

      const root = tree.getRoot();
      expect(root.children[0]).toBe(child1.id);
      expect(root.children[1]).toBe(child3.id);
      expect(root.children[2]).toBe(child2.id);
    });

    it("should throw error if parent not found", () => {
      expect(() => {
        tree.insert("Button", {}, "non-existent-id");
      }).toThrow();
    });
  });

  describe("update", () => {
    it("should update instance props", () => {
      const instance = tree.insert("Button", { text: "Old" });
      tree.update(instance.id, { text: "New" });

      const updated = tree.getInstance(instance.id);
      expect(updated?.props.text).toBe("New");
    });

    it("should merge props", () => {
      const instance = tree.insert("Button", { text: "Click", size: "md" });
      tree.update(instance.id, { text: "Press" });

      const updated = tree.getInstance(instance.id);
      expect(updated?.props).toEqual({ text: "Press", size: "md" });
    });

    it("should throw error if instance not found", () => {
      expect(() => {
        tree.update("non-existent-id", { text: "New" });
      }).toThrow();
    });
  });

  describe("delete", () => {
    it("should delete instance", () => {
      const instance = tree.insert("Button", {});
      tree.delete(instance.id);

      expect(tree.getInstance(instance.id)).toBeUndefined();
    });

    it("should remove instance from parent's children", () => {
      const instance = tree.insert("Button", {});
      tree.delete(instance.id);

      const root = tree.getRoot();
      expect(root.children).not.toContain(instance.id);
    });

    it("should delete descendants", () => {
      const parent = tree.insert("Container", {});
      const child1 = tree.insert("Button", {}, parent.id);
      const child2 = tree.insert("Input", {}, parent.id);

      tree.delete(parent.id);

      expect(tree.getInstance(parent.id)).toBeUndefined();
      expect(tree.getInstance(child1.id)).toBeUndefined();
      expect(tree.getInstance(child2.id)).toBeUndefined();
    });

    it("should throw error if deleting root", () => {
      expect(() => {
        tree.delete(tree.getRootId());
      }).toThrow("Cannot delete root");
    });
  });

  describe("move", () => {
    it("should move instance to new parent", () => {
      const parent1 = tree.insert("Container", {});
      const parent2 = tree.insert("Container", {});
      const child = tree.insert("Button", {}, parent1.id);

      tree.move(child.id, parent2.id);

      const movedChild = tree.getInstance(child.id);
      expect(movedChild?.parentId).toBe(parent2.id);

      const oldParent = tree.getInstance(parent1.id);
      expect(oldParent?.children).not.toContain(child.id);

      const newParent = tree.getInstance(parent2.id);
      expect(newParent?.children).toContain(child.id);
    });

    it("should move instance to specific index", () => {
      const parent = tree.insert("Container", {});
      const child1 = tree.insert("Button", {}, parent.id);
      const child2 = tree.insert("Button", {}, parent.id);
      const child3 = tree.insert("Button", {}, parent.id);

      tree.move(child3.id, parent.id, 0);

      const updatedParent = tree.getInstance(parent.id);
      expect(updatedParent?.children[0]).toBe(child3.id);
      expect(updatedParent?.children[1]).toBe(child1.id);
      expect(updatedParent?.children[2]).toBe(child2.id);
    });

    it("should prevent circular reference", () => {
      const parent = tree.insert("Container", {});
      const child = tree.insert("Container", {}, parent.id);

      expect(() => {
        tree.move(parent.id, child.id);
      }).toThrow("Cannot move instance to its own descendant");
    });

    it("should throw error if moving root", () => {
      expect(() => {
        tree.move(tree.getRootId(), null);
      }).toThrow("Cannot move root");
    });
  });

  describe("clone", () => {
    it("should clone instance", () => {
      const original = tree.insert("Button", { text: "Original" });
      const clone = tree.clone(original.id);

      expect(clone.id).not.toBe(original.id);
      expect(clone.type).toBe(original.type);
      expect(clone.props).toEqual(original.props);
    });

    it("should clone children recursively", () => {
      const parent = tree.insert("Container", {});
      const child1 = tree.insert("Button", {}, parent.id);
      const child2 = tree.insert("Input", {}, parent.id);

      const clone = tree.clone(parent.id);

      const clonedChildren = tree.getChildren(clone.id);
      expect(clonedChildren).toHaveLength(2);
      expect(clonedChildren[0].type).toBe("Button");
      expect(clonedChildren[1].type).toBe("Input");
    });
  });

  describe("tree traversal", () => {
    it("should get children", () => {
      const parent = tree.insert("Container", {});
      const child1 = tree.insert("Button", {}, parent.id);
      const child2 = tree.insert("Input", {}, parent.id);

      const children = tree.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toEqual([child1.id, child2.id]);
    });

    it("should get parent", () => {
      const parent = tree.insert("Container", {});
      const child = tree.insert("Button", {}, parent.id);

      const foundParent = tree.getParent(child.id);
      expect(foundParent?.id).toBe(parent.id);
    });

    it("should get ancestors", () => {
      const grandParent = tree.insert("Container", {});
      const parent = tree.insert("Container", {}, grandParent.id);
      const child = tree.insert("Button", {}, parent.id);

      const ancestors = tree.getAncestors(child.id);
      expect(ancestors).toHaveLength(3); // parent, grandParent, root
      expect(ancestors[0].id).toBe(parent.id);
      expect(ancestors[1].id).toBe(grandParent.id);
      expect(ancestors[2].id).toBe(tree.getRootId());
    });

    it("should get descendants", () => {
      const parent = tree.insert("Container", {});
      const child1 = tree.insert("Button", {}, parent.id);
      const grandChild1 = tree.insert("Input", {}, child1.id);
      const child2 = tree.insert("Button", {}, parent.id);

      const descendants = tree.getDescendants(parent.id);
      expect(descendants).toHaveLength(3);
    });
  });

  describe("serialization", () => {
    it("should create snapshot", () => {
      const instance1 = tree.insert("Button", {});
      const instance2 = tree.insert("Input", {});

      const snapshot = tree.toSnapshot();

      expect(snapshot.rootId).toBe(tree.getRootId());
      expect(snapshot.instances).toBeDefined();
      expect(Object.keys(snapshot.instances)).toHaveLength(3); // root + 2 instances
      expect(snapshot.version).toBeGreaterThan(0);
    });
  });
});
