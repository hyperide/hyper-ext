/**
 * @file TailwindV4Writer — produces TailwindPlan from canonical inspector values
 *
 * Accessed via: StyleWritePlanner selects this writer for tailwind-v4 elements
 * Assumptions: generateTailwindClasses handles all CSS prop → Tailwind class mapping;
 *   this writer only orchestrates plan construction, never generates classes itself
 */
import type { SourceConfidence } from '@lib/style-read/types';
import type {
  FrameworkStyleWriter,
  StyleSourceOwner,
  StyleWriteContext,
  StyleWritePlan,
  TailwindPlan,
} from '@lib/style-write/types';
import { generateTailwindClasses } from '@lib/tailwind/generator';

function mapConfidence(ownerConfidence: SourceConfidence): TailwindPlan['confidence'] {
  if (ownerConfidence === 'computed-only') return 'fallback';
  if (ownerConfidence === 'probable') return 'probable';
  return 'exact';
}

function mapStatePrefix(state: string): string | undefined {
  if (state === 'base') return undefined;
  return state;
}

export class TailwindV4Writer implements FrameworkStyleWriter {
  /**
   * Map canonical inspector styles into a static {@link TailwindPlan}: generate the
   * add-classes via {@link generateTailwindClasses} (CSS prop → Tailwind class is owned
   * there, not here) and list every requested property in `removeForProperties` so the
   * executor strips the old conflicting classes first. An empty value means "remove this
   * property": it is excluded from class generation but still listed for removal.
   * Non-base states (hover/focus/…) become the Tailwind variant prefix.
   * USER-IMPACT: backs inspector style-edit writes on Tailwind v4 elements.
   */
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan {
    const { context, sourceOwner } = input;
    const { requestedStyles, condition } = context;

    const statePrefix = mapStatePrefix(condition.state);

    // Filter out empty values before class generation — empty means "remove this property".
    // All keys still appear in removeForProperties so the executor strips old classes.
    const nonEmptyStyles: Record<string, string> = {};
    for (const [key, value] of Object.entries(requestedStyles)) {
      if (value !== '') nonEmptyStyles[key] = value;
    }

    const addClasses =
      Object.keys(nonEmptyStyles).length > 0 ? generateTailwindClasses(nonEmptyStyles, statePrefix) : '';

    const removeForProperties = Object.keys(requestedStyles);

    const plan: TailwindPlan = {
      id: crypto.randomUUID(),
      sourceForm: 'elementClass',
      cssSystem: 'tailwind-v4',
      projectRoot: '',
      sourceElement: {
        filePath: sourceOwner.filePath,
        elementRef: sourceOwner.elementRef ?? '',
      },
      requestedStyles,
      targetStyles: { ...requestedStyles },
      condition,
      reason: 'project-primary-system',
      confidence: mapConfidence(sourceOwner.confidence),
      diagnostics: [],
      strategy: {
        mode: 'static',
        addClasses,
        removeForProperties,
      },
      target: {
        filePath: sourceOwner.filePath,
        elementRef: sourceOwner.elementRef ?? '',
      },
    };

    return plan;
  }
}
