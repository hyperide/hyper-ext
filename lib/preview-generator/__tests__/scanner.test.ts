import { describe, expect, it } from 'bun:test';
import {
  detectCompoundExports,
  detectExportStyle,
  detectRouterShell,
  detectSSRHooks,
  escapeRegex,
  extractComponentName,
  extractDeclaredPropNames,
  scanSampleExports,
} from '../scanner';

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

  it('should include barrel re-export of Sample*', () => {
    const source = `export { SampleFoo } from './samples';`;
    expect(scanSampleExports(source)).toEqual(['SampleFoo']);
  });

  it('should exclude type-only export statement: export type { SampleFoo }', () => {
    const source = `export type { SampleFoo } from './types';`;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should exclude inline type specifier: export { type SampleFoo }', () => {
    const source = `export { type SampleFoo } from './types';`;
    expect(scanSampleExports(source)).toEqual([]);
  });

  it('should include value re-export but skip inline type among mixed specifiers', () => {
    const source = `export { SampleBar, type SampleFoo } from './samples';`;
    expect(scanSampleExports(source)).toEqual(['SampleBar']);
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

  it('should skip createContext exports and extract the provider component', () => {
    const source = `
      import { createContext } from 'react';
      export const LanguageContext = createContext(null);
      export function LanguageProvider({ children }: { children: React.ReactNode }) {
        return <LanguageContext.Provider value={null}>{children}</LanguageContext.Provider>;
      }
    `;
    expect(extractComponentName(source, 'LanguageContext.tsx')).toBe('LanguageProvider');
  });

  it('should extract styled tagged-template exports', () => {
    const source = `
      import styled from '@emotion/styled';
      export const LayoutRoot = styled.div\`
        display: flex;
      \`;
    `;
    expect(extractComponentName(source, 'Layout.tsx')).toBe('LayoutRoot');
  });

  it('should skip type-only export specifiers', () => {
    const source = `
      type ToastProps = { title: string };
      const ToastProvider = Provider.Root;
      const Toast = () => <div />;
      export { type ToastProps, ToastProvider, Toast };
    `;
    expect(extractComponentName(source, 'toast.tsx')).toBe('ToastProvider');
  });
});

describe('detectSSRHooks', () => {
  it('detects useLoaderData from @remix-run/react', () => {
    const source = `
      import { useLoaderData, Link } from "@remix-run/react";
      export default function Route() {
        const { tweets } = useLoaderData<typeof loader>();
        return <div>{tweets.map(t => t.id)}</div>;
      }
    `;
    const hooks = detectSSRHooks(source);
    expect(hooks.has('useLoaderData')).toBe(true);
    expect(hooks.has('useRouteLoaderData')).toBe(false);
    expect(hooks.size).toBe(1);
  });

  it('detects useRouteLoaderData from @remix-run/react', () => {
    const source = `
      import { useRouteLoaderData } from "@remix-run/react";
      export default function Child() {
        const data = useRouteLoaderData("root");
        return <div>{data.user}</div>;
      }
    `;
    const hooks = detectSSRHooks(source);
    expect(hooks.has('useRouteLoaderData')).toBe(true);
    expect(hooks.size).toBe(1);
  });

  it('detects both hooks when both imported', () => {
    const source = `
      import { useLoaderData, useRouteLoaderData, Link } from "@remix-run/react";
      export default function Route() { return null; }
    `;
    const hooks = detectSSRHooks(source);
    expect(hooks.has('useLoaderData')).toBe(true);
    expect(hooks.has('useRouteLoaderData')).toBe(true);
    expect(hooks.size).toBe(2);
  });

  it('returns empty set when no SSR hooks imported', () => {
    const source = `
      import { Link, Form } from "@remix-run/react";
      export default function Route() { return <Link to="/">Home</Link>; }
    `;
    expect(detectSSRHooks(source).size).toBe(0);
  });

  it('returns empty set when useLoaderData imported from wrong package', () => {
    const source = `
      import { useLoaderData } from "react-router-dom";
      export default function Route() { return null; }
    `;
    expect(detectSSRHooks(source).size).toBe(0);
  });

  it('returns empty set for plain React component', () => {
    const source = `
      import React from "react";
      export default function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `;
    expect(detectSSRHooks(source).size).toBe(0);
  });
});

