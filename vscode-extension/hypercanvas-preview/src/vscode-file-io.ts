/**
 * VS Code implementation of FileIO
 * Uses vscode.workspace.fs for file operations
 */

import * as vscode from 'vscode';
import type { FileIO } from '@lib/ast/file-io';

export class VSCodeFileIO implements FileIO {
  async readFile(absolutePath: string): Promise<string> {
    const uri = vscode.Uri.file(absolutePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(content);
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    const encoded = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, encoded);
  }

  async access(absolutePath: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    await vscode.workspace.fs.stat(uri);
  }
}
