import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { VSCodeFileIO } from '../vscode-file-io';

describe('VSCodeFileIO', () => {
  let fileIO: VSCodeFileIO;

  beforeEach(() => {
    fileIO = new VSCodeFileIO();
  });

  describe('writeFile', () => {
    it('opens document and applies WorkspaceEdit for undo support', async () => {
      const mockDoc = {
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        uri: vscode.Uri.file('/test/file.tsx'),
        save: mock(() => Promise.resolve(true)),
        isDirty: true,
      };
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockDoc));

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);

      const edit = (vscode.workspace.applyEdit as ReturnType<typeof mock>).mock.calls[0][0] as {
        edits: Array<{ newText: string }>;
      };
      expect(edit.edits).toHaveLength(1);
      expect(edit.edits[0].newText).toBe('new content');
    });

    it('saves document after applying WorkspaceEdit', async () => {
      const saveMock = mock(() => Promise.resolve(true));
      const mockDoc = {
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        uri: vscode.Uri.file('/test/file.tsx'),
        save: saveMock,
        isDirty: true,
      };
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockDoc));

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to disk write when openTextDocument fails (new file)', async () => {
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error('file not found')),
      );

      await fileIO.writeFile('/test/new-file.tsx', 'content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      const [uri, buf] = (vscode.workspace.fs.writeFile as ReturnType<typeof mock>).mock.calls[0] as [
        vscode.Uri,
        Uint8Array,
      ];
      expect(uri.fsPath).toBe('/test/new-file.tsx');
      expect(Buffer.from(buf).toString('utf-8')).toBe('content');
    });

    it('falls back to disk write when save fails', async () => {
      const mockDoc = {
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        uri: vscode.Uri.file('/test/file.tsx'),
        save: mock(() => Promise.resolve(false)),
        isDirty: true,
      };
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockDoc));

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('falls back to disk write when applyEdit fails', async () => {
      const mockDoc = {
        getText: () => 'old content',
        positionAt: (o: number) => new vscode.Position(0, o),
        uri: vscode.Uri.file('/test/file.tsx'),
        save: mock(() => Promise.resolve(true)),
        isDirty: false,
      };
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockDoc));
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(false));

      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('skips write when content is already identical', async () => {
      const mockDoc = {
        getText: () => 'same content',
        positionAt: (o: number) => new vscode.Position(0, o),
        uri: vscode.Uri.file('/test/file.tsx'),
        save: mock(() => Promise.resolve(true)),
        isDirty: false,
      };
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockDoc));

      await fileIO.writeFile('/test/file.tsx', 'same content');

      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
      expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
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
