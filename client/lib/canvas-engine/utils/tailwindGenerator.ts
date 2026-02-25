/**
 * Tailwind Class Name Generator
 * Updates Tailwind className string with new style values
 */

interface StyleUpdate {
  styleKey: string;
  styleValue: string;
}

/**
 * Remove classes that match a prefix pattern
 */
function removeClassesWithPrefix(classes: string[], prefixes: string[]): string[] {
  return classes.filter((cls) => {
    // Handle negative classes (e.g., -mt-4)
    const cleanCls = cls.startsWith('-') ? cls.slice(1) : cls;

    return !prefixes.some((prefix) => {
      if (prefix === cls) return true; // Exact match
      return cleanCls.startsWith(prefix);
    });
  });
}

/**
 * Convert CSS value to Tailwind arbitrary value syntax
 * e.g., "200px" -> "[200px]"
 */
function toArbitraryValue(value: string): string {
  // Empty value means remove the style
  if (!value || value === '0' || value === '0px') {
    return '';
  }

  // Already in arbitrary value syntax
  if (value.startsWith('[') && value.endsWith(']')) {
    return value;
  }

  return `[${value}]`;
}

/**
 * Update className with new style value
 */
export function updateTailwindClassName(
  currentClassName: string,
  styleKey: string,
  styleValue: string
): string {
  const classes = currentClassName.split(/\s+/).filter(Boolean);
  let updatedClasses = [...classes];

  // Map of style keys to Tailwind class prefixes to remove
  const styleToClassMap: Record<string, { remove: string[]; add?: (value: string) => string | null }> = {
    // Position
    position: {
      remove: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
      add: (value) => value || null,
    },
    top: {
      remove: ['top-', '-top-'],
      add: (value) => value ? `top-${toArbitraryValue(value)}` : null,
    },
    right: {
      remove: ['right-', '-right-'],
      add: (value) => value ? `right-${toArbitraryValue(value)}` : null,
    },
    bottom: {
      remove: ['bottom-', '-bottom-'],
      add: (value) => value ? `bottom-${toArbitraryValue(value)}` : null,
    },
    left: {
      remove: ['left-', '-left-'],
      add: (value) => value ? `left-${toArbitraryValue(value)}` : null,
    },

    // Sizing
    width: {
      remove: ['w-'],
      add: (value) => value ? `w-${toArbitraryValue(value)}` : null,
    },
    height: {
      remove: ['h-'],
      add: (value) => value ? `h-${toArbitraryValue(value)}` : null,
    },

    // Margin
    marginTop: {
      remove: ['mt-', '-mt-', 'my-', '-my-', 'm-', '-m-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        const isNegative = value.startsWith('-');
        const cleanValue = isNegative ? value.slice(1) : value;
        const prefix = isNegative ? '-mt-' : 'mt-';
        return `${prefix}${toArbitraryValue(cleanValue)}`;
      },
    },
    marginRight: {
      remove: ['mr-', '-mr-', 'mx-', '-mx-', 'm-', '-m-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        const isNegative = value.startsWith('-');
        const cleanValue = isNegative ? value.slice(1) : value;
        const prefix = isNegative ? '-mr-' : 'mr-';
        return `${prefix}${toArbitraryValue(cleanValue)}`;
      },
    },
    marginBottom: {
      remove: ['mb-', '-mb-', 'my-', '-my-', 'm-', '-m-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        const isNegative = value.startsWith('-');
        const cleanValue = isNegative ? value.slice(1) : value;
        const prefix = isNegative ? '-mb-' : 'mb-';
        return `${prefix}${toArbitraryValue(cleanValue)}`;
      },
    },
    marginLeft: {
      remove: ['ml-', '-ml-', 'mx-', '-mx-', 'm-', '-m-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        const isNegative = value.startsWith('-');
        const cleanValue = isNegative ? value.slice(1) : value;
        const prefix = isNegative ? '-ml-' : 'ml-';
        return `${prefix}${toArbitraryValue(cleanValue)}`;
      },
    },

    // Colors
    backgroundColor: {
      remove: ['bg-'],
      add: (value) => value ? `bg-${toArbitraryValue(value)}` : null,
    },
    borderColor: {
      remove: ['border-gray-', 'border-red-', 'border-blue-', 'border-green-', 'border-yellow-', 'border-purple-'],
      add: (value) => value ? `border-${toArbitraryValue(value)}` : null,
    },
    borderWidth: {
      remove: ['border-0', 'border-2', 'border-4', 'border-8', 'border-[', 'border'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        // Standard Tailwind values
        if (value === '1px') return 'border';
        if (value === '2px') return 'border-2';
        if (value === '4px') return 'border-4';
        if (value === '8px') return 'border-8';
        // Custom arbitrary value for non-standard widths (e.g., border-[9px])
        return `border-${toArbitraryValue(value)}`;
      },
    },
    borderTopWidth: {
      remove: ['border-t-0', 'border-t-2', 'border-t-4', 'border-t-8', 'border-t-[', 'border-t'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        if (value === '1px') return 'border-t';
        if (value === '2px') return 'border-t-2';
        if (value === '4px') return 'border-t-4';
        if (value === '8px') return 'border-t-8';
        return `border-t-${toArbitraryValue(value)}`;
      },
    },
    borderRightWidth: {
      remove: ['border-r-0', 'border-r-2', 'border-r-4', 'border-r-8', 'border-r-[', 'border-r'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        if (value === '1px') return 'border-r';
        if (value === '2px') return 'border-r-2';
        if (value === '4px') return 'border-r-4';
        if (value === '8px') return 'border-r-8';
        return `border-r-${toArbitraryValue(value)}`;
      },
    },
    borderBottomWidth: {
      remove: ['border-b-0', 'border-b-2', 'border-b-4', 'border-b-8', 'border-b-[', 'border-b'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        if (value === '1px') return 'border-b';
        if (value === '2px') return 'border-b-2';
        if (value === '4px') return 'border-b-4';
        if (value === '8px') return 'border-b-8';
        return `border-b-${toArbitraryValue(value)}`;
      },
    },
    borderLeftWidth: {
      remove: ['border-l-0', 'border-l-2', 'border-l-4', 'border-l-8', 'border-l-[', 'border-l'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        if (value === '1px') return 'border-l';
        if (value === '2px') return 'border-l-2';
        if (value === '4px') return 'border-l-4';
        if (value === '8px') return 'border-l-8';
        return `border-l-${toArbitraryValue(value)}`;
      },
    },
    borderStyle: {
      remove: ['border-solid', 'border-dashed', 'border-dotted', 'border-double', 'border-none'],
      add: (value) => {
        if (!value || value === 'solid') return null;
        if (value === 'dashed') return 'border-dashed';
        if (value === 'dotted') return 'border-dotted';
        if (value === 'double') return 'border-double';
        if (value === 'none') return 'border-none';
        return null;
      },
    },

    // Border radius
    borderRadius: {
      remove: ['rounded-', 'rounded'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        return `rounded-${toArbitraryValue(value)}`;
      },
    },
    borderRadiusTopLeft: {
      remove: ['rounded-tl-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        return `rounded-tl-${toArbitraryValue(value)}`;
      },
    },
    borderRadiusTopRight: {
      remove: ['rounded-tr-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        return `rounded-tr-${toArbitraryValue(value)}`;
      },
    },
    borderRadiusBottomLeft: {
      remove: ['rounded-bl-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        return `rounded-bl-${toArbitraryValue(value)}`;
      },
    },
    borderRadiusBottomRight: {
      remove: ['rounded-br-'],
      add: (value) => {
        if (!value || value === '0' || value === '0px') return null;
        return `rounded-br-${toArbitraryValue(value)}`;
      },
    },

    // Display & Flexbox
    display: {
      remove: ['flex', 'inline-flex', 'block', 'inline-block', 'grid', 'inline-grid', 'hidden'],
      add: (value) => value || null,
    },
    flexDirection: {
      remove: ['flex-row', 'flex-col'],
      add: (value) => {
        if (value === 'row') return 'flex-row';
        if (value === 'column') return 'flex-col';
        return null;
      },
    },

    // Overflow
    overflow: {
      remove: ['overflow-visible', 'overflow-hidden', 'overflow-scroll', 'overflow-auto'],
      add: (value) => {
        if (value === 'visible') return 'overflow-visible';
        if (value === 'hidden') return 'overflow-hidden';
        if (value === 'scroll') return 'overflow-scroll';
        if (value === 'auto') return 'overflow-auto';
        return null;
      },
    },

    // Opacity
    opacity: {
      remove: ['opacity-'],
      add: (value) => {
        if (!value || value === '100') return null;
        return `opacity-${toArbitraryValue(value)}`;
      },
    },

    // Shadow
    shadow: {
      remove: ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-inner', 'shadow-none', 'shadow-[', 'shadow'],
      add: (value) => {
        if (!value || value === 'none') return null;
        if (value === 'default') return 'shadow';
        return `shadow-${value}`;
      },
    },

    // Box shadow (for arbitrary values with custom colors)
    boxShadow: {
      remove: ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-inner', 'shadow-none', 'shadow-[', 'shadow'],
      add: (value) => {
        if (!value || value === 'none') return null;
        // Convert spaces to underscores for Tailwind arbitrary value syntax
        const escapedValue = value.replace(/ /g, '_');
        return `shadow-[${escapedValue}]`;
      },
    },

    // Shadow color (for preset shadows with custom colors)
    shadowColor: {
      remove: ['shadow-[#'],
      add: (value) => {
        if (!value) return null;
        return `shadow-[${value}]`;
      },
    },

    // Blur
    blur: {
      remove: ['blur-sm', 'blur-md', 'blur-lg', 'blur-xl', 'blur-2xl', 'blur-3xl', 'blur-none', 'blur'],
      add: (value) => {
        if (!value || value === 'none') return null;
        if (value === 'default') return 'blur';
        return `blur-${value}`;
      },
    },

    // Transition property
    transitionProperty: {
      remove: ['transition', 'transition-all', 'transition-colors', 'transition-opacity', 'transition-transform', 'transition-none'],
      add: (value) => {
        if (!value || value === 'none') return null;
        if (value === 'all') return 'transition';
        return `transition-${value}`;
      },
    },

    // Transition duration
    transitionDuration: {
      remove: ['duration-'],
      add: (value) => {
        if (!value) return null;
        return `duration-${value}`;
      },
    },

    // Transition timing
    transitionTiming: {
      remove: ['ease-linear', 'ease-in', 'ease-out', 'ease-in-out'],
      add: (value) => {
        if (!value) return null;
        if (value === 'linear') return 'ease-linear';
        if (value === 'in') return 'ease-in';
        if (value === 'out') return 'ease-out';
        if (value === 'in-out') return 'ease-in-out';
        return null;
      },
    },
  };

  const mapping = styleToClassMap[styleKey];
  if (!mapping) {
    console.warn(`[tailwindGenerator] Unknown style key: ${styleKey}`);
    return currentClassName;
  }

  // Remove old classes
  // Special handling for borderColor - only remove border-[...] if it contains a color (#)
  if (styleKey === 'borderColor') {
    updatedClasses = updatedClasses.filter((cls) => {
      // Check border-[...] arbitrary values
      if (cls.startsWith('border-[')) {
        const arbValue = cls.slice(8, -1); // Extract content between [ and ]
        // Keep if it's not a color (doesn't contain # or rgba)
        return !arbValue.includes('#') && !arbValue.startsWith('rgba(');
      }
      // Check other prefixes
      return !mapping.remove.some((prefix) => {
        if (prefix === cls) return true;
        return cls.startsWith(prefix);
      });
    });
  } else if (styleKey === 'borderWidth' || styleKey === 'borderTopWidth' || styleKey === 'borderRightWidth' || styleKey === 'borderBottomWidth' || styleKey === 'borderLeftWidth') {
    // Special handling for border width - don't remove border-dashed, border-dotted, etc.
    updatedClasses = updatedClasses.filter((cls) => {
      // Keep border-style classes
      if (cls === 'border-solid' || cls === 'border-dashed' || cls === 'border-dotted' || cls === 'border-double' || cls === 'border-none') {
        return true;
      }
      // Keep border-color classes (border-[#...] or border-[rgba(...)])
      if (cls.startsWith('border-[') && (cls.includes('#') || cls.includes('rgba('))) {
        return true;
      }
      // Check other prefixes
      return !mapping.remove.some((prefix) => {
        if (prefix === cls) return true;
        return cls.startsWith(prefix);
      });
    });
  } else {
    updatedClasses = removeClassesWithPrefix(updatedClasses, mapping.remove);
  }

  // Add new class if provided
  if (mapping.add) {
    const newClass = mapping.add(styleValue);
    if (newClass) {
      updatedClasses.push(newClass);
    }
  }

  return updatedClasses.join(' ');
}

/**
 * Batch update multiple styles at once
 */
export function updateTailwindClassNames(
  currentClassName: string,
  updates: StyleUpdate[]
): string {
  let result = currentClassName;

  for (const { styleKey, styleValue } of updates) {
    result = updateTailwindClassName(result, styleKey, styleValue);
  }

  return result;
}
