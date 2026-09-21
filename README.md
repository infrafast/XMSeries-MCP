# XMSeries-MCP

A Model Context Protocol (MCP) server that gives Claude, ChatGPT-compatible MCP clients, or any MCP-capable agent direct control of Behringer/Midas mixers via OSC. The default and most complete mode targets Behringer X32 / Midas M32 consoles; an optional `OSCXR` mode adds partial XAir/XR-compatible addressing for the command families mapped in `PROTOCOL.md`. Recommended to be used together with the LLM agent https://github.com/infrafast/LiveStageAssistant

This is a rewrite/fork of [anteriovieira/osc-mcp-server](https://github.com/anteriovieira/osc-mcp-server) and carries ideas from the X32 MCP fork lineage, with substantially expanded direct OSC coverage and several bug fixes verified against live hardware (firmware 2.07+). This repository does **not** include the later schema-driven `/node`, meter snapshot, deterministic scene-audit, or FX-algorithm-schema layers described by some upstream forks; see [Not Implemented Here](#not-implemented-here).

For developpers: https://deepwiki.com/infrafast/XMSeries-MCP

## What's in here

MCP tools organized into groups. Highlights beyond the original small MCP server:

- **Focused channel, bus, aux, FX-return, and main coverage** — faders, mutes, names, sends, returns, and status tools for common live operations
- **FX return control** — read and mute/unmute FX return state without exposing low-level FX parameter editing
- **dB-aware level helpers** — `osc_db_to_fader_level`, `osc_fader_level_to_db`, and factorized fader/send tools with `unit:"db"` use the X32/M32 161-point pseudo-log Level table (`0.7500 = 0 dB`, `1.0000 = +10 dB`)
- **Timed automation** — background ramps/fades, delayed OSC actions, and temporal macros through `osc_automation_*` tools, so agents do not perform timing-sensitive work with repeated LLM tool calls

## Primary use cases

- **LLM-assisted mixer inspection** — ask the agent to inspect routing, channel strips, bus sends, FX returns, DCA state, and obvious setup inconsistencies using the bulk read tools.
- **Controlled fixes** — common readable direct-control parameters are exposed as dedicated typed MCP tools rather than raw OSC escape hatches.
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

The server starts with these environment values, then the active mixer can be changed at runtime with `osc_configure_mixer`. Omitted fields keep their current values. Changing `host`, `port`, or `protocol` closes the current OSC client and reconnects to the new mixer. For count-only updates, use `osc_set_mixer_counts`; it updates resolver and bulk-read limits without reconnecting. If counts are included in `osc_configure_mixer`, they are applied together with the connection change.

For compact OSCXR mixers, set the scan limits to the actual console instead of leaving the X32/M32 defaults. The validated XR16 rack profile is `OSC_CHANNEL_COUNT=16`, `OSC_BUS_COUNT=4`, `OSC_FX_COUNT=4`, `OSC_DCA_COUNT=4`. This matters for the deterministic resolver: an oversized channel/bus range can make name resolution probe indexes that the XR mixer does not expose.

Example runtime change:

```json
{
  "host": "192.168.0.160",
  "port": 10024,
  "protocol": "XR"
}
```

Example runtime limit update:

```json
{
  "channelCount": 32,
  "busCount": 16,
  "fxCount": 5,
  "dcaCount": 3
}
```

Use `osc_set_mixer_counts` for that count-only update.

See `INSTALLATION.md`, `QUICKSTART.md`, and `AGENTS.md` for additional client wiring, including Cline, Continue.dev, and other MCP-compatible agents.

### Environment variables

Both MCP transports read these values at startup:

| Variable | Default | Purpose |
|---|---:|---|
| `OSC_HOST` | `192.168.1.17` | Mixer IP address |
| `OSC_PORT` | `10023` | Mixer OSC UDP port |
| `OSC_PROTOCOL` | `OSCX32M32` | Address mapping mode: `OSCX32M32` or `OSCXR` |
| `OSC_CHANNEL_COUNT` | `32` | Number of input channels scanned for deterministic name resolution and bulk reads |
| `OSC_BUS_COUNT` | `16` | Number of mix buses scanned/used by deterministic resolution and bulk commands |
| `OSC_FX_COUNT` | `8` | Number of FX returns/slots scanned |
| `OSC_DCA_COUNT` | `8` | Number of DCA groups scanned |
| `MCP_PROMPT_FILE` | repository `PROMPT.md` | Optional absolute path to the prompt exposed through MCP |
| `XMS_SPEAKER_MAP` | empty | Optional JSON map used by `osc_get_speaker_context` to translate a recognized voice speaker into monitor bus/channel names |

`XMS_SPEAKER_MAP` is intentionally server-side. A voice agent may pass a neutral `speaker` value, but this MCP server decides how that speaker maps to the mixer. Example:

```bash
XMS_SPEAKER_MAP='{"laurent":{"bus":"Laurent","channel":"Talk Laurent"},"marie":{"bus":"Marie"}}'
```

Speaker destinations are explicit and fail-closed: if a speaker has an explicit `bus` in `XMS_SPEAKER_MAP`, that bus is the personal monitor destination; if the speaker is explicitly mapped but has no `bus`, the personal monitor destination is Main LR / façade; if the speaker is absent from `XMS_SPEAKER_MAP`, the context is unresolved and commands such as `mon retour` require clarification. `channel` remains optional and is used for first-person input phrases such as `mon micro` / `ma voix`.

In HTTP mode, the `/mcp` admin page exposes this same speaker mapping as `XMS_SPEAKER_MAP` in the configuration form. Saving it updates the running HTTP server immediately; for `stdio` mode, set `XMS_SPEAKER_MAP` in the MCP client config `env` before launching the server.

### Transport modes

The full MCP server can run either as the original local `stdio` server or as a Streamable HTTP MCP server. Both transports use the same reusable MCP server factory and expose the same tools, prompts, and resources.

**stdio mode** remains the default and is unchanged:

```bash
npm start
```

Client configs that launch `node dist/index.js` continue to work as before.

**HTTP mode** exposes the MCP endpoint on the network:

```bash
HTTP_HOST=0.0.0.0 HTTP_PORT=8787 MCP_AUTH_TOKEN=change-me npm run start:http
```

HTTP mode reads these additional variables:

| Variable | Default | Purpose |
|---|---:|---|
| `HTTP_HOST` | `0.0.0.0` | Interface for the HTTP MCP server. Use `0.0.0.0` to accept connections from other machines on the LAN. |
| `HTTP_PORT` | `8787` | HTTP MCP port |
| `HTTP_PUBLIC_HOST` | auto-detected | Optional LAN IP or hostname to print in the agent JSON config. Useful in Docker, where auto-detection may otherwise find the container IP. |
| `MCP_AUTH_TOKEN` | unset | Optional bearer token required on `/mcp` and `/health` when set |
| `OSC_CHANNEL_COUNT` | `32` | Initial number of mixer input channels to scan for name resolution and overview reads. Can be changed at runtime with `osc_configure_mixer`. |
| `OSC_BUS_COUNT` | `16` | Initial number of mix buses to scan/use for name resolution and all-bus commands. Can be changed at runtime with `osc_configure_mixer`. |
| `OSC_FX_COUNT` | `8` | Initial number of FX slots/returns to scan for name resolution and FX reads. Can be changed at runtime with `osc_configure_mixer`. |
| `OSC_DCA_COUNT` | `8` | Initial number of DCA groups to scan for name resolution and overview reads. Can be changed at runtime with `osc_configure_mixer`. |

The HTTP MCP endpoint is `/mcp`; a health endpoint is available at `/health`. Browser `GET /mcp` requests without an MCP session show a small admin page with the live mixer status and editable runtime connection/count settings. The same page uses `GET /mcp/status` and `POST /mcp/config`; Streamable HTTP agent traffic on `/mcp` is unchanged. If `MCP_AUTH_TOKEN` is set, remote agents and browser/admin requests must send `Authorization: Bearer <token>` or `x-mcp-auth-token: <token>`.

Example remote-agent configuration:

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

Replace `192.168.1.50` with the IP address of the computer running XMSeries-MCP. A copy of this example is provided in `mcp_http_agent_config.example.json`.

Because this server can control live mixer state, avoid exposing HTTP mode directly to the public internet. Prefer a trusted LAN, VPN, or authenticated reverse proxy.

**Docker / Synology Container Manager**

Build and run locally:

```bash
docker build -t xmseries-mcp:latest .
docker run --rm -p 8787:8787 \
  -e HTTP_PUBLIC_HOST=192.168.1.50 \
  -e MCP_AUTH_TOKEN=change-me \
  -e OSC_HOST=192.168.0.1 \
  -e OSC_PORT=10023 \
  -e OSC_PROTOCOL=OSCX32M32 \
  -e OSC_CHANNEL_COUNT=32 \
  -e OSC_BUS_COUNT=16 \
  -e OSC_FX_COUNT=8 \
  -e OSC_DCA_COUNT=8 \
  -e DEBUG=false \
  xmseries-mcp:latest
```

Or use the included `docker-compose.yml` as a starting point. On Synology, set `HTTP_PUBLIC_HOST` to the NAS LAN IP or DNS name that agents should use. Set `DEBUG=true` when you want `[OSC READ]` and `[OSC WRITE]` traces in the container logs. The official Node base image supports common Synology architectures such as `linux/amd64` and `linux/arm64`; build on the target NAS or publish a multi-architecture image with `docker buildx`.

### Protocol support

`OSCX32M32` is the complete/default mode. `OSCXR` is now partially effective for the command families currently mapped in `PROTOCOL.md`: channel fader/mute/name, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return via `/rtn/aux`, DCA fader/mute/name, and headamp gain.

When `OSC_PROTOCOL` is `OSCXR`, commands that are still X32-only or not yet mapped return an explicit `Unsupported for OSCXR: ...` error instead of waiting for an OSC timeout. This includes routing/user routing, matrices, console overview, colors/icons, gate/compressor, pan, EQ frequency/Q/type, and other features not covered by `PROTOCOL.md` yet. Bus-specific source mute operations are also guarded: X32 can mute channel/FX/aux sends to one bus, while XR exposes only global source mute paths, so those lossy translations are rejected instead of silently muting the whole source.

> **Windows MSIX note:** if you installed Claude Desktop from the Microsoft Store, the config path is `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`, not the standard `%APPDATA%\Claude\` path.

## Things worth knowing before you use it

A few X32/M32 quirks that will bite you if you do not know them. These mostly apply to the default `OSCX32M32` mode. In `OSCXR` mode, unsupported X32-only tools fail fast with `Unsupported for OSCXR: ...`.

**1. Routing: block-level vs. per-channel (firmware 4.0+).** On modern X32 firmware, inputs have two layers:

- **Block-level** (`/config/routing/IN/1-8` etc.) picks which 8-channel source group feeds each range of channels. Legacy style.
- **User In** (`/config/userrout/in/NN`, 32 slots) patches each individual channel to any physical source — Local, AES50A/B, Card, AuxIn. This only takes effect if the corresponding block is set to "User In".

Routing tools are not exposed in this server profile.

**2. FX racks are user-configurable.** Do not assume slot 1 is always a reverb or slot 5 is always a GEQ. This focused profile exposes FX return level/send/mute state, not full FX algorithm introspection.

**3. FX slots have no `/on` or `/mix` addresses.** FX are always instantiated on X32. "Turn off FX 3" really means "mute the FX 3 return channel." `osc_set_effect_on` does this automatically. Wet/dry varies by FX algorithm and lives in the per-slot params, not a global mix.

**4. FX slot numbers are unpadded.** `/fx/1/type` works; `/fx/01/type` silently fails. Every other numeric address in X32 uses zero-padded 2-digit numbers (`/ch/05/...`, `/bus/12/...`) — FX is the exception.

**5. FX parameters are intentionally not exposed.** This focused profile avoids low-level normalized FX parameter writes because it does not include a named FX algorithm schema.

**6. OSC types are strict.** X32 silently drops messages where the type tag does not match. This server now exposes only dedicated typed tools for supported operations; raw OSC custom writes are intentionally not available.

## Agent prompt

At startup, the server exposes the recommended agent instructions from `PROMPT.md` in three MCP-compatible ways: standard prompt `agent_prompt`, standard resource `agent://prompt/system`, and standard fallback tool `get_agent_prompt`. The MCP client or host agent must still decide to fetch and inject that content into the LLM context; the server cannot force system-prompt injection by itself.

For a custom prompt, set `MCP_PROMPT_FILE` in the MCP server `env` to an absolute path.

## How the LLM should use it

For any question about the current mixer state, call the relevant read/get tool before answering. Do not reuse prior conversation context as the source of truth for live levels, mutes, routing, FX state, or other console values.

For broad inspection, start with low-risk read tools:

1. `osc_get_mixer_status`

For live mix state questions, read the relevant focused fader, mute, send, or FX-return tool directly.

Routing tools are not exposed in this server profile. For XAir/XR-compatible targets, expect unsupported X32-only requests to return `Unsupported for OSCXR: ...`.

## Example prompts

Once wired up to LLM, natural language works:

```
"Why isn't channel 5 working?"
"Compare channel 1 and channel 2 using their strip reads."
"Review my FX setup — anything redundant?"
"Mute all channels except kick, snare, and overheads."
"What's plugged into the console right now?"
"Fade out Voc-Claude in 10 seconds."
"In 5 seconds, mute the main LR."
"Fade Kick on Laurent down a little over 3 seconds."
"Mute all buses."
"Mute Mike and Laurent buses."
"Set Laurent, Mike, and front panel to -3 dB."
```

### Multi-target and grouped commands

This server supports grouped operations so the agent can execute one intent across several targets without manually iterating one tool call per target.

- **All input channels** (for example: `"mute all channels"`):
  - Uses `osc_mute_all_channels` to mute/unmute every configured input channel.
- **All input channels except named exceptions** (for example: `"mute toutes les voies sauf Kick et Snare"`):
  - Resolve each exception in the channel family, then use `osc_mute_all_channels_except`.
- **Selected input-channel lists** (for example: `"réactive les voies Voix et Guitare"`):
  - Resolve each channel name, then use `osc_mute_channels`.
- **All bus masters** (for example: `"mute all buses"`):
  - Uses `osc_mute_all_buses` to mute/unmute every bus master in one batch.
- **Selected bus master lists** (for example: `"mute Mike and Laurent buses"`):
  - Resolve each bus name with `osc_find_named_target`, then use `osc_mute_buses`.
- **Selected bus send-level lists** (for example: `"set kick to -3 dB on Laurent and Mike"`):
  - Resolve bus names, then use `osc_send_to_buses_db`.
- **All bus send levels** (for example: `"set kick to -3 dB on all buses"`):
  - Use `osc_send_to_all_buses_db`.
- **Mixed destination command including main LR** (for example: `"set Laurent, Mike and the front panel to -3 dB"`):
  - The bus list (`Laurent`, `Mike`) is applied with `osc_send_to_buses_db`, and front panel/façade/main LR is included in the same batch intent via `includeMain: true`.

These grouped tools are preferred over issuing many per-bus tool calls because they keep intent explicit, reduce round-trips, and avoid inconsistent partial execution.

### Generic instrument-owner name resolution

`osc_find_named_target` recognizes channel labels that follow an `<instrument>-<owner>` convention from natural French ownership phrases. It removes articles and ownership connectors, maps `guitare` to the common mixer label prefix `guitar`, and uses limited French phonetic normalization only for the owner token. Examples include `guitare de Claude` -> `guitar-clode`, `basse de Mike` -> `basse-mike`, and `saxophone de Luc` -> `saxophone-luc`.

The resolver returns these as `structured` matches. Only a unique structured match is safe to use; multiple structured matches require clarification, and ordinary fuzzy matches still require confirmation. In a phrase such as `monte la guitare de Claude sur Laurent`, resolve the complete ownership phrase in the `channel` family and resolve `Laurent` separately in the `bus` family.

For source-to-return commands, prefer `osc_resolve_channel_to_bus`. It accepts separate `source` and `destination` strings, resolves the source only among channels and the destination only among buses, and returns `safeToWrite:true` only when both sides are unique non-fuzzy matches. For example, `monte la batterie sur Anthony` becomes `{ "source": "batterie", "destination": "Anthony" }`; never merge it into a channel lookup for `batterie de Anthony`.

Run the offline name-resolution checks with `npm run test:name-resolution`. They do not connect to a mixer or send OSC writes.

## Tool groups

Full list is visible to Claude; high-level groupings:

| Group | Coverage |
|---|---|
| **Resolution / identity** | named-target resolution, channel→bus resolution, recognized-speaker context, fresh mixer status |
| **Channel / Bus / Aux / FX-return / DCA / Main** | user-facing fader and mute controls, plus channel mute/name reads |
| **Matrix** | fader and mute controls on X32/M32; explicitly unsupported on OSCXR |
| **Sends** | channel / FX return / aux return → bus levels, route mutes where protocol-safe, channel → AUX output on X32/M32 |
| **Grouped writes** | selected/all/all-except channel and bus mutes; channel level to selected/all buses with optional Main LR |
| **FX state** | FX-return active/muted state and on/off control through the FX return |
| **Fader dB conversion** | `osc_db_to_fader_level`, `osc_fader_level_to_db`, factorized fader/send tools with `unit:"db"` |
| **Automation** | `osc_automation_ramp`, `osc_automation_delayed_command`, `osc_automation_macro`, `osc_automation_list`, `osc_automation_cancel` for background fades, delayed actions, and timed sequences |

## Transactional Writes

Dedicated direct-control write tools use transactional OSC write-back verification where the target address is readable: the server writes one value, reads the same OSC address back, and verifies the returned value. Numeric values use a small tolerance and a few short read retries to tolerate mixer update latency. If the mixer does not answer, the tool reports `Le mixeur est deconnecté`; if the value read back differs, the tool reports that the OSC command was not executed correctly.

Batch bus mute tools verify each bus write and report partial failures instead of silently claiming success. Ramp automations do not read after every step, but they verify the final value before marking the job completed.

## Fader Levels in dB

The raw OSC fader values are normalized floats from `0.0` to `1.0`. For user-facing dB commands, the server now uses the X32/M32 "Appendix - Level Table - 161 pseudo-log scale Level values" from the unofficial OSC reference:

- `osc_db_to_fader_level({"db": 0})` -> normalized level `0.75`
- `osc_fader_level_to_db({"level": 0.75})` -> `0 dB`
- `osc_channel_fader` with `unit:"db"` for channels
- `osc_bus_fader` with `unit:"db"` for buses
- `osc_aux_fader` with `unit:"db"` for aux returns
- `osc_main_fader` with `unit:"db"` for main LR

For safety, every fader/send `action:"set"` must include an explicit `unit`. Read actions still default to dB. If you pass a normalized fader level such as `0.575`, set `unit:"level"`; if you pass a dB value such as `-7`, set `unit:"db"`.

The conversion snaps to the nearest point in the 161-entry table. Values below `-87 dB` map to `-inf`/`0.0`; values above `+10 dB` clip to `+10 dB`/`1.0`.

## Timed Automation

The MCP server includes a small background automation engine for timing-sensitive work. The LLM should start one automation job and let the server handle the clock, rather than trying to perform fades with many repeated tool calls.

Available tools:

- `osc_automation_ramp` starts a fade/ramp on one numeric target and returns immediately with a job id.
- `osc_automation_delayed_command` schedules one delayed supported mixer command. Prefer structured `target` + `toDb`/`toLevel` for delayed level writes.
- `osc_automation_macro` runs a sequence of waits, allowlisted raw commands, and structured ramps. Each `ramp` step must include its own structured `target`; use `type:"wait"` for delays inside macros (`type:"delay"` is accepted as a compatibility alias).
- `osc_automation_list` lists running, completed, failed, and cancelled jobs.
- `osc_automation_cancel` cancels a running job by id.

Supported ramp targets include channel faders, channel sends to bus, bus faders, main LR, FX-return faders, FX sends to bus, aux faders, aux sends to bus, matrix faders, and allowlisted raw numeric OSC addresses.

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

For a named bus/monitor fader, use `kind:"bus_fader"`:

```json
{
  "target": { "kind": "bus_fader", "bus": 2 },
  "toDb": 0,
  "durationSeconds": 12,
  "label": "Raise Claude bus to 0 dB"
}
```

For a delayed main LR/façade level write, use a structured target instead of a raw OSC address:

```json
{
  "delaySeconds": 5,
  "target": { "kind": "main_fader" },
  "toDb": 0,
  "label": "Set main LR to 0 dB later"
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

Raw automation commands are rejected unless the address is in the server's protocol-aware allowlist for the active mixer protocol. Do not invent OSC paths; use structured targets for known level writes.

For write-heavy ramps, the server sends timed OSC writes without probing `/xinfo` at every step, then verifies the final target value. This keeps fades smooth while still detecting failed end states.

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
- Show/library file management (`/-show/*`, `/-libs/*`, deeper `/-snap/*` management)
- Console preferences (`/-prefs/*`)
- USB recorder and file browser operations
- DP48 personal mixer workflows

## Dev

```bash
npm run build     # compile
npm run dev       # watch mode
npm start         # run directly (for debugging outside Claude Desktop)
npm run start:http  # run the full MCP server over Streamable HTTP
npm test          # protocol-aware smoke test through test-connection.js
npm run test:llm-tools  # LLM natural-language -> MCP tool-call benchmark
```

For XR/XAir-compatible smoke testing:

```bash
OSC_HOST=192.168.0.16 OSC_PORT=10024 OSC_PROTOCOL=OSCXR npm test
```

`src/osc-client.ts` — all the mixer I/O, path selection for `OSCX32M32` vs. `OSCXR`, type coercion helpers, User In/User Out decoders, and the OSC connection (binds UDP on `0.0.0.0` so the mixer's replies actually arrive — upstream bound localhost and silently got nothing).

`src/index.ts` — the MCP tool surface and reusable `createOscMcpServer()` factory. Every tool has a `name`, `description`, `inputSchema`, and a handler case. The CLI entry point still uses `StdioServerTransport`.

`src/automation.ts` — the background automation engine used by `osc_automation_*` tools for ramps, delayed actions, and temporal macros.

`src/http.ts` — full Streamable HTTP MCP transport for the same server created by `createOscMcpServer()`. `src/openai-remote.ts` remains as a compatibility wrapper for the older `start:openai` script.

`PROTOCOL.md` — logical path mapping notes for X32/M32 and XAir/XR-compatible addresses.

`test-connection.js` — protocol-aware smoke test used by `npm test`.

`test-llm-tools.js` — LLM tool-selection benchmark that feeds natural-language commands plus the agent prompt to a model and verifies the expected MCP tool names/arguments. It uses mocked tool results for relative commands and never connects to the mixer.

### Technical details

- MCP framework: `@modelcontextprotocol/sdk`
- OSC transport: `osc-js` `DatagramPlugin` over UDP
- HTTP bridge dependencies: `express` and `cors`
- Language/tooling: TypeScript, Node 18+
- Transactional writes: dedicated readable write tools write the value, read the same OSC address back, and verify the result
- Offline detection: if the write-back read times out, write tools return `Le mixeur est deconnecté`
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


## Local deterministic gateway

XMSeries-MCP can expose an optional deterministic natural-language command gateway for clients such as the LiveStageAssistant Local engine. This mode does **not** use an LLM to choose mixer tools. XMSeries-MCP parses the user text locally, resolves mixer targets, creates a short-lived plan, then executes that plan through the same resolver, OSC and automation code used by the normal MCP tools.

It is disabled by default. Ordinary/cloud MCP clients keep the existing low-level OSC tool inventory and `PROMPT.md` behavior.

Enable it only for a dedicated deterministic client/LSA process:

```text
LSA_LOCAL_COMMAND_GATEWAY=1
```

When enabled, two reserved tools are added:

- `lsa_local_analyze_command`: side-effect-free command parsing and planning;
- `lsa_local_execute_command`: execution of a previously accepted short-lived plan token.

The gateway uses `lsa-command-gateway/v1`. Write plans are short-lived and one-shot. Named targets are re-resolved before execution, and fuzzy-only or ambiguous matches never directly authorize a write.

### How to speak or type deterministic mixer commands

The parser is intentionally bounded and deterministic. Prefer the canonical formulations below when using speech recognition or typing directly into a deterministic client. Mixer names such as `batterie`, `Anthony`, or `Laurent` are examples: replace them with the actual labels configured on your mixer.

Natural-language variants are normalized before structural parsing. The French Local layer canonicalizes a bounded vocabulary of safe synonyms (for example `couper/désactiver/éteindre -> mute`, `réactiver/rallumer -> unmute`, `augmenter -> monter`, `diminuer/descendre -> baisser`) while the grammar still determines source, destination, value, duration and delay. Context-sensitive words are not blindly replaced: `remets Batterie` means unmute, while `remets Batterie à -10 dB` means set the fader. Natural mixer-status questions such as `quel est le statut du mixeur ?`, `est-ce que le mixeur est connecté ?`, `quelle est la version du mixeur ?`, `quel est le firmware du mixeur ?` and `donne-moi le statut du mixeur` converge to the same read-only status intent. Name resolution and writes remain fail-closed after normalization.

The structural parser itself is native Node/TypeScript and follows a lexical-slot + constraint-matching design: local regexes recognize lexical primitives such as verbs, values, properties, list selectors, destinations, delays and durations, then semantic constraints select one typed intent. All elementary Local commands now enter this same parser, including mixer/automation status, mute/FX-state/name reads, grouped selectors, physical AUX destinations and automation cancellation. Constituent order stays flexible without making meaning fuzzy: `à` remains absolute, `de` relative, `en` a ramp duration and `dans` a delayed execution marker. Only temporal sequence composition/anaphora and recognized-speaker expansion stay outside the elementary parser. Target identity, structured-name resolution, capability checks, fuzzy clarification, protocol guards and write authorization remain specialized XMSeries layers and are deliberately not delegated to grammar.

Explicit family qualifiers are generic constraints too. Prefixes such as `bus Anthony`, `channel guitare de anto`, `voie Batterie`, `fx Hall FX`, `aux Playback`, `dca Band` and `matrix Matrix Vox` are stripped from the label before resolution and restrict the resolver to that family. This applies to standalone targets and to both sides of routes; a contradictory qualifier such as `channel Anthony` fails closed if `Anthony` only exists as a bus.

Named lists are family-agnostic unless the user explicitly names a family. For example, `unmute Anthony et Laurent` is parsed as two target names, each name is resolved against the mixer inventory, and only then is the operation validated. The same composition applies to route destinations: `mets Batterie à -20 dB sur Anthony et Laurent`, `mute Batterie sur Anthony et Laurent`, relative changes, reads, delays and ramps all share the same multi-destination wrapper. A configured target whose own label contains `et/and` is tried as one exact target before the text is treated as a list. The grammar therefore never assumes that an unqualified destination is a bus; the adapter capability layer decides whether the resolved source→destination relation is supported. In the current XMSeries implementation, ordinary send destinations are buses; another resolved family is reported as incompatible rather than as an unknown name.

| Intent | Canonical examples |
|---|---|
| Mixer status | `statut mixeur` |
| Read a level | `niveau de batterie` · `donne le niveau de batterie` |
| Mute / unmute | `mute batterie` · `éteins batterie` · `unmute batterie` · `rallume batterie` |
| DCA level / mute | `mets Band à -6 dB` · `mute Band` · `baisse progressivement Band à -20 dB en 2 secondes` |
| Matrix level / mute | `mets Matrix Vox à -12 dB` · `mute Matrix Vox` (X32/M32 only; OSCXR must return unsupported) |
| Read mute / FX state / channel name | `état du mute de Batterie` · `Hall FX est-il actif ?` · `quel est le nom de la voie 6 ?` |
| Explicit FX engine state | `active l'effet Hall FX` · `désactive l'effet Hall FX` (distinct syntax; `mute Hall FX` keeps the established FX-return mute/on-off behavior) |
| Normalized level | `mets Batterie au niveau 0.75` · `mets Batterie sur Anthony au niveau 0.5` |
| Grouped channel mute | `mute les voies Voix et Batterie` · `mute toutes les voies` · `mute toutes les voies sauf Voix` |
| Channel -> AUX output | `mets Batterie sur sortie aux 2 à 50%` · `mets Batterie sur sortie aux 2 au niveau 0.5` (X32/M32 only) |
| Absolute dB | `mets batterie à -30 dB` · `mets le niveau de batterie à -30 dB` |
| Relative dB | `monte batterie de 3 dB` · `baisse batterie de 3 dB` |
| Qualitative relative | `monte un peu le niveau de batterie` · `baisse beaucoup batterie` · `monte le volume` · `monte le son` · `baisse un peu le volume` (Main LR) · `un peu plus fort batterie` · `batterie moins fort` |
| Absolute percent | `mets batterie à 50%` |
| Relative percent | `monte batterie de 10%` · `baisse batterie de 1%` · `monte le volume de 100%` (Main LR) |
| Channel -> bus absolute | `mets batterie sur Anthony à -20 dB` |
| Channel -> bus relative | `monte batterie sur Anthony de 3 dB` |
| Source -> bus read | `niveau de Batterie sur Anthony` · `quel est le niveau de Hall FX sur Anthony` · `donne le niveau de Playback dans Anthony` |
| Source -> bus qualitative | `monte batterie sur Anthony` · `baisse un peu Playback dans Anthony` |
| FX/aux -> bus absolute | `mets Hall FX sur Anthony à -18 dB` · `mets Playback sur Anthony à -20 dB` |
| Source -> bus mute | `mute Batterie sur Anthony` · `coupe Hall FX sur Anthony` · `réactive Playback dans Anthony` |
| Named target lists | `unmute Anthony et Laurent` · `mute Batterie et Anthony` (family inferred after resolving each name) |
| Multi-destination routes | `mets Batterie à -20 dB sur Anthony et Laurent` · `mute Batterie sur Anthony et Laurent` · `monte Batterie sur Anthony et Laurent de 3 dB` |
| Bulk bus mute | `mute les bus Anthony et Laurent` · `coupe tous les bus` · `coupe tous les bus sauf Anthony` |
| Bulk channel -> buses | `mets batterie à -20 dB sur les bus Anthony et Laurent` · `mets batterie à -25 dB sur tous les bus et façade` |
| Progressive/ramp | `baisse progressivement batterie à -30 dB en 2 secondes` |
| Relative progressive | `monte progressivement batterie de 3 dB en 5 secondes` · `baisse un peu progressivement batterie en 2 secondes` |
| Fade | `fade out batterie en 10 secondes` · `fade in batterie en 10 secondes` |
| Explicit fade range | `fade batterie de -40 dB à -10 dB en 5 secondes` |
| Delayed level | `mets batterie à -27 dB dans 2 secondes` |
| Delayed ramp | `dans 3 secondes baisse progressivement batterie à -30 dB en 2 secondes` |
| Delayed fade | `dans 5 secondes, fais un fade out de Voix` (without an explicit ramp duration, the canonical delayed-fade form uses a 5 s ramp) |
| Multi-action sequence | `baisse la façade puis remonte-la après 5 secondes` · `mute Batterie puis dans 2 secondes unmute Batterie` |
| Explicit anaphora | after `baisse Voix`: `remonte-la`; after a route command: `mets Voix sur le même retour à -8 dB` |
| Delayed mute | `mute batterie dans 5 secondes` · `dans 5 secondes mute le main LR` · `dans 3 secondes rallume batterie` · `mute Batterie sur Anthony dans 5 secondes` |
| Automation status | `statut des automations` · `liste les automations` |
| Cancel by id | `annule l'automation auto-3` |
| Cancel latest running job | `annule la dernière automation` |
| Speaker monitor context | `monte mon retour de 3 dB` · `mute mon retour` |
| Speaker input context | `mets mon micro à -12 dB` · `baisse ma voix de 2 dB` |
| Source -> speaker monitor | `mets batterie dans mon retour à -20 dB` |

### Functional acceptance recipe

The deterministic Local milestone has an executable acceptance corpus in `corpus/local-functional-recipe.fr.json`. It is run by CI and can also be run locally without a mixer:

```bash
npm run test:local-recipe
```

This recipe covers the user-facing command families documented above and the canonical behaviors required by `PROMPT.md`: reads, absolute/relative/qualitative levels, mutes, explicit FX engine state, source routes, family-inferred named lists and multi-destination composition, grouped operations, normalized values, DCA, X32 matrices, channel-to-AUX output, ramps/fades/delays, automation status/cancel, multi-action sequences, explicit anaphora, speaker context, capability rejection, and fail-closed ambiguity handling. Critical cases also assert the exact planned/executed operation, and safety cases assert that no side effect occurred.

For a Raspberry Pi live recipe, update/build the MCP first:

```bash
cd /home/pi/XMSeries-MCP && git pull && npm ci && npm run build
```

Then update and start LiveStageAssistant with the Raspberry offline profile:

```bash
cd /home/pi/LiveStageAssistant && git pull && .venv/bin/python -m voice_assistant.runtime --env-file raspi_service_pack_stdio/.env.offline
```

The WebGUI text composer and backend voice path feed the same Local deterministic command gateway. Commands typed in the chat therefore exercise the same parser and MCP execution path as spoken commands, except that speaker-context cases require a speaker profile to be selected/recognized.

For the current 16-channel / 4-bus Raspberry profile, startup should report the configured OSC limits (16 channels, 4 buses, 4 FX returns/slots, 4 DCA groups). If the log reports larger defaults, fix the active `.env`/MCP profile before testing names.

Recommended live acceptance order:

1. **Identity/read-only first:** `statut mixeur`, `niveau de Batterie`, `état du mute de Batterie`, `Hall FX est-il actif ?`, `quel est le nom de la voie 6 ?`.
2. **Single-target writes:** `mets Batterie à -30 dB`, `monte Batterie de 3 dB`, `baisse un peu Batterie`, `mute Batterie`, `rallume Batterie`.
3. **Main aliases/value semantics:** `mets la façade à -10 dB`, `monte le volume`, `mets Batterie sur -5 dB`. The last command must change the Batterie fader; `-5 dB` must never be treated as a destination.
4. **Named routing:** `niveau de Batterie sur Anthony`, `mets Batterie sur Anthony à -20 dB`, `monte Batterie sur Anthony de 3 dB`, `mets la guitare de anto sur Claude à -5 dB`.
5. **Grouped operations:** `mute les voies Voix et Batterie`, `mute toutes les voies sauf Voix`, `mute les bus Anthony et Laurent`, `coupe tous les bus sauf Anthony`, `mets Batterie à -20 dB sur les bus Anthony et Laurent`, `mets Batterie à -25 dB sur tous les bus et façade`.
6. **Automation:** `baisse progressivement Batterie à -30 dB en 2 secondes`, `fade out Batterie en 5 secondes`, `mets Batterie à -27 dB dans 2 secondes`, `dans 3 secondes baisse progressivement Batterie à -30 dB en 2 secondes`, `statut des automations`, then `annule la dernière automation` while a job is running.
7. **Sequences/anaphora:** `baisse la façade puis remonte-la après 5 secondes`, `mute Batterie puis dans 2 secondes unmute Batterie`, `mets Batterie à -20 dB puis baisse progressivement Batterie à -30 dB en 2 secondes puis mute Batterie`. Cross-turn: send `baisse Voix`, then `remonte-la`; send `mets Batterie sur Anthony à -12 dB`, then `mets Voix sur le même retour à -8 dB`.
8. **DCA / X32-only areas:** if the mixer has the names used by the test, `mets Band à -6 dB`, `mute Band`, `baisse progressivement Band à -20 dB en 2 secondes`. On X32/M32 also test `mets Matrix Vox à -12 dB`, `mute Matrix Vox`, and `mets Batterie sur sortie aux 2 à 50%`.
9. **Safety/fail-closed:** `mute Introuvable` must request clarification; an ambiguous name must not execute; `mute Batterie puis mute Introuvable` must not execute the first step; a fuzzy-only target must not authorize a write.
10. **Speaker context:** select/recognize a configured speaker in the WebGUI, then test `monte mon retour de 3 dB`, `mets mon micro à -12 dB`, and `mets Batterie dans mon retour à -20 dB`.

Protocol-specific expected behavior:

- **OSCXR:** channel/bus/Main/FX/aux mapped level operations, reads, ramps, fades, delays and sequences are valid. CI also directly verifies that unsupported route-mutes, matrices and channel-to-AUX-output calls throw before any OSC write. Bus-specific source mute such as `mute Batterie sur Anthony` is expected to return an explicit unsupported error; it must never mute Batterie globally. Matrix controls and X32 channel-to-AUX-output commands are also expected to report unsupported.
- **X32/M32:** route mutes, matrices and channel-to-AUX-output commands are expected to execute normally when the resolved targets exist.
- A clarification or explicit unsupported response is a valid safe outcome where documented. `Commande non reconnue.` is not a valid substitute for mixer/protocol/configuration failures.

The JSON corpus remains the exhaustive machine-readable checklist. When adding a new user-facing deterministic command to the README or `PROMPT.md`, add a matching acceptance case to `corpus/local-functional-recipe.fr.json` so documentation and parser coverage cannot drift.

Important syntax rules:

- **`à` means an absolute target**: `mets batterie à -30 dB`. Directional verbs do not change that meaning: `monte batterie à -8 dB` and `baisse batterie sur Anthony à -20 dB` are still absolute writes. With no named target, `mets/monte/baisse le volume à 100%` targets Main LR.
- **`de` means a relative change**: `monte batterie de 3 dB`. With no named target, `monte le volume de 10%` adjusts Main LR relatively.
- Qualitative commands (`monte`, `baisse`, `un peu`, `beaucoup`) use the same adaptive relative-level calculation as the cloud `osc_adjust_level` tool. They are not separate hard-coded Local dB steps. The same rule applies to progressive ramps: XMSeries-MCP previews the adaptive target from the current level, then starts the ramp toward that target without an intermediate write.
- **`en N secondes` means ramp duration**: the level moves progressively for that duration. Temporal constituents may appear in different grammatical positions as long as the semantic markers remain explicit.
- **`dans N secondes` means delayed execution**: the requested one-shot action stays pending until the delay expires. This applies to level writes, single-target mute/unmute, and source→bus mute/unmute. `dans` is never reinterpreted as a ramp duration. For route mutes the parser binds the source and bus first, then the delay, so `mute Batterie sur Anthony dans 5 secondes` and `dans 5 secondes, mute Batterie sur Anthony` are equivalent.
- Percent values use the normalized fader range. An absolute `100%` means the top of the normalized fader range; a relative `+10%` means ten percentage points on that normalized range.
- Explicit normalized values use `niveau 0.0..1.0` / `level 0.0..1.0`, for example `mets Batterie au niveau 0.75`. This explicit wording prevents a unitless dB-looking number from being reinterpreted as a normalized fader value.
- Multi-action phrases separated by `puis`, `ensuite`, `et puis`, `et ensuite`, or `then` are resolved completely before one MCP-owned automation starts. `après N secondes` adds a wait between steps. If any step is ambiguous, the whole sequence remains fail-closed.
- Cross-turn context is never inherited implicitly. Explicit anaphora such as `remonte-la`, `même cible`, `même bus`, `sur le même retour`, `lui`, or `elle` may refer to the preceding deterministic command.
- `fade in` / `fade out` without an explicit target defaults to **Main LR / façade**.
- Main aliases currently include `main`, `main lr`, `lr`, `façade`, `front`, `principal`, `master`, `master lr`, and `mix principal`. `son` is accepted as an explicit synonym for `volume`/`niveau` in level phrases such as `monte le son` or `mets le son à -10 dB`.
- Source-to-destination syntax supports **channel / FX return / aux return -> bus** for reads and writes. The source and destination are resolved independently and must each be safe and unique. Examples: `niveau de Batterie sur Anthony`, `monte batterie sur Anthony`, `mets Hall FX sur Anthony à -18 dB`, `baisse un peu Playback dans Anthony`. Route reads are strictly read-only. Route mute/unmute such as `mute Batterie sur Anthony` is a distinct send operation and never degrades into whole-source mute. Qualitative route commands use the same adaptive `osc_adjust_level` semantics as cloud tools; a source name such as `Basse` remains a source candidate in `monte Basse sur Anthony`, not a contradictory direction.
- If a name is ambiguous or only fuzzy-matches, the gateway asks for clarification rather than guessing.
- French STT robustness: `montre Batterie` and `montre le volume` are accepted as likely `monte` transcriptions in mixer-level command shapes. Explicit display/read forms such as `montre-moi le niveau de Batterie`, `affiche le niveau de Batterie sur Anthony`, or `où est le fader ?` are parsed as read-only intents and are never rewritten into writes.
- DCA fader, mute and level automation are part of the deterministic Local write surface. Matrix fader/mute/automation are supported for X32/M32 and remain explicitly unsupported on OSCXR.
- Group/bulk natural-language commands are supported for bus-master mute/unmute and channel-send dB writes to selected/all buses, including an explicit Main LR/façade inclusion.
- Speaker-context defaults are supported for first-person phrases when the host supplies recognized-speaker context. XMSeries-MCP remains responsible for mapping the speaker through `XMS_SPEAKER_MAP` / `osc_get_speaker_context`. An explicit mapped `bus` means that bus; an explicitly mapped speaker without a bus means Main LR/façade; an unmapped speaker is unresolved and must clarify.
- Canonical first-person examples: `monte mon retour de 3 dB`, `mets mon micro à -12 dB`, `mets batterie dans mon retour à -20 dB`. For a Main-destination speaker, `mon retour` controls Main LR and `batterie dans mon retour` controls Batterie’s Main LR fader path rather than inventing a bus. `mute mon retour` therefore mutes Main LR, but `mute batterie dans mon retour` is intentionally refused because no dedicated source→Main send mute exists and broadening it to whole-source mute would be unsafe. If the speaker is unknown or a required input channel mapping is unavailable, the Local parser asks for clarification instead of guessing.

The deterministic grammar is not intended to accept arbitrary prose. For temporal commands it is deliberately **flexible on constituent order but strict on semantic markers**. For example, `baisse progressivement batterie à -30 dB en 2 secondes`, `baisse progressivement en 2 secondes batterie à -30 dB`, `en 2 secondes baisse progressivement batterie à -30 dB`, and `batterie à -30 dB baisse progressivement en 2 secondes` resolve to the same ramp plan. A bare `-30 dB` without `à`/`de` remains unsupported rather than guessed. If a phrase is not documented and is not covered by parser tests, treat it as unsupported rather than assuming the parser will infer the intent.

The canonical regression source is `corpus/local-commands.fr.json`. CI executes every corpus phrase through the real deterministic gateway with a fake mixer adapter via `test-local-corpus.mjs`. When adding or changing Local syntax, update this corpus together with the parser, tool-side semantics, tests and this README.

### Functional acceptance recipe

The milestone-level acceptance source is `corpus/local-functional-recipe.fr.json`. It is intentionally smaller than the grammatical regression corpus: it contains one or more canonical commands for **every distinct user-facing intent family** documented here and in `PROMPT.md`. CI runs it through `test-local-recipe.mjs`, including execution against a fake mixer adapter.

Run both deterministic suites locally with:

```bash
npm run test:local-gateway
npm run test:local-recipe
```

For a live rack test, type the recipe utterances from `corpus/local-functional-recipe.fr.json` into LSA. Observe each `liveNote`: on OSCXR, bus-specific source mute, matrices and channel-to-AUX-output are expected to report **unsupported** at execution and must never broaden into a different operation. The same recipe can be run against X32/M32 to validate those operations positively.

The recipe covers status/reads, Main/channel/bus/FX/aux/DCA/matrix levels and mutes, dB/percent/normalized values, source-to-bus routing, structured ownership names, grouped operations, AUX outputs, ramps/fades/delays, multi-action sequences, automation list/cancel, speaker context, explicit anaphora, ambiguity and unknown-target fail-closed behavior. The larger grammar corpus covers additional word-order and synonym permutations.

### Cloud/LLM mode versus deterministic parsing

In normal MCP/LLM mode, the model selects typed tools such as `osc_channel_fader`, `osc_channel_send_to_bus`, or `osc_automation_ramp`.

In deterministic Local mode, the client only calls `lsa_local_analyze_command` and `lsa_local_execute_command`. The parser in XMSeries-MCP converts the phrase into a typed internal intent and directly reuses the existing resolver/OSC/automation implementation. No LLM chooses the underlying mixer operation.

