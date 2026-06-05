# OSC MCP Server - Installation Summary

## ✅ What's Been Created

A complete MCP (Model Context Protocol) server for controlling Behringer/Midas digital mixers through Claude Desktop using natural language commands. `OSCX32M32` is the default and most complete mode; `OSCXR` enables the currently mapped XAir/XR-compatible command subset.

## 📁 Project Structure

```
XMSeries-MCP/
├── src/
│   ├── index.ts           # Main MCP server
│   ├── osc-client.ts      # OSC client
│   └── osc.d.ts          # TypeScript definitions for OSC
├── dist/                  # Compiled JavaScript (generated)
├── package.json          # Project dependencies
├── tsconfig.json         # TypeScript configuration
├── README.md             # Full documentation
├── QUICKSTART.md         # Quick start guide
├── claude_desktop_config.json  # Example Claude config
├── test-connection.js    # Connection test script
└── .env.example         # Environment variables example

```

## 🎯 Features Implemented

### Mixer Control Tools (representative subset):

1. **osc_channel_fader** - Get/set channel fader levels
2. **osc_bus_fader** - Get/set bus fader levels
3. **osc_mute_channel** - Mute/unmute channels
4. **osc_channel_send_to_bus** - Get/set channel sends to buses
5. **osc_get_mixer_status** - Get mixer status and identity via `/xinfo` plus `/status`
6. **osc_main_fader** - Get/set main LR fader
7. **osc_configure_mixer** - Change active mixer host/port/protocol
8. **osc_set_mixer_counts** - Change runtime channel/bus/FX/DCA scan limits without reconnecting

## 🚀 Installation for Claude Desktop

### Step 1: Find Your Mixer IP Address

On your mixer:
1. Press **SETUP**
2. Go to **Network**
3. Note the IP address (e.g., `192.168.1.70`)

### Step 2: Configure Claude Desktop

**macOS**: Edit this file:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add this configuration (update the IP address and path):

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

`OSC_PROTOCOL` is optional. Accepted values are `OSCX32M32` and `OSCXR`; when omitted, the server uses `OSCX32M32`. `MCP_PROMPT_FILE` is optional and defaults to the repository `PROMPT.md`; set it to an absolute path if your agent should load a customized prompt.

`OSCX32M32` is the full/default mode. `OSCXR` enables the XAir/XR paths currently mapped in `PROTOCOL.md`; unsupported or not-yet-mapped tools fail fast with `Unsupported for OSCXR: ...` instead of timing out.

### Step 3: Restart Claude Desktop

Completely quit and restart Claude Desktop.

### Step 4: Test the Connection (Optional)

Before configuring Claude, you can test the connection:

```bash
cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
npm test
```

This will verify that your computer can communicate with the mixer. The same test script is protocol-aware: it uses `OSCX32M32` by default, or `OSCXR` when `OSC_PROTOCOL=OSCXR` is provided.

## 💬 Example Usage in Claude Desktop

Once configured, you can use natural language commands like:

**Fader Control:**
- "Set channel 1 fader to 75%"
- "What's the current level of channel 5?"
- "Lower the main fader to 80%"

**Muting:**
- "Mute channel 3"
- "Unmute all channels from 1 to 8"

**Aux Sends:**
- "Send channel 1 to bus 3 at 50%"

**Timed Automation:**
- "Fade out channel 1 in 10 seconds"
- "Fade Kick on Laurent down over 3 seconds"
- "In 5 seconds, mute the main LR"
- "Run a macro: lower the music, wait 2 seconds, then mute FX return 1"

**Custom Commands:**
- "Send OSC command /ch/01/config/name with value 'Lead Vocal'"

## 🔧 Technical Details

### Dependencies:
- **@modelcontextprotocol/sdk** - MCP server framework
- **osc-js** - OSC protocol implementation
- **TypeScript** - Type-safe development

