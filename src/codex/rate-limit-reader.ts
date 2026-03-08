import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import type { Logger } from '../utils/logger.js';

export interface CodexRateLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
}

interface AppServerRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface AppServerRateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: AppServerRateLimitWindow | null;
  secondary: AppServerRateLimitWindow | null;
}

interface AppServerRateLimitResponse {
  rateLimits: AppServerRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, AppServerRateLimitSnapshot> | null;
}

const REQUEST_TIMEOUT_MS = 15000;

function normalizeWindow(window: AppServerRateLimitWindow | null): CodexRateLimitWindow | null {
  if (!window) return null;
  return {
    usedPercent: window.usedPercent,
    remainingPercent: Math.max(0, 100 - window.usedPercent),
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  };
}

export function normalizeRateLimitSnapshot(response: AppServerRateLimitResponse): CodexRateLimitSnapshot {
  const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: normalizeWindow(snapshot.primary),
    secondary: normalizeWindow(snapshot.secondary),
  };
}

export class CodexRateLimitReader {
  constructor(
    private logger: Logger,
    private executable = process.env.CODEX_EXECUTABLE_PATH || 'codex',
  ) {}

  async read(): Promise<CodexRateLimitSnapshot> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      let settled = false;
      let initialized = false;
      const stderrLines: string[] = [];

      const timeoutId = setTimeout(() => {
        finish(new Error('Timed out while reading Codex rate limits'));
        child.kill('SIGTERM');
      }, REQUEST_TIMEOUT_MS);

      const finish = (err?: Error, result?: CodexRateLimitSnapshot): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        stdoutReader.close();
        stderrReader.close();
        child.removeAllListeners();
        if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
        if (err) reject(err);
        else resolve(result!);
      };

      const send = (message: unknown): void => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };

      const handleJsonLine = (line: string): void => {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }

        if (message?.error) {
          const detail = typeof message.error?.message === 'string'
            ? message.error.message
            : 'Unknown Codex app-server error';
          finish(new Error(detail));
          return;
        }

        if (message?.id === 1 && message?.result) {
          initialized = true;
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
          return;
        }

        if (message?.id === 2 && message?.result) {
          try {
            finish(undefined, normalizeRateLimitSnapshot(message.result as AppServerRateLimitResponse));
          } catch (err: any) {
            finish(new Error(`Invalid Codex rate limit payload: ${err.message}`));
          }
        }
      };

      const stdoutReader = readline.createInterface({ input: child.stdout });
      stdoutReader.on('line', handleJsonLine);

      const stderrReader = readline.createInterface({ input: child.stderr });
      stderrReader.on('line', (line) => {
        if (!line) return;
        stderrLines.push(line);
        if (stderrLines.length > 20) stderrLines.shift();
      });

      child.on('error', (err) => {
        finish(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        const stderrText = stderrLines.join(' | ');
        if (!initialized) {
          finish(new Error(`Codex app-server exited before initialization${stderrText ? `: ${stderrText}` : ''}`));
          return;
        }
        finish(new Error(`Codex app-server exited before returning rate limits (code ${code ?? 'unknown'})${stderrText ? `: ${stderrText}` : ''}`));
      });

      this.logger.debug({ executable: this.executable }, 'Reading Codex account rate limits');
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'codexbot',
            title: 'codexbot',
            version: '1.0.0',
          },
          capabilities: {
            experimentalApi: true,
          },
        },
      });
    });
  }
}
