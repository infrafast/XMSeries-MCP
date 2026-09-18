# XMSeries-MCP Roadmap

This file records possible future improvements. Items here are proposals only and do not describe current runtime behavior unless explicitly marked as implemented.

## Speaker-context default destination

Possible improvement for `XMS_SPEAKER_MAP` and `osc_get_speaker_context`:

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

Status: **shared core available; QLCPlus OR4B1 merged and CI-validated; XMSeries OR4B2 next**

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

- [ ] register reserved `lsa_local_analyze_command` / `lsa_local_execute_command` tools only when the Local gateway flag is enabled;
- [ ] advertise/return protocol `lsa-command-gateway/v1`;
- [ ] analysis is strictly side-effect-free;
- [ ] use a short-lived opaque one-shot plan token for execution;
- [ ] classify each plan as `read` or `write`;
- [ ] return localized deterministic `responseText` for clarification, success and failure;
- [ ] reject unsupported protocol/core versions instead of degrading to a guessed write.

### XDG1 — Basic mixer grammar MVP

- [ ] reuse existing live resolver and protocol-aware OSC helpers; do not create a parallel target database;
- [ ] mixer status;
- [ ] named-target level read;
- [ ] absolute level write;
- [ ] relative level up/down;
- [ ] mute / unmute;
- [ ] bare-name targets resolve globally across the existing families exactly as today;
- [ ] ambiguous exact/contains and fuzzy-only matches require clarification and never create an executable write token;
- [ ] Main LR default remains a mixer-domain decision here, never in LSA;
- [ ] plan execution revalidates target/state as needed before dispatch.

### XDG2 — Advanced semantic parity

Implement incrementally after XDG1 live acceptance:

- [ ] source -> destination sends and ownership phrases;
- [ ] dB and percent, absolute and relative values;
- [ ] grouped/bulk operations;
- [ ] speaker-context defaults;
- [ ] fades/ramps and delayed actions through the existing MCP-side automation engine;
- [ ] automation status/cancel;
- [ ] preserve level vs mute semantics and all protocol-specific unsupported-operation guards.

### XDG3 — Regression corpus and cloud/local drift control

- [ ] maintain a deterministic command corpus in-repo covering French first, then supported English equivalents;
- [ ] include STT-like case/punctuation variants without introducing unconstrained fuzzy NLP;
- [ ] every corpus item asserts recognition, clarification vs executable outcome, resolved target/effect and generated plan;
- [ ] review `PROMPT.md` semantics against the same corpus whenever command semantics change so cloud-agent guidance and Local deterministic behavior do not silently diverge;
- [ ] keep gateway-disabled tool inventory identical to the pre-OR4 cloud/ordinary MCP behavior.

### XDG4 — Pi acceptance

- [ ] LiveStageAssistant Local STDIO integration;
- [ ] one controlled read + mute/unmute + absolute/relative level write;
- [ ] ambiguity/confirmation and stale-plan tests;
- [ ] fade/delay acceptance after XDG2;
- [ ] target deterministic parser/plan overhead <100 ms typical on Pi5, excluding mixer network I/O;
- [ ] verify no LLM process or inference dependency is started by the gateway.
