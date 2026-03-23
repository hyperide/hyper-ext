/**
 * @file SVG path literal generator — raw d-attribute paths for SVG import
 *
 * Accessed via: SVG import pipeline — created for <path d="..."> elements
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 */

import { svgDToCommands } from '../../path/commands';
import type { NodeTypeDefinition } from '../../types';

export const svgPathNode: NodeTypeDefinition = {
  type: 'svgPath',
  label: 'SVG Path',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'd', type: 'string', default: '' }],
  execute(_inputs, params) {
    const d = params.d as string;
    if (!d) return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    const commands = svgDToCommands(d);
    const closed = d.toUpperCase().includes('Z');
    return { path: { type: 'path', value: { commands, closed } } };
  },
};
