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

### Mixer Control Tools (12 total):

1. **osc_set_fader** - Set channel fader levels
2. **osc_get_fader** - Get current fader levels
3. **osc_mute_channel** - Mute/unmute channels
4. **osc_set_pan** - Control stereo panning
5. **osc_set_eq** - Adjust 4-band parametric EQ
6. **osc_set_gate** - Control noise gates
7. **osc_set_compressor** - Adjust compression
8. **osc_send_to_bus** - Control aux sends
9. **osc_scene_recall** - Load saved scenes
10. **osc_get_mixer_status** - Get mixer info
11. **osc_set_main_fader** - Control main LR fader
12. **osc_custom_command** - Send any OSC command

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
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

`OSC_PROTOCOL` is optional. Accepted values are `OSCX32M32` and `OSCXR`; when omitted, the server uses `OSCX32M32`.

`OSCX32M32` is the full/default mode. `OSCXR` enables the XAir/XR paths currently mapped in `PROTOCOL.md`; unsupported or not-yet-mapped tools fail fast with `Unsupported for OSCXR: ...` instead of timing out.

### Step 3: Restart Claude Desktop

Completely quit and restart Claude Desktop.

### Step 4: Test the Connection (Optional)

Before configuring Claude, you can test the connection:

```bash
cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
npm test
```

This will verify that your computer can communicate with the mixer.

## 💬 Example Usage in Claude Desktop

Once configured, you can use natural language commands like:

**Fader Control:**
- "Set channel 1 fader to 75%"
- "What's the current level of channel 5?"
- "Lower the main fader to 80%"

**Muting:**
- "Mute channel 3"
- "Unmute all channels from 1 to 8"

**Pan Control:**
- "Pan channel 2 to the left"
- "Center channel 4"

**EQ:**
- "Boost channel 1 EQ band 2 by 3dB"
- "Cut the high frequencies on channel 5 by 6dB"

**Dynamics:**
- "Set channel 1 gate threshold to -40dB"
- "Add compression to channel 3 with -20dB threshold and 4:1 ratio"

**Aux Sends:**
- "Send channel 1 to bus 3 at 50%"

**Scenes:**
- "Recall scene 5"

**Custom Commands:**
- "Send OSC command /ch/01/config/name with value 'Lead Vocal'"

## 🔧 Technical Details

### Dependencies:
- **@modelcontextprotocol/sdk** - MCP server framework
- **osc** - OSC protocol implementation
- **TypeScript** - Type-safe development

### OSC Communication:
- Protocol: UDP
- Default Port: 10023
- Address protocol selector: `OSC_PROTOCOL` (`OSCX32M32` by default, or `OSCXR`)
- Bidirectional communication with mixer
- Automatic connection keep-alive (/xremote every 9 seconds)

### OSCXR Coverage:
- Supported: channel fader/mute/name, EQ gain/on, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return, DCA, headamp gain, scenes
- Explicitly unsupported until mapped: routing/user routing, matrices, console overview, full FX chain, colors/icons, gate/compressor, pan, EQ frequency/Q/type

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
Send custom command to /ch/05/mix/fader with value 0.8
```

### Batch Operations

Claude can execute multiple commands in sequence:

```
Set up a basic mix: 
- Set channel 1 fader to 75%
- Pan channel 1 center
- Set channel 2 fader to 70%
- Pan channel 2 left
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

## 🖥️ Using the X32 Emulator

If you don't have a physical mixer, you can use the Patrick Maillot's X32 Emulator to test the agent.

1. **Download the Emulator:**
   The file is located at: `/Users/anteriovieira/Downloads/X32_macOS/X32`

2. **Make it Executable:**
   ```bash
   chmod +x /Users/anteriovieira/Downloads/X32_macOS/X32
   ```

3. **Run the Emulator:**
   ```bash
   /Users/anteriovieira/Downloads/X32_macOS/X32
   ```
   
   The emulator will start and listen on **UDP port 10023**.

4. **Configure Claude Desktop:**
   Update your `claude_desktop_config.json` to use the local IP (usually `127.0.0.1` or your LAN IP) and port `10023`.

   ```json
   "env": {
     "OSC_HOST": "127.0.0.1",
     "OSC_PORT": "10023",
     "OSC_PROTOCOL": "OSCX32M32"
   }
   ```

---

**Ready to start mixing with AI? Follow the installation steps above and enjoy controlling your mixer through natural conversation!** 🎚️🎵
