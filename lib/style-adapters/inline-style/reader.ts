/**
 * @file InlineStyleReader — derives inline style source identities from element style facts
 *
 * Accessed via: InlineStyleAdapter.reader when the inspector reads selected element style sources
 * Assumptions: per-property inline style ownership tracing is a later Phase 7 slice; this
 *   reader only exposes the style prop source tab used by write routing.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type { FrameworkReadResult, SourceClassIdentity } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class InlineStyleReader implements FrameworkStyleReader {
  /**
   * Read entry: expose the element's inline `style` prop as a single "Inline" source tab
   * when a style attribute is present. Confidence is `exact` for an object-literal style,
   * `probable` for any other expression form (spread/ref) where the prop set isn't statically
   * certain. Per-property inline ownership tracing is a later Phase 7 slice.
   */
  read(input: Parameters<FrameworkStyleReader['read']>[0]): FrameworkReadResult {
    const classIdentities: SourceClassIdentity[] = input.elementFacts.styleAttribute
      ? [
          {
            sourceTabId: 'inline-style:style',
            cssSystem: 'inline-style',
            sourceForm: 'scriptReactStyleRule',
            label: 'Inline',
            condition: { state: 'base' },
            confidence: input.elementFacts.styleAttribute.kind === 'object-literal' ? 'exact' : 'probable',
          },
        ]
      : [];

    return {
      sourceOwners: [],
      values: {},
      classIdentities,
      conditions: classIdentities.map((identity) => identity.condition),
    };
  }
}
