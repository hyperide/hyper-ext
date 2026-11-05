/** Experimental JSON ownership boundary. Shape, scalar values and paths are checked at runtime. */
export type JsonPath = readonly (string | number)[];
export interface JsonDraft<T> {
  readonly draft: T;
  readonly strategy: 'copy' | 'cow';
  finish(): T;
  abort(): void;
  readonly copiedContainers?: number;
}
export function ownJson<T>(value: T): T;
export function beginJsonDraft<T>(base: T): JsonDraft<T>;
export function beginCopiedJson<T>(base: T): JsonDraft<T>;
export function isOwnedJsonSnapshot(value: unknown): boolean;
export function copyJsonArrayForCommand<T>(value: readonly T[]): T[];
export function copyJsonRoot<T>(base: T): T;
export function setJsonScalar<T>(base: T, path: JsonPath, value: unknown): T;
export function toggleJsonScalar<T>(base: T, path: JsonPath): T;
export function setJsonEach<T>(base: T, path: JsonPath, field: string, value: unknown, stride?: number): T;
export function setJsonGroups<T>(
  base: T,
  path: JsonPath,
  items: string,
  field: string,
  value: unknown,
  stride?: number,
): T;
export function moveJsonItem<T>(base: T, from: JsonPath, fromIndex: number, to: JsonPath, toIndex: number): T;
export interface JsonCommand<T> {
  readonly strategy: 'copy' | 'builder';
  readonly copiedContainers: number;
  set(path: JsonPath, value: unknown): void;
  toggle(path: JsonPath): void;
  assignEach(path: JsonPath, field: string, value: unknown, stride?: number): void;
  assignGroups(path: JsonPath, items: string, field: string, value: unknown, stride?: number): void;
  move(from: JsonPath, fromIndex: number, to: JsonPath, toIndex: number): void;
  finish(): T;
  abort(): void;
}
export function beginJsonCommand<T>(base: T): JsonCommand<T>;
export function defineJsonCommand<T, A>(
  execute: (command: JsonCommand<T>, args: A) => unknown,
): (base: T, args: A) => T;
