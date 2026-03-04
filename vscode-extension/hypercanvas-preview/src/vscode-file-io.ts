/**
 * VS Code implementation of FileIO.
 * Writes go through WorkspaceEdit so that Cmd+Z/Shift+Cmd+Z
 * undo/redo AST mutations natively in the editor.
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
    const doc = await vscode.workspace.openTextDocument(uri);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(uri, fullRange, content);

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      throw new Error(`WorkspaceEdit failed for ${absolutePath}`);
    }

    // Save to disk so Vite HMR picks up the change
    const saved = await doc.save();
    if (!saved) {
      throw new Error(`Document save failed for ${absolutePath}`);
    }
  }

  async access(absolutePath: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    await vscode.workspace.fs.stat(uri);
  }
}
