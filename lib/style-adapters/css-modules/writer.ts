/**
 * @file CssModulesWriter — produces CssModulesFilePlan from canonical inspector values
 *
 * Accessed via: StyleWritePlanner selects this writer for css-modules elements (className={styles.x})
 * Assumptions: cssRuntimeNormalizer handles CSS value validation and bare-number→px appending;
 *   opacity is the only property requiring inspector÷100 conversion before normalization;
 *   declarations use kebab-case keys (CSS property names), not camelCase
 */
import type { SourceConfidence } from '@lib/style-read/types';
import { cssRuntimeNormalizer } from '@lib/style-values/css-runtime-normalizer';
import type {
  CssModulesFilePlan,
  FrameworkStyleWriter,
  StyleSourceOwner,
  StyleWriteContext,
  StyleWritePlan,
  TargetStyleValue,
} from '@lib/style-write/types';

const OPACITY_KEYS = new Set(['opacity']);

function mapConfidence(ownerConfidence: SourceConfidence): CssModulesFilePlan['confidence'] {
  if (ownerConfidence === 'computed-only') return 'fallback';
  if (ownerConfidence === 'probable') return 'probable';
  return 'exact';
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function convertToCssValue(key: string, value: string): string | null {
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
  return value;
}

export class CssModulesWriter implements FrameworkStyleWriter {
  createPlan(input: { context: StyleWriteContext; sourceOwner: StyleSourceOwner }): StyleWritePlan {
    const { context, sourceOwner } = input;
    const { requestedStyles, condition } = context;

    const targetStyles: Record<string, TargetStyleValue> = {};
    const cssDeclarations: Record<string, string> = {};

    for (const [key, value] of Object.entries(requestedStyles)) {
      const converted = convertToCssValue(key, value);
      if (converted !== null) {
        targetStyles[key] = converted;
        cssDeclarations[camelToKebab(key)] = converted;
      }
    }

    const selector = sourceOwner.selector ?? '';

    const plan: CssModulesFilePlan = {
      id: crypto.randomUUID(),
      sourceForm: 'cssStyleRule',
      cssSystem: 'css-modules',
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
        cssFilePath: sourceOwner.filePath,
        cssSyntax: sourceOwner.cssSyntax ?? 'css',
        selector,
        declarations: cssDeclarations,
        importSource: '',
        importLocalName: '',
        classKey: selector.replace(/^\./, ''),
        cascadeContext: sourceOwner.cascadeContext,
      },
    };

    return plan;
  }
}
