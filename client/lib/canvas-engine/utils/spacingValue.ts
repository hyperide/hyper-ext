/**
 * Module for handling spacing values (margin, padding) that can be:
 * - Single value: "auto", "1.5rem", "0"
 * - Paired value: "0, 1.5rem" (top/bottom or left/right)
 */

export interface SpacingPair {
  first: string; // top or left
  second: string; // bottom or right
}

/**
 * Parse a spacing value that may contain comma-separated pair
 * @example "0, 1.5rem" => { first: "0", second: "1.5rem" }
 * @example "auto" => { first: "auto", second: "auto" }
 * @example "" => { first: "", second: "" }
 */
export function parseSpacingValue(value: string): SpacingPair {
  if (!value) {
    return { first: '', second: '' };
  }

  const trimmed = value.trim();

  // Check for comma-separated pair
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim());
    return {
      first: parts[0] || '',
      second: parts[1] || '',
    };
  }

  // Single value applies to both
  return { first: trimmed, second: trimmed };
}

/**
 * Format spacing pair for display
 * @example { first: "0", second: "1.5rem" } => "0, 1.5rem"
 * @example { first: "auto", second: "auto" } => "auto"
 * @example { first: "", second: "1.5rem" } => "0, 1.5rem"
 */
export function formatSpacingValue(first: string, second: string): string {
  const normalizedFirst = first || '';
  const normalizedSecond = second || '';

  // Both empty
  if (!normalizedFirst && !normalizedSecond) {
    return '';
  }

  // Same value - show single
  if (normalizedFirst === normalizedSecond) {
    return normalizedFirst;
  }

  // Different values - show pair with "0" for empty
  return `${normalizedFirst || '0'}, ${normalizedSecond || '0'}`;
}

/**
 * Determine if the value represents a paired (different) spacing
 */
export function isPairedSpacing(first: string, second: string): boolean {
  return first !== second;
}

/**
 * Handle input change for spacing field
 * Returns updated first and second values based on input
 *
 * Logic:
 * - If input contains comma: parse as pair, update both values
 * - If input is single value: update first value, keep second unchanged
 *   (or sync second if they were equal before)
 */
export function handleSpacingInput(inputValue: string, currentFirst: string, currentSecond: string): SpacingPair {
  const trimmed = inputValue.trim();

  // If input contains comma, parse as pair
  if (trimmed.includes(',')) {
    const parsed = parseSpacingValue(trimmed);
    return {
      first: normalizeSpacingValue(parsed.first),
      second: normalizeSpacingValue(parsed.second),
    };
  }

  // Single value input
  const normalized = normalizeSpacingValue(trimmed);

  // If values were equal before, sync them
  if (currentFirst === currentSecond) {
    return { first: normalized, second: normalized };
  }

  // Otherwise just update first value
  return { first: normalized, second: currentSecond };
}

/**
 * Normalize spacing value:
 * - "0" stays as "0"
 * - "" stays as ""
 * - Values are trimmed
 */
export function normalizeSpacingValue(value: string): string {
  const trimmed = value.trim();

  // Keep "0" as is (don't convert to empty)
  if (trimmed === '0') {
    return '0';
  }

  return trimmed;
}

/**
 * Check if a value represents zero (empty or "0")
 */
export function isZeroValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '0';
}

/**
 * Get display value for a spacing field based on link state
 * @param first - First value (top or left)
 * @param second - Second value (bottom or right)
 * @param isLinked - Whether showing 4 separate fields (true) or 2 combined fields (false)
 */
export function getSpacingDisplayValue(first: string, second: string, isLinked: boolean): string {
  if (isLinked) {
    // 4 fields mode: show individual value
    return first;
  }

  // 2 fields mode: show combined value
  return formatSpacingValue(first, second);
}

/**
 * Update spacing values when user edits a combined field
 * @param inputValue - Value entered by user
 * @param currentFirst - Current first value
 * @param currentSecond - Current second value
 * @param isLinked - Whether in 4-field mode
 * @returns Object with new first and second values, and which ones changed
 */
export function updateSpacingFromInput(
  inputValue: string,
  currentFirst: string,
  currentSecond: string,
  isLinked: boolean,
): {
  first: string;
  second: string;
  firstChanged: boolean;
  secondChanged: boolean;
} {
  if (isLinked) {
    // 4 fields mode: just update the first value
    const normalized = normalizeSpacingValue(inputValue);
    return {
      first: normalized,
      second: currentSecond,
      firstChanged: normalized !== currentFirst,
      secondChanged: false,
    };
  }

  // 2 fields mode: handle comma-separated or single value
  const result = handleSpacingInput(inputValue, currentFirst, currentSecond);

  return {
    first: result.first,
    second: result.second,
    firstChanged: result.first !== currentFirst,
    secondChanged: result.second !== currentSecond,
  };
}

