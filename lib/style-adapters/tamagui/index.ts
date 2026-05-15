/**
 * @file TamaGuiAdapter — style adapter for Tamagui and React Native components
 *
 * Accessed via: createDefaultStyleWriteManager registers this adapter for 'tamagui'
 * Assumptions: elements using direct JSX style props (backgroundColor, padding, etc.)
 *   instead of className or style={{}} are Tamagui/RN-style elements.
 */
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { TamaGuiPropWriter } from './writer';

export const tamaGuiAdapter: FrameworkStyleAdapter = {
  id: 'tamagui',
  writer: new TamaGuiPropWriter(),
};
