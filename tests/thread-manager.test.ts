import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadManager } from '../src/bridge/thread-manager.js';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() } as any;
}

describe('ThreadManager', () => {
  let manager: ThreadManager;

  afterEach(() => {
    delete process.env.SESSION_STORE_DIR;
  });

  it('creates default thread and switches with /new semantics', () => {
    process.env.SESSION_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    manager = new ThreadManager(createLogger(), 'bot-a');

    const first = manager.getActiveThread('chat1');
    expect(first.id.startsWith('t_')).toBe(true);
    expect(first.modelMode).toBe('chat');

    const created = manager.createThread('chat1', 'Release planning');
    expect(created.title).toBe('Release planning');
    expect(manager.getActiveThread('chat1').id).toBe(created.id);

    const list = manager.listThreads('chat1');
    expect(list.length).toBe(2);
    expect(list.some((t) => t.id === created.id && t.active)).toBe(true);
  });

  it('tracks message count and infers title for untitled thread', () => {
    process.env.SESSION_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    manager = new ThreadManager(createLogger(), 'bot-b');
    const thread = manager.getActiveThread('chat1');

    manager.appendMessage('chat1', thread.id, 'user', 'Please help me debug Feishu callback failures');
    manager.appendMessage('chat1', thread.id, 'assistant', 'Let us inspect the callback payload first.');

    const updated = manager.getActiveThread('chat1');
    expect(updated.messageCount).toBe(2);
    expect(updated.title.includes('debug Feishu callback')).toBe(true);
  });

  it('persists and restores thread states', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    process.env.SESSION_STORE_DIR = base;
    const botName = 'bot-c';
    const chatId = 'chat1';
    const logger = createLogger();
    const m1 = new ThreadManager(logger, botName);
    const created = m1.createThread(chatId, 'Persistent Thread');
    m1.appendMessage(chatId, created.id, 'user', 'hello');

    const m2 = new ThreadManager(logger, botName);
    const list = m2.listThreads(chatId);
    expect(list.some((t) => t.id === created.id && t.messageCount === 1)).toBe(true);

    const persistedPath = path.join(base, `threads-${botName}.json`);
    expect(fs.existsSync(persistedPath)).toBe(true);
  });

  it('renames and archives thread with active fallback', () => {
    process.env.SESSION_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    manager = new ThreadManager(createLogger(), 'bot-d');
    const first = manager.getActiveThread('chat1');
    const second = manager.createThread('chat1', 'Second');

    const renamed = manager.renameThread('chat1', second.id, 'Renamed second thread');
    expect(renamed?.title).toBe('Renamed second thread');

    const archived = manager.archiveThread('chat1', second.id);
    expect(archived?.archived.archived).toBe(true);
    expect(archived?.active.id).toBe(first.id);
  });

  it('returns limited history', () => {
    process.env.SESSION_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    manager = new ThreadManager(createLogger(), 'bot-e');
    const thread = manager.getActiveThread('chat1');
    manager.appendMessage('chat1', thread.id, 'user', 'm1');
    manager.appendMessage('chat1', thread.id, 'assistant', 'm2');
    manager.appendMessage('chat1', thread.id, 'user', 'm3');

    const history = manager.getThreadMessages('chat1', thread.id, 2);
    expect(history.length).toBe(2);
    expect(history[0].text).toBe('m2');
    expect(history[1].text).toBe('m3');
  });

  it('supports per-thread model mode', () => {
    process.env.SESSION_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbot-thread-test-'));
    manager = new ThreadManager(createLogger(), 'bot-f', 'code');
    const thread = manager.getActiveThread('chat1');
    expect(thread.modelMode).toBe('code');

    const updated = manager.setThreadModel('chat1', thread.id, 'chat');
    expect(updated?.modelMode).toBe('chat');
  });
});
