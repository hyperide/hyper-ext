import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { VSCodeFileIO } from '../vscode-file-io';

describe('VSCodeFileIO', () => {
  let fileIO: VSCodeFileIO;

  beforeEach(() => {
    fileIO = new VSCodeFileIO();
  });

  describe('writeFile', () => {
    it('applies WorkspaceEdit with full-range replace', async () => {
      await fileIO.writeFile('/test/file.tsx', 'new content');

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);

      const edit = (vscode.workspace.applyEdit as ReturnType<typeof mock>).mock.calls[0][0] as {
        edits: Array<{ newText: string }>;
      };
      expect(edit.edits).toHaveLength(1);
      expect(edit.edits[0].newText).toBe('new content');
    });

    it('saves the document after successful edit', async () => {
      await fileIO.writeFile('/test/file.tsx', 'content');

      const doc = await (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.results[0].value;
      expect(doc.save).toHaveBeenCalledTimes(1);
    });

    it('throws when applyEdit fails', async () => {
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockReturnValue(Promise.resolve(false));

      await expect(fileIO.writeFile('/test/file.tsx', 'content')).rejects.toThrow(
        'WorkspaceEdit failed for /test/file.tsx',
      );
    });

    it('does not save when applyEdit fails', async () => {
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockReturnValue(Promise.resolve(false));

      try {
        await fileIO.writeFile('/test/file.tsx', 'content');
      } catch {
        // expected
      }

      const doc = await (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.results[0].value;
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('throws when save fails', async () => {
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockReturnValue(Promise.resolve(true));
      (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockReturnValue(
        Promise.resolve({
          getText: () => '',
          positionAt: (o: number) => new vscode.Position(0, o),
          uri: vscode.Uri.file('/test'),
          save: mock(() => Promise.resolve(false)),
        }),
      );

      await expect(fileIO.writeFile('/test/file.tsx', 'content')).rejects.toThrow(
        'Document save failed for /test/file.tsx',
      );
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
