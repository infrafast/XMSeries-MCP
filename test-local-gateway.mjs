import assert from "node:assert/strict";
import { GATEWAY_PROTOCOL } from "@infrafast/stage-command-core";
import {
    LocalMixerCommandGateway,
    withLocalGatewayTools,
} from "./dist/local-gateway.js";

const targets = {
    voix: { family: "channel", index: 1, name: "Voix", matchType: "exact" },
    drums: { family: "bus", index: 2, name: "Drums", matchType: "exact" },
    fuzzy: { family: "channel", index: 3, name: "Guitare", matchType: "fuzzy" },
    amb1: { family: "channel", index: 4, name: "Tom", matchType: "contains" },
    amb2: { family: "bus", index: 5, name: "Tom retour", matchType: "contains" },
    batterie: { family: "channel", index: 6, name: "Batterie", matchType: "exact" },
    anthony: { family: "bus", index: 7, name: "Anthony", matchType: "exact" },
    laurent: { family: "bus", index: 8, name: "Laurent", matchType: "exact" },
    hallfx: { family: "fxreturn", index: 2, name: "Hall FX", matchType: "exact" },
    playback: { family: "aux", index: 1, name: "Playback", matchType: "exact" },
};

let level = 0.75;
let writes = [];
let muteWrites = [];
let sendLevel = 0.5;
let sendReadCalls = [];
let sendWrites = [];
let sendMuteWrites = [];
let automationCalls = [];
let automationJobs = [];
let bulkMuteCalls = [];
let bulkSendCalls = [];
let speakerContexts = new Map();
let qualitativeCalls = [];
let qualitativeSendCalls = [];
let qualitativePreviewCalls = [];
let stale = false;

const adapter = {
    async resolve(query) {
        const q = query.toLowerCase();
        if (q === "voix") {
            return stale
                ? [{ family: "channel", index: 7, name: "Voix", matchType: "exact" }]
                : [targets.voix];
        }
        if (q === "drums") return [targets.drums];
        if (q === "guitr") return [targets.fuzzy];
        if (q === "tom") return [targets.amb1, targets.amb2];
        if (q === "guitare") return [{ ...targets.fuzzy, matchType: "exact" }];
        if (q === "batterie") return [targets.batterie];
        if (q === "anthony") return [targets.anthony];
        if (q === "laurent") return [targets.laurent];
        if (q === "hall fx") return [targets.hallfx];
        if (q === "playback") return [targets.playback];
        return [];
    },
    async status() {
        return {
            connected: true,
            xinfo: { consoleModel: "XR16", consoleVersion: "1.20" },
        };
    },
    async readLevel() {
        return level;
    },
    async writeLevel(target, next) {
        writes.push({ target, level: next });
        level = next;
    },
    async setMute(target, mute) {
        muteWrites.push({ target, mute });
    },
    async readSendLevel(source, destination) {
        assert.ok(["channel", "fxreturn", "aux"].includes(source.family));
        assert.equal(destination.family, "bus");
        sendReadCalls.push({ source, destination });
        return sendLevel;
    },
    async writeSendLevel(source, destination, next) {
        sendWrites.push({ source, destination, level: next });
        sendLevel = next;
    },
    async setSendMute(source, destination, mute) {
        sendMuteWrites.push({ source, destination, mute });
    },
    async startLevelRamp(target, toLevel, durationSeconds, fromLevel) {
        automationCalls.push({ kind: "ramp", target, toLevel, durationSeconds, fromLevel });
        return "auto-level";
    },
    async startSendRamp(source, destination, toLevel, durationSeconds, fromLevel) {
        automationCalls.push({ kind: "send-ramp", source, destination, toLevel, durationSeconds, fromLevel });
        return "auto-send";
    },
    async scheduleLevel(target, toLevel, delaySeconds) {
        automationCalls.push({ kind: "delay", target, toLevel, delaySeconds });
        return "auto-delay";
    },
    async scheduleSend(source, destination, toLevel, delaySeconds) {
        automationCalls.push({ kind: "send-delay", source, destination, toLevel, delaySeconds });
        return "auto-send-delay";
    },
    async listAutomations() {
        return automationJobs;
    },
    async cancelAutomation(id) {
        const job = automationJobs.find((entry) => entry.id === id);
        if (!job) return null;
        job.status = "cancelled";
        return job;
    },
    async muteBusBatch(targets, mute) {
        bulkMuteCalls.push({ kind: "selected", targets, mute });
    },
    async muteAllBuses(mute, except = []) {
        bulkMuteCalls.push({ kind: "all", except, mute });
    },
    async writeSendBatchDb(source, destinations, db, includeMain) {
        bulkSendCalls.push({ kind: "selected", source, destinations, db, includeMain });
    },
    async writeSendAllBusesDb(source, db, includeMain) {
        bulkSendCalls.push({ kind: "all", source, db, includeMain });
    },
    async speakerContext(speaker) {
        return speakerContexts.get(String(speaker).toLowerCase()) || {
            speaker: String(speaker).toLowerCase(),
            known: false,
            monitorDestination: null,
            busName: null,
            channelName: null,
            source: "test",
        };
    },
    async adjustQualitativeLevel(target, direction, amount) {
        qualitativeCalls.push({ target, direction, amount });
        return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
    },
    async adjustQualitativeSend(source, destination, direction, amount) {
        qualitativeSendCalls.push({ source, destination, direction, amount });
        return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
    },
    async previewQualitativeLevel(target, direction, amount) {
        qualitativePreviewCalls.push({ kind: "level", target, direction, amount });
        return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
    },
    async previewQualitativeSend(source, destination, direction, amount) {
        qualitativePreviewCalls.push({ kind: "send", source, destination, direction, amount });
        return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
    },
};

