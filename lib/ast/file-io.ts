/**
 * File I/O abstraction for AST operations
 * Allows different implementations for Node.js, VS Code, etc.
 */

export interface FileIO {
  readFile(absolutePath: string): Promise<string>;
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Check if file exists (throws if not) */
  access(absolutePath: string): Promise<void>;
}
