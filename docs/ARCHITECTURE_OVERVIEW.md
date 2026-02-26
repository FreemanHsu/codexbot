# codexbot 架构总览

> 目标：用一页文档回答“系统由哪些模块构成、各自负责什么、数据落在哪里”。

## 1. 系统目标与边界

`codexbot` 当前聚焦单一主链路：**Feishu + Codex CLI**。

- 飞书机器人接收消息
- 消息桥接到本地 `codex exec`
- 执行过程与结果回传飞书
- 提供可选 HTTP API 与调度能力

当前不包含 Telegram 与 Claude Code 运行链路。

## 2. 分层架构

- 接入层：`src/feishu/`
- 编排层：`src/bridge/`
- 执行层：`src/codex/`
- 状态层：`src/agent/`、`src/memory/`
- 管理面：`src/api/`、`src/scheduler/`
- 基础设施：`src/utils/`、`src/config.ts`、`src/index.ts`

## 3. 模块职责

### 3.1 应用入口

- `src/index.ts`
- 负责组件装配和生命周期启动：配置读取、桥接初始化、Feishu 接入、API 与调度启停。

### 3.2 配置中心

- `src/config.ts`
- 从环境变量和配置文件组装结构化配置对象（bots/codex/api/scheduler/runtime）。

### 3.3 飞书接入

- `src/feishu/event-handler.ts`
- `src/feishu/message-sender.ts`
- 负责事件解析、鉴别、回包发送（文本/卡片/更新）。

### 3.4 消息桥接

- `src/bridge/message-bridge.ts`
- 系统核心编排点：命令分流、任务排队、超时取消、状态归集、异常兜底、埋点审计。

### 3.5 Codex 执行

- `src/codex/executor.ts`
- 封装 `codex exec` / `codex exec resume` 进程调用，解析 JSON 输出并抽取最终结果。

### 3.6 会话与流处理

- `src/agent/session-manager.ts`
- `src/agent/stream-processor.ts`
- 会话映射持久化（chat/thread -> session_id + workdir），执行过程输出分块、节流和状态更新。

### 3.7 API 管理面

- `src/api/http-server.ts`
- 暴露健康检查、任务委派、调度管理、配置管理、指标查询等端点。

### 3.8 调度子系统

- `src/scheduler/task-scheduler.ts`
- 支持一次性任务和 cron 循环任务，支持暂停/恢复/取消/重启恢复。

### 3.9 工作区与技能

- `src/api/skills-installer.ts`
- `src/workspace/AGENTS.md`
- 将 `~/.codex/skills` 安装到项目 `.codex/skills`，并部署工作区 `AGENTS.md` 规范。

## 4. 命令与任务模型

`MessageBridge` 处理两类输入：

- 控制命令：`/help`、`/reset`、`/stop`、`/status`、`/memory ...`
- 普通任务：转发给 Codex 执行，走队列和生命周期管理

默认策略是按会话维度串行，避免上下文并发污染。

## 5. 持久化与状态目录

默认本地状态目录：`~/.codexbot/`

- 会话信息（session 映射、元数据）
- 调度任务文件：`~/.codexbot/scheduled-tasks.json`
- 运行缓存

技能与工作区相关目录：

- `~/.codex/skills/`：本地技能源
- `<workspace>/.codex/skills/`：项目技能副本
- `<workspace>/AGENTS.md`：项目约束入口

## 6. 可靠性与运维

- 并发：会话维度串行
- 取消：`/stop` 触发 abort
- 超时：任务超时兜底
- 日志与指标：`src/utils/logger.ts`、`src/utils/metrics.ts`、`src/utils/audit.ts`
- 进程守护：可使用 `ecosystem.config.cjs` 由 PM2 托管

## 7. 当前优缺点

优点：

- 链路聚焦，模块边界清晰
- 会话恢复 + 调度恢复，适合常驻运行
- 管理面可扩展，便于对接外部系统

约束：

- 依赖本机 `codex` CLI 可用性
- 单实例吞吐受桥接队列策略约束
- 租户隔离和权限控制仍偏轻量