### OSC Communication:
- Protocol: UDP
- Default Port: 10023
- Address protocol selector: `OSC_PROTOCOL` (`OSCX32M32` by default, or `OSCXR`)
- Agent prompt file selector: `MCP_PROMPT_FILE` (optional; defaults to `PROMPT.md`)
- Bidirectional communication with mixer
- Automatic connection keep-alive and health check (`/xremote` every 9 seconds, followed by a `/xinfo` probe)
- Mixer status uses `/xinfo` for network address, mixer network name, console model, and console version, plus `/status` for active state
- If the health check marks the mixer offline, write tools return `Le mixeur est deconnecté` until a later health check or status read succeeds

### MCP Transports:
- `npm start` runs the full MCP server over stdio through `dist/index.js`
- `npm run start:http` runs the same full MCP server over Streamable HTTP through `dist/http.js`
- HTTP mode uses `HTTP_HOST` (`0.0.0.0` by default), `HTTP_PORT` (`8787` by default), and optional `MCP_AUTH_TOKEN`
- Remote agents connect to `http://SERVER_IP:8787/mcp`; opening the same URL in a browser shows the runtime mixer status/config page when no MCP session header is present. See `mcp_http_agent_config.example.json`
- Use `MCP_AUTH_TOKEN` and a trusted LAN/VPN/reverse proxy when exposing HTTP mode, because the server can control live mixer state

### Agent Prompt Exposure:
- Standard prompt name: `agent_prompt` via MCP `prompts/list` and `prompts/get`
- Standard resource URI: `agent://prompt/system` via MCP `resources/list` and `resources/read`
- Standard fallback tool: `get_agent_prompt` for clients that expose only tools
- The MCP host/agent is responsible for reading this content and injecting it into the LLM context; the server only exposes it.

### OSCXR Coverage:
- Supported: channel fader/mute/name, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return, DCA, and headamp gain
- Explicitly unsupported until mapped or not losslessly representable: routing/user routing, matrices, console overview, colors/icons, gate/compressor, pan, EQ frequency/Q/type, and XR bus-specific source mutes that would otherwise become global source mutes

### Supported Mixer Models:
- Behringer X32
- Behringer X32 Compact
- Behringer X32 Producer
- Behringer X32 Rack
- Midas M32 (compatible)
- XAir/XR-compatible mixers through partial `OSCXR` support, limited to the mapped commands listed above

## 📚 Documentation Files

- **README.md** - Complete documentation with all features
- **QUICKSTART.md** - Step-by-step installation guide
- **claude_desktop_config.json** - Example configuration
- **.env.example** - Environment variables template

## 🐛 Troubleshooting

### Connection Issues:

1. **Test network connectivity:**
   ```bash
   ping 192.168.1.70  # Replace with your mixer IP
   ```

2. **Run the test script:**
   ```bash
   npm test
   ```

3. **Check Claude Desktop logs:**
   - macOS: `~/Library/Logs/Claude/`

### Common Problems:

- **"Cannot find module"** - Run `npm install` and `npm run build`
- **"Connection timeout"** - Check IP address and network
- **"Tools not appearing"** - Restart Claude Desktop completely
- **"Permission denied"** - Check firewall settings for UDP port 10023

## 🎓 Next Steps

1. **Configure your mixer IP** in the Claude Desktop config
2. **Restart Claude Desktop**
3. **Test with a simple command** like "Check the mixer status"
4. **Explore the features** - try different commands!
5. **Read the full docs** in README.md for advanced usage

## 🌟 Advanced Usage

### Custom OSC Commands

You can send any OSC command supported by the mixer:

```
Send OSC command /ch/01/config/name with value "Lead Vocal"
Set channel 5 fader to 0.8
```

### Batch Operations

Claude can execute multiple commands in sequence:

```
Set up a basic mix: 
- Set channel 1 fader to 75%
- Set channel 2 fader to 70%
- Unmute channels 1 and 2
```

## 📖 Resources

- [X32 OSC Protocol Documentation](https://wiki.munichmakerlab.de/images/1/17/UNOFFICIAL_X32_OSC_REMOTE_PROTOCOL_%281%29.pdf)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Behringer X32 Manual](https://www.behringer.com/product.html?modelCode=P0ASF)

## ✨ Built With

- TypeScript
- Model Context Protocol SDK
- OSC.js
- Node.js

**Ready to start mixing with AI? Follow the installation steps above and enjoy controlling your mixer through natural conversation!** 🎚️🎵
