/**
 * @file Core type system for the vector engine
 *
 * Accessed via: Internal module — foundation types consumed by all vector engine layers
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Core Type System
 */

// -- Primitives --

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine transform matrix [a, b, c, d, e, f] */
export type TransformMatrix = [number, number, number, number, number, number];

/** Identity transform */
export const IDENTITY_TRANSFORM: TransformMatrix = [1, 0, 0, 1, 0, 0];

// -- Path --

export interface PathValue {
  /** SVG path commands encoded as Float64Array for WASM interop */
  commands: Float64Array;
  /** Bounding box (computed lazily, cached) */
  bounds?: BoundingBox;
  /** Whether the path is closed */
  closed: boolean;
}

// -- Style --

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'colorDodge'
  | 'colorBurn'
  | 'hardLight'
  | 'softLight'
  | 'difference'
  | 'exclusion';

export interface GradientStop {
  offset: number;
  color: string;
}

export type FillStyle =
  | { type: 'solid'; color: string }
  | { type: 'linearGradient'; stops: GradientStop[]; from: Point; to: Point }
  | { type: 'radialGradient'; stops: GradientStop[]; center: Point; radius: number }
  | { type: 'conicGradient'; stops: GradientStop[]; center: Point };

export interface StrokeStyle {
  color: string;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dashArray?: number[];
  dashOffset?: number;
}

export interface ShadowStyle {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface StyleValue {
  fill?: FillStyle;
  stroke?: StrokeStyle;
  opacity?: number;
  blendMode?: BlendMode;
  shadow?: ShadowStyle;
  blur?: number;
}

export interface WidthPoint {
  offset: number; // 0..1 along path length
  width: number; // stroke width at this point
  taper?: 'sharp' | 'round'; // endpoint taper style
}

// -- Vector Network --

import type { VectorNetwork } from './network/types';

export type { VectorNetwork, VectorRegion, VectorSegment, VectorVertex } from './network/types';

// -- Gradient Mesh --

export interface MeshVertex {
  position: Point;
  color: string;
  opacity?: number;
}

export interface MeshHandle {
  cp1: Point;
  cp2: Point;
}

/** Bicubic gradient mesh: (rows+1) × (cols+1) control points */
export interface MeshValue {
  rows: number;
  cols: number;
  /** Control points in row-major order: (rows+1) × (cols+1) entries */
  vertices: MeshVertex[];
  handles: MeshHandle[];
}

// -- Node value (discriminated union) --

export type NodeValue =
  | { type: 'path'; value: PathValue }
  | { type: 'style'; value: StyleValue }
  | { type: 'number'; value: number }
  | { type: 'color'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'transform'; value: TransformMatrix }
  | { type: 'mesh'; value: MeshValue }
  | { type: 'network'; value: VectorNetwork };

export type NodeValueType = NodeValue['type'];

// -- Graph --

export type ParamType = 'number' | 'string' | 'color' | 'boolean' | 'enum' | 'point' | 'gradient' | 'json';

export interface ParamDefinition {
  name: string;
  type: ParamType;
  default: unknown;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface PortDefinition {
  name: string;
  type: NodeValueType;
  multiple?: boolean;
}

export type NodeCategory = 'generator' | 'pathOp' | 'style' | 'transform' | 'utility';

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinition[];
  execute(
    inputs: Record<string, NodeValue | NodeValue[]>,
    params: Record<string, unknown>,
  ): Record<string, NodeValue | NodeValue[]>;
}

export interface GraphNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position?: Point;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
}

export interface VectorGraph {
  version: number;
  id: string;
  name: string;
  canvas: { width: number; height: number };
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  muted: string[];
  viewport: { zoom: number; panX: number; panY: number };
}

// -- Scene Graph --

export interface SceneItem {
  id: string;
  path: PathValue;
  style: StyleValue;
  transform: TransformMatrix;
  clipPath?: PathValue;
  visible: boolean;
  name?: string;
}

export interface SceneGroup {
  id: string;
  children: SceneEntry[];
  transform: TransformMatrix;
  opacity?: number;
  clipPath?: PathValue;
  visible: boolean;
  name?: string;
}

export type SceneEntry = SceneItem | SceneGroup;

export interface SceneGraph {
  items: SceneEntry[];
  canvas: { x?: number; y?: number; width: number; height: number };
  background?: string;
}

// -- Execution --

export type NodeExecutionState = 'ok' | 'error' | 'skipped' | 'cached';

export interface NodeExecutionStatus {
  state: NodeExecutionState;
  error?: string;
  executionTimeMs?: number;
}

export interface ExecutionResult {
  scene: SceneGraph;
  nodeStatus: Record<string, NodeExecutionStatus>;
  executionTimeMs: number;
}

// -- History --

export type GraphDiff =
  | { kind: 'paramChange'; nodeId: string; param: string; oldValue: unknown; newValue: unknown }
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'removeNode'; node: GraphNode; removedEdges: GraphEdge[]; muted?: boolean }
  | { kind: 'addEdge'; edge: GraphEdge }
  | { kind: 'removeEdge'; edge: GraphEdge }
  | { kind: 'muteNode'; nodeId: string; muted: boolean }
  | { kind: 'moveNode'; nodeId: string; oldPosition: Point; newPosition: Point };

export interface HistoryEntry {
  timestamp: number;
  description: string;
  diffs: GraphDiff[];
}

// -- Type guards --

export function isSceneGroup(entry: SceneEntry): entry is SceneGroup {
  return 'children' in entry;
}

export function isSceneItem(entry: SceneEntry): entry is SceneItem {
  return 'path' in entry;
}

// -- Scene builder input --

export interface TerminalNodeOutput {
  id: string;
  name?: string;
  path: PathValue;
  style: StyleValue;
  transform: TransformMatrix;
  clipPath?: PathValue;
  visible: boolean;
}
