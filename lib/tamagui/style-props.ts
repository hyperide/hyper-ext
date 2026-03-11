/**
 * @file Curated set of valid Tamagui/React Native style properties
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: Tamagui supports React Native style props + some web extras
 * Architecture: static set — for dynamic project palettes see future Linear issue
 */

export const VALID_TAMAGUI_STYLE_PROPS: ReadonlySet<string> = new Set([
  // Layout
  'display',
  'flex',
  'flexDirection',
  'flexWrap',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignItems',
  'alignSelf',
  'alignContent',
  'justifyContent',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'overflow',
  'overflowX',
  'overflowY',

  // Spacing
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingHorizontal',
  'paddingVertical',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginHorizontal',
  'marginVertical',
  'gap',
  'rowGap',
  'columnGap',

  // Sizing
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'aspectRatio',

  // Colors
  'backgroundColor',
  'color',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'shadowColor',
  'outlineColor',
  'textDecorationColor',

  // Borders
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderStyle',

  // Text
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecorationLine',
  'textDecorationStyle',
  'textShadowColor',
  'textShadowOffset',
  'textShadowRadius',

  // Effects
  'opacity',
  'elevation',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',

  // Transform
  'transform',
  'transformOrigin',

  // Tamagui extras (web-compatible)
  'cursor',
  'pointerEvents',
  'userSelect',
  'animation',
]);

export function isValidTamaguiStyleProp(key: string): boolean {
  return VALID_TAMAGUI_STYLE_PROPS.has(key);
}
