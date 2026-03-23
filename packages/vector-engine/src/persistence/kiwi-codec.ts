/**
 * @file Binary codec for VectorGraphFile — compact serialization for .graph files
 *
 * Accessed via: File save/load — .graph files use binary format
 * Tradeoffs: params serialized as JSON strings inside binary (schema-free).
 *   ~30-50% smaller than JSON overall. Single-pass encode/decode.
 * Assumptions: all numeric values fit in float64, strings are valid UTF-8.
 *   GraphDiff kind set is exhaustive — unknown kinds throw on decode.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Persistence
 */

import type { GraphDiff, GraphEdge, GraphNode, Point } from '../types';
import type { GraphOperation, VectorGraphFile, VectorGraphMeta, VectorGraphState } from './types';

const MAGIC = new Uint8Array([0x56, 0x47, 0x52, 0x46]); // "VGRF"

const DIFF_KIND_PARAM_CHANGE = 0;
const DIFF_KIND_ADD_NODE = 1;
const DIFF_KIND_REMOVE_NODE = 2;
const DIFF_KIND_ADD_EDGE = 3;
const DIFF_KIND_REMOVE_EDGE = 4;
const DIFF_KIND_MUTE_NODE = 5;
const DIFF_KIND_MOVE_NODE = 6;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// -- Writer --

class BinaryWriter {
  private buf: number[] = [];

