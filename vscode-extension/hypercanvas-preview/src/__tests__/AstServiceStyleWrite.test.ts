/**
 * @file AstService style-write integration tests
 *
 * Accessed via: VS Code inspector style updates routed through shared StyleWriteManager
 * Assumptions: selectedSourceTabId identifies a concrete source tab emitted by StyleReadService.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { AstService } from '../services/AstService';

class InMemoryFileIO implements FileIO {
  private readonly files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [filePath, content] of Object.entries(files)) {
      this.files.set(filePath, content);
    }
  }

  async readFile(absolutePath: string): Promise<string> {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    return content;
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    if (!this.files.has(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    this.files.set(absolutePath, content);
  }

  async access(absolutePath: string): Promise<void> {
    if (!this.files.has(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
  }

  async listFiles(dirPath: string, extensions: string[] = []): Promise<string[]> {
    return [...this.files.keys()].filter((filePath) => {
      if (!filePath.startsWith(dirPath)) return false;
      if (extensions.length === 0) return true;
      return extensions.some((extension) => filePath.endsWith(extension));
    });
  }

  content(absolutePath: string): string {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    return content;
  }
}

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