describe('detectRouterShell', () => {
  it('returns true for BrowserRouter import from react-router-dom', () => {
    const source = `
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      const App = () => <BrowserRouter><Routes><Route path="/" element={<div />} /></Routes></BrowserRouter>;
      export default App;
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns true for StaticRouter import from react-router-dom/server', () => {
    const source = `
      import { StaticRouter } from 'react-router-dom/server';
      export default function App() { return <StaticRouter location="/"><div /></StaticRouter>; }
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns true for HashRouter import from react-router-dom', () => {
    const source = `
      import { HashRouter } from 'react-router-dom';
      export default function App() { return <HashRouter><div /></HashRouter>; }
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns true for React Navigation containers', () => {
    const source = `
      import { NavigationContainer } from '@react-navigation/native';
      export function AppNavigator() { return <NavigationContainer><div /></NavigationContainer>; }
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns true for React Navigation navigator factories', () => {
    const source = `
      import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
      const Tab = createBottomTabNavigator();
      export function BottomTabs() { return <Tab.Navigator />; }
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns true when BrowserRouter and StaticRouter are both imported (Bulka pattern)', () => {
    const source = `
      import { BrowserRouter, Routes, Route } from 'react-router-dom';
      import { StaticRouter } from 'react-router-dom/server';
      const isBrowser = typeof window !== 'undefined';
      function Router({ children }: { children: React.ReactNode }) {
        return isBrowser ? <BrowserRouter>{children}</BrowserRouter> : <StaticRouter location="/">{children}</StaticRouter>;
      }
      const App = () => <Router><Routes><Route path="/" element={<div />} /></Routes></Router>;
      export default App;
    `;
    expect(detectRouterShell(source)).toBe(true);
  });

  it('returns false for plain page component that only imports Link', () => {
    const source = `
      import { Link, useNavigate } from 'react-router-dom';
      export default function Index() { return <Link to="/">Home</Link>; }
    `;
    expect(detectRouterShell(source)).toBe(false);
  });

  it('returns false for component with no router imports at all', () => {
    const source = `
      import React from 'react';
      export default function Button({ label }: { label: string }) { return <button>{label}</button>; }
    `;
    expect(detectRouterShell(source)).toBe(false);
  });

  it('returns false when BrowserRouter is imported from an unrecognized package', () => {
    const source = `
      import { BrowserRouter } from 'my-custom-router';
      export default function App() { return <BrowserRouter><div /></BrowserRouter>; }
    `;
    expect(detectRouterShell(source)).toBe(false);
  });

  it('returns false when only MemoryRouter is imported (sample wrapper, not an app shell)', () => {
    const source = `
      import { MemoryRouter } from 'react-router-dom';
      export default function FillPicker() { return <div />; }
      export const SampleDefault = () => (
        <MemoryRouter initialEntries={['/projects/proj-1']}>
          <FillPicker />
        </MemoryRouter>
      );
    `;
    expect(detectRouterShell(source)).toBe(false);
  });

  it('returns false for type-only React Navigation props', () => {
    const source = `
      import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
      type Props = { navigation: NativeStackNavigationProp<{ Home: undefined }, 'Home'> };
      export function HomeScreen(_props: Props) { return <div />; }
    `;
    expect(detectRouterShell(source)).toBe(false);
  });
});

describe('detectCompoundExports', () => {
  it('returns compound components from Alert-style re-export pattern', () => {
    const source = `
      import * as React from 'react';
      const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        ({ className, ...props }, ref) => <div ref={ref} role="alert" className={className} {...props} />
      );
      Alert.displayName = 'Alert';
      const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
        ({ className, ...props }, ref) => <h5 ref={ref} className={className} {...props} />
      );
      AlertTitle.displayName = 'AlertTitle';
      const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
        ({ className, ...props }, ref) => <div ref={ref} className={className} {...props} />
      );
      AlertDescription.displayName = 'AlertDescription';
      export { Alert, AlertTitle, AlertDescription };
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual(['AlertTitle', 'AlertDescription']);
  });

  it('excludes the main component from results', () => {
    const source = `
      export function Card() { return <div />; }
      export function CardHeader() { return <div />; }
      export function CardContent() { return <div />; }
    `;
    expect(detectCompoundExports(source, 'Card')).toEqual(['CardHeader', 'CardContent']);
  });

  it('returns empty array when only the main component is exported', () => {
    const source = `export function Button({ children }: { children: React.ReactNode }) { return <button>{children}</button>; }`;
    expect(detectCompoundExports(source, 'Button')).toEqual([]);
  });

  it('excludes Sample* exports', () => {
    const source = `
      export function Alert() { return <div />; }
      export function AlertTitle() { return <p />; }
      export const SampleDefault = () => <Alert><AlertTitle>Hi</AlertTitle></Alert>;
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual(['AlertTitle']);
  });

  it('excludes type-only export specifiers', () => {
    const source = `
      export type AlertVariants = 'default' | 'destructive';
      const Alert = () => <div />;
      const AlertTitle = () => <p />;
      export { Alert, AlertTitle };
      export type { AlertVariants };
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual(['AlertTitle']);
  });

  it('excludes inline type specifiers in mixed export', () => {
    const source = `
      type AlertProps = {};
      const Alert = () => <div />;
      const AlertTitle = () => <p />;
      export { Alert, AlertTitle, type AlertProps };
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual(['AlertTitle']);
  });

  it('returns empty for non-compound components with only lowercase exports', () => {
    const source = `
      export function Alert() { return <div />; }
      export function alertHelper() { return null; }
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual([]);
  });

  it('includes inline named declarations as compound siblings', () => {
    const source = `
      export function Dialog() { return <div />; }
      export function DialogHeader() { return <header />; }
      export function DialogFooter() { return <footer />; }
      export function DialogTitle() { return <h2 />; }
    `;
    expect(detectCompoundExports(source, 'Dialog')).toEqual(['DialogHeader', 'DialogFooter', 'DialogTitle']);
  });

  it('returns empty for barrel file with cross-file re-exports', () => {
    const source = `
      export { Alert, AlertTitle, AlertDescription } from './alert';
    `;
    expect(detectCompoundExports(source, 'Alert')).toEqual([]);
  });

  it('returns empty for independent PascalCase components without shared prefix', () => {
    const source = `
      export function PrimaryButton() { return <button />; }
      export function SecondaryButton() { return <button />; }
      export function GhostButton() { return <button />; }
    `;
    expect(detectCompoundExports(source, 'PrimaryButton')).toEqual([]);
  });
});

