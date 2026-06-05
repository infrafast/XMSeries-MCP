# OSC MCP Server - Agent Configuration Guide

This guide explains how to configure and use the OSC MCP server with different AI agents and platforms.

## Table of Contents

- [Claude Desktop](#claude-desktop)
- [Cline (VS Code Extension)](#cline-vs-code-extension)
- [Continue.dev](#continuedev)
- [Other MCP-Compatible Agents](#other-mcp-compatible-agents)
- [Testing Your Configuration](#testing-your-configuration)
- [Troubleshooting](#troubleshooting)

## Claude Desktop

Claude Desktop is the official desktop application from Anthropic that supports MCP servers.

### Configuration

1. **Locate the configuration file:**
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. **Edit the configuration file** and add the OSC MCP server:

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": [
        "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"
      ],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32",
        "MCP_PROMPT_FILE": "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/PROMPT.md"
      }
    }
  }
}
```

3. **Replace the path** with your actual project path:
   - Update `/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js` to your actual path
   - Update `OSC_HOST` with your mixer's IP address
   - Update `OSC_PORT` if your mixer uses a different OSC port (default is 10023)
   - Update `OSC_PROTOCOL` if needed (`OSCX32M32` for X32/M32, `OSCXR` for XAir/XR-compatible mixers; default is `OSCX32M32`)
   - Optionally set `MCP_PROMPT_FILE` to an absolute custom prompt path. If omitted, the server exposes `PROMPT.md`.

4. **Restart Claude Desktop** completely (quit and reopen)

### Usage

Once configured, you can use natural language commands in Claude Desktop:

- "Set channel 1 fader to 75%"
- "Mute channel 3"
- "What's the current level of channel 5?"
- "Fade out channel 1 in 10 seconds"
- "In 5 seconds, mute the main LR"
- "Mute all buses"
- "Set Laurent, Mike and the front panel to -3 dB"

### System Prompt (Optional)

For better results, inject the server-provided prompt into the agent context. The server exposes `PROMPT.md` as standard MCP prompt `agent_prompt`, standard MCP resource `agent://prompt/system`, and standard fallback tool `get_agent_prompt`. The agent/client is responsible for fetching it and applying it as instructions; MCP cannot force system-prompt injection from the server side.

## Cline (VS Code Extension)

Cline is a VS Code extension that brings AI assistance with MCP support.

### Installation

1. Install the Cline extension from the VS Code marketplace
2. Install the OSC MCP server dependencies:
   ```bash
   cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
   npm install
   npm run build
   ```

### Configuration

1. Open VS Code settings (Cmd/Ctrl + ,)
2. Search for "Cline MCP"
3. Add the OSC server configuration:

```json
{
  "cline.mcpServers": {
    "osc": {
      "command": "node",
      "args": [
        "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"
      ],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

### Usage

1. Open the Cline chat panel
2. Use natural language to control your mixer
3. Cline will automatically use the MCP tools when appropriate

## Continue.dev

Continue is an open-source autocomplete and chat tool for VS Code with MCP support.

### Installation

1. Install Continue from the VS Code marketplace
2. Build the OSC MCP server:
   ```bash
   cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
   npm install
   npm run build
   ```

### Configuration

1. Open Continue settings
2. Navigate to MCP servers configuration
3. Add the OSC server:

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": [
        "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"
      ],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

### Usage

1. Open Continue chat
2. Ask questions or give commands about your mixer
3. Continue will use the appropriate MCP tools

## Other MCP-Compatible Agents

### General MCP Configuration

Most MCP-compatible agents use a similar configuration format. The basic structure is:

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": [
        "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"
      ],
      "env": {
        "OSC_HOST": "YOUR_MIXER_IP",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

### Streamable HTTP MCP Configuration

XMSeries-MCP can also expose the full MCP server over HTTP for agents running on another machine.

Start the HTTP transport on the mixer-control computer:

```bash
cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
npm install
npm run build
HTTP_HOST=0.0.0.0 HTTP_PORT=8787 MCP_AUTH_TOKEN=change-me npm run start:http
```

`HTTP_HOST=0.0.0.0` allows other machines on the LAN to connect. Keep `MCP_AUTH_TOKEN` set for any shared network.

Example remote-agent JSON:

```json
{
  "mcpServers": {
    "xmseries-http": {
      "type": "streamable-http",
      "url": "http://192.168.1.50:8787/mcp",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

Replace `192.168.1.50` with the IP address of the computer running the MCP server. The same example is available in `mcp_http_agent_config.example.json`.

Opening `/mcp` in a browser shows a small admin page when no MCP session header is present. It displays full mixer status and lets you update the runtime host, port, protocol, and mixer limits. MCP agent traffic still uses the same `/mcp` endpoint unchanged.

### Key Points

- **Absolute paths**: Always use absolute paths, not relative paths
- **Node.js required**: Ensure Node.js is installed and accessible in your PATH
- **Built project**: Make sure you've run `npm run build` before using the server
- **Transport choice**: Use `node dist/index.js` for local stdio clients, or `npm run start:http` for Streamable HTTP clients connecting over the network
- **Environment variables**: Set `OSC_HOST` and `OSC_PORT` to match your mixer. Optionally set `OSC_PROTOCOL` to `OSCX32M32` or `OSCXR`; the default is `OSCX32M32`. Optionally set `MCP_PROMPT_FILE` to expose a custom prompt file to the agent.
- **Runtime mixer changes**: The server starts from environment variables, then `osc_configure_mixer` can change host, port, protocol, and optionally counts in the same request. Use `osc_set_mixer_counts` for count-only updates; omitted fields keep current values and count-only changes do not reconnect.
- **HTTP security**: HTTP mode binds to `HTTP_HOST` (`0.0.0.0` by default). Use `MCP_AUTH_TOKEN`, a trusted LAN, VPN, or authenticated reverse proxy; do not expose mixer control directly to the public internet.
- **OSCXR coverage**: `OSCXR` uses the XAir/XR paths currently mapped in `PROTOCOL.md`: channel fader/mute/name, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return, DCA, and headamp gain. Source-to-bus level operations are mapped where equivalent. Bus-specific source mutes that would become global XR mutes return `Unsupported for OSCXR: ...` instead of silently muting the whole source.
- **Timed automation**: Fade/ramp, delayed action, and temporal macro requests use `osc_automation_*` tools. The server handles timing in the background and returns an automation job id immediately.
- **Grouped multi-target actions**: Requests like "mute all buses", "mute Mike and Laurent buses", or "set Laurent, Mike and the front panel to -3 dB" are supported via batch-oriented tools (`osc_mute_all_buses`, `osc_mute_buses`, `osc_send_to_buses_db`/`osc_send_to_all_buses_db` with `includeMain` for main LR).
- **After code changes**: Run `npm run build` before restarting the MCP client, because stdio configurations usually launch `dist/index.js`.
- **Smoke tests**: `npm test` runs protocol-aware checks in default `OSCX32M32`; set `OSC_PROTOCOL=OSCXR` to run the XR-compatible smoke path.

## Testing Your Configuration

### 1. Verify the Server Builds

```bash
cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
npm run build
```

You should see no errors, and the `dist/` directory should contain `index.js`.

### 2. Test the Server Directly

You can test the server manually:

```bash
node dist/index.js
```

The server should start and wait for MCP requests. Press Ctrl+C to stop.

### 3. Test with MCP Inspector (Optional)

The MCP Inspector is a tool for testing MCP servers:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

This will open a web interface where you can test the tools.

### 4. Test in Your Agent

Once configured in your agent:

1. Start a conversation
2. Ask a simple question like "What tools are available?"
3. Try a command like "Set channel 1 fader to 50%"
4. Verify the command executes on your mixer

## Troubleshooting

### Server Not Starting

**Problem**: The agent can't start the MCP server.

**Solutions**:
- Verify Node.js is installed: `node --version`
- Check the path to `dist/index.js` is correct and absolute
- Ensure you've run `npm run build`
- Check file permissions on `dist/index.js`

### Connection Issues

**Problem**: The server starts but can't connect to the mixer.

**Solutions**:
- Verify `OSC_HOST` is correct (ping the IP address)
- Check `OSC_PORT` matches your mixer's OSC port (default: 10023)
- Ensure OSC is enabled on the mixer
- Check firewall settings allow UDP traffic on port 10023
- Verify network connectivity: `ping YOUR_MIXER_IP`

### Tools Not Appearing

**Problem**: The agent doesn't show OSC tools.

**Solutions**:
- Restart the agent completely after configuration changes
- Check the agent's logs for errors
- Verify the MCP server configuration syntax is correct (valid JSON)
- Try testing with MCP Inspector first

### Commands Not Working

**Problem**: Tools appear but commands don't execute.

**Solutions**:
- Check the mixer is powered on and connected to the network
- Verify OSC is enabled in mixer settings (Setup → Network → OSC)
- Check agent logs for error messages
- Try a simple command first (like getting fader level)

### Permission Errors

**Problem**: Permission denied errors when starting the server.

**Solutions**:
- Make `dist/index.js` executable: `chmod +x dist/index.js`
- Check Node.js has permission to access the file
- On macOS/Linux, ensure the user has read/execute permissions

### Port Already in Use

**Problem**: Error about port being already in use.

**Solutions**:
- Close other instances of the server
- Check if another MCP server is using the same port
- Restart your computer if the port is stuck

## Advanced Configuration

### Multiple Mixers

If you need to control multiple mixers, you can configure multiple MCP servers:

```json
{
  "mcpServers": {
    "osc-main": {
      "command": "node",
      "args": ["/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32"
      }
    },
    "osc-monitor": {
      "command": "node",
      "args": ["/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"],
      "env": {
        "OSC_HOST": "192.168.1.71",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCXR"
      }
    }
  }
}
```

### Custom Node.js Path

If Node.js is not in your PATH, specify the full path:

```json
{
  "mcpServers": {
    "osc": {
      "command": "/usr/local/bin/node",
      "args": ["/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

### Debug Mode

To enable debug logging, add `NODE_ENV=development`:

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": ["/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"],
      "env": {
        "OSC_HOST": "192.168.1.70",
        "OSC_PORT": "10023",
        "OSC_PROTOCOL": "OSCX32M32",
        "NODE_ENV": "development"
      }
    }
  }
}
```

## Best Practices

1. **Use absolute paths**: Always use full absolute paths in configuration
2. **Test first**: Test the server manually before configuring in an agent
3. **Check logs**: Review agent and server logs when troubleshooting
4. **Network stability**: Ensure stable network connection to the mixer
5. **Backup configs**: Keep backups of working configurations
6. **Version control**: Track configuration changes if working in a team

## Getting Help

If you encounter issues:

1. Check the [README.md](README.md) for general information
2. Review the [Troubleshooting](#troubleshooting) section above
3. Check agent-specific documentation
4. Verify your mixer's OSC settings
5. Test network connectivity to the mixer

## Contributing

If you've successfully configured the OSC MCP server with another agent not listed here, please consider contributing your configuration to this documentation!
