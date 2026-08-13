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

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(fileIO.content(componentPath)).toContain('className={styles.card}');
    expect(fileIO.content(cssPath)).toContain('color: red');
    expect(fileIO.content(cssPath)).toContain('padding-left: 16px');
  });

  /**
   * Tamagui cross-file scenario: the nodeRef points to RecordScreen.tsx but
   * filePath is App.tsx (the currently-displayed shell component).
   * updateProps must follow the nodeRef to the correct file and write there.
   */
  it('updateProps writes to the element source file when filePath is a different shell component', async () => {
    const appPath = '/workspace/App.tsx';
    const screenPath = '/workspace/src/screens/RecordScreen.tsx';

    const screenSource = `import { YStack, Text } from 'tamagui';

export function RecordScreen() {
  return (
    <YStack backgroundColor="$background">
      <Text color="$color">Record</Text>
    </YStack>
  );
}
`;
    const appSource = `import { RecordScreen } from './src/screens/RecordScreen';

export default function App() {
  return <RecordScreen />;
}
`;
    const fileIO = new InMemoryFileIO({
      [appPath]: appSource,
      [screenPath]: screenSource,
    });
    const service = new AstService('/workspace', fileIO);

    // nodeRef encodes the element's real location in RecordScreen.tsx
    const nodeRef = syntheticRefFor(screenSource, 'src/screens/RecordScreen.tsx');

    // Caller passes App.tsx as filePath — this is what the shell currently shows
    const result = await service.updateProps('App.tsx', nodeRef, { backgroundColor: '$red10' }, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    // The change must land in RecordScreen.tsx, not App.tsx
    expect(fileIO.content(screenPath)).toContain("backgroundColor='$red10'");
    expect(fileIO.content(appPath)).toBe(appSource); // App.tsx unchanged
  });

  /**
   * updateStyles cross-file: element lives in a child component file, filePath is the shell.
   * Uses inline styles (no CSS Modules source tab) to isolate the cross-file routing logic.
   */
  it('updateStyles writes to the element source file when filePath is a different shell component', async () => {
    const appPath = '/workspace/App.tsx';
    const cardPath = '/workspace/src/components/Card.tsx';

    const cardSource = `export function Card() {
  return <div style={{ color: 'blue' }}>content</div>;
}
`;
    const appSource = `import { Card } from './src/components/Card';

export default function App() {
  return <Card />;
}
`;
    const fileIO = new InMemoryFileIO({
      [appPath]: appSource,
      [cardPath]: cardSource,
    });
    const service = new AstService('/workspace', fileIO);

    const nodeRef = syntheticRefFor(cardSource, 'src/components/Card.tsx');

    // filePath is App.tsx (the shell) but the element lives in Card.tsx
    const result = await service.updateStyles('App.tsx', nodeRef, { color: 'red' }, undefined, nodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    // Change must land in Card.tsx (inline style → color: "red")
    expect(fileIO.content(cardPath)).toContain('color');
    expect(fileIO.content(cardPath)).toContain('red');
    expect(fileIO.content(cardPath)).not.toContain('blue');
    expect(fileIO.content(appPath)).toBe(appSource); // App.tsx unchanged
  });
});
