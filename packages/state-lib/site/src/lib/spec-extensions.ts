import normalized from '../../../docs/spec/normalized-views.md?raw';
import causal from '../../../docs/spec/ux-actions.md?raw';
import compiler from '../../../docs/spec/compiler-tooling.md?raw';
import binary from '../../../docs/spec/binary-interop.md?raw';
import operators from '../../../docs/spec/operator-algebra.md?raw';
import measurements from '../../../docs/spec/simd-measurements.md?raw';
import { composeSpec } from './spec-compose.mjs';
/** Canonical modules are inserted into relevant chapters; the old mirror stays unchanged. */
export function extendSpec(source: string): string {
  return composeSpec(source, [
    [5, `${normalized}\n\n${causal}`],
    [6, compiler],
    [9, `${binary}\n\n${operators}`],
    [14, measurements],
  ]);
}
