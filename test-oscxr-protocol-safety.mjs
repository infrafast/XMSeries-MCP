import assert from "node:assert/strict";
import { OSCClient } from "./dist/osc-client.js";

const xr = new OSCClient("127.0.0.1", 9, "OSCXR", {
    channelCount: 16,
    busCount: 4,
    fxCount: 4,
    dcaCount: 4,
});

async function expectUnsupported(label, action) {
    await assert.rejects(
        action,
        (error) => {
            assert.match(String(error?.message || error), /Unsupported for OSCXR/i, label);
            return true;
        },
        label,
    );
}

await expectUnsupported(
    "channel-to-bus mute must never widen to whole-channel mute",
    xr.muteChannelToBus(1, 1, true),
);
await expectUnsupported(
    "FX-return-to-bus mute must never widen to whole-FX mute",
    xr.muteFxToBus(1, 1, true),
);
await expectUnsupported(
    "aux-return-to-bus mute must never widen to whole-aux mute",
    xr.muteAuxToBus(1, 1, true),
);
await expectUnsupported(
    "XR channel-to-AUX output is unsupported",
    xr.sendToAux(1, 1, 0.5),
);
await expectUnsupported(
    "XR matrix fader is unsupported",
    xr.setMatrixFader(1, 0.5),
);
await expectUnsupported(
    "XR matrix mute is unsupported",
    xr.muteMatrix(1, true),
);

console.log("OSCXR protocol safety guards passed.");