/**
 * Determine which part of a comma-separated value the cursor is in
 * @param displayValue - The displayed value (e.g., "0, 1.5rem")
 * @param cursorPosition - The cursor position in the input
 * @returns 'first' if cursor is before comma, 'second' if after
 */
export function getCursorPart(displayValue: string, cursorPosition: number): 'first' | 'second' {
  const commaIndex = displayValue.indexOf(',');

  // No comma - single value, always 'first'
  if (commaIndex === -1) {
    return 'first';
  }

  // Cursor is before or at comma - first part
  // Cursor is after comma - second part
  return cursorPosition <= commaIndex ? 'first' : 'second';
}

/**
 * Parse a numeric value from spacing string
 * @example "1.5rem" => { value: 1.5, unit: "rem" }
 * @example "10px" => { value: 10, unit: "px" }
 * @example "auto" => null
 * @example "0" => { value: 0, unit: "" }
 */
export function parseNumericValue(str: string): { value: number; unit: string } | null {
  const trimmed = str.trim();

  if (!trimmed || trimmed === 'auto') {
    return null;
  }

  // Match number (including decimals and negatives) followed by optional unit
  const match = trimmed.match(/^(-?\d*\.?\d+)(.*)$/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2] || '';

  if (Number.isNaN(value)) {
    return null;
  }

  return { value, unit };
}

/**
 * Increment or decrement a spacing value
 * @param currentValue - Current value string (e.g., "1.5rem", "10px", "0")
 * @param delta - Amount to change (+1 or -1)
 * @param step - Step size (default 1 for integers, 0.25 for rem)
 * @returns New value string
 */
export function incrementSpacingValue(currentValue: string, delta: number, step?: number): string {
  const parsed = parseNumericValue(currentValue);

  if (!parsed) {
    // Can't increment non-numeric values like "auto"
    // Start from 0 if empty
    if (!currentValue.trim()) {
      return delta > 0 ? '1' : '0';
    }
    return currentValue;
  }

  // Determine step based on unit
  const actualStep = step ?? (parsed.unit === 'rem' || parsed.unit === 'em' ? 0.25 : 1);

  const newValue = parsed.value + delta * actualStep;

  // Don't go below 0 for positive units
  const clampedValue = Math.max(0, newValue);

  // Format with appropriate precision
  const formatted =
    parsed.unit === 'rem' || parsed.unit === 'em'
      ? clampedValue.toFixed(2).replace(/\.?0+$/, '')
      : Math.round(clampedValue).toString();

  return formatted + parsed.unit;
}

/**
 * Handle arrow key press for spacing field with comma-separated values
 * @param displayValue - Current display value
 * @param cursorPosition - Cursor position in input
 * @param currentFirst - Current first value
 * @param currentSecond - Current second value
 * @param delta - +1 for up arrow, -1 for down arrow
 * @param isLinked - Whether in 4-field mode
 * @returns Updated values and which changed
 */
export function handleSpacingArrowKey(
  displayValue: string,
  cursorPosition: number,
  currentFirst: string,
  currentSecond: string,
  delta: number,
  isLinked: boolean,
): {
  first: string;
  second: string;
  firstChanged: boolean;
  secondChanged: boolean;
} {
  if (isLinked) {
    // 4 fields mode: just update first
    const newFirst = incrementSpacingValue(currentFirst, delta);
    return {
      first: newFirst,
      second: currentSecond,
      firstChanged: newFirst !== currentFirst,
      secondChanged: false,
    };
  }

  // 2 fields mode: determine which part to update based on cursor
  const part = getCursorPart(displayValue, cursorPosition);

  if (part === 'first') {
    const newFirst = incrementSpacingValue(currentFirst || '0', delta);
    return {
      first: newFirst,
      second: currentSecond,
      firstChanged: newFirst !== currentFirst,
      secondChanged: false,
    };
  }

  const newSecond = incrementSpacingValue(currentSecond || '0', delta);
  return {
    first: currentFirst,
    second: newSecond,
    firstChanged: false,
    secondChanged: newSecond !== currentSecond,
  };
}
