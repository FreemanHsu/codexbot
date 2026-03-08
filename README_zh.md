# codexbot（飞书 + Codex）

这个版本是 **飞书机器人远程驱动 Codex** 的桥接服务。

## 当前版本支持
- 仅飞书/Lark
- 仅 Codex 执行后端（`codex exec`）
- Agent 总线 API（任务委派、定时任务）
- 内置 MetaMemory 服务

## 快速启动

```bash
git clone https://github.com/FreemanHsu/codexbot.git
cd codexbot
npm install
cp bots.example.json bots.json
cp .env.example .env
npm run dev
```

## 安装与验证 Codex CLI

若本机没有 `codex` 命令，先安装：

```bash
npm install -g @openai/codex
```

验证本地可执行：

```bash
codex --version
which codex
```

验证端到端调用：

```bash
codex exec "say hello" --json --skip-git-repo-check
```

如果运行环境里 `which codex` 不稳定，建议在 `.env` 固定路径：

```bash
CODEX_EXECUTABLE_PATH=/Applications/Codex.app/Contents/Resources/codex
```

## 必填配置

`.env` 至少配置：

```bash
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
CODEX_DEFAULT_WORKING_DIRECTORY=/path/to/project
```

可选：

```bash
CODEX_ALLOWED_TOOLS=Read,Edit,Write,Glob,Grep,Bash,WebSearch,WebFetch
CODEX_MAX_TURNS=50
CODEX_MAX_BUDGET_USD=1.0
CODEX_MODEL=
CODEX_EXECUTABLE_PATH=/Applications/Codex.app/Contents/Resources/codex
```

## bots.json 示例

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

## API 列表

- `GET /api/health`
- `GET /api/bots`
- `POST /api/bots`（仅支持 `platform=feishu`）
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

## 聊天命令

- `/new [title]` 新建并切换到一个 thread
- `/list [all]` 列出当前会话内的 thread（`all` 包含已归档）
- `/thread <id>` 切换当前 thread
- `/thread` 查看当前 thread
- `/model` 查看当前 thread 模型
- `/model code|chat` 切换当前 thread 模型（`code`=gpt-5.4，`chat`=gpt-5.2）
- `/history [threadId] [n]` 查看最近历史（默认当前 thread，20 条）
- `/rename <threadId> <title>` 重命名 thread
- `/archive <threadId>` 归档 thread（不传 id 则归档当前 thread）
- `/reset` 重置当前 thread 的 Codex 会话
- `/stop` 停止当前会话中的运行任务
- `/status` 查看当前会话与 thread 状态
- `/cost` 查看当前 Codex 剩余额度（`5 小时` 和 `1 周`）

## 说明
- 运行机需要预装并登录 Codex CLI。
- thread 与历史元数据会持久化到 `~/.codexbot/threads-<botName>.json`。
- 本仓库已移除 Telegram 运行链路。
- 本仓库已移除 Claude Code 运行依赖。
