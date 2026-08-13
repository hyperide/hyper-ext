/**
 * @file Component name validation for the "New component" flow (HYP-1184).
 *
 * Accessed via: the CreateComponentDialog (live validation as the user types)
 *   and re-run host-side by create-component-file before touching disk —
 *   never trust the client copy alone.
 * Assumptions: pure, browser-safe, no fs. Messages are plain-language because
 *   the primary audience is non-programmers.
 */

/** File names frameworks reserve — creating them as components breaks routing. */
const RESERVED_NAMES: Record<string, true> = {
  index: true,
  page: true,
  layout: true,
  loading: true,
  error: true,
  template: true,
  default: true,
  route: true,
  notfound: true,
  middleware: true,
};

const MAX_NAME_LENGTH = 64;

/**
 * Validate a component name. Returns null when valid, otherwise a
 * plain-language error suitable for showing under the input.
 */
export function validateComponentName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for your component.';
  if (trimmed.length > MAX_NAME_LENGTH) return `That name is too long — keep it under ${MAX_NAME_LENGTH} characters.`;
  if (!/^[A-Z]/.test(trimmed)) return 'Start with a capital letter, like “ProfileCard”.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(trimmed)) return 'Use only letters and numbers — no spaces, dashes, or symbols.';
  if (RESERVED_NAMES[trimmed.toLowerCase()]) {
    return `“${trimmed}” is reserved by the framework — pick a different name.`;
  }
  return null;
}

/**
 * "DashboardPage" → "Dashboard", "ProfileCard" → "Profile Card".
 * Used for human-readable headings inside generated templates.
 */
export function humanizeComponentName(name: string): string {
  const withoutPageSuffix = name.endsWith('Page') && name.length > 'Page'.length ? name.slice(0, -'Page'.length) : name;
  return withoutPageSuffix.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}
