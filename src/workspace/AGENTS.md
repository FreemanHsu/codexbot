# MetaBot Workspace

This workspace is managed by **MetaBot** — an AI assistant accessible from Feishu that runs Codex with coding tool access.

## Available Skills

### /metamemory — Shared Knowledge Store
Read and write persistent memory documents across sessions. Use the `mm` shell shortcut:

```bash
mm search <query>
mm get <doc_id>
mm list [folder_id]
mm folders
```

### /metabot-api — Agent Bus, Scheduling & Bot Management
Use the `mb` shell shortcut:

```bash
mb bots
mb task <botName> <chatId> <prompt>
mb schedule list
mb schedule add <bot> <chatId> <sec> <prompt>
mb health
```

## Guidelines

- Search before creating files/documents.
- Save durable project knowledge to MetaMemory.
- Put generated artifacts into the outputs directory provided in the system prompt.
- Keep chat responses concise for card display.
