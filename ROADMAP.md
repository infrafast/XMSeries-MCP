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
