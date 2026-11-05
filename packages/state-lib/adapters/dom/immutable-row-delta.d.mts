export interface ImmutableRowChange<T, K extends string | number> {
  readonly key: K;
  readonly before: T;
  readonly after: T;
  readonly index: number;
}
/** null requires a full view reset; an empty array requires no changes. */
export function immutableRowDelta<T, K extends string | number>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (row: T) => K,
  accepts?: (before: T, after: T) => boolean,
): readonly ImmutableRowChange<T, K>[] | null;
