import { isOwnedJsonSnapshot } from './json-draft.mjs';

/** Retain a privately owned immutable value for later work; otherwise capture a private clone. */
export function captureJsonSnapshot(value) {
  return isOwnedJsonSnapshot(value) ? value : structuredClone(value);
}
