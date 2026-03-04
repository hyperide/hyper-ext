import { describe, expect, it } from 'bun:test';
import { detectExportStyle, escapeRegex, extractComponentName, scanSampleExports } from '../scanner';

describe('scanSampleExports', () => {
  it('should find exported const Sample* functions', () => {
    const source = `
      export const SampleDefault = () => <Button>Click</Button>;
      export const SamplePrimary = () => <Button variant="primary">Primary</Button>;
    `;
    expect(scanSampleExports(source)).toEqual(['SampleDefault', 'SamplePrimary']);
  });

  it('should find exported function Sample* declarations', () => {
    const source = `
      export function SampleDefault() { return <Card />; }
      export function SampleWithProps() { return <Card title="test" />; }
    `;
    expect(scanSampleExports(source)).toEqual(['SampleDefault', 'SampleWithProps']);
  });

  it('should return empty array when no Sample* exports exist', () => {
    const source = `
      export default function Button() { return <button>Click</button>; }
      const sample = 'not an export';
    `;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should not match non-exported Sample*', () => {
    const source = `
      const SampleDefault = () => <div />;
      function SampleOther() { return <div />; }
    `;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should not match Sample followed by lowercase', () => {
    const source = `
      export const Sampledefault = () => <div />;
    `;
    expect(scanSampleExports(source)).toEqual([]);
  });
});

describe('extractComponentName', () => {
  it('should extract from export default function', () => {
    const source = `export default function Button() { return <button />; }`;
    expect(extractComponentName(source, 'Button.tsx')).toBe('Button');
  });

  it('should extract from export default class', () => {
    const source = `export default class MyWidget extends React.Component {}`;
    expect(extractComponentName(source, 'Widget.tsx')).toBe('MyWidget');
  });

  it('should extract from export default identifier', () => {
    const source = `
      function Card() { return <div />; }
      export default Card;
    `;
    expect(extractComponentName(source, 'Card.tsx')).toBe('Card');
  });

  it('should extract first PascalCase named export, skipping Sample*', () => {
    const source = `
      export const SampleDefault = () => <div />;
      export const SamplePrimary = () => <div />;
      export function NavigationBar() { return <nav />; }
    `;
    expect(extractComponentName(source, 'NavBar.tsx')).toBe('NavigationBar');
  });

  it('should fallback to filename', () => {
    const source = `const x = 42; console.log(x);`;
    expect(extractComponentName(source, 'MyComponent.tsx')).toBe('MyComponent');
  });

  it('should strip extension from filename fallback', () => {
    const source = `const x = 1;`;
    expect(extractComponentName(source, 'Header.tsx')).toBe('Header');
  });
});

describe('detectExportStyle', () => {
  it('should detect default-named for export default function', () => {
    const source = `export default function Button() { return <button />; }`;
    expect(detectExportStyle(source, 'Button')).toBe('default-named');
  });

  it('should detect default-named for export default class', () => {
    const source = `export default class Button extends React.Component {}`;
    expect(detectExportStyle(source, 'Button')).toBe('default-named');
  });

  it('should detect default-anonymous for export default Identifier;', () => {
    const source = `
      const Button = () => <button />;
      export default Button;
    `;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should detect named for export const/function', () => {
    const source = `export function Button() { return <button />; }`;
    expect(detectExportStyle(source, 'Button')).toBe('named');
  });

  it('should detect named when no default export exists', () => {
    const source = `export const Card = () => <div />;`;
    expect(detectExportStyle(source, 'Card')).toBe('named');
  });

  it('should detect default-anonymous without semicolon', () => {
    const source = `const Button = () => <button />\nexport default Button`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should detect default-anonymous without semicolon (trailing newline)', () => {
    const source = `const Button = () => <button />\nexport default Button\n`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should not match export default inside a comment', () => {
    const source = `// export default function Button() {}
export function Button() { return <button />; }`;
    expect(detectExportStyle(source, 'Button')).toBe('named');
  });

  it('should not match export default inside a string literal', () => {
    const source = `const msg = "export default function Button() {}";
export function Button() { return <button />; }`;
    expect(detectExportStyle(source, 'Button')).toBe('named');
  });

  it('should detect default-anonymous with trailing comment', () => {
    const source = `const Button = () => <button />;
export default Button; // re-export for compat`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should detect default-anonymous for memo-wrapped export', () => {
    const source = `function Button() { return <button />; }
export default memo(Button);`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should detect default-anonymous for React.memo wrapped export', () => {
    const source = `function Button() { return <button />; }
export default React.memo(Button);`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });

  it('should detect default-anonymous for forwardRef wrapped export', () => {
    const source = `function Button() { return <button />; }
export default forwardRef(Button);`;
    expect(detectExportStyle(source, 'Button')).toBe('default-anonymous');
  });
});

describe('scanSampleExports — edge cases', () => {
  it('should not match commented-out exports (single-line comment)', () => {
    const source = `// export const SampleDefault = () => <div />;
export function Button() { return <button />; }`;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should not match commented-out exports (block comment)', () => {
    const source = `/* export const SampleDefault = () => <div />; */
export function Button() { return <button />; }`;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should not match exports inside string literals', () => {
    const source = `const template = "export const SampleDefault = () => <div/>";
export function Button() { return <button />; }`;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should not match exports inside template literals', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing template literal content, not an actual interpolation
    const source = 'const template = `export const SampleDefault = () => <div/>`;';
    expect(scanSampleExports(source)).toEqual([]);
  });
});

describe('extractComponentName — edge cases', () => {
  it('should not extract from a comment containing export default', () => {
    const source = `// export default function OldButton() {}
export function NewButton() { return <button/>; }`;
    expect(extractComponentName(source, 'Button.tsx')).toBe('NewButton');
  });

  it('should not extract from a string literal containing export default', () => {
    const source = `const msg = 'export default function FakeComp() {}';
export function RealComp() { return <div/>; }`;
    expect(extractComponentName(source, 'Comp.tsx')).toBe('RealComp');
  });

  it('should extract from React.memo wrapped default export', () => {
    const source = `function MyButton() { return <button/>; }
export default React.memo(MyButton);`;
    // Filename is different — ensures we extract from memo() arg, not fallback
    expect(extractComponentName(source, 'index.tsx')).toBe('MyButton');
  });

  it('should handle component names with underscores', () => {
    const source = `export function My_Component() { return <div/>; }`;
    expect(extractComponentName(source, 'index.tsx')).toBe('My_Component');
  });

  it('should extract from re-export syntax', () => {
    const source = `export { default as Button } from './BaseButton';`;
    expect(extractComponentName(source, 'index.tsx')).toBe('Button');
  });
});

describe('escapeRegex', () => {
  it('should escape all regex metacharacters', () => {
    const input = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(input);
    // Every metacharacter should be preceded by backslash
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    // The escaped string should work in a regex to match the original
    const re = new RegExp(escaped);
    expect(re.test(input)).toBe(true);
  });

  it('should not modify strings without metacharacters', () => {
    expect(escapeRegex('Button')).toBe('Button');
    expect(escapeRegex('MyComponent123')).toBe('MyComponent123');
  });

  it('should handle component name with dollar sign', () => {
    const name = '$Button';
    const escaped = escapeRegex(name);
    const re = new RegExp(`export default ${escaped}`);
    expect(re.test('export default $Button')).toBe(true);
    // Without escaping, $ would match end-of-string
    expect(re.test('export default xButton')).toBe(false);
  });
});
