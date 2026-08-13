/**
 * @file OpfsFileIO — a lib/ast FileIO over the OPFS NodePod project tree, so the SAME shared i18n
 *   resolution + write code (discoverLayout / listKeysForBinding / writeI18nResource) runs in the
 *   browser against the in-browser project files (HYP-372 Phase 2 / HYP-746).
 *
 * Accessed via: the NodePod retarget/scan transport (nodepodRetargetTransport.ts). The shared
 *   i18n code is given projectRoot='' so every path it builds is `/<rel>` (e.g. `/locales/en.json`);
 *   this adapter strips the leading slash and resolves the rest under hyper-nodepod/<projectId>/ —
 *   the SAME OPFS layout client/lib/client-file-store/opfs.ts seeds and the NodePod pod mounts.
 *
 * Distinct from OpfsFileStore (shared/i18n-text/retarget): that store is the orchestrator's
 *   read/write/lock seam for the ONE source file being rewritten, with cross-tab Web Locks. This
 *   FileIO is the broader, lock-free locale-dictionary I/O the resolver/writer need (key listing,
 *   layout discovery, the locale-JSON create). Two adapters, one OPFS — kept separate because their
 *   contracts differ (FileStore.withLock vs FileIO.listFiles).
 */
import type { FileIO } from '../../../../lib/ast/file-io';

const NODEPOD_ROOT_DIR = 'hyper-nodepod';

export interface OpfsFileIOOptions {
  projectId: string;
  /** Resolve the OPFS root. Defaults to navigator.storage.getDirectory(); injected in tests. */
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
}

/**
 * Normalize a shared-code path ('' projectRoot → leading-slash relative) to OPFS path segments.
 * Rejects '..' traversal explicitly — sandbox enforcement is ours, not the OPFS handle API's; a
 * '..' must never let a path escape hyper-nodepod/<projectId>/ into another project's tree.
 */
function toSegments(path: string): string[] {
  const segs = path.split('/').filter((p) => p.length > 0 && p !== '.');
  if (segs.some((p) => p === '..')) throw new Error(`OpfsFileIO: path traversal rejected: ${path}`);
  return segs;
}

export class OpfsFileIO implements FileIO {
  private readonly projectId: string;
  private readonly getRoot: () => Promise<FileSystemDirectoryHandle>;

  constructor(options: OpfsFileIOOptions) {
    this.projectId = options.projectId;
    this.getRoot = options.getRoot ?? (() => navigator.storage.getDirectory());
  }

  private async projectDir(create: boolean): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    const nodepod = await root.getDirectoryHandle(NODEPOD_ROOT_DIR, { create: true });
    return nodepod.getDirectoryHandle(this.projectId, { create });
  }

  private async dirFor(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let cur = await this.projectDir(create);
    for (const seg of segments) {
      cur = await cur.getDirectoryHandle(seg, { create });
    }
    return cur;
  }

  async readFile(absolutePath: string): Promise<string> {
    const segs = toSegments(absolutePath);
    const filename = segs.pop();
    if (filename === undefined) throw new Error(`OpfsFileIO: empty path`);
    const dir = await this.dirFor(segs, false);
    const fh = await dir.getFileHandle(filename, { create: false });
    const file = await fh.getFile();
    return file.text();
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    const segs = toSegments(absolutePath);
    const filename = segs.pop();
    if (filename === undefined) throw new Error(`OpfsFileIO: empty path`);
    const dir = await this.dirFor(segs, true);
    const fh = await dir.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (err) {
      await writable.abort?.().catch(() => {});
      throw err;
    }
  }

  /** Resolve to a handle to assert existence; throws (like fs.access) when absent. */
  async access(absolutePath: string): Promise<void> {
    const segs = toSegments(absolutePath);
    const filename = segs.pop();
    if (filename === undefined) throw new Error(`OpfsFileIO: empty path`);
    const dir = await this.dirFor(segs, false);
    await dir.getFileHandle(filename, { create: false });
  }

  async mkdir(dirPath: string): Promise<void> {
    await this.dirFor(toSegments(dirPath), true);
  }

  /** Recursively list files under dirPath, returning leading-slash-relative paths (matches input). */
  async listFiles(dirPath: string, extensions?: string[]): Promise<string[]> {
    const segs = toSegments(dirPath);
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await this.dirFor(segs, false);
    } catch {
      return []; // directory absent — resolver treats this as "no candidates here"
    }
    const base = `/${segs.join('/')}`;
    const out: string[] = [];
    await this.walk(dir, base, extensions, out);
    return out;
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    extensions: string[] | undefined,
    out: string[],
  ): Promise<void> {
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      const path = `${prefix}/${name}`;
      if (handle.kind === 'directory') {
        await this.walk(handle as FileSystemDirectoryHandle, path, extensions, out);
      } else if (!extensions || extensions.some((ext) => name.endsWith(ext))) {
        out.push(path);
      }
    }
  }
}