describe('escapeRegex', () => {
  it('should escape all regex metacharacters', () => {
    // eslint-disable-next-line no-template-curly-in-string -- regex metacharacters test, not template interpolation
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

describe('extractDeclaredPropNames', () => {
  it('returns destructured prop names for a function-declaration component', () => {
    const source = `
      export function Button({ variant, children, className }: ButtonProps) {
        return <button className={className}>{children}</button>;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Button')).toEqual(['variant', 'children', 'className']);
  });

  it('ignores the rest element but keeps named props (HTMLAttributes-spread component)', () => {
    const source = `
      export function Button({ variant = 'primary', children, className = '', ...rest }: ButtonProps) {
        return <button className={className} {...rest}>{children}</button>;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Button')).toEqual(['variant', 'children', 'className']);
  });

  it('returns declared names for an arrow-function component assigned to a const', () => {
    const source = `
      export const Card = ({ title, body }: CardProps) => <div><h2>{title}</h2><p>{body}</p></div>;
    `;
    expect(extractDeclaredPropNames(source, 'Card')).toEqual(['title', 'body']);
  });

  it('returns [] for a rest-only destructure (component wants nothing from the blob)', () => {
    const source = `
      export function Passthrough({ ...rest }) {
        return <div {...rest} />;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Passthrough')).toEqual([]);
  });

  it('returns [] for an empty destructure', () => {
    const source = `
      export function Empty({}: Record<string, never>) {
        return <div />;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Empty')).toEqual([]);
  });

  it('returns null for member-access props (function C(props) { props.store })', () => {
    const source = `
      export function Dashboard(props) {
        return <div>{props.store.count}</div>;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Dashboard')).toBeNull();
  });

  it('returns null for a forwardRef-wrapped component', () => {
    const source = `
      import { forwardRef } from 'react';
      export const Input = forwardRef(({ value }, ref) => <input ref={ref} value={value} />);
    `;
    expect(extractDeclaredPropNames(source, 'Input')).toBeNull();
  });

  it('returns null for a memo-wrapped component', () => {
    const source = `
      import { memo } from 'react';
      export const Row = memo(({ label }) => <div>{label}</div>);
    `;
    expect(extractDeclaredPropNames(source, 'Row')).toBeNull();
  });

  it('returns null for a component with no parameters', () => {
    const source = `
      export function Logo() {
        return <svg />;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Logo')).toBeNull();
  });

  it('returns null when the target component is not found', () => {
    const source = `
      export function Other({ a }) { return <div>{a}</div>; }
    `;
    expect(extractDeclaredPropNames(source, 'Missing')).toBeNull();
  });

  it('resolves a default-exported function declaration', () => {
    const source = `
      export default function Button({ variant, children }) {
        return <button>{children}</button>;
      }
    `;
    expect(extractDeclaredPropNames(source, 'Button')).toEqual(['variant', 'children']);
  });

  // HYP-465 adversarial regression: a file with a NAMED component AND an
  // anonymous prop-spreading default. `extractComponentName` resolves "Card"
  // (the named export), but `detectExportStyle` → 'default-anonymous', so the
  // generated preview import binds to the ANONYMOUS DEFAULT, not Card. The
  // scanned export MUST be the one the import binds to (the default), otherwise
  // Card's declared props ([title,value,label]) become a false whitelist that
  // lets those keys leak onto the host <div> the anonymous default spreads.
  describe('exportStyle resolution (rendered export == scanned export)', () => {
    it('scans the anonymous DEFAULT, not the divergent named component, for default-anonymous', () => {
      const source = `export function Card({ title, value, label }) { return <span>{title}</span>; }
export default function (props) { return <div {...props} />; }`;
      // Rendered export is the anonymous default `function (props)` → member-access
      // → null (full blob, the honest floor). It must NOT return Card's
      // destructured [title,value,label].
      expect(extractDeclaredPropNames(source, 'Card', 'default-anonymous')).toBeNull();
    });

    it('scans the anonymous DEFAULT destructure params, not the named component', () => {
      const source = `export function Card({ title, value, label }) { return <span>{title}</span>; }
export default function ({ foo, bar }) { return <div>{foo}{bar}</div>; }`;
      expect(extractDeclaredPropNames(source, 'Card', 'default-anonymous')).toEqual(['foo', 'bar']);
    });

    it('resolves the named function referenced by `export default Identifier`', () => {
      const source = `function Inner({ alpha, beta }) { return <div>{alpha}</div>; }
export default Inner;`;
      expect(extractDeclaredPropNames(source, 'Inner', 'default-anonymous')).toEqual(['alpha', 'beta']);
    });

    it('returns null for an HOC-wrapped anonymous default (export default memo(Card))', () => {
      const source = `function Card({ title }) { return <div>{title}</div>; }
export default memo(Card);`;
      expect(extractDeclaredPropNames(source, 'Card', 'default-anonymous')).toBeNull();
    });

    it('keeps named-export behavior when exportStyle is named', () => {
      const source = `export function Button({ variant, children }) { return <button>{children}</button>; }`;
      expect(extractDeclaredPropNames(source, 'Button', 'named')).toEqual(['variant', 'children']);
    });

    it('keeps default-named behavior (name matches the bound default export)', () => {
      const source = `export default function Button({ variant, children }) { return <button>{children}</button>; }`;
      expect(extractDeclaredPropNames(source, 'Button', 'default-named')).toEqual(['variant', 'children']);
    });
  });
});