  writeVarint(n: number): void {
    let value = n >>> 0;
    while (value > 0x7f) {
      this.buf.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.buf.push(value & 0x7f);
  }

  writeFloat64(n: number): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n, true);
    for (let i = 0; i < 8; i++) {
      this.buf.push(view.getUint8(i));
    }
  }

  writeString(s: string): void {
    const encoded = textEncoder.encode(s);
    this.writeVarint(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
      this.buf.push(encoded[i]);
    }
  }

  writeBool(b: boolean): void {
    this.buf.push(b ? 1 : 0);
  }

  writeRaw(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      this.buf.push(bytes[i]);
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// -- Reader --

class BinaryReader {
  private offset = 0;

  constructor(private data: Uint8Array) {}

  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.offset >= this.data.length) {
        throw new Error('Unexpected end of binary data reading varint');
      }
      const byte = this.data[this.offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readFloat64(): number {
    if (this.offset + 8 > this.data.length) {
      throw new Error('Unexpected end of binary data reading float64');
    }
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  readString(): string {
    const length = this.readVarint();
    if (this.offset + length > this.data.length) {
      throw new Error('Unexpected end of binary data reading string');
    }
    const bytes = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return textDecoder.decode(bytes);
  }

  readBool(): boolean {
    if (this.offset >= this.data.length) {
      throw new Error('Unexpected end of binary data reading bool');
    }
    return this.data[this.offset++] !== 0;
  }

  expectBytes(expected: Uint8Array): void {
    for (let i = 0; i < expected.length; i++) {
      if (this.offset >= this.data.length || this.data[this.offset] !== expected[i]) {
        throw new Error('Invalid binary format: magic bytes mismatch');
      }
      this.offset++;
    }
  }
}

// -- Encode helpers --

function writeGraphNode(w: BinaryWriter, node: GraphNode): void {
  w.writeString(node.id);
  w.writeString(node.type);
  w.writeString(JSON.stringify(node.params));
  const { position } = node;
  w.writeBool(position !== undefined);
  if (position !== undefined) {
    w.writeFloat64(position.x);
    w.writeFloat64(position.y);
  }
}

function writeGraphEdge(w: BinaryWriter, edge: GraphEdge): void {
  w.writeString(edge.id);
  w.writeString(edge.source);
  w.writeString(edge.target);
  w.writeString(edge.sourcePort);
  w.writeString(edge.targetPort);
}

function writePoint(w: BinaryWriter, p: Point): void {
  w.writeFloat64(p.x);
  w.writeFloat64(p.y);
}

function writeDiff(w: BinaryWriter, diff: GraphDiff): void {
  switch (diff.kind) {
    case 'paramChange':
      w.writeVarint(DIFF_KIND_PARAM_CHANGE);
      w.writeString(diff.nodeId);
      w.writeString(diff.param);
      w.writeString(JSON.stringify(diff.oldValue));
      w.writeString(JSON.stringify(diff.newValue));
      break;
    case 'addNode':
      w.writeVarint(DIFF_KIND_ADD_NODE);
      writeGraphNode(w, diff.node);
      break;
    case 'removeNode':
      w.writeVarint(DIFF_KIND_REMOVE_NODE);
      writeGraphNode(w, diff.node);
      w.writeVarint(diff.removedEdges.length);
      for (const edge of diff.removedEdges) {
        writeGraphEdge(w, edge);
      }
      w.writeBool(diff.muted ?? false);
      break;
    case 'addEdge':
      w.writeVarint(DIFF_KIND_ADD_EDGE);
      writeGraphEdge(w, diff.edge);
      break;
    case 'removeEdge':
      w.writeVarint(DIFF_KIND_REMOVE_EDGE);
      writeGraphEdge(w, diff.edge);
      break;
    case 'muteNode':
      w.writeVarint(DIFF_KIND_MUTE_NODE);
      w.writeString(diff.nodeId);
      w.writeBool(diff.muted);
      break;
    case 'moveNode':
      w.writeVarint(DIFF_KIND_MOVE_NODE);
      w.writeString(diff.nodeId);
      writePoint(w, diff.oldPosition);
      writePoint(w, diff.newPosition);
      break;
  }
}

function writeMeta(w: BinaryWriter, meta: VectorGraphMeta): void {
  w.writeString(meta.componentPath);
  w.writeBool(meta.svgElementId !== undefined);
  if (meta.svgElementId !== undefined) {
    w.writeString(meta.svgElementId);
  }
  w.writeBool(meta.lastExportTimestamp !== undefined);
  if (meta.lastExportTimestamp !== undefined) {
    w.writeFloat64(meta.lastExportTimestamp);
  }
}

function writeState(w: BinaryWriter, state: VectorGraphState): void {
  w.writeFloat64(state.canvas.width);
  w.writeFloat64(state.canvas.height);

  const nodeEntries = Object.values(state.nodes);
  w.writeVarint(nodeEntries.length);
  for (const node of nodeEntries) {
    writeGraphNode(w, node);
  }

  w.writeVarint(state.edges.length);
  for (const edge of state.edges) {
    writeGraphEdge(w, edge);
  }

  w.writeVarint(state.muted.length);
  for (const id of state.muted) {
    w.writeString(id);
  }
}

function writeOperation(w: BinaryWriter, op: GraphOperation): void {
  w.writeFloat64(op.timestamp);
  w.writeString(op.description);
  w.writeVarint(op.diffs.length);
  for (const diff of op.diffs) {
    writeDiff(w, diff);
  }
}

// -- Decode helpers --

function readGraphNode(r: BinaryReader): GraphNode {
  const id = r.readString();
  const type = r.readString();
  const params = JSON.parse(r.readString()) as Record<string, unknown>;
  const hasPosition = r.readBool();
  const position = hasPosition ? { x: r.readFloat64(), y: r.readFloat64() } : undefined;
  return { id, type, params, ...(position !== undefined && { position }) };
}

function readGraphEdge(r: BinaryReader): GraphEdge {
  return {
    id: r.readString(),
    source: r.readString(),
    target: r.readString(),
    sourcePort: r.readString(),
    targetPort: r.readString(),
  };
}

function readPoint(r: BinaryReader): Point {
  return { x: r.readFloat64(), y: r.readFloat64() };
}

function readDiff(r: BinaryReader): GraphDiff {
  const kind = r.readVarint();
  switch (kind) {
    case DIFF_KIND_PARAM_CHANGE: {
      const nodeId = r.readString();
      const param = r.readString();
      const oldValue: unknown = JSON.parse(r.readString());
      const newValue: unknown = JSON.parse(r.readString());
      return { kind: 'paramChange', nodeId, param, oldValue, newValue };
    }
    case DIFF_KIND_ADD_NODE:
      return { kind: 'addNode', node: readGraphNode(r) };
    case DIFF_KIND_REMOVE_NODE: {
      const node = readGraphNode(r);
      const edgeCount = r.readVarint();
      const removedEdges: GraphEdge[] = [];
      for (let i = 0; i < edgeCount; i++) {
        removedEdges.push(readGraphEdge(r));
      }
      const muted = r.readBool();
      return { kind: 'removeNode', node, removedEdges, ...(muted && { muted }) };
    }
    case DIFF_KIND_ADD_EDGE:
      return { kind: 'addEdge', edge: readGraphEdge(r) };
    case DIFF_KIND_REMOVE_EDGE:
      return { kind: 'removeEdge', edge: readGraphEdge(r) };
    case DIFF_KIND_MUTE_NODE: {
      const nodeId = r.readString();
      const muted = r.readBool();
      return { kind: 'muteNode', nodeId, muted };
    }
    case DIFF_KIND_MOVE_NODE: {
      const nodeId = r.readString();
      const oldPosition = readPoint(r);
      const newPosition = readPoint(r);
      return { kind: 'moveNode', nodeId, oldPosition, newPosition };
    }
    default:
      throw new Error(`Unknown diff kind: ${kind}`);
  }
}

function readMeta(r: BinaryReader): VectorGraphMeta {
  const componentPath = r.readString();
  const hasSvgElementId = r.readBool();
  const svgElementId = hasSvgElementId ? r.readString() : undefined;
  const hasTimestamp = r.readBool();
  const lastExportTimestamp = hasTimestamp ? r.readFloat64() : undefined;
  return {
    componentPath,
    ...(svgElementId !== undefined && { svgElementId }),
    ...(lastExportTimestamp !== undefined && { lastExportTimestamp }),
  };
}

function readState(r: BinaryReader): VectorGraphState {
  const canvas = { width: r.readFloat64(), height: r.readFloat64() };

  const nodeCount = r.readVarint();
  const nodes: Record<string, GraphNode> = {};
  for (let i = 0; i < nodeCount; i++) {
    const node = readGraphNode(r);
    nodes[node.id] = node;
  }

  const edgeCount = r.readVarint();
  const edges: GraphEdge[] = [];
  for (let i = 0; i < edgeCount; i++) {
    edges.push(readGraphEdge(r));
  }

  const mutedCount = r.readVarint();
  const muted: string[] = [];
  for (let i = 0; i < mutedCount; i++) {
    muted.push(r.readString());
  }

  return { canvas, nodes, edges, muted };
}

function readOperation(r: BinaryReader): GraphOperation {
  const timestamp = r.readFloat64();
  const description = r.readString();
  const diffCount = r.readVarint();
  const diffs: GraphDiff[] = [];
  for (let i = 0; i < diffCount; i++) {
    diffs.push(readDiff(r));
  }
  return { timestamp, description, diffs };
}

// -- Public API --

export function encodeGraphFile(file: VectorGraphFile): Uint8Array {
  const w = new BinaryWriter();
  w.writeRaw(MAGIC);
  w.writeVarint(file.version);
  writeMeta(w, file.meta);
  writeState(w, file.base);
  w.writeVarint(file.operations.length);
  for (const op of file.operations) {
    writeOperation(w, op);
  }
  w.writeVarint(file.undoPointer);
  w.writeFloat64(file.viewport.zoom);
  w.writeFloat64(file.viewport.panX);
  w.writeFloat64(file.viewport.panY);
  return w.toUint8Array();
}

export function decodeGraphFile(data: Uint8Array): VectorGraphFile {
  const r = new BinaryReader(data);
  r.expectBytes(MAGIC);
  const version = r.readVarint();
  const meta = readMeta(r);
  const base = readState(r);
  const operationCount = r.readVarint();
  const operations: GraphOperation[] = [];
  for (let i = 0; i < operationCount; i++) {
    operations.push(readOperation(r));
  }
  const undoPointer = r.readVarint();
  const viewport = {
    zoom: r.readFloat64(),
    panX: r.readFloat64(),
    panY: r.readFloat64(),
  };
  return { version, meta, base, operations, undoPointer, viewport };
}
