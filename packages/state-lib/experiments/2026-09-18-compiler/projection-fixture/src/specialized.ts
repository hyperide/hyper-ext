/** Equivalent specialization for the statically declared two-field projection. */
export function project(input: Record<string, unknown>) {
  return { id: input.id, done: input.done };
}