const gateway = new LocalMixerCommandGateway(adapter);

async function ready(text) {
    const result = await gateway.analyze({ protocol: GATEWAY_PROTOCOL, text });
    assert.equal(result.status, "ready", JSON.stringify(result));
    return result;
}

// Status read
{
    const analyzed = await ready("statut du mixeur");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.match(result.responseText, /XR16/);
}

// Named target level read, resolver reused
{
    const analyzed = await ready("niveau de Voix");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.match(result.responseText, /Voix/);
}

// Main LR is mixer-domain owned, not resolver-owned
{
    const analyzed = await ready("niveau de façade");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.match(result.responseText, /Main LR/);
}

// Absolute dB write
{
    writes = [];
    const analyzed = await ready("mets Voix à -12 dB");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target.index, 1);

    const duplicate = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(duplicate.ok, false);
    assert.equal(writes.length, 1);
}

// Directional verb + "à" remains an absolute target, not a relative instruction.
{
    writes = [];
    const analyzed = await ready("monte Batterie à -8 dB");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target.name, "Batterie");
}

// Directional source -> bus with "à" is also absolute.
{
    sendWrites = [];
    const analyzed = await ready("baisse Batterie sur Anthony à -20 dB");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendWrites.length, 1);
    assert.equal(sendWrites[0].source.name, "Batterie");
    assert.equal(sendWrites[0].destination.name, "Anthony");
}

// Direction words do not override the absolute marker.
{
    writes = [];
    const analyzed = await ready("baisse le niveau de Batterie à -20 dB");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes[0].target.name, "Batterie");
}

// Explicit relative dB write
{
    writes = [];
    level = 0.75;
    const analyzed = await ready("baisse Voix de 3 dB");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
}

// Qualitative relative write, English variant, reuses shared osc_adjust_level semantics.
{
    qualitativeCalls = [];
    const analyzed = await ready("raise a little Drums");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeCalls.length, 1);
    assert.equal(qualitativeCalls[0].target.family, "bus");
    assert.equal(qualitativeCalls[0].direction, "up");
    assert.equal(qualitativeCalls[0].amount, "little");
}

// Targetless qualitative level phrases are owned by Main LR.
{
    qualitativeCalls = [];
    const analyzed = await ready("baisse un peu le volume");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeCalls.length, 1);
    assert.equal(qualitativeCalls[0].target.family, "main");
    assert.equal(qualitativeCalls[0].direction, "down");
    assert.equal(qualitativeCalls[0].amount, "little");
}

// Plain targetless direction is also Main LR with normal shared amount semantics.
{
    qualitativeCalls = [];
    const analyzed = await ready("monte le volume");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeCalls[0].target.family, "main");
    assert.equal(qualitativeCalls[0].direction, "up");
    assert.equal(qualitativeCalls[0].amount, "normal");
}

