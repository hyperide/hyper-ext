/**
 * Tailwind Class Generator
 * Converts style values to Tailwind CSS classes
 */

import colors from "tailwindcss/colors";

// Build reverse lookup map: hex -> tailwind class (e.g., '#3b82f6' -> 'blue-500')
const HEX_TO_TW_CLASS: Record<string, string> = {};

// Populate the map from tailwindcss/colors
const colorNames = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

for (const colorName of colorNames) {
  const palette = colors[colorName as keyof typeof colors];
  if (palette && typeof palette === "object") {
    for (const [shade, hex] of Object.entries(palette)) {
      if (typeof hex === "string") {
        HEX_TO_TW_CLASS[hex.toLowerCase()] = `${colorName}-${shade}`;
      }
    }
  }
}

// Add special colors
HEX_TO_TW_CLASS["#ffffff"] = "white";
HEX_TO_TW_CLASS["#fff"] = "white";
HEX_TO_TW_CLASS["#000000"] = "black";
HEX_TO_TW_CLASS["#000"] = "black";
HEX_TO_TW_CLASS["transparent"] = "transparent";

interface StyleUpdate {
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  backgroundColor?: string;
  backgroundImage?: string; // Image path for bg-[url('...')]
  color?: string; // text color
  borderColor?: string;
  borderRadius?: string;
  borderRadiusTopLeft?: string;
  borderRadiusTopRight?: string;
  borderRadiusBottomLeft?: string;
  borderRadiusBottomRight?: string;
  overflow?: string;
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  justifyItems?: string;
  opacity?: string;
  // Shadow
  shadow?: string; // Tailwind shadow size: sm, default, md, lg, xl, 2xl, inner, none
  shadowColor?: string; // Shadow color
  boxShadow?: string; // Raw CSS boxShadow value (for arbitrary values)
}

// Tailwind spacing scale mapping
const SPACING_MAP: Record<string, string> = {
  "0px": "0",
  "1px": "px",
  "0.125rem": "0.5",
  "0.25rem": "1",
  "0.5rem": "2",
  "0.75rem": "3",
  "1rem": "4",
  "1.25rem": "5",
  "1.5rem": "6",
  "1.75rem": "7",
  "2rem": "8",
  "2.25rem": "9",
  "2.5rem": "10",
  "2.75rem": "11",
  "3rem": "12",
  "3.5rem": "14",
  "4rem": "16",
  "5rem": "20",
  "6rem": "24",
  "7rem": "28",
  "8rem": "32",
  "9rem": "36",
  "10rem": "40",
  "11rem": "44",
  "12rem": "48",
  "13rem": "52",
  "14rem": "56",
  "15rem": "60",
  "16rem": "64",
};

// Border radius mapping
const RADIUS_MAP: Record<string, string> = {
  "0px": "0",
  "2px": "sm",
  "4px": "",
  "6px": "md",
  "8px": "lg",
  "12px": "xl",
  "16px": "2xl",
  "24px": "3xl",
  "9999px": "full",
};

/**
 * Convert CSS value to Tailwind spacing token or arbitrary value
 */
function toSpacingToken(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "0") return "0";

  // Check if it's in the spacing map
  if (SPACING_MAP[trimmed]) {
    return SPACING_MAP[trimmed];
  }

  // Return arbitrary value
  return `[${trimmed}]`;
}

/**
 * Convert position value to Tailwind class
 */
function toPositionClass(
  direction: "top" | "right" | "bottom" | "left",
  value: string | undefined,
): string | null {
  if (!value) return null;

  const token = toSpacingToken(value);
  if (!token) return null;

  // Handle negative values
  const isNegative = value.startsWith("-");
  const prefix = isNegative ? "-" : "";
  const cleanToken = isNegative ? token.replace("-", "") : token;

  return `${prefix}${direction}-${cleanToken}`;
}

/**
 * Convert width/height to Tailwind class
 */
