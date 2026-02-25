/**
 * Naming utilities for test ID generation
 *
 * Provides kebab-case conversion and collision handling
 */

/**
 * Convert string to kebab-case
 * @example toKebabCase('ButtonPrimary') => 'button-primary'
 * @example toKebabCase('onClick handler') => 'on-click-handler'
 * @example toKebabCase('data_testId') => 'data-test-id'
 */
export function toKebabCase(str: string): string {
  return str
    // Handle camelCase and PascalCase
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    // Handle uppercase sequences (e.g., HTMLParser -> html-parser)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    // Replace underscores and spaces with hyphens
    .replace(/[_\s]+/g, '-')
    // Remove non-alphanumeric characters except hyphens
    .replace(/[^a-zA-Z0-9-]/g, '')
    // Convert to lowercase
    .toLowerCase()
    // Remove consecutive hyphens
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-|-$/g, '');
}

/**
 * Clean and normalize text for use in test ID
 * Extracts meaningful words, removes filler words
 */
export function cleanTextForId(text: string): string {
  const fillerWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'this', 'that', 'these', 'those', 'it', 'its',
  ]);

  return text
    // Remove JSX expressions like {variable}
    .replace(/\{[^}]+\}/g, '')
    // Split into words
    .split(/\s+/)
    // Filter out filler words and empty strings
    .filter(word => word.length > 0 && !fillerWords.has(word.toLowerCase()))
    // Take first 4 meaningful words
    .slice(0, 4)
    // Join with spaces (will be converted to kebab later)
    .join(' ')
    .trim();
}

/**
 * Generate a unique test ID by appending an index if collision exists
 */
export function resolveCollision(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 1;
  let newId = `${baseId}-${index}`;
  while (existingIds.has(newId)) {
    index++;
    newId = `${baseId}-${index}`;
  }
  return newId;
}

/**
 * Map common element types to semantic roles
 */
export const elementTypeToRole: Record<string, string> = {
  button: 'button',
  input: 'input',
  select: 'select',
  textarea: 'textarea',
  a: 'link',
  checkbox: 'checkbox',
  radio: 'radio',
  switch: 'switch',
  slider: 'slider',
  'dialog-trigger': 'trigger',
  'dropdown-trigger': 'trigger',
  'popover-trigger': 'trigger',
  'accordion-trigger': 'trigger',
  'tab-trigger': 'tab',
  'menu-trigger': 'trigger',
  'combobox-trigger': 'trigger',
  'tooltip-trigger': 'trigger',
};

/**
 * Get role from input type attribute
 */
export function getInputRole(inputType?: string): string {
  const typeToRole: Record<string, string> = {
    text: 'input',
    email: 'email-input',
    password: 'password-input',
    number: 'number-input',
    search: 'search-input',
    tel: 'phone-input',
    url: 'url-input',
    date: 'date-input',
    time: 'time-input',
    datetime: 'datetime-input',
    'datetime-local': 'datetime-input',
    month: 'month-input',
    week: 'week-input',
    color: 'color-input',
    file: 'file-input',
    range: 'slider',
    checkbox: 'checkbox',
    radio: 'radio',
    submit: 'submit-button',
    reset: 'reset-button',
    button: 'button',
  };
  return typeToRole[inputType || 'text'] || 'input';
}

/**
 * Generate semantic test ID from context
 *
 * Priority order for naming:
 * 1. aria-label
 * 2. placeholder
 * 3. name attribute
 * 4. children text
 * 5. handler name (onClick -> 'click')
 * 6. element type
 */
export function generateSemanticTestId(
  context: {
    ariaLabel?: string;
    placeholder?: string;
    children?: string;
    name?: string;
    inputType?: string;
    role?: string;
    handler?: string;
  },
  elementType: string,
  componentContext: string,
  existingIds: Set<string>,
): string {
  const parts: string[] = [];

  // Add component context (e.g., 'login-form')
  if (componentContext) {
    parts.push(toKebabCase(componentContext));
  }

  // Determine semantic meaning from context
  let semantic = '';

  if (context.ariaLabel) {
    semantic = cleanTextForId(context.ariaLabel);
  } else if (context.placeholder) {
    semantic = cleanTextForId(context.placeholder);
  } else if (context.name) {
    semantic = context.name;
  } else if (context.children) {
    semantic = cleanTextForId(context.children);
  } else if (context.handler) {
    // Extract action from handler name (onSubmit -> submit, handleClick -> click)
    semantic = context.handler
      .replace(/^on/i, '')
      .replace(/^handle/i, '')
      .trim();
  }

  if (semantic) {
    parts.push(toKebabCase(semantic));
  }

  // Add element role
  const role = context.role || elementTypeToRole[elementType] || elementType;
  const inputRole = elementType === 'input' ? getInputRole(context.inputType) : role;
  parts.push(toKebabCase(inputRole));

  // Generate base ID
  const baseId = parts.filter(Boolean).join('-');

  // Resolve collisions
  return resolveCollision(baseId, existingIds);
}

/**
 * Validate test ID format
 */
export function isValidTestId(testId: string): boolean {
  // Must be kebab-case, no uppercase, no spaces, no special chars
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(testId);
}

/**
 * Suggest fixes for invalid test ID
 */
export function suggestTestIdFix(invalidId: string): string {
  return toKebabCase(invalidId);
}
