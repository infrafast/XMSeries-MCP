import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GATEWAY_PROTOCOL } from "@infrafast/stage-command-core";
import { LocalMixerCommandGateway } from "./dist/local-gateway.js";

const recipe = JSON.parse(
    await readFile(new URL("./corpus/local-functional-recipe.fr.json", import.meta.url), "utf8"),
);

const targets = [
    { family: "channel", index: 1, name: "Voix", matchType: "exact" },
    { family: "channel", index: 2, name: "Basse", matchType: "exact" },
    { family: "channel", index: 6, name: "Batterie", matchType: "exact" },
    { family: "channel", index: 9, name: "guitar-anto", matchType: "structured" },
    { family: "bus", index: 1, name: "Anthony", matchType: "exact" },
    { family: "bus", index: 2, name: "Laurent", matchType: "exact" },
    { family: "bus", index: 3, name: "Claude", matchType: "exact" },
    { family: "fxreturn", index: 2, name: "Hall FX", matchType: "exact" },
    { family: "aux", index: 1, name: "Playback", matchType: "exact" },
    { family: "dca", index: 1, name: "Band", matchType: "exact" },
    { family: "matrix", index: 1, name: "Matrix Vox", matchType: "exact" },
];

function key(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function makeHarness() {
    let level = 0.5;
    let sendLevel = 0.5;
    const operations = [];

    const adapter = {
        async resolve(query, families) {
            const q = key(query);
            if (q === "tom") {
                return [
                    { family: "bus", index: 3, name: "Tom retour", matchType: "contains" },
                    { family: "bus", index: 4, name: "Tom ears", matchType: "contains" },
                ].filter((target) => !families || families.includes(target.family));
            }
            if (q === "la guitare de anto" || q === "guitare de anto") {
                return [{ family: "channel", index: 9, name: "guitar-anto", matchType: "structured" }]
                    .filter((target) => !families || families.includes(target.family));
            }
            return targets
                .filter((target) => key(target.name) === q)
                .filter((target) => !families || families.includes(target.family))
                .map((target) => ({ ...target }));
        },
        async status() {
            operations.push({ kind: "status" });
            return { connected: true, xinfo: { consoleModel: "X32", consoleVersion: "test" } };
        },
        async readLevel(target) {
            operations.push({ kind: "read_level", target });
            return level;
        },
        async readChannelMute(target) {
            operations.push({ kind: "read_mute", target });
            return target.name === "Batterie";
        },
        async readEffectOn(target) {
            operations.push({ kind: "read_fx", target });
            return true;
        },
        async readChannelName(channel) {
            operations.push({ kind: "read_channel_name", channel });
            return channel === 6 ? "Batterie" : `Channel-${channel}`;
        },
        async writeLevel(target, next) {
            operations.push({ kind: "write_level", target, level: next });
            level = next;
        },
        async setMute(target, mute) {
            operations.push({ kind: "mute", target, mute });
        },
        async readSendLevel(source, destination) {
            operations.push({ kind: "read_send", source, destination });
            return sendLevel;
        },
        async writeSendLevel(source, destination, next) {
            operations.push({ kind: "write_send", source, destination, level: next });
            sendLevel = next;
        },
        async writeChannelToAux(source, aux, next) {
            operations.push({ kind: "aux_output", source, aux, level: next });
        },
        async setSendMute(source, destination, mute) {
            operations.push({ kind: "send_mute", source, destination, mute });
        },
        async startLevelRamp(target, toLevel, durationSeconds, fromLevel) {
            operations.push({ kind: "ramp", target, toLevel, durationSeconds, fromLevel });
            return "auto-ramp";
        },
        async startSendRamp(source, destination, toLevel, durationSeconds, fromLevel) {
            operations.push({ kind: "send_ramp", source, destination, toLevel, durationSeconds, fromLevel });
            return "auto-send-ramp";
        },
        async startDelayedLevelRamp(target, toLevel, durationSeconds, delaySeconds, fromLevel) {
            operations.push({ kind: "delayed_ramp", target, toLevel, durationSeconds, delaySeconds, fromLevel });
            return "auto-delayed-ramp";
        },
        async startDelayedSendRamp(source, destination, toLevel, durationSeconds, delaySeconds, fromLevel) {
            operations.push({ kind: "delayed_send_ramp", source, destination, toLevel, durationSeconds, delaySeconds, fromLevel });
            return "auto-delayed-send-ramp";
        },
        async startSequence(actions) {
            operations.push({
                kind: "sequence",
                count: actions.length,
                actionTypes: actions.map((action) => action.type),
            });
            return "auto-sequence";
        },
        async scheduleLevel(target, toLevel, delaySeconds) {
            operations.push({ kind: "delay_level", target, toLevel, delaySeconds });
            return "auto-delay-level";
        },
        async scheduleMute(target, mute, delaySeconds) {
            operations.push({ kind: "delay_mute", target, mute, delaySeconds });
            return "auto-delay-mute";
        },
        async scheduleSend(source, destination, toLevel, delaySeconds) {
            operations.push({ kind: "delay_send", source, destination, toLevel, delaySeconds });
            return "auto-delay-send";
        },
        async scheduleSendMute(source, destination, mute, delaySeconds) {
            operations.push({ kind: "delay_send_mute", source, destination, mute, delaySeconds });
            return "auto-delay-send-mute";
        },
        async listAutomations() {
            return [{ id: "auto-99", label: "recipe job", status: "running" }];
        },
        async cancelAutomation(id) {
            operations.push({ kind: "cancel", id });
            return { id, label: "recipe job", status: "cancelled" };
        },
        async muteChannelBatch(selected, mute) {
            operations.push({ kind: "bulk_channels", selected, mute });
        },
        async muteAllChannels(mute, except = []) {
            operations.push({ kind: "all_channels", mute, except });
        },
        async muteBusBatch(selected, mute) {
            operations.push({ kind: "bulk_buses", selected, mute });
        },
        async muteAllBuses(mute, except = []) {
            operations.push({ kind: "all_buses", mute, except });
        },
        async writeSendBatchDb(source, destinations, db, includeMain) {
            operations.push({ kind: "bulk_send", source, destinations, db, includeMain });
        },
        async writeSendAllBusesDb(source, db, includeMain) {
            operations.push({ kind: "all_send", source, db, includeMain });
        },
        async speakerContext(speaker) {
            if (key(speaker) === "laurent") {
                return {
                    speaker: "laurent",
                    known: true,
                    monitorDestination: { kind: "bus", name: "Anthony" },
                    busName: "Anthony",
                    channelName: "Batterie",
                    source: "recipe",
                };
            }
            return {
                speaker: key(speaker) || "unknown",
                known: false,
                monitorDestination: null,
                busName: null,
                channelName: null,
                source: "recipe",
            };
        },
        async adjustQualitativeLevel(target, direction, amount) {
            operations.push({ kind: "qualitative", target, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
        },
        async adjustQualitativeSend(source, destination, direction, amount) {
            operations.push({ kind: "qualitative_send", source, destination, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
        },
        async previewQualitativeLevel(target, direction, amount) {
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
        },
        async previewQualitativeSend(source, destination, direction, amount) {
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
        },
    };

    return { gateway: new LocalMixerCommandGateway(adapter), operations };
}

function matchesOperation(actual, expected, path = "operation") {
    for (const [key, value] of Object.entries(expected)) {
        const actualValue = actual?.[key];
        const field = `${path}.${key}`;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            assert.ok(actualValue && typeof actualValue === "object", `${field} must be an object`);
            matchesOperation(actualValue, value, field);
        } else {
            assert.deepEqual(actualValue, value, field);
        }
    }
}

const sessions = new Map();
let passed = 0;

for (const [index, item] of recipe.cases.entries()) {
    const sessionKey = item.session || `case-${index}`;
    if (!sessions.has(sessionKey)) sessions.set(sessionKey, makeHarness());
    const { gateway, operations } = sessions.get(sessionKey);
    const operationStart = operations.length;

    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: item.utterance,
        locale: recipe.locale,
        context: item.context,
    });

    try {
        assert.equal(analyzed.status, item.expected.status, "status");
        assert.equal(analyzed.effect, item.expected.effect, "effect");

        if (analyzed.status === "ready") {
            assert.ok(analyzed.planToken, "ready result must include planToken");
            const executed = await gateway.execute({
                protocol: GATEWAY_PROTOCOL,
                planToken: analyzed.planToken,
            });
            assert.equal(executed.ok, true, executed.responseText || executed.errorCode);
        }

        const caseOperations = operations.slice(operationStart);
        if (item.expected.operation) {
            const operation = caseOperations.find((entry) => entry.kind === item.expected.operation.kind);
            assert.ok(
                operation,
                `operation ${item.expected.operation.kind} not observed; got ${JSON.stringify(caseOperations)}`,
            );
            matchesOperation(operation, item.expected.operation);
        }
        if (item.expected.noOperations) {
            assert.deepEqual(caseOperations, [], `expected no side effect; got ${JSON.stringify(caseOperations)}`);
        }

        passed += 1;
    } catch (error) {
        throw new Error(
            `Recipe case #${index + 1} ${item.name} failed for "${item.utterance}": ${error.message}\n` +
            `analyzed=${JSON.stringify(analyzed)}`,
            { cause: error },
        );
    }
}

console.log(`Local functional recipe: ${passed}/${recipe.cases.length} passed`);
