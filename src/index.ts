#!/usr/bin/env node

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { AutomationAction, AutomationCurve, AutomationEngine, AutomationRampAction } from "./automation.js";
import { coerceOscArg, MixerDisconnectedError, OSCClient, OSCProtocol, parseOscCountEnv } from "./osc-client.js";
import { dbToFaderLevel, faderLevelToDb, formatDb } from "./level-table.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default OSC configuration
export const OSC_HOST = process.env.OSC_HOST || "192.168.100.16";
export const OSC_PORT = parseInt(process.env.OSC_PORT || "10024");
export const OSC_PROTOCOL = parseOscProtocol(process.env.OSC_PROTOCOL);
export const OSC_CHANNEL_COUNT = parseOscCountEnv("OSC_CHANNEL_COUNT", 32);
export const OSC_BUS_COUNT = parseOscCountEnv("OSC_BUS_COUNT", 16);
export const OSC_FX_COUNT = parseOscCountEnv("OSC_FX_COUNT", 8);
export const OSC_DCA_COUNT = parseOscCountEnv("OSC_DCA_COUNT", 8);
export interface OscRuntimeConfig {
    host: string;
    port: number;
    protocol: OSCProtocol;
    channelCount: number;
    busCount: number;
    fxCount: number;
    dcaCount: number;
}

let oscRuntimeConfig: OscRuntimeConfig = {
    host: OSC_HOST,
    port: OSC_PORT,
    protocol: OSC_PROTOCOL,
    channelCount: OSC_CHANNEL_COUNT,
    busCount: OSC_BUS_COUNT,
    fxCount: OSC_FX_COUNT,
    dcaCount: OSC_DCA_COUNT,
};

export function getOscRuntimeConfig(): OscRuntimeConfig {
    return { ...oscRuntimeConfig };
}
const DEBUG_ENABLED = process.env.DEBUG === "1" || process.env.DEBUG?.toLowerCase() === "true";
const PROMPT_RESOURCE_URI = "agent://prompt/system";
        const fuzzyMatches = candidates
            .map((candidate) => ({ ...candidate, fuzzyDistance: fuzzyNameDistance(normalizedQuery, candidate.normalizedName) }))
            .filter((candidate): candidate is typeof candidate & { fuzzyDistance: number } => candidate.fuzzyDistance !== null)
            .sort((a, b) => a.fuzzyDistance - b.fuzzyDistance)
            .map(({ normalizedName: _normalizedName, fuzzyDistance: _fuzzyDistance, ...candidate }) => ({
                ...candidate,
                matchType: "fuzzy" as const,
            }));
}
        if (fuzzyMatches.length > 0) return fuzzyMatches;

        // Fallback: if the query contains a destination connector (e.g. 'sur', 'vers', 'dans', 'chez', 'to', 'in'),
        // try splitting the phrase into source (left) and destination (right) and re-run scoped searches.
        const connectorRegex = /\b(sur|vers|dans|chez|to|in)\b/i;
        if (connectorRegex.test(query)) {
            const parts = query.split(connectorRegex);
            if (parts.length >= 3) {
                const left = parts[0].trim();
                const right = parts.slice(2).join(" ").trim();
                // Try left as channel if caller allowed channel family
                if (families.includes("channel") && left) {
                    const leftMatches = await findNamedTargets(left, ["channel"]);
                    if (leftMatches && leftMatches.length > 0) return leftMatches;
                }
                // Try right as bus/aux/fxreturn/matrix if caller allowed any of these
                const destFamilies: NamedTargetFamily[] = ["bus", "aux", "fxreturn", "matrix"];
                if (families.some((f) => destFamilies.includes(f)) && right) {
                    const rightMatches = await findNamedTargets(right, destFamilies.filter((f) => families.includes(f)) as NamedTargetFamily[]);
                    if (rightMatches && rightMatches.length > 0) return rightMatches;
                }
            }
        }

        return [];

function createOscClient(config: OscRuntimeConfig): OSCClient {
    return new OSCClient(config.host, config.port, config.protocol, {
        channelCount: config.channelCount,
        busCount: config.busCount,
        fxCount: config.fxCount,
        dcaCount: config.dcaCount,
    });
}

// Initialize OSC client
let osc = createOscClient(oscRuntimeConfig);
const automation = new AutomationEngine();
let oscConnectPromise: Promise<void> | null = null;

export function connectOscDevice(): Promise<void> {
    if (!oscConnectPromise) {
        oscConnectPromise = osc.connect();
    }
    return oscConnectPromise;
}

function closeOscClient(client: OSCClient): void {
    try {
        client.close();
    } catch (error) {
        console.error("OSC close error:", error);
    }
}

function levelDbPayload(result: ReturnType<typeof dbToFaderLevel>): string {
    return JSON.stringify({
        requestedDb: result.requestedDb,
        level: result.level,
        db: result.db,
        dbLabel: formatDb(result.db),
        tableIndex: result.index,
        clipped: result.clipped,
    });
}

function faderDbPayload(result: ReturnType<typeof faderLevelToDb>): string {
    return JSON.stringify({
        requestedLevel: result.requestedLevel,
        level: result.level,
        db: result.db,
        dbLabel: formatDb(result.db),
        tableIndex: result.index,
        clipped: result.clipped,
    });
}

function parseOscProtocol(value?: string): OSCProtocol {
    if (!value) return "OSCXR";
    const normalized = value.trim().toUpperCase();
    if (normalized === "OSCX32M32" || normalized === "X32" || normalized === "M32") return "OSCX32M32";
    if (normalized === "OSCXR" || normalized === "XR" || normalized === "XAIR" || normalized === "XAIRXR") return "OSCXR";
    throw new Error(`Invalid OSC_PROTOCOL "${value}". Expected "OSCX32M32" or "OSCXR".`);
}

interface SpeakerMixerMapping {
    bus?: string;
    channel?: string;
    enabled?: boolean;
}

function parseSpeakerMap(raw: string): Record<string, SpeakerMixerMapping> {
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("XMS_SPEAKER_MAP must be a JSON object.");
    }

    const normalized: Record<string, SpeakerMixerMapping> = {};
    for (const [speaker, value] of Object.entries(parsed)) {
        const key = String(speaker || "").trim().toLowerCase();
        if (!key) continue;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`XMS_SPEAKER_MAP.${key} must be an object.`);
        }
        const mapping = value as Record<string, unknown>;
        normalized[key] = {
            bus: mapping.bus === undefined ? undefined : String(mapping.bus).trim(),
            channel: mapping.channel === undefined ? undefined : String(mapping.channel).trim(),
            enabled: mapping.enabled === undefined ? undefined : Boolean(mapping.enabled),
        };
    }
    return normalized;
}

