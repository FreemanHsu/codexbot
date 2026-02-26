#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/FreemanHsu/codexbot.git"
TARGET_DIR="${HOME}/codexbot"

echo "CodexBot installer (Feishu + Codex)"

if [ ! -d "$TARGET_DIR/.git" ]; then
  git clone "$REPO_URL" "$TARGET_DIR"
else
  echo "Using existing repo at $TARGET_DIR"
fi

cd "$TARGET_DIR"

if [ -f setup.sh ]; then
  bash setup.sh
else
  echo "setup.sh not found"
  exit 1
fi
