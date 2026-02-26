import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import type { BotConfigBase } from '../config.js';
import type { Logger } from '../utils/logger.js';
import { AsyncQueue } from '../utils/async-queue.js';
import type { ExecutionHandle, ExecutorOptions, AgentMessage } from '../agent/types.js';

const MAX_ERROR_LINES = 30;

export class CodexExecutor {
  constructor(
    private config: BotConfigBase,
    private logger: Logger,
  ) {}

  startExecution(options: ExecutorOptions): ExecutionHandle {
    const { prompt, cwd, sessionId, abortController } = options;
    const queue = new AsyncQueue<AgentMessage>();
    const startTime = Date.now();

    const outputFile = path.join(os.tmpdir(), `codexbot-codex-last-${process.pid}-${Date.now()}.txt`);
    const executable = process.env.CODEX_EXECUTABLE_PATH || 'codex';
    const args = this.buildArgs(cwd, prompt, outputFile, sessionId);

    this.logger.info(
      { cwd, hasSession: !!sessionId, backend: 'codex', executable },
      'Starting Codex execution',
    );

    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let killed = false;
    let currentSessionId = sessionId;
    const recentErrors: string[] = [];

    const rememberError = (line: string): void => {
      if (!line) return;
      recentErrors.push(line);
      if (recentErrors.length > MAX_ERROR_LINES) recentErrors.shift();
    };

    const parseLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Codex may log warnings in plain text.
        if (/error/i.test(trimmed)) {
          rememberError(trimmed);
        }
        return;
      }

      if (parsed?.type === 'thread.started' && typeof parsed.thread_id === 'string') {
        currentSessionId = parsed.thread_id;
        queue.enqueue({ type: 'system', session_id: currentSessionId });
        return;
      }

      if (parsed?.type === 'error' && typeof parsed.message === 'string') {
        rememberError(parsed.message);
      }
    };

    const attachLineReader = (stream: NodeJS.ReadableStream): void => {
      const rl = readline.createInterface({ input: stream });
      rl.on('line', parseLine);
      rl.on('close', () => {
        // no-op
      });
    };

    attachLineReader(child.stdout);
    attachLineReader(child.stderr);

    const cleanupOutput = (): void => {
      try {
        fs.unlinkSync(outputFile);
      } catch {
        // ignore
      }
    };

    const finishWithResult = (code: number | null): void => {
      const durationMs = Date.now() - startTime;
      const ok = !killed && code === 0;
      let resultText = '';
      try {
        if (fs.existsSync(outputFile)) {
          resultText = fs.readFileSync(outputFile, 'utf-8').trim();
        }
      } catch (err: any) {
        rememberError(`Failed to read Codex output file: ${err.message}`);
      } finally {
        cleanupOutput();
      }

      const errors = recentErrors.length > 0 ? [...recentErrors] : undefined;
      queue.enqueue({
        type: 'result',
        subtype: ok ? 'success' : 'error',
        session_id: currentSessionId,
        result: resultText,
        duration_ms: durationMs,
        errors,
      });
      queue.finish();
    };

    const onAbort = (): void => {
      if (child.killed) return;
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000).unref();
    };

    abortController.signal.addEventListener('abort', onAbort);

    child.on('error', (err) => {
      rememberError(err.message);
    });

    child.on('close', (code) => {
      abortController.signal.removeEventListener('abort', onAbort);
      finishWithResult(code);
    });

    async function* queueStream(): AsyncGenerator<AgentMessage> {
      for await (const item of queue) {
        yield item;
      }
    }

    return {
      stream: queueStream(),
      sendAnswer: (_toolUseId: string, _sid: string, _answerText: string) => {
        // Non-interactive codex exec mode doesn't support bridge question/answer handoff.
        this.logger.warn('Codex backend does not support interactive tool answers in exec mode');
      },
      finish: () => {
        if (child.exitCode !== null || child.killed) return;
        killed = true;
        child.kill('SIGTERM');
      },
    };
  }

  private buildArgs(cwd: string, prompt: string, outputFile: string, sessionId?: string): string[] {
    const args: string[] = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--full-auto',
      '--cd',
      cwd,
      '--output-last-message',
      outputFile,
    ];

    if (this.config.codex.model) {
      args.push('--model', this.config.codex.model);
    }

    if (sessionId) {
      args.push('resume', sessionId, prompt);
    } else {
      args.push(prompt);
    }

    return args;
  }
}
