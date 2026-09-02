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
xmseriesmcp test-remote
xmseriesmcp last-state
xmseriesmcp noauto
```

## Expected architecture

NAS Synology / LiveStageAssistant or another MCP client calls:

```text
http://100.96.255.63:8787/mcp
```

A public HTTPS tunnel such as Tailscale Funnel can proxy the same endpoint without changing the MCP transport URL path.

Raspberry Pi / XMSeries-MCP calls the mixer directly:

```text
192.168.100.16:10023
```

The HTTP MCP endpoint uses **stateless Streamable HTTP**. It does not allocate or retain `Mcp-Session-Id` values. A fresh MCP transport is created for each protocol request while the mixer runtime remains process-global. This means a Raspberry Pi or XMSeries-MCP restart does not leave remote clients dependent on an HTTP session that existed before the restart; once the service and tunnel are reachable again, clients can continue using the same `/mcp` URL.

Client configuration remains:

```json
{
  "type": "streamable-http",
  "url": "http://HOST:8787/mcp"
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
