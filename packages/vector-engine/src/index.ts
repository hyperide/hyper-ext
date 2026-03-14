/**
 * @file Vector Engine — public API
 *
 * Accessed via: Package entry point — public API surface for the vector editing mode
 */

// SVG export
export { sceneToSvg } from './export/svg';
// Graph
export { GraphExecutor } from './graph/executor';
export { HistoryManager } from './graph/history';
export { type BuildSceneInput, buildScene } from './graph/scene-builder';
export { VectorGraphModel } from './graph/vector-graph';
// Generator nodes
export { arcNode } from './nodes/generators/arc';
export { arrowNode } from './nodes/generators/arrow';
export { ellipseNode } from './nodes/generators/ellipse';
export { lineNode } from './nodes/generators/line';
export { polygonNode } from './nodes/generators/polygon';
export { rectangleNode } from './nodes/generators/rectangle';
export { spiralNode } from './nodes/generators/spiral';
export { starNode } from './nodes/generators/star';
// Path operation nodes
export { breakApartPaths, closeOpenNode, joinPathsNode, reversePathNode } from './nodes/path-ops/basic-ops';
export { createBooleanNodes } from './nodes/path-ops/boolean';
// Registry
export { createDefaultRegistry } from './nodes/register-all';
export { NodeRegistry } from './nodes/registry';
// Style nodes
export { blendModeNode } from './nodes/style/blend-mode';
export { fillNode } from './nodes/style/fill';
export { opacityNode } from './nodes/style/opacity';
export { strokeNode } from './nodes/style/stroke';
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
} from './types';
export { IDENTITY_TRANSFORM, isSceneGroup, isSceneItem } from './types';