function toSizingClass(
  dimension: "w" | "h",
  value: string | undefined,
): string | null {
  if (!value) return null;

  const trimmed = value.trim();

  // Common width/height values
  const commonSizes: Record<string, string> = {
    auto: "auto",
    "100%": "full",
    "100vw": "screen",
    "100vh": "screen",
    "50%": "1/2",
    "33.333333%": "1/3",
    "66.666667%": "2/3",
    "25%": "1/4",
    "75%": "3/4",
    "20%": "1/5",
  };

  if (commonSizes[trimmed]) {
    return `${dimension}-${commonSizes[trimmed]}`;
  }

  const token = toSpacingToken(trimmed);
  if (!token) return null;

  return `${dimension}-${token}`;
}

/**
 * Convert margin to Tailwind class
 */
function toMarginClass(
  direction: "t" | "r" | "b" | "l",
  value: string | undefined,
): string | null {
  if (!value) return null;

  const trimmed = value.trim();

  // Handle 'auto' specially
  if (trimmed === "auto") {
    return `m${direction}-auto`;
  }

  // Handle negative values
  const isNegative = trimmed.startsWith("-");
  const absoluteValue = isNegative ? trimmed.slice(1) : trimmed;

  const token = toSpacingToken(absoluteValue);
  if (!token) return null;

  const prefix = isNegative ? "-" : "";
  return `${prefix}m${direction}-${token}`;
}

/**
 * Convert color to Tailwind class
 * Uses full Tailwind color palette for exact matches
 */
function toColorClass(
  type: "bg" | "text" | "border" | "shadow",
  value: string | undefined,
): string | null {
  if (!value) return null;

  const trimmed = value.trim().toLowerCase();

  // Check if hex matches a Tailwind color
  const twClass = HEX_TO_TW_CLASS[trimmed];
  if (twClass) {
    return `${type}-${twClass}`;
  }

  // Handle hex with alpha channel (#rrggbbaa) - extract base color
  if (trimmed.length === 9 && trimmed.startsWith("#")) {
    const baseHex = trimmed.slice(0, 7);
    const twClassFromBase = HEX_TO_TW_CLASS[baseHex];
    if (twClassFromBase) {
      // Extract opacity from alpha channel
      const alpha = Number.parseInt(trimmed.slice(7, 9), 16);
      const opacityPercent = Math.round((alpha / 255) * 100);
      // Use Tailwind opacity modifier if it's a standard value
      const standardOpacities = [
        0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100,
      ];
      if (standardOpacities.includes(opacityPercent)) {
        return `${type}-${twClassFromBase}/${opacityPercent}`;
      }
      // Use arbitrary opacity
      return `${type}-${twClassFromBase}/[${opacityPercent / 100}]`;
    }
  }

  // Use arbitrary value for custom colors
  return `${type}-[${value}]`;
}

/**
 * Convert border radius to Tailwind class
 */
function toBorderRadiusClass(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();

  if (RADIUS_MAP[trimmed]) {
    const token = RADIUS_MAP[trimmed];
    return token ? `rounded-${token}` : "rounded";
  }

  // Use arbitrary value
  return `rounded-[${value}]`;
}

/**
 * Convert individual corner border radius to Tailwind class
 */
function toBorderRadiusCornerClass(
  corner: "tl" | "tr" | "bl" | "br",
  value: string | undefined,
): string | null {
  if (!value) return null;

  const trimmed = value.trim();

  if (RADIUS_MAP[trimmed]) {
    const token = RADIUS_MAP[trimmed];
    return token ? `rounded-${corner}-${token}` : `rounded-${corner}`;
  }

  // Use arbitrary value
  return `rounded-${corner}-[${value}]`;
}

/**
 * Generate Tailwind classes from style values
 * @param styles - Style properties to convert to Tailwind classes
 * @param state - Optional state modifier (hover, focus, etc.) to prefix all classes
 */
