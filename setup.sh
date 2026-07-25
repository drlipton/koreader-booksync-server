#!/usr/bin/env bash

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}      KOReader BookSync & WebDAV Server Installer   ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[X] Node.js is not installed. Please install Node.js (v18+) and try again.${NC}"
    exit 1
fi

NODE_VER=$(node -v)
echo -e "${GREEN}[✓] Detected Node.js version: ${NODE_VER}${NC}"

# 2. Project Directory Setup
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${CYAN}[*] Installing NPM dependencies...${NC}"
npm install --production

# 3. Create required directories
mkdir -p data/books/Fiction data/books/Non-Fiction data/books/Technical

# 4. Systemd Service Setup
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

NODE_PATH=$(which node)
SERVICE_FILE="$SYSTEMD_DIR/koreader-sync.service"

echo -e "${CYAN}[*] Configuring systemd user service...${NC}"
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=KOReader BookSync & WebDAV Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
ExecStart=$NODE_PATH src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8085

[Install]
WantedBy=default.target
EOF

# Reload and start service
systemctl --user daemon-reload
systemctl --user enable koreader-sync
systemctl --user restart koreader-sync

echo -e "${GREEN}[✓] KOReader BookSync Server installed and started successfully!${NC}"

# 5. Network Summary
LOCAL_IP=$(hostname -I | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="127.0.0.1"
fi

echo -e "\n${YELLOW}====================================================${NC}"
echo -e "${GREEN} 🚀 Mobile Web Manager:${NC}  http://${LOCAL_IP}:8085"
echo -e "${GREEN} 📚 OPDS Catalog URL:${NC}   http://${LOCAL_IP}:8085/opds/"
echo -e "${GREEN} 📖 KOReader WebDAV URL:${NC} http://${LOCAL_IP}:8085/dav/"
echo -e "${GREEN} 🔄 KOReader Sync Server:${NC}http://${LOCAL_IP}:8085/"
echo -e "${YELLOW}====================================================${NC}"
echo -e "${CYAN}Service commands:${NC}"
echo "  systemctl --user status koreader-sync   # Check status"
echo "  systemctl --user restart koreader-sync  # Restart server"
echo "  journalctl --user -u koreader-sync -f   # View live logs"
echo ""
