import { beforeEach, describe, expect, it, type mock } from 'bun:test';
import * as vscode from 'vscode';
import { CompositionStorage } from '../services/CompositionStorage';

const fsMock = vscode.workspace.fs;

function encode(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

describe('CompositionStorage', () => {
  let storage: CompositionStorage;

  beforeEach(() => {
    storage = new CompositionStorage('/project');
    // Reset all fs mocks
    for (const key of Object.keys(fsMock)) {
      const fn = fsMock[key as keyof typeof fsMock];
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as ReturnType<typeof mock>).mockReset();
      }
    }
  });

  // ============================================
  // Compositions
  // ============================================

  describe('getComposition', () => {
    it('returns parsed composition when file exists', async () => {
      const comp = { id: 'c1', componentPath: 'Button.tsx', instances: [] };
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(encode(comp)));
      const result = await storage.getComposition('src/Button.tsx');
      expect(result).toEqual(comp);
    });

    it('returns null when file does not exist', async () => {
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('not found')));
      const result = await storage.getComposition('missing.tsx');
      expect(result).toBeNull();
    });
  });

  describe('saveComposition', () => {
    it('writes JSON to filesystem', async () => {
      (fsMock.stat as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve({ type: 1 }));
      (fsMock.writeFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());

      const comp = { id: 'c1', componentPath: 'Button.tsx', instances: [], updatedAt: '' };
      await storage.saveComposition('src/Button.tsx', comp as never);

      expect(fsMock.writeFile).toHaveBeenCalled();
      // Verify content is valid JSON with updatedAt set
      const call = (fsMock.writeFile as ReturnType<typeof mock>).mock.calls[0];
      const written = JSON.parse(new TextDecoder().decode(call[1] as Uint8Array));
      expect(written.updatedAt).toBeTruthy();
    });

    it('creates directory if it does not exist', async () => {
      (fsMock.stat as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('not found')));
      (fsMock.createDirectory as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());
      (fsMock.writeFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());

      await storage.saveComposition('src/X.tsx', { id: 'c1' } as never);
      expect(fsMock.createDirectory).toHaveBeenCalled();
    });
  });

  describe('deleteComposition', () => {
    it('deletes file', async () => {
      (fsMock.delete as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());
      await storage.deleteComposition('src/Button.tsx');
      expect(fsMock.delete).toHaveBeenCalled();
    });

    it('ignores error if file does not exist', async () => {
      (fsMock.delete as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('not found')));
      // Should not throw
      await storage.deleteComposition('missing.tsx');
    });
  });

  describe('listCompositions', () => {
    it('returns empty array when directory does not exist', async () => {
      (fsMock.readDirectory as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error('not found')),
      );
      const result = await storage.listCompositions();
      expect(result).toEqual([]);
    });

    it('reads and parses all JSON files in directory', async () => {
      const comp1 = { id: 'c1', componentPath: 'A.tsx' };
      const comp2 = { id: 'c2', componentPath: 'B.tsx' };

      (fsMock.readDirectory as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          ['a_tsx.json', vscode.FileType.File],
          ['b_tsx.json', vscode.FileType.File],
          ['readme.md', vscode.FileType.File], // non-json, skip
          ['subdir', vscode.FileType.Directory], // directory, skip
        ]),
      );

      let callCount = 0;
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => {
        callCount++;
        return Promise.resolve(encode(callCount === 1 ? comp1 : comp2));
      });

      const result = await storage.listCompositions();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
    });
  });

  // ============================================
  // Chats
  // ============================================

  describe('getChat', () => {
    it('returns parsed chat when file exists', async () => {
      const chat = { id: 'chat-1', title: 'Test', messages: [], createdAt: '', updatedAt: '' };
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(encode(chat)));
      const result = await storage.getChat('chat-1');
      expect(result).toEqual(chat);
    });

    it('returns null when chat does not exist', async () => {
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('not found')));
      expect(await storage.getChat('missing')).toBeNull();
    });
  });

  describe('saveChat', () => {
    it('writes chat JSON and updates timestamp', async () => {
      (fsMock.stat as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve({ type: 1 }));
      (fsMock.writeFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());

      const chat = { id: 'c1', title: 'T', messages: [], createdAt: '', updatedAt: '' };
      await storage.saveChat(chat as never);

      const call = (fsMock.writeFile as ReturnType<typeof mock>).mock.calls[0];
      const written = JSON.parse(new TextDecoder().decode(call[1] as Uint8Array));
      expect(written.updatedAt).toBeTruthy();
    });
  });

  describe('deleteChat', () => {
    it('deletes chat file', async () => {
      (fsMock.delete as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());
      await storage.deleteChat('chat-1');
      expect(fsMock.delete).toHaveBeenCalled();
    });
  });

  describe('listChats', () => {
    it('returns chats sorted by updatedAt descending', async () => {
      const older = { id: 'c1', updatedAt: '2024-01-01T00:00:00Z' };
      const newer = { id: 'c2', updatedAt: '2025-06-01T00:00:00Z' };

      (fsMock.readDirectory as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve([
          ['c1.json', vscode.FileType.File],
          ['c2.json', vscode.FileType.File],
        ]),
      );

      let callCount = 0;
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => {
        callCount++;
        return Promise.resolve(encode(callCount === 1 ? older : newer));
      });

      const result = await storage.listChats();
      expect(result[0].id).toBe('c2'); // newer first
      expect(result[1].id).toBe('c1');
    });
  });

  describe('addChatMessage', () => {
    it('creates new chat if not found', async () => {
      // getChat returns null
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('not found')));
      (fsMock.stat as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve({ type: 1 }));
      (fsMock.writeFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());

      await storage.addChatMessage('new-chat', {
        role: 'user',
        content: 'Hello AI, fix my button please',
      } as never);

      const call = (fsMock.writeFile as ReturnType<typeof mock>).mock.calls[0];
      const written = JSON.parse(new TextDecoder().decode(call[1] as Uint8Array));
      expect(written.id).toBe('new-chat');
      expect(written.messages).toHaveLength(1);
      expect(written.title).toContain('Hello AI');
    });

    it('appends to existing chat', async () => {
      const existing = {
        id: 'c1',
        title: 'T',
        messages: [{ role: 'user', content: 'first' }],
        createdAt: '',
        updatedAt: '',
      };
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(encode(existing)));
      (fsMock.stat as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve({ type: 1 }));
      (fsMock.writeFile as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve());

      await storage.addChatMessage('c1', { role: 'assistant', content: 'reply' } as never);

      const call = (fsMock.writeFile as ReturnType<typeof mock>).mock.calls[0];
      const written = JSON.parse(new TextDecoder().decode(call[1] as Uint8Array));
      expect(written.messages).toHaveLength(2);
    });
  });

  // ============================================
  // Settings
  // ============================================

  describe('getSettings', () => {
    it('returns parsed settings', async () => {
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.resolve(encode({ aiKey: 'sk-123' })),
      );
      const result = await storage.getSettings();
      expect(result).toEqual({ aiKey: 'sk-123' });
    });

    it('returns empty object on error', async () => {
      (fsMock.readFile as ReturnType<typeof mock>).mockImplementation(() => Promise.reject(new Error('no')));
      expect(await storage.getSettings()).toEqual({});
    });
  });
});