function speakerMapFromEnv(): Record<string, SpeakerMixerMapping> {
    const raw = process.env.XMS_SPEAKER_MAP || "";
    if (!raw.trim()) return {};
    try {
        return parseSpeakerMap(raw);
    } catch (error) {
        console.error(`Invalid XMS_SPEAKER_MAP: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}

export function getSpeakerMapConfig(): Record<string, SpeakerMixerMapping> {
    return speakerMapFromEnv();
}

export function configureSpeakerMapConfig(input: unknown): {
    previous: Record<string, SpeakerMixerMapping>;
    current: Record<string, SpeakerMixerMapping>;
} {
    const previous = speakerMapFromEnv();
    const raw = typeof input === "string" ? input : JSON.stringify(input || {});
    const current = parseSpeakerMap(raw);
    process.env.XMS_SPEAKER_MAP = JSON.stringify(current);
    return { previous, current };
}

function speakerContextPayload(speaker: string): string {
    const normalized = String(speaker || "unknown").trim().toLowerCase();
    const mappings = speakerMapFromEnv();
    const mapping = mappings[normalized];
    const enabled = mapping?.enabled !== false;
    const known = Boolean(normalized && normalized !== "unknown" && enabled);
    return JSON.stringify({
        speaker: normalized || "unknown",
        known,
        busName: known ? (mapping?.bus || normalized) : null,
        channelName: known ? (mapping?.channel || null) : null,
        source: mapping ? "XMS_SPEAKER_MAP" : "default-speaker-name",
    });
}

function appendOscTrace(toolResult: any, commands: string[], toolName?: string): any {
    if (!DEBUG_ENABLED || commands.length === 0) {
        return toolResult;
    }

    const traceText =
        toolName === "osc_find_named_target"
            ? `OSC trace:\n${commands.length} name-resolution OSC read(s) omitted from the MCP response; see server logs for details.`
            : `OSC trace:\n${commands.join("\n")}`;

    return {
        ...toolResult,
        content: [
            {
                type: "text",
                text: traceText,
            },
            ...(toolResult.content || []),
        ],
    };
}

type NamedTargetFamily = "channel" | "bus" | "fxreturn" | "aux" | "dca" | "matrix";
type NamedTargetMatchType = "exact" | "contains" | "structured" | "fuzzy";

interface NamedTargetMatch {
    family: NamedTargetFamily;
    index: number;
    name: string;
    matchType: NamedTargetMatchType;
}

const NAMED_TARGET_FAMILIES: NamedTargetFamily[] = ["channel", "bus", "fxreturn", "aux", "dca", "matrix"];

function normalizeMixerName(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

const OWNERSHIP_FILLER_TOKENS = new Set(["a", "d", "de", "des", "du", "l", "la", "le", "les"]);

export function normalizeOwnershipMixerName(value: string): string {
    return normalizeMixerName(value)
        .split(" ")
        .filter((token) => token && !OWNERSHIP_FILLER_TOKENS.has(token))
        .join(" ");
}

function normalizeFrenchPhoneticToken(value: string): string {
    return value
        .replace(/eau/g, "o")
        .replace(/au/g, "o")
        .replace(/ent$/g, "an")
        .replace(/guitares?$/g, "guitar");
}

export function isStructuredOwnershipMatch(query: string, candidate: string): boolean {
    const queryTokens = normalizeOwnershipMixerName(query).split(" ").filter(Boolean);
    const candidateTokens = normalizeOwnershipMixerName(candidate).split(" ").filter(Boolean);

    if (queryTokens.length < 2 || queryTokens.length !== candidateTokens.length) return false;

    const normalizedQueryTokens = queryTokens.map(normalizeFrenchPhoneticToken);
    const normalizedCandidateTokens = candidateTokens.map(normalizeFrenchPhoneticToken);

    if (normalizedQueryTokens[0] !== normalizedCandidateTokens[0]) return false;

    return normalizedQueryTokens
        .slice(1)
        .every((queryToken, index) => queryToken === normalizedCandidateTokens[index + 1]);
}

function editDistance(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    const current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + substitutionCost
            );
        }
        previous.splice(0, previous.length, ...current);
    }

    return previous[b.length];
}

function fuzzyThreshold(value: string): number {
    if (value.length <= 4) return 1;
    if (value.length <= 8) return 2;
    if (value.length <= 14) return 3;
    return 4;
}

function fuzzyNameDistance(query: string, candidate: string): number | null {
    const fullDistance = editDistance(query, candidate);
    if (fullDistance <= fuzzyThreshold(query)) return fullDistance;

    const queryTokens = query.split(" ").filter(Boolean);
    const candidateTokens = candidate.split(" ").filter(Boolean);
    if (queryTokens.length === 0 || candidateTokens.length === 0) return null;

    let totalDistance = 0;
    for (const queryToken of queryTokens) {
        if (queryToken.length < 4 && !candidateTokens.includes(queryToken)) return null;
        const bestTokenDistance = Math.min(...candidateTokens.map((candidateToken) => editDistance(queryToken, candidateToken)));
        if (bestTokenDistance > fuzzyThreshold(queryToken)) return null;
        totalDistance += bestTokenDistance;
    }

    return totalDistance;
}

async function readNamedTarget(family: NamedTargetFamily, index: number): Promise<string | null> {
    try {
        switch (family) {
            case "channel":
                return await osc.getChannelName(index);
            case "bus":
                return await osc.getBusName(index);
            case "fxreturn":
                return await osc.getFxReturnName(index);
            case "aux":
                return await osc.getAuxName(index);
            case "dca":
                return await osc.getDcaName(index);
            case "matrix":
                return await osc.getMatrixName(index);
        }
    } catch (error) {
        if (error instanceof MixerDisconnectedError) {
            throw new Error(`Le mixeur est deconnecté: impossible de lire les noms OSC (${family} ${index})`);
        }
        return null;
    }
}

function namedTargetRange(family: NamedTargetFamily): number[] {
    const maxByFamily: Record<NamedTargetFamily, number> = {
        channel: oscRuntimeConfig.channelCount,
        bus: oscRuntimeConfig.busCount,
        fxreturn: oscRuntimeConfig.fxCount,
        aux: oscRuntimeConfig.protocol === "OSCXR" ? 1 : 8,
        dca: oscRuntimeConfig.dcaCount,
        matrix: oscRuntimeConfig.protocol === "OSCXR" ? 0 : 6,
    };
    return Array.from({ length: maxByFamily[family] }, (_, i) => i + 1);
}

async function findNamedTargets(
    query: string,
    families: NamedTargetFamily[] = NAMED_TARGET_FAMILIES
): Promise<NamedTargetMatch[]> {
    const normalizedQuery = normalizeMixerName(query);
    if (!normalizedQuery) return [];

    const candidates: Array<Omit<NamedTargetMatch, "matchType"> & { normalizedName: string }> = [];

    for (const family of families) {
        for (const index of namedTargetRange(family)) {
            const name = await readNamedTarget(family, index);
            if (!name) continue;
            const normalizedName = normalizeMixerName(name);

            if (normalizedName === normalizedQuery) {
                return [{ family, index, name, matchType: "exact" }];
            }

            candidates.push({
                family,
                index,
                name,
                normalizedName,
            });
        }
    }

    const containsMatches = candidates
        .filter((candidate) => candidate.normalizedName.includes(normalizedQuery))
        .map(({ normalizedName: _normalizedName, ...candidate }) => ({ ...candidate, matchType: "contains" as const }));

    if (containsMatches.length > 0) return containsMatches;

    const structuredMatches = candidates
        .filter((candidate) => isStructuredOwnershipMatch(query, candidate.name))
        .map(({ normalizedName: _normalizedName, ...candidate }) => ({ ...candidate, matchType: "structured" as const }));

    if (structuredMatches.length > 0) return structuredMatches;

    return candidates
        .map((candidate) => ({ ...candidate, fuzzyDistance: fuzzyNameDistance(normalizedQuery, candidate.normalizedName) }))
        .filter((candidate): candidate is typeof candidate & { fuzzyDistance: number } => candidate.fuzzyDistance !== null)
        .sort((a, b) => a.fuzzyDistance - b.fuzzyDistance)
        .map(({ normalizedName: _normalizedName, fuzzyDistance: _fuzzyDistance, ...candidate }) => ({
            ...candidate,
            matchType: "fuzzy" as const,
        }));
}

type AutomationTargetKind =
    | "channel_fader"
    | "channel_send"
    | "bus_fader"
    | "main_fader"
    | "fx_return_fader"
    | "fx_send"
    | "aux_fader"
    | "aux_send"
    | "matrix_fader"
    | "raw";

interface AutomationTargetSpec {
    kind: AutomationTargetKind;
    channel?: number;
    bus?: number;
    effect?: number;
    aux?: number;
    matrix?: number;
    address?: string;
    readAddress?: string;
    writeAddress?: string;
    osctype?: "int" | "float" | "string" | "bool";
}

interface AutomationTargetAdapter {
    label: string;
    read: () => Promise<number>;
    write: (value: number) => Promise<void>;
}

interface AutomationRawCommand {
    address: string;
    args?: any[];
    osctype?: "int" | "float" | "string" | "bool";
}

interface AutomationRampInput {
    target: AutomationTargetSpec;
    toLevel?: number;
    toDb?: number | null;
    fromLevel?: number;
    durationSeconds: number;
    stepMs?: number;
    curve?: AutomationCurve;
    label?: string;
}

interface AutomationDelayedCommandInput {
    delaySeconds: number;
    command?: AutomationRawCommand;
    target?: AutomationTargetSpec;
    toLevel?: number;
    toDb?: number | null;
    label?: string;
}

type AutomationMacroStepInput =
    | ({ type: "wait" | "delay"; durationSeconds: number; label?: string })
    | ({ type: "command"; delaySeconds?: number; command: AutomationRawCommand; label?: string })
    | ({ type: "ramp" } & AutomationRampInput);

type LevelToolAction = "get" | "set";
type LevelToolUnit = "level" | "db" | "percent";

interface LevelToolInput {
    action: LevelToolAction;
    unit?: LevelToolUnit;
    value?: number;
}

interface LevelOperation {
    action: LevelToolAction;
    unit: LevelToolUnit;
    value?: number;
}

function clampLevel(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function parseLevelOperation(input: LevelToolInput): LevelOperation {
    const action = input.action;
    if (action !== "get" && action !== "set") {
        throw new Error(`Invalid level action "${action}". Expected "get" or "set".`);
    }

    if (action === "set" && !input.unit) {
        throw new Error("Level set action requires explicit unit. Use unit=\"db\" for dB values, unit=\"level\" for normalized 0.0..1.0 fader levels, or unit=\"percent\" for percentages.");
    }

    const unit = input.unit ?? "db";
    if (unit !== "level" && unit !== "db" && unit !== "percent") {
        throw new Error(`Invalid level unit "${unit}". Expected "level", "db", or "percent".`);
    }

    if (action === "set" && typeof input.value !== "number") {
        throw new Error("Level set action requires numeric value.");
    }

    return { action, unit, value: input.value };
}

function formatLevelWithDb(level: number): string {
    const converted = faderLevelToDb(level);
    return formatDb(converted.db);
}

function levelValueToNormalized(operation: LevelOperation): { level: number; text: string } {
    if (operation.value === undefined) {
        throw new Error("Level set action requires numeric value.");
    }

    if (operation.unit === "db") {
        const converted = dbToFaderLevel(operation.value);
        return {
            level: converted.level,
            text: `${formatDb(converted.db)}${converted.clipped ? " (clipped)" : ""}`,
        };
    }

    const level = clampLevel(operation.unit === "percent" ? operation.value / 100 : operation.value);
    const converted = faderLevelToDb(level);
    return {
        level,
        text:
            operation.unit === "percent"
                ? `${(level * 100).toFixed(1)}% (${formatDb(converted.db)})`
                : `level ${level.toFixed(4)} (${formatDb(converted.db)})`,
    };
}

function formatLevelRead(label: string, level: number, unit: LevelToolUnit): string {
    if (unit === "db") {
        return `${label} is ${formatLevelWithDb(level)}`;
    }

    const converted = faderLevelToDb(level);
    if (unit === "percent") {
        return `${label} is at ${(level * 100).toFixed(1)}% (${formatDb(converted.db)})`;
    }

    return `${label} is at level ${level.toFixed(4)} (${formatDb(converted.db)})`;
}

function parsePositiveInteger(value: number | null | undefined, name: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}

export async function getOscMixerStatus(): Promise<{ runtimeConfig: OscRuntimeConfig; mixer: any }> {
    const status = await osc.getMixerStatus();
    return {
        runtimeConfig: getOscRuntimeConfig(),
        mixer: status,
    };
}

export async function configureOscRuntime(input: {
    host?: string;
    port?: number;
    protocol?: string;
    channelCount?: number | null;
    busCount?: number | null;
    fxCount?: number | null;
    dcaCount?: number | null;
}): Promise<{ reconnect: boolean; previous: OscRuntimeConfig; current: OscRuntimeConfig }> {
    const previous = { ...oscRuntimeConfig };
    const next: OscRuntimeConfig = {
        host: input.host?.trim() || previous.host,
        port: input.port ?? previous.port,
        protocol: input.protocol !== undefined ? parseOscProtocol(input.protocol) : previous.protocol,
        channelCount: parsePositiveInteger(input.channelCount, "channelCount") ?? previous.channelCount,
        busCount: parsePositiveInteger(input.busCount, "busCount") ?? previous.busCount,
        fxCount: parsePositiveInteger(input.fxCount, "fxCount") ?? previous.fxCount,
        dcaCount: parsePositiveInteger(input.dcaCount, "dcaCount") ?? previous.dcaCount,
    };

    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
        throw new Error("port must be an integer from 1 to 65535.");
    }

    const reconnect =
        next.host !== previous.host ||
        next.port !== previous.port ||
        next.protocol !== previous.protocol;

    oscRuntimeConfig = next;

    if (reconnect) {
        closeOscClient(osc);
        osc = createOscClient(oscRuntimeConfig);
        oscConnectPromise = null;
        await connectOscDevice();
    } else {
        osc.updateCounts({
            channelCount: oscRuntimeConfig.channelCount,
            busCount: oscRuntimeConfig.busCount,
            fxCount: oscRuntimeConfig.fxCount,
            dcaCount: oscRuntimeConfig.dcaCount,
        });
    }

    return { reconnect, previous, current: { ...oscRuntimeConfig } };
}

function targetAdapter(target: AutomationTargetSpec): AutomationTargetAdapter {
    if (!target || typeof target !== "object") {
        throw new Error("Automation target is required.");
    }

    const kind = (target as { kind?: string }).kind;
    switch (kind) {
        case "channel_fader": {
            const channel = requireNumber(target.channel, "channel");
            const address = channelPath(channel, "/mix/fader");
            return {
                label: `channel ${channel} fader`,
                read: () => osc.getFader(channel),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "channel_send": {
            const channel = requireNumber(target.channel, "channel");
            const bus = requireNumber(target.bus, "bus");
            const address = channelPath(channel, `/mix/${busSendSegment(bus)}/level`);
            return {
                label: `channel ${channel} send to bus ${bus}`,
                read: () => osc.getSendToBus(channel, bus),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "bus_fader": {
            const bus = requireNumber(target.bus, "bus");
            const address = `${busPath(bus)}/mix/fader`;
            return {
                label: `bus ${bus} fader`,
                read: () => osc.getBusFader(bus),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "main_fader":
            return {
                label: "main LR fader",
                read: () => osc.getMainFader(),
                write: (level) => osc.sendRaw(`${mainStereoPath()}/mix/fader`, [level], { allowOfflineWrite: true }),
            };
        case "fx_return_fader": {
            const effect = requireNumber(target.effect, "effect");
            const address = `${fxReturnPath(effect)}/mix/fader`;
            return {
                label: `FX return ${effect} fader`,
                read: () => osc.getFxReturnFader(effect),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "fx_send": {
            const effect = requireNumber(target.effect, "effect");
            const bus = requireNumber(target.bus, "bus");
            const address = `${fxReturnPath(effect)}/mix/${busSendSegment(bus)}/level`;
            return {
                label: `FX return ${effect} send to bus ${bus}`,
                read: () => osc.getFxToBus(effect, bus),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "aux_fader": {
            const aux = requireNumber(target.aux, "aux");
            const address = `${auxPath(aux)}/mix/fader`;
            return {
                label: `aux ${aux} fader`,
                read: () => osc.getAuxFader(aux),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "aux_send": {
            const aux = requireNumber(target.aux, "aux");
            const bus = requireNumber(target.bus, "bus");
            const address = `${auxBusPath(aux, bus)}/level`;
            return {
                label: `aux ${aux} send to bus ${bus}`,
                read: () => osc.getAuxToBus(aux, bus),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "matrix_fader": {
            const matrix = requireNumber(target.matrix, "matrix");
            const address = `/mtx/${matrix.toString().padStart(2, "0")}/mix/fader`;
            return {
                label: `matrix ${matrix} fader`,
                read: () => osc.getMatrixFader(matrix),
                write: (level) => osc.sendRaw(address, [level], { allowOfflineWrite: true }),
            };
        }
        case "raw": {
            const readAddress = target.readAddress || target.address;
            const writeAddress = target.writeAddress || target.address;
            if (!readAddress || !writeAddress) {
                throw new Error("Raw automation targets require address or readAddress/writeAddress.");
            }
            validateAutomationRawCommand({ address: readAddress });
            validateAutomationRawCommand({ address: writeAddress });
            return {
                label: `raw OSC ${writeAddress}`,
                read: async () => Number(await osc.readRaw(readAddress)),
                write: (level) => osc.sendRaw(writeAddress, [coerceOscArg(level, target.osctype || "float")], { allowOfflineWrite: true }),
            };
        }
        default:
            throw new Error(
                `Unsupported automation target kind "${kind ?? "(missing)"}". ` +
                    "Use one of: channel_fader, channel_send, bus_fader, main_fader, fx_return_fader, fx_send, aux_fader, aux_send, matrix_fader, raw. " +
                    'For a bus fader, use target.kind="bus_fader", not "bus".'
            );
    }
}

function requireNumber(value: number | undefined, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Automation target missing numeric ${name}.`);
    }
    return value;
}

