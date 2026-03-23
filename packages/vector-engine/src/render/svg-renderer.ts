/**
 * @file SVG string renderer — headless renderer for server-side and export
 *
 * Accessed via: SVG export, server-side rendering, AI agent tools
 * Tradeoffs: no interactive features (no hover, no selection highlight).
 *   Hit testing uses flattened polyline approximation.
 */

import { sceneToSvg } from '../export/svg';
import { pointInPath, pointOnStroke } from '../path/hit-test';
import type { Point, SceneEntry, SceneGraph } from '../types';
import { isSceneGroup, isSceneItem } from '../types';
import type { HitResult, VectorRenderer } from './types';

export class SVGStringRenderer implements VectorRenderer {
  render(scene: SceneGraph): string {
    return sceneToSvg(scene);
  }

  hitTest(point: Point, scene: SceneGraph): HitResult | null {
    // Walk scene items back-to-front (last = topmost)
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const result = this.hitTestEntry(point, scene.items[i]);
      if (result) return result;
    }
    return null;
  }

  private hitTestEntry(point: Point, entry: SceneEntry): HitResult | null {
    if (!entry.visible) return null;

    if (isSceneGroup(entry)) {
      for (let i = entry.children.length - 1; i >= 0; i--) {
        const result = this.hitTestEntry(point, entry.children[i]);
        if (result) return result;
      }
      return null;
    }

    if (isSceneItem(entry)) {
      // Check fill first
      if (entry.style.fill && pointInPath(point, entry.path)) {
        return { itemId: entry.id, point, hitType: 'fill' };
      }
      // Check stroke
      const strokeWidth = entry.style.stroke?.width ?? 0;
      if (strokeWidth > 0 && pointOnStroke(point, entry.path, Math.max(strokeWidth / 2, 1.5))) {
        return { itemId: entry.id, point, hitType: 'stroke' };
      }
    }

    return null;
  }

  dispose(): void {
    // No-op for string renderer
  }
}
