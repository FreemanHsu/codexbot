# codexbot (Feishu + Codex)

CodexBot is a bridge service that lets you use **Codex remotely from Feishu**.

## What This Fork Supports
- Feishu/Lark bot only
- Codex backend only (`codex exec`)
- HTTP API for task delegation and scheduling
- Embedded MetaMemory server

## Quick Start

```bash
git clone https://github.com/FreemanHsu/codexbot.git
cd codexbot
npm install
cp bots.example.json bots.json
cp .env.example .env
npm run dev
```

## Install and Verify Codex CLI

Install (if `codex` is missing):

```bash
npm install -g @openai/codex
```

Verify local binary:

```bash
codex --version
which codex
```

Verify end-to-end call:

```bash
codex exec "say hello" --json --skip-git-repo-check
```

If `which codex` is not stable in your runtime environment, set this in `.env`:

```bash
CODEX_EXECUTABLE_PATH=/Applications/Codex.app/Contents/Resources/codex
```

## Required Config

In `.env`:

```bash
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
CODEX_DEFAULT_WORKING_DIRECTORY=/path/to/project
```

Optional:

```bash
CODEX_ALLOWED_TOOLS=Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch
CODEX_MAX_TURNS=50
CODEX_MAX_BUDGET_USD=1.0
CODEX_MODEL=
CODEX_EXECUTABLE_PATH=/Applications/Codex.app/Contents/Resources/codex
```

## bots.json

```json
{
  "feishuBots": [
    {
      "name": "project-alpha",
      "feishuAppId": "cli_xxx",
      "feishuAppSecret": "secret",
      "defaultWorkingDirectory": "/home/user/project-alpha"
    }
  ]
}
```

## API

- `GET /api/health`
- `GET /api/bots`
- `POST /api/bots` (Feishu only)
- `GET /api/bots/:name`
- `DELETE /api/bots/:name`
- `POST /api/tasks`
- `POST /api/schedule`
- `GET /api/schedule`
- `PATCH /api/schedule/:id`
- `DELETE /api/schedule/:id`
- `POST /api/schedule/:id/pause`
- `POST /api/schedule/:id/resume`
- `GET /api/stats`
- `GET /api/metrics`

## Notes
- The service assumes Codex CLI is installed and authenticated on the host.
- There is no Telegram runtime in this codebase.
- There is no Claude Code runtime dependency in this codebase.
