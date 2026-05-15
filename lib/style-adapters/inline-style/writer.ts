/**
 * @file InlineStyleWriter — produces ScriptObjectStylePlan from canonical inspector values
 *
 * Accessed via: StyleWritePlanner selects this writer for inline-style elements (style={{}} JSX)
 * Assumptions: cssRuntimeNormalizer handles CSS value validation and bare-number→px appending;
 *   opacity is the only property requiring inspector÷100 conversion before normalization
 */
import type { SourceConfidence } from '@lib/style-read/types';
import { cssRuntimeNormalizer } from '@lib/style-values/css-runtime-normalizer';
import type {
  FrameworkStyleWriter,
  ScriptObjectStylePlan,
  StyleSourceOwner,
  StyleWriteContext,
  StyleWritePlan,
  TargetStyleValue,
} from '@lib/style-write/types';

const OPACITY_KEYS = new Set(['opacity']);

function mapConfidence(ownerConfidence: SourceConfidence): ScriptObjectStylePlan['confidence'] {
  if (ownerConfidence === 'computed-only') return 'fallback';
  if (ownerConfidence === 'probable') return 'probable';
  return 'exact';
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function convertToCss(key: string, value: string): string | null {
  if (value === '') return null;

  if (OPACITY_KEYS.has(key)) {
    const num = Number.parseFloat(value) / 100;
    return String(num);
  }

  const result = cssRuntimeNormalizer.normalize({
    cssProperty: camelToKebab(key),
    value,
  });

  if (result.kind === 'value') return result.value;
  if (result.kind === 'remove') return null;
  // invalid — still include the raw value, let the executor handle it
  return value;
}

export class InlineStyleWriter implements FrameworkStyleWriter {
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan {
    const { context, sourceOwner } = input;
    const { requestedStyles, condition } = context;

    const targetStyles: Record<string, TargetStyleValue> = {};
    for (const [key, value] of Object.entries(requestedStyles)) {
      const converted = convertToCss(key, value);
      if (converted !== null) {
        targetStyles[key] = converted;
      }
    }

    const plan: ScriptObjectStylePlan = {
      id: crypto.randomUUID(),
      sourceForm: 'scriptReactStyleRule',
      cssSystem: 'inline-style',
      projectRoot: '',
      sourceElement: {
        filePath: sourceOwner.filePath,
        elementRef: sourceOwner.elementRef ?? '',
      },
      requestedStyles,
      targetStyles,
      condition,
      reason: 'existing-owner',
      confidence: mapConfidence(sourceOwner.confidence),
      diagnostics: [],
      target: {
        filePath: sourceOwner.filePath,
        objectPath: '',
        styles: targetStyles,
        mergeMode: 'object',
      },
    };

    return plan;
  }
}
