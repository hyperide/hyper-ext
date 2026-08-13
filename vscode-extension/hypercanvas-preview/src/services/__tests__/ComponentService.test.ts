/**
 * Unit tests for module-level pure parser helpers.
 * Covers parseComponentSource (forwardRef recognition, optional prop heuristics, basename
 * component name selection) and getTypeString (TSQualifiedName handling for React.ReactNode).
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import { parseCode } from '@lib/ast/parser';
import _traverse, { type NodePath } from '@babel/traverse';

const traverse = (_traverse as { default?: typeof _traverse }).default ?? _traverse;

// Import directly from the pure parser — no vscode dependency, not affected by PanelRouter's
// mock.module('../services/ComponentService', ...) which runs earlier in the test suite.
import { getTypeString, parseComponentSource } from '../componentSourceParser';

// Minimal menubar.tsx-style source: React.forwardRef with {...props} rest,
// plus sub-components using arrow functions with {...props} rest.
const menubarSource = `
import * as React from 'react';

const Menubar = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={className} {...props} />
  )
);
Menubar.displayName = 'Menubar';

const MenubarTrigger = React.forwardRef<HTMLButtonElement, React.HTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button ref={ref} className={className} {...props} />
  )
);
MenubarTrigger.displayName = 'MenubarTrigger';

const MenubarShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={className} {...props} />
);
MenubarShortcut.displayName = 'MenubarShortcut';

export { Menubar, MenubarTrigger, MenubarShortcut };
`;

// Simple arrow function with a required prop (no ...props rest)
const buttonSource = `
import * as React from 'react';

export const Button = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick}>{label}</button>
);
`;

// forwardRef imported directly (not React.forwardRef)
const directForwardRefSource = `
import { forwardRef } from 'react';

const Input = forwardRef<HTMLInputElement, { placeholder?: string }>(
  ({ placeholder, ...props }, ref) => (
    <input ref={ref} placeholder={placeholder} {...props} />
  )
);

export { Input };
`;

describe('parseComponentSource', () => {
  describe('menubar.tsx-style (React.forwardRef + spread props)', () => {
    it('picks Menubar as component name (basename match)', () => {
      const result = parseComponentSource('src/components/ui/menubar.tsx', menubarSource);
      expect(result?.name).toBe('Menubar');
    });

    it('has no required props', () => {
      const result = parseComponentSource('src/components/ui/menubar.tsx', menubarSource);
      const required = (result?.props ?? []).filter((p) => p.required);
      expect(required).toHaveLength(0);
    });

    it('className is optional', () => {
      const result = parseComponentSource('src/components/ui/menubar.tsx', menubarSource);
      const className = result?.props.find((p) => p.name === 'className');
      expect(className?.required).toBe(false);
    });
  });

  describe('button with required props', () => {
    it('marks label as required (no ...rest in destructuring)', () => {
      const result = parseComponentSource('src/components/Button.tsx', buttonSource);
      expect(result?.name).toBe('Button');
      const label = result?.props.find((p) => p.name === 'label');
      expect(label?.required).toBe(true);
    });

    it('marks onClick as optional (event handler pattern)', () => {
      const result = parseComponentSource('src/components/Button.tsx', buttonSource);
      const onClick = result?.props.find((p) => p.name === 'onClick');
      expect(onClick?.required).toBe(false);
    });
  });

  describe('direct forwardRef import', () => {
    it('recognises forwardRef(...) without React. prefix', () => {
      const result = parseComponentSource('src/components/Input.tsx', directForwardRefSource);
      expect(result?.name).toBe('Input');
    });

    it('placeholder is optional because of ...props rest', () => {
      const result = parseComponentSource('src/components/Input.tsx', directForwardRefSource);
      const placeholder = result?.props.find((p) => p.name === 'placeholder');
      expect(placeholder?.required).toBe(false);
    });
  });

  describe('ALWAYS_OPTIONAL_PROP_NAMES', () => {
    it('className, children, ref, key, asChild are always optional even without rest', () => {
      const source = `
        export const Card = ({ className, children, title }: { className: string; children: React.ReactNode; title: string }) => (
          <div className={className}>{title}{children}</div>
        );
      `;
      const result = parseComponentSource('src/components/Card.tsx', source);
      const classNameProp = result?.props.find((p) => p.name === 'className');
      const childrenProp = result?.props.find((p) => p.name === 'children');
      const titleProp = result?.props.find((p) => p.name === 'title');
      expect(classNameProp?.required).toBe(false);
      expect(childrenProp?.required).toBe(false);
      // title has no special treatment and no rest — stays required
      expect(titleProp?.required).toBe(true);
    });
  });

  describe('destructuring defaults (HYP-454)', () => {
    it('captures a string-literal destructuring default into PropInfo.defaultValue', () => {
      const source = `
        export function LocalButton({ variant = 'primary', children }: { variant?: 'primary' | 'ghost'; children: React.ReactNode }) {
          return <button>{children}</button>;
        }
      `;
      const result = parseComponentSource('src/ui/LocalButton.tsx', source);
      const variantProp = result?.props.find((p) => p.name === 'variant');
      expect(variantProp?.defaultValue).toBe('primary');
      // A prop with a destructuring default is optional.
      expect(variantProp?.required).toBe(false);
    });

    it('leaves defaultValue undefined when there is no default', () => {
      const source = `
        export function Tag({ label }: { label: string }) {
          return <span>{label}</span>;
        }
      `;
      const result = parseComponentSource('src/ui/Tag.tsx', source);
      const labelProp = result?.props.find((p) => p.name === 'label');
      expect(labelProp?.defaultValue).toBeUndefined();
    });
  });
});

describe('Remix root.tsx with a Layout name collision (HYP-784 duplicate-declaration crash)', () => {
  // A Remix v2 `app/root.tsx` legitimately exports a `Layout` document-shell. This fixture
  // ALSO imports antd's `Layout` — a genuine top-level name collision in the user's source.
  // babel-traverse's scope crawl rejects that with `TypeError: Duplicate declaration "Layout"`,
  // which used to crash the (scope-free) component walk → null. The walk never reads scope, so
  // it now degrades gracefully and still resolves the default-export component (HYP-784).
  const remixRootSource = `
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { ConfigProvider, Layout, Menu } from 'antd';

const { Header, Sider, Content } = Layout;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><Meta /><Links /></head>
      <body><ConfigProvider>{children}</ConfigProvider><ScrollRestoration /><Scripts /></body>
    </html>
  );
}

export default function App() {
  return (
    <Layout>
      <Header>header</Header>
      <Content><Outlet /></Content>
    </Layout>
  );
}
`;

  it('does not crash on the duplicate Layout declaration (returns component info, not null)', () => {
    const result = parseComponentSource('app/root.tsx', remixRootSource);
    expect(result).not.toBeNull();
  });

  it('resolves the default-export component name (App), not the colliding Layout', () => {
    const result = parseComponentSource('app/root.tsx', remixRootSource);
    expect(result?.name).toBe('App');
    expect(result?.hasDefaultExport).toBe(true);
  });
});

describe('getTypeString', () => {
  /**
   * Helper: parse a TSPropertySignature from a minimal interface source and return
   * its typeAnnotation.typeAnnotation node for use in getTypeString assertions.
   */
  function parseTypeNode(typeSrc: string): t.TSType {
    const source = `interface P { children: ${typeSrc} }`;
    const ast = parseCode(source);
    let typeNode: t.TSType | null = null;
    traverse(ast, {
      TSPropertySignature(nodePath: NodePath<t.TSPropertySignature>) {
        const ann = nodePath.node.typeAnnotation;
        if (ann && t.isTSTypeAnnotation(ann)) {
          typeNode = ann.typeAnnotation;
        }
      },
    });
    if (!typeNode) throw new Error(`Could not parse type node from: ${typeSrc}`);
    return typeNode;
  }

  it('returns the identifier name for a simple TSTypeReference (ReactNode)', () => {
    expect(getTypeString(parseTypeNode('ReactNode'))).toBe('ReactNode');
  });

  it('returns dot-joined name for a TSQualifiedName reference (React.ReactNode)', () => {
    // This is the regression case: TSQualifiedName fell through to "unknown",
    // so acceptsTextPlaceholder never fired for children: React.ReactNode.
    expect(getTypeString(parseTypeNode('React.ReactNode'))).toBe('React.ReactNode');
  });

  it('returns dot-joined name for React.ReactElement', () => {
    expect(getTypeString(parseTypeNode('React.ReactElement'))).toBe('React.ReactElement');
  });

  it('handles primitives', () => {
    expect(getTypeString(parseTypeNode('string'))).toBe('string');
    expect(getTypeString(parseTypeNode('number'))).toBe('number');
    expect(getTypeString(parseTypeNode('boolean'))).toBe('boolean');
  });

  it('handles union types containing a qualified name', () => {
    expect(getTypeString(parseTypeNode('React.ReactNode | undefined'))).toBe('React.ReactNode | undefined');
  });

  it('handles 3-part qualified name (React.JSX.Element)', () => {
    expect(getTypeString(parseTypeNode('React.JSX.Element'))).toBe('React.JSX.Element');
  });
});
