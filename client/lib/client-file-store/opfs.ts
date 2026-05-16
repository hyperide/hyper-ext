export interface FileStore {
  readFiles(projectId: string): Promise<Record<string, string>>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  seedFiles(projectId: string, files: Record<string, string>): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

/** In-memory implementation — for unit tests and SSR environments without OPFS. */
export function makeStore(): FileStore {
  const data = new Map<string, Map<string, string>>();

  function project(id: string) {
    let p = data.get(id);
    if (!p) {
      p = new Map();
      data.set(id, p);
    }
    return p;
  }

  return {
    async readFiles(projectId) {
      return Object.fromEntries(project(projectId));
    },
    async writeFile(projectId, path, content) {
      project(projectId).set(path, content);
    },
    async seedFiles(projectId, files) {
      const p = project(projectId);
      for (const [k, v] of Object.entries(files)) p.set(k, v);
    },
    async clearProject(projectId) {
      data.delete(projectId);
    },
  };
}

function makeOpfsStore(): FileStore {
  async function projectDir(projectId: string, create = false) {
    const root = await navigator.storage.getDirectory();
    const nodepod = await root.getDirectoryHandle('hyper-nodepod', { create: true });
    return nodepod.getDirectoryHandle(projectId, { create });
  }

  async function readDir(dir: FileSystemDirectoryHandle, prefix = ''): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        Object.assign(out, await readDir(handle as FileSystemDirectoryHandle, path));
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        out[path] = await file.text();
      }
    }
    return out;
  }

  const self: FileStore = {
    async readFiles(projectId) {
      try {
        const dir = await projectDir(projectId);
        return readDir(dir);
      } catch {
        return {};
      }
    },
    async writeFile(projectId, path, content) {
      const dir = await projectDir(projectId, true);
      const parts = path.split('/');
      let cur = dir;
      for (const part of parts.slice(0, -1)) {
        cur = await cur.getDirectoryHandle(part, { create: true });
      }
      const filename = parts[parts.length - 1] ?? path;
      const fh = await cur.getFileHandle(filename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
    },
    async seedFiles(projectId, files) {
      await Promise.all(Object.entries(files).map(([path, content]) => self.writeFile(projectId, path, content)));
    },
    async clearProject(projectId) {
      try {
        const root = await navigator.storage.getDirectory();
        const nodepod = await root.getDirectoryHandle('hyper-nodepod', { create: false });
        await nodepod.removeEntry(projectId, { recursive: true });
      } catch {}
    },
  };

  return self;
}

export const opfsStore: FileStore =
  typeof navigator !== 'undefined' && 'storage' in navigator ? makeOpfsStore() : makeStore();
