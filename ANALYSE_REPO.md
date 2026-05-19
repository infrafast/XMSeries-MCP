# Repository Analysis & Implementation Notes for Multi-Protocol Support (OSCX32M32 + OSCXR)

## 1) Scope of this analysis

This document summarizes:

1. The current repository architecture and responsibilities.
2. How OSC addressing is currently implemented.
3. The implemented third runtime parameter (`protocol`) in addition to mixer IP/port.
4. Expected impacts to command addressing and method signatures, especially where X32/M32 and XAir (XR) differ in path format and argument arity.

Target behavior:
- Existing mode: `OSCX32M32` (X32/M32-compatible addresses).
- Partial mode: `OSCXR` (XAir-compatible addresses), as described in `PROTOCOL.md`.

---

## 2) Current repository structure (high-level)

- **`src/index.ts`**: MCP server entry point, tool definitions, and handler switch/case dispatch to OSC client methods.
- **`src/osc-client.ts`**: Core OSC transport + all mixer read/write methods and path construction.
- **`PROTOCOL.md`**: Side-by-side protocol mapping between `{ OSCXR, OSCX32M32 }` with command string templates.
- **Docs** (`README.md`, `INSTALLATION.md`, `QUICKSTART.md`, `TESTING.md`): setup now documents host, port, and optional protocol selection.

The stdio MCP entry point now reads `OSC_PROTOCOL` from the environment and passes it into `OSCClient`. If omitted, the server defaults to `OSCX32M32`.

---

## 3) Current behavior relevant to protocol support

### 3.1 Runtime configuration model

`src/index.ts` currently reads:
- `OSC_HOST`
- `OSC_PORT`
- `OSC_PROTOCOL`

and constructs:

```ts
const OSC_PROTOCOL = parseOscProtocol(process.env.OSC_PROTOCOL);
const osc = new OSCClient(OSC_HOST, OSC_PORT, OSC_PROTOCOL);
```

`OSC_PROTOCOL` accepts `OSCX32M32` or `OSCXR`. Invalid values fail at startup with an explicit error.

### 3.2 Where protocol-specific assumptions already exist

`src/osc-client.ts` currently hardcodes many X32-style/X32-compatible addresses, e.g.:
- Main stereo: `/main/st/...`
- FX returns: `/fxrtn/...`
- Sends: `/ch/XX/mix/YY/level`

Example you highlighted:
- `muteMain()` currently writes `/main/st/mix/on`.
- In `PROTOCOL.md`, `MAINMUTECOMMAND_STRING` maps XR as `/lr/mix/on` and X32/M32 as `/main/st/mix/on`.

This confirms a direct path mismatch requiring protocol-aware resolution.

### 3.3 Methods likely to break or behave inconsistently on XR

From `PROTOCOL.md`, differences are not limited to path names; some include formatting and dimensionality changes, such as:

- **Main LR path family**
  - XR: `/lr/...`
  - X32/M32: `/main/st/...`

- **FX return path family**
  - XR: `/rtn/%i/...`
  - X32/M32: `/fxrtn/%02d/...`

- **Aux return path family**
  - XR: `/rtn/aux/...`
  - X32/M32: `/auxin/%02d/...`

- **Headamp/trim**
  - XR: `/headamp/%02d/gain`
  - X32/M32: `/ch/%02d/preamp/trim`

- **Meter endpoint**
  - XR: `/meters/0`
  - X32/M32: `/meters/6`

- **Command arity differences** (important)
  - Example patterns in `PROTOCOL.md` show some XR commands are single-target while X32 variants include an extra index (e.g., bus-specific forms like `/.../mix/%02d/...`).

This can impact `getXXXX`/`setXXXX` APIs where method signatures currently assume one canonical parameter set.

---

## 4) Impact analysis by code area

### 4.1 `src/index.ts` impact

- Environment/config parsing for `OSC_PROTOCOL` is implemented in `src/index.ts`.
- Accepted values are validated (`OSCX32M32`, `OSCXR`) and default safely to current behavior.
- The selected protocol is passed into the `OSCClient` constructor.
- The selected protocol is exposed in server startup logs and mixer status/diagnostics outputs.

### 4.2 `src/osc-client.ts` impact

This file will be the primary change surface.

Current implementation status:
- Protocol-aware path helpers are implemented for main LR, bus, aux return, FX return, headamp, and scenes.
- `OSCX32M32` remains the complete/default mode.
- `OSCXR` is effective for these mapped command families: channel fader/mute/name, EQ gain/on, channel sends to bus level, bus fader/mute/name, main LR, FX return, aux return, DCA, headamp gain, and scenes.
- Features not mapped for XR now fail fast with `Unsupported for OSCXR: ...` rather than waiting for OSC timeouts.

#### A) Path construction layer

Current methods embed literal strings inline. For multi-protocol support, these should be routed through a centralized resolver:
- Either a `ProtocolMap` object with template functions.
- Or helper methods by command category (main, fx return, aux return, headamp, meters, etc.).

Without centralization, the risk of partial migration is high because there are many scattered path literals.

#### B) Signature/arity adaptation

Some methods may need protocol-specific parameter handling. Two non-mutually-exclusive patterns:

1. **Normalize at API level** (preferred):
   - Keep MCP tool schema stable where possible.
   - Client adapter internally translates to per-protocol path and parameter requirements.

2. **Expose protocol-specific variants** (fallback):
   - Only for commands where behavior cannot be losslessly unified.

Given your note (some commands use 2 params on X32 vs 1 on XR), `sendToBus`/`getSendToBus`-like methods and related set/get functions should be explicitly reviewed for argument model differences.

#### C) Read aggregation methods

