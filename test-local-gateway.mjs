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
};

let level = 0.75;
let writes = [];
let muteWrites = [];
let sendLevel = 0.5;
let sendWrites = [];
let automationCalls = [];
let automationJobs = [];
let bulkMuteCalls = [];
let bulkSendCalls = [];
let speakerContexts = new Map();
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
        assert.equal(source.family, "channel");
        assert.equal(destination.family, "bus");
        return sendLevel;
    },
    async writeSendLevel(source, destination, next) {
        sendWrites.push({ source, destination, level: next });
        sendLevel = next;
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
            busName: null,
            channelName: null,
            source: "test",
        };
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

// Qualitative relative write, English variant
{
    writes = [];
    const analyzed = await ready("raise a little Drums");
    const result = await gateway.execute({
        protocol: GATEWAY_PROTOCOL,
        planToken: analyzed.planToken,
    });
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target.family, "bus");
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
