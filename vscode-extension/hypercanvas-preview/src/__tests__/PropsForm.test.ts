/**
 * @file PropsForm deterministic generation tests.
 *
 * Accessed via: VS Code preview error overlay > Props form
 * Assumptions: disabled native buttons need a wrapper tooltip trigger.
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { describe, expect, it } from 'bun:test';
import { getGenerateAllAvailability } from '../webview-preview-panel/PropsForm';

describe('getGenerateAllAvailability', () => {
  it('disables generation when no concrete prop value can be generated', () => {
    const availability = getGenerateAllAvailability([
      { name: 'className', typeInfo: { type: 'unknown', required: false } },
    ]);

    expect(availability.disabled).toBe(true);
    expect(availability.tooltip).toContain('No supported props');
  });

  it('allows generation for variant fields even when parser only reports unknown type', () => {
    const availability = getGenerateAllAvailability([
      { name: 'variant', typeInfo: { type: 'unknown', required: false } },
    ]);

    expect(availability.disabled).toBe(false);
  });
});
