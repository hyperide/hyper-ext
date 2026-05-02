/**
 * VS Code implementation of FileIO.
 *
 * Two-phase write strategy:
 * 1. Apply WorkspaceEdit to an open TextDocument (creates native VS Code undo entry).
 * 2. Save the document to disk (triggers Vite HMR).
 *
 * If the document is not yet open, we open it with openTextDocument first.
 * The previous approach (disk-first via workspace.fs.writeFile, then best-effort
 * WorkspaceEdit sync) had a race: the file-system watcher could reload the document
 * between the disk write and the WorkspaceEdit check, causing the WorkspaceEdit to
 * be skipped (content already matches) and leaving no undo entry. That broke undo
 * for some style writes and made redo impossible.
 *
 * doc.save() was historically unreliable for "background" documents not visible in
 * any editor tab, but openTextDocument ensures the document is in VS Code's model,
 * and applyEdit + save on a model-resident document works reliably.
 * Fallback: if save fails, we write directly to disk.
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

    // Ensure document is open in VS Code's text model so WorkspaceEdit creates
    // a proper undo entry. openTextDocument does not show it in a visible tab —
    // it only loads it into memory.
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      // File doesn't exist yet (new file) — write directly to disk.
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      return;
    }

    // If content is already identical, nothing to do.
    if (doc.getText() === content) return;

    // Apply WorkspaceEdit — this creates a native VS Code undo entry.
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(uri, fullRange, content);
    const applied = await vscode.workspace.applyEdit(edit);

    if (applied && doc.isDirty) {
      // Save the document to disk so Vite HMR picks up the change.
      const saved = await doc.save();
      if (!saved) {
        // Fallback: save failed (background document edge case) — write directly.
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      }
    } else if (!applied) {
      // WorkspaceEdit failed — fall back to direct disk write.
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
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
