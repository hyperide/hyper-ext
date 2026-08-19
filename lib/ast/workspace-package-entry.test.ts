/**
 * @file Direct unit tests for `resolveWorkspacePackageEntry` (HYP-1235) — the shared, security-
 * hardened workspace-package resolver both `component-forwarding.ts` (HYP-995) and
 * `forward-detect-locate.ts` (A1) call. Ported/generalized from `component-forwarding.test.ts`'s
 * original "conloca case" + traversal/entry-escape security tests, which exercised this logic only
 * indirectly through `resolveComponentForwarding`. A 3-model `review diff` round on HYP-1235 flagged
 * that the module's own header claimed these tests existed at this level before they did — this file
 * makes that claim true, and gives the NEW consumer (`locateComponentDeclaration`, via
 * `forward-detect.test.ts`'s workspace-package cases) a directly-tested shared foundation instead of
 * only happy-path coverage through the detector.
 */
import { describe, expect, it } from 'bun:test';
import { parseCode } from './parser';
import { InMemoryFileIO } from '../style-write/testing/in-memory-file-io';
import { resolveWorkspacePackageEntry } from './workspace-package-entry';

const PAGE = '/project/src/Page.tsx';

describe('resolveWorkspacePackageEntry', () => {
  it('resolves a workspace package whose exports["."] entry is real .ts source', async () => {
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      '/project/node_modules/@acme/ui/src/index.ts': `export { Card } from './Card';\n`,
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toEqual({ specifier: '@acme/ui', entryBase: '/project/node_modules/@acme/ui/src/index' });
  });

  it('falls back through module/main/types when exports is absent', async () => {
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ main: './src/index.tsx' }),
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toEqual({ specifier: '@acme/ui', entryBase: '/project/node_modules/@acme/ui/src/index' });
  });

  it('rejects a traversal specifier — never reads outside node_modules (security)', async () => {
    const pageSrc = `import { Card } from 'foo/../../../etc';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      // A package.json planted OUTSIDE where a safe resolve would look — must never be read.
      '/etc/package.json': JSON.stringify({ main: './x.tsx' }),
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });

  it('rejects a package whose entry escapes the package dir (security)', async () => {
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ main: '../../../../etc/evil.tsx' }),
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });

  it('rejects a built (.js) entry — a real external package stays unresolved', async () => {
    const pageSrc = `import { Card } from 'built-ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/built-ui/package.json': JSON.stringify({ main: './dist/index.js' }),
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });

  it('rejects a .d.ts entry — a types-only package has no function bodies to inspect', async () => {
    const pageSrc = `import { Card } from '@acme/ui';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({
      [PAGE]: pageSrc,
      '/project/node_modules/@acme/ui/package.json': JSON.stringify({ types: './dist/index.d.ts' }),
    });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });

  it('returns null when there is no import for the tag at all', async () => {
    const pageSrc = `export function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({ [PAGE]: pageSrc });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });

  it('returns null for a relative import (never a workspace-package case)', async () => {
    const pageSrc = `import { Card } from './Card';\nexport function Page() {\n  return (<Card />);\n}\n`;
    const fileIO = new InMemoryFileIO({ [PAGE]: pageSrc, '/project/src/Card.tsx': 'export const Card = () => null;\n' });
    const ast = parseCode(pageSrc);
    const result = await resolveWorkspacePackageEntry({ ast, filePath: PAGE, fileIO }, 'Card');
    expect(result).toBeNull();
  });
});
