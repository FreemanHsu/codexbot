import * as path from 'node:path';
import * as lark from '@larksuiteoapi/node-sdk';
import { loadAppConfig, type BotConfig, type BotConfigBase } from './config.js';
import { createLogger, type Logger } from './utils/logger.js';
import { createEventDispatcher } from './feishu/event-handler.js';
import { MessageSender } from './feishu/message-sender.js';
import { FeishuSenderAdapter } from './feishu/feishu-sender-adapter.js';
import { MessageBridge } from './bridge/message-bridge.js';
import type { IMessageSender } from './bridge/message-sender.interface.js';
import { BotRegistry } from './api/bot-registry.js';
import { TaskScheduler } from './scheduler/task-scheduler.js';
import { startApiServer } from './api/http-server.js';
import { startMemoryServer } from './memory/memory-server.js';

interface FeishuBotHandle {
  name: string;
  bridge: MessageBridge;
  wsClient: lark.WSClient;
  config: BotConfigBase;
  sender: IMessageSender;
}

async function startFeishuBot(botConfig: BotConfig, logger: Logger, memoryServerUrl: string, memorySecret?: string): Promise<FeishuBotHandle> {
  const botLogger = logger.child({ bot: botConfig.name });

  botLogger.info('Starting Feishu bot...');

  const client = new lark.Client({
    appId: botConfig.feishu.appId,
    appSecret: botConfig.feishu.appSecret,
    disableTokenCache: false,
  });

  let botOpenId: string | undefined;
  try {
    const botInfo: any = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' });
    botOpenId = botInfo?.bot?.open_id;
    if (botOpenId) {
      botLogger.info({ botOpenId }, 'Bot info fetched');
    } else {
      botLogger.warn('Could not get bot open_id, group @mention filtering may be less accurate');
    }
  } catch (err) {
    botLogger.warn({ err }, 'Failed to fetch bot info, group @mention filtering may be less accurate');
  }

  const rawSender = new MessageSender(client, botLogger);
  const sender = new FeishuSenderAdapter(rawSender);
  const bridge = new MessageBridge(botConfig, botLogger, sender, memoryServerUrl, memorySecret);

  const dispatcher = createEventDispatcher(botConfig, botLogger, (msg) => {
    bridge.handleMessage(msg).catch((err) => {
      botLogger.error({ err, msg }, 'Unhandled error in message bridge');
    });
  }, botOpenId);

  const wsClient = new lark.WSClient({
    appId: botConfig.feishu.appId,
    appSecret: botConfig.feishu.appSecret,
    loggerLevel: lark.LoggerLevel.info,
  });

  await wsClient.start({ eventDispatcher: dispatcher });

  botLogger.info('Feishu bot is running');
  botLogger.info({
    backend: 'codex',
    defaultWorkingDirectory: botConfig.codex.defaultWorkingDirectory,
    allowedTools: botConfig.codex.allowedTools,
    maxTurns: botConfig.codex.maxTurns ?? 'unlimited',
    maxBudgetUsd: botConfig.codex.maxBudgetUsd ?? 'unlimited',
  }, 'Configuration');

  return { name: botConfig.name, bridge, wsClient, config: botConfig, sender };
}

async function main() {
  const appConfig = loadAppConfig();
  const logger = createLogger(appConfig.log.level);

  if (appConfig.memory.secret && !process.env.MEMORY_SECRET) {
    process.env.MEMORY_SECRET = appConfig.memory.secret;
  }

  const feishuCount = appConfig.feishuBots.length;
  logger.info({ feishuBots: feishuCount, memoryServerUrl: appConfig.memoryServerUrl }, 'Starting MetaBot bridge...');

  const registry = new BotRegistry();

  const feishuHandles: FeishuBotHandle[] = feishuCount > 0
    ? await Promise.all(appConfig.feishuBots.map((bot) => startFeishuBot(bot, logger, appConfig.memoryServerUrl, appConfig.memory.secret || undefined)))
    : [];

  for (const handle of feishuHandles) {
    registry.register({
      name: handle.name,
      platform: 'feishu',
      config: handle.config,
      bridge: handle.bridge,
      sender: handle.sender,
    });
  }

  logger.info({ bots: feishuHandles.map((h) => h.name) }, 'All bots started');

  const scheduler = new TaskScheduler(registry, logger);

  let memoryServer: ReturnType<typeof startMemoryServer> | undefined;
  if (appConfig.memory.enabled) {
    memoryServer = startMemoryServer({
      port: appConfig.memory.port,
      databaseDir: appConfig.memory.databaseDir,
      secret: appConfig.memory.secret || undefined,
      adminToken: appConfig.memory.adminToken,
      readerToken: appConfig.memory.readerToken,
      logger,
    });
  }

  const botsConfigPath = process.env.BOTS_CONFIG
    ? path.resolve(process.env.BOTS_CONFIG)
    : undefined;

  const apiServer = startApiServer({
    port: appConfig.api.port,
    secret: appConfig.api.secret,
    registry,
    scheduler,
    logger,
    botsConfigPath,
  });

  const shutdown = () => {
    logger.info('Shutting down...');
    scheduler.destroy();
    apiServer.close();
    if (memoryServer) {
      memoryServer.server.close();
      memoryServer.storage.close();
    }
    for (const handle of feishuHandles) {
      handle.bridge.destroy();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
