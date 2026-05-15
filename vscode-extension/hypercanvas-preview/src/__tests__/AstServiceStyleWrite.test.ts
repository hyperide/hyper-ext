/**
 * @file AstService style-write integration tests
 *
 * Accessed via: VS Code inspector style updates routed through shared StyleWriteManager
 * Assumptions: selectedSourceTabId identifies a concrete source tab emitted by StyleReadService.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { AstService } from '../services/AstService';

function syntheticRefFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, relativePath);
  const entry = entries[0];
  return `${relativePath}:${entry.loc.line}:${entry.loc.column}`;
}

describe('AstService shared style-write routing', () => {
  it('updates the selected CSS Modules rule from a CSS Modules source tab', async () => {
    const componentPath = '/workspace/src/Card.tsx';
    const cssPath = '/workspace/src/Card.module.css';
    const source = `import styles from './Card.module.css';

export function Card() {
  return <article className={styles.card}>hello</article>;
}
`;
    const fileIO = new InMemoryFileIO({
      [componentPath]: source,
      [cssPath]: `.card {
  color: red;
}
`,
    });
    const service = new AstService('/workspace', fileIO);
    const nodeRef = syntheticRefFor(source, 'src/Card.tsx');

    const result = await service.updateStyles(
      'src/Card.tsx',
      nodeRef,
      { paddingLeft: '16' },
      undefined,
      nodeRef,
      'css-modules:card',
    );

    expect(result).toEqual({ success: true });
    expect(fileIO.content(componentPath)).toContain('className={styles.card}');
    expect(fileIO.content(cssPath)).toContain('color: red');
    expect(fileIO.content(cssPath)).toContain('padding-left: 16px');
  });
});
