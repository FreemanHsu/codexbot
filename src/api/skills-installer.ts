import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Logger } from '../utils/logger.js';

const SKILL_NAMES = ['metamemory', 'codexbot-api'];

export function installSkillsToWorkDir(workDir: string, logger: Logger): void {
  const userSkillsDir = path.join(os.homedir(), '.codex', 'skills');
  const destSkillsDir = path.join(workDir, '.codex', 'skills');

  for (const skill of SKILL_NAMES) {
    const src = path.join(userSkillsDir, skill);

    if (!fs.existsSync(src)) {
      logger.debug({ skill }, 'Skill source not found, skipping');
      continue;
    }

    const dest = path.join(destSkillsDir, skill);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    logger.info({ skill, src, dest }, 'Skill installed to working directory');
  }

  // Deploy workspace AGENTS.md if not already present
  const destAgentsMd = path.join(workDir, 'AGENTS.md');
  if (!fs.existsSync(destAgentsMd)) {
    const thisFile = url.fileURLToPath(import.meta.url);
    const thisDir = path.dirname(thisFile);
    // Try src/workspace/AGENTS.md (tsx) or dist/workspace/AGENTS.md (compiled)
    for (const candidate of [
      path.join(thisDir, '..', 'workspace', 'AGENTS.md'),
      path.join(thisDir, '..', '..', 'src', 'workspace', 'AGENTS.md'),
    ]) {
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, destAgentsMd);
        logger.info({ dest: destAgentsMd }, 'AGENTS.md deployed to working directory');
        break;
      }
    }
  }
}
