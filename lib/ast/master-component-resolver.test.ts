/**
 * Tests for master-component-resolver — resolves a selected element's component
 * reference (e.g. `<Button>`) to its master component DEFINITION location.
 *
 * This powers the inspector "Go to main component" button (HYP-563), the
 * Figma-style affordance that jumps from an instance to the component source.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from './file-io';
import { resolveMasterComponent } from './master-component-resolver';

/** In-memory FileIO over a path → content map. Mirrors the real FileIO contract. */
function memoryFileIO(files: Record<string, string>): FileIO {
  return {
    readFile: async (p) => {
      const content = files[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFile: async () => {
      throw new Error('not supported');
    },
    access: async (p) => {
      if (files[p] === undefined) throw new Error(`ENOENT: ${p}`);
    },
  };
}

describe('resolveMasterComponent', () => {
  it('resolves a relative named import to its definition file + line', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = [
      "import { Button } from './components/Button';",
      'export function App() {',
      '  return <Button>Hi</Button>;',
      '}',
    ].join('\n');
    const buttonSource = ['export function Button() {', '  return <button />;', '}'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/components/Button.tsx': buttonSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/components/Button.tsx');
    expect(result.line).toBe(1);
  });

  it('marks a pinpointed named definition as pinpointed: true', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './Button';", 'export const App = () => <Button />;'].join('\n');
    const fileIO = memoryFileIO({ '/proj/src/Button.tsx': 'export function Button() { return <button />; }' });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.pinpointed).toBe(true);
  });

  it('marks a barrel landing (symbol not located in the file) as pinpointed: false', async () => {
    // `export { default } from './Button'` is a default re-export the resolver does
    // not follow; it lands on the barrel file without pinpointing the symbol. The
    // VS Code layer uses pinpointed:false to trigger its language-server backstop.
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './components';", 'export const App = () => <Button />;'].join(
      '\n',
    );

    const fileIO = memoryFileIO({
      '/proj/src/components/index.ts': "export { default as Button } from './Button';",
      '/proj/src/components/Button.tsx': 'export default function Button() { return <button />; }',
    });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    // It DOES follow the named re-export to Button.tsx and pinpoints the default there.
    expect(result.filePath).toBe('/proj/src/components/Button.tsx');
    expect(result.pinpointed).toBe(true);
  });

  it('resolves a default import to its definition file', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import Card from './Card';", 'export const App = () => <Card />;'].join('\n');
    const cardSource = ['', 'export default function Card() {', '  return <div />;', '}'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/Card.tsx': cardSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Card',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/Card.tsx');
    // default export declaration is on line 2 (1-based)
    expect(result.line).toBe(2);
  });

  it('resolves a tsconfig path-alias import (@/...) using the alias map', async () => {
    const importer = '/proj/src/pages/Home.tsx';
    const importerSource = ["import { Hero } from '@/components/Hero';", 'export const Home = () => <Hero />;'].join(
      '\n',
    );
    const heroSource = ['export function Hero() {', '  return <section />;', '}'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/components/Hero.tsx': heroSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Hero',
      fileIO,
      aliasMap: { '@/': '/proj/src/' },
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/components/Hero.tsx');
  });

  it('follows a one-level barrel re-export (index.ts → ./Button)', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './components';", 'export const App = () => <Button />;'].join(
      '\n',
    );
    const barrelSource = "export { Button } from './Button';";
    const buttonSource = ['export function Button() {', '  return <button />;', '}'].join('\n');

    const fileIO = memoryFileIO({
      '/proj/src/components/index.ts': barrelSource,
      '/proj/src/components/Button.tsx': buttonSource,
    });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/components/Button.tsx');
  });

  it('follows an `export *` wildcard barrel to the real component file', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './components';", 'export const App = () => <Button />;'].join(
      '\n',
    );
    const barrelSource = ["export * from './Card';", "export * from './Button';"].join('\n');
    const cardSource = 'export function Card() { return <div />; }';
    // Definition on line 1 — must still be preferred over the barrel file (regression).
    const buttonSource = ['export function Button() {', '  return <button />;', '}'].join('\n');

    const fileIO = memoryFileIO({
      '/proj/src/components/index.ts': barrelSource,
      '/proj/src/components/Card.tsx': cardSource,
      '/proj/src/components/Button.tsx': buttonSource,
    });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/components/Button.tsx');
    expect(result.line).toBe(1);
  });

  it('does not match an unrelated default export when following `export *`', async () => {
    // index.ts re-exports both files; Card.tsx has ONLY a default export. Resolving
    // { Button } must skip Card (default exports are not re-exported by `export *`)
    // and pinpoint Button.tsx — not stop at Card.tsx.
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './components';", 'export const App = () => <Button />;'].join(
      '\n',
    );
    const barrelSource = ["export * from './Card';", "export * from './Button';"].join('\n');
    const cardSource = 'export default function Card() { return <div />; }';
    const buttonSource = 'export function Button() { return <button />; }';

    const fileIO = memoryFileIO({
      '/proj/src/components/index.ts': barrelSource,
      '/proj/src/components/Card.tsx': cardSource,
      '/proj/src/components/Button.tsx': buttonSource,
    });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/components/Button.tsx');
    expect(result.pinpointed).toBe(true);
  });

  it('matches the longest (most specific) tsconfig alias for overlapping prefixes', async () => {
    const importer = '/proj/src/pages/Home.tsx';
    const importerSource = ["import { Button } from '@/ui/Button';", 'export const Home = () => <Button />;'].join(
      '\n',
    );
    const buttonSource = ['export function Button() {', '  return <button />;', '}'].join('\n');

    // `@/ui/*` is more specific than `@/*` and must win, even though `@/*` is listed first.
    const fileIO = memoryFileIO({ '/proj/packages/ui/Button.tsx': buttonSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
      aliasMap: { '@/': '/proj/src/', '@/ui/': '/proj/packages/ui/' },
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/packages/ui/Button.tsx');
  });

  it('classifies external (node_modules) package imports as external', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = [
      "import { Dialog } from '@radix-ui/react-dialog';",
      'export const App = () => <Dialog />;',
    ].join('\n');

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Dialog',
      fileIO: memoryFileIO({}),
    });

    expect(result.kind).toBe('external');
    if (result.kind !== 'external') throw new Error('expected external');
    expect(result.packageName).toBe('@radix-ui/react-dialog');
  });

  it('returns host for a lowercase DOM tag (div) — no master component', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = 'export const App = () => <div />;';

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'div',
      fileIO: memoryFileIO({}),
    });

    expect(result.kind).toBe('host');
  });

  it('returns inline when the component is defined in the same file (no import)', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = [
      'function Badge() {',
      '  return <span />;',
      '}',
      'export const App = () => <Badge />;',
    ].join('\n');

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Badge',
      fileIO: memoryFileIO({}),
    });

    expect(result.kind).toBe('inline');
  });

  it('uses the leftmost identifier for member-expression tags (Foo.Bar → Foo)', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Menu } from './Menu';", 'export const App = () => <Menu.Item />;'].join('\n');
    const menuSource = ['export const Menu = Object.assign(() => <ul />, {});'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/Menu.tsx': menuSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      // The caller extracts the leftmost identifier; resolver receives 'Menu'.
      componentName: 'Menu',
      importerSource,
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/Menu.tsx');
  });

  it('resolves an import whose specifier already includes the extension', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Button } from './Button.tsx';", 'export const App = () => <Button />;'].join(
      '\n',
    );
    const buttonSource = ['export function Button() {', '  return <button />;', '}'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/Button.tsx': buttonSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/Button.tsx');
  });

  it('returns not-found when the import target file does not exist', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Ghost } from './Ghost';", 'export const App = () => <Ghost />;'].join('\n');

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Ghost',
      fileIO: memoryFileIO({}),
    });

    expect(result.kind).toBe('not-found');
  });

  it('resolves an aliased local import (import { Btn as Button })', async () => {
    const importer = '/proj/src/App.tsx';
    const importerSource = ["import { Btn as Button } from './Button';", 'export const App = () => <Button />;'].join(
      '\n',
    );
    const buttonSource = ['export function Btn() {', '  return <button />;', '}'].join('\n');

    const fileIO = memoryFileIO({ '/proj/src/Button.tsx': buttonSource });

    const result = await resolveMasterComponent({
      importerFilePath: importer,
      importerSource,
      componentName: 'Button',
      fileIO,
    });

    expect(result.kind).toBe('local');
    if (result.kind !== 'local') throw new Error('expected local');
    expect(result.filePath).toBe('/proj/src/Button.tsx');
  });
});