// Qualitative source -> bus adjustment reuses shared osc_adjust_level semantics.
{
    qualitativeSendCalls = [];
    const analyzed = await ready("monte Batterie sur Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeSendCalls.length, 1);
    assert.equal(qualitativeSendCalls[0].source.name, "Batterie");
    assert.equal(qualitativeSendCalls[0].destination.name, "Anthony");
    assert.equal(qualitativeSendCalls[0].direction, "up");
    assert.equal(qualitativeSendCalls[0].amount, "normal");
}

// Qualitative source -> bus amount words are preserved.
{
    qualitativeSendCalls = [];
    const analyzed = await ready("baisse un peu Batterie dans Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeSendCalls[0].direction, "down");
    assert.equal(qualitativeSendCalls[0].amount, "little");
}

// French STT "montre" is corrected to "monte" only in safe level-command shapes.
{
    qualitativeCalls = [];
    const analyzed = await ready("montre Batterie");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeCalls[0].target.name, "Batterie");
    assert.equal(qualitativeCalls[0].direction, "up");
}

// "montre le volume" maps to Main LR increase.
{
    qualitativeCalls = [];
    const analyzed = await ready("montre le volume");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeCalls[0].target.family, "main");
    assert.equal(qualitativeCalls[0].direction, "up");
}

// Explicit display/read-like "montre-moi" is never rewritten as a write.
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "montre-moi le niveau de Batterie",
    });
    assert.notEqual(analyzed.status, "ready");
    assert.equal(analyzed.effect, "none");
}

// Natural plus/moins fort aliases use the same qualitative adapter.
{
    qualitativeCalls = [];
    const up = await ready("un peu plus fort Batterie");
    assert.equal((await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: up.planToken,
    })).ok, true);
    assert.equal(qualitativeCalls[0].target.name, "Batterie");
    assert.equal(qualitativeCalls[0].direction, "up");
    assert.equal(qualitativeCalls[0].amount, "little");

    qualitativeCalls = [];
    const down = await ready("Batterie moins fort");
    assert.equal((await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: down.planToken,
    })).ok, true);
    assert.equal(qualitativeCalls[0].direction, "down");
}

// Natural plus fort route syntax preserves source and destination roles.
{
    qualitativeSendCalls = [];
    const analyzed = await ready("plus fort Batterie sur Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeSendCalls[0].source.name, "Batterie");
    assert.equal(qualitativeSendCalls[0].destination.name, "Anthony");
    assert.equal(qualitativeSendCalls[0].direction, "up");
}

// Route mute is distinct from whole-source mute.
{
    muteWrites = [];
    sendMuteWrites = [];
    const analyzed = await ready("mute Batterie sur Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendMuteWrites.length, 1);
    assert.equal(sendMuteWrites[0].source.name, "Batterie");
    assert.equal(sendMuteWrites[0].source.family, "channel");
    assert.equal(sendMuteWrites[0].destination.name, "Anthony");
    assert.equal(sendMuteWrites[0].mute, true);
    assert.equal(muteWrites.length, 0);
}

// Route unmute preserves the same source/destination identity.
{
    sendMuteWrites = [];
    const analyzed = await ready("unmute Batterie sur Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendMuteWrites[0].mute, false);
}

// FX return -> bus mute uses the route-mute path.
{
    sendMuteWrites = [];
    const analyzed = await ready("coupe Hall FX sur Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendMuteWrites[0].source.family, "fxreturn");
    assert.equal(sendMuteWrites[0].destination.family, "bus");
}

// Aux return -> bus unmute uses the route-mute path.
{
    sendMuteWrites = [];
    const analyzed = await ready("réactive Playback dans Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendMuteWrites[0].source.family, "aux");
    assert.equal(sendMuteWrites[0].mute, false);
}

// Mute/unmute
{
    muteWrites = [];
    const mute = await ready("coupe Voix");
    assert.equal(mute.effect, "write");
    assert.equal((await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: mute.planToken,
    })).ok, true);

    const unmute = await ready("unmute Voix");
    assert.equal((await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: unmute.planToken,
    })).ok, true);

    assert.deepEqual(muteWrites.map((entry) => entry.mute), [true, false]);
}

// Fuzzy-only is clarification, never a write plan
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mute guitr",
    });
    assert.equal(analyzed.status, "clarification");
    assert.equal(analyzed.effect, "none");

    const continued = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "Guitare",
        continuationToken: analyzed.continuationToken,
    });
    assert.equal(continued.status, "ready");
    assert.equal(continued.effect, "write");
}

