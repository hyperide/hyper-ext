/**
 * @file HYP-784 sibling: the test-generation component analyzer must survive a top-level collision.
 *
 * Accessed via: `analyzeComponent` (lib/testing test-gen CLI) on user component files. A user
 * component can collide a top-level import with its own export of the same name
 * (`import { Card } from 'antd'` + `export function Card`). `@babel/parser` tolerates it; a
 * scope-enabled `@babel/traverse` crawl throws `Duplicate declaration "Card"`. The analyzer's
 * structural walks (props/CVA/exports) ran scope-enabled, so analysis threw on such a file. After
 * routing through `traverseWithoutScope` the analysis survives.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeComponent } from '../component-analyzer';

const dir = mkdtempSync(join(tmpdir(), 'hyp784-testgen-analyzer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('analyzeComponent — top-level name collision (HYP-784 sibling)', () => {
  it('analyzes a component whose import collides with its export', async () => {
    const filePath = join(dir, 'Card.tsx');
    writeFileSync(
      filePath,
      `import { Card } from 'antd';

interface CardProps {
  variant?: 'outlined' | 'filled';
}

export function Card(props: CardProps) {
  return <div />;
}
`,
    );

    const analysis = await analyzeComponent(filePath);

    expect(analysis.componentName).toBe('Card');
    expect(analysis.propsInterface).toBeDefined();
    expect(analysis.propsInterface?.props.some((p) => p.name === 'variant')).toBe(true);
    // extractExports is a separately-converted walk — assert it also produces correct results
    // (not just "no throw") on the collision file: the exported `Card` must be picked up.
    expect(analysis.exports).toContain('Card');
  });
});