function mainStereoPath(): string {
    return oscRuntimeConfig.protocol === "OSCXR" ? "/lr" : "/main/st";
}

function channelPath(channel: number, suffix = ""): string {
    return `/ch/${channel.toString().padStart(2, "0")}${suffix}`;
}

function busPath(bus: number): string {
    return oscRuntimeConfig.protocol === "OSCXR" ? `/bus/${bus}` : `/bus/${bus.toString().padStart(2, "0")}`;
}

function fxReturnPath(effect: number): string {
    return oscRuntimeConfig.protocol === "OSCXR" ? `/rtn/${effect}` : `/fxrtn/${effect.toString().padStart(2, "0")}`;
}

function auxPath(aux: number): string {
    if (oscRuntimeConfig.protocol === "OSCXR") {
        if (aux !== 1) throw new Error("OSCXR exposes the aux return as /rtn/aux; use aux 1.");
        return "/rtn/aux";
    }
    return `/auxin/${aux.toString().padStart(2, "0")}`;
}

function auxBusPath(aux: number, bus: number): string {
    return `${auxPath(aux)}/mix/${busSendSegment(bus)}`;
}

function busSendSegment(bus: number): string {
    return bus.toString().padStart(2, "0");
}

function allowedAutomationRawAddresses(): Set<string> {
    const addresses = new Set<string>();

    addresses.add(`${mainStereoPath()}/mix/fader`);
    addresses.add(`${mainStereoPath()}/mix/on`);

    for (let channel = 1; channel <= oscRuntimeConfig.channelCount; channel += 1) {
        addresses.add(channelPath(channel, "/mix/fader"));
        addresses.add(channelPath(channel, "/mix/on"));
        for (let bus = 1; bus <= oscRuntimeConfig.busCount; bus += 1) {
            addresses.add(channelPath(channel, `/mix/${busSendSegment(bus)}/level`));
            if (oscRuntimeConfig.protocol === "OSCX32M32") {
                addresses.add(channelPath(channel, `/mix/${busSendSegment(bus)}/on`));
            }
        }
    }

    for (let bus = 1; bus <= oscRuntimeConfig.busCount; bus += 1) {
        addresses.add(`${busPath(bus)}/mix/fader`);
        addresses.add(`${busPath(bus)}/mix/on`);
    }

    for (let effect = 1; effect <= oscRuntimeConfig.fxCount; effect += 1) {
        addresses.add(`${fxReturnPath(effect)}/mix/fader`);
        addresses.add(`${fxReturnPath(effect)}/mix/on`);
        addresses.add(`/fx/${effect}/par/01`);
        for (let bus = 1; bus <= oscRuntimeConfig.busCount; bus += 1) {
            addresses.add(`${fxReturnPath(effect)}/mix/${busSendSegment(bus)}/level`);
            if (oscRuntimeConfig.protocol === "OSCX32M32") {
                addresses.add(`${fxReturnPath(effect)}/mix/${busSendSegment(bus)}/on`);
            }
        }
    }

    const auxCount = oscRuntimeConfig.protocol === "OSCXR" ? 1 : 6;
    for (let aux = 1; aux <= auxCount; aux += 1) {
        addresses.add(`${auxPath(aux)}/mix/fader`);
        addresses.add(`${auxPath(aux)}/mix/on`);
        for (let bus = 1; bus <= oscRuntimeConfig.busCount; bus += 1) {
            addresses.add(`${auxBusPath(aux, bus)}/level`);
            if (oscRuntimeConfig.protocol === "OSCX32M32") {
                addresses.add(`${auxBusPath(aux, bus)}/on`);
            }
        }
    }

    for (let dca = 1; dca <= oscRuntimeConfig.dcaCount; dca += 1) {
        addresses.add(`/dca/${dca}/fader`);
        addresses.add(`/dca/${dca}/on`);
    }

    if (oscRuntimeConfig.protocol === "OSCX32M32") {
        for (let matrix = 1; matrix <= 6; matrix += 1) {
            addresses.add(`/mtx/${matrix.toString().padStart(2, "0")}/mix/fader`);
            addresses.add(`/mtx/${matrix.toString().padStart(2, "0")}/mix/on`);
        }
    }

    return addresses;
}

function validateAutomationRawCommand(command: AutomationRawCommand): void {
    if (!command?.address) {
        throw new Error("Raw automation command requires an OSC address.");
    }

    const allowed = allowedAutomationRawAddresses();
    if (!allowed.has(command.address)) {
        throw new Error(
            `Unsupported raw automation OSC address "${command.address}" for protocol ${oscRuntimeConfig.protocol}. ` +
                "Do not invent OSC addresses. Use structured automation targets for known mixer operations, such as " +
                'target.kind="main_fader" for facade/main LR, or use an address documented for the active protocol.'
        );
    }
}

function rawCommandAction(input: AutomationDelayedCommandInput): AutomationAction {
    if (!input.command) {
        throw new Error("Delayed raw OSC automation requires command, or use target with toLevel/toDb for a structured delayed level change.");
    }
    const command = input.command;
    validateAutomationRawCommand(command);

    return {
        type: "delay",
        delaySeconds: input.delaySeconds,
        description: input.label || `delayed OSC ${command.address}`,
        run: async () => {
            const args = command.args?.map((arg) => coerceOscArg(arg, command.osctype));
            await osc.assertMixerOnline();
            await osc.sendRaw(command.address, args, { allowOfflineWrite: true });
        },
    };
}

