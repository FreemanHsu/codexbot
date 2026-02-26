#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

echo ""
echo "========================================="
echo "  MetaBot Setup (Feishu + Codex)"
echo "========================================="
echo ""

info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Please install Node.js 20+ first: https://nodejs.org"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  fail "Node.js 20+ is required (found: $(node -v))"
fi
ok "Node.js $(node -v)"

info "Checking Codex CLI..."
if ! command -v codex &>/dev/null; then
  warn "Codex CLI not found in PATH. Install Codex app/CLI first."
else
  ok "Codex CLI: $(which codex)"
fi

info "Installing npm dependencies..."
npm install
ok "Dependencies installed"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from template"
else
  ok ".env already exists"
fi

if [ ! -f bots.json ]; then
  read -p "Feishu App ID: " APP_ID
  read -p "Feishu App Secret: " APP_SECRET
  read -p "Working directory (absolute path): " WORK_DIR
  WORK_DIR="${WORK_DIR/#\~/$HOME}"
  mkdir -p "$WORK_DIR"

  cat > bots.json <<BOTEOF
{
  "feishuBots": [
    {
      "name": "default",
      "feishuAppId": "$APP_ID",
      "feishuAppSecret": "$APP_SECRET",
      "defaultWorkingDirectory": "$WORK_DIR"
    }
  ]
}
BOTEOF

  if grep -q "^BOTS_CONFIG=" .env; then
    sed -i '' "s|^BOTS_CONFIG=.*|BOTS_CONFIG=./bots.json|" .env
  else
    echo "BOTS_CONFIG=./bots.json" >> .env
  fi

  if grep -q "^CODEX_DEFAULT_WORKING_DIRECTORY=" .env; then
    sed -i '' "s|^CODEX_DEFAULT_WORKING_DIRECTORY=.*|CODEX_DEFAULT_WORKING_DIRECTORY=$WORK_DIR|" .env
  else
    echo "CODEX_DEFAULT_WORKING_DIRECTORY=$WORK_DIR" >> .env
  fi

  ok "Created bots.json"
else
  ok "bots.json already exists"
fi

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2
fi
ok "PM2: $(pm2 -v)"

pm2 delete metabot 2>/dev/null || true
pm2 start ecosystem.config.cjs

echo ""
ok "Setup complete"
echo ""
echo "Next steps:"
echo "  1. Make sure Codex CLI is authenticated"
echo "  2. Open Feishu and send a message to your bot"
