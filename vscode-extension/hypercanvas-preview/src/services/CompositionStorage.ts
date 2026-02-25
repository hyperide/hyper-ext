/**
 * Composition Storage - stores canvas compositions in .hypercanvas/ folder
 *
 * Provides CRUD operations for canvas compositions without server dependency.
 * All data is stored locally in the user's project.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CanvasComposition, Chat, ChatMessage } from '../types';

// ============================================
// Constants
// ============================================

const HYPERCANVAS_DIR = '.hypercanvas';
const COMPOSITIONS_DIR = 'compositions';
const CHATS_DIR = 'chats';
const SETTINGS_FILE = 'settings.json';

// ============================================
// CompositionStorage Class
// ============================================

export class CompositionStorage {
  private _workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot;
  }

  // ============================================
  // Composition Methods
  // ============================================

  /**
   * Get composition for a component
   */
  async getComposition(componentPath: string): Promise<CanvasComposition | null> {
    try {
      const filePath = this._getCompositionPath(componentPath);
      const uri = vscode.Uri.file(filePath);

      const content = await vscode.workspace.fs.readFile(uri);
      const json = new TextDecoder().decode(content);
      return JSON.parse(json) as CanvasComposition;
    } catch (error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Save composition for a component
   */
  async saveComposition(
    componentPath: string,
    composition: CanvasComposition,
  ): Promise<void> {
    // Ensure directory exists
    await this._ensureDir(path.join(HYPERCANVAS_DIR, COMPOSITIONS_DIR));

    const filePath = this._getCompositionPath(componentPath);
    const uri = vscode.Uri.file(filePath);

    // Update timestamp
    composition.updatedAt = new Date().toISOString();

    const content = new TextEncoder().encode(JSON.stringify(composition, null, 2));
    await vscode.workspace.fs.writeFile(uri, content);
  }

  /**
   * Delete composition for a component
   */
  async deleteComposition(componentPath: string): Promise<void> {
    const filePath = this._getCompositionPath(componentPath);
    const uri = vscode.Uri.file(filePath);

    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * List all compositions
   */
  async listCompositions(): Promise<CanvasComposition[]> {
    try {
      const dirPath = path.join(
        this._workspaceRoot,
        HYPERCANVAS_DIR,
        COMPOSITIONS_DIR,
      );
      const uri = vscode.Uri.file(dirPath);

      const entries = await vscode.workspace.fs.readDirectory(uri);
      const compositions: CanvasComposition[] = [];

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.json')) {
          try {
            const fileUri = vscode.Uri.file(path.join(dirPath, name));
            const content = await vscode.workspace.fs.readFile(fileUri);
            const json = new TextDecoder().decode(content);
            compositions.push(JSON.parse(json) as CanvasComposition);
          } catch {
            // Skip invalid files
          }
        }
      }

      return compositions;
    } catch {
      // Directory doesn't exist
      return [];
    }
  }

  // ============================================
  // Chat Methods
  // ============================================

  /**
   * Get chat by ID
   */
  async getChat(chatId: string): Promise<Chat | null> {
    try {
      const filePath = this._getChatPath(chatId);
      const uri = vscode.Uri.file(filePath);

      const content = await vscode.workspace.fs.readFile(uri);
      const json = new TextDecoder().decode(content);
      return JSON.parse(json) as Chat;
    } catch {
      return null;
    }
  }

  /**
   * Save chat
   */
  async saveChat(chat: Chat): Promise<void> {
    // Ensure directory exists
    await this._ensureDir(path.join(HYPERCANVAS_DIR, CHATS_DIR));

    const filePath = this._getChatPath(chat.id);
    const uri = vscode.Uri.file(filePath);

    // Update timestamp
    chat.updatedAt = new Date().toISOString();

    const content = new TextEncoder().encode(JSON.stringify(chat, null, 2));
    await vscode.workspace.fs.writeFile(uri, content);
  }

  /**
   * Delete chat
   */
  async deleteChat(chatId: string): Promise<void> {
    const filePath = this._getChatPath(chatId);
    const uri = vscode.Uri.file(filePath);

    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * List all chats
   */
  async listChats(): Promise<Chat[]> {
    try {
      const dirPath = path.join(this._workspaceRoot, HYPERCANVAS_DIR, CHATS_DIR);
      const uri = vscode.Uri.file(dirPath);

      const entries = await vscode.workspace.fs.readDirectory(uri);
      const chats: Chat[] = [];

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.json')) {
          try {
            const fileUri = vscode.Uri.file(path.join(dirPath, name));
            const content = await vscode.workspace.fs.readFile(fileUri);
            const json = new TextDecoder().decode(content);
            chats.push(JSON.parse(json) as Chat);
          } catch {
            // Skip invalid files
          }
        }
      }

      // Sort by updatedAt descending
      chats.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      return chats;
    } catch {
      // Directory doesn't exist
      return [];
    }
  }

  /**
   * Add message to chat
   */
  async addChatMessage(chatId: string, message: ChatMessage): Promise<void> {
    let chat = await this.getChat(chatId);

    if (!chat) {
      // Create new chat
      chat = {
        id: chatId,
        title: message.content.substring(0, 50) + '...',
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    chat.messages.push(message);
    await this.saveChat(chat);
  }

  // ============================================
  // Settings Methods
  // ============================================

  /**
   * Get settings
   */
  async getSettings(): Promise<Record<string, unknown>> {
    try {
      const filePath = path.join(
        this._workspaceRoot,
        HYPERCANVAS_DIR,
        SETTINGS_FILE,
      );
      const uri = vscode.Uri.file(filePath);

      const content = await vscode.workspace.fs.readFile(uri);
      const json = new TextDecoder().decode(content);
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  /**
   * Save settings
   */
  async saveSettings(settings: Record<string, unknown>): Promise<void> {
    await this._ensureDir(HYPERCANVAS_DIR);

    const filePath = path.join(
      this._workspaceRoot,
      HYPERCANVAS_DIR,
      SETTINGS_FILE,
    );
    const uri = vscode.Uri.file(filePath);

    const content = new TextEncoder().encode(JSON.stringify(settings, null, 2));
    await vscode.workspace.fs.writeFile(uri, content);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Get composition file path
   */
  private _getCompositionPath(componentPath: string): string {
    // Convert component path to safe filename
    const safeName = componentPath
      .replace(/\//g, '_')
      .replace(/\\/g, '_')
      .replace(/\./g, '_');

    return path.join(
      this._workspaceRoot,
      HYPERCANVAS_DIR,
      COMPOSITIONS_DIR,
      `${safeName}.json`,
    );
  }

  /**
   * Get chat file path
   */
  private _getChatPath(chatId: string): string {
    return path.join(
      this._workspaceRoot,
      HYPERCANVAS_DIR,
      CHATS_DIR,
      `${chatId}.json`,
    );
  }

  /**
   * Ensure directory exists
   */
  private async _ensureDir(relativePath: string): Promise<void> {
    const dirPath = path.join(this._workspaceRoot, relativePath);
    const uri = vscode.Uri.file(dirPath);

    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      // Directory doesn't exist, create it
      await vscode.workspace.fs.createDirectory(uri);
    }
  }
}
