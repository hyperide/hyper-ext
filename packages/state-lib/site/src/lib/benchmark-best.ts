/** Rank only comparable recorded values. A highlighted median is not proof of statistical superiority. */
export function bestIndices(
  values: readonly (number | null | undefined)[],
  direction: 'min' | 'max' = 'min',
): number[] {
  const valid = values.flatMap((value, index) =>
    typeof value === 'number' && Number.isFinite(value) ? [{ value, index }] : [],
  );
  if (valid.length === 0) return [];
  const best =
    direction === 'min' ? Math.min(...valid.map((cell) => cell.value)) : Math.max(...valid.map((cell) => cell.value));
  return valid.filter((cell) => cell.value === best).map((cell) => cell.index);
}
