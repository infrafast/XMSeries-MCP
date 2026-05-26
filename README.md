# XMSeries-MCP

A Model Context Protocol (MCP) server that gives Claude, ChatGPT-compatible MCP clients, or any MCP-capable agent direct control of Behringer/Midas mixers via OSC. The default and most complete mode targets Behringer X32 / Midas M32 consoles; an optional `OSCXR` mode adds partial XAir/XR-compatible addressing for the command families mapped in `PROTOCOL.md`.

This is a rewrite/fork of [anteriovieira/osc-mcp-server](https://github.com/anteriovieira/osc-mcp-server) and carries ideas from the X32 MCP fork lineage, with substantially expanded direct OSC coverage and several bug fixes verified against live hardware (firmware 2.07+). This repository does **not** include the later schema-driven `/node`, meter snapshot, deterministic scene-audit, or FX-algorithm-schema layers described by some upstream forks; see [Not Implemented Here](#not-implemented-here).

## What's in here

MCP tools organized into groups. Highlights beyond the original small MCP server:

- **Deep channel strips** — headamp/preamp context, gate, compressor, EQ (all 4 bands with freq/Q/type/on in X32 mode), fader, pan, name, color, icon, sends, and mute
- **Broad bus / matrix / aux / FX-return / DCA / main coverage** — faders, mutes, names, pan where mapped, EQ where mapped, and focused strip reads
- **FX chain visibility** — type + all 16 params per slot, source assignment, return-channel state
- **Firmware 4.0+ user routing** — per-channel 1:1 physical input mapping with decoded labels ("Card 1" / "AES50A 5" / "Local 27"), not raw ints
- **Routing overview in one call** — `osc_get_routing_overview` returns the full topology (block-level + per-slot + AES50 + Card) with human labels
- **Bulk section reads** — `osc_get_channel_strip`, `osc_get_bus_strip`, `osc_get_console_overview`, etc., so Claude can grab a coherent snapshot in one shot instead of 40 round-trips
- **dB-aware fader helpers** — `osc_db_to_fader_level`, `osc_fader_level_to_db`, and `*_fader_db` tools use the X32/M32 161-point pseudo-log Level table (`0.7500 = 0 dB`, `1.0000 = +10 dB`)
- **Timed automation** — background ramps/fades, delayed OSC actions, and temporal macros through `osc_automation_*` tools, so agents do not perform timing-sensitive work with repeated LLM tool calls
- **Typed custom commands** — `osc_custom_command` accepts an `osctype` override (`int`/`float`/`string`/`bool`) because X32 silently drops type mismatches on strict addresses like `/config/color`

## Primary use cases

- **LLM-assisted mixer inspection** — ask the agent to inspect routing, channel strips, bus sends, FX returns, DCA state, and obvious setup inconsistencies using the bulk read tools.
- **Controlled fixes** — every major readable direct-control parameter in this implementation has a matching write path or a typed `osc_custom_command` escape hatch.
- **Volunteer-friendly operation** — natural-language commands can cover common worship, rehearsal, broadcast, and small-venue tasks without requiring the operator to remember OSC paths.
- **Protocol experimentation** — `OSCXR` mode makes the XAir/XR-compatible subset explicit and fails fast for unmapped features instead of silently sending lossy commands.

## Setup

**Prereqs:** Node 18+, an MCP-capable client, and a supported mixer on your network with OSC enabled. X32/M32 uses `OSCX32M32` by default; XAir/XR-compatible mixers can use `OSCXR` for the currently mapped subset.

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

See `INSTALLATION.md`, `QUICKSTART.md`, and `AGENTS.md` for additional client wiring, including Cline, Continue.dev, and other MCP-compatible agents.

### Environment variables

The stdio MCP server reads these values at startup:

| Variable | Default | Purpose |
|---|---:|---|
| `OSC_HOST` | `192.168.1.17` | Mixer or emulator IP address |
| `OSC_PORT` | `10023` | Mixer OSC UDP port |
| `OSC_PROTOCOL` | `OSCX32M32` | Address mapping mode: `OSCX32M32` or `OSCXR` |
| `MCP_PROMPT_FILE` | repository `PROMPT.md` | Optional absolute path to the prompt exposed through MCP |

The optional HTTP bridge in `src/openai-remote.ts` also reads `HTTP_PORT` and currently has development-oriented defaults for an XR target. Treat it as a small remote-control bridge, not a replacement for the full stdio server.

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

**2. FX racks are user-configurable.** Do not assume slot 1 is always a reverb or slot 5 is always a GEQ. Read `osc_get_effect_type`, `osc_get_all_effects`, or `osc_get_full_fx_chain` before reasoning about an FX slot.

**3. FX slots have no `/on` or `/mix` addresses.** FX are always instantiated on X32. "Turn off FX 3" really means "mute the FX 3 return channel." `osc_set_effect_on` does this automatically. Wet/dry varies by FX algorithm and lives in the per-slot params, not a global mix.

**4. FX slot numbers are unpadded.** `/fx/1/type` works; `/fx/01/type` silently fails. Every other numeric address in X32 uses zero-padded 2-digit numbers (`/ch/05/...`, `/bus/12/...`) — FX is the exception.

**5. FX parameter tools use raw OSC values.** This repository exposes FX type/parameter reads and writes, but it does not include a named FX algorithm schema. `osc_set_effect_param` writes the raw normalized parameter value expected by `/fx/N/par/PP`.

**6. OSC types are strict.** X32 silently drops messages where the type tag doesn't match. `/config/color`, `/config/icon`, `/config/chlink/*`, scene recall, mute-group, and solo switches all require int (`,i`). Some of these are exposed only through `osc_custom_command`; pass `osctype: "int"` if you're not sure the value will be sent as an int.

**7. Channel links are per-pair, not a bitmask.** `/config/chlink/1-2`, `/config/chlink/3-4`, etc. — each returns 0 or 1. Use `osc_get_channel_links` to see all 16 pairs at once.

## Agent prompt

At startup, the server exposes the recommended agent instructions from `PROMPT.md` in three MCP-compatible ways: prompt `xmseries_mixer_assistant`, resource `xmseries://prompt/system`, and fallback tool `osc_get_agent_prompt`. The MCP client or host agent must still decide to fetch and inject that content into the LLM context; the server cannot force system-prompt injection by itself.

For a custom prompt, set `MCP_PROMPT_FILE` in the MCP server `env` to an absolute path.

## How the LLM should use it

For any question about the current mixer state, call the relevant read/get tool before answering. Do not reuse prior conversation context as the source of truth for live levels, mutes, routing, scene names, FX state, or other console values.

For broad inspection, start with low-risk read tools:

1. `osc_get_mixer_status`
2. `osc_get_console_overview`
3. `osc_get_routing_overview`
4. Focused strip reads such as `osc_get_channel_strip`, `osc_get_bus_strip`, `osc_get_main_strip`, and `osc_get_full_fx_chain`

For routing changes, read `osc_get_routing_overview` first so the agent can tell whether a channel is fed by legacy 8-channel blocks or firmware-4.0+ User In slots. For XAir/XR-compatible targets, expect unsupported X32-only requests to return `Unsupported for OSCXR: ...`.

## Example prompts

Once wired up to LLM, natural language works:

```
"Run a scene inspection and tell me what looks risky."
"Why isn't channel 5 working?"
"Compare channel 1 and channel 2 using their strip reads."
"Show me the routing topology."
"Copy channel 1's EQ settings to channel 3."
"Set channel 27's input to Card 1."
"Review my FX setup — anything redundant?"
"Mute all channels except kick, snare, and overheads."
"Save the current state as scene 12 named 'Soundcheck'."
"What's plugged into the console right now?"
"Fade out Voc-Claude in 10 seconds."
"In 5 seconds, mute the main LR."
"Fade Kick on Laurent down a little over 3 seconds."
```

## Tool groups

Full list is visible to Claude; high-level groupings:

| Group | Coverage |
|---|---|
| **Channel strips** | headamp/preamp context, gate, comp, EQ (4 bands), fader, pan, mute, name, color, icon, source, bus sends |
| **Bus / Matrix / Aux / FX-Return / DCA / Main** | faders, mutes, names, pan where mapped, EQ where mapped, focused strip reads |
| **Identity / status** | `osc_get_mixer_status` uses `/xinfo` for network address, mixer network name, console model, and console version, plus `/status`; periodic health checks put writes in offline mode when `/xinfo` times out |
| **Routing** | block-level in/out/AES50/Card, User In (32 slots), User Out (48 slots), decoded labels, one-call overview |
| **FX** | per-slot type, 16 params each, source, full-chain read |
| **Scenes / snippets** | recall, save, name |
| **Linking** | per-pair channel and bus links |
| **Bulk reads** | `channel_strip`, `bus_strip`, `aux_strip`, `matrix_strip`, `fx_return_strip`, `main_strip`, `dca`, `headamp`, `console_overview`, `routing_overview`, `full_fx_chain`, `user_routing` |
| **Fader dB conversion** | `osc_db_to_fader_level`, `osc_fader_level_to_db`, channel/bus/aux/main/matrix `*_fader_db` setters/getters |
| **Automation** | `osc_automation_ramp`, `osc_automation_delayed_command`, `osc_automation_macro`, `osc_automation_list`, `osc_automation_cancel` for background fades, delayed actions, and timed sequences |
| **Raw escape hatch** | `osc_custom_command` with typed args and read-back |

## Fader Levels in dB

The raw OSC fader values are normalized floats from `0.0` to `1.0`. For user-facing dB commands, the server now uses the X32/M32 "Appendix - Level Table - 161 pseudo-log scale Level values" from the unofficial OSC reference:

- `osc_db_to_fader_level({"db": 0})` -> normalized level `0.75`
- `osc_fader_level_to_db({"level": 0.75})` -> `0 dB`
- `osc_set_fader_db`, `osc_get_fader_db` for channels
- `osc_set_bus_fader_db`, `osc_get_bus_fader_db` for buses
- `osc_set_aux_fader_db`, `osc_get_aux_fader_db` for aux returns
- `osc_set_main_fader_db`, `osc_get_main_fader_db` for main LR
- `osc_set_matrix_fader_db`, `osc_get_matrix_fader_db` for X32/M32 matrices

The conversion snaps to the nearest point in the 161-entry table. Values below `-87 dB` map to `-inf`/`0.0`; values above `+10 dB` clip to `+10 dB`/`1.0`.

## Timed Automation

The MCP server includes a small background automation engine for timing-sensitive work. The LLM should start one automation job and let the server handle the clock, rather than trying to perform fades with many repeated tool calls.

Available tools:

- `osc_automation_ramp` starts a fade/ramp on one numeric target and returns immediately with a job id.
- `osc_automation_delayed_command` sends one raw OSC command after a delay.
- `osc_automation_macro` runs a sequence of waits, raw commands, and ramps.
- `osc_automation_list` lists running, completed, failed, and cancelled jobs.
- `osc_automation_cancel` cancels a running job by id.

Supported ramp targets include channel faders, channel sends to bus, bus faders, main LR, FX-return faders, FX sends to bus, aux faders, aux sends to bus, matrix faders, and raw numeric OSC addresses.

Examples:

```json
{
  "target": { "kind": "channel_fader", "channel": 1 },
  "toDb": -120,
  "durationSeconds": 10,
  "curve": "ease_out",
  "label": "Fade out channel 1"
}
```

```json
{
  "target": { "kind": "channel_send", "channel": 6, "bus": 1 },
  "toDb": -6,
  "durationSeconds": 3,
  "label": "Fade Kick on Laurent"
}
```

```json
{
  "delaySeconds": 5,
  "command": { "address": "/main/st/mix/on", "args": [0], "osctype": "int" },
  "label": "Mute main LR later"
}
```

For write-heavy ramps, the server performs the mixer connectivity check once at automation start, then sends the timed OSC writes without probing `/xinfo` at every step. This keeps fades smooth and avoids unnecessary network load.

## Custom OSC commands

`osc_custom_command` can read or write addresses that do not have a dedicated tool. Omit `value` to query an address and return the first reply value. Include `value` to write. Use `osctype` when an address is strict about OSC type tags.

Valid examples:

```json
{ "address": "/ch/01/config/name", "value": "Lead Vocal" }
{ "address": "/ch/05/config/color", "value": 3, "osctype": "int" }
{ "address": "/ch/03/preamp/trim", "value": 0.5, "osctype": "float" }
{ "address": "/ch/02/preamp/hpon", "value": 1, "osctype": "int" }
{ "address": "/ch/02/preamp/hpf", "value": 0.35, "osctype": "float" }
{ "address": "/bus/02/config/name", "value": "Monitor" }
{ "address": "/mtx/01/config/name", "value": "Recording" }
{ "address": "/fx/1/par/01", "value": 0.75, "osctype": "float" }
{ "address": "/ch/01/mix/solo", "value": 1, "osctype": "int" }
{ "address": "/-stat/solosw" }
```

Use unpadded FX slot numbers (`/fx/1/...`, not `/fx/01/...`). Also remember that X32 FX slots do not expose real `/fx/N/on` or `/fx/N/mix` paths; use `osc_set_effect_on` to mute/unmute the matching FX return channel.

For multi-argument custom commands, pass typed entries:

```json
{
  "address": "/custom/path",
  "value": [
    { "type": "float", "value": 0.5 },
    { "type": "string", "value": "text" },
    { "type": "int", "value": 42 }
  ]
}
```

## Status

Works. Tested against:
- X32 Producer, firmware 2.07 (primary dev target)
- Should work on any X32 variant (full, Compact, Rack, Core) and M32 family — the OSC surface is identical
- Firmware-4.0+ User In/User Out routing paths are implemented and decoded; some output-source labels are marked best-effort in code where less thoroughly verified.
- `OSCXR` support is intentionally partial and follows `PROTOCOL.md`; use `OSC_PROTOCOL=OSCXR npm test` for the protocol-aware smoke path.

## Not Implemented Here

Some related upstream forks document features that are **not present in this repository**. Do not expect these tool names or behaviors unless they are added later:

- `osc_capabilities`
- Schema-driven `/node` tools such as `osc_node_get`, `osc_node_set`, and `osc_list_nodes`
- Deterministic scene snapshot/audit tools such as `osc_scene_snapshot` and `osc_scene_audit`
- Signal-flow tracing tools such as `osc_trace_signal` and `osc_find_routing`
- Binary meter snapshots or streaming meter subscriptions such as `osc_meter_snapshot`
- Named FX algorithm parameter schemas such as `osc_fx_get`, `osc_fx_set`, `osc_fx_set_type`, or `osc_fx_list_algorithms`
- Insert GEQ/TEQ helpers such as `osc_insert_eq_get`, `osc_insert_eq_set`, and `osc_find_geq_slots`
- Scene comparison/copy helpers such as `osc_compare_scenes`, `osc_compare_channels`, and `osc_copy_channel`

Other out-of-scope mixer areas:

- Talkback (`/config/talk/*`)
- Monitor / headphone (`/-stat/monitor/*`)
- Custom user-assignable controls (`/config/userctrl/*`)
- Meters (`/meters/*` — uses a different subscribe-based binary protocol)
- Show/library file management (`/-show/*`, `/-libs/*`, deeper `/-snap/*` management beyond the implemented scene name/recall/save helpers)
- Console preferences (`/-prefs/*`)
- USB recorder and file browser operations
- DP48 personal mixer workflows

## Dev

```bash
npm run build     # compile
npm run dev       # watch mode
npm start         # run directly (for debugging outside Claude Desktop)
npm test          # protocol-aware smoke test through test-connection.js
```

For XR/XAir-compatible smoke testing:

```bash
OSC_HOST=192.168.0.16 OSC_PORT=10024 OSC_PROTOCOL=OSCXR npm test
```

`src/osc-client.ts` — all the mixer I/O, path selection for `OSCX32M32` vs. `OSCXR`, type coercion helpers, User In/User Out decoders, and the OSC connection (binds UDP on `0.0.0.0` so the mixer's replies actually arrive — upstream bound localhost and silently got nothing).

`src/index.ts` — the MCP tool surface. Every tool has a `name`, `description`, `inputSchema`, and a handler case.

`src/automation.ts` — the background automation engine used by `osc_automation_*` tools for ramps, delayed actions, and temporal macros.

`src/openai-remote.ts` — optional minimal Streamable HTTP MCP server exposing a very small remote-control tool subset (`x32_get_channel_name`, main mute, main fader get/set). This is separate from the full stdio MCP server in `src/index.ts`.

`PROTOCOL.md` — logical path mapping notes for X32/M32 and XAir/XR-compatible addresses.

`test-connection.js` — protocol-aware smoke test used by `npm test`.

### Technical details

- MCP framework: `@modelcontextprotocol/sdk`
- OSC transport: `osc-js` `DatagramPlugin` over UDP
- HTTP bridge dependencies: `express` and `cors`
- Language/tooling: TypeScript, Node 18+
- Health check: write tools probe `/xinfo` on demand before sending writes; automation jobs probe once when the job starts
- Offline write guard: if the on-demand `/xinfo` health check fails, write tools return `Le mixeur est deconnecté`
- Reply handling: stores one pending callback per OSC address and times out reads after 1 second

## Troubleshooting

**Tools do not appear in the MCP client**

- Confirm `npm run build` has produced `dist/index.js`.
- Check that the MCP config uses an absolute path to `dist/index.js`.
- Validate the JSON config and fully restart the MCP client.
- Check client logs. Claude Desktop logs are typically in `~/Library/Logs/Claude/` on macOS and `%APPDATA%\Claude\logs\` on Windows.

**Timeout waiting for response**

- Verify the mixer IP: on X32/M32, press `SETUP` and check `Network`.
- Test network reachability with `ping YOUR_MIXER_IP`.
- Confirm the mixer and computer are on the same network.
- Confirm OSC is enabled on the mixer.
- Check that UDP traffic to `OSC_PORT` is not blocked by a firewall.
- Run `npm test` against the same `OSC_HOST`, `OSC_PORT`, and `OSC_PROTOCOL`.

**Command appears to run but the mixer does not change**

- Recheck `OSC_PROTOCOL`; X32/M32 should normally use `OSCX32M32`.
- For raw commands, verify the OSC address spelling and zero-padding rules.
- For strict int addresses, send `osctype: "int"` instead of relying on JSON type inference.
- In `OSCXR` mode, read the returned error. Unmapped X32-only operations should report `Unsupported for OSCXR: ...`.

## Reference

- [Patrick-Gilles Maillot's unofficial X32 OSC protocol PDF](https://wiki.munichmakerlab.de/images/1/17/UNOFFICIAL_X32_OSC_REMOTE_PROTOCOL_%281%29.pdf) — the closest thing to an authoritative address reference. Verify against live hardware before trusting any address; some paths in the doc don't exist on current firmware.
- Upstream: [anteriovieira/osc-mcp-server](https://github.com/anteriovieira/osc-mcp-server)

## License

MIT (inherited from upstream).
