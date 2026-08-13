/**
 * @file Tests for isEditableSourcePath — the editability predicate that decides whether a
 * clicked element resolves to its own source (HYP-1006).
 */

import { describe, expect, it } from 'bun:test';
import { isEditableSourcePath } from './editable-source';

describe('isEditableSourcePath', () => {
  it('treats first-party project files as editable (relative, absolute, /@fs/, monorepo)', () => {
    expect(isEditableSourcePath('src/components/Feed.tsx')).toBe(true);
    expect(isEditableSourcePath('/app/src/components/Feed.tsx')).toBe(true);
    expect(isEditableSourcePath('/Users/me/proj/src/App.tsx')).toBe(true);
    expect(isEditableSourcePath('packages/ui/src/Button.tsx')).toBe(true);
    // Vite /@fs/ is a PATH prefix, not a scheme — stays editable (canonicalized downstream).
    expect(isEditableSourcePath('/@fs/Users/me/mono/packages/ui/src/Card.tsx')).toBe(true);
    // Windows path (backslashes, drive letter) — not a URL scheme.
    expect(isEditableSourcePath('C:\\proj\\src\\App.tsx')).toBe(true);
  });

  it('rejects node_modules dependency internals', () => {
    expect(isEditableSourcePath('node_modules/@acme/ui/dist/button.js')).toBe(false);
    expect(isEditableSourcePath('/app/node_modules/react-dom/index.js')).toBe(false);
    expect(isEditableSourcePath('project/node_modules/.vite/deps/chunk.js')).toBe(false);
  });

  it('rejects synthetic preview scaffolding', () => {
    expect(isEditableSourcePath('src/__canvas_preview__.tsx')).toBe(false);
  });

  it('rejects non-file source identifiers (URL schemes, virtual modules, data URIs)', () => {
    // A cold React-19 _debugStack frame carries a served URL; a fabricated one must never be
    // committed as a nodeRef / read from disk.
    expect(isEditableSourcePath('http://localhost:5173/src/App.tsx')).toBe(false);
    expect(isEditableSourcePath('https://evil.example/x.tsx')).toBe(false);
    expect(isEditableSourcePath('webpack-internal:///./src/App.tsx')).toBe(false);
    expect(isEditableSourcePath('file:///etc/passwd')).toBe(false);
    expect(isEditableSourcePath('ws://localhost/x')).toBe(false);
    expect(isEditableSourcePath('virtual:my-module')).toBe(false);
    expect(isEditableSourcePath('\0virtual-module')).toBe(false);
    expect(isEditableSourcePath('data:text/javascript,alert(1)')).toBe(false);
    expect(isEditableSourcePath('blob:http://localhost:5173/9a1c-uuid')).toBe(false);
    expect(isEditableSourcePath('about:blank')).toBe(false);
  });

  it('rejects empty / absent', () => {
    expect(isEditableSourcePath('')).toBe(false);
    expect(isEditableSourcePath(null)).toBe(false);
    expect(isEditableSourcePath(undefined)).toBe(false);
  });
});