// Ambiguous contains is clarification
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "niveau de Tom",
    });
    assert.equal(analyzed.status, "clarification");
    assert.equal(analyzed.effect, "none");
}

// No match asks for clarification, no write plan
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mute Inconnu",
    });
    assert.equal(analyzed.status, "clarification");
    assert.equal(analyzed.effect, "none");
}

// Target identity change between analyze/execute => stale, no dispatch
{
    writes = [];
    stale = false;
    const analyzed = await ready("mets Voix à -10 dB");
    stale = true;
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    stale = false;
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "stale_plan");
    assert.equal(writes.length, 0);
}

// OR4B4 absolute percent write.
{
    writes = [];
    const analyzed = await ready("mets Voix à 50%");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].level, 0.5);
    assert.match(result.responseText, /50\.0%/);
}

// OR4B4 relative percent uses percentage points on normalized fader level.
{
    writes = [];
    level = 0.5;
    const analyzed = await ready("monte Voix de 10%");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.ok(Math.abs(writes[0].level - 0.6) < 1e-9);
}

// OR4B4 source -> bus absolute dB.
{
    sendWrites = [];
    sendLevel = 0.5;
    const analyzed = await ready("mets batterie sur Anthony à -20 dB");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendWrites.length, 1);
    assert.equal(sendWrites[0].source.name, "Batterie");
    assert.equal(sendWrites[0].destination.name, "Anthony");
    assert.match(result.responseText, /Batterie.*Anthony/);
}

// OR4B4 route level reads are read-only and use source + bus resolution.
{
    sendReadCalls = [];
    sendWrites = [];
    const analyzed = await ready("niveau de Batterie sur Anthony");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendReadCalls.length, 1);
    assert.equal(sendReadCalls[0].source.name, "Batterie");
    assert.equal(sendReadCalls[0].destination.name, "Anthony");
    assert.equal(sendWrites.length, 0);
    assert.match(result.responseText, /Batterie.*Anthony/);
}

// FX return -> bus read uses the same read path.
{
    sendReadCalls = [];
    const analyzed = await ready("quel est le niveau de Hall FX sur Anthony");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendReadCalls[0].source.family, "fxreturn");
}

// Aux return -> bus read uses the same read path.
{
    sendReadCalls = [];
    const analyzed = await ready("donne le niveau de Playback dans Anthony");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendReadCalls[0].source.family, "aux");
}

// OR4B4 FX return -> bus uses the same route grammar.
{
    sendWrites = [];
    const analyzed = await ready("mets Hall FX sur Anthony à -18 dB");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendWrites[0].source.family, "fxreturn");
    assert.equal(sendWrites[0].source.name, "Hall FX");
    assert.equal(sendWrites[0].destination.name, "Anthony");
}

// OR4B4 aux return -> bus qualitative route.
{
    qualitativeSendCalls = [];
    const analyzed = await ready("baisse un peu Playback dans Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativeSendCalls[0].source.family, "aux");
    assert.equal(qualitativeSendCalls[0].source.name, "Playback");
    assert.equal(qualitativeSendCalls[0].destination.name, "Anthony");
}

// OR4B4 FX return -> bus progressive route.
{
    automationCalls = [];
    const analyzed = await ready("baisse progressivement Hall FX sur Anthony à -30 dB en 2 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls[0].kind, "send-ramp");
    assert.equal(automationCalls[0].source.family, "fxreturn");
}

// OR4B4 source -> bus relative percent.
{
    sendWrites = [];
    sendLevel = 0.4;
    const analyzed = await ready("monte batterie sur Anthony de 10%");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendWrites.length, 1);
    assert.ok(Math.abs(sendWrites[0].level - 0.5) < 1e-9);
}

// OR4B4 fade-out defaults to the named target and starts background automation.
{
    automationCalls = [];
    const analyzed = await ready("fade out Voix en 10 secondes");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls.length, 1);
    assert.equal(automationCalls[0].kind, "ramp");
    assert.equal(automationCalls[0].target.name, "Voix");
    assert.equal(automationCalls[0].durationSeconds, 10);
    assert.equal(automationCalls[0].toLevel, 0);
    assert.match(result.responseText, /auto-level/);
}

