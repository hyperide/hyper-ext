/**
 * @file TailwindV4Reader — derives Tailwind source identities from element class facts
 *
 * Accessed via: TailwindV4Adapter.reader when the inspector reads selected element style sources
 * Assumptions: class-to-CSS property ownership tracing is a later Phase 7 slice; this
 *   reader only exposes the element class source tab used by write routing.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type { FrameworkReadResult, SourceClassIdentity } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class TailwindV4Reader implements FrameworkStyleReader {
  read(input: Parameters<FrameworkStyleReader['read']>[0]): FrameworkReadResult {
    const classNameExpression = input.elementFacts.classNameExpression;
    const classIdentities: SourceClassIdentity[] = classNameExpression
      ? [
          {
            sourceTabId: 'tailwind-v4:elementClass',
            cssSystem: 'tailwind-v4',
            sourceForm: 'elementClass',
            label: 'Tailwind',
            cssClass: classNameExpression.staticClasses.join(' '),
            condition: { state: 'base' },
            confidence: classNameExpression.dynamic ? 'probable' : 'exact',
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
