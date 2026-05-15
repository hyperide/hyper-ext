/**
 * @file TamaGuiPropWriter — writes style properties as direct JSX props
 *
 * Accessed via: StyleWritePlanner selects this writer for Tamagui/RN elements
 *   where styles are passed as direct JSX attributes (backgroundColor="#..." etc.)
 * Assumptions: values passed in are already normalized strings; numeric tokens
 *   like "$blue9" are also passed as strings and written as JSX string attributes.
 */
import type {
  AdapterPropPlan,
  FrameworkStyleWriter,
  StyleSourceOwner,
  StyleWriteContext,
  StyleWritePlan,
} from '@lib/style-write/types';

export class TamaGuiPropWriter implements FrameworkStyleWriter {
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan {
    const { context, sourceOwner } = input;
    const { requestedStyles, condition } = context;

    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(requestedStyles)) {
      props[key] = value;
    }

    const plan: AdapterPropPlan = {
      id: crypto.randomUUID(),
      sourceForm: 'adapterKnownElementProp',
      cssSystem: 'tamagui',
      projectRoot: '',
      sourceElement: {
        filePath: sourceOwner.filePath,
        elementRef: sourceOwner.elementRef ?? '',
      },
      requestedStyles,
      targetStyles: requestedStyles,
      condition,
      reason: 'existing-owner',
      confidence: 'exact',
      diagnostics: [],
      target: {
        filePath: sourceOwner.filePath,
        elementRef: sourceOwner.elementRef ?? '',
        mapperId: 'tamagui',
        origin: 'standard-style-inspector',
        props,
      },
    };

    return plan;
  }
}