function delayedStructuredLevelAction(input: AutomationDelayedCommandInput): AutomationAction {
    const ramp = rampAction({
        target: input.target!,
        toLevel: input.toLevel,
        toDb: input.toDb,
        durationSeconds: 0,
        label: input.label,
    });

    return {
        type: "delay",
        delaySeconds: input.delaySeconds,
        description: input.label || `delayed ${ramp.description || "level change"}`,
        run: async () => {
            await osc.assertMixerOnline();
            await ramp.write(ramp.to);
            const actual = await ramp.read();
            if (Math.abs(actual - ramp.to) > 0.002) {
                throw new Error(`Delayed level verification failed for ${ramp.description || "target"}: expected ${ramp.to.toFixed(6)}, read ${actual.toFixed(6)}`);
            }
        },
    };
}

function delayedAutomationAction(input: AutomationDelayedCommandInput): AutomationAction {
    if (input.target) {
        return delayedStructuredLevelAction(input);
    }
    return rawCommandAction(input);
}

function rampAction(input: AutomationRampInput): AutomationRampAction {
    const adapter = targetAdapter(input.target);
    const to = input.toLevel ?? (input.toDb === null ? 0 : input.toDb !== undefined ? dbToFaderLevel(input.toDb).level : undefined);
    if (to === undefined) {
        throw new Error("Ramp automation requires toLevel or toDb.");
    }

    return {
        type: "ramp",
        description: input.label || `ramp ${adapter.label}`,
        from: input.fromLevel,
        to: clampLevel(to),
        durationSeconds: input.durationSeconds,
        stepMs: input.stepMs,
        curve: input.curve,
        read: adapter.read,
        write: (level) => adapter.write(clampLevel(level)),
    };
}

async function muteBusBatch(buses: number[], mute: boolean): Promise<{ changed: number[]; failures: string[] }> {
    const changed: number[] = [];
    const failures: string[] = [];

    for (const bus of buses) {
        try {
            await osc.muteBusUnchecked(bus, mute);
            changed.push(bus);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`bus ${bus}: ${message}`);
            if (message.toLowerCase().includes("deconnecte") || message.toLowerCase().includes("timeout")) {
                break;
            }
        }
    }

    return { changed, failures };
}

function macroActions(steps: AutomationMacroStepInput[]): AutomationAction[] {
    return steps.map((step) => {
        if (step.type === "wait" || step.type === "delay") {
            return {
                type: "wait",
                durationSeconds: step.durationSeconds,
                description: step.label || `wait ${step.durationSeconds}s`,
            };
        }
        if (step.type === "command") {
            return rawCommandAction({
                delaySeconds: step.delaySeconds ?? 0,
                command: step.command,
                label: step.label,
            });
        }
        if (step.type === "ramp") {
            if (!("target" in step) || !step.target) {
                throw new Error("Automation macro ramp step target is required. Resolve the name first and copy the resolved target into the ramp step, for example { kind: channel_fader, channel: N }.");
            }
            return rampAction(step);
        }
        throw new Error("Unsupported automation macro step type. Use wait, command, or ramp.");
    });
}

