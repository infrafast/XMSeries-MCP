# XMSeries-MCP

A Model Context Protocol (MCP) server that gives Claude direct control of Behringer/Midas mixers via OSC. The default and most complete mode targets Behringer X32 / Midas M32 consoles; an optional `OSCXR` mode adds partial XAir/XR-compatible addressing for the command families mapped in `PROTOCOL.md`.

This is a rewrite/fork of [anteriovieira/osc-mcp-server](https://github.com/anteriovieira/osc-mcp-server) with substantially expanded coverage and several bug fixes verified against live hardware (firmware 2.07+).

## What's in here

~85 tools organized into groups. Highlights beyond upstream:

- **Full channel strips** — preamp, gate, compressor, EQ (all 4 bands with freq/Q/type/on), fader, pan, solo, name, color, icon, sends, mute
- **Full bus / matrix / aux / FX-return / DCA / main strips** — same depth as channels, including inter-section sends (channels→buses, buses→matrices, main→matrix)
- **FX chain visibility** — type + all 16 params per slot, source assignment, return-channel state
- **Firmware 4.0+ user routing** — per-channel 1:1 physical input mapping with decoded labels ("Card 1" / "AES50A 5" / "Local 27"), not raw ints
- **Routing overview in one call** — `osc_get_routing_overview` returns the full topology (block-level + per-slot + AES50 + Card) with human labels
- **Bulk section reads** — `osc_get_channel_strip`, `osc_get_bus_strip`, `osc_get_console_overview`, etc., so Claude can grab a coherent snapshot in one shot instead of 40 round-trips
- **Typed custom commands** — `osc_custom_command` accepts an `osctype` override (`int`/`float`/`string`/`bool`) because X32 silently drops type mismatches on strict addresses like `/config/color`

## Setup

**Prereqs:** Node 18+, Claude Desktop, and a supported mixer on your network with OSC enabled. X32/M32 uses `OSCX32M32` by default; XAir/XR-compatible mixers can use `OSCXR` for the currently mapped subset.

```bash
cd /Users/ts/Documents/PlatformIO/Projects/XMSeries-MCP
npm install
npm run build
```

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "osc": {
      "command": "node",
      "args": ["C:\\path\\to\\XMSeries-MCP\\dist\\index.js"],
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

Replace the IP with your mixer's (on the X32: `Setup` -> `Network`). Restart Claude Desktop.

`OSC_PROTOCOL` is optional. Use `OSCX32M32` for Behringer X32 / Midas M32 consoles, or `OSCXR` for XAir/XR-compatible addressing. If omitted, the server defaults to `OSCX32M32`. `MCP_PROMPT_FILE` is also optional; it lets you point the server at a custom prompt file. If omitted, the server exposes the repository `PROMPT.md`.

### Protocol support

`OSCX32M32` is the complete/default mode. `OSCXR` is now partially effective for the command families currently mapped in `PROTOCOL.md`: channel fader/mute/name, EQ gain/on, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return via `/rtn/aux`, DCA fader/mute/name, headamp gain, and scenes.

When `OSC_PROTOCOL` is `OSCXR`, commands that are still X32-only or not yet mapped return an explicit `Unsupported for OSCXR: ...` error instead of waiting for an OSC timeout. This includes routing/user routing, matrices, console overview, full FX chain, colors/icons, gate/compressor, pan, EQ frequency/Q/type, and other features not covered by `PROTOCOL.md` yet. Bus-specific source mute operations are also guarded: X32 can mute channel/FX/aux sends to one bus, while XR exposes only global source mute paths, so those lossy translations are rejected instead of silently muting the whole source.

> **Windows MSIX note:** if you installed Claude Desktop from the Microsoft Store, the config path is `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`, not the standard `%APPDATA%\Claude\` path.

## Things worth knowing before you use it

A few X32/M32 quirks that will bite you if you do not know them. These mostly apply to the default `OSCX32M32` mode. In `OSCXR` mode, unsupported X32-only tools fail fast with `Unsupported for OSCXR: ...`.

**1. Routing: block-level vs. per-channel (firmware 4.0+).** On modern X32 firmware, inputs have two layers:

- **Block-level** (`/config/routing/IN/1-8` etc.) picks which 8-channel source group feeds each range of channels. Legacy style.
- **User In** (`/config/userrout/in/NN`, 32 slots) patches each individual channel to any physical source — Local, AES50A/B, Card, AuxIn. This only takes effect if the corresponding block is set to "User In".

Call `osc_get_routing_overview` first for any routing work. It shows both layers decoded to human labels.

**2. FX slots have no `/on` or `/mix` addresses.** FX are always instantiated on X32. "Turn off FX 3" really means "mute the FX 3 return channel." `osc_set_effect_on` does this automatically. Wet/dry varies by FX algorithm and lives in the per-slot params, not a global mix.

**3. FX slot numbers are unpadded.** `/fx/1/type` works; `/fx/01/type` silently fails. Every other numeric address in X32 uses zero-padded 2-digit numbers (`/ch/05/...`, `/bus/12/...`) — FX is the exception.

**4. OSC types are strict.** X32 silently drops messages where the type tag doesn't match. `/config/color`, `/config/icon`, `/config/chlink/*`, scene recall, mute-group, and solo switches all require int (`,i`). When using `osc_custom_command`, pass `osctype: "int"` if you're not sure the value will be sent as an int.

**5. Channel links are per-pair, not a bitmask.** `/config/chlink/1-2`, `/config/chlink/3-4`, etc. — each returns 0 or 1. Use `osc_get_channel_links` to see all 16 pairs at once.

## Agent prompt

At startup, the server exposes the recommended agent instructions from `PROMPT.md` in three MCP-compatible ways: prompt `xmseries_mixer_assistant`, resource `xmseries://prompt/system`, and fallback tool `osc_get_agent_prompt`. The MCP client or host agent must still decide to fetch and inject that content into the LLM context; the server cannot force system-prompt injection by itself.

For a custom prompt, set `MCP_PROMPT_FILE` in the MCP server `env` to an absolute path.

## Example prompts

Once wired up to Claude Desktop, natural language works:

```
"Show me the routing topology."
"Copy channel 1's EQ settings to channel 3."
"Set channel 27's input to Card 1."
"Review my FX setup — anything redundant?"
"Mute all channels except kick, snare, and overheads."
"Save the current state as scene 12 named 'Soundcheck'."
"What's plugged into the console right now?"
```

## Tool groups

Full list is visible to Claude; high-level groupings:

| Group | Coverage |
|---|---|
| **Channel strips** | preamp, gate, comp, EQ (4 bands, all params), fader, pan, solo, mute, name, color, icon, source, sends, inserts, DCA/mute-group assignment, automix |
| **Bus / Matrix / Aux / FX-Return / DCA / Main** | full strip params for each, plus inter-section sends |
| **Routing** | block-level in/out/AES50/Card, User In (32 slots), User Out (48 slots), decoded labels, one-call overview |
| **FX** | per-slot type, 16 params each, source, full-chain read |
| **Scenes / snippets** | recall, save, name |
| **Linking** | per-pair channel and bus links |
| **Bulk reads** | `channel_strip`, `bus_strip`, `aux_strip`, `matrix_strip`, `fx_return_strip`, `main_strip`, `dca`, `headamp`, `console_overview`, `routing_overview`, `full_fx_chain`, `user_routing` |
| **Raw escape hatch** | `osc_custom_command` with typed args and read-back |

## Status

Works. Tested against:
- X32 Producer, firmware 2.07 (primary dev target)
- Should work on any X32 variant (full, Compact, Rack, Core) and M32 family — the OSC surface is identical

Out of scope (not implemented):
- Talkback (`/config/talk/*`)
- Monitor / headphone (`/-stat/monitor/*`)
- Custom user-assignable controls (`/config/userctrl/*`)
- Meters (`/meters/*` — uses a different subscribe-based binary protocol)

## Dev

```bash
npm run build     # compile
npm run dev       # watch mode
npm start         # run directly (for debugging outside Claude Desktop)
```

`src/osc-client.ts` — all the mixer I/O, type decoders, and the OSC connection (binds UDP on `0.0.0.0` so the mixer's replies actually arrive — upstream bound localhost and silently got nothing).

`src/index.ts` — the MCP tool surface. Every tool has a `name`, `description`, `inputSchema`, and a handler case.

## Reference

- [Patrick-Gilles Maillot's unofficial X32 OSC protocol PDF](https://wiki.munichmakerlab.de/images/1/17/UNOFFICIAL_X32_OSC_REMOTE_PROTOCOL_%281%29.pdf) — the closest thing to an authoritative address reference. Verify against live hardware before trusting any address; some paths in the doc don't exist on current firmware.
- Upstream: [anteriovieira/osc-mcp-server](https://github.com/anteriovieira/osc-mcp-server)

## License

MIT (inherited from upstream).
