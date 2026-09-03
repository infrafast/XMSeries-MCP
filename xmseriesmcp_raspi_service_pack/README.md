# XMSeries-MCP Raspberry Pi service

This pack installs XMSeries-MCP as a systemd service on Raspberry Pi.

## Install

```bash
chmod +x install_xmseriesmcp_service.sh
./install_xmseriesmcp_service.sh
```

Then check the environment file:

```bash
sudo nano /etc/xmseriesmcp.env
```

Start automatically at boot:

```bash
xmseriesmcp auto
```

## Commands

```bash
xmseriesmcp start
xmseriesmcp stop
xmseriesmcp restart
xmseriesmcp status
xmseriesmcp logs
xmseriesmcp health
xmseriesmcp endpoint
xmseriesmcp test-remote
xmseriesmcp last-state
xmseriesmcp noauto
```

## Expected architecture

XMSeries-MCP listens on the Raspberry Pi on port `8787` and is published through the validated Tailscale Funnel path `/xm`:

```text
Local MCP   : http://127.0.0.1:8787/mcp
Public MCP  : https://raspberrypi-1.tail70348.ts.net/xm/mcp
Public health: https://raspberrypi-1.tail70348.ts.net/xm/health
```

The service pack declares the stable Funnel hostname as:

```text
HTTP_PUBLIC_HOST=raspberrypi-1.tail70348.ts.net
```

The Funnel rule is:

```bash
sudo tailscale funnel --https=443 --set-path=/xm --bg 8787
```

Raspberry Pi / XMSeries-MCP calls the mixer directly:

```text
192.168.100.16:10024
```

The HTTP MCP endpoint uses **stateless Streamable HTTP**. It does not allocate or retain `Mcp-Session-Id` values. A fresh MCP transport is created for each protocol request while the mixer runtime remains process-global. This means a Raspberry Pi or XMSeries-MCP restart does not leave remote clients dependent on an HTTP session that existed before the restart; once the service and Funnel are reachable again, clients can continue using the same public `/xm/mcp` URL.

Client configuration for the validated public rack endpoint is:

```json
{
  "type": "streamable-http",
  "url": "https://raspberrypi-1.tail70348.ts.net/xm/mcp"
}
```

## Prerequisites

Node.js must be >= 20.20.0. Node 22 LTS is recommended when installing both XMSeries-MCP and QLCPlus-MCP on the same Raspberry Pi.

Make sure the repository exists here:

```text
/home/pi/XMSeries-MCP
```

and has already been built:

```bash
cd /home/pi/XMSeries-MCP
npm ci
npm run build
```
