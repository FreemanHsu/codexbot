import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { CodexRateLimitReader, normalizeRateLimitSnapshot } from '../src/codex/rate-limit-reader.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

class MockChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0);
    return true;
  }
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  } as any;
}

describe('CodexRateLimitReader', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('normalizes codex rate limit response', () => {
    const snapshot = normalizeRateLimitSnapshot({
      rateLimits: {
        limitId: 'fallback',
        limitName: 'Fallback',
        primary: null,
        secondary: null,
      },
      rateLimitsByLimitId: {
        codex: {
          limitId: 'codex',
          limitName: 'Codex Pro',
          primary: { usedPercent: 12.5, windowDurationMins: 300, resetsAt: 1773000000 },
          secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1773500000 },
        },
      },
    });

    expect(snapshot.limitId).toBe('codex');
    expect(snapshot.primary?.remainingPercent).toBe(87.5);
    expect(snapshot.secondary?.remainingPercent).toBe(60);
  });

  it('reads rate limits from codex app-server', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);

    const writes: string[] = [];
    child.stdin.on('data', (chunk) => {
      writes.push(chunk.toString());
    });

    const reader = new CodexRateLimitReader(createLogger());
    const promise = reader.read();

    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: 'Codex' } })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write(`${JSON.stringify({
      id: 2,
      result: {
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex Pro',
          primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1773000000 },
          secondary: { usedPercent: 55, windowDurationMins: 10080, resetsAt: 1773500000 },
        },
        rateLimitsByLimitId: null,
      },
    })}\n`);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith('codex', ['app-server'], expect.any(Object));
    expect(writes.join('')).toContain('"method":"initialize"');
    expect(writes.join('')).toContain('"method":"initialized"');
    expect(writes.join('')).toContain('"method":"account/rateLimits/read"');
    expect(result.primary?.remainingPercent).toBe(80);
    expect(result.secondary?.remainingPercent).toBe(45);
  });

  it('surfaces app-server errors', async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child);

    const reader = new CodexRateLimitReader(createLogger());
    const promise = reader.read();

    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: 'Codex' } })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write(`${JSON.stringify({ error: { code: -32603, message: 'network blocked' }, id: 2 })}\n`);

    await expect(promise).rejects.toThrow('network blocked');
  });
});
