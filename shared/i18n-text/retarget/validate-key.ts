/**
 * @file Single source of truth for i18n key validation (prototype-pollution + structural safety).
 *
 * Accessed via: the orchestrator (defense in depth) AND the server route security gate. Sharing
 *   one validator means the wire boundary and the core agree on exactly which keys are legal — a
 *   forged request can't slip a key past one layer that the other would have rejected.
 *
 * Rejects: empty, over-long, control chars, JSX-structural chars ({,},<,>) — these would corrupt
 *   the `{t("KEY")}` rewrite — and any dot-segment that is a prototype-pollution vector
 *   (__proto__, prototype, constructor) or a dunder segment.
 */

const MAX_KEY_LEN = 256;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function isValidI18nKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > MAX_KEY_LEN) return false;
  // JSX-structural chars ({ } < >) would corrupt the `{t("KEY")}` rewrite.
  if (/[\n\r{}<>]/.test(key)) return false;
  // NUL is rejected separately (a control char in a regex trips the linter; an includes() is
  // both clearer and avoids the warning).
  if (key.includes('\0')) return false;
  // Prototype-pollution: reject any segment that is a known pollution vector or a dunder.
  for (const segment of key.split('.')) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return false;
    if (segment.startsWith('__') && segment.endsWith('__')) return false;
  }
  return true;
}