// Define available tools
export const TOOLS: Tool[] = [
    // ========== Agent Guidance ==========
    {
        name: "get_agent_prompt",
        description: "Return the recommended system prompt for agents using this OSC MCP server. Use it to inject mixer-specific aliases, safety rules, ranges, and OSCXR/OSCX32M32 guidance into the LLM context when the host agent supports that workflow.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_speaker_context",
        description: "Return the mixer context for a recognized voice speaker. The voice agent supplies speaker='unknown' when not recognized. For known speakers, busName defaults to the speaker name unless XMS_SPEAKER_MAP overrides it; channelName is optional.",
        inputSchema: {
            type: "object",
            properties: {
                speaker: {
                    type: "string",
                    description: "Recognized speaker name from the voice agent, or unknown.",
                },
            },
            required: ["speaker"],
        },
    },
    {
        name: "osc_find_named_target",
        description: "Resolve a user-facing mixer label to concrete indexes in one deterministic scan. Use this before any operation that names a channel, bus/monitor, FX return, aux return, DCA, or matrix by label. Exact name matches win over partial/contains matches. Structured ownership phrases such as 'guitare de Claude' can match labels such as 'guitar-clode' after article, language, and limited French phonetic normalization. A unique structured match is safe to use; fuzzy matches remain suggestions requiring confirmation. If zero matches or multiple equally plausible matches are returned, ask the user to clarify instead of guessing.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Name or label to resolve, such as 'snare', 'Laurent', 'reverb', or 'choeurs'. Matching is case/accent insensitive.",
                },
                families: {
                    type: "array",
                    description: "Object families to search. For a single named target with no explicit family word, omit this field or search all families so bus names are not missed. Narrow to ['channel'] only when the user explicitly says channel/tranche/canal/source, or when resolving the source side of a clear source-to-destination command. Narrow to ['bus'] only when resolving an explicit bus/monitor/retour destination.",
                    items: {
                        type: "string",
                        enum: ["channel", "bus", "fxreturn", "aux", "dca", "matrix"],
                    },
                },
            },
            required: ["name"],
        },
    },
    {
        name: "osc_configure_mixer",
        description: "Change the active mixer connection and/or runtime channel/bus/FX/DCA limits. Omitted fields keep their current values. Changing host, port, or protocol closes the current OSC client and connects to the new mixer. Changing only counts updates resolver/overview limits without reconnecting.",
        inputSchema: {
            type: "object",
            properties: {
                host: { type: "string", description: "Mixer IP address or hostname. Omit to keep the current host." },
                port: { type: "number", description: "Mixer OSC UDP port, such as 10023 or 10024. Omit to keep the current port.", minimum: 1, maximum: 65535 },
                protocol: { type: "string", enum: ["OSCX32M32", "OSCXR", "X32", "M32", "XR"], description: "OSC protocol/address mapping. Omit to keep the current protocol." },
                channelCount: { type: "number", description: "Configured channel count for name resolution and bulk reads. Omit to keep current value.", minimum: 1 },
                busCount: { type: "number", description: "Configured bus count for name resolution and all-bus operations. Omit to keep current value.", minimum: 1 },
                fxCount: { type: "number", description: "Configured FX return/slot count for name resolution and FX reads. Omit to keep current value.", minimum: 1 },
                dcaCount: { type: "number", description: "Configured DCA count for name resolution and DCA reads. Omit to keep current value.", minimum: 1 },
            },
        },
    },
    {
        name: "osc_set_mixer_counts",
        description: "Update only the runtime channel/bus/FX/DCA limits used for name resolution, all-bus operations, and bulk reads. Omitted fields keep their current values. This never reconnects or changes host/port/protocol.",
        inputSchema: {
            type: "object",
            properties: {
                channelCount: { type: "number", description: "Runtime channel count. Omit to keep current value.", minimum: 1 },
                busCount: { type: "number", description: "Runtime bus count. Omit to keep current value.", minimum: 1 },
                fxCount: { type: "number", description: "Runtime FX return/slot count. Omit to keep current value.", minimum: 1 },
                dcaCount: { type: "number", description: "Runtime DCA count. Omit to keep current value.", minimum: 1 },
            },
        },
    },
    {
        name: "osc_automation_ramp",
        description: "Start a background automation that ramps one numeric OSC mixer target over time. Use this for fade-in, fade-out, progressive level changes, and smooth mix changes. Returns immediately with an automation id.",
        inputSchema: {
            type: "object",
            properties: {
                target: {
                    type: "object",
                    description: "Target to automate. Use channel_fader for source on main LR, channel_send for source to bus, bus_fader for a named bus/monitor fader, main_fader, fx_return_fader, fx_send, aux_fader, aux_send, matrix_fader, or raw. Never use kind='bus'; use kind='bus_fader'.",
                    properties: {
                        kind: { type: "string", enum: ["channel_fader", "channel_send", "bus_fader", "main_fader", "fx_return_fader", "fx_send", "aux_fader", "aux_send", "matrix_fader", "raw"] },
                        channel: { type: "number" },
                        bus: { type: "number" },
                        effect: { type: "number" },
                        aux: { type: "number" },
                        matrix: { type: "number" },
                        address: { type: "string", description: "Raw OSC address used for both read and write when kind=raw" },
                        readAddress: { type: "string", description: "Raw OSC read address when kind=raw" },
                        writeAddress: { type: "string", description: "Raw OSC write address when kind=raw" },
                        osctype: { type: "string", enum: ["int", "float", "string", "bool"] },
                    },
                    required: ["kind"],
                },
                toLevel: { type: "number", description: "Target normalized level 0.0 to 1.0", minimum: 0, maximum: 1 },
                toDb: { type: "number", description: "Target dB value; use this for fade-out/fade-in in dB. Values below -87 map to -inf/0.0.", minimum: -120, maximum: 20 },
                fromLevel: { type: "number", description: "Optional start normalized level; omit to read current live value first", minimum: 0, maximum: 1 },
                durationSeconds: { type: "number", minimum: 0 },
                stepMs: { type: "number", description: "Automation step period in milliseconds; default 100", minimum: 20 },
                curve: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"] },
                label: { type: "string" },
            },
            required: ["target", "durationSeconds"],
        },
    },
    {
        name: "osc_automation_delayed_command",
        description: "Schedule a delayed one-shot automation. Prefer structured target + toDb/toLevel for delayed fader/send level changes; this is protocol-aware and prevents invented OSC addresses. Raw command is allowed only for documented/allowlisted OSC addresses in the active protocol.",
        inputSchema: {
            type: "object",
            properties: {
                delaySeconds: { type: "number", minimum: 0 },
                target: {
                    type: "object",
                    description: "Structured level target for delayed fader/send writes. Use main_fader for facade/main LR, bus_fader for a named bus/monitor, channel_fader for a source on main LR, channel_send for source to bus, etc. Prefer this over raw command.",
                    properties: {
                        kind: { type: "string", enum: ["channel_fader", "channel_send", "bus_fader", "main_fader", "fx_return_fader", "fx_send", "aux_fader", "aux_send", "matrix_fader", "raw"] },
                        channel: { type: "number" },
                        bus: { type: "number" },
                        effect: { type: "number" },
                        aux: { type: "number" },
                        matrix: { type: "number" },
                        address: { type: "string" },
                        readAddress: { type: "string" },
                        writeAddress: { type: "string" },
                        osctype: { type: "string", enum: ["int", "float", "string", "bool"] },
                    },
                    required: ["kind"],
                },
                toLevel: { type: "number", description: "Target normalized level 0.0 to 1.0 when target is provided", minimum: 0, maximum: 1 },
                toDb: { type: "number", description: "Target dB value when target is provided. Use this for user dB requests such as 0 dB.", minimum: -120, maximum: 20 },
                command: {
                    type: "object",
                    description: "Advanced raw OSC command. Use only for documented addresses in the active protocol; never invent paths.",
                    properties: {
                        address: { type: "string" },
                        args: { type: "array", items: {} },
                        osctype: { type: "string", enum: ["int", "float", "string", "bool"] },
                    },
                    required: ["address"],
                },
                label: { type: "string" },
            },
            required: ["delaySeconds"],
        },
    },
    {
        name: "osc_automation_macro",
        description: "Start a background temporal macro composed of waits, allowlisted raw OSC commands, and structured ramps. Use ramp steps for known fader/send level changes so paths are protocol-aware; raw command steps are rejected unless the OSC address is documented/allowlisted for the active protocol.",
        inputSchema: {
            type: "object",
            properties: {
                label: { type: "string" },
                steps: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            type: { type: "string", enum: ["wait", "delay", "command", "ramp"] },
                            label: { type: "string" },
                            durationSeconds: { type: "number", minimum: 0 },
                            delaySeconds: { type: "number", minimum: 0 },
                            command: {
                                type: "object",
                                properties: {
                                    address: { type: "string" },
                                    args: { type: "array", items: {} },
                                    osctype: { type: "string", enum: ["int", "float", "string", "bool"] },
                                },
                            },
                            target: { type: "object" },
                            toLevel: { type: "number", minimum: 0, maximum: 1 },
                            toDb: { type: "number", minimum: -120, maximum: 20 },
                            fromLevel: { type: "number", minimum: 0, maximum: 1 },
                            stepMs: { type: "number", minimum: 20 },
                            curve: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"] },
                        },
                        required: ["type"],
                    },
                },
            },
            required: ["steps"],
        },
    },
    {
        name: "osc_automation_list",
        description: "List automation jobs and their status.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "osc_automation_cancel",
        description: "Cancel a running automation job by id.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string" },
            },
            required: ["id"],
        },
    },
    // ========== Level / dB Conversion ==========
    {
        name: "osc_db_to_fader_level",
        description: "Convert a requested fader value in dB to the nearest normalized OSC fader level using the X32/M32 161-point pseudo-log Level table. Returns the normalized level, actual table dB, and table index.",
        inputSchema: {
            type: "object",
            properties: {
                db: {
                    type: "number",
                    description: "Requested fader level in dB. Range is -87 dB to +10 dB; lower values map to -inf/0.0.",
                    minimum: -120,
                    maximum: 20,
                },
            },
            required: ["db"],
        },
    },
    {
        name: "osc_fader_level_to_db",
        description: "Convert a normalized OSC fader level (0.0 to 1.0) to the nearest dB value using the X32/M32 161-point pseudo-log Level table.",
        inputSchema: {
            type: "object",
            properties: {
                level: {
                    type: "number",
                    description: "Normalized fader level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["level"],
        },
    },
    // ========== Channel Controls ==========
    {
        name: "osc_channel_fader",
        description: "Get or set a channel fader. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action", "channel"],
        },
    },
    {
        name: "osc_mute_channel",
        description: "Mute or unmute a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["channel", "mute"],
        },
    },
    {
        name: "osc_get_mute",
        description: "Get the mute status of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_set_channel_name",
        description: "Set the name of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                name: {
                    type: "string",
                    description: "Channel name (X32 accepts up to 12 characters; longer names get silently truncated by the console)",
                },
            },
            required: ["channel", "name"],
        },
    },
    {
        name: "osc_get_channel_name",
        description: "Get the name of a channel",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    // ========== Bus Controls ==========
    {
        name: "osc_bus_fader",
        description: "Get or set a mix bus fader. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action", "bus"],
        },
    },
    {
        name: "osc_mute_bus",
        description: "Mute or unmute a mix bus",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["bus", "mute"],
        },
    },
    {
        name: "osc_mute_buses",
        description: "Mute or unmute a selected list of mix bus masters in one batch. Use for commands like 'mute les bus Mike et Laurent' after resolving each named bus. This controls the bus master on/off state, not a channel send to those buses. Do not use for 'tous les bus'; use osc_mute_all_buses for that.",
        inputSchema: {
            type: "object",
            properties: {
                buses: {
                    type: "array",
                    description: "Selected mix bus numbers within the current runtime busCount.",
                    items: { type: "number", minimum: 1 },
                    minItems: 1,
                    uniqueItems: true,
                },
                mute: { type: "boolean", description: "True to mute, false to unmute" },
            },
            required: ["buses", "mute"],
        },
    },
    {
        name: "osc_mute_all_buses",
        description: "Mute or unmute every mix bus master in one batch. Use only when the user explicitly says 'mute/coupe/désactive tous les bus' or 'unmute/réactive tous les bus' with no exceptions. For 'all buses except ...', use osc_mute_all_buses_except.",
        inputSchema: {
            type: "object",
            properties: {
                mute: { type: "boolean", description: "True to mute all buses, false to unmute all buses" },
            },
            required: ["mute"],
        },
    },
    {
        name: "osc_mute_all_buses_except",
        description: "Mute or unmute every configured mix bus master except the listed bus numbers. Use for commands like 'coupe tous les bus sauf Anto' after resolving each exception name to a bus. This controls bus masters, not channel sends.",
        inputSchema: {
            type: "object",
            properties: {
                exceptBuses: {
                    type: "array",
                    description: "Configured mix bus numbers to leave unchanged, within the current runtime busCount.",
                    items: { type: "number", minimum: 1 },
                    minItems: 1,
                    uniqueItems: true,
                },
                mute: { type: "boolean", description: "True to mute all other buses, false to unmute all other buses" },
            },
            required: ["exceptBuses", "mute"],
        },
    },
    // ========== Aux Controls ==========
    {
        name: "osc_aux_fader",
        description: "Get or set an aux return fader. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit. In OSCXR the aux return is a singleton; use aux 1.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                aux: {
                    type: "number",
                    description: "Aux number (X32: 1-6; OSCXR: use 1 for /rtn/aux)",
                    minimum: 1,
                    maximum: 6,
                },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action", "aux"],
        },
    },
    {
        name: "osc_mute_aux",
        description: "Mute or unmute an aux output",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["aux", "mute"],
        },
    },
    // ========== Sends ==========
    {
        name: "osc_channel_send_to_bus",
        description: "Get or set the send level from a channel to a mix bus. Use only when the user explicitly names both a source channel and a destination bus. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit. Do not use for mute/cut/off commands; use osc_mute_channel_to_bus for that intent.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                bus: {
                    type: "number",
                    description: "Mix bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action", "channel", "bus"],
        },
    },
    {
        name: "osc_send_to_all_buses_db",
        description: "Set a channel send level to every mix bus by dB value in one batch. Use only when the user explicitly says 'tous les bus', 'all buses', or equivalent. Do not use for a finite named list such as 'les bus Mike et Laurent'; use osc_send_to_buses_db for that. If the user also says 'sur façade/main/LR', set includeMain=true to set the channel's own main LR fader too. Do not read bus faders for this command.",
        inputSchema: {
            type: "object",
            properties: {
                channel: { type: "number", description: "Channel number (1-32)", minimum: 1, maximum: 32 },
                db: { type: "number", description: "Requested send level in dB (-87 to +10; lower values map to -inf)", minimum: -120, maximum: 20 },
                includeMain: { type: "boolean", description: "True when the user also asks for façade/main/LR; sets the source channel fader to the same dB value." },
            },
            required: ["channel", "db"],
        },
    },
    {
        name: "osc_send_to_buses_db",
        description: "Set a channel send level to a selected list of mix buses by dB value in one batch. Use for commands like '[channel] à +5 dB sur les bus Mike et Laurent' after resolving each named bus. If the user also says 'sur façade/main/LR', set includeMain=true to set the channel's own main LR fader too. Do not use for 'tous les bus'; use osc_send_to_all_buses_db for that.",
        inputSchema: {
            type: "object",
            properties: {
                channel: { type: "number", description: "Channel number (1-32)", minimum: 1, maximum: 32 },
                buses: {
                    type: "array",
                    description: "Selected mix bus numbers (1-16)",
                    items: { type: "number", minimum: 1, maximum: 16 },
                    minItems: 1,
                    uniqueItems: true,
                },
                db: { type: "number", description: "Requested send level in dB (-87 to +10; lower values map to -inf)", minimum: -120, maximum: 20 },
                includeMain: { type: "boolean", description: "True when the user also asks for façade/main/LR; sets the source channel fader to the same dB value." },
            },
            required: ["channel", "buses", "db"],
        },
    },
    {
        name: "osc_mute_channel_to_bus",
        description: "Mute/unmute a channel send to a specific bus. Use this for 'coupe/mute/désactive [channel] sur [bus]' and 'remets/réactive [channel] sur [bus]'. In OSCXR this is unsupported because XR exposes only whole-channel mute, not bus-specific channel mute.",
        inputSchema: {
            type: "object",
            properties: {
                channel: { type: "number", description: "Channel number (1-32)", minimum: 1, maximum: 32 },
                bus: { type: "number", description: "Mix bus number (1-16)", minimum: 1, maximum: 16 },
                mute: { type: "boolean", description: "True to mute, false to unmute" },
            },
            required: ["channel", "bus", "mute"],
        },
    },
    {
        name: "osc_fx_send_to_bus",
        description: "Get or set the send level from an FX return to a mix bus. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit. Do not use for mute/cut/off commands; use osc_mute_fx_to_bus for that intent.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                effect: { type: "number", description: "FX return/effect number within the current runtime fxCount.", minimum: 1 },
                bus: { type: "number", description: "Mix bus number (1-16)", minimum: 1, maximum: 16 },
                unit: { type: "string", enum: ["level", "percent", "db"], description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set." },
                value: { type: "number", description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.", minimum: -120, maximum: 100 },
            },
            required: ["action", "effect", "bus"],
        },
    },
    {
        name: "osc_mute_fx_to_bus",
        description: "Mute/unmute an FX return send to a specific bus. Use this for 'coupe/mute/désactive [FX] sur [bus]' and 'remets/réactive [FX] sur [bus]'. In OSCXR this is unsupported because XR exposes only whole-FX-return mute, not bus-specific FX mute.",
        inputSchema: {
            type: "object",
            properties: {
                effect: { type: "number", description: "FX return/effect number within the current runtime fxCount.", minimum: 1 },
                bus: { type: "number", description: "Mix bus number (1-16)", minimum: 1, maximum: 16 },
                mute: { type: "boolean", description: "True to mute, false to unmute" },
            },
            required: ["effect", "bus", "mute"],
        },
    },
    {
        name: "osc_aux_send_to_bus",
        description: "Get or set the send level from an aux return to a mix bus. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit. Do not use for mute/cut/off commands; use osc_mute_aux_to_bus for that intent. In OSCXR the aux return is a singleton; use aux 1.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                aux: { type: "number", description: "Aux return number (X32: 1-6; OSCXR: use 1 for /rtn/aux)", minimum: 1, maximum: 6 },
                bus: { type: "number", description: "Mix bus number (1-16)", minimum: 1, maximum: 16 },
                unit: { type: "string", enum: ["level", "percent", "db"], description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set." },
                value: { type: "number", description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.", minimum: -120, maximum: 100 },
            },
            required: ["action", "aux", "bus"],
        },
    },
    {
        name: "osc_mute_aux_to_bus",
        description: "Mute/unmute an aux return send to a specific bus. Use this for 'coupe/mute/désactive [aux] sur [bus]' and 'remets/réactive [aux] sur [bus]'. In OSCXR this is unsupported because XR exposes only whole-aux-return mute, not bus-specific aux mute.",
        inputSchema: {
            type: "object",
            properties: {
                aux: { type: "number", description: "Aux return number (1-6)", minimum: 1, maximum: 6 },
                bus: { type: "number", description: "Mix bus number (1-16)", minimum: 1, maximum: 16 },
                mute: { type: "boolean", description: "True to mute, false to unmute" },
            },
            required: ["aux", "bus", "mute"],
        },
    },
    {
        name: "osc_send_to_aux",
        description: "Set the send level from a channel to an aux output",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
                aux: {
                    type: "number",
                    description: "Aux number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                level: {
                    type: "number",
                    description: "Send level (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["channel", "aux", "level"],
        },
    },
    // ========== Main Mix ==========
    {
        name: "osc_main_fader",
        description: "Get or set the main LR fader. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action"],
        },
    },
    {
        name: "osc_mute_main",
        description: "Mute or unmute the main LR mix",
        inputSchema: {
            type: "object",
            properties: {
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["mute"],
        },
    },
    // ========== Matrix ==========
    {
        name: "osc_matrix_fader",
        description: "Get or set a matrix fader. Use unit='db' for dB requests; default unit='db' for reads; set actions require explicit unit. X32/M32 only; matrices are not mapped in OSCXR.",
        inputSchema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["get", "set"] },
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                unit: {
                    type: "string",
                    enum: ["level", "percent", "db"],
                    description: "level = normalized 0.0..1.0; percent = 0..100%; db = X32/M32 fader dB table. Defaults to db for reads; required for set.",
                },
                value: {
                    type: "number",
                    description: "Required for action='set', together with explicit unit. Normalized level when unit='level', percentage when unit='percent', dB value when unit='db'.",
                    minimum: -120,
                    maximum: 100,
                },
            },
            required: ["action", "matrix"],
        },
    },
    {
        name: "osc_mute_matrix",
        description: "Mute or unmute a matrix output",
        inputSchema: {
            type: "object",
            properties: {
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
                mute: {
                    type: "boolean",
                    description: "True to mute, false to unmute",
                },
            },
            required: ["matrix", "mute"],
        },
    },
    // ========== Effects ==========
    {
        name: "osc_get_effect_on",
        description: "Get whether an FX return channel is unmuted (X32 FX slots are always instantiated; this checks the FX return mute state)",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number within the current runtime fxCount.",
                    minimum: 1,
                },
            },
            required: ["effect"],
        },
    },
    {
        name: "osc_get_all_effects",
        description: "Get a summary of all configured FX slots using the current runtime fxCount, including type and first 8 parameters",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_channel_strip",
        description: "Get full channel diagnostic strip: name, raw normalized fader, mute, pan, headamp (gain/phantom), EQ, gate, compressor, and bus sends. For a simple user-facing channel fader level in dB, use osc_channel_fader instead.",
        inputSchema: {
            type: "object",
            properties: {
                channel: {
                    type: "number",
                    description: "Channel number (1-32)",
                    minimum: 1,
                    maximum: 32,
                },
            },
            required: ["channel"],
        },
    },
    {
        name: "osc_get_bus_strip",
        description: "Get full mix bus diagnostic strip: name, raw normalized fader, mute, pan, EQ, dynamics. For a simple user-facing bus fader level in dB, use osc_bus_fader instead.",
        inputSchema: {
            type: "object",
            properties: {
                bus: {
                    type: "number",
                    description: "Bus number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
            },
            required: ["bus"],
        },
    },
    {
        name: "osc_get_aux_strip",
        description: "Get aux input diagnostic strip: name, raw normalized fader, mute, pan, source. For a simple user-facing aux fader level in dB, use osc_aux_fader instead.",
        inputSchema: {
            type: "object",
            properties: {
                aux: {
                    type: "number",
                    description: "Aux input number (1-8)",
                    minimum: 1,
                    maximum: 8,
                },
            },
            required: ["aux"],
        },
    },
    {
        name: "osc_get_fxreturn_strip",
        description: "Get FX return diagnostic strip: name, raw normalized fader, mute, pan. Use this for FX return diagnostics; the fader field is a raw normalized OSC value.",
        inputSchema: {
            type: "object",
            properties: {
                fxreturn: {
                    type: "number",
                    description: "FX return number within the current runtime fxCount.",
                    minimum: 1,
                },
            },
            required: ["fxreturn"],
        },
    },
    {
        name: "osc_get_matrix_strip",
        description: "Get matrix output diagnostic strip: name, raw normalized fader, mute, pan, EQ. For a simple user-facing matrix fader level in dB, use osc_matrix_fader instead.",
        inputSchema: {
            type: "object",
            properties: {
                matrix: {
                    type: "number",
                    description: "Matrix number (1-6)",
                    minimum: 1,
                    maximum: 6,
                },
            },
            required: ["matrix"],
        },
    },
    {
        name: "osc_get_dca",
        description: "Get DCA group diagnostic state: name, raw normalized fader, mute.",
        inputSchema: {
            type: "object",
            properties: {
                dca: {
                    type: "number",
                    description: "DCA group number within the current runtime dcaCount.",
                    minimum: 1,
                },
            },
            required: ["dca"],
        },
    },
    {
        name: "osc_get_main_strip",
        description: "Get main stereo bus diagnostic strip: raw normalized fader, mute, pan, 6-band EQ, dynamics, plus mono bus status. For a simple user-facing main LR level in dB, use osc_main_fader instead.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_get_headamp",
        description: "Get headamp/preamp settings: gain and phantom power for a given headamp index (0-63 for local, 64-127 for AES50-A, 128-191 for AES50-B)",
        inputSchema: {
            type: "object",
            properties: {
                index: {
                    type: "number",
                    description: "Headamp index (0-191)",
                    minimum: 0,
                    maximum: 191,
                },
            },
            required: ["index"],
        },
    },
    {
        name: "osc_get_console_overview",
        description: "Get a high-level overview of the ENTIRE console using the current runtime channel/bus/FX/DCA limits, plus matrices, aux inputs, and main bus. Warning: this reads many parameters so takes several seconds.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "osc_set_effect_on",
        description: "Mute/unmute an FX return channel (X32 FX are always instantiated; this controls the FX return mute)",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number within the current runtime fxCount.",
                    minimum: 1,
                },
                on: {
                    type: "boolean",
                    description: "True to enable, false to disable",
                },
            },
            required: ["effect", "on"],
        },
    },
    {
        name: "osc_set_effect_param",
        description: "Set a parameter value for an effect",
        inputSchema: {
            type: "object",
            properties: {
                effect: {
                    type: "number",
                    description: "Effect number within the current runtime fxCount.",
                    minimum: 1,
                },
                param: {
                    type: "number",
                    description: "Parameter number (1-16)",
                    minimum: 1,
                    maximum: 16,
                },
                value: {
                    type: "number",
                    description: "Parameter value (0.0 to 1.0)",
                    minimum: 0,
                    maximum: 1,
                },
            },
            required: ["effect", "param", "value"],
        },
    },
    // ========== Status ==========
    {
        name: "osc_get_mixer_status",
        description: "Get the currently connected mixer identity and connection state. Always performs a fresh live /xinfo query; never answer mixer connection/model/version from cached state, prior results, or assumptions.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    // ========== Custom Commands ==========
    // ========== Application Controls ==========
];

