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

NAS Synology / LiveStageAssistant calls:

```text
http://100.96.255.63:8787/mcp
```

Raspberry Pi / XMSeries-MCP calls the mixer directly:

```text
192.168.100.16:10023
```

## Prerequisite

Make sure the repository exists here:

```text
/home/pi/XMSeries-MCP
```

and has already been built:

```bash
cd /home/pi/XMSeries-MCP
npm install
npm run build
```
