const fields = ['id', 'done'] as const;
/** Generic uncompiled own-property projection, retaining getter evaluation order. */
export function project(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const field of fields)
    Object.defineProperty(output, field, {
      value: input[field],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return output;
}
