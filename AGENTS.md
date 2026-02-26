# AGENTS

This repository is Codex-first and Feishu-only.

## Runtime Model
- IM platform: Feishu/Lark only
- Agent backend: Codex CLI only (`codex exec`)
- No Telegram runtime paths
- No Claude Code runtime dependency

## Local Commands
```bash
npm run dev
npm run build
npm test
```

## Main Flow
`Feishu Event -> MessageBridge -> CodexExecutor -> StreamProcessor -> Feishu card updates`

## Key Config
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `CODEX_DEFAULT_WORKING_DIRECTORY`
- `CODEX_ALLOWED_TOOLS`
- `CODEX_MAX_TURNS`
- `CODEX_MAX_BUDGET_USD`
- `CODEX_MODEL`
- `CODEX_EXECUTABLE_PATH` (optional)

## Workspace Template
When API installs skills into a workdir, it deploys:
- `.codex/skills/*`
- `AGENTS.md`