export function generateTailwindClasses(
  styles: StyleUpdate,
  state?: string,
): string {
  const classes: string[] = [];

  // Position
  if (styles.position) {
    const posMap: Record<string, string> = {
      static: "static",
      relative: "relative",
      absolute: "absolute",
      fixed: "fixed",
      sticky: "sticky",
    };
    if (posMap[styles.position]) {
      classes.push(posMap[styles.position]);
    }
  }

  // Position values (only for non-static)
  if (styles.position && styles.position !== "static") {
    const top = toPositionClass("top", styles.top);
    const right = toPositionClass("right", styles.right);
    const bottom = toPositionClass("bottom", styles.bottom);
    const left = toPositionClass("left", styles.left);

    if (top) classes.push(top);
    if (right) classes.push(right);
    if (bottom) classes.push(bottom);
    if (left) classes.push(left);
  }

  // Display & Layout
  if (styles.display) {
    if (styles.display === "flex" || styles.display === "inline-flex") {
      classes.push("flex");
      if (styles.flexDirection === "column") {
        classes.push("flex-col");
      }
    } else if (styles.display === "grid" || styles.display === "inline-grid") {
      classes.push("grid");
    }
  }

  // Handle flexDirection separately (when sent without display, e.g., changing direction)
  if (!styles.display && styles.flexDirection !== undefined) {
    if (styles.flexDirection === "column") {
      classes.push("flex-col");
    }
    // Note: flex-row is default, so empty string removes flex-col
    // The removeConflictingClasses will handle removing flex-col when switching to row
  }

  // Justify Content
  if (styles.justifyContent) {
    const justifyMap: Record<string, string> = {
      "flex-start": "justify-start",
      start: "justify-start",
      center: "justify-center",
      "flex-end": "justify-end",
      end: "justify-end",
      "space-between": "justify-between",
      "space-around": "justify-around",
      "space-evenly": "justify-evenly",
      stretch: "justify-stretch",
    };
    if (justifyMap[styles.justifyContent]) {
      classes.push(justifyMap[styles.justifyContent]);
    }
  }

  // Align Items
  if (styles.alignItems) {
    const alignMap: Record<string, string> = {
      "flex-start": "items-start",
      start: "items-start",
      center: "items-center",
      "flex-end": "items-end",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    };
    if (alignMap[styles.alignItems]) {
      classes.push(alignMap[styles.alignItems]);
    }
  }

  // Gap
  if (styles.gap) {
    const gapToken = toSpacingToken(styles.gap);
    if (gapToken) {
      classes.push(`gap-${gapToken}`);
    }
  }

  // Row Gap (gap-y)
  if (styles.rowGap) {
    const rowGapToken = toSpacingToken(styles.rowGap);
    if (rowGapToken) {
      classes.push(`gap-y-${rowGapToken}`);
    }
  }

  // Column Gap (gap-x)
  if (styles.columnGap) {
    const columnGapToken = toSpacingToken(styles.columnGap);
    if (columnGapToken) {
      classes.push(`gap-x-${columnGapToken}`);
    }
  }

  // Grid Template Columns (grid-cols-*)
  if (styles.gridTemplateColumns) {
    const value = styles.gridTemplateColumns.trim();
    // Check if it's a number (1-12) or special value
    if (/^\d+$/.test(value)) {
      classes.push(`grid-cols-${value}`);
    } else if (value === 'none' || value === 'subgrid') {
      classes.push(`grid-cols-${value}`);
    } else {
      // Arbitrary value - replace spaces with underscores for Tailwind syntax
      const encoded = value.replace(/\s+/g, '_');
      classes.push(`grid-cols-[${encoded}]`);
    }
  }

  // Grid Template Rows (grid-rows-*)
  if (styles.gridTemplateRows) {
    const value = styles.gridTemplateRows.trim();
    // Check if it's a number (1-12) or special value
    if (/^\d+$/.test(value)) {
      classes.push(`grid-rows-${value}`);
    } else if (value === 'none' || value === 'subgrid') {
      classes.push(`grid-rows-${value}`);
    } else {
      // Arbitrary value - replace spaces with underscores for Tailwind syntax
      const encoded = value.replace(/\s+/g, '_');
      classes.push(`grid-rows-[${encoded}]`);
    }
  }

  // Justify Items (grid horizontal alignment)
  if (styles.justifyItems) {
    const justifyItemsMap: Record<string, string> = {
      start: "justify-items-start",
      center: "justify-items-center",
      end: "justify-items-end",
      stretch: "justify-items-stretch",
    };
    if (justifyItemsMap[styles.justifyItems]) {
      classes.push(justifyItemsMap[styles.justifyItems]);
    }
  }

  // Overflow
  if (styles.overflow) {
    const overflowMap: Record<string, string> = {
      visible: "overflow-visible",
      hidden: "overflow-hidden",
      scroll: "overflow-scroll",
      auto: "overflow-auto",
    };
    if (overflowMap[styles.overflow]) {
      classes.push(overflowMap[styles.overflow]);
    }
  }

  // Width & Height
  const width = toSizingClass("w", styles.width);
  const height = toSizingClass("h", styles.height);
  if (width) classes.push(width);
  if (height) classes.push(height);

  // Margins
  const mt = toMarginClass("t", styles.marginTop);
  const mr = toMarginClass("r", styles.marginRight);
  const mb = toMarginClass("b", styles.marginBottom);
  const ml = toMarginClass("l", styles.marginLeft);
  if (mt) classes.push(mt);
  if (mr) classes.push(mr);
  if (mb) classes.push(mb);
  if (ml) classes.push(ml);

  // Paddings - use px/py when left===right or top===bottom
  const useHorizontalPadding =
    styles.paddingLeft &&
    styles.paddingRight &&
    styles.paddingLeft === styles.paddingRight;
  const useVerticalPadding =
    styles.paddingTop &&
    styles.paddingBottom &&
    styles.paddingTop === styles.paddingBottom;

  if (useHorizontalPadding) {
    const token = toSpacingToken(styles.paddingLeft);
    if (token) classes.push(`px-${token}`);
  } else {
    if (styles.paddingLeft) {
      const token = toSpacingToken(styles.paddingLeft);
      if (token) classes.push(`pl-${token}`);
    }
    if (styles.paddingRight) {
      const token = toSpacingToken(styles.paddingRight);
      if (token) classes.push(`pr-${token}`);
    }
  }

  if (useVerticalPadding) {
    const token = toSpacingToken(styles.paddingTop);
    if (token) classes.push(`py-${token}`);
  } else {
    if (styles.paddingTop) {
      const token = toSpacingToken(styles.paddingTop);
      if (token) classes.push(`pt-${token}`);
    }
    if (styles.paddingBottom) {
      const token = toSpacingToken(styles.paddingBottom);
      if (token) classes.push(`pb-${token}`);
    }
  }

  // Colors
  const bg = toColorClass("bg", styles.backgroundColor);
  const textColor = toColorClass("text", styles.color);
  const border = toColorClass("border", styles.borderColor);
  if (bg) classes.push(bg);
  if (textColor) classes.push(textColor);
  if (border) classes.push(border);

  // Background Image
  if (styles.backgroundImage) {
    // Generate Tailwind arbitrary value class: bg-\[url('/path/to/image.png')\]
    const imagePath = styles.backgroundImage;
    classes.push(`bg-[url('${imagePath}')]`);
    classes.push("bg-cover");
    classes.push("bg-center");
    classes.push("bg-no-repeat");
  }

  // Border Radius
  // If individual corners are specified, use them; otherwise use general borderRadius
  if (
    styles.borderRadiusTopLeft ||
    styles.borderRadiusTopRight ||
    styles.borderRadiusBottomLeft ||
    styles.borderRadiusBottomRight
  ) {
    const tl = toBorderRadiusCornerClass("tl", styles.borderRadiusTopLeft);
    const tr = toBorderRadiusCornerClass("tr", styles.borderRadiusTopRight);
    const bl = toBorderRadiusCornerClass("bl", styles.borderRadiusBottomLeft);
    const br = toBorderRadiusCornerClass("br", styles.borderRadiusBottomRight);
    if (tl) classes.push(tl);
    if (tr) classes.push(tr);
    if (bl) classes.push(bl);
    if (br) classes.push(br);
  } else {
    const radius = toBorderRadiusClass(styles.borderRadius);
    if (radius) classes.push(radius);
  }

  // Opacity
  if (styles.opacity !== undefined) {
    const opacityValue = styles.opacity;
    // Tailwind supports: 0, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100
    const validOpacities = [
      "0",
      "5",
      "10",
      "20",
      "25",
      "30",
      "40",
      "50",
      "60",
      "70",
      "75",
      "80",
      "90",
      "95",
      "100",
    ];
    if (validOpacities.includes(opacityValue)) {
      classes.push(`opacity-${opacityValue}`);
    } else {
      // Use arbitrary value for custom opacity (divide by 100 for CSS: 12 -> 0.12)
      const cssValue = Number.parseFloat(opacityValue) / 100;
      classes.push(`opacity-[${cssValue}]`);
    }
  }

  // Shadow
  if (styles.shadow !== undefined) {
    const shadowValue = styles.shadow;
    // Valid Tailwind shadow sizes
    const validShadows = ["sm", "default", "md", "lg", "xl", "2xl", "inner", "none"];
    if (shadowValue === "none") {
      classes.push("shadow-none");
    } else if (shadowValue === "default" || shadowValue === "") {
      classes.push("shadow");
    } else if (validShadows.includes(shadowValue)) {
      classes.push(`shadow-${shadowValue}`);
    } else {
      // Arbitrary shadow value
      classes.push(`shadow-[${shadowValue}]`);
    }
  }

  // Shadow Color
  if (styles.shadowColor) {
    const shadowColorClass = toColorClass("shadow", styles.shadowColor);
    if (shadowColorClass) {
      classes.push(shadowColorClass);
    }
  }

  // Box Shadow (raw CSS value - use arbitrary syntax)
  if (styles.boxShadow !== undefined) {
    const boxShadowValue = styles.boxShadow;
    if (boxShadowValue === "none" || boxShadowValue === "") {
      classes.push("shadow-none");
    } else {
      // Encode the CSS value for Tailwind arbitrary syntax
      // Replace spaces with underscores for Tailwind arbitrary value syntax
      const encoded = boxShadowValue.replace(/\s+/g, "_");
      classes.push(`shadow-[${encoded}]`);
    }
  }

  // Remove duplicates
  const uniqueClasses = Array.from(new Set(classes));

  // Apply state modifier prefix if specified (e.g., hover:, focus:)
  if (state) {
    return uniqueClasses.map((cls) => `${state}:${cls}`).join(" ");
  }

  return uniqueClasses.join(" ");
}

