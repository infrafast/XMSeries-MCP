# XMSeries-MCP Roadmap

This file records possible future improvements. Items here are proposals only and do not describe current runtime behavior unless explicitly marked as implemented.

## Speaker-context default destination

Implemented semantics for `XMS_SPEAKER_MAP` and `osc_get_speaker_context`:

- If a recognized speaker has an explicit `bus` in `XMS_SPEAKER_MAP`, use that bus as the speaker's personal monitor/return destination.
- If the speaker is explicitly present in `XMS_SPEAKER_MAP` but has no `bus`, treat the speaker's default monitor/return destination as Main LR / façade rather than inferring a bus from the speaker name.
- If the recognized speaker is absent from `XMS_SPEAKER_MAP`, keep the context unresolved and require clarification instead of guessing a destination.
- Model the destination explicitly as `bus` or `main` rather than using a synthetic bus name such as `main`.
- Route source-level commands according to the destination type: source-to-bus commands use channel/FX/aux sends; source-to-Main commands use the source's own Main LR fader path.
- Route monitor-master commands according to the destination type: a bus destination controls the bus master; a Main destination controls the Main LR fader.
- Keep mute semantics conservative, especially for source-to-Main requests, so a missing dedicated Main-send mute cannot silently broaden into a whole-source mute.

Example intended future configuration semantics:

```json
{
  "laurent": {
    "bus": "Laurent",
    "channel": "Guitar-loran"
  },
  "thomas": {
    "channel": "retour-tom"
  }
}
```

Under this proposal, Laurent's default return is bus `Laurent`, while Thomas's default return is Main LR / façade.


## Deterministic Local Command Gateway — coordinated with LiveStageAssistant OR4

Status: **OR4B2 merged on `main` as `0256b3d66dcdf6594f25e8aa0b6fe7ecec07bfed`; PR and post-merge Node 20.20/22 CI validated; Pi/LSA live read/write acceptance passed**

Product boundary:

- the existing MCP low-level OSC tools and `PROMPT.md` remain the cloud/LLM interface and must not change behavior;
- the deterministic gateway is an additional **Local-engine-only** capability;
- the gateway is disabled by default and must be enabled explicitly for a Local LiveStageAssistant session/instance;
- no LLM, embedding model or external inference service is added to XMSeries-MCP.

Shared dependency:

- consume the versioned `@infrafast/stage-command-core` package; QLCPlus-MCP has merged the first OR4B1 vertical slice with automated CI green, while Pi/LSA live acceptance remains pending;
- pin an exact compatible version/commit in `package-lock.json`;
- shared code owns only tokenizer/matcher primitives, raw+normalized spans, generic value/duration extraction, gateway wire types, clarification/plan-token lifecycle and corpus helpers;
- mixer actions, synonyms, target families, name resolution, dB semantics, routing and OSC remain XMSeries-MCP-owned.

### XDG0 — Gateway adapter and safety skeleton

- [x] register reserved `lsa_local_analyze_command` / `lsa_local_execute_command` tools only when the Local gateway flag is enabled;
- [x] advertise/return protocol `lsa-command-gateway/v1`;
- [x] analysis is strictly side-effect-free;
- [x] use a short-lived opaque one-shot write plan token for execution;
- [x] classify each plan as `read` or `write`;
- [x] return localized deterministic `responseText` for clarification, success and failure;
- [ ] reject unsupported protocol/core versions instead of degrading to a guessed write.

### XDG1 — Basic mixer grammar MVP

- [x] reuse existing live resolver and protocol-aware OSC helpers; no parallel target database;
- [x] mixer status;
- [x] named-target level read;
- [x] absolute dB level write;
- [x] relative level up/down, including qualitative little/normal/much steps;
- [x] mute / unmute;
- [x] bare-name targets resolve globally through the existing resolver exactly as today;
- [x] ambiguous contains/structured and fuzzy-only matches require clarification and never create an executable write token;
- [x] Main LR/façade aliases remain a mixer-domain decision here, never in LSA;
- [x] plan execution re-resolves target identity before write dispatch and fails stale changes closed.

### XDG2 — Advanced semantic parity

Implement incrementally after XDG1 live acceptance.

OR4B4 PR #12 merged on `main` as `968c94f69d4bd007191fff1762101707a94c70b5`. PR CI is green on Node 20.20 and 22. This first advanced deterministic Local slice deliberately reuses the existing live resolver, send paths and `AutomationEngine`; no OSC or automation protocol logic is duplicated in the Local parser. Single-target percent, fade/ramp, delay and automation-control paths have since passed live Pi acceptance; route/bulk/speaker-context live gates are tracked separately below.

