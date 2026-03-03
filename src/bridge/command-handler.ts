import type { BotConfigBase } from '../config.js';
import type { Logger } from '../utils/logger.js';
import type { IncomingMessage } from '../types.js';
import type { IMessageSender } from './message-sender.interface.js';
import { SessionManager } from '../agent/session-manager.js';
import { MemoryClient } from '../memory/memory-client.js';
import { AuditLogger } from '../utils/audit-logger.js';
import { ThreadManager } from './thread-manager.js';

const MODEL_LABEL: Record<'chat' | 'codex', string> = {
  chat: 'gpt-5.2',
  codex: 'gpt-5.3-codex',
};

export class CommandHandler {
  constructor(
    private config: BotConfigBase,
    private logger: Logger,
    private sender: IMessageSender,
    private sessionManager: SessionManager,
    private threadManager: ThreadManager,
    private memoryClient: MemoryClient,
    private audit: AuditLogger,
    private getRunningTask: (chatId: string) => { startTime: number } | undefined,
    private stopTask: (chatId: string) => void,
  ) {}

  /** Returns true if the message was handled as a command, false otherwise. */
  async handle(msg: IncomingMessage): Promise<boolean> {
    const { text } = msg;
    if (!text.startsWith('/')) return false;

    const { userId, chatId } = msg;
    const [cmd] = text.split(/\s+/);

    this.audit.log({ event: 'command', botName: this.config.name, chatId, userId, prompt: cmd });

    switch (cmd.toLowerCase()) {
      case '/help':
        await this.sender.sendTextNotice(chatId, '📖 Help', [
          '**Available Commands:**',
          '`/new [title]` - Create and switch to a new thread',
          '`/list [all]` - List threads in this chat',
          '`/thread <id>` - Switch active thread',
          '`/model [codex|chat]` - Show or switch thread model',
          '`/history [threadId] [n]` - Show recent history',
          '`/rename <id> <title>` - Rename thread',
          '`/archive <id>` - Archive thread',
          '`/reset` - Clear session, start fresh',
          '`/stop` - Abort current running task',
          '`/status` - Show current session info',
          '`/memory` - Memory document commands',
          '`/help` - Show this help message',
          '',
          '**Usage:**',
          'Send any text message to start a conversation with the agent backend.',
          'Each chat has an independent session with a fixed working directory.',
          '',
          '**Memory Commands:**',
          '`/memory list` - Show folder tree',
          '`/memory search <query>` - Search documents',
          '`/memory status` - Server health check',
        ].join('\n'));
        return true;

      case '/new': {
        if (this.getRunningTask(chatId)) {
          await this.sender.sendTextNotice(chatId, '⏳ Task In Progress', 'Please wait for current task to finish, or use `/stop` first.', 'orange');
          return true;
        }
        const title = text.slice('/new'.length).trim();
        const thread = this.threadManager.createThread(chatId, title || undefined);
        await this.sender.sendTextNotice(
          chatId,
          '🆕 New Thread',
          [
            `Switched to \`${thread.id}\``,
            `Title: ${thread.title}`,
          ].join('\n'),
          'green',
        );
        return true;
      }

      case '/list': {
        const args = text.slice('/list'.length).trim().toLowerCase();
        const includeArchived = args === 'all';
        const threads = this.threadManager.listThreads(chatId, includeArchived);
        const lines = threads.slice(0, 30).map((t) => {
          const marker = t.active ? '*' : ' ';
          const ago = this.formatAgo(t.updatedAt);
          const archived = t.archived ? ' | archived' : '';
          return `${marker} \`${t.id}\` | ${t.title} | model=${t.modelMode} | ${ago} | ${t.messageCount} msgs${archived}`;
        });
        await this.sender.sendTextNotice(
          chatId,
          `🧵 Threads (${threads.length}${includeArchived ? ', include archived' : ''})`,
          lines.length > 0 ? lines.join('\n') : 'No threads.',
          'blue',
        );
        return true;
      }

      case '/thread': {
        const id = text.slice('/thread'.length).trim();
        const current = this.threadManager.getActiveThread(chatId);
        if (!id) {
          await this.sender.sendTextNotice(
            chatId,
            '🧵 Current Thread',
            [`ID: \`${current.id}\``, `Title: ${current.title}`, `Messages: ${current.messageCount}`].join('\n'),
            'blue',
          );
          return true;
        }
        if (this.getRunningTask(chatId)) {
          await this.sender.sendTextNotice(chatId, '⏳ Task In Progress', 'Please wait for current task to finish, or use `/stop` first.', 'orange');
          return true;
        }
        const switched = this.threadManager.switchThread(chatId, id);
        if (!switched) {
          await this.sender.sendTextNotice(chatId, '❌ Thread Not Found', `Cannot find thread: \`${id}\`\nUse \`/list\` to view available threads.`, 'red');
          return true;
        }
        await this.sender.sendTextNotice(chatId, '✅ Thread Switched', [`Now using \`${switched.id}\``, `Title: ${switched.title}`].join('\n'), 'green');
        return true;
      }

      case '/model': {
        const mode = text.slice('/model'.length).trim().toLowerCase();
        const current = this.threadManager.getActiveThread(chatId);
        if (!mode) {
          await this.sender.sendTextNotice(
            chatId,
            '🤖 Thread Model',
            [
              `Thread: \`${current.id}\` (${current.title})`,
              `Mode: \`${current.modelMode}\``,
              `Model: \`${MODEL_LABEL[current.modelMode]}\``,
              'Switch with `/model codex` or `/model chat`',
            ].join('\n'),
            'blue',
          );
          return true;
        }
        if (mode !== 'chat' && mode !== 'codex') {
          await this.sender.sendTextNotice(chatId, '🤖 Model', 'Usage: `/model` or `/model codex|chat`', 'orange');
          return true;
        }
        if (this.getRunningTask(chatId)) {
          await this.sender.sendTextNotice(chatId, '⏳ Task In Progress', 'Please wait for current task to finish, or use `/stop` first.', 'orange');
          return true;
        }
        const updated = this.threadManager.setThreadModel(chatId, current.id, mode);
        if (!updated) {
          await this.sender.sendTextNotice(chatId, '❌ Model Update Failed', 'Could not update thread model.', 'red');
          return true;
        }
        this.sessionManager.resetSession(ThreadManager.contextKey(chatId, updated.id));
        await this.sender.sendTextNotice(
          chatId,
          '✅ Model Switched',
          [
            `Thread: \`${updated.id}\``,
            `Mode: \`${updated.modelMode}\``,
            `Model: \`${MODEL_LABEL[updated.modelMode]}\``,
            'Session reset to avoid mixed-model context.',
          ].join('\n'),
          'green',
        );
        return true;
      }

      case '/history': {
        const args = text.slice('/history'.length).trim().split(/\s+/).filter(Boolean);
        const current = this.threadManager.getActiveThread(chatId);
        let threadId = current.id;
        let limit = 20;

        if (args[0]) {
          if (args[0].startsWith('t_')) {
            threadId = args[0];
            if (args[1]) {
              const maybeLimit = parseInt(args[1], 10);
              if (!Number.isNaN(maybeLimit)) limit = maybeLimit;
            }
          } else {
            const maybeLimit = parseInt(args[0], 10);
            if (!Number.isNaN(maybeLimit)) limit = maybeLimit;
          }
        }
        const thread = this.threadManager.getThread(chatId, threadId);
        if (!thread) {
          await this.sender.sendTextNotice(chatId, '❌ Thread Not Found', `Cannot find thread: \`${threadId}\``, 'red');
          return true;
        }
        const messages = this.threadManager.getThreadMessages(chatId, threadId, limit);
        const content = messages.length === 0
          ? '_No messages yet._'
          : messages.map((m) => {
            const d = new Date(m.createdAt);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const role = m.role === 'user' ? 'U' : 'A';
            const line = m.text.replace(/\s+/g, ' ').trim();
            return `[${hh}:${mm}] ${role}: ${line.length > 140 ? `${line.slice(0, 140)}...` : line}`;
          }).join('\n');
        await this.sender.sendTextNotice(chatId, `📜 History ${thread.id}`, content, 'blue');
        return true;
      }

      case '/rename': {
        const args = text.slice('/rename'.length).trim();
        if (!args) {
          await this.sender.sendTextNotice(chatId, '🧵 Rename', 'Usage: `/rename <threadId> <new title>`', 'orange');
          return true;
        }
        const parts = args.split(/\s+/);
        const threadId = parts[0];
        const newTitle = args.slice(threadId.length).trim();
        if (!threadId.startsWith('t_') || !newTitle) {
          await this.sender.sendTextNotice(chatId, '🧵 Rename', 'Usage: `/rename <threadId> <new title>`', 'orange');
          return true;
        }
        const renamed = this.threadManager.renameThread(chatId, threadId, newTitle);
        if (!renamed) {
          await this.sender.sendTextNotice(chatId, '❌ Rename Failed', `Cannot rename thread: \`${threadId}\``, 'red');
          return true;
        }
        await this.sender.sendTextNotice(chatId, '✅ Thread Renamed', `\`${renamed.id}\` -> ${renamed.title}`, 'green');
        return true;
      }

      case '/archive': {
        if (this.getRunningTask(chatId)) {
          await this.sender.sendTextNotice(chatId, '⏳ Task In Progress', 'Please wait for current task to finish, or use `/stop` first.', 'orange');
          return true;
        }
        const id = text.slice('/archive'.length).trim() || this.threadManager.getActiveThread(chatId).id;
        const archived = this.threadManager.archiveThread(chatId, id);
        if (!archived) {
          await this.sender.sendTextNotice(chatId, '❌ Archive Failed', `Cannot archive thread: \`${id}\``, 'red');
          return true;
        }
        this.sessionManager.resetSession(ThreadManager.contextKey(chatId, archived.archived.id));
        await this.sender.sendTextNotice(
          chatId,
          '📦 Thread Archived',
          [`Archived: \`${archived.archived.id}\``, `Active: \`${archived.active.id}\` (${archived.active.title})`].join('\n'),
          'green',
        );
        return true;
      }

      case '/reset':
        this.sessionManager.resetSession(ThreadManager.contextKey(chatId, this.threadManager.getActiveThread(chatId).id));
        await this.sender.sendTextNotice(chatId, '✅ Session Reset', 'Conversation cleared. Working directory preserved.', 'green');
        return true;

      case '/stop': {
        const task = this.getRunningTask(chatId);
        if (task) {
          this.audit.log({ event: 'task_stopped', botName: this.config.name, chatId, userId, durationMs: Date.now() - task.startTime });
          this.stopTask(chatId);
          await this.sender.sendTextNotice(chatId, '🛑 Stopped', 'Current task has been aborted.', 'orange');
        } else {
          await this.sender.sendTextNotice(chatId, 'ℹ️ No Running Task', 'There is no task to stop.', 'blue');
        }
        return true;
      }

      case '/status': {
        const activeThread = this.threadManager.getActiveThread(chatId);
        const session = this.sessionManager.getSession(ThreadManager.contextKey(chatId, activeThread.id));
        const isRunning = !!this.getRunningTask(chatId);
        await this.sender.sendTextNotice(chatId, '📊 Status', [
          `**User:** \`${userId}\``,
          `**Thread:** \`${activeThread.id}\` (${activeThread.title})`,
          `**Model:** \`${activeThread.modelMode}\` (\`${MODEL_LABEL[activeThread.modelMode]}\`)`,
          `**Working Directory:** \`${session.workingDirectory}\``,
          `**Session:** ${session.sessionId ? `\`${session.sessionId.slice(0, 8)}...\`` : '_None_'}`,
          `**Running:** ${isRunning ? 'Yes ⏳' : 'No'}`,
        ].join('\n'));
        return true;
      }

      case '/memory': {
        const args = text.slice('/memory'.length).trim();
        await this.handleMemoryCommand(chatId, args);
        return true;
      }

      default:
        // Unrecognized /xxx commands — not handled here, pass through to Codex
        return false;
    }
  }

  private formatAgo(ts: number): string {
    const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `${day}d ago`;
  }

  private async handleMemoryCommand(chatId: string, args: string): Promise<void> {
    const [subCmd, ...rest] = args.split(/\s+/);

    if (!subCmd) {
      await this.sender.sendTextNotice(
        chatId,
        '📝 Memory',
        'Usage:\n- `/memory list` — Show folder tree\n- `/memory search <query>` — Search documents\n- `/memory status` — Health check',
      );
      return;
    }

    try {
      switch (subCmd.toLowerCase()) {
        case 'list': {
          const tree = await this.memoryClient.listFolderTree();
          const formatted = this.memoryClient.formatFolderTree(tree);
          await this.sender.sendTextNotice(chatId, '📂 Memory Folders', formatted);
          break;
        }
        case 'search': {
          const query = rest.join(' ').trim();
          if (!query) {
            await this.sender.sendTextNotice(chatId, '📝 Memory', 'Usage: `/memory search <query>`');
            return;
          }
          const results = await this.memoryClient.search(query);
          const formatted = this.memoryClient.formatSearchResults(results);
          await this.sender.sendTextNotice(chatId, `🔍 Search: ${query}`, formatted);
          break;
        }
        case 'status': {
          const health = await this.memoryClient.health();
          await this.sender.sendTextNotice(
            chatId,
            '📝 Memory Status',
            `Status: ${health.status}\nDocuments: ${health.document_count}\nFolders: ${health.folder_count}`,
            'green',
          );
          break;
        }
        default:
          await this.sender.sendTextNotice(chatId, '📝 Memory', `Unknown sub-command: \`${subCmd}\`\nUse \`/memory\` for help.`, 'orange');
      }
    } catch (err: any) {
      this.logger.error({ err, chatId }, 'Memory command error');
      await this.sender.sendTextNotice(chatId, '❌ Memory Error', `Failed to connect to memory server: ${err.message}`, 'red');
    }
  }
}
