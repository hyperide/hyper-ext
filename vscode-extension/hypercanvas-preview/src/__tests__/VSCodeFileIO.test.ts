import { beforeEach, describe, expect, it, type mock } from 'bun:test';
import * as vscode from 'vscode';
import { VSCodeFileIO } from '../vscode-file-io';

describe('VSCodeFileIO', () => {
  let fileIO: VSCodeFileIO;

  beforeEach(() => {
    fileIO = new VSCodeFileIO();
  });

  describe('writeFile', () => {
    it('writes directly to disk via workspace.fs.writeFile', async () => {
      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      const [uri, buf] = (vscode.workspace.fs.writeFile as ReturnType<typeof mock>).mock.calls[0] as [
        vscode.Uri,
        Uint8Array,
      ];
      expect(uri.fsPath).toBe('/test/file.tsx');
      expect(Buffer.from(buf).toString('utf-8')).toBe('new content');
    });

    it('does not call openTextDocument', async () => {
      await fileIO.writeFile('/test/file.tsx', 'content');

      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('syncs open in-memory document when content differs', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
      } as unknown as vscode.TextDocument);

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
      const edit = (vscode.workspace.applyEdit as ReturnType<typeof mock>).mock.calls[0][0] as {
        edits: Array<{ newText: string }>;
      };
      expect(edit.edits).toHaveLength(1);
      expect(edit.edits[0].newText).toBe('new content');
    });

    it('skips applyEdit when no document is open', async () => {
      // textDocuments is empty (cleared by beforeEach)
      await fileIO.writeFile('/test/file.tsx', 'content');

      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it('skips applyEdit when open document already has the same content', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        getText: () => 'same content',
        positionAt: (o: number) => new vscode.Position(0, o),
      } as unknown as vscode.TextDocument);

      await fileIO.writeFile('/test/file.tsx', 'same content');

      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it('does not throw when applyEdit fails (best-effort sync)', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
      } as unknown as vscode.TextDocument);
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockReturnValue(Promise.reject(new Error('edit failed')));

      // Must not throw — disk write already succeeded
      await expect(fileIO.writeFile('/test/file.tsx', 'new content')).resolves.toBeUndefined();
    });

    it('still writes to disk even when applyEdit fails', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
      } as unknown as vscode.TextDocument);
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockReturnValue(Promise.reject(new Error('edit failed')));

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('readFile', () => {
    it('returns content from open TextDocument when available', async () => {
      vscode.workspace.textDocuments.push({
        uri: vscode.Uri.file('/test/file.tsx'),
        getText: () => 'open doc content',
      } as unknown as vscode.TextDocument);

      const result = await fileIO.readFile('/test/file.tsx');
      expect(result).toBe('open doc content');
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
        getText: () => 'cached',
      } as unknown as vscode.TextDocument);

      await fileIO.readFile('/test/file.tsx');
      expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    });
  });
});
