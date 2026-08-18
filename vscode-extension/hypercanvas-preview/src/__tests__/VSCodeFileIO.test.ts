import { beforeEach, describe, expect, it, type mock } from 'bun:test';
import * as vscode from 'vscode';
import { VSCodeFileIO } from '../vscode-file-io';

describe('VSCodeFileIO', () => {
  let fileIO: VSCodeFileIO;

  beforeEach(() => {
    fileIO = new VSCodeFileIO();
  });

  describe('writeFile', () => {
    it('writes to disk via workspace.fs.writeFile', async () => {
      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      const [uri, buf] = (vscode.workspace.fs.writeFile as ReturnType<typeof mock>).mock.calls[0] as [
        vscode.Uri,
        Uint8Array,
      ];
      expect(uri.fsPath).toBe('/test/file.tsx');
      expect(Buffer.from(buf).toString('utf-8')).toBe('new content');
    });

    it('skips applyEdit for clean open document after disk write', async () => {
      vscode.workspace.textDocuments.push({
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        isDirty: false,
        uri: vscode.Uri.file('/test/file.tsx'),
      } as unknown as vscode.TextDocument);

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it('syncs dirty open document via applyEdit when content differs', async () => {
      vscode.workspace.textDocuments.push({
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        isDirty: true,
        uri: vscode.Uri.file('/test/file.tsx'),
      } as unknown as vscode.TextDocument);

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);

      const edit = (vscode.workspace.applyEdit as ReturnType<typeof mock>).mock.calls[0][0] as {
        edits: Array<{ newText: string }>;
      };
      expect(edit.edits).toHaveLength(1);
      expect(edit.edits[0].newText).toBe('new content');
    });

    it('skips applyEdit when open document already has same content', async () => {
      vscode.workspace.textDocuments.push({
        getText: () => 'same content',
        positionAt: (o: number) => new vscode.Position(0, o),
        isDirty: true,
        uri: vscode.Uri.file('/test/file.tsx'),
      } as unknown as vscode.TextDocument);

      await fileIO.writeFile('/test/file.tsx', 'same content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it('skips applyEdit when no document is open', async () => {
      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it('does NOT throw when the dirty-buffer applyEdit sync fails — disk is written, failure is logged', async () => {
      // The disk write already succeeded; a failed buffer sync must NOT throw (Opus #1: throwing
      // mid-saga leaves wrapper/marker debris and can hang the webview). The non-undoable hazard it
      // guards against is closed elsewhere (undo snapshots read disk via readFileFromDisk).
      vscode.workspace.textDocuments.push({
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        isDirty: true,
        uri: vscode.Uri.file('/test/file.tsx'),
      } as unknown as vscode.TextDocument);
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(false));

      await fileIO.writeFile('/test/file.tsx', 'new content');
      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('readFileFromDisk', () => {
    it('reads DISK even when a DIRTY open TextDocument exists (bypasses the buffer — Opus)', async () => {
      // This is the method the undo snapshot uses so a failed dirty-buffer sync can't feed it the
      // stale buffer (before === after → non-undoable). It must ignore the dirty document entirely.
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        isDirty: true,
        getText: () => 'stale dirty buffer',
      } as unknown as vscode.TextDocument);
      (vscode.workspace.fs.readFile as ReturnType<typeof mock>).mockReturnValue(
        Promise.resolve(new TextEncoder().encode('actual disk content')),
      );

      const result = await fileIO.readFileFromDisk('/test/file.tsx');
      expect(result).toBe('actual disk content');
    });
  });

  describe('readFile', () => {
    it('returns content from dirty open TextDocument when available', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        isDirty: true,
        getText: () => 'open doc content',
      } as unknown as vscode.TextDocument);

      const result = await fileIO.readFile('/test/file.tsx');
      expect(result).toBe('open doc content');
    });

    it('reads from disk when open TextDocument is clean', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        isDirty: false,
        getText: () => 'stale open doc content',
      } as unknown as vscode.TextDocument);
      (vscode.workspace.fs.readFile as ReturnType<typeof mock>).mockReturnValue(
        Promise.resolve(new TextEncoder().encode('fresh disk content')),
      );

      const result = await fileIO.readFile('/test/file.tsx');
      expect(result).toBe('fresh disk content');
    });

    it('falls back to disk read when document is not open', async () => {
      (vscode.workspace.fs.readFile as ReturnType<typeof mock>).mockReturnValue(
        Promise.resolve(new TextEncoder().encode('disk content')),
      );

      const result = await fileIO.readFile('/test/file.tsx');
      expect(result).toBe('disk content');
    });

    it('does not read from disk when open document exists', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        isDirty: true,
        getText: () => 'cached',
      } as unknown as vscode.TextDocument);

      await fileIO.readFile('/test/file.tsx');
      expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    });
  });
});
