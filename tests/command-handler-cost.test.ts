import { describe, it, expect, vi } from 'vitest';
import { CommandHandler } from '../src/bridge/command-handler.js';
import { AuditLogger } from '../src/utils/audit-logger.js';

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn() }),
  } as any;
}

describe('CommandHandler /cost', () => {
  it('returns current quota', async () => {
    const logger = createLogger();
    const sender = {
      sendTextNotice: vi.fn(),
    } as any;

    const handler = new CommandHandler(
      {
        name: 'bot',
        codex: {
          defaultWorkingDirectory: '/tmp',
          allowedTools: [],
          maxTurns: undefined,
          maxBudgetUsd: undefined,
          model: undefined,
          outputsBaseDir: '/tmp',
          downloadsDir: '/tmp',
        },
      },
      logger,
      sender,
      {} as any,
      {} as any,
      {} as any,
      new AuditLogger(logger),
      async () => ({
        limitId: 'codex',
        limitName: 'Codex Pro',
        primary: { usedPercent: 12.5, remainingPercent: 87.5, windowDurationMins: 300, resetsAt: 1773000000 },
        secondary: { usedPercent: 40, remainingPercent: 60, windowDurationMins: 10080, resetsAt: 1773500000 },
      }),
      () => undefined,
      vi.fn(),
    );

    const handled = await handler.handle({
      messageId: 'm1',
      chatId: 'c1',
      chatType: 'p2p',
      userId: 'u1',
      text: '/cost',
    });

    expect(handled).toBe(true);
    expect(sender.sendTextNotice).toHaveBeenCalledWith(
      'c1',
      '💳 Codex Quota',
      expect.stringContaining('5h'),
      'blue',
    );
    expect(sender.sendTextNotice).toHaveBeenCalledWith(
      'c1',
      '💳 Codex Quota',
      expect.stringContaining('1 week'),
      'blue',
    );
  });

  it('returns an error notice when quota lookup fails', async () => {
    const logger = createLogger();
    const sender = {
      sendTextNotice: vi.fn(),
    } as any;

    const handler = new CommandHandler(
      {
        name: 'bot',
        codex: {
          defaultWorkingDirectory: '/tmp',
          allowedTools: [],
          maxTurns: undefined,
          maxBudgetUsd: undefined,
          model: undefined,
          outputsBaseDir: '/tmp',
          downloadsDir: '/tmp',
        },
      },
      logger,
      sender,
      {} as any,
      {} as any,
      {} as any,
      new AuditLogger(logger),
      async () => {
        throw new Error('network blocked');
      },
      () => undefined,
      vi.fn(),
    );

    await handler.handle({
      messageId: 'm1',
      chatId: 'c1',
      chatType: 'p2p',
      userId: 'u1',
      text: '/cost',
    });

    expect(sender.sendTextNotice).toHaveBeenCalledWith(
      'c1',
      '❌ Codex Quota Unavailable',
      expect.stringContaining('network blocked'),
      'red',
    );
  });
});
