# Testing Guide

This guide explains how to test the OSC MCP server against a real mixer or another compatible OSC endpoint.

## Overview

To test against a mixer, you will need to:

1.  **Prepare the mixer**: power it on, connect it to the network, and enable OSC control.
2.  **Note the OSC connection details**:
    *   Use the mixer IP address.
    *   Use the mixer OSC UDP port, usually `10023` for X32/M32.
3.  **Configure the MCP server**:
    *   Update your `claude_desktop_config.json` to point to the mixer IP and OSC port.

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
        "OSC_HOST": "192.168.1.70", // Mixer IP address
        "OSC_PORT": "10023",     // Mixer OSC port
        "OSC_PROTOCOL": "OSCX32M32",
        "MCP_PROMPT_FILE": "/Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP/PROMPT.md"
      }
    }
  }
}
```

Use `OSC_PROTOCOL: "OSCXR"` when testing against an XR/XAir-compatible target. `MCP_PROMPT_FILE` is optional and can point at a custom prompt to expose through MCP. Rebuild with `npm run build` after changing TypeScript sources, because MCP stdio normally runs `dist/index.js`.

Set `DEBUG=true` to log every OSC command sent by the server on stderr, including the final address and arguments after tool-level conversions and protocol mapping.

In XR mode, start with supported smoke tests such as main fader/mute, channel fader/mute/name, channel EQ gain/on, send-to-bus level, bus fader/mute/name, FX return mute/name, aux return fader, DCA fader/mute/name, headamp gain, and scene name/recall/save. XR snapshots are addressed 1-based, so scene 1 reads `/-snap/01/name`. Tools not covered by `PROTOCOL.md`, plus bus-specific source mutes that would become global XR mutes, should return `Unsupported for OSCXR: ...`.

## Running Tests

You can run the connection test script to verify connectivity to the mixer:

```bash
npm test
```

To test an XR/XAir-compatible console with the OSCXR path mapping:

```bash
OSC_HOST=192.168.0.16 OSC_PORT=10024 OSC_PROTOCOL=OSCXR npm test
```

This will attempt to connect to the configured mixer and perform protocol-aware smoke tests. With no `OSC_PROTOCOL`, it uses the default `OSCX32M32` mode; with `OSC_PROTOCOL=OSCXR`, it runs the XR-compatible checks. In `OSCXR`, it also checks that an unsupported X32-only aggregate returns `Unsupported for OSCXR: ...` instead of timing out.

## LLM Tool-Selection Benchmark

`test-llm-tools.js` verifies the LLM behavior before any real OSC write happens. It gives the model the repository `PROMPT.md`, a small MCP tool surface, and a fixed test naming context, then checks that each natural-language command produces the expected MCP tool call and arguments.

This test does not connect to the mixer and does not write OSC. Relative commands are handled by returning mocked read-tool results to the model.

Run with OpenAI:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=gpt-4o-mini npm run test:llm-tools
```

Run with a local Ollama model through its OpenAI-compatible endpoint:

```bash
LLM_PROVIDER=ollama LLM_MODEL=llama3.1 OLLAMA_BASE_URL=http://127.0.0.1:11434 npm run test:llm-tools
```

The editable test data is intentionally near the top of `test-llm-tools.js`:

- `NAME_CONTEXT` defines channel and bus aliases used by the phrases.
- `INITIAL_MOCK_STATE` defines the mocked dB/mute state returned by read tools.
- `TOOL_CASES` defines each phrase and the expected MCP tool-call sequence.

## Manual Testing

Once connected, you can use Claude Desktop to control the mixer. Try commands like:

*   "Set channel 1 fader to 75%"
*   "Mute channel 3"
*   "Pan channel 2 to the left"

Verify the changes are reflected on the mixer or its control application.
