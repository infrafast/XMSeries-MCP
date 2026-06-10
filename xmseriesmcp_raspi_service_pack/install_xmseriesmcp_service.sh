#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing XMSeries-MCP service files..."

sudo cp "$SCRIPT_DIR/xmseriesmcp.env" /etc/xmseriesmcp.env
sudo cp "$SCRIPT_DIR/xmseriesmcp.service" /etc/systemd/system/xmseriesmcp.service
sudo cp "$SCRIPT_DIR/xmseriesmcp" /usr/local/bin/xmseriesmcp

sudo chmod 644 /etc/xmseriesmcp.env
sudo chmod 644 /etc/systemd/system/xmseriesmcp.service
sudo chmod +x /usr/local/bin/xmseriesmcp

sudo systemctl daemon-reload

echo
echo "Installation complete."
echo "Next steps:"
echo "  1) Check /etc/xmseriesmcp.env"
echo "  2) Run: xmseriesmcp auto"
echo "  3) Test: xmseriesmcp health"
echo "  4) From NAS: curl http://100.96.255.63:8787/health"
