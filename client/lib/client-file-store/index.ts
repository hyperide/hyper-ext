import { opfsStore } from './opfs';

export async function readFiles(projectId: string): Promise<Record<string, string>> {
  return opfsStore.readFiles(projectId);
}

export async function writeFile(projectId: string, path: string, content: string): Promise<void> {
  return opfsStore.writeFile(projectId, path, content);
}

export async function seedFiles(projectId: string, files: Record<string, string>): Promise<void> {
  return opfsStore.seedFiles(projectId, files);
}
