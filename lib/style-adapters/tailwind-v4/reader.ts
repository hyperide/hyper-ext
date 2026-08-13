/**
 * @file TailwindV4Reader — derives Tailwind source identities from element class facts
 *
 * Accessed via: TailwindV4Adapter.reader when the inspector reads selected element style sources
 * Assumptions: class-to-CSS property ownership tracing is a later Phase 7 slice; this
 *   reader only exposes the element class source tab used by write routing.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type {
  ClassConfidence,
  ClassNameExpressionFacts,
  FrameworkReadResult,
  SourceClassIdentity,
} from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class TailwindV4Reader implements FrameworkStyleReader {
  read(input: Parameters<FrameworkStyleReader['read']>[0]): FrameworkReadResult {
    const classNameExpression = input.elementFacts.classNameExpression;
    const classIdentities: SourceClassIdentity[] = classNameExpression ? buildClassIdentities(classNameExpression) : [];

    return {
      sourceOwners: [],
      values: {},
      classIdentities,
      conditions: classIdentities.map((identity) => identity.condition),
    };
  }
}

/**
 * Build the single Tailwind class-source identity for an element. When the facts carry
 * segment provenance (staticLiteralClasses / dynamicBranchClasses), each class's confidence
 * is recorded as `classConfidences` METADATA on the one identity — statically certain classes
 * are 'exact', conditional-branch classes are 'probable'. The identity's overall confidence
 * stays 'exact' as long as at least one class is statically certain, so a single dynamic
 * branch no longer downgrades the whole join (HYP-553). The confidence split intentionally
 * does NOT spawn a second source tab: that produced two indistinguishable "Tailwind" buttons.
 * Without provenance, the back-compat single-identity behavior is preserved.
 */
function buildClassIdentities(facts: ClassNameExpressionFacts): SourceClassIdentity[] {
  const hasProvenance = facts.staticLiteralClasses !== undefined || facts.dynamicBranchClasses !== undefined;

  if (!hasProvenance) {
    return [makeIdentity(facts.staticClasses.join(' '), facts.dynamic ? 'probable' : 'exact')];
  }

  const literal = facts.staticLiteralClasses ?? [];
  const branch = facts.dynamicBranchClasses ?? [];

  const classConfidences: ClassConfidence[] = [
    ...literal.map((cssClass): ClassConfidence => ({ cssClass, confidence: 'exact' })),
    ...branch.map((cssClass): ClassConfidence => ({ cssClass, confidence: 'probable' })),
  ];

  // Overall identity is 'exact' when any class is statically certain; 'probable' only when
  // every class lives in a conditional branch.
  const confidence: 'exact' | 'probable' = literal.length > 0 ? 'exact' : 'probable';

  return [makeIdentity(classConfidences.map((entry) => entry.cssClass).join(' '), confidence, classConfidences)];
}

function makeIdentity(
  cssClass: string,
  confidence: 'exact' | 'probable',
  classConfidences?: ClassConfidence[],
): SourceClassIdentity {
  return {
    sourceTabId: 'tailwind-v4:elementClass',
    cssSystem: 'tailwind-v4',
    sourceForm: 'elementClass',
    label: 'Tailwind',
    cssClass,
    condition: { state: 'base' },
    confidence,
    ...(classConfidences ? { classConfidences } : {}),
  };
}
