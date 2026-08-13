/**
 * @file CSS Modules class reference extraction tests
 *
 * Accessed via: StyleReadService and shared style-write request routing for className={styles.x}
 * Assumptions: CSS Module imports are local stylesheet imports ending in .module.<syntax>.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import {
  getCssModuleClassReferences,
  getCssModuleImportBindings,
  getCssModuleImportLocalNames,
} from './css-module-references';
import { parseCode } from './parser';

function firstJsxElement(node: unknown): t.JSXElement {
  if (!node || typeof node !== 'object') {
    throw new Error('JSXElement not found');
  }

  if (t.isJSXElement(node)) {
    return node;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (
      value === null ||
      value === undefined ||
      typeof value !== 'object' ||
      value instanceof RegExp ||
      value instanceof Date
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        try {
          return firstJsxElement(item);
        } catch {
          // Continue until the first JSX element is found.
        }
      }
      continue;
    }

    try {
      return firstJsxElement(value);
    } catch {
      // Continue until the first JSX element is found.
    }
  }

  throw new Error('JSXElement not found');
}

describe('css-module-references', () => {
  it('extracts import bindings with resolved CSS file paths and syntaxes', () => {
    const ast = parseCode(`
      import styles from './Card.module.css';
      import * as theme from '../theme/Theme.module.scss';
      import './global.css';

      export function Card() {
        return <article className={styles.card} />;
      }
    `);

    const bindings = getCssModuleImportBindings(ast, '/project/src/components/Card.tsx');

    expect(getCssModuleImportLocalNames(ast)).toEqual(new Set(['styles', 'theme']));
    expect(bindings.get('styles')).toMatchObject({
      importLocalName: 'styles',
      importSource: './Card.module.css',
      cssFilePath: '/project/src/components/Card.module.css',
      cssSyntax: 'css',
    });
    expect(bindings.get('theme')).toMatchObject({
      importLocalName: 'theme',
      importSource: '../theme/Theme.module.scss',
      cssFilePath: '/project/src/theme/Theme.module.scss',
      cssSyntax: 'scss',
    });
  });

  it('extracts every CSS Module class reference from className expressions', () => {
    const ast = parseCode(`
      import cn from 'clsx';
      import styles from './Card.module.css';
      import * as theme from '../theme/Theme.module.scss';

      export function Card({ active }) {
        return <article className={cn(styles.card, active && styles.active, theme.hero)} />;
      }
    `);

    const element = firstJsxElement(ast);
    const bindings = getCssModuleImportBindings(ast, '/project/src/components/Card.tsx');

    expect(getCssModuleClassReferences(element, bindings)).toEqual([
      expect.objectContaining({
        importLocalName: 'styles',
        importSource: './Card.module.css',
        cssFilePath: '/project/src/components/Card.module.css',
        cssSyntax: 'css',
        classKey: 'card',
        expressionPath: 'styles.card',
      }),
      expect.objectContaining({
        importLocalName: 'styles',
        importSource: './Card.module.css',
        cssFilePath: '/project/src/components/Card.module.css',
        cssSyntax: 'css',
        classKey: 'active',
        expressionPath: 'styles.active',
      }),
      expect.objectContaining({
        importLocalName: 'theme',
        importSource: '../theme/Theme.module.scss',
        cssFilePath: '/project/src/theme/Theme.module.scss',
        cssSyntax: 'scss',
        classKey: 'hero',
        expressionPath: 'theme.hero',
      }),
    ]);
  });

  it('supports string-literal CSS Module keys', () => {
    const ast = parseCode(`
      import styles from './Card.module.css';

      export function Card() {
        return <article className={styles['card-title']} />;
      }
    `);

    const element = firstJsxElement(ast);
    const bindings = getCssModuleImportBindings(ast, '/project/src/Card.tsx');

    expect(getCssModuleClassReferences(element, bindings)).toEqual([
      expect.objectContaining({
        classKey: 'card-title',
        selector: '.card-title',
        expressionPath: "styles['card-title']",
      }),
    ]);
  });
});
