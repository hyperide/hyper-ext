/**
 * @file Renderer interface — abstraction over rendering backends
 *
 * Accessed via: Editor viewport — renders scene graph to canvas or SVG string
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Renderer
 */

import type { Point, SceneGraph } from '../types';

export interface HitResult {
  itemId: string;
  point: Point;
  hitType: 'fill' | 'stroke';
}

export interface VectorRenderer {
  render(scene: SceneGraph): string | undefined;
  hitTest(point: Point, scene: SceneGraph): HitResult | null;
  dispose(): void;
}
