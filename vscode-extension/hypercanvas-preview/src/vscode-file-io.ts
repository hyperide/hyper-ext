/**
 * VS Code implementation of FileIO.
 *
 * Disk-first write strategy:
 * 1. Write directly to disk via workspace.fs.writeFile (triggers Vite HMR reliably).
 * 2. If the document is already open in VS Code's model AND content differs,
 *    apply a WorkspaceEdit to sync the in-memory buffer so the next readFile()
 *    returns fresh content immediately (before the file-system watcher fires).
 *
 * Undo/redo uses content-based snapshots in UndoRedoService, not VS Code native undo.
 *
 * A previous WorkspaceEdit-first approach (openTextDocument → applyEdit → save)
 * was reverted because it caused "file is newer" conflict dialogs in VS Code.
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

  /** Read directly from disk, bypassing the textDocuments cache. Used by undo tracking. */
  async readFileFromDisk(absolutePath: string): Promise<string> {
    const uri = vscode.Uri.file(absolutePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(content);
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);

    // Write directly to disk — reliable for Vite HMR and avoids VS Code
    // "file is newer" conflict dialogs that WorkspaceEdit + save can trigger.
    // Undo/redo uses content-based snapshots in UndoRedoService, not VS Code native undo.
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

    // Sync the in-memory document if it is open, so the next readFile() call returns
    // the new content immediately (before VS Code's file-system watcher fires).
    const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    if (openDoc && openDoc.getText() !== content) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(openDoc.getText().length));
      edit.replace(uri, fullRange, content);
      await Promise.resolve(vscode.workspace.applyEdit(edit)).catch(() => {});
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

  async listFiles(dirPath: string, extensions?: string[]): Promise<string[]> {
    const results: string[] = [];
    const exts = extensions ?? ['.tsx', '.jsx'];

    const walk = async (dir: vscode.Uri): Promise<void> => {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return;
      }
      for (const [name, type] of entries) {
        const childUri = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          if (name === 'node_modules' || name === '.next' || name === 'dist' || name === '.git') continue;
          await walk(childUri);
        } else if (type === vscode.FileType.File && exts.some((ext) => name.endsWith(ext))) {
          results.push(childUri.fsPath);
        }
      }
    };

    await walk(vscode.Uri.file(dirPath));
    return results;
  }
}
