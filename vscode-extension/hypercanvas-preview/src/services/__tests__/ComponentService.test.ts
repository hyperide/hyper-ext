/**
 * Unit tests for module-level parseComponentSource helper.
 * Tests forwardRef recognition, optional prop heuristics, and basename-based component name selection.
 */

import { describe, expect, it } from 'bun:test';

// Import directly from the pure parser — no vscode dependency, not affected by PanelRouter's
// mock.module('../services/ComponentService', ...) which runs earlier in the test suite.
import { parseComponentSource } from '../componentSourceParser';

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
});
