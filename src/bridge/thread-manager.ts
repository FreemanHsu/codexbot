import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '../utils/logger.js';

export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  archived: boolean;
  modelMode: 'chat' | 'codex';
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

interface ChatThreadsState {
  activeThreadId: string;
  threads: Record<string, ThreadSummary>;
  messages: Record<string, ThreadMessage[]>;
}

type PersistedState = Record<string, ChatThreadsState>;

const MAX_THREADS_PER_CHAT = 200;
const MAX_MESSAGES_PER_THREAD = 2000;

export class ThreadManager {
  private chats = new Map<string, ChatThreadsState>();
  private persistPath: string;

  constructor(
    private logger: Logger,
    botName: string = 'default',
    private defaultModelMode: 'chat' | 'codex' = 'chat',
  ) {
    const dataDir = process.env.SESSION_STORE_DIR || path.join(os.homedir(), '.codexbot');
    fs.mkdirSync(dataDir, { recursive: true });
    this.persistPath = path.join(dataDir, `threads-${botName}.json`);
    this.loadFromDisk();
  }

  static contextKey(chatId: string, threadId: string): string {
    return `${chatId}::${threadId}`;
  }

  getActiveThread(chatId: string): ThreadSummary {
    const state = this.ensureChat(chatId);
    return state.threads[state.activeThreadId];
  }

  getThread(chatId: string, threadId: string): ThreadSummary | undefined {
    const state = this.ensureChat(chatId);
    return state.threads[threadId];
  }

  createThread(chatId: string, title?: string): ThreadSummary {
    const state = this.ensureChat(chatId);
    const activeCount = Object.values(state.threads).filter((t) => !t.archived).length;
    if (activeCount >= MAX_THREADS_PER_CHAT) {
      throw new Error(`Thread limit reached (${MAX_THREADS_PER_CHAT})`);
    }

    const now = Date.now();
    const id = this.generateThreadId();
    const summary: ThreadSummary = {
      id,
      title: this.normalizeTitle(title) || this.defaultTitle(now),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      archived: false,
      modelMode: this.defaultModelMode,
    };
    state.threads[id] = summary;
    state.messages[id] = [];
    state.activeThreadId = id;
    this.saveToDisk();
    return summary;
  }

  switchThread(chatId: string, threadId: string): ThreadSummary | undefined {
    const state = this.ensureChat(chatId);
    const thread = state.threads[threadId];
    if (!thread || thread.archived) return undefined;
    state.activeThreadId = threadId;
    thread.updatedAt = Date.now();
    this.saveToDisk();
    return thread;
  }