Bulk readers (`getMainStrip`, `getConsoleOverview`, routing helpers, FX helpers) currently assume X32 path families. They will need to derive paths from protocol-aware helpers, otherwise these high-level tools may silently fail on XR even if simple set/get tools work.

### 4.3 Tool surface compatibility (`src/index.ts` schemas)

The tool catalog is extensive and currently X32-centric in description and assumptions. For protocol extension:

- Keep schemas unchanged where the conceptual operation is mixer-agnostic (mute main, set fader, get channel name, etc.).
- Add validation or documented limitations when a command has no XR equivalent.
- Introduce protocol-gated behavior in handlers to return clear errors for unsupported operations rather than timeouts.

### 4.4 Documentation impact

Docs now include `OSC_PROTOCOL` in the main stdio configuration examples and describe accepted values/default behavior.

Updated files:
- `README.md`
- `INSTALLATION.md`
- `QUICKSTART.md`
- `TESTING.md`
- `AGENTS.md`

They now include:
- `OSC_PROTOCOL` variable,
- accepted values,
- examples/defaults for stdio MCP configuration.

Remaining documentation work for the broader multi-protocol effort:
- add a compatibility matrix (supported/partial/not supported by protocol),
- document individual tool limitations where XR behavior still differs.

Initial XR limitations are now documented in the setup guides. A more detailed per-tool matrix is still recommended.

---

## 5) Focused pre-analysis of protocol differences from `PROTOCOL.md`

Below are key mismatch classes observed in the provided mapping file.

1. **Main bus namespace mismatch**
   - XR uses `/lr/...` while X32/M32 uses `/main/st/...`.
   - Affects: main mute/fader/pan/config/dyn/eq reads/writes and aggregate strip reads.

2. **FX return namespace mismatch + indexing format**
   - XR uses `/rtn/%i/...`; X32/M32 uses `/fxrtn/%02d/...` (and some bus-targeted variants).
   - Affects FX mute/get-on and any send-targeted FX operations.

3. **Aux return namespace and arity mismatch**
   - XR includes singleton auxiliary return forms (`/rtn/aux/...`).
   - X32/M32 forms include indexed aux-in variants (`/auxin/%02d/...`) and indexed bus variants.
   - This is one of the highest-risk areas for methods expecting two indices.

4. **Gain/preamp path mismatch**
   - XR uses headamp gain path; X32/M32 points to channel preamp trim in mapping.
   - Affects preamp-oriented tools and may affect semantic naming (gain vs trim).

5. **Meter endpoint mismatch**
   - Different `/meters/*` endpoint root values indicate metric collection behavior divergence.

6. **Snapshot/USB/system action differences**
   - Several management paths differ materially (e.g., snapshot and USB browser commands).
   - Commands currently implemented around scene handling must be reviewed against XR mapping.

---

## 6) Risk assessment

### High risk
- Hardcoded X32 paths in aggregate reads (`getMainStrip`, `getConsoleOverview`, FX return status, etc.).
- Commands whose path includes variable segment count or different indexing semantics between protocols.
- Silent OSC failures caused by valid-looking but non-existent addresses.

### Medium risk
- Type-tag mismatches when protocol-specific endpoints expect differing numeric types (int/float) in edge cases.
- Tool descriptions that imply features unavailable on XR.

### Low risk
- Generic channel operations where paths are identical between protocols (many `/ch/%02d/...` commands).

---

## 7) Recommended implementation strategy (pre-change plan)

1. **Introduce protocol enum + constructor parameter**
   - `type OSCProtocol = "OSCX32M32" | "OSCXR"`.
   - Parse from `process.env.OSC_PROTOCOL` in `src/index.ts`. **Done for the stdio server.**

2. **Centralize command path generation**
   - Create a protocol mapping layer (object or helper methods) in `OSCClient`.
   - Replace inline literals for all protocol-divergent commands.
   - **Partially done** for paths covered by `PROTOCOL.md`.

3. **Normalize method interfaces where possible**
   - Keep MCP tool contracts stable.
   - Internally adapt to 1-index/2-index command forms by protocol.

4. **Add capability guards**
   - Where no XR equivalent exists, return explicit “unsupported for OSCXR” errors. **Done for known X32-only/not-yet-mapped calls.**

5. **Migrate high-value command families first**
   - Main bus (`/lr` vs `/main/st`)
   - FX return (`/rtn` vs `/fxrtn`)
   - Aux return (`/rtn/aux` vs `/auxin`)
   - Preamp/gain path

6. **Regression checklist**
   - Build passes.
   - Static checks for remaining hardcoded protocol-specific literals.
   - Runtime smoke tests in both protocol modes.

---

## 8) Suggested acceptance criteria for the upcoming implementation phase

- Config supports `OSC_PROTOCOL` with default preserving current behavior.
- `muteMain`, `setMainFader`, `getMainFader`, and `getMainStrip` resolve correct main namespace per protocol.
- At least one representative command each for FX return and aux return works in both modes.
- All mismatched commands identified from `PROTOCOL.md` are either:
  - implemented with protocol mapping, or
  - explicitly documented as not supported for one mode.
- Documentation updated with protocol parameter and initial XR support notes; detailed compatibility matrix still pending.

---

## 9) Conclusion

The repository is currently structured well for extension (single OSC client abstraction + MCP tool layer), but it is still effectively single-protocol in implementation because many OSC paths are hardcoded to X32-style conventions.

`OSCXR` is now partially effective through protocol-aware path helpers and explicit unsupported guards. Further work should continue through the same centralized mapping approach, because the remaining challenge is not just path renaming, but harmonizing method semantics where one protocol uses an extra index and the other does not.
