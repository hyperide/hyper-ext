/**
 * @file Vector WASM — public API
 *
 * Accessed via: import { PathOpsBackend, MockPathOps, CanvasKitPathOps, OffsetPathOps } from 'vector-wasm'
 */

export { CanvasKitPathOps, initCanvasKit } from './canvaskit-pathops';
export { type OffsetJoinType, OffsetPathOps, offsetPath } from './clipper-offset';
export { MockPathOps } from './mock-pathops';
export type { BooleanOp, PathOpsBackend } from './types';
