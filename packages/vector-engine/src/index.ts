/**
 * @file Vector Engine — public API
 *
 * Accessed via: Package entry point — public API surface for the vector editing mode
 */

export { fitCurve } from './curve/fit';
// SVG export
export { sceneToSvg } from './export/svg';
// Graph
export { GraphExecutor } from './graph/executor';
export { HistoryManager } from './graph/history';
export { type BuildSceneInput, buildScene } from './graph/scene-builder';
export { VectorGraphModel } from './graph/vector-graph';
// Import
export { type ImportedEdge, type ImportedNode, type ImportResult, svgToGraph } from './import/svg-import';
export { meshFromBounds } from './mesh/mesh-from-path';
export { tessellateMesh } from './mesh/tessellate';
// Mesh
export type { MeshHandle, MeshVertex, TessellatedMesh } from './mesh/types';
// Vector networks
export { networkToPaths, pathToNetwork } from './network/convert';
export { findRegions } from './network/topology';
export type { VectorNetwork, VectorRegion, VectorSegment, VectorVertex } from './network/types';
// Deformation nodes
export { puckerBloatNode } from './nodes/deformation/pucker-bloat';
export { roughenNode } from './nodes/deformation/roughen';
export { twistNode } from './nodes/deformation/twist';
export { warpNode } from './nodes/deformation/warp';
export { zigzagNode } from './nodes/deformation/zigzag';
// Generator nodes
export { arcNode } from './nodes/generators/arc';
export { arrowNode } from './nodes/generators/arrow';
export { ellipseNode } from './nodes/generators/ellipse';
export { lineNode } from './nodes/generators/line';
export { polygonNode } from './nodes/generators/polygon';
export { rectangleNode } from './nodes/generators/rectangle';
export { spiralNode } from './nodes/generators/spiral';
export { starNode } from './nodes/generators/star';
// Generator nodes (Plan 2)
export { svgPathNode } from './nodes/generators/svg-path';
// Path operation nodes
export { breakApartPaths, closeOpenNode, joinPathsNode, reversePathNode } from './nodes/path-ops/basic-ops';
export { createBooleanNodes } from './nodes/path-ops/boolean';
// Path op nodes (Plan 2)
export { chamferNode } from './nodes/path-ops/chamfer';
export { createDashNode } from './nodes/path-ops/dash-path';
export { enforceWindingNode } from './nodes/path-ops/enforce-winding';
export { createOffsetNode } from './nodes/path-ops/offset';
export { roundCornersNode } from './nodes/path-ops/round-corners';
export { smoothNode } from './nodes/path-ops/smooth';
export { createStrokeToPathNode } from './nodes/path-ops/stroke-to-path';
export { subdivideNode } from './nodes/path-ops/subdivide';
export { trimPathNode } from './nodes/path-ops/trim-path';
// Registry
export { createDefaultRegistry } from './nodes/register-all';
export { NodeRegistry } from './nodes/registry';
// Variable stroke
export { variableStrokeNode } from './nodes/stroke/variable-stroke';
// Structural nodes
export { alphaMaskNode } from './nodes/structural/alpha-mask';
export { groupNode } from './nodes/structural/group';
// Style nodes
export { blendModeNode } from './nodes/style/blend-mode';
// Style nodes (Plan 2)
export { blurNode } from './nodes/style/blur';
export { fillNode } from './nodes/style/fill';
export { opacityNode } from './nodes/style/opacity';
export { shadowNode } from './nodes/style/shadow';
export { strokeNode } from './nodes/style/stroke';
// Text
export { textToPathNode } from './nodes/text/text-to-path';
// Transform nodes
export { rotateNode } from './nodes/transform/rotate';
export { scaleNode } from './nodes/transform/scale';
export { skewNode } from './nodes/transform/skew';
export { translateNode } from './nodes/transform/translate';
// Path utilities
export { computeBounds } from './path/bounds';
export { PathBuilder } from './path/builder';
export {
  commandsToSvgD,
  decodeCommands,
  encodeCommands,
  PathCmd,
  type PathCommand,
  svgDToCommands,
} from './path/commands';
// Path utilities (Plan 2)
export { flattenPath } from './path/flatten';
export { type PointAtOffsetResult, pathArea, pathLength, pointAtOffset } from './path/geometry';
export { mergePaths } from './path/merge';
// Types
export type {
  BlendMode,
  BoundingBox,
  ExecutionResult,
  FillStyle,
  GradientStop,
  GraphDiff,
  GraphEdge,
  GraphNode,
  HistoryEntry,
  MeshValue,
  NodeCategory,
  NodeExecutionState,
  NodeExecutionStatus,
  NodeTypeDefinition,
  NodeValue,
  NodeValueType,
  ParamDefinition,
  ParamType,
  PathValue,
  Point,
  PortDefinition,
  SceneEntry,
  SceneGraph,
  SceneGroup,
  SceneItem,
  ShadowStyle,
  StrokeStyle,
  StyleValue,
  TerminalNodeOutput,
  TransformMatrix,
  VectorGraph,
  WidthPoint,
} from './types';
export { IDENTITY_TRANSFORM, isSceneGroup, isSceneItem } from './types';
