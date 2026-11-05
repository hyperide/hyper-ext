import type { Runtime } from '../../runtime/src/core';

export interface DocumentSnapshot<T> {
  readonly document: T | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export interface DocumentPublication<T> {
  read(): T | null;
  getSnapshot(): DocumentSnapshot<T>;
  subscribe(listener: () => void): () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Runtime validates ownership and rejects asynchronous returned values. */
  apply<A>(command: (base: T, args: A) => unknown, args: A): boolean;
  transact(build: (base: T, expose: (working: unknown) => void) => unknown): boolean;
  replace(value: T | null): void;
  undo(): boolean;
  redo(): boolean;
  clear(): void;
  dispose(): void;
}
/** The supplied Runtime belongs to this publication and is disposed with it. */
export function createDocumentPublication<T>(
  runtime: Runtime,
  options: { initial: T; limit?: number },
): DocumentPublication<T>;
