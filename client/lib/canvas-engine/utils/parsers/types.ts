/**
 * @file Tailwind parsed styles type definition
 *
 * Accessed via: Style inspector, CanvasEngine, component props
 */

export interface ParsedTailwindStyles {
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;
  padding?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  backgroundColor?: string;
  backgroundImage?: string;
  fontSize?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: string;
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  borderRadius?: string;
  borderRadiusTopLeft?: string;
  borderRadiusTopRight?: string;
  borderRadiusBottomLeft?: string;
  borderRadiusBottomRight?: string;
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  alignContent?: string;
  justifyItems?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  overflow?: 'visible' | 'hidden' | 'scroll' | 'auto';
  opacity?: string;
  shadow?: string;
  shadowColor?: string;
  shadowOpacity?: string;
  shadowX?: string;
  shadowY?: string;
  shadowBlur?: string;
  shadowSpread?: string;
  blur?: string;
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTiming?: string;
  transform?: string;

  hover?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focus?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  active?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusVisible?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  disabled?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupHover?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupFocus?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusWithin?: Partial<
    Omit<
      ParsedTailwindStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
}