// OR4B4 fade-out without a target owns Main LR in the mixer domain.
{
    automationCalls = [];
    const analyzed = await ready("fade out en 5 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls[0].target.family, "main");
}

// OR4B4 progressive relative percent ramp.
{
    automationCalls = [];
    level = 0.5;
    const analyzed = await ready("monte progressivement Voix de 10% en 4 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls[0].kind, "ramp");
    assert.ok(Math.abs(automationCalls[0].toLevel - 0.6) < 1e-9);
    assert.equal(automationCalls[0].durationSeconds, 4);
}

// OR4B4 temporal slots accept constituent reordering without changing semantics.
{
    const variants = [
        "baisse progressivement en 2 secondes Batterie à -30 dB",
        "en 2 secondes baisse progressivement Batterie à -30 dB",
        "baisse Batterie progressivement à -30 dB en 2 secondes",
        "baisse Batterie à -30 dB progressivement en 2 secondes",
        "baisse en 2 secondes progressivement Batterie à -30 dB",
    ];
    for (const utterance of variants) {
        automationCalls = [];
        const analyzed = await ready(utterance);
        const result = await gateway.execute({
            protocol: GATEWAY_PROTOCOL,
            planToken: analyzed.planToken,
        });
        assert.equal(result.ok, true, utterance);
        assert.equal(automationCalls.length, 1, utterance);
        assert.equal(automationCalls[0].kind, "ramp", utterance);
        assert.equal(automationCalls[0].target.name, "Batterie", utterance);
        assert.equal(automationCalls[0].durationSeconds, 2, utterance);
    }
}

// Strict markers remain mandatory: an unbound level literal never becomes an implicit target.
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "baisse progressivement Batterie -30 dB en 2 secondes",
    });
    assert.notEqual(analyzed.status, "ready");
    assert.equal(analyzed.effect, "none");
}

// "progressivement" plus only a delay is incomplete; do not degrade it to a delayed direct set.
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "baisse progressivement Batterie à -30 dB dans 2 secondes",
    });
    assert.notEqual(analyzed.status, "ready");
    assert.equal(analyzed.effect, "none");
}

