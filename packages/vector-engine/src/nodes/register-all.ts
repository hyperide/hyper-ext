/**
 * @file Auto-registration of all built-in node types
 *
 * Accessed via: Engine initialization — called once to populate the registry with all 53 built-in node types
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Node Registry
 */

import type { PathOpsBackend } from 'vector-wasm';
import { MockPathOps } from 'vector-wasm';
import { envelopeDistortNode } from './deformation/envelope-distort';
import { puckerBloatNode } from './deformation/pucker-bloat';
import { roughenNode } from './deformation/roughen';
import { twistNode } from './deformation/twist';
import { warpNode } from './deformation/warp';
import { zigzagNode } from './deformation/zigzag';
import { arcNode } from './generators/arc';
import { arrowNode } from './generators/arrow';
import { ellipseNode } from './generators/ellipse';
import { lineNode } from './generators/line';
import { polygonNode } from './generators/polygon';
import { rectangleNode } from './generators/rectangle';
import { spiralNode } from './generators/spiral';
import { starNode } from './generators/star';
import { svgPathNode } from './generators/svg-path';
import { gradientMeshNode } from './mesh/gradient-mesh';
import { meshFromPathNode } from './mesh/mesh-from-path-node';
import { addPointNode } from './path-ops/add-point';
import { closeOpenNode, joinPathsNode, reversePathNode } from './path-ops/basic-ops';
import { createBooleanNodes } from './path-ops/boolean';
import { chamferNode } from './path-ops/chamfer';
import { clipNode } from './path-ops/clip';
import { convertPointNode } from './path-ops/convert-point';
import { createDashNode } from './path-ops/dash-path';
import { enforceWindingNode } from './path-ops/enforce-winding';
import { createOffsetNode } from './path-ops/offset';
import { removePointNode } from './path-ops/remove-point';
import { roundCornersNode } from './path-ops/round-corners';
import { createSimplifyNode } from './path-ops/simplify';
import { smoothNode } from './path-ops/smooth';
import { splitPathNode } from './path-ops/split-path';
import { createStrokeToPathNode } from './path-ops/stroke-to-path';
import { subdivideNode } from './path-ops/subdivide';
import { trimPathNode } from './path-ops/trim-path';
import { NodeRegistry } from './registry';
import { variableStrokeNode } from './stroke/variable-stroke';
import { alphaMaskNode } from './structural/alpha-mask';
import { groupNode } from './structural/group';
import { blendModeNode } from './style/blend-mode';
import { blurNode } from './style/blur';
import { fillNode } from './style/fill';
import { opacityNode } from './style/opacity';
import { shadowNode } from './style/shadow';
import { strokeNode } from './style/stroke';
import { textOnPathNode } from './text/text-on-path';
import { textToPathNode } from './text/text-to-path';
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

  // Generators (Plan 2)
  registry.register(svgPathNode);

  // Structural
  registry.register(groupNode);
  registry.register(alphaMaskNode);

  // Style (Plan 2)
  registry.register(shadowNode);
  registry.register(blurNode);

  // Path ops (Plan 2 — direct)
  registry.register(roundCornersNode);
  registry.register(chamferNode);
  registry.register(smoothNode);
  registry.register(subdivideNode);
  registry.register(trimPathNode);
  registry.register(enforceWindingNode);

  // Path ops (Plan 2 — factory, needs backend)
  registry.register(createOffsetNode(pathOps ?? new MockPathOps()));
  registry.register(createStrokeToPathNode(pathOps ?? new MockPathOps()));
  registry.register(createDashNode(pathOps ?? new MockPathOps()));
  registry.register(createSimplifyNode(pathOps ?? new MockPathOps()));

  // Deformation
  registry.register(roughenNode);
  registry.register(zigzagNode);
  registry.register(puckerBloatNode);
  registry.register(twistNode);
  registry.register(warpNode);

  // Variable stroke
  registry.register(variableStrokeNode);

  // Text
  registry.register(textToPathNode);
  registry.register(textOnPathNode);

  // Mesh nodes (Plan 2b)
  registry.register(gradientMeshNode);
  registry.register(meshFromPathNode);

  // Envelope distort (Plan 2b)
  registry.register(envelopeDistortNode);

  // Path ops (Plan 3)
  registry.register(addPointNode);
  registry.register(removePointNode);
  registry.register(convertPointNode);
  registry.register(splitPathNode);

  return registry;
}
