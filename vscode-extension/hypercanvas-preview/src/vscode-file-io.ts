/**
 * VS Code implementation of FileIO.
 *
 * Writes go directly to disk via vscode.workspace.fs — reliable for both new and existing files.
 * WorkspaceEdit + doc.save() was previously used to support Cmd+Z, but doc.save() silently
 * returns false for background documents (not shown in any editor tab), causing patchEntryFile
 * to write nothing to disk while appearing to succeed.
 *
 * After the direct disk write, open in-memory documents are updated via WorkspaceEdit so that
 * sequential readFile() calls (which prefer open documents) see the fresh content immediately,
 * without waiting for VS Code's file-system watcher to reload.
 */

import type { FileIO } from '@lib/ast/file-io';
import * as vscode from 'vscode';

export class VSCodeFileIO implements FileIO {
  async readFile(absolutePath: string): Promise<string> {
    const uri = vscode.Uri.file(absolutePath);

    // Prefer open document — sequential AST ops must see each other's unsaved results
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    if (openDoc) {
      return openDoc.getText();
    }

    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(content);
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);

    // Write directly to disk — works for both new and existing files and guarantees
    // Vite HMR picks up the change. WorkspaceEdit + doc.save() was unreliable for
    // background documents that are open but not visible in any editor tab.
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

    // Sync the in-memory document if it is open, so the next readFile() call returns
    // the new content immediately (before VS Code's file-system watcher fires).
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    if (openDoc && openDoc.getText() !== content) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(openDoc.getText().length));
      edit.replace(uri, fullRange, content);
      // Best-effort: disk is already written, so ignore applyEdit failures here.
      await vscode.workspace.applyEdit(edit).catch(() => {});
    }
  }

  async access(absolutePath: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    await vscode.workspace.fs.stat(uri);
  }

  async mkdir(dirPath: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  }

  async deleteFile(absolutePath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), { useTrash: false });
  }
}