// Qualitative progressive target ramps preview the same adaptive semantics as osc_adjust_level.
{
    automationCalls = [];
    qualitativePreviewCalls = [];
    const analyzed = await ready("baisse un peu progressivement Batterie en 2 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativePreviewCalls.length, 1);
    assert.equal(qualitativePreviewCalls[0].kind, "level");
    assert.equal(qualitativePreviewCalls[0].target.name, "Batterie");
    assert.equal(qualitativePreviewCalls[0].direction, "down");
    assert.equal(qualitativePreviewCalls[0].amount, "little");
    assert.equal(automationCalls[0].kind, "ramp");
    assert.equal(automationCalls[0].toLevel, 0.4);
}

// Qualitative progressive source->bus ramps use the same adaptive preview.
{
    automationCalls = [];
    qualitativePreviewCalls = [];
    const analyzed = await ready("monte beaucoup progressivement Batterie sur Anthony en 3 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(qualitativePreviewCalls[0].kind, "send");
    assert.equal(qualitativePreviewCalls[0].source.name, "Batterie");
    assert.equal(qualitativePreviewCalls[0].destination.name, "Anthony");
    assert.equal(qualitativePreviewCalls[0].direction, "up");
    assert.equal(qualitativePreviewCalls[0].amount, "much");
    assert.equal(automationCalls[0].kind, "send-ramp");
    assert.equal(automationCalls[0].toLevel, 0.6);
}

// OR4B4 delayed level uses "dans" as a delay, not a ramp.
{
    automationCalls = [];
    const analyzed = await ready("mets Voix à -15 dB dans 2 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls[0].kind, "delay");
    assert.equal(automationCalls[0].delaySeconds, 2);
}

// OR4B4 source -> bus ramp reuses send automation.
{
    automationCalls = [];
    const analyzed = await ready("monte progressivement batterie sur Anthony à -10 dB en 3 secondes");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationCalls[0].kind, "send-ramp");
    assert.equal(automationCalls[0].source.name, "Batterie");
    assert.equal(automationCalls[0].destination.name, "Anthony");
    assert.equal(automationCalls[0].durationSeconds, 3);
}

// OR4B4 Local automation status is a read.
{
    automationJobs = [
        { id: "auto-1", label: "Local ramp Voix", status: "completed" },
        { id: "auto-2", label: "Local ramp Batterie", status: "running", currentAction: "ramp channel 6 fader" },
    ];
    const analyzed = await ready("statut des automations");
    assert.equal(analyzed.effect, "read");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.match(result.responseText, /auto-2: running/);
}

// OR4B4 explicit automation cancellation remains a write plan.
{
    automationJobs = [{ id: "auto-3", label: "Long fade", status: "running" }];
    const analyzed = await ready("annule l'automation auto-3");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationJobs[0].status, "cancelled");
}

// OR4B4 "last automation" snapshots the last running job during analysis.
{
    automationJobs = [
        { id: "auto-4", label: "Done", status: "completed" },
        { id: "auto-5", label: "Fade one", status: "running" },
        { id: "auto-6", label: "Fade two", status: "running" },
    ];
    const analyzed = await ready("annule la dernière automation");
    assert.equal(analyzed.effect, "write");
    automationJobs.push({ id: "auto-7", label: "Later job", status: "running" });
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(automationJobs.find((entry) => entry.id === "auto-6").status, "cancelled");
    assert.equal(automationJobs.find((entry) => entry.id === "auto-7").status, "running");
}

// OR4B4 targetless volume shorthand defaults to Main LR.
{
    writes = [];
    level = 0.5;
    const analyzed = await ready("monte le volume de 10%");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target.family, "main");
    assert.ok(Math.abs(writes[0].level - 0.6) < 1e-9);
}

// "à" remains an absolute Main LR target even with a directional verb.
{
    writes = [];
    const analyzed = await ready("monte le volume à 100%");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes[0].target.family, "main");
    assert.equal(writes[0].level, 1);
}

// OR4B4 selected bus bulk mute.
{
    bulkMuteCalls = [];
    const analyzed = await ready("mute les bus Anthony et Laurent");
    assert.equal(analyzed.effect, "write");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(bulkMuteCalls.length, 1);
    assert.equal(bulkMuteCalls[0].kind, "selected");
    assert.deepEqual(bulkMuteCalls[0].targets.map((target) => target.name), ["Anthony", "Laurent"]);
    assert.equal(bulkMuteCalls[0].mute, true);
}

// OR4B4 all bus mute with named exception.
{
    bulkMuteCalls = [];
    const analyzed = await ready("coupe tous les bus sauf Anthony");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(bulkMuteCalls[0].kind, "all");
    assert.deepEqual(bulkMuteCalls[0].except.map((target) => target.name), ["Anthony"]);
}

// OR4B4 selected bus batch send shares the existing batch-tool semantics.
{
    bulkSendCalls = [];
    const analyzed = await ready("mets batterie à -20 dB sur les bus Anthony et Laurent");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(bulkSendCalls[0].kind, "selected");
    assert.equal(bulkSendCalls[0].source.name, "Batterie");
    assert.deepEqual(bulkSendCalls[0].destinations.map((target) => target.name), ["Anthony", "Laurent"]);
    assert.equal(bulkSendCalls[0].db, -20);
    assert.equal(bulkSendCalls[0].includeMain, false);
}

// OR4B4 all-bus batch send can explicitly include Main LR.
{
    bulkSendCalls = [];
    const analyzed = await ready("mets batterie à -25 dB sur tous les bus et façade");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(bulkSendCalls[0].kind, "all");
    assert.equal(bulkSendCalls[0].source.name, "Batterie");
    assert.equal(bulkSendCalls[0].db, -25);
    assert.equal(bulkSendCalls[0].includeMain, true);
}

