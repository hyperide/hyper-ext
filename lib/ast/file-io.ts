/**
 * File I/O abstraction for AST operations
 * Allows different implementations for Node.js, VS Code, etc.
 */

export interface FileIO {
  readFile(absolutePath: string): Promise<string>;
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Check if file exists (throws if not) */
  access(absolutePath: string): Promise<void>;
  /** Delete a file. Optional — implementations that don't support deletion can omit. */
  deleteFile?(absolutePath: string): Promise<void>;
  /** Create directory and parents (like mkdir -p). Optional — used before writing to nested paths. */
  mkdir?(dirPath: string): Promise<void>;
  /** List all files recursively under a directory. Optional — used for init-time full scan. */
  listFiles?(dirPath: string, extensions?: string[]): Promise<string[]>;
}
