import assert from "node:assert/strict";
import {
    parseSpeakerMap,
    resolveSpeakerMixerContext,
} from "./dist/speaker-context.js";

{
    const mappings = parseSpeakerMap(JSON.stringify({
        laurent: { bus: "Laurent", channel: "Guitar-loran" },
        thomas: { channel: "retour-tom" },
        disabled: { bus: "Nope", enabled: false },
    }));

    const laurent = resolveSpeakerMixerContext("Laurent", mappings);
    assert.equal(laurent.known, true);
    assert.deepEqual(laurent.monitorDestination, { kind: "bus", name: "Laurent" });
    assert.equal(laurent.busName, "Laurent");
    assert.equal(laurent.channelName, "Guitar-loran");

    const thomas = resolveSpeakerMixerContext("Thomas", mappings);
    assert.equal(thomas.known, true);
    assert.deepEqual(thomas.monitorDestination, { kind: "main" });
    assert.equal(thomas.busName, null);
    assert.equal(thomas.channelName, "retour-tom");

    const absent = resolveSpeakerMixerContext("Marie", mappings);
    assert.equal(absent.known, false);
    assert.equal(absent.monitorDestination, null);
    assert.equal(absent.source, "unmapped-speaker");

    const disabled = resolveSpeakerMixerContext("disabled", mappings);
    assert.equal(disabled.known, false);
    assert.equal(disabled.monitorDestination, null);
}

assert.throws(
    () => parseSpeakerMap("[]"),
    /must be a JSON object/,
);

console.log("speaker context semantics checks passed");