/**
 * Test values with known suffixes for prefix extraction.
 * Each entry maps a CSS property to a test value and expected suffix.
 */
const TEST_VALUES_FOR_PREFIX: Record<string, { value: string; suffix: string }> = {
  // Layout alignment
  alignItems: { value: 'start', suffix: 'start' },
  justifyItems: { value: 'start', suffix: 'start' },
  justifyContent: { value: 'start', suffix: 'start' },
  // Gaps
  gap: { value: '4px', suffix: '[4px]' },
  rowGap: { value: '4px', suffix: '[4px]' },
  columnGap: { value: '4px', suffix: '[4px]' },
  // Grid template
  gridTemplateColumns: { value: '4', suffix: '4' },
  gridTemplateRows: { value: '4', suffix: '4' },
  // Sizing
  width: { value: '100px', suffix: '[100px]' },
  height: { value: '100px', suffix: '[100px]' },
  // Colors
  backgroundColor: { value: '#ff0000', suffix: '[#ff0000]' },
  color: { value: '#ff0000', suffix: '[#ff0000]' },
  borderColor: { value: '#ff0000', suffix: '[#ff0000]' },
  // Position
  position: { value: 'absolute', suffix: 'absolute' },
  top: { value: '10px', suffix: '[10px]' },
  right: { value: '10px', suffix: '[10px]' },
  bottom: { value: '10px', suffix: '[10px]' },
  left: { value: '10px', suffix: '[10px]' },
  // Border radius
  borderRadius: { value: '8px', suffix: 'lg' },
  borderRadiusTopLeft: { value: '8px', suffix: 'lg' },
  borderRadiusTopRight: { value: '8px', suffix: 'lg' },
  borderRadiusBottomLeft: { value: '8px', suffix: 'lg' },
  borderRadiusBottomRight: { value: '8px', suffix: 'lg' },
  // Overflow
  overflow: { value: 'hidden', suffix: 'hidden' },
  // Opacity
  opacity: { value: '50', suffix: '50' },
  // Shadow
  shadow: { value: 'md', suffix: 'md' },
  shadowColor: { value: '#ff0000', suffix: '[#ff0000]' },
  boxShadow: { value: 'none', suffix: 'none' },
  // Border width
  borderWidth: { value: '2px', suffix: '[2px]' },
  // Effects
  blur: { value: 'md', suffix: 'md' },
};

