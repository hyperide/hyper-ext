import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFile, saveFile } from '../src/commands/file';
import { createContext } from '../src/context';
import { PreviewManager } from '../src/preview';
import { runInSandbox } from '../src/sandbox';

// mkdtempSync creates a fresh 0700 dir — avoids predictable-path writes in the
// shared os tmp dir (CodeQL js/insecure-temporary-file).
const tmpDir = mkdtempSync(join(tmpdir(), 'vecli-test-'));
afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('file commands', () => {
  it('should save and open .graph.json', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50).fill("#ff0000")');
    const tmpFile = join(tmpDir, `test-vecli-${Date.now()}.graph.json`);
    saveFile(ctx, tmpFile);
    expect(existsSync(tmpFile)).toBe(true);

    const ctx2 = createContext();
    openFile(ctx2, tmpFile);
    expect(ctx2.graph.nodeCount).toBe(2);
    expect(ctx2.currentFile).toBe(tmpFile);
    unlinkSync(tmpFile);
  });

  it('should save and open .graph (binary)', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(100, 50)');
    const tmpFile = join(tmpDir, `test-vecli-${Date.now()}.graph`);
    saveFile(ctx, tmpFile);
    expect(existsSync(tmpFile)).toBe(true);

    const ctx2 = createContext();
    openFile(ctx2, tmpFile);
    expect(ctx2.graph.nodeCount).toBe(1);
    unlinkSync(tmpFile);
  });

  it('should import SVG', () => {
    const tmpFile = join(tmpDir, `test-vecli-${Date.now()}.svg`);
    writeFileSync(tmpFile, '<svg viewBox="0 0 100 100"><rect width="50" height="50" fill="#f00"/></svg>');
    const ctx = createContext();
    openFile(ctx, tmpFile);
    expect(ctx.graph.nodeCount).toBeGreaterThanOrEqual(1);
    unlinkSync(tmpFile);
  });

  it('should save to currentFile when no path given', () => {
    const ctx = createContext();
    runInSandbox(ctx, 'rect(50, 50)');
    const tmpFile = join(tmpDir, `test-vecli-${Date.now()}.graph.json`);
    saveFile(ctx, tmpFile);
    // Now add a node and save without path
    runInSandbox(ctx, 'circle(20)');
    saveFile(ctx);
    const data = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    expect(Object.keys(data.base.nodes).length).toBe(2);
    unlinkSync(tmpFile);
  });

  it('should throw when no file path and no currentFile', () => {
    const ctx = createContext();
    expect(() => saveFile(ctx)).toThrow(/no file/i);
  });
});

describe('live preview', () => {
  it('should write SVG on update', () => {
    const tmpFile = join(tmpDir, `test-preview-${Date.now()}.svg`);
    const preview = new PreviewManager(tmpFile, 0); // no debounce for test
    preview.update('<svg><rect/></svg>');
    preview.dispose(); // flush
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('<svg>');
    unlinkSync(tmpFile);
  });

  it('should debounce rapid updates', async () => {
    const tmpFile = join(tmpDir, `test-preview-debounce-${Date.now()}.svg`);
    const preview = new PreviewManager(tmpFile, 50);
    preview.update('<svg>1</svg>');
    preview.update('<svg>2</svg>');
    preview.update('<svg>3</svg>');
    await new Promise((r) => setTimeout(r, 100));
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toBe('<svg>3</svg>');
    preview.dispose();
    unlinkSync(tmpFile);
  });

  it('should flush on dispose', () => {
    const tmpFile = join(tmpDir, `test-preview-dispose-${Date.now()}.svg`);
    const preview = new PreviewManager(tmpFile, 10000); // long debounce
    preview.update('<svg>flush</svg>');
    // Without dispose, file wouldn't be written yet
    preview.dispose();
    const content = readFileSync(tmpFile, 'utf-8');
    expect(content).toBe('<svg>flush</svg>');
    unlinkSync(tmpFile);
  });
});
