/**
 * @file HYP-448 — previewFallbackProps must be safe to spread onto a real DOM node.
 *
 * Accessed via: Hyper Canvas preview of any component that `extends HTMLAttributes`
 * and spreads `...rest` onto a DOM element (e.g. a shared `Button`). Feature #210
 * auto-generates sample props and now ATTEMPTS the render for such components
 * (previously they hit the requires-props overlay and never rendered), which
 * exposed a pre-existing hazard: the `store` / `state` Proxies in
 * `previewFallbackProps` are captured by `...rest` and passed as DOM attributes.
 * React's dev-mode unknown-object-attribute path reads `value.constructor.name`
 * and then stringifies the value; those Proxies' get-trap returned `undefined`
 * for `constructor` / `toString` / `valueOf`, so the render threw `TypeError:
 * undefined is not an object (evaluating 'value.constructor.name')` →
 * ErrorBoundary → blank preview.
 *
 * Assumptions: the store/state Proxies back `store.xxx` reads with a `{}` target,
 * so delegating unknown-key reads to the target keeps store-consuming
 * (BoardView-shaped) components rendering while making the Proxy DOM-spread safe.
 * The `theme` Proxy is already DOM-safe (its `prop in target` check resolves
 * constructor/toString/valueOf via the prototype chain) and is left untouched.
 */

import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePreviewContent, type PreviewComponentEntry } from '../generator';

/**
 * Extract a `<name>: new Proxy({ ... }, { ... })` initializer from the generated
 * preview file and eval it to a real Proxy, so the test exercises the SHIPPED
 * source string (not a hand-rolled approximation).
 */
function evalGeneratedProxy(content: string, name: string): unknown {
  const marker = `${name}: new Proxy`;
  const start = content.indexOf(marker);
  if (start < 0) throw new Error(`${name} Proxy initializer not found in generated content`);

  const open = content.indexOf('(', start + marker.length);
  let depth = 0;
  let end = -1;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`unbalanced parens around ${name} Proxy`);

  // Strip TS `as <Type>` assertions so the plain-JS `new Function` can parse the
  // generated source (the `theme` Proxy uses `(target as Record<string, unknown>)`).
  const proxyExpr = `new Proxy${content.slice(open, end + 1)}`.replace(/\s+as\s+Record<[^>]*>/g, '');
  // `_storeStubs` / `_stateStubs` are referenced inside the traps; supply them.
  // biome-ignore lint/security/noGlobalEval: evaluating our own generated source string in a test.
  const factory = new Function('_storeStubs', '_stateStubs', `return (${proxyExpr});`);
  return factory({}, {});
}

function generatedContent(): string {
  const entries: PreviewComponentEntry[] = [
    {
      componentPath: 'src/components/Button.tsx',
      componentName: 'Button',
      exportStyle: 'named',
      sampleExports: [],
      importPath: './components/Button',
    },
  ];
  return generatePreviewContent(entries);
}

function DomSpreadButton({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) {
  return <button {...rest}>{children}</button>;
}

describe('HYP-448 — previewFallbackProps Proxies are DOM-spread safe', () => {
  it('renders a ...rest→DOM component with store+state+theme Proxies spread, without throwing', () => {
    const content = generatedContent();
    const store = evalGeneratedProxy(content, 'store');
    const state = evalGeneratedProxy(content, 'state');
    const theme = evalGeneratedProxy(content, 'theme');

    expect(() =>
      renderToStaticMarkup(
        <DomSpreadButton store={store} state={state} theme={theme}>
          Click me
        </DomSpreadButton>,
      ),
    ).not.toThrow();
  });

  it('keeps store/state reads returning undefined for arbitrary keys (no behavior change)', () => {
    const content = generatedContent();
    for (const name of ['store', 'state']) {
      const proxy = evalGeneratedProxy(content, name) as Record<string, unknown>;
      // Arbitrary data key → undefined (target {} has no own props).
      expect(proxy.someArbitraryValue).toBeUndefined();
      // Setter-shaped key → a function stub (unchanged behavior).
      expect(typeof proxy.setFoo).toBe('function');
      // Collection-shaped key → empty array (unchanged behavior).
      expect(Array.isArray(proxy.items)).toBe(true);
    }
  });
});
