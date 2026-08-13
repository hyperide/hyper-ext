import { describe, expect, it } from 'bun:test';
import {
  applyInlineStyleUpdate,
  getCssModuleImportLocalNames,
  isCssModuleClassNameExpression,
} from './inline-style-mutator';
import { parseCode, printAST } from './parser';
import { findAllJSXElements } from './traverser';

describe('inline-style-mutator', () => {
  it('detects CSS Modules import locals', () => {
    const ast = parseCode(`
      import styles from './App.module.css';
      import * as classes from './Other.module.scss';
      import './global.css';

      export function App() {
        return <div />;
      }
    `);

    expect([...getCssModuleImportLocalNames(ast)].sort()).toEqual(['classes', 'styles']);
  });

  it('detects className expressions that reference CSS Modules', () => {
    const ast = parseCode(`
      import styles from './App.module.css';

      export function App() {
        return <div className={styles.app} />;
      }
    `);
    const element = findAllJSXElements(ast)[0].element;

    expect(isCssModuleClassNameExpression(element, getCssModuleImportLocalNames(ast))).toBe(true);
  });

  it('does not treat unrelated dynamic className expressions as CSS Modules', () => {
    const ast = parseCode(`
      import styles from './App.module.css';

      export function App() {
        return <div className={isActive ? 'active' : 'idle'} />;
      }
    `);
    const element = findAllJSXElements(ast)[0].element;

    expect(isCssModuleClassNameExpression(element, getCssModuleImportLocalNames(ast))).toBe(false);
  });

  it('adds inline styles without changing CSS Modules className', () => {
    const ast = parseCode(`
      import styles from './App.module.css';

      export function App() {
        return <div className={styles.app} />;
      }
    `);
    const element = findAllJSXElements(ast)[0].element;

    applyInlineStyleUpdate(element, {
      paddingLeft: '16',
      paddingRight: '16',
    });

    const output = printAST(ast);
    expect(output).toContain('className={styles.app}');
    expect(output).toContain('style={{');
    expect(output).toContain('paddingLeft');
    expect(output).toContain('paddingRight');
    expect(output).toContain('16px');
  });

  it('merges with existing object styles and replaces changed keys', () => {
    const ast = parseCode(`
      import styles from './App.module.css';

      export function App() {
        return <div className={styles.app} style={{ color: 'red', paddingLeft: '4px' }} />;
      }
    `);
    const element = findAllJSXElements(ast)[0].element;

    applyInlineStyleUpdate(element, {
      paddingLeft: '16',
    });

    const output = printAST(ast);
    expect(output).toContain('color');
    expect(output).toContain('red');
    expect(output).toContain('paddingLeft');
    expect(output).toContain('16px');
    expect(output).not.toContain('4px');
  });

  it('preserves dynamic style expressions with a spread fallback', () => {
    const ast = parseCode(`
      import styles from './App.module.css';

      export function App() {
        return <div className={styles.app} style={baseStyle} />;
      }
    `);
    const element = findAllJSXElements(ast)[0].element;

    applyInlineStyleUpdate(element, {
      paddingLeft: '16',
    });

    const output = printAST(ast);
    expect(output).toContain('...baseStyle');
    expect(output).toContain('paddingLeft');
    expect(output).toContain('16px');
  });
});