/**
 * Special cases that need multiple prefixes or non-standard handling.
 * These cannot be auto-detected and must be defined manually.
 */
const SPECIAL_CASE_PREFIXES: Record<string, string[]> = {
  // Position values (not prefixes)
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  // Position directions include negative values
  top: ['top-', '-top-'],
  right: ['right-', '-right-'],
  bottom: ['bottom-', '-bottom-'],
  left: ['left-', '-left-'],
  // Margin has multiple directional prefixes + negative values
  marginTop: ['m-', 'mt-', 'my-', '-mt-', '-m-'],
  marginRight: ['m-', 'mr-', 'mx-', '-mr-', '-m-'],
  marginBottom: ['m-', 'mb-', 'my-', '-mb-', '-m-'],
  marginLeft: ['m-', 'ml-', 'mx-', '-ml-', '-m-'],
  // Padding has multiple directional prefixes
  paddingTop: ['p-', 'pt-', 'py-'],
  paddingRight: ['p-', 'pr-', 'px-'],
  paddingBottom: ['p-', 'pb-', 'py-'],
  paddingLeft: ['p-', 'pl-', 'px-'],
  // Background image has multiple related classes
  backgroundImage: ['bg-[url', 'bg-cover', 'bg-contain', 'bg-center', 'bg-no-repeat', 'bg-repeat'],
  // Border radius corners also remove general rounded
  borderRadiusTopLeft: ['rounded-tl', 'rounded'],
  borderRadiusTopRight: ['rounded-tr', 'rounded'],
  borderRadiusBottomLeft: ['rounded-bl', 'rounded'],
  borderRadiusBottomRight: ['rounded-br', 'rounded'],
  // Display has multiple possible class values (not prefixes)
  display: ['flex', 'block', 'grid', 'inline-flex', 'inline-block', 'inline-grid', 'hidden'],
  // Grid template columns/rows
  gridTemplateColumns: ['grid-cols-'],
  gridTemplateRows: ['grid-rows-'],
  // Flex direction is special
  flexDirection: ['flex-row', 'flex-col'],
  // Shadow includes multiple variants
  shadow: ['shadow'],
  boxShadow: ['shadow'],
};