export function getOscToolSummaries(): Array<{ name: string; description: string }> {
    return TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
    }));
}

export function getOscResourceSummaries(): Array<{
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
}> {
    return [
        {
            uri: PROMPT_RESOURCE_URI,
            name: "XMSeries MCP Agent Prompt",
            title: "XMSeries Mixer Assistant Prompt",
            description: "Contents of PROMPT.md for agents that inject MCP resources into model instructions.",
            mimeType: "text/markdown",
        },
    ];
}

// Create MCP server
export function createOscMcpServer(): Server {
const server = new Server(
    {
        name: "osc-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
            prompts: {},
            resources: {},
        },
    }
);

// Expose PROMPT.md as both a prompt and a resource. The MCP host/agent decides
// whether to inject it into the LLM context.
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
        prompts: [
            {
                name: PROMPT_NAME,
                title: "XMSeries Mixer Assistant",
                description: "Recommended system prompt for agents controlling mixers through this OSC MCP server.",
            },
            {
                name: LEGACY_PROMPT_NAME,
                title: "XMSeries Mixer Assistant",
                description: "Legacy prompt name for agents controlling mixers through this OSC MCP server.",
            },
        ],
    };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (![PROMPT_NAME, LEGACY_PROMPT_NAME].includes(request.params.name)) {
        throw new Error(`Unknown prompt: ${request.params.name}`);
    }

    const prompt = await readAgentPrompt();
    return {
        description: "Recommended system prompt for agents controlling mixers through this OSC MCP server.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: prompt,
                },
            },
        ],
    };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: getOscResourceSummaries(),
    };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== PROMPT_RESOURCE_URI) {
        throw new Error(`Unknown resource: ${request.params.uri}`);
    }

    const prompt = await readAgentPrompt();
    return {
        contents: [
            {
                uri: request.params.uri,
                mimeType: "text/markdown",
                text: prompt,
            },
        ],
    };
});

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        osc.clearOscCommandLog();
        const result = await (async () => {
        switch (name) {
            case "get_agent_prompt": {
                const prompt = await readAgentPrompt();
                return {
                    content: [
                        {
                            type: "text",
                            text: prompt,
                        },
                    ],
                };
            }

            case "osc_get_speaker_context": {
                const { speaker } = args as { speaker?: string };
                return {
                    content: [
                        {
                            type: "text",
                            text: speakerContextPayload(speaker || "unknown"),
                        },
                    ],
                };
            }

            case "osc_find_named_target": {
                const { name: targetName, families } = args as { name: string; families?: NamedTargetFamily[] };
                const selectedFamilies =
                    families && families.length > 0
                        ? families.filter((family): family is NamedTargetFamily =>
                              NAMED_TARGET_FAMILIES.includes(family as NamedTargetFamily)
                          )
                        : NAMED_TARGET_FAMILIES;
                const matches = await findNamedTargets(targetName, selectedFamilies);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    query: targetName,
                                    searchedFamilies: selectedFamilies,
                                    matches,
                                    unique: matches.length === 1,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            case "osc_configure_mixer": {
                const result = await configureOscRuntime(args as unknown as {
                    host?: string;
                    port?: number;
                    protocol?: string;
                    channelCount?: number | null;
                    busCount?: number | null;
                    fxCount?: number | null;
                    dcaCount?: number | null;
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    reconnected: result.reconnect,
                                    previous: result.previous,
                                    current: result.current,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            case "osc_set_mixer_counts": {
                const input = args as unknown as {
                    channelCount?: number | null;
                    busCount?: number | null;
                    fxCount?: number | null;
                    dcaCount?: number | null;
                };
                if (
                    input.channelCount === undefined && input.busCount === undefined &&
                    input.fxCount === undefined && input.dcaCount === undefined
                ) {
                    throw new Error("At least one of channelCount, busCount, fxCount, or dcaCount is required.");
                }
                const result = await configureOscRuntime(input);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(
                                {
                                    reconnected: result.reconnect,
                                    previous: result.previous,
                                    current: result.current,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            }

            case "osc_automation_ramp": {
                const input = args as unknown as AutomationRampInput;
                const action = rampAction(input);
                const job = automation.start(input.label || action.description || "ramp automation", [action]);
                return {
                    content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
                };
            }

            case "osc_automation_delayed_command": {
                const input = args as unknown as AutomationDelayedCommandInput;
                const action = delayedAutomationAction(input);
                const job = automation.start(input.label || action.description || "delayed automation command", [action]);
                return {
                    content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
                };
            }

            case "osc_automation_macro": {
                const input = args as { label?: string; steps: AutomationMacroStepInput[] };
                await osc.assertMixerOnline();
                const actions = macroActions(input.steps || []);
                const job = automation.start(input.label || "temporal macro", actions);
                return {
                    content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
                };
            }

            case "osc_automation_list": {
                return {
                    content: [{ type: "text", text: JSON.stringify(automation.list(), null, 2) }],
                };
            }

            case "osc_automation_cancel": {
                const { id } = args as { id: string };
                const job = automation.cancel(id);
                return {
                    content: [{ type: "text", text: job ? JSON.stringify(job, null, 2) : `Automation job not found: ${id}` }],
                };
            }

            // ========== Level / dB Conversion ==========
            case "osc_db_to_fader_level": {
                const { db } = args as { db: number };
                return {
                    content: [{ type: "text", text: levelDbPayload(dbToFaderLevel(db)) }],
                };
            }

            case "osc_fader_level_to_db": {
                const { level } = args as { level: number };
                return {
                    content: [{ type: "text", text: faderDbPayload(faderLevelToDb(level)) }],
                };
            }

            // ========== Channel Controls ==========
            case "osc_channel_fader": {
                const { channel, ...levelInput } = args as unknown as { channel: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Channel ${channel} fader`;
                if (operation.action === "get") {
                    const level = await osc.getFader(channel);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.setFader(channel, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_channel": {
                const { channel, mute } = args as { channel: number; mute: boolean };
                await osc.muteChannel(channel, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_get_mute": {
                const { channel } = args as { channel: number };
                const mute = await osc.getMute(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} is ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_set_channel_name": {
                const { channel, name } = args as { channel: number; name: string };
                await osc.setChannelName(channel, name);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} name to "${name}"`,
                        },
                    ],
                };
            }

            case "osc_get_channel_name": {
                const { channel } = args as { channel: number };
                const name = await osc.getChannelName(channel);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Channel ${channel} name is "${name}"`,
                        },
                    ],
                };
            }

            // ========== Bus Controls ==========
            case "osc_bus_fader": {
                const { bus, ...levelInput } = args as unknown as { bus: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Bus ${bus} fader`;
                if (operation.action === "get") {
                    const level = await osc.getBusFader(bus);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.setBusFader(bus, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_bus": {
                const { bus, mute } = args as { bus: number; mute: boolean };
                await osc.muteBus(bus, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Bus ${bus} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            case "osc_mute_buses": {
                const { buses, mute } = args as { buses: number[]; mute: boolean };
                const uniqueBuses = Array.from(new Set(buses));
                const invalidBuses = uniqueBuses.filter((bus) => !Number.isInteger(bus) || bus < 1 || bus > oscRuntimeConfig.busCount);
                if (invalidBuses.length > 0) {
                    throw new Error(`Invalid bus number(s): ${invalidBuses.join(", ")}. Configured bus range is 1 to ${oscRuntimeConfig.busCount}.`);
                }
                if (uniqueBuses.length === 0) {
                    throw new Error(`At least one bus number from 1 to ${oscRuntimeConfig.busCount} is required`);
                }
                const { changed, failures } = await muteBusBatch(uniqueBuses, mute);
                if (failures.length > 0) {
                    throw new Error(`Certaines commandes bus ont mal ete executees. Reussies: ${changed.join(", ") || "aucune"}. Echecs: ${failures.join(" | ")}`);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Buses ${changed.join(", ")} ${mute ? "muted" : "unmuted"} and verified`,
                        },
                    ],
                };
            }

            case "osc_mute_all_buses": {
                const { mute } = args as { mute: boolean };
                const buses = namedTargetRange("bus");
                const { changed, failures } = await muteBusBatch(buses, mute);
                if (failures.length > 0) {
                    throw new Error(`Certaines commandes bus ont mal ete executees. Reussies: ${changed.join(", ") || "aucune"}. Echecs: ${failures.join(" | ")}`);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `All ${changed.length} buses ${mute ? "muted" : "unmuted"} and verified`,
                        },
                    ],
                };
            }

            case "osc_mute_all_buses_except": {
                const { exceptBuses, mute } = args as { exceptBuses: number[]; mute: boolean };
                const uniqueExceptBuses = Array.from(new Set(exceptBuses));
                const invalidBuses = uniqueExceptBuses.filter((bus) => !Number.isInteger(bus) || bus < 1 || bus > oscRuntimeConfig.busCount);
                if (invalidBuses.length > 0) {
                    throw new Error(`Invalid exception bus number(s): ${invalidBuses.join(", ")}. Configured bus range is 1 to ${oscRuntimeConfig.busCount}.`);
                }

                const protectedBuses = new Set(uniqueExceptBuses);
                const buses = namedTargetRange("bus").filter((bus) => !protectedBuses.has(bus));
                if (buses.length === 0) {
                    throw new Error("No buses left to change after applying exceptions.");
                }

                const { changed, failures } = await muteBusBatch(buses, mute);
                if (failures.length > 0) {
                    throw new Error(`Certaines commandes bus ont mal ete executees. Reussies: ${changed.join(", ") || "aucune"}. Echecs: ${failures.join(" | ")}`);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Buses ${changed.join(", ")} ${mute ? "muted" : "unmuted"} and verified; left unchanged: ${uniqueExceptBuses.join(", ")}`,
                        },
                    ],
                };
            }



            // ========== Aux Controls ==========
            case "osc_aux_fader": {
                const { aux, ...levelInput } = args as unknown as { aux: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Aux ${aux} fader`;
                if (operation.action === "get") {
                    const level = await osc.getAuxFader(aux);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.setAuxFader(aux, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_aux": {
                const { aux, mute } = args as { aux: number; mute: boolean };
                await osc.muteAux(aux, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Aux ${aux} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            // ========== Sends ==========
            case "osc_channel_send_to_bus": {
                const { channel, bus, ...levelInput } = args as unknown as { channel: number; bus: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Channel ${channel} send to bus ${bus}`;
                if (operation.action === "get") {
                    const level = await osc.getSendToBus(channel, bus);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.sendToBus(channel, bus, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_send_to_all_buses_db": {
                const { channel, db, includeMain } = args as { channel: number; db: number; includeMain?: boolean };
                const converted = dbToFaderLevel(db);
                const buses = namedTargetRange("bus");
                await osc.assertMixerOnline();
                for (const bus of buses) {
                    await osc.sendToBusUnchecked(channel, bus, converted.level);
                }
                if (includeMain) {
                    await osc.setFaderUnchecked(channel, converted.level);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} send to all ${buses.length} buses to ${formatDb(converted.db)} (level ${converted.level.toFixed(4)}, table index ${converted.index}${converted.clipped ? ", clipped" : ""})${includeMain ? " and set its main LR fader to the same value" : ""}`,
                        },
                    ],
                };
            }

            case "osc_send_to_buses_db": {
                const { channel, buses, db, includeMain } = args as { channel: number; buses: number[]; db: number; includeMain?: boolean };
                const uniqueBuses = Array.from(new Set(buses)).filter((bus) => Number.isInteger(bus) && bus >= 1 && bus <= oscRuntimeConfig.busCount);
                if (uniqueBuses.length === 0) {
                    throw new Error(`At least one valid bus number from 1 to ${oscRuntimeConfig.busCount} is required`);
                }
                const converted = dbToFaderLevel(db);
                await osc.assertMixerOnline();
                for (const bus of uniqueBuses) {
                    await osc.sendToBusUnchecked(channel, bus, converted.level);
                }
                if (includeMain) {
                    await osc.setFaderUnchecked(channel, converted.level);
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} send to buses ${uniqueBuses.join(", ")} to ${formatDb(converted.db)} (level ${converted.level.toFixed(4)}, table index ${converted.index}${converted.clipped ? ", clipped" : ""})${includeMain ? " and set its main LR fader to the same value" : ""}`,
                        },
                    ],
                };
            }

            case "osc_mute_channel_to_bus": {
                const { channel, bus, mute } = args as { channel: number; bus: number; mute: boolean };
                await osc.muteChannelToBus(channel, bus, mute);
                return {
                    content: [{ type: "text", text: `${mute ? "Muted" : "Unmuted"} channel ${channel} send to bus ${bus}` }],
                };
            }

            case "osc_fx_send_to_bus": {
                const { effect, bus, ...levelInput } = args as unknown as { effect: number; bus: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `FX return ${effect} send to bus ${bus}`;
                if (operation.action === "get") {
                    const level = await osc.getFxToBus(effect, bus);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.sendFxToBus(effect, bus, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_fx_to_bus": {
                const { effect, bus, mute } = args as { effect: number; bus: number; mute: boolean };
                await osc.muteFxToBus(effect, bus, mute);
                return {
                    content: [{ type: "text", text: `${mute ? "Muted" : "Unmuted"} FX return ${effect} send to bus ${bus}` }],
                };
            }

            case "osc_aux_send_to_bus": {
                const { aux, bus, ...levelInput } = args as unknown as { aux: number; bus: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Aux return ${aux} send to bus ${bus}`;
                if (operation.action === "get") {
                    const level = await osc.getAuxToBus(aux, bus);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.sendAuxToBus(aux, bus, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_aux_to_bus": {
                const { aux, bus, mute } = args as { aux: number; bus: number; mute: boolean };
                await osc.muteAuxToBus(aux, bus, mute);
                return {
                    content: [{ type: "text", text: `${mute ? "Muted" : "Unmuted"} aux return ${aux} send to bus ${bus}` }],
                };
            }

            case "osc_send_to_aux": {
                const { channel, aux, level } = args as {
                    channel: number;
                    aux: number;
                    level: number;
                };
                await osc.sendToAux(channel, aux, level);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set channel ${channel} send to aux ${aux} at ${(level * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            // ========== Main Mix ==========
            case "osc_main_fader": {
                const operation = parseLevelOperation(args as unknown as LevelToolInput);
                const label = "Main LR fader";
                if (operation.action === "get") {
                    const level = await osc.getMainFader();
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.setMainFader(target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_main": {
                const { mute } = args as { mute: boolean };
                await osc.muteMain(mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Main LR mix ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            // ========== Matrix ==========
            case "osc_matrix_fader": {
                const { matrix, ...levelInput } = args as unknown as { matrix: number } & LevelToolInput;
                const operation = parseLevelOperation(levelInput);
                const label = `Matrix ${matrix} fader`;
                if (operation.action === "get") {
                    const level = await osc.getMatrixFader(matrix);
                    return { content: [{ type: "text", text: formatLevelRead(label, level, operation.unit) }] };
                }

                const target = levelValueToNormalized(operation);
                await osc.setMatrixFader(matrix, target.level);
                return { content: [{ type: "text", text: `Set ${label.toLowerCase()} to ${target.text}` }] };
            }

            case "osc_mute_matrix": {
                const { matrix, mute } = args as {
                    matrix: number;
                    mute: boolean;
                };
                await osc.muteMatrix(matrix, mute);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Matrix ${matrix} ${mute ? "muted" : "unmuted"}`,
                        },
                    ],
                };
            }

            // ========== Effects ==========

            case "osc_get_effect_on": {
                const { effect } = args as { effect: number };
                const fxOn = await osc.getEffectOn(effect);
                return {
                    content: [{ type: "text", text: `FX slot ${effect} is ${fxOn ? "enabled" : "disabled"}` }],
                };
            }


            case "osc_get_all_effects": {
                const allFx = await osc.getAllEffects();
                return {
                    content: [{ type: "text", text: `All FX slots:\n${JSON.stringify(allFx, null, 2)}` }],
                };
            }

            case "osc_get_channel_strip": {
                const { channel } = args as { channel: number };
                const strip = await osc.getChannelStrip(channel);
                return {
                    content: [{ type: "text", text: `Channel ${channel} full strip:\n${JSON.stringify(strip, null, 2)}` }],
                };
            }

            case "osc_get_bus_strip": {
                const { bus } = args as { bus: number };
                const busStrip = await osc.getBusStrip(bus);
                return {
                    content: [{ type: "text", text: `Bus ${bus} strip:\n${JSON.stringify(busStrip, null, 2)}` }],
                };
            }

            case "osc_get_aux_strip": {
                const { aux } = args as { aux: number };
                const auxStrip = await osc.getAuxStrip(aux);
                return {
                    content: [{ type: "text", text: `Aux ${aux} strip:\n${JSON.stringify(auxStrip, null, 2)}` }],
                };
            }

            case "osc_get_fxreturn_strip": {
                const { fxreturn } = args as { fxreturn: number };
                const fxrStrip = await osc.getFxReturnStrip(fxreturn);
                return {
                    content: [{ type: "text", text: `FX Return ${fxreturn} strip:\n${JSON.stringify(fxrStrip, null, 2)}` }],
                };
            }

            case "osc_get_matrix_strip": {
                const { matrix } = args as { matrix: number };
                const mtxStrip = await osc.getMatrixStrip(matrix);
                return {
                    content: [{ type: "text", text: `Matrix ${matrix} strip:\n${JSON.stringify(mtxStrip, null, 2)}` }],
                };
            }

            case "osc_get_dca": {
                const { dca } = args as { dca: number };
                const dcaData = await osc.getDCA(dca);
                return {
                    content: [{ type: "text", text: `DCA ${dca}:\n${JSON.stringify(dcaData, null, 2)}` }],
                };
            }

            case "osc_get_main_strip": {
                const mainStrip = await osc.getMainStrip();
                return {
                    content: [{ type: "text", text: `Main bus:\n${JSON.stringify(mainStrip, null, 2)}` }],
                };
            }

            case "osc_get_headamp": {
                const { index } = args as { index: number };
                const ha = await osc.getHeadamp(index);
                return {
                    content: [{ type: "text", text: `Headamp ${index}:\n${JSON.stringify(ha, null, 2)}` }],
                };
            }

            case "osc_get_console_overview": {
                const overview = await osc.getConsoleOverview();
                return {
                    content: [{ type: "text", text: `Console overview:\n${JSON.stringify(overview, null, 2)}` }],
                };
            }

            case "osc_set_effect_on": {
                const { effect, on } = args as {
                    effect: number;
                    on: boolean;
                };
                await osc.setEffectOn(effect, on);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Effect ${effect} ${on ? "enabled" : "disabled"}`,
                        },
                    ],
                };
            }

            case "osc_set_effect_param": {
                const { effect, param, value } = args as {
                    effect: number;
                    param: number;
                    value: number;
                };
                await osc.setEffectParam(effect, param, value);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Set effect ${effect} parameter ${param} to ${(value * 100).toFixed(1)}%`,
                        },
                    ],
                };
            }

            // ========== Status ==========
            case "osc_get_mixer_status": {
                const status = await getOscMixerStatus();
                return {
                    content: [
                        {
                            type: "text",
                            text: `Mixer Status:\n${JSON.stringify(status, null, 2)}`,
                        },
                    ],
                };
            }

            // ========== Custom Commands ==========

            // ========== Application Controls ==========




            default:
                return {
                    content: [
                        {
                            type: "text",
                            text: `Unknown tool: ${name}`,
                        },
                    ],
                    isError: true,
                };
        }
        })();
        return appendOscTrace(result, osc.drainOscCommandLog(), name);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof MixerDisconnectedError || message.startsWith("Le mixeur est deconnecté")) {
            return appendOscTrace({
                content: [
                    {
                        type: "text",
                        text: message,
                    },
                ],
                isError: true,
            }, osc.drainOscCommandLog(), name);
        }
        return appendOscTrace({
            content: [
                {
                    type: "text",
                    text: `Error executing ${name}: ${message}`,
                },
            ],
            isError: true,
        }, osc.drainOscCommandLog(), name);
    }
});

return server;
}

// Start server
async function main() {
    console.error("Starting OSC MCP Server...");
    console.error(`Connecting to OSC device at ${oscRuntimeConfig.host}:${oscRuntimeConfig.port} (${oscRuntimeConfig.protocol})`);
    console.error(`OSC limits: ${oscRuntimeConfig.channelCount} channel(s), ${oscRuntimeConfig.busCount} bus(es), ${oscRuntimeConfig.fxCount} FX slot/return(s), ${oscRuntimeConfig.dcaCount} DCA group(s)`);

    await connectOscDevice();

    const server = createOscMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("OSC MCP Server running");
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}
