# Testing Guide

This guide explains how to test the OSC MCP server using an external emulator (e.g., X32-Edit).

## Overview

Since we are using an external application to emulate the X32 mixer, you will need to:

1.  **Install and Run the Emulator**: Download and install the X32-Edit application (or similar emulator) from the Behringer website.
2.  **Configure the Emulator**:
    *   Ensure the emulator is running and listening for OSC commands.
    *   Note the IP address and Port the emulator is using (usually UDP port 10023).
3.  **Configure the MCP Server**:
    *   Update your `claude_desktop_config.json` to point to the emulator's IP and Port.

## Configuration

Edit your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add or update the configuration:

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": [
        "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/dist/index.js"
      ],
      "env": {
        "OSC_HOST": "127.0.0.1", // Or the IP of your emulator
        "OSC_PORT": "10023",     // The port your emulator is listening on
        "OSC_PROTOCOL": "OSCX32M32"
      }
    }
  }
}
```

Use `OSC_PROTOCOL: "OSCXR"` when testing against an XR/XAir-compatible target. Rebuild with `npm run build` after changing TypeScript sources, because MCP stdio normally runs `dist/index.js`.

In XR mode, start with supported smoke tests such as main fader/mute, channel fader/mute/name, channel EQ gain/on, send-to-bus level, bus fader/mute/name, FX return mute/name, aux return fader, DCA fader/mute/name, headamp gain, and scene name/recall/save. XR snapshots are addressed 1-based, so scene 1 reads `/-snap/01/name`. Tools not covered by `PROTOCOL.md`, plus bus-specific source mutes that would become global XR mutes, should return `Unsupported for OSCXR: ...`.

## Running Tests

You can run the connection test script to verify connectivity to the emulator or mixer:

```bash
npm test
```

To test an XR/XAir-compatible console with the OSCXR path mapping:

```bash
OSC_HOST=192.168.0.16 OSC_PORT=10024 OSC_PROTOCOL=OSCXR npm test
```

This will attempt to connect to the configured mixer and perform protocol-aware smoke tests. With no `OSC_PROTOCOL`, it uses the default `OSCX32M32` mode; with `OSC_PROTOCOL=OSCXR`, it runs the XR-compatible checks. In `OSCXR`, it also checks that an unsupported X32-only aggregate returns `Unsupported for OSCXR: ...` instead of timing out.

## Manual Testing

Once connected, you can use Claude Desktop to control the emulator. Try commands like:

*   "Set channel 1 fader to 75%"
*   "Mute channel 3"
*   "Pan channel 2 to the left"

Verify the changes are reflected in the emulator's interface.