// OR4B4 speaker context resolves first-person monitor phrases inside XMSeries-MCP.
{
    speakerContexts = new Map([
        ["laurent", {
            speaker: "laurent",
            known: true,
            monitorDestination: { kind: "bus", name: "Anthony" },
            busName: "Anthony",
            channelName: "Batterie",
            source: "XMS_SPEAKER_MAP",
        }],
    ]);
    writes = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "monte mon retour de 3 dB",
        context: {
            speaker: { name: "Laurent", confidence: 0.9, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes[0].target.family, "bus");
    assert.equal(writes[0].target.name, "Anthony");
}

// First-person input phrases resolve to the configured channel.
{
    writes = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mets mon micro à -12 dB",
        context: {
            speaker: { name: "Laurent", confidence: 0.9, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes[0].target.family, "channel");
    assert.equal(writes[0].target.name, "Batterie");
}

// Source -> my return expands only the first-person destination, not the source.
{
    sendWrites = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mets batterie dans mon retour à -20 dB",
        context: {
            speaker: { name: "Laurent", confidence: 0.9, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(sendWrites[0].source.name, "Batterie");
    assert.equal(sendWrites[0].destination.name, "Anthony");
}

// Explicitly mapped speaker without a bus defaults monitor master to Main LR.
{
    speakerContexts = new Map([
        ["thomas", {
            speaker: "thomas",
            known: true,
            monitorDestination: { kind: "main" },
            busName: null,
            channelName: "Batterie",
            source: "XMS_SPEAKER_MAP",
        }],
    ]);
    writes = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "monte mon retour de 3 dB",
        context: {
            speaker: { name: "Thomas", confidence: 0.95, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes[0].target.family, "main");
}

// Speaker Main monitor master mute remains a Main LR mute.
{
    muteWrites = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mute mon retour",
        context: {
            speaker: { name: "Thomas", confidence: 0.95, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(muteWrites[0].target.family, "main");
    assert.equal(muteWrites[0].mute, true);
}

// Source -> Main monitor mute must never broaden into whole-source mute.
{
    muteWrites = [];
    sendMuteWrites = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mute Batterie dans mon retour",
        context: {
            speaker: { name: "Thomas", confidence: 0.95, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "clarification", JSON.stringify(analyzed));
    assert.equal(analyzed.effect, "none");
    assert.match(analyzed.responseText, /Main LR/);
    assert.equal(muteWrites.length, 0);
    assert.equal(sendMuteWrites.length, 0);
}

// Source -> my return with a Main destination becomes the source Main LR fader path.
{
    writes = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "mets Batterie dans mon retour à -20 dB",
        context: {
            speaker: { name: "Thomas", confidence: 0.95, backend: "resemblyzer" },
        },
    });
    assert.equal(analyzed.status, "ready", JSON.stringify(analyzed));
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target.family, "channel");
    assert.equal(writes[0].target.name, "Batterie");
}

// Unknown speaker never guesses a return.
{
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "monte mon retour de 3 dB",
        context: {
            speaker: { name: "unknown", confidence: 0, backend: "none" },
        },
    });
    assert.equal(analyzed.status, "clarification");
    assert.equal(analyzed.effect, "none");
}

// Speaker-context clarification is fail-closed: a follow-up target never inherits a fake operation.
{
    writes = [];
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "monte mon retour de 3 dB",
        context: {
            speaker: { name: "unknown", confidence: 0, backend: "none" },
        },
    });
    assert.equal(analyzed.status, "clarification");
    const continued = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: "Anthony",
        continuationToken: analyzed.continuationToken,
    });
    assert.equal(continued.status, "unrecognized");
    assert.equal(continued.effect, "none");
    assert.equal(writes.length, 0);
}

// Default/cloud inventory is unchanged; Local adds only two reserved tools.
{
    const base = [
        { name: "legacy_a", description: "", inputSchema: { type: "object", properties: {} } },
        { name: "legacy_b", description: "", inputSchema: { type: "object", properties: {} } },
    ];
    assert.deepEqual(
        withLocalGatewayTools(base, {}).map((tool) => tool.name),
        ["legacy_a", "legacy_b"],
    );
    assert.deepEqual(
        withLocalGatewayTools(base, { LSA_LOCAL_COMMAND_GATEWAY: "1" }).map((tool) => tool.name),
        [
            "legacy_a",
            "legacy_b",
            "lsa_local_analyze_command",
            "lsa_local_execute_command",
        ],
    );
}

console.log("Local deterministic gateway tests passed.");
