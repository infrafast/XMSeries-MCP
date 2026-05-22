# Quick Start Guide - XMSeries MCP Server for Claude Desktop

## Installation Steps

### 1. Find Your Mixer IP Address And Protocol

On your mixer:
1. Press the **SETUP** button
2. Navigate to **Network** settings
3. Note the IP address (e.g., `192.168.1.70`)

Use `OSCX32M32` for X32/M32 consoles, or `OSCXR` for the currently mapped XAir/XR-compatible command subset.

### 2. Configure Claude Desktop

**macOS**: Open or create the file at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**: Open or create the file at:
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux**: Open or create the file at:
```
~/.config/Claude/claude_desktop_config.json
```

### 3. Add the OSC Server Configuration

Copy the contents from `claude_desktop_config.json` in this repository, or add this to your config file:

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

**Important**: 
- Replace `/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js` with the actual path to your installation
- Replace `192.168.1.70` with your mixer's actual IP address
- The default OSC port is `10023` (usually doesn't need to be changed)
- `OSC_PROTOCOL` is optional. Use `OSCX32M32` for X32/M32, or `OSCXR` for XAir/XR-compatible mixers. If omitted, the server defaults to `OSCX32M32`.
- `MCP_PROMPT_FILE` is optional. It points to the prompt the server exposes to the agent; if omitted, the repository `PROMPT.md` is used.

The prompt is exposed as MCP prompt `xmseries_mixer_assistant`, resource `xmseries://prompt/system`, and fallback tool `osc_get_agent_prompt`. Your agent/client still has to fetch it and inject it into the LLM context.

`OSCXR` support is intentionally partial and follows `PROTOCOL.md`. Supported XR command families are: channel fader/mute/name, EQ gain/on, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return, DCA, headamp gain, and scenes. Source-to-bus levels are mapped when they are semantically equivalent; bus-specific source mutes that would become global XR mutes return `Unsupported for OSCXR: ...` rather than timing out or muting too much.

### 4. Restart Claude Desktop

Completely quit and restart Claude Desktop for the changes to take effect.

### 5. Verify Installation

In Claude Desktop, start a new conversation and try:

```
Can you check the mixer status?
```

If everything is working, you should see the mixer status information!

The status tool uses `/xinfo` and `/status`, so a successful response should include connection state plus identity fields such as network address, mixer network name, console model, and console version when the mixer provides them.

## Example Commands

Once configured, you can control your mixer using natural language:

### Fader Control
```
Set channel 1 fader to 75%
What's the current level of channel 5?
Set the main fader to 80%
Lower channel 3 to 50%
```

### Muting
```
Mute channel 3
Unmute channel 7
Mute channels 1, 2, and 3
```

### Pan Control
```
Pan channel 2 to the left
Center the pan on channel 4
Pan channel 8 hard right
```

### EQ
```
Boost channel 1 EQ band 2 by 3dB
Cut channel 5 EQ band 4 by 6dB
Reset EQ on channel 1 band 3
```

### Dynamics
```
Set channel 1 gate threshold to -40dB
Set channel 3 compressor with -20dB threshold and 4:1 ratio
Adjust the gate on channel 5 to -35dB
```

### Aux Sends
```
Send channel 1 to bus 3 at 50%
Set channel 2 send to bus 1 at 75%
```

### Scenes
```
Recall scene 5
Load scene 12
```

### Advanced - Custom OSC Commands
```
Send OSC command /ch/01/config/name with value "Lead Vocal"
Send custom command to /ch/05/mix/fader with value 0.8
```

## Troubleshooting

### "Connection timeout" or "No response from mixer"

1. **Check network connectivity**:
   ```bash
   ping 192.168.1.70
   ```
   (Replace with your mixer's IP)

2. **Verify the mixer is on** and connected to the same network

3. **Check firewall settings** - ensure UDP port 10023 is not blocked

### "Tools not appearing in Claude"

1. **Verify the config file path** is correct for your OS
2. **Check JSON syntax** - use a JSON validator if needed
3. **Restart Claude Desktop** completely (quit and reopen)
4. **Check Claude Desktop logs**:
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs\`

### "Cannot find module" errors

1. Make sure you've run `npm install` and `npm run build`
2. Verify the path in the config file points to the correct location
3. Check that Node.js is installed: `node --version`

## Network Setup Tips

### Same Network
Your computer and mixer must be on the same network. You can:
- Connect both to the same WiFi network
- Connect via Ethernet to the same switch/router
- Use a direct Ethernet connection (may require static IP configuration)

### Static IP (Recommended)
For reliability, set a static IP on your mixer:
1. Press **SETUP** on the mixer
2. Go to **Network**
3. Set a static IP address (e.g., `192.168.1.70`)
4. Set subnet mask (usually `255.255.255.0`)
5. Set gateway to your router's IP

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check the [Behringer X32 OSC Protocol](https://wiki.munichmakerlab.de/images/1/17/UNOFFICIAL_X32_OSC_REMOTE_PROTOCOL_%281%29.pdf) for advanced commands
- Experiment with different commands in Claude Desktop!

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your network configuration
3. Review the Claude Desktop logs
4. Open an issue on GitHub with details about your setup

Happy mixing! 🎚️🎵