- [~] source -> destination bus sends: Local route parsing supports channel, FX return and aux return sources to a bus for absolute, explicit-relative, qualitative, mute/unmute, ramp and delayed semantics, reusing the corresponding cloud/OSC primitives and adaptive `osc_adjust_level` behavior. Route mute remains protocol-aware through the existing OSC helpers; live route acceptance remains pending;
- [~] dB and percent, absolute and relative values: explicit values are implemented for single targets and channel-to-bus sends; relative percent is defined deterministically as percentage points on normalized fader level. Directional verbs plus `à`/`to` now preserve absolute semantics for target and source-to-bus writes. The qualitative-parity slice also routes `monte`/`baisse`/`un peu`/`beaucoup` through the same adaptive `osc_adjust_level` semantics used by cloud tools, including targetless Main LR phrases; live acceptance of the newer grammar remains pending;
- [~] grouped/bulk operations: PR #14 merged as `f98d9ac0c09b9a98a61bde8b574a86aef7ece0ac` with Node 20.20/22 CI green, adding deterministic Local parity for selected/all/all-except bus mute and channel-send dB writes to selected/all buses, including explicit Main LR inclusion; live Pi acceptance pending;
- [~] speaker-context defaults: XMSeries-MCP owns `XMS_SPEAKER_MAP` semantics for first-person monitor/input phrases while the host transports only generic `context.speaker`. The explicit-destination slice models monitor destination as bus or Main LR: mapped bus -> bus, mapped speaker without bus -> Main, unmapped speaker -> unresolved. Live Pi acceptance remains pending;
- [~] fades/ramps and delayed actions through the existing MCP-side automation engine: absolute/explicit-relative ramps, fades, delayed changes and source-to-bus ramps are implemented. The qualitative-ramp parity slice also previews the same adaptive `osc_adjust_level` target for `monte/baisse [un peu/beaucoup] progressivement` before starting the ramp, including source-to-bus ramps. Live Pi validation already confirms a real progressive absolute fade and delayed action; qualitative/source-to-bus ramp acceptance remains pending;
- [x] automation status/cancel through Local natural commands: PR #13 merged as `43aa59c79b8424993d20339610c40309cdd2117f` with Node 20.20/22 CI green; live Pi acceptance confirmed that a long fade could be listed as running, cancelled via `annule la dernière automation`, and the channel then restored to -27 dB;
- [x] preserve level vs mute semantics and all protocol-specific unsupported-operation guards by delegating execution to existing resolver/OSC/automation adapters.

Temporal grammar in this slice is explicit: `en N secondes` is ramp duration; `dans N secondes` is delay before an action. The flexible-slot parser accepts equivalent constituent reorderings while preserving those markers strictly; unbound level literals are rejected rather than guessed. Fade-in/out without an explicit target defaults to Main LR/façade.

### XDG3 — Regression corpus and cloud/local drift control

- [x] maintain a deterministic command corpus in-repo covering French first: `corpus/local-commands.fr.json` is executed in CI by `test-local-corpus.mjs`; English expansion remains incremental;
- [~] include STT-like case/punctuation variants without introducing unconstrained fuzzy NLP: canonical French cases now include safe `montre`→`monte` correction plus `plus fort` / `moins fort` qualitative aliases, with explicit display/read forms kept fail-closed; broader variants remain incremental;
- [x] every current corpus item asserts status/effect and, for executable plans, the concrete fake-adapter operation/target produced by execution;
- [x] review `PROMPT.md` semantics against the same corpus whenever command semantics change: this is now part of the repository capability-symmetry rule in `AGENTS.md`;
- [x] keep gateway-disabled tool inventory identical to the pre-OR4 cloud/ordinary MCP behavior.

### XDG4 — Pi acceptance

- [x] LiveStageAssistant Local STDIO integration;
- [x] one controlled read + mute/unmute + absolute/relative level write;
- [ ] ambiguity/confirmation and stale-plan tests;
- [x] fade/delay acceptance after XDG2;
- [x] target deterministic parser/plan overhead <100 ms typical on Pi5, excluding mixer network I/O;
- [ ] verify no LLM process or inference dependency is started by the gateway.


## Cross-repository OR4B3 status

LiveStageAssistant OR4B3 is merged into `realtime-voice-architecture` as `e244af4a2f5d474005ff6803c5818aa25f4f87aa`. The dedicated non-LLM Local engine and generic `lsa-command-gateway/v1` orchestrator passed PR CI on Python 3.11/3.12; post-merge CI is running. Pi end-to-end acceptance remains pending.


### OR4C shared-core alignment

QLCPlus-MCP PR #8 merged as `b46f0c5d9aa859281976bec48090dd9a8f0bfffe`. QLCPlus-MCP and XMSeries-MCP now both pin `stage-command-core@fa9f8baef06a668efb18b1bfc50060335689f287`; QLC PR and post-merge Node 20.20/22 CI are green. Both gateways remain on `lsa-command-gateway/v1`.


## OR4C live acceptance readiness

LiveStageAssistant now includes the domain-neutral Raspberry Pi/rack acceptance harness, merged into `realtime-voice-architecture` as `63019ba4089b7b9c6d06ac5b307914fca8645a5e`. PR and post-merge Python 3.11/3.12 CI are green. The harness exercises `lsa-command-gateway/v1`, records per-command latency evidence, blocks live writes unless explicitly enabled, and checks for newly spawned known local-LLM processes. Real Raspberry Pi/rack read-path acceptance was completed on 18 September 2026. LiveStageAssistant discovered the XMSeries `mixer` gateway under `lsa-command-gateway/v1`; `statut mixeur` analyzed and executed successfully as a read. The complete 4-case cross-repo corpus passed with analysis p50 3.0 ms / p95 6.4 ms and total p50 5.9 ms / p95 11.7 ms. Controlled mixer writes were live-validated on 18 September 2026 using channel `batterie`: `mute batterie`, `unmute batterie`, `mets le niveau de batterie à -30 dB`, and `monte batterie de 3 dB` all executed successfully. The operator confirmed the visible mixer state, including final level `-27 dB`. The run measured analysis p50 10.0 ms / p95 12.8 ms and total p50 78.8 ms / p95 84.1 ms. XDG1 is therefore live-accepted and XDG2/OR4B4 advanced semantics are unlocked.
