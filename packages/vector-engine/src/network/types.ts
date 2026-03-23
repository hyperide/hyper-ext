/**
 * @file Vector network types — graph-based path model (Figma-style)
 *
 * Accessed via: Pen tool in vector mode — the primary interactive editing model
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Vector Networks
 */

import type { FillStyle, Point } from '../types';

export interface VectorVertex {
  x: number;
  y: number;
  cornerRadius?: number;
  handleMirroring?: 'none' | 'angle' | 'angleAndLength';
}

export interface VectorSegment {
  start: number; // vertex index
  end: number; // vertex index
  tangentStart: Point; // bezier handle RELATIVE to start vertex (0,0 = straight)
  tangentEnd: Point; // bezier handle RELATIVE to end vertex
}

export interface VectorRegion {
  windingRule: 'evenOdd' | 'nonZero';
  loops: number[][]; // arrays of segment indices forming closed chains
  fills: FillStyle[];
}

export interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
}
