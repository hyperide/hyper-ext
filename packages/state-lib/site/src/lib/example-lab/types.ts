export type VariantId = 'reference' | 'compiled';
export type OperationId = 'point' | 'dense' | 'sparse' | 'move' | 'history';
export interface Mechanism {
  id: string;
  title: string;
  href: string;
  affects: string[];
}
export interface ExampleMetadata {
  id: string;
  title: string;
  summary: string;
  origin: string;
  mechanisms: Mechanism[];
  operations: OperationId[];
}
export interface ExampleProject extends ExampleMetadata {
  files: Record<string, string>;
  entry: string;
  config: Record<string, unknown>;
  editable: string[];
  defaultFile: string;
  sourceRevision: string;
}
export interface BuildArtifact {
  code: string;
  readableCode: string;
  rawBytes: number;
  gzipBytes: number;
  inputs: string[];
}
export interface ExampleBuild {
  example: ExampleMetadata;
  sourceHash: string;
  sourceRevision: string;
  artifacts: Record<VariantId, BuildArtifact>;
  generatedFiles: Record<string, string>;
  compileMs: number;
  files: Record<string, string>;
}
export interface RunSettings {
  count: number;
  operation: OperationId;
  samples: number;
  historyLimit: number;
  includeSetup: boolean;
}
export interface RunRow {
  variant: VariantId;
  samplesMs: number[];
  medianMs: number;
  p95Ms: number;
  iterations: number;
  totalMs: number;
  checksum: string;
}
export interface PreviewRow {
  index: number;
  id: string;
  text: string;
  done: boolean;
}
export interface PreviewState {
  title: string;
  columns: Array<{ id: string; title: string; count: number; items: PreviewRow[] }>;
  total: number;
  canUndo: boolean;
  canRedo: boolean;
}
export interface BenchmarkResult {
  version: 1;
  exampleId: string;
  sourceHash: string;
  sourceRevision: string;
  settings: RunSettings;
  rows: RunRow[];
  equivalent: boolean;
  environment: { engine: string; engineVersion: string; platform: string; timerResolutionMs: number };
  createdAt: string;
}
export interface PreviewAction {
  operation: OperationId | 'undo' | 'redo';
  index?: number;
  text?: string;
}
export const VARIANT_LABELS: Record<VariantId, string> = { reference: 'Runtime commands', compiled: 'Compiled state' };