/**
 * Extract Tailwind prefix(es) for a style property.
 * First checks special cases, then tries auto-detection via generateTailwindClasses.
 *
 * @param styleKey - CSS property name (e.g., 'alignItems', 'justifyItems')
 * @returns Array of prefixes to match for conflict removal
 */
export function getConflictingPrefixesForProperty(styleKey: string): string[] {
  // Check special cases first
  if (SPECIAL_CASE_PREFIXES[styleKey]) {
    return SPECIAL_CASE_PREFIXES[styleKey];
  }

  // Try auto-detection
  const testConfig = TEST_VALUES_FOR_PREFIX[styleKey];
  if (!testConfig) {
    // Unknown property - return empty (will not remove any conflicting classes)
    return [];
  }

  const generated = generateTailwindClasses({ [styleKey]: testConfig.value });
  if (!generated) return [];

  // Extract prefix by removing the test value suffix
  // e.g., 'items-start' with suffix='start' → 'items-'
  // e.g., 'gap-y-[4px]' with suffix='[4px]' → 'gap-y-'
  const escapedSuffix = testConfig.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = generated.replace(new RegExp(`${escapedSuffix}$`), '');

  return prefix ? [prefix] : [];
}

/**
 * Get conflicting prefixes for multiple style keys.
 * Combines results from all keys and removes duplicates.
 *
 * @param styleKeys - Array of CSS property names
 * @returns Array of unique prefixes
 */
export function getConflictingPrefixes(styleKeys: string[]): string[] {
  const allPrefixes: string[] = [];

  for (const key of styleKeys) {
    const prefixes = getConflictingPrefixesForProperty(key);
    allPrefixes.push(...prefixes);
  }

  // Remove duplicates
  return [...new Set(allPrefixes)];
}
