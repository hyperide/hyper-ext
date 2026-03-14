/**
 * @file Auto-registration of all built-in node types
 *
 * Accessed via: Engine initialization — called once to populate the registry with all 23 built-in node types
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Node Registry
 */

import type { PathOpsBackend } from 'vector-wasm';
import { MockPathOps } from 'vector-wasm';
import { arcNode } from './generators/arc';
import { arrowNode } from './generators/arrow';
import { ellipseNode } from './generators/ellipse';
import { lineNode } from './generators/line';
import { polygonNode } from './generators/polygon';
import { rectangleNode } from './generators/rectangle';
import { spiralNode } from './generators/spiral';
import { starNode } from './generators/star';
import { closeOpenNode, joinPathsNode, reversePathNode } from './path-ops/basic-ops';
import { createBooleanNodes } from './path-ops/boolean';
import { clipNode } from './path-ops/clip';
import { NodeRegistry } from './registry';
import { blendModeNode } from './style/blend-mode';
import { fillNode } from './style/fill';
import { opacityNode } from './style/opacity';
import { strokeNode } from './style/stroke';
import { rotateNode } from './transform/rotate';
import { scaleNode } from './transform/scale';
import { skewNode } from './transform/skew';
import { translateNode } from './transform/translate';

/**
 * Creates a registry with all built-in nodes.
 *
 * @param pathOps - Path operations backend. Defaults to MockPathOps
 *   (a no-op stub for testing). Pass a real PathOpsBackend in production.
 */
export function createDefaultRegistry(pathOps?: PathOpsBackend): NodeRegistry {
  const registry = new NodeRegistry();

  // Generators
  registry.register(rectangleNode);
  registry.register(ellipseNode);
  registry.register(polygonNode);
  registry.register(starNode);
  registry.register(lineNode);
  registry.register(arcNode);
  registry.register(spiralNode);
  registry.register(arrowNode);

  // Path ops (boolean nodes via factory)
  for (const boolNode of createBooleanNodes(pathOps ?? new MockPathOps())) {
    registry.register(boolNode);
  }
  registry.register(reversePathNode);
  registry.register(closeOpenNode);
  registry.register(joinPathsNode);
  registry.register(clipNode);

  // Style
  registry.register(fillNode);
  registry.register(strokeNode);
  registry.register(opacityNode);
  registry.register(blendModeNode);

  // Transform
  registry.register(translateNode);
  registry.register(rotateNode);
  registry.register(scaleNode);
  registry.register(skewNode);

  return registry;
}