  listThreads(chatId: string, includeArchived: boolean = false): Array<ThreadSummary & { active: boolean }> {
    const state = this.ensureChat(chatId);
    return Object.values(state.threads)
      .filter((t) => includeArchived || !t.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((t) => ({ ...t, active: t.id === state.activeThreadId }));
  }

  renameThread(chatId: string, threadId: string, title: string): ThreadSummary | undefined {
    const state = this.ensureChat(chatId);
    const thread = state.threads[threadId];
    if (!thread || thread.archived) return undefined;
    const normalized = this.normalizeTitle(title);
    if (!normalized) return undefined;
    thread.title = normalized;
    thread.updatedAt = Date.now();
    this.saveToDisk();
    return thread;
  }

  setThreadModel(chatId: string, threadId: string, modelMode: 'chat' | 'codex'): ThreadSummary | undefined {
    const state = this.ensureChat(chatId);
    const thread = state.threads[threadId];
    if (!thread || thread.archived) return undefined;
    thread.modelMode = modelMode;
    thread.updatedAt = Date.now();
    this.saveToDisk();
    return thread;
  }

  archiveThread(chatId: string, threadId: string): { archived: ThreadSummary; active: ThreadSummary } | undefined {
    const state = this.ensureChat(chatId);
    const thread = state.threads[threadId];
    if (!thread || thread.archived) return undefined;
    thread.archived = true;
    thread.updatedAt = Date.now();

    if (state.activeThreadId === threadId) {
      const next = Object.values(state.threads)
        .filter((t) => !t.archived && t.id !== threadId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (next) {
        state.activeThreadId = next.id;
      } else {
        const created = this.createThread(chatId, 'New Thread');
        state.activeThreadId = created.id;
      }
    }
    const active = state.threads[state.activeThreadId];
    this.saveToDisk();
    return { archived: thread, active };
  }

  getThreadMessages(chatId: string, threadId: string, limit: number = 20): ThreadMessage[] {
    const state = this.ensureChat(chatId);
    const messages = state.messages[threadId] || [];
    const safeLimit = Math.max(1, Math.min(100, limit));
    return messages.slice(-safeLimit);
  }

  appendMessage(chatId: string, threadId: string, role: ThreadMessage['role'], text: string): void {
    const state = this.ensureChat(chatId);
    const thread = state.threads[threadId];
    if (!thread) return;

    const messages = state.messages[threadId] || [];
    messages.push({
      id: this.generateMessageId(),
      role,
      text,
      createdAt: Date.now(),
    });
    if (messages.length > MAX_MESSAGES_PER_THREAD) {
      messages.splice(0, messages.length - MAX_MESSAGES_PER_THREAD);
    }
    state.messages[threadId] = messages;

    thread.messageCount = messages.length;
    thread.updatedAt = Date.now();
    if (role === 'user' && thread.messageCount <= 1 && this.isDefaultTitle(thread.title)) {
      const inferred = this.normalizeTitle(text);
      if (inferred) {
        thread.title = inferred;
      }
    }
    this.saveToDisk();
  }

  private ensureChat(chatId: string): ChatThreadsState {
    let state = this.chats.get(chatId);
    if (!state) {
      const now = Date.now();
      const initialId = this.generateThreadId();
      const initialThread: ThreadSummary = {
        id: initialId,
        title: this.defaultTitle(now),
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        archived: false,
        modelMode: this.defaultModelMode,
      };
      state = {
        activeThreadId: initialId,
        threads: { [initialId]: initialThread },
        messages: { [initialId]: [] },
      };
      this.chats.set(chatId, state);
      this.saveToDisk();
    }
    return state;
  }

  private defaultTitle(ts: number): string {
    const date = new Date(ts);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `Thread ${mm}-${dd} ${hh}:${mi}`;
  }

  private isDefaultTitle(title: string): boolean {
    return title.startsWith('Thread ');
  }

  private normalizeTitle(input: string | undefined): string | undefined {
    if (!input) return undefined;
    const title = input.trim().replace(/\s+/g, ' ');
    if (!title) return undefined;
    return title.length > 40 ? `${title.slice(0, 40)}...` : title;
  }

  private generateThreadId(): string {
    const tail = Math.random().toString(36).slice(2, 8);
    return `t_${tail}`;
  }

  private generateMessageId(): string {
    const tail = Math.random().toString(36).slice(2, 10);
    return `m_${tail}`;
  }

  private saveToDisk(): void {
    try {
      const data: PersistedState = {};
      for (const [chatId, state] of this.chats.entries()) {
        data[chatId] = state;
      }
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to persist threads to disk');
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      for (const [chatId, state] of Object.entries(parsed)) {
        if (!state.activeThreadId || !state.threads?.[state.activeThreadId]) continue;
        for (const thread of Object.values(state.threads)) {
          if (typeof thread.archived !== 'boolean') {
            thread.archived = false;
          }
          if (thread.modelMode !== 'chat' && thread.modelMode !== 'codex') {
            thread.modelMode = this.defaultModelMode;
          }
        }
        this.chats.set(chatId, state);
      }
      if (this.chats.size > 0) {
        this.logger.info({ count: this.chats.size, path: this.persistPath }, 'Restored thread states from disk');
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to load thread states, starting fresh');
    }
  }
}
