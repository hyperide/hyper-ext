/**
 * @file Arrow generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Arrow
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Arrow shape: rectangular shaft + triangular arrowhead, pointing right (+X).
 * Shaft width = headWidth / 3. Origin at left-center of the shaft.
 *
 * 7 vertices (clockwise from bottom-left of shaft):
 *   0: shaft bottom-left
 *   1: shaft top-left
 *   2: head bottom-left (where shaft meets triangle base)
 *   3: head tip (rightmost point)
 *   4: head bottom-right (mirror of 2)
 *   5: shaft top-right (mirror of 1... wait, this is head top-right)
 *   6: shaft bottom-right (mirror of 0)
 *
 * Layout (left→right):
 *   shaftLength = length - headLength
 *   shaftHalf   = headWidth / 6   (headWidth/3 total)
 *   headHalf    = headWidth / 2
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

export const arrowNode: NodeTypeDefinition = {
  type: 'arrow',
  label: 'Arrow',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'length', type: 'number', default: 100, min: 0 },
    { name: 'headWidth', type: 'number', default: 30, min: 0 },
    { name: 'headLength', type: 'number', default: 20, min: 0 },
  ],
  execute(_inputs, params) {
    const { length, headWidth, headLength } = params as {
      length: number;
      headWidth: number;
      headLength: number;
    };

    const shaftLength = Math.max(0, length - headLength);
    const shaftHalf = headWidth / 6;
    const headHalf = headWidth / 2;

    const path = new PathBuilder()
      .moveTo(0, shaftHalf) // shaft bottom-left
      .lineTo(0, -shaftHalf) // shaft top-left
      .lineTo(shaftLength, -shaftHalf) // shaft top-right
      .lineTo(shaftLength, -headHalf) // head bottom-left (triangle base top)
      .lineTo(length, 0) // head tip
      .lineTo(shaftLength, headHalf) // head bottom-right (triangle base bottom)
      .lineTo(shaftLength, shaftHalf) // shaft bottom-right
      .close()
      .build();

    return { path: { type: 'path', value: path } };
  },
};
