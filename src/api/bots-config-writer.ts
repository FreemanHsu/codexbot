import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BotsJsonNewFormat, FeishuBotJsonEntry } from '../config.js';

export function readBotsConfig(configPath: string): BotsJsonNewFormat {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return { feishuBots: parsed as FeishuBotJsonEntry[] };
  }

  return parsed as BotsJsonNewFormat;
}

export function writeBotsConfig(configPath: string, config: BotsJsonNewFormat): void {
  const json = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = path.join(path.dirname(configPath), '.bots.json.tmp');
  fs.writeFileSync(tmpPath, json, { mode: 0o600 });
  fs.renameSync(tmpPath, configPath);
}

export function addBot(configPath: string, platform: 'feishu', entry: FeishuBotJsonEntry): void {
  const config = readBotsConfig(configPath);

  const allNames = [...(config.feishuBots || []).map((b) => b.name)];
  if (allNames.includes(entry.name)) {
    throw new Error(`Bot with name "${entry.name}" already exists`);
  }

  if (!config.feishuBots) config.feishuBots = [];
  config.feishuBots.push(entry);

  writeBotsConfig(configPath, config);
}

export function removeBot(configPath: string, name: string): boolean {
  const config = readBotsConfig(configPath);

  const totalBots = config.feishuBots?.length || 0;

  if (config.feishuBots) {
    const idx = config.feishuBots.findIndex((b) => b.name === name);
    if (idx !== -1) {
      if (totalBots <= 1) throw new Error('Cannot remove the last bot');
      config.feishuBots.splice(idx, 1);
      writeBotsConfig(configPath, config);
      return true;
    }
  }

  return false;
}

export function getBotEntry(configPath: string, name: string): { platform: 'feishu'; entry: FeishuBotJsonEntry } | null {
  const config = readBotsConfig(configPath);

  const feishu = config.feishuBots?.find((b) => b.name === name);
  if (feishu) return { platform: 'feishu', entry: feishu };

  return null;
}
