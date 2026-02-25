/**
 * Common style types used across different UI frameworks
 */

export interface ParsedStyles {
  // Layout
  display?: string;
  flexDirection?: 'row' | 'column';
  layoutType?: 'layout' | 'col' | 'row' | 'grid';
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  alignItems?: string;
  justifyContent?: string;
  justifyItems?: string;
  alignContent?: string;

  // Position
  position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;

  // Size
  width?: string;
  height?: string;
  minWidth?: string;
  minHeight?: string;
  maxWidth?: string;
  maxHeight?: string;

  // Spacing
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;

  // Legacy margin object (for backward compatibility with tailwindParser)
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };

  // Background
  backgroundColor?: string;
  backgroundImage?: string;

  // Border
  borderWidth?: string; // General border width
  borderTopWidth?: string;
  borderRightWidth?: string;
  borderBottomWidth?: string;
  borderLeftWidth?: string;
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double' | string; // General border style
  borderRadius?: string; // General border radius
  borderRadiusTopLeft?: string;
  borderRadiusTopRight?: string;
  borderRadiusBottomLeft?: string;
  borderRadiusBottomRight?: string;

  // Effects
  opacity?: string;
  overflow?: string;
  boxShadow?: string;
  blur?: string;

  // Shadow (Tailwind specific - parsed from box-shadow)
  shadow?: string; // Tailwind shadow preset (e.g., 'sm', 'md', 'lg')
  shadowColor?: string;
  shadowOpacity?: string;
  shadowX?: string;
  shadowY?: string;
  shadowBlur?: string;
  shadowSpread?: string;

  // Transitions (Tailwind only)
  transitionProperty?: string;
  transitionDuration?: string;
  transitionTiming?: string;

  // Text
  color?: string;

  // Transform
  transform?: string;

  // State-specific styles (Tailwind modifiers like hover:, focus:, etc.)
  // Each state can override any of the base styles
  hover?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focus?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  active?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusVisible?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  disabled?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupHover?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  groupFocus?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
  focusWithin?: Partial<
    Omit<
      ParsedStyles,
      'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'
    >
  >;
}

export interface EffectItem {
  id: string;
  visible: boolean;
  expanded: boolean;
  type: 'drop-shadow' | 'inner-shadow' | 'blur';
  preset?: string;
  color: string;
  opacity: string;
  value: string;
}

export interface StrokeItem {
  id: string;
  visible: boolean;
  expanded: boolean;
  side: 'top' | 'right' | 'bottom' | 'left';
  width: string;
  color: string;
}
