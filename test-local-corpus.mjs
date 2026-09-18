import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GATEWAY_PROTOCOL } from "@infrafast/stage-command-core";
import { LocalMixerCommandGateway } from "./dist/local-gateway.js";

const corpus = JSON.parse(
    await readFile(new URL("./corpus/local-commands.fr.json", import.meta.url), "utf8"),
);

const targets = [
    { family: "channel", index: 1, name: "Voix", matchType: "exact" },
    { family: "channel", index: 2, name: "Basse", matchType: "exact" },
    { family: "channel", index: 6, name: "Batterie", matchType: "exact" },
    { family: "bus", index: 7, name: "Anthony", matchType: "exact" },
    { family: "bus", index: 8, name: "Laurent", matchType: "exact" },
];

function targetKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function makeHarness() {
    const operations = [];
    let level = 0.5;
    let sendLevel = 0.5;

    const adapter = {
        async resolve(query, families) {
            const key = targetKey(query);
            if (key === "tom") {
                return [
                    { family: "bus", index: 9, name: "Tom retour", matchType: "contains" },
                    { family: "bus", index: 10, name: "Tom ears", matchType: "contains" },
                ].filter((target) => !families || families.includes(target.family));
            }
            const result = targets
                .filter((target) => targetKey(target.name) === key)
                .filter((target) => !families || families.includes(target.family));
            return result.map((target) => ({ ...target }));
        },
        async status() {
            operations.push({ kind: "status" });
            return { connected: true, xinfo: { consoleModel: "XR16", consoleVersion: "test" } };
        },
        async readLevel(target) {
            operations.push({ kind: "read_level", family: target.family, name: target.name });
            return level;
        },
        async writeLevel(target, next) {
            operations.push({ kind: "write_level", family: target.family, name: target.name, level: next });
            level = next;
        },
        async setMute(target, mute) {
            operations.push({ kind: "mute", family: target.family, name: target.name, mute });
        },
        async readSendLevel() {
            return sendLevel;
        },
        async writeSendLevel(source, destination, next) {
            operations.push({ kind: "write_send", source: source.name, destination: destination.name, level: next });
            sendLevel = next;
        },
        async startLevelRamp(target, _toLevel, durationSeconds) {
            operations.push({ kind: "ramp", family: target.family, name: target.name, durationSeconds });
            return "auto-1";
        },
        async startSendRamp(source, destination, _toLevel, durationSeconds) {
            operations.push({ kind: "send_ramp", source: source.name, destination: destination.name, durationSeconds });
            return "auto-2";
        },
        async scheduleLevel(target, _toLevel, delaySeconds) {
            operations.push({ kind: "delay", family: target.family, name: target.name, delaySeconds });
            return "auto-3";
        },
        async scheduleSend(source, destination, _toLevel, delaySeconds) {
            operations.push({ kind: "send_delay", source: source.name, destination: destination.name, delaySeconds });
            return "auto-4";
        },
        async listAutomations() {
            return [];
        },
        async cancelAutomation() {
            return null;
        },
        async muteBusBatch(selected, mute) {
            operations.push({ kind: "bulk_mute", mode: "selected", names: selected.map((target) => target.name), mute });
        },
        async muteAllBuses(mute, except = []) {
            operations.push({ kind: "bulk_mute", mode: except.length ? "all_except" : "all", names: except.map((target) => target.name), mute });
        },
        async writeSendBatchDb(source, destinations, db, includeMain) {
            operations.push({ kind: "bulk_send", mode: "selected", source: source.name, names: destinations.map((target) => target.name), db, includeMain });
        },
        async writeSendAllBusesDb(source, db, includeMain) {
            operations.push({ kind: "bulk_send", mode: "all", source: source.name, names: [], db, includeMain });
        },
        async speakerContext(speaker) {
            if (String(speaker).toLowerCase() === "laurent") {
                return {
                    speaker: "laurent",
                    known: true,
                    busName: "Anthony",
                    channelName: "Batterie",
                    source: "XMS_SPEAKER_MAP",
                };
            }
            return {
                speaker: String(speaker || "unknown").toLowerCase(),
                known: false,
                busName: null,
                channelName: null,
                source: "test",
            };
        },
        async adjustQualitativeLevel(target, direction, amount) {
            operations.push({ kind: "qualitative", family: target.family, name: target.name, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
        },
        async adjustQualitativeSend(source, destination, direction, amount) {
            operations.push({ kind: "qualitative_send", source: source.name, destination: destination.name, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23 };
        },
        async previewQualitativeLevel(target, direction, amount) {
            operations.push({ kind: "qualitative_ramp_preview", family: target.family, name: target.name, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
        },
        async previewQualitativeSend(source, destination, direction, amount) {
            operations.push({ kind: "qualitative_send_ramp_preview", source: source.name, destination: destination.name, direction, amount });
            return { beforeDb: -20, targetDb: direction === "up" ? -17 : -23, targetLevel: direction === "up" ? 0.6 : 0.4 };
        },
    };

    return { gateway: new LocalMixerCommandGateway(adapter), operations };
}

function matches(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(actual?.[key], value, `operation field ${key}`);
    }
}

let passed = 0;
for (const [index, item] of corpus.cases.entries()) {
    const { gateway, operations } = makeHarness();
    const analyzed = await gateway.analyze({
        protocol: GATEWAY_PROTOCOL,
        text: item.utterance,
        locale: corpus.locale,
        context: item.context,
    });

    try {
        assert.equal(analyzed.status, item.expected.status, "status");
        assert.equal(analyzed.effect, item.expected.effect, "effect");

        if (item.expected.operation) {
            assert.equal(analyzed.status, "ready", "operation requires ready plan");
            const result = await gateway.execute({
                protocol: GATEWAY_PROTOCOL,
                planToken: analyzed.planToken,
            });
            assert.equal(result.ok, true, result.responseText || result.errorCode);

            const operation = operations.find((entry) => entry.kind === item.expected.operation.kind);
            assert.ok(operation, `operation ${item.expected.operation.kind} not observed; got ${JSON.stringify(operations)}`);
            matches(operation, item.expected.operation);
        }
        passed += 1;
    } catch (error) {
        throw new Error(
            `Corpus case #${index + 1} ${item.name} failed for "${item.utterance}": ${error.message}\n` +
            `analyzed=${JSON.stringify(analyzed)} operations=${JSON.stringify(operations)}`,
            { cause: error },
        );
    }
}

console.log(`Local deterministic corpus: ${passed}/${corpus.cases.length} passed`);
