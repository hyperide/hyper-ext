/**
 * ChatHistoryService — persists AI chat sessions to globalStorage.
 *
 * Storage layout (same pattern as Cline):
 *   globalStorage/
 *     chats/
 *       index.json          — ChatSession[] metadata
 *       <chat-id>.json      — ChatSessionData (messages + metadata)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatSession, ChatSessionData, DisplayMessage } from '../../../../shared/ai-chat-display';

export class ChatHistoryService {
  private readonly _chatsDir: string;
  private readonly _indexPath: string;
  private _index: ChatSession[] | null = null;

  constructor(globalStoragePath: string) {
    this._chatsDir = path.join(globalStoragePath, 'chats');
    this._indexPath = path.join(this._chatsDir, 'index.json');
  }

  /**
   * Ensure the chats directory exists
   */
  private async _ensureDir(): Promise<void> {
    await fs.mkdir(this._chatsDir, { recursive: true });
  }

  /**
   * Load the index from disk (cached after first read)
   */
  async listChats(): Promise<ChatSession[]> {
    if (this._index) return this._index;

    try {
      const raw = await fs.readFile(this._indexPath, 'utf-8');
      this._index = JSON.parse(raw) as ChatSession[];
    } catch {
      this._index = [];
    }
    return this._index;
  }

  /**
   * Create a new chat session. Returns the session metadata.
   */
  async createChat(title?: string): Promise<ChatSession> {
    await this._ensureDir();

    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const session: ChatSession = {
      id,
      title: title || 'New Chat',
      createdAt: now,
      updatedAt: now,
    };

    const data: ChatSessionData = { ...session, messages: [] };
    await fs.writeFile(this._chatPath(id), JSON.stringify(data, null, 2), 'utf-8');

    const index = await this.listChats();
    index.unshift(session);
    await this._saveIndex();

    return session;
  }

  /**
   * Load full chat data (messages + metadata)
   */
  async loadChat(chatId: string): Promise<ChatSessionData | null> {
    try {
      const raw = await fs.readFile(this._chatPath(chatId), 'utf-8');
      return JSON.parse(raw) as ChatSessionData;
    } catch {
      return null;
    }
  }

  /**
   * Append messages to a chat and update its metadata
   */
  async appendMessages(chatId: string, newMessages: DisplayMessage[]): Promise<void> {
    const data = await this.loadChat(chatId);
    if (!data) return;

    data.messages.push(...newMessages);
    data.updatedAt = Date.now();

    await fs.writeFile(this._chatPath(chatId), JSON.stringify(data, null, 2), 'utf-8');
    this._updateIndex(chatId, { updatedAt: data.updatedAt });
  }

  /**
   * Replace all messages in a chat (used after streaming completes)
   */
  async saveMessages(chatId: string, messages: DisplayMessage[]): Promise<void> {
    const data = await this.loadChat(chatId);
    if (!data) return;

    data.messages = messages;
    data.updatedAt = Date.now();

    await fs.writeFile(this._chatPath(chatId), JSON.stringify(data, null, 2), 'utf-8');
    this._updateIndex(chatId, { updatedAt: data.updatedAt });
  }

  /**
   * Update chat title (e.g. auto-generated from first message)
   */
  async updateTitle(chatId: string, title: string): Promise<void> {
    const data = await this.loadChat(chatId);
    if (!data) return;

    data.title = title;
    data.updatedAt = Date.now();

    await fs.writeFile(this._chatPath(chatId), JSON.stringify(data, null, 2), 'utf-8');
    this._updateIndex(chatId, { title, updatedAt: data.updatedAt });
  }

  /**
   * Delete a chat session
   */
  async deleteChat(chatId: string): Promise<void> {
    try {
      await fs.unlink(this._chatPath(chatId));
    } catch {
      // file may not exist
    }

    const index = await this.listChats();
    const idx = index.findIndex((c) => c.id === chatId);
    if (idx !== -1) {
      index.splice(idx, 1);
      await this._saveIndex();
    }
  }

  private _chatPath(chatId: string): string {
    return path.join(this._chatsDir, `${chatId}.json`);
  }

  private async _saveIndex(): Promise<void> {
    await this._ensureDir();
    await fs.writeFile(this._indexPath, JSON.stringify(this._index ?? [], null, 2), 'utf-8');
  }

  private _updateIndex(chatId: string, patch: Partial<ChatSession>): void {
    if (!this._index) return;
    const entry = this._index.find((c) => c.id === chatId);
    if (entry) {
      Object.assign(entry, patch);
      // Re-sort: most recently updated first
      this._index.sort((a, b) => b.updatedAt - a.updatedAt);
      // Fire-and-forget index save
      this._saveIndex().catch(() => {});
    }
  }
}
