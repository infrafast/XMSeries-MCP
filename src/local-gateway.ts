import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
    GATEWAY_PROTOCOL,
    TokenStore,
    type AnalyzeCommandResult,
    type ExecuteCommandResult,
} from "@infrafast/stage-command-core";
import { dbToFaderLevel, faderLevelToDb, formatDb } from "./level-table.js";
import { isLocalGatewayEnabled } from "@infrafast/stage-command-core";
import { canonicalizeNaturalFrenchCommand, isAutomationStatusUtterance, isMainLevelReadUtterance, isMixerStatusUtterance } from "./local-language.js";
import { parseDeterministicMixerIntent } from "./local-intent-parser.js";

export type LocalMixerTargetFamily =
    | "channel"
    | "bus"
    | "fxreturn"
    | "aux"
    | "dca"
    | "matrix"
    | "main";

export type LocalMixerMatchType = "exact" | "contains" | "structured" | "fuzzy";

export interface LocalMixerTarget {
    family: LocalMixerTargetFamily;
    index: number;
    name: string;
    matchType: LocalMixerMatchType;
}

export interface LocalSpeakerMixerContext {
    speaker: string;
    known: boolean;
    monitorDestination: { kind: "bus"; name: string } | { kind: "main" } | null;
    busName: string | null;
    channelName: string | null;
    source: string;
}

export type LocalRelativeDirection = "up" | "down";
export type LocalRelativeAmount = "little" | "normal" | "much";

export type LocalSequenceAction =
    | { type: "wait"; durationSeconds: number; description?: string }
    | { type: "run"; description: string; run: () => Promise<void> }
    | {
          type: "ramp";
          description: string;
          from?: number;
          to: number | (() => Promise<number>);
          durationSeconds: number;
          read: () => Promise<number>;
          write: (value: number) => Promise<void>;
      };

export interface LocalMixerGatewayAdapter {
    resolve(query: string, families?: LocalMixerTargetFamily[]): Promise<LocalMixerTarget[]>;
    status(): Promise<any>;
    readLevel(target: LocalMixerTarget): Promise<number>;
    readChannelMute(target: LocalMixerTarget): Promise<boolean>;
    readEffectOn(target: LocalMixerTarget): Promise<boolean>;
    readChannelName(channel: number): Promise<string>;
    writeLevel(target: LocalMixerTarget, level: number): Promise<void>;
    setMute(target: LocalMixerTarget, mute: boolean): Promise<void>;
    readSendLevel(source: LocalMixerTarget, destination: LocalMixerTarget): Promise<number>;
    writeSendLevel(source: LocalMixerTarget, destination: LocalMixerTarget, level: number): Promise<void>;
    writeChannelToAux(source: LocalMixerTarget, aux: number, level: number): Promise<void>;
    setSendMute(source: LocalMixerTarget, destination: LocalMixerTarget, mute: boolean): Promise<void>;
    startLevelRamp(target: LocalMixerTarget, toLevel: number, durationSeconds: number, fromLevel?: number): Promise<string>;
    startSendRamp(source: LocalMixerTarget, destination: LocalMixerTarget, toLevel: number, durationSeconds: number, fromLevel?: number): Promise<string>;
    startDelayedLevelRamp(target: LocalMixerTarget, toLevel: number, durationSeconds: number, delaySeconds: number, fromLevel?: number): Promise<string>;
    startDelayedSendRamp(source: LocalMixerTarget, destination: LocalMixerTarget, toLevel: number, durationSeconds: number, delaySeconds: number, fromLevel?: number): Promise<string>;
    startSequence(actions: LocalSequenceAction[]): Promise<string>;
    scheduleLevel(target: LocalMixerTarget, toLevel: number, delaySeconds: number): Promise<string>;
    scheduleMute(target: LocalMixerTarget, mute: boolean, delaySeconds: number): Promise<string>;
    scheduleSend(source: LocalMixerTarget, destination: LocalMixerTarget, toLevel: number, delaySeconds: number): Promise<string>;
    scheduleSendMute(source: LocalMixerTarget, destination: LocalMixerTarget, mute: boolean, delaySeconds: number): Promise<string>;
    listAutomations(): Promise<Array<{ id: string; label?: string; status: string; currentAction?: string; error?: string }>>;
    cancelAutomation(id: string): Promise<{ id: string; label?: string; status: string } | null>;
    muteChannelBatch(targets: LocalMixerTarget[], mute: boolean): Promise<void>;
    muteAllChannels(mute: boolean, except?: LocalMixerTarget[]): Promise<void>;
    muteBusBatch(targets: LocalMixerTarget[], mute: boolean): Promise<void>;
    muteAllBuses(mute: boolean, except?: LocalMixerTarget[]): Promise<void>;
    writeSendBatchDb(source: LocalMixerTarget, destinations: LocalMixerTarget[], db: number, includeMain: boolean): Promise<void>;
    writeSendAllBusesDb(source: LocalMixerTarget, db: number, includeMain: boolean): Promise<void>;
    speakerContext(speaker: string): Promise<LocalSpeakerMixerContext>;
    adjustQualitativeLevel(
        target: LocalMixerTarget,
        direction: LocalRelativeDirection,
        amount: LocalRelativeAmount,
    ): Promise<{ beforeDb: number; targetDb: number }>;
    adjustQualitativeSend(
        source: LocalMixerTarget,
        destination: LocalMixerTarget,
        direction: LocalRelativeDirection,
        amount: LocalRelativeAmount,
    ): Promise<{ beforeDb: number; targetDb: number }>;
    previewQualitativeLevel(
        target: LocalMixerTarget,
        direction: LocalRelativeDirection,
        amount: LocalRelativeAmount,
    ): Promise<{ beforeDb: number; targetDb: number; targetLevel: number }>;
    previewQualitativeSend(
        source: LocalMixerTarget,
        destination: LocalMixerTarget,
        direction: LocalRelativeDirection,
        amount: LocalRelativeAmount,
    ): Promise<{ beforeDb: number; targetDb: number; targetLevel: number }>;
}

type LevelUnit = "db" | "percent" | "level";
type LevelValue = { unit: LevelUnit; value: number };

type Intent =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string }
    | { kind: "read_mute"; targetQuery: string }
    | { kind: "read_effect_on"; targetQuery: string }
    | { kind: "read_channel_name"; channel: number }
    | { kind: "set_level"; targetQuery: string; unit: LevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; unit: LevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_read_level"; sourceQuery: string; destinationQuery: string }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; unit: LevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; unit: LevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; mute: boolean }
    | { kind: "send_to_aux_output"; sourceQuery: string; aux: number; unit: LevelUnit; value: number }
    | { kind: "ramp_level"; targetQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "delayed_ramp_level"; targetQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "send_delayed_ramp_level"; sourceQuery: string; destinationQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "delay_level"; targetQuery: string; value: LevelValue; delaySeconds: number }
    | { kind: "delay_mute"; targetQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; value: LevelValue; delaySeconds: number }
    | { kind: "send_delay_mute"; sourceQuery: string; destinationQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "automation_list" }
    | { kind: "automation_cancel"; id?: string; lastRunning: boolean }
    | { kind: "bulk_channel_mute"; mode: "selected" | "all" | "all_except"; channelQueries: string[]; mute: boolean }
    | { kind: "bulk_bus_mute"; mode: "selected" | "all" | "all_except"; busQueries: string[]; mute: boolean }
    | { kind: "bulk_send_db"; mode: "selected" | "all"; sourceQuery: string; busQueries: string[]; db: number; includeMain: boolean }
    | { kind: "mute"; targetQuery: string; mute: boolean }
    | { kind: "sequence"; clauses: Array<{ text: string; waitBeforeSeconds: number }> };

type TargetIntent = Extract<Intent, { targetQuery: string }>;
type SendIntent = Extract<Intent, { sourceQuery: string; destinationQuery: string }>;
type BulkIntent = Extract<Intent, { kind: "bulk_channel_mute" | "bulk_bus_mute" | "bulk_send_db" }>;

type LocalPlan =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string; target: LocalMixerTarget }
    | { kind: "read_mute"; targetQuery: string; target: LocalMixerTarget }
    | { kind: "read_effect_on"; targetQuery: string; target: LocalMixerTarget }
    | { kind: "read_channel_name"; channel: number }
    | { kind: "set_level"; targetQuery: string; target: LocalMixerTarget; unit: LevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; target: LocalMixerTarget; unit: LevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; target: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_read_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; unit: LevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; unit: LevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; mute: boolean }
    | { kind: "send_to_aux_output"; sourceQuery: string; source: LocalMixerTarget; aux: number; unit: LevelUnit; value: number }
    | { kind: "ramp_level"; targetQuery: string; target: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "delayed_ramp_level"; targetQuery: string; target: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; target: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "send_delayed_ramp_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "delay_level"; targetQuery: string; target: LocalMixerTarget; value: LevelValue; delaySeconds: number }
    | { kind: "delay_mute"; targetQuery: string; target: LocalMixerTarget; mute: boolean; delaySeconds: number }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; value: LevelValue; delaySeconds: number }
    | { kind: "send_delay_mute"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; mute: boolean; delaySeconds: number }
    | { kind: "automation_list" }
    | { kind: "automation_cancel"; id: string }
    | { kind: "bulk_channel_mute"; mode: "selected" | "all" | "all_except"; channelQueries: string[]; channels: LocalMixerTarget[]; mute: boolean }
    | { kind: "bulk_bus_mute"; mode: "selected" | "all" | "all_except"; busQueries: string[]; buses: LocalMixerTarget[]; mute: boolean }
    | { kind: "bulk_send_db"; mode: "selected" | "all"; sourceQuery: string; source: LocalMixerTarget; busQueries: string[]; buses: LocalMixerTarget[]; db: number; includeMain: boolean }
    | { kind: "mute"; targetQuery: string; target: LocalMixerTarget; mute: boolean }
    | { kind: "sequence"; steps: Array<{ waitBeforeSeconds: number; plan: LocalPlan }> };

type LocalContinuation =
    | {
          intent: TargetIntent | SendIntent | BulkIntent | Extract<Intent, { kind: "send_to_aux_output" }>;
          candidates: LocalMixerTarget[];
      }
    | {
          kind: "speaker_context";
      }
    | {
          kind: "sequence_context";
      };

const SEND_SOURCE_FAMILIES: LocalMixerTargetFamily[] = ["channel", "fxreturn", "aux"];

const MAIN_ALIASES = new Set([
    "main",
    "main lr",
    "lr",
    "facade",
    "façade",
    "master",
    "master lr",
    "front",
    "principal",
    "mix principal",
]);

function simplify(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("fr-FR")
        .replace(/[’']/g, " ")
        .replace(/[^a-z0-9+.,%\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function displayName(target: LocalMixerTarget): string {
    return target.family === "main" ? "Main LR" : target.name;
}

function formatSeconds(value: number): string {
    const normalized = Number.isInteger(value)
        ? String(value)
        : String(value).replace(".", ",");
    return `${normalized} ${value === 1 ? "seconde" : "secondes"}`;
}

function mainTarget(query: string): LocalMixerTarget | null {
    const normalized = simplify(cleanTarget(query));
    if (!MAIN_ALIASES.has(normalized)) return null;
    return {
        family: "main",
        index: 0,
        name: "Main LR",
        matchType: "exact",
    };
}

function parseDb(value: string): number | null {
    const cleaned = value.trim().replace(",", ".");
    if (!/^[+-]?\d+(?:\.\d+)?$/u.test(cleaned)) return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
}

function cleanTarget(value: string): string {
    return value
        .replace(/^\s*(?:le|la|les|de|du|de la|de l|d|the)\s+/iu, "")
        .replace(/\s*(?:fader|niveau|volume|son)\s*$/iu, "")
        .trim();
}

function splitTargetList(value: string): string[] {
    return value
        .split(/\s*(?:,|;|\bet\b|\band\b)\s*/iu)
        .map((item) => cleanTarget(item))
        .filter(Boolean);
}

function parsePercent(value: string): number | null {
    const number = parseDb(value);
    return number !== null && Number.isFinite(number) ? number : null;
}

function parseNormalizedLevel(value: string): number | null {
    const number = parseDb(value);
    return number !== null && number >= 0 && number <= 1 ? number : null;
}

function levelToNormalized(unit: LevelUnit, value: number): { level: number; label: string } {
    if (unit === "level") {
        const level = Math.min(1, Math.max(0, value));
        return { level, label: `niveau ${level.toFixed(4)}` };
    }
    if (unit === "percent") {
        const level = Math.min(1, Math.max(0, value / 100));
        return { level, label: `${(level * 100).toFixed(1)}%` };
    }
    const converted = dbToFaderLevel(value);
    return {
        level: converted.level,
        label: `${formatDb(converted.db)}${converted.clipped ? " (limité à la plage du fader)" : ""}`,
    };
}

function adjustedLevel(currentLevel: number, unit: LevelUnit, delta: number): { level: number; beforeLabel: string; afterLabel: string } {
    if (unit === "level") {
        const next = Math.min(1, Math.max(0, currentLevel + delta));
        return {
            level: next,
            beforeLabel: `niveau ${currentLevel.toFixed(4)}`,
            afterLabel: `niveau ${next.toFixed(4)}`,
        };
    }
    if (unit === "percent") {
        const next = Math.min(1, Math.max(0, currentLevel + delta / 100));
        return {
            level: next,
            beforeLabel: `${(currentLevel * 100).toFixed(1)}%`,
            afterLabel: `${(next * 100).toFixed(1)}%`,
        };
    }
    const before = faderLevelToDb(currentLevel);
    if (before.db === null) {
        throw new Error("Le niveau actuel est à -inf dB ; utilise une valeur absolue avant un ajustement relatif.");
    }
    const converted = dbToFaderLevel(before.db + delta);
    return {
        level: converted.level,
        beforeLabel: formatDb(before.db),
        afterLabel: formatDb(converted.db),
    };
}


function parseTemporalLevelValue(rawValue: string, rawUnit: string): LevelValue | null {
    const normalizedUnit = simplify(rawUnit);
    const unit: LevelUnit = rawUnit === "%" ? "percent" : normalizedUnit === "level" || normalizedUnit === "niveau" ? "level" : "db";
    const value = unit === "percent"
        ? parsePercent(rawValue)
        : unit === "level"
          ? parseNormalizedLevel(rawValue)
          : parseDb(rawValue);
    return value === null ? null : { unit, value };
}

function normalizeLikelyFrenchSttDirection(raw: string): string {
    const text = raw.trim();
    if (/^montre(?:-|\s)+moi\b/iu.test(text)) return text;
    if (/^montre\s+(?:le\s+)?(?:niveau|fader)\s+(?:de|du|de la)\b/iu.test(text)) return text;
    if (/^montre\s+(?:le\s+)?(?:volume|son)\b/iu.test(text)) {
        return text.replace(/^montre\b/iu, "monte");
    }
    if (/^montre\s+(?!(?:le|la|les)\s+(?:statut|etat|état|liste)\b)/iu.test(text)) {
        return text.replace(/^montre\b/iu, "monte");
    }
    return text;
}

function sequencePrimaryTarget(intent: Intent): string | null {
    if ("targetQuery" in intent && typeof intent.targetQuery === "string") return intent.targetQuery;
    return null;
}

function sequenceDestination(intent: Intent): string | null {
    if ("destinationQuery" in intent && typeof intent.destinationQuery === "string") return intent.destinationQuery;
    return null;
}

function rewriteSequenceAnaphora(clause: string, previousIntent: Intent | null, previousText: string): string {
    let text = clause.trim();
    if (/^(?:idem|pareil|same)$/iu.test(text)) return previousText;

    const target = previousIntent ? sequencePrimaryTarget(previousIntent) : null;
    const destination = previousIntent ? sequenceDestination(previousIntent) : null;

    if (target) {
        const simple = [
            [/^remonte(?:-|\s)*(?:la|le)$/iu, `monte ${target}`],
            [/^rebaisse(?:-|\s)*(?:la|le)$/iu, `baisse ${target}`],
            [/^(?:mute|coupe)(?:-|\s)*(?:la|le)$/iu, `mute ${target}`],
            [/^(?:unmute|rallume|reactive|réactive|remets)(?:-|\s)*(?:la|le)$/iu, `unmute ${target}`],
        ] as const;
        for (const [pattern, replacement] of simple) {
            if (pattern.test(text)) return replacement;
        }
        text = text.replace(/\b(?:la\s+)?m[eê]me\s+cible\b/giu, target);
        text = text.replace(/\b(?:lui|elle|celui-ci|celle-ci)\b/giu, target);
    }

    if (destination) {
        text = text
            .replace(/\b(?:le\s+)?m[eê]me\s+(?:retour|bus)\b/giu, destination)
            .replace(/\bsur\s+le\s+m[eê]me\s+retour\b/giu, `sur ${destination}`);
    }
    return text;
}

function parseSequenceIntent(raw: string): Intent | null {
    const parts = raw.split(/\s+(?:(?:et\s+)?(?:puis|ensuite)|then)\s+/iu).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const clauses: Array<{ text: string; waitBeforeSeconds: number }> = [];
    let previousIntent: Intent | null = null;
    let previousText = "";

    for (let index = 0; index < parts.length; index += 1) {
        let clause = parts[index];
        let waitBeforeSeconds = 0;
        if (index > 0) {
            const waitMatch = clause.match(
                /(?:^|\s)(?:apres|après|after)\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\b/iu,
            );
            if (waitMatch?.[1]) {
                waitBeforeSeconds = Number(waitMatch[1].replace(",", "."));
                if (!Number.isFinite(waitBeforeSeconds) || waitBeforeSeconds < 0) return null;
                clause = clause.replace(waitMatch[0], " ").replace(/\s+/gu, " ").trim();
            }
        }

        clause = rewriteSequenceAnaphora(clause, previousIntent, previousText);
        const parsed = parseIntent(clause, false);
        if (!parsed || parsed.kind === "sequence") return null;

        clauses.push({ text: clause, waitBeforeSeconds });
        previousIntent = parsed;
        previousText = clause;
    }

    return { kind: "sequence", clauses };
}

function parseIntent(raw: string, allowSequence = true): Intent | null {
    const text = canonicalizeNaturalFrenchCommand(normalizeLikelyFrenchSttDirection(raw));
    const normalized = simplify(text);

    if (allowSequence) {
        const sequence = parseSequenceIntent(text);
        if (sequence) return sequence;
    }

    if (
        [
            "etat mixeur",
            "etat du mixeur",
            "statut mixeur",
            "statut du mixeur",
            "mixer status",
            "status mixer",
            "mixeur status",
        ].includes(normalized) ||
        isMixerStatusUtterance(text)
    ) {
        return { kind: "status" };
    }

    if (
        [
            "liste automations",
            "liste les automations",
            "liste des automations",
            "statut automations",
            "statut des automations",
            "etat automations",
            "etat des automations",
            "automation status",
            "list automations",
        ].includes(normalized) ||
        isAutomationStatusUtterance(text)
    ) {
        return { kind: "automation_list" };
    }

    const cancelLastAutomation =
        /^(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:la|le)\s+)?(?:derniere|dernière|dernier|last)\s+(?:automation|automatisation|fade|rampe|ramp)$/iu.test(
            text,
        );
    if (cancelLastAutomation) {
        return { kind: "automation_cancel", lastRunning: true };
    }

    const cancelAutomation = text.match(
        /^\s*(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:l['’]?|la\s+|le\s+)?(?:automation|automatisation|fade|rampe|ramp)\s+)?(auto-\d+)\s*$/iu,
    );
    if (cancelAutomation?.[1]) {
        return { kind: "automation_cancel", id: cancelAutomation[1].toLowerCase(), lastRunning: false };
    }

    // Specialized read-only mixer metadata stays outside the generic level/routing grammar.
    const channelNameMatch = text.match(
        /^\s*(?:(?:quel(?:le)?\s+est\s+)?(?:le\s+)?nom\s+(?:de\s+)?(?:la\s+)?(?:voie|tranche|canal|channel)\s+(\d+)|(?:channel|voie|tranche|canal)\s+(\d+)\s+(?:name|nom))\s*\??\s*$/iu,
    );
    if (channelNameMatch) {
        const channel = Number(channelNameMatch[1] || channelNameMatch[2]);
        if (Number.isInteger(channel) && channel > 0) {
            return { kind: "read_channel_name", channel };
        }
    }

    const muteStatePrefix = text.match(
        /^\s*(?:etat|état|statut)\s+(?:du\s+)?mute\s+(?:de\s+|du\s+|de la\s+)?(.+?)\s*\??\s*$/iu,
    );
    const muteStateQuestion = text.match(
        /^\s*(?:est[-\s]?ce\s+que\s+)?(.+?)\s+(?:est\s+(?:mute|muté|mutée|coupe|coupé|coupée)|est[-\s]?(?:il|elle)\s+(?:mute|muté|mutée|coupe|coupé|coupée))\s*\??\s*$/iu,
    );
    if (muteStatePrefix || muteStateQuestion) {
        const targetQuery = cleanTarget(muteStatePrefix?.[1] || muteStateQuestion?.[1] || "");
        if (targetQuery) return { kind: "read_mute", targetQuery };
    }

    const effectStatePrefix = text.match(
        /^\s*(?:etat|état|statut)\s+(?:de\s+)?(?:l['’]?effet|fx)\s+(.+?)\s*\??\s*$/iu,
    );
    const effectStateQuestion = text.match(
        /^\s*(?:est[-\s]?ce\s+que\s+)?(.+?)\s+(?:est\s+(?:actif|active|allume|allumé|allumée|on)|est[-\s]?(?:il|elle)\s+(?:actif|active|allume|allumé|allumée|on))\s*\??\s*$/iu,
    );
    if (effectStatePrefix || effectStateQuestion) {
        const targetQuery = cleanTarget(effectStatePrefix?.[1] || effectStateQuestion?.[1] || "");
        if (targetQuery) return { kind: "read_effect_on", targetQuery };
    }

    // Targetless natural Main-level questions have an established safe normalizer.
    if (isMainLevelReadUtterance(text)) {
        return { kind: "read_level", targetQuery: "main" };
    }

    // Physical AUX output is a distinct mixer capability with protocol-specific guards.
    const channelToAuxNormalized = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(.+?)\s+(?:sur|vers|to)\s+(?:la\s+)?(?:sortie\s+aux|aux\s+output)\s+(\d+)\s+(?:(?:a|à|to)\s+)?(?:au\s+)?(?:niveau|level)\s+(0(?:[.,]\d+)?|1(?:[.,]0+)?)\s*$/iu,
    );
    if (channelToAuxNormalized?.[1] && channelToAuxNormalized[2] && channelToAuxNormalized[3]) {
        const aux = Number(channelToAuxNormalized[2]);
        const value = parseNormalizedLevel(channelToAuxNormalized[3]);
        if (Number.isInteger(aux) && aux > 0 && value !== null) {
            return {
                kind: "send_to_aux_output",
                sourceQuery: cleanTarget(channelToAuxNormalized[1]),
                aux,
                unit: "level",
                value,
            };
        }
    }

    const channelToAuxOutput = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(.+?)\s+(?:sur|vers|to)\s+(?:la\s+)?(?:sortie\s+aux|aux\s+output)\s+(\d+)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    );
    if (channelToAuxOutput?.[1] && channelToAuxOutput[2] && channelToAuxOutput[3] && channelToAuxOutput[4]) {
        const aux = Number(channelToAuxOutput[2]);
        const value = parseTemporalLevelValue(channelToAuxOutput[3], channelToAuxOutput[4]);
        if (Number.isInteger(aux) && aux > 0 && value) {
            return {
                kind: "send_to_aux_output",
                sourceQuery: cleanTarget(channelToAuxOutput[1]),
                aux,
                unit: value.unit,
                value: value.value,
            };
        }
    }

    // Group/bulk operations deliberately retain their dedicated grammar because their
    // semantics and execution safety differ from a single source -> destination route.
    const bulkAllChannelMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\s+(?:(?:toutes\s+les\s+(?:voies|tranches))|(?:tous\s+les\s+(?:canaux|channels))|all\s+channels)(?:\s+(?:sauf|except)\s+(.+))?\s*$/iu,
    );
    if (bulkAllChannelMute?.[1]) {
        const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(
            bulkAllChannelMute[1].toLocaleLowerCase("fr-FR"),
        );
        const channelQueries = bulkAllChannelMute[2] ? splitTargetList(bulkAllChannelMute[2]) : [];
        return {
            kind: "bulk_channel_mute",
            mode: channelQueries.length > 0 ? "all_except" : "all",
            channelQueries,
            mute,
        };
    }

    const bulkSelectedChannelMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\s+(?:(?:les\s+)?(?:voies|tranches|canaux|channels))\s+(.+?)\s*$/iu,
    );
    if (bulkSelectedChannelMute?.[1] && bulkSelectedChannelMute[2]) {
        const channelQueries = splitTargetList(bulkSelectedChannelMute[2]);
        if (channelQueries.length > 0) {
            const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(
                bulkSelectedChannelMute[1].toLocaleLowerCase("fr-FR"),
            );
            return { kind: "bulk_channel_mute", mode: "selected", channelQueries, mute };
        }
    }

    const bulkAllBusMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\s+tous\s+les\s+bus(?:\s+sauf\s+(.+))?\s*$/iu,
    );
    if (bulkAllBusMute?.[1]) {
        const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(
            bulkAllBusMute[1].toLocaleLowerCase("fr-FR"),
        );
        const busQueries = bulkAllBusMute[2] ? splitTargetList(bulkAllBusMute[2]) : [];
        return {
            kind: "bulk_bus_mute",
            mode: busQueries.length > 0 ? "all_except" : "all",
            busQueries,
            mute,
        };
    }

    const bulkSelectedBusMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\s+(?:les\s+)?bus\s+(.+?)\s*$/iu,
    );
    if (bulkSelectedBusMute?.[1] && bulkSelectedBusMute[2]) {
        const busQueries = splitTargetList(bulkSelectedBusMute[2]);
        if (busQueries.length > 0) {
            const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(
                bulkSelectedBusMute[1].toLocaleLowerCase("fr-FR"),
            );
            return { kind: "bulk_bus_mute", mode: "selected", busQueries, mute };
        }
    }

    const bulkSendAll = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB]\s+sur\s+tous\s+les\s+bus(?:\s+et\s+(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr))?\s*$/iu,
    );
    if (bulkSendAll?.[1] && bulkSendAll[2]) {
        const db = parseDb(bulkSendAll[2]);
        if (db !== null) {
            const includeMain = /\s+et\s+(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr)\s*$/iu.test(text);
            return {
                kind: "bulk_send_db",
                mode: "all",
                sourceQuery: cleanTarget(bulkSendAll[1]),
                busQueries: [],
                db,
                includeMain,
            };
        }
    }

    const bulkSendSelected = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB]\s+sur\s+(?:les\s+)?bus\s+(.+?)\s*$/iu,
    );
    if (bulkSendSelected?.[1] && bulkSendSelected[2] && bulkSendSelected[3]) {
        const db = parseDb(bulkSendSelected[2]);
        let destinationText = bulkSendSelected[3].trim();
        let includeMain = false;
        const mainSuffix = destinationText.match(
            /^(.*?)(?:\s+et\s+(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr))\s*$/iu,
        );
        if (mainSuffix?.[1]) {
            destinationText = mainSuffix[1].trim();
            includeMain = true;
        }
        const busQueries = splitTargetList(destinationText);
        if (db !== null && busQueries.length > 0) {
            return {
                kind: "bulk_send_db",
                mode: "selected",
                sourceQuery: cleanTarget(bulkSendSelected[1]),
                busQueries,
                db,
                includeMain,
            };
        }
    }

    // All ordinary level/routing/ramp/delay/mute language now goes through the
    // native lexical-slot + constraint matcher. There is no whole-utterance regex
    // fallback after this point.
    const nativeDeterministicIntent = parseDeterministicMixerIntent(text);
    if (nativeDeterministicIntent) return nativeDeterministicIntent as Intent;

    return null;
}

function sameIdentity(a: LocalMixerTarget, b: LocalMixerTarget): boolean {
    return a.family === b.family && a.index === b.index && a.name === b.name;
}

function safeUnique(matches: LocalMixerTarget[]): LocalMixerTarget | null {
    return matches.length === 1 && matches[0].matchType !== "fuzzy" ? matches[0] : null;
}

function summarizeCandidates(matches: LocalMixerTarget[]): string {
    if (matches.length === 0) return "";
    return matches
        .slice(0, 6)
        .map((match) => `${match.name} (${match.family})`)
        .join(", ");
}

function normalizedStatusText(status: any): string {
    if (!status?.connected) {
        return `Le mixeur est déconnecté${status?.error ? ` : ${status.error}` : "."}`;
    }
    const model = status?.xinfo?.consoleModel || "mixeur";
    const version = status?.xinfo?.consoleVersion ? ` ${status.xinfo.consoleVersion}` : "";
    return `${model}${version} est connecté.`;
}

export class LocalMixerCommandGateway {
    private readonly store: TokenStore<LocalPlan, LocalContinuation>;
    private lastReferenceIntent: Intent | null = null;
    private lastReferenceText = "";

    private rewriteCrossTurnAnaphora(text: string): string {
        if (!this.lastReferenceIntent) return text;
        const hasExplicitReference =
            /\b(?:idem|pareil|same|m[eê]me\s+cible|m[eê]me\s+(?:retour|bus)|lui|elle|celui-ci|celle-ci)\b/iu.test(text) ||
            /^(?:remonte|rebaisse|mute|coupe|unmute|rallume|reactive|réactive|remets)(?:-|\s)*(?:la|le)\b/iu.test(text);
        if (!hasExplicitReference) return text;
        return rewriteSequenceAnaphora(text, this.lastReferenceIntent, this.lastReferenceText);
    }

    private rememberReference(intent: Intent, text: string): void {
        if (intent.kind === "sequence") {
            const last = intent.clauses[intent.clauses.length - 1];
            if (!last) return;
            const parsed = parseIntent(last.text, false);
            if (parsed && parsed.kind !== "sequence") {
                this.lastReferenceIntent = parsed;
                this.lastReferenceText = last.text;
            }
            return;
        }
        if (
            intent.kind === "status" ||
            intent.kind === "automation_list" ||
            intent.kind === "automation_cancel" ||
            intent.kind === "read_channel_name"
        ) {
            return;
        }
        this.lastReferenceIntent = intent;
        this.lastReferenceText = text;
    }

    private async expandSpeakerContext(
        text: string,
        context?: Record<string, unknown>,
    ): Promise<{ text: string; clarification?: string }> {
        const speakerValue = context?.speaker;
        if (!speakerValue || typeof speakerValue !== "object" || Array.isArray(speakerValue)) {
            return { text };
        }
        const speakerRecord = speakerValue as Record<string, unknown>;
        const speaker = String(speakerRecord.name || "unknown").trim() || "unknown";
        const hasMonitorPhrase = /\b(?:mon\s+retour|mes\s+retours|mon\s+wedge|mes\s+ears)\b/iu.test(text);
        const hasInputPhrase = /\b(?:mon\s+micro|ma\s+voix|ma\s+tranche)\b/iu.test(text);
        if (!hasMonitorPhrase && !hasInputPhrase) return { text };

        const resolved = await this.adapter.speakerContext(speaker);
        if (!resolved.known) {
            return {
                text,
                clarification: "Je ne peux pas déterminer le contexte mixeur du locuteur. Précise le retour, le bus ou la voie.",
            };
        }

        let expanded = text;
        if (hasMonitorPhrase) {
            const destination = resolved.monitorDestination;
            if (!destination) {
                return {
                    text,
                    clarification: "Aucune destination de retour n'est configurée pour ce locuteur. Précise la destination.",
                };
            }
            const monitorPhrase = "(?:mon\\s+retour|mes\\s+retours|mon\\s+wedge|mes\\s+ears)";
            if (destination.kind === "main") {
                const sourceToMonitorPattern = new RegExp(
                    `\\s+(?:sur|dans|vers|chez|to|in)\\s+${monitorPhrase}\\b`,
                    "iu",
                );
                const isRouteMute =
                    sourceToMonitorPattern.test(expanded) &&
                    /^\s*(?:mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\b/iu.test(expanded);
                if (isRouteMute) {
                    return {
                        text,
                        clarification:
                            "Le mute d'une source vers Main LR/façade n'est pas exposé comme un mute de send dédié. Précise si tu veux couper la source entière ou le Main LR.",
                    };
                }
                // Source -> "my return" means source -> Main LR for level operations.
                // XMSeries owns this semantic rewrite; LSA transports only neutral speaker metadata.
                expanded = expanded.replace(
                    new RegExp(`\\s+(?:sur|dans|vers|chez|to|in)\\s+${monitorPhrase}\\b`, "giu"),
                    " ",
                );
                expanded = expanded.replace(
                    new RegExp(`\\b${monitorPhrase}\\b`, "giu"),
                    "main",
                );
            } else {
                expanded = expanded.replace(
                    new RegExp(`\\b${monitorPhrase}\\b`, "giu"),
                    destination.name,
                );
            }
        }
        if (hasInputPhrase) {
            if (!resolved.channelName) {
                return {
                    text,
                    clarification: "Aucune voie/micro n'est configuré pour ce locuteur. Précise la voie.",
                };
            }
            expanded = expanded.replace(
                /\b(?:mon\s+micro|ma\s+voix|ma\s+tranche)\b/giu,
                resolved.channelName,
            );
        }
        return { text: expanded };
    }

    constructor(
        private readonly adapter: LocalMixerGatewayAdapter,
        options: { ttlMs?: number; now?: () => number } = {},
    ) {
        this.store = new TokenStore<LocalPlan, LocalContinuation>({
            defaultTtlMs: options.ttlMs ?? 30_000,
            now: options.now,
        });
    }

    async analyze(input: {
        protocol: string;
        text: string;
        locale?: string;
        continuationToken?: string;
        context?: Record<string, unknown>;
    }): Promise<AnalyzeCommandResult> {
        if (input.protocol !== GATEWAY_PROTOCOL) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
                responseText: "Version de gateway non prise en charge.",
            };
        }

        if (input.continuationToken && !parseIntent(input.text)) {
            return await this.continueIntent(input.text, input.continuationToken);
        }

        const referencedText = this.rewriteCrossTurnAnaphora(input.text);
        const expanded = await this.expandSpeakerContext(referencedText, input.context);
        if (expanded.clarification) {
            const stored = this.store.createContinuation({
                kind: "speaker_context",
            });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: expanded.clarification,
            };
        }

        const intent = parseIntent(expanded.text);
        if (intent) {
            this.rememberReference(intent, expanded.text);
        }
        if (!intent) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
            };
        }

        if (intent.kind === "sequence") {
            return await this.planSequenceIntent(intent);
        }

        if (intent.kind === "status" || intent.kind === "automation_list" || intent.kind === "read_channel_name") {
            const stored = this.store.createPlan(intent.kind === "read_channel_name" ? intent : { kind: intent.kind }, "read");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "read",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        if (intent.kind === "automation_cancel") {
            let id = intent.id;
            if (intent.lastRunning) {
                const jobs = await this.adapter.listAutomations();
                const running = jobs.filter((job) => job.status === "running");
                id = running.length > 0 ? running[running.length - 1].id : undefined;
            }
            if (!id) {
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: false,
                    status: "unrecognized",
                    effect: "none",
                    responseText: "Aucune automation en cours à annuler.",
                };
            }
            const stored = this.store.createPlan({ kind: "automation_cancel", id }, "write");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "write",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        if (intent.kind === "bulk_channel_mute" || intent.kind === "bulk_bus_mute" || intent.kind === "bulk_send_db") {
            return await this.planBulkIntent(intent);
        }

        if (intent.kind === "send_to_aux_output") {
            return await this.planAuxOutputIntent(intent);
        }

        if (
            intent.kind === "send_read_level" ||
            intent.kind === "send_set_level" ||
            intent.kind === "send_adjust_level" ||
            intent.kind === "send_adjust_level_qualitative" ||
            intent.kind === "send_mute" ||
            intent.kind === "send_ramp_level" ||
            intent.kind === "send_delayed_ramp_level" ||
            intent.kind === "send_ramp_level_qualitative" ||
            intent.kind === "send_delay_level" ||
            intent.kind === "send_delay_mute"
        ) {
            return await this.planSendIntent(intent);
        }

        if (intent.kind === "read_mute") {
            return await this.planScopedTargetIntent(intent, ["channel"]);
        }
        if (intent.kind === "read_effect_on") {
            return await this.planScopedTargetIntent(intent, ["fxreturn"]);
        }

        return await this.planTargetIntent(intent);
    }

    async execute(input: {
        protocol: string;
        planToken: string;
    }): Promise<ExecuteCommandResult> {
        if (input.protocol !== GATEWAY_PROTOCOL) {
            return {
                protocol: GATEWAY_PROTOCOL,
                ok: false,
                errorCode: "invalid_token",
                responseText: "Version de gateway non prise en charge.",
            };
        }

        const taken = this.store.takePlan(input.planToken);
        if (!taken.ok) {
            return {
                protocol: GATEWAY_PROTOCOL,
                ok: false,
                errorCode: taken.error,
                responseText:
                    taken.error === "expired_token"
                        ? "Cette commande a expiré."
                        : "Cette commande n'est plus valide.",
            };
        }

        const plan = taken.value;

        try {
            if (plan.kind === "status") {
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: normalizedStatusText(await this.adapter.status()),
                };
            }

            if (plan.kind === "read_channel_name") {
                const name = await this.adapter.readChannelName(plan.channel);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Voie ${plan.channel} : ${name || "(sans nom)"}.`,
                };
            }

            if (plan.kind === "automation_list") {
                const jobs = await this.adapter.listAutomations();
                const responseText = jobs.length === 0
                    ? "Aucune automation."
                    : jobs.map((job) => {
                        const detail = job.currentAction ? ` — ${job.currentAction}` : "";
                        const error = job.error ? ` — erreur: ${job.error}` : "";
                        return `${job.id}: ${job.status} (${job.label || "automation"})${detail}${error}`;
                    }).join("; ");
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText,
                };
            }

            if (plan.kind === "automation_cancel") {
                const job = await this.adapter.cancelAutomation(plan.id);
                if (!job) {
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: false,
                        errorCode: "execution_failed",
                        responseText: `Automation introuvable : ${plan.id}.`,
                    };
                }
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${job.id} : ${job.status}.`,
                };
            }

            if (plan.kind === "sequence") {
                const actions = await this.sequenceActions(plan.steps);
                const jobId = await this.adapter.startSequence(actions);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${jobId} démarrée : séquence de ${plan.steps.length} ${plan.steps.length === 1 ? "action" : "actions"}.`,
                };
            }

            if (plan.kind === "bulk_channel_mute") {
                if (plan.mode === "all") {
                    await this.adapter.muteAllChannels(plan.mute);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Toutes les voies ont été ${plan.mute ? "coupées" : "réactivées"}.`,
                    };
                }
                const channels = await this.revalidateChannelTargets(plan.channelQueries, plan.channels);
                if (plan.mode === "all_except") {
                    await this.adapter.muteAllChannels(plan.mute, channels);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Toutes les voies sauf ${channels.map(displayName).join(", ")} ont été ${plan.mute ? "coupées" : "réactivées"}.`,
                    };
                }
                await this.adapter.muteChannelBatch(channels, plan.mute);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${channels.map(displayName).join(", ")} : ${plan.mute ? "coupées" : "réactivées"}.`,
                };
            }

            if (plan.kind === "bulk_bus_mute") {
                if (plan.mode === "all") {
                    await this.adapter.muteAllBuses(plan.mute);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Tous les bus ont été ${plan.mute ? "coupés" : "réactivés"}.`,
                    };
                }
                const buses = await this.revalidateBusTargets(plan.busQueries, plan.buses);
                if (plan.mode === "all_except") {
                    await this.adapter.muteAllBuses(plan.mute, buses);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Tous les bus sauf ${buses.map(displayName).join(", ")} ont été ${plan.mute ? "coupés" : "réactivés"}.`,
                    };
                }
                await this.adapter.muteBusBatch(buses, plan.mute);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${buses.map(displayName).join(", ")} : ${plan.mute ? "coupés" : "réactivés"}.`,
                };
            }

            if (plan.kind === "send_to_aux_output") {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, ["channel"]);
                const converted = levelToNormalized(plan.unit, plan.value);
                await this.adapter.writeChannelToAux(source, plan.aux, converted.level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(source)} → sortie AUX ${plan.aux} réglé à ${converted.label}.`,
                };
            }

            if (plan.kind === "bulk_send_db") {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, ["channel"]);
                if (plan.mode === "all") {
                    await this.adapter.writeSendAllBusesDb(source, plan.db, plan.includeMain);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} réglé à ${formatDb(dbToFaderLevel(plan.db).db)} sur tous les bus${plan.includeMain ? " et Main LR" : ""}.`,
                    };
                }
                const buses = await this.revalidateBusTargets(plan.busQueries, plan.buses);
                await this.adapter.writeSendBatchDb(source, buses, plan.db, plan.includeMain);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(source)} réglé à ${formatDb(dbToFaderLevel(plan.db).db)} sur ${buses.map(displayName).join(", ")}${plan.includeMain ? " et Main LR" : ""}.`,
                };
            }

            if (plan.kind === "read_mute") {
                const liveTarget = await this.revalidateScopedTarget(plan.targetQuery, plan.target, ["channel"]);
                const muted = await this.adapter.readChannelMute(liveTarget);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} est ${muted ? "mutée" : "active"}.`,
                };
            }

            if (plan.kind === "read_effect_on") {
                const liveTarget = await this.revalidateScopedTarget(plan.targetQuery, plan.target, ["fxreturn"]);
                const on = await this.adapter.readEffectOn(liveTarget);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} est ${on ? "actif" : "coupé"}.`,
                };
            }

            if (plan.kind === "read_level") {
                const liveTarget = await this.revalidateTarget(plan.targetQuery, plan.target, false);
                const level = await this.adapter.readLevel(liveTarget);
                const converted = faderLevelToDb(level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} est à ${formatDb(converted.db)}.`,
                };
            }

            if (
                plan.kind === "send_read_level" ||
                plan.kind === "send_set_level" ||
                plan.kind === "send_adjust_level" ||
                plan.kind === "send_adjust_level_qualitative" ||
                plan.kind === "send_mute" ||
                plan.kind === "send_ramp_level" ||
                plan.kind === "send_delayed_ramp_level" ||
                plan.kind === "send_ramp_level_qualitative" ||
                plan.kind === "send_delay_level" ||
                plan.kind === "send_delay_mute"
            ) {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, SEND_SOURCE_FAMILIES);
                const destination = await this.revalidateScopedTarget(plan.destinationQuery, plan.destination, ["bus"]);
                if (plan.kind === "send_read_level") {
                    const level = await this.adapter.readSendLevel(source, destination);
                    const converted = faderLevelToDb(level);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} → ${displayName(destination)} est à ${formatDb(converted.db)}.`,
                    };
                }

                if (plan.kind === "send_set_level") {
                    const converted = levelToNormalized(plan.unit, plan.value);
                    await this.adapter.writeSendLevel(source, destination, converted.level);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} → ${displayName(destination)} réglé à ${converted.label}.`,
                    };
                }
                if (plan.kind === "send_adjust_level") {
                    const current = await this.adapter.readSendLevel(source, destination);
                    const adjusted = adjustedLevel(current, plan.unit, plan.delta);
                    await this.adapter.writeSendLevel(source, destination, adjusted.level);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} → ${displayName(destination)} : ${adjusted.beforeLabel} → ${adjusted.afterLabel}.`,
                    };
                }
                if (plan.kind === "send_adjust_level_qualitative") {
                    const adjusted = await this.adapter.adjustQualitativeSend(
                        source,
                        destination,
                        plan.direction,
                        plan.amount,
                    );
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} → ${displayName(destination)} : ${formatDb(adjusted.beforeDb)} → ${formatDb(adjusted.targetDb)}.`,
                    };
                }
                if (plan.kind === "send_mute") {
                    await this.adapter.setSendMute(source, destination, plan.mute);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `${displayName(source)} → ${displayName(destination)} ${plan.mute ? "coupé" : "réactivé"}.`,
                    };
                }

                if (plan.kind === "send_delay_mute") {
                    const jobId = await this.adapter.scheduleSendMute(
                        source,
                        destination,
                        plan.mute,
                        plan.delaySeconds,
                    );
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Action programmée ${jobId} : ${displayName(source)} → ${displayName(destination)} ${plan.mute ? "sera coupé" : "sera réactivé"} dans ${formatSeconds(plan.delaySeconds)}.`,
                    };
                }

                if (plan.kind === "send_delay_level") {
                    const converted = levelToNormalized(plan.value.unit, plan.value.value);
                    const jobId = await this.adapter.scheduleSend(source, destination, converted.level, plan.delaySeconds);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Action programmée ${jobId} : ${displayName(source)} → ${displayName(destination)} à ${converted.label} dans ${formatSeconds(plan.delaySeconds)}.`,
                    };
                }

                if (plan.kind === "send_ramp_level_qualitative") {
                    const preview = await this.adapter.previewQualitativeSend(
                        source,
                        destination,
                        plan.direction,
                        plan.amount,
                    );
                    const jobId = await this.adapter.startSendRamp(
                        source,
                        destination,
                        preview.targetLevel,
                        plan.durationSeconds,
                    );
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Automation ${jobId} démarrée : ${displayName(source)} → ${displayName(destination)} de ${formatDb(preview.beforeDb)} vers ${formatDb(preview.targetDb)} sur ${formatSeconds(plan.durationSeconds)}.`,
                    };
                }

                if (plan.kind === "send_delayed_ramp_level") {
                    const current = await this.adapter.readSendLevel(source, destination);
                    const toLevel = plan.delta
                        ? adjustedLevel(current, plan.delta.unit, plan.delta.value).level
                        : levelToNormalized(plan.to!.unit, plan.to!.value).level;
                    const fromLevel = plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                    const jobId = await this.adapter.startDelayedSendRamp(
                        source,
                        destination,
                        toLevel,
                        plan.durationSeconds,
                        plan.delaySeconds,
                        fromLevel,
                    );
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Automation ${jobId} programmée : ${displayName(source)} → ${displayName(destination)} dans ${formatSeconds(plan.delaySeconds)} sur ${formatSeconds(plan.durationSeconds)}.`,
                    };
                }

                const current = await this.adapter.readSendLevel(source, destination);
                const toLevel = plan.delta
                    ? adjustedLevel(current, plan.delta.unit, plan.delta.value).level
                    : levelToNormalized(plan.to!.unit, plan.to!.value).level;
                const fromLevel = plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                const jobId = await this.adapter.startSendRamp(source, destination, toLevel, plan.durationSeconds, fromLevel);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${jobId} démarrée : ${displayName(source)} → ${displayName(destination)} sur ${formatSeconds(plan.durationSeconds)}.`,
                };
            }

            const liveTarget = await this.revalidateTarget(plan.targetQuery, plan.target, true);

            if (plan.kind === "delay_mute") {
                const jobId = await this.adapter.scheduleMute(
                    liveTarget,
                    plan.mute,
                    plan.delaySeconds,
                );
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Action programmée ${jobId} : ${displayName(liveTarget)} ${plan.mute ? "sera coupé" : "sera réactivé"} dans ${formatSeconds(plan.delaySeconds)}.`,
                };
            }

            if (plan.kind === "delay_level") {
                const converted = levelToNormalized(plan.value.unit, plan.value.value);
                const jobId = await this.adapter.scheduleLevel(liveTarget, converted.level, plan.delaySeconds);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Action programmée ${jobId} : ${displayName(liveTarget)} à ${converted.label} dans ${formatSeconds(plan.delaySeconds)}.`,
                };
            }

            if (plan.kind === "ramp_level_qualitative") {
                const preview = await this.adapter.previewQualitativeLevel(
                    liveTarget,
                    plan.direction,
                    plan.amount,
                );
                const jobId = await this.adapter.startLevelRamp(
                    liveTarget,
                    preview.targetLevel,
                    plan.durationSeconds,
                );
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${jobId} démarrée : ${displayName(liveTarget)} de ${formatDb(preview.beforeDb)} vers ${formatDb(preview.targetDb)} sur ${formatSeconds(plan.durationSeconds)}.`,
                };
            }

            if (plan.kind === "delayed_ramp_level") {
                const current = await this.adapter.readLevel(liveTarget);
                const toLevel = plan.delta
                    ? adjustedLevel(current, plan.delta.unit, plan.delta.value).level
                    : levelToNormalized(plan.to!.unit, plan.to!.value).level;
                const fromLevel = plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                const jobId = await this.adapter.startDelayedLevelRamp(
                    liveTarget,
                    toLevel,
                    plan.durationSeconds,
                    plan.delaySeconds,
                    fromLevel,
                );
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${jobId} programmée : ${displayName(liveTarget)} dans ${formatSeconds(plan.delaySeconds)} sur ${formatSeconds(plan.durationSeconds)}.`,
                };
            }

            if (plan.kind === "ramp_level") {
                const current = await this.adapter.readLevel(liveTarget);
                const toLevel = plan.delta
                    ? adjustedLevel(current, plan.delta.unit, plan.delta.value).level
                    : levelToNormalized(plan.to!.unit, plan.to!.value).level;
                const fromLevel = plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                const jobId = await this.adapter.startLevelRamp(liveTarget, toLevel, plan.durationSeconds, fromLevel);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Automation ${jobId} démarrée : ${displayName(liveTarget)} sur ${formatSeconds(plan.durationSeconds)}.`,
                };
            }

            if (plan.kind === "set_level") {
                const converted = levelToNormalized(plan.unit, plan.value);
                await this.adapter.writeLevel(liveTarget, converted.level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} réglé à ${converted.label}.`,
                };
            }

            if (plan.kind === "adjust_level_qualitative") {
                const adjusted = await this.adapter.adjustQualitativeLevel(
                    liveTarget,
                    plan.direction,
                    plan.amount,
                );
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} : ${formatDb(adjusted.beforeDb)} → ${formatDb(adjusted.targetDb)}.`,
                };
            }

            if (plan.kind === "adjust_level") {
                const current = await this.adapter.readLevel(liveTarget);
                const adjusted = adjustedLevel(current, plan.unit, plan.delta);
                await this.adapter.writeLevel(liveTarget, adjusted.level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} : ${adjusted.beforeLabel} → ${adjusted.afterLabel}.`,
                };
            }

            await this.adapter.setMute(liveTarget, plan.mute);
            return {
                protocol: GATEWAY_PROTOCOL,
                ok: true,
                responseText: `${displayName(liveTarget)} ${plan.mute ? "coupé" : "réactivé"}.`,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith("STALE_TARGET:")) {
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: false,
                    errorCode: "stale_plan",
                    responseText: "La cible du mixeur a changé depuis l'analyse. La commande n'a pas été exécutée.",
                };
            }
            return {
                protocol: GATEWAY_PROTOCOL,
                ok: false,
                errorCode: "execution_failed",
                responseText: `La commande mixeur a échoué : ${message}`,
            };
        }
    }

    private async planAuxOutputIntent(
        intent: Extract<Intent, { kind: "send_to_aux_output" }>,
    ): Promise<AnalyzeCommandResult> {
        const sourceMatches = await this.adapter.resolve(intent.sourceQuery, ["channel"]);
        const source = safeUnique(sourceMatches);
        if (!source || source.matchType === "fuzzy") {
            const stored = this.store.createContinuation({ intent, candidates: sourceMatches.slice(0, 8) });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: `Source « ${intent.sourceQuery} » ambiguë ou introuvable. Reformule avec le nom exact de la voie.`,
            };
        }
        const stored = this.store.createPlan({ ...intent, source }, "write");
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "ready",
            effect: "write",
            planToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: null,
        };
    }

    private sequenceClarification(message: string): AnalyzeCommandResult {
        const stored = this.store.createContinuation({ kind: "sequence_context" });
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "clarification",
            effect: "none",
            continuationToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: message,
        };
    }

    private async planAtomicForSequence(
        intent: Intent,
    ): Promise<{ plan?: LocalPlan; errorText?: string }> {
        if (
            intent.kind === "sequence" ||
            intent.kind === "status" ||
            intent.kind === "read_level" ||
            intent.kind === "read_mute" ||
            intent.kind === "read_effect_on" ||
            intent.kind === "read_channel_name" ||
            intent.kind === "automation_list" ||
            intent.kind === "automation_cancel" ||
            intent.kind === "send_read_level"
        ) {
            return { errorText: "Une macro déterministe ne peut contenir que des actions mixeur, pas des lectures ou commandes de statut." };
        }

        let result: AnalyzeCommandResult;
        if (intent.kind === "bulk_channel_mute" || intent.kind === "bulk_bus_mute" || intent.kind === "bulk_send_db") {
            result = await this.planBulkIntent(intent);
        } else if (intent.kind === "send_to_aux_output") {
            result = await this.planAuxOutputIntent(intent);
        } else if (
            intent.kind === "send_set_level" ||
            intent.kind === "send_adjust_level" ||
            intent.kind === "send_adjust_level_qualitative" ||
            intent.kind === "send_mute" ||
            intent.kind === "send_ramp_level" ||
            intent.kind === "send_delayed_ramp_level" ||
            intent.kind === "send_ramp_level_qualitative" ||
            intent.kind === "send_delay_level" ||
            intent.kind === "send_delay_mute"
        ) {
            result = await this.planSendIntent(intent);
        } else {
            result = await this.planTargetIntent(intent);
        }

        const payload = result as AnalyzeCommandResult & {
            planToken?: string;
            continuationToken?: string;
            responseText?: string | null;
        };
        if (payload.status !== "ready" || payload.effect !== "write" || !payload.planToken) {
            if (payload.continuationToken) this.store.takeContinuation(payload.continuationToken);
            return {
                errorText: payload.responseText || "Une étape de la macro est ambiguë ou incomplète.",
            };
        }

        const taken = this.store.takePlan(payload.planToken);
        if (!taken.ok) {
            return { errorText: "Impossible de figer une étape de la macro." };
        }
        return { plan: taken.value };
    }

    private async planSequenceIntent(
        intent: Extract<Intent, { kind: "sequence" }>,
    ): Promise<AnalyzeCommandResult> {
        const steps: Array<{ waitBeforeSeconds: number; plan: LocalPlan }> = [];
        for (let index = 0; index < intent.clauses.length; index += 1) {
            const clause = intent.clauses[index];
            const parsed = parseIntent(clause.text, false);
            if (!parsed || parsed.kind === "sequence") {
                return this.sequenceClarification(
                    `Étape ${index + 1} non reconnue. Reformule toute la séquence avec des commandes complètes.`,
                );
            }
            const planned = await this.planAtomicForSequence(parsed);
            if (!planned.plan) {
                return this.sequenceClarification(
                    `Étape ${index + 1} : ${planned.errorText || "commande non résolue"} Reformule toute la séquence.`,
                );
            }
            steps.push({ waitBeforeSeconds: clause.waitBeforeSeconds, plan: planned.plan });
        }

        const stored = this.store.createPlan({ kind: "sequence", steps }, "write");
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "ready",
            effect: "write",
            planToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: null,
        };
    }

    private async sequenceActions(
        steps: Array<{ waitBeforeSeconds: number; plan: LocalPlan }>,
    ): Promise<LocalSequenceAction[]> {
        const actions: LocalSequenceAction[] = [];
        const wait = (seconds: number, description?: string) => {
            if (seconds > 0) actions.push({ type: "wait", durationSeconds: seconds, description });
        };
        const run = (description: string, fn: () => Promise<void>) => {
            actions.push({ type: "run", description, run: fn });
        };

        for (const item of steps) {
            wait(item.waitBeforeSeconds, item.waitBeforeSeconds > 0 ? `attendre ${item.waitBeforeSeconds} s` : undefined);
            const plan = item.plan;

            if (plan.kind === "sequence" || plan.kind === "status" || plan.kind === "automation_list" || plan.kind === "automation_cancel" || plan.kind === "read_level" || plan.kind === "read_mute" || plan.kind === "read_effect_on" || plan.kind === "read_channel_name" || plan.kind === "send_read_level") {
                throw new Error("Une macro contient une étape non exécutable.");
            }

            if (plan.kind === "bulk_channel_mute") {
                const channels = plan.mode === "all" ? [] : await this.revalidateChannelTargets(plan.channelQueries, plan.channels);
                run("mute groupé des voies", async () => {
                    if (plan.mode === "all") await this.adapter.muteAllChannels(plan.mute);
                    else if (plan.mode === "all_except") await this.adapter.muteAllChannels(plan.mute, channels);
                    else await this.adapter.muteChannelBatch(channels, plan.mute);
                });
                continue;
            }

            if (plan.kind === "bulk_bus_mute") {
                const buses = plan.mode === "all" ? [] : await this.revalidateBusTargets(plan.busQueries, plan.buses);
                run("mute groupé des bus", async () => {
                    if (plan.mode === "all") await this.adapter.muteAllBuses(plan.mute);
                    else if (plan.mode === "all_except") await this.adapter.muteAllBuses(plan.mute, buses);
                    else await this.adapter.muteBusBatch(buses, plan.mute);
                });
                continue;
            }

            if (plan.kind === "bulk_send_db") {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, ["channel"]);
                const buses = plan.mode === "all" ? [] : await this.revalidateBusTargets(plan.busQueries, plan.buses);
                run("niveau groupé vers bus", async () => {
                    if (plan.mode === "all") await this.adapter.writeSendAllBusesDb(source, plan.db, plan.includeMain);
                    else await this.adapter.writeSendBatchDb(source, buses, plan.db, plan.includeMain);
                });
                continue;
            }

            if (plan.kind === "send_to_aux_output") {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, ["channel"]);
                const converted = levelToNormalized(plan.unit, plan.value);
                run(`${displayName(source)} vers sortie AUX ${plan.aux}`, () => this.adapter.writeChannelToAux(source, plan.aux, converted.level));
                continue;
            }

            if (
                plan.kind === "send_set_level" ||
                plan.kind === "send_adjust_level" ||
                plan.kind === "send_adjust_level_qualitative" ||
                plan.kind === "send_mute" ||
                plan.kind === "send_ramp_level" ||
                plan.kind === "send_delayed_ramp_level" ||
                plan.kind === "send_ramp_level_qualitative" ||
                plan.kind === "send_delay_level" ||
                plan.kind === "send_delay_mute"
            ) {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, SEND_SOURCE_FAMILIES);
                const destination = await this.revalidateScopedTarget(plan.destinationQuery, plan.destination, ["bus"]);

                if (plan.kind === "send_set_level") {
                    const converted = levelToNormalized(plan.unit, plan.value);
                    run(`${displayName(source)} vers ${displayName(destination)}`, () => this.adapter.writeSendLevel(source, destination, converted.level));
                } else if (plan.kind === "send_adjust_level") {
                    run(`ajuster ${displayName(source)} vers ${displayName(destination)}`, async () => {
                        const current = await this.adapter.readSendLevel(source, destination);
                        const adjusted = adjustedLevel(current, plan.unit, plan.delta);
                        await this.adapter.writeSendLevel(source, destination, adjusted.level);
                    });
                } else if (plan.kind === "send_adjust_level_qualitative") {
                    run(`ajuster ${displayName(source)} vers ${displayName(destination)}`, async () => {
                        await this.adapter.adjustQualitativeSend(source, destination, plan.direction, plan.amount);
                    });
                } else if (plan.kind === "send_mute") {
                    run(`${plan.mute ? "mute" : "unmute"} ${displayName(source)} vers ${displayName(destination)}`, () => this.adapter.setSendMute(source, destination, plan.mute));
                } else if (plan.kind === "send_delay_level") {
                    wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                    const converted = levelToNormalized(plan.value.unit, plan.value.value);
                    run(`${displayName(source)} vers ${displayName(destination)}`, () => this.adapter.writeSendLevel(source, destination, converted.level));
                } else if (plan.kind === "send_delay_mute") {
                    wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                    run(`${plan.mute ? "mute" : "unmute"} ${displayName(source)} vers ${displayName(destination)}`, () => this.adapter.setSendMute(source, destination, plan.mute));
                } else {
                    if (plan.kind === "send_delayed_ramp_level") {
                        wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                    }
                    const from = "from" in plan && plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                    let to: number | (() => Promise<number>);
                    if (plan.kind === "send_ramp_level_qualitative") {
                        to = async () => (await this.adapter.previewQualitativeSend(source, destination, plan.direction, plan.amount)).targetLevel;
                    } else if (plan.delta) {
                        to = async () => {
                            const current = await this.adapter.readSendLevel(source, destination);
                            return adjustedLevel(current, plan.delta!.unit, plan.delta!.value).level;
                        };
                    } else {
                        to = levelToNormalized(plan.to!.unit, plan.to!.value).level;
                    }
                    actions.push({
                        type: "ramp",
                        description: `rampe ${displayName(source)} vers ${displayName(destination)}`,
                        from,
                        to,
                        durationSeconds: plan.durationSeconds,
                        read: () => this.adapter.readSendLevel(source, destination),
                        write: (value) => this.adapter.writeSendLevel(source, destination, value),
                    });
                }
                continue;
            }

            const target = await this.revalidateTarget(plan.targetQuery, plan.target, true);
            if (plan.kind === "set_level") {
                const converted = levelToNormalized(plan.unit, plan.value);
                run(`régler ${displayName(target)}`, () => this.adapter.writeLevel(target, converted.level));
            } else if (plan.kind === "adjust_level") {
                run(`ajuster ${displayName(target)}`, async () => {
                    const current = await this.adapter.readLevel(target);
                    const adjusted = adjustedLevel(current, plan.unit, plan.delta);
                    await this.adapter.writeLevel(target, adjusted.level);
                });
            } else if (plan.kind === "adjust_level_qualitative") {
                run(`ajuster ${displayName(target)}`, async () => {
                    await this.adapter.adjustQualitativeLevel(target, plan.direction, plan.amount);
                });
            } else if (plan.kind === "mute") {
                run(`${plan.mute ? "mute" : "unmute"} ${displayName(target)}`, () => this.adapter.setMute(target, plan.mute));
            } else if (plan.kind === "delay_level") {
                wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                const converted = levelToNormalized(plan.value.unit, plan.value.value);
                run(`régler ${displayName(target)}`, () => this.adapter.writeLevel(target, converted.level));
            } else if (plan.kind === "delay_mute") {
                wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                run(`${plan.mute ? "mute" : "unmute"} ${displayName(target)}`, () => this.adapter.setMute(target, plan.mute));
            } else {
                if (plan.kind === "delayed_ramp_level") {
                    wait(plan.delaySeconds, `attendre ${formatSeconds(plan.delaySeconds)}`);
                }
                const from = "from" in plan && plan.from ? levelToNormalized(plan.from.unit, plan.from.value).level : undefined;
                let to: number | (() => Promise<number>);
                if (plan.kind === "ramp_level_qualitative") {
                    to = async () => (await this.adapter.previewQualitativeLevel(target, plan.direction, plan.amount)).targetLevel;
                } else if (plan.delta) {
                    to = async () => {
                        const current = await this.adapter.readLevel(target);
                        return adjustedLevel(current, plan.delta!.unit, plan.delta!.value).level;
                    };
                } else {
                    to = levelToNormalized(plan.to!.unit, plan.to!.value).level;
                }
                actions.push({
                    type: "ramp",
                    description: `rampe ${displayName(target)}`,
                    from,
                    to,
                    durationSeconds: plan.durationSeconds,
                    read: () => this.adapter.readLevel(target),
                    write: (value) => this.adapter.writeLevel(target, value),
                });
            }
        }

        return actions;
    }

    private async planSendIntent(
        intent: SendIntent,
    ): Promise<AnalyzeCommandResult> {
        const sourceMatches = await this.adapter.resolve(intent.sourceQuery, SEND_SOURCE_FAMILIES);
        const destinationMatches = await this.adapter.resolve(intent.destinationQuery, ["bus"]);
        const source = safeUnique(sourceMatches);
        const destination = safeUnique(destinationMatches);

        if (!source || !destination) {
            const sourceText = source
                ? displayName(source)
                : sourceMatches.length === 1 && sourceMatches[0].matchType === "fuzzy"
                  ? `correspondance approximative « ${displayName(sourceMatches[0])} » pour « ${intent.sourceQuery} »`
                  : sourceMatches.length
                    ? summarizeCandidates(sourceMatches)
                    : `aucune source pour « ${intent.sourceQuery} »`;
            const destinationText = destination
                ? displayName(destination)
                : destinationMatches.length === 1 && destinationMatches[0].matchType === "fuzzy"
                  ? `correspondance approximative « ${displayName(destinationMatches[0])} » pour « ${intent.destinationQuery} »`
                  : destinationMatches.length
                    ? summarizeCandidates(destinationMatches)
                    : `aucun bus pour « ${intent.destinationQuery} »`;
            const stored = this.store.createContinuation({ intent, candidates: [] });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: `Route ambiguë ou introuvable. Source: ${sourceText}. Destination: ${destinationText}. Reformule avec la source et le bus exacts.`,
            };
        }

        const effect = intent.kind === "send_read_level" ? "read" : "write";
        const stored = this.store.createPlan({ ...intent, source, destination }, effect);
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "ready",
            effect,
            planToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: null,
        };
    }

    private async resolveExactChannelQueries(
        queries: string[],
    ): Promise<{ targets: LocalMixerTarget[]; errorText?: string }> {
        const targets: LocalMixerTarget[] = [];
        for (const query of queries) {
            const matches = await this.adapter.resolve(query, ["channel"]);
            const resolved = safeUnique(matches);
            if (!resolved || resolved.matchType === "fuzzy") {
                const candidates = matches.length > 0 ? summarizeCandidates(matches) : "aucune";
                return {
                    targets: [],
                    errorText: `Voie « ${query} » ambiguë ou introuvable. Correspondances: ${candidates}. Reformule avec les noms exacts.`,
                };
            }
            targets.push(resolved);
        }
        return { targets };
    }

    private async revalidateChannelTargets(
        queries: string[],
        expected: LocalMixerTarget[],
    ): Promise<LocalMixerTarget[]> {
        const resolved = await this.resolveExactChannelQueries(queries);
        if (resolved.errorText || resolved.targets.length !== expected.length) {
            throw new Error("stale_plan");
        }
        for (let index = 0; index < expected.length; index += 1) {
            const current = resolved.targets[index];
            const snapshot = expected[index];
            if (current.family !== snapshot.family || current.index !== snapshot.index || current.name !== snapshot.name) {
                throw new Error("stale_plan");
            }
        }
        return resolved.targets;
    }

    private async resolveExactBusQueries(
        queries: string[],
    ): Promise<{ targets: LocalMixerTarget[]; errorText?: string }> {
        const targets: LocalMixerTarget[] = [];
        for (const query of queries) {
            const matches = await this.adapter.resolve(query, ["bus"]);
            const resolved = safeUnique(matches);
            if (!resolved || resolved.matchType === "fuzzy") {
                const candidates = matches.length > 0 ? summarizeCandidates(matches) : "aucun";
                return {
                    targets: [],
                    errorText: `Bus « ${query} » ambigu ou introuvable. Correspondances: ${candidates}. Reformule avec les noms exacts.`,
                };
            }
            targets.push(resolved);
        }
        return { targets };
    }

    private async planBulkIntent(intent: BulkIntent): Promise<AnalyzeCommandResult> {
        if (intent.kind === "bulk_channel_mute") {
            if (intent.mode === "all") {
                const stored = this.store.createPlan({ ...intent, channels: [] }, "write");
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: true,
                    status: "ready",
                    effect: "write",
                    planToken: stored.token,
                    expiresInMs: stored.expiresInMs,
                    responseText: null,
                };
            }
            const resolved = await this.resolveExactChannelQueries(intent.channelQueries);
            if (resolved.errorText) {
                const stored = this.store.createContinuation({ intent, candidates: [] });
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: true,
                    status: "clarification",
                    effect: "none",
                    continuationToken: stored.token,
                    expiresInMs: stored.expiresInMs,
                    responseText: resolved.errorText,
                };
            }
            const stored = this.store.createPlan({ ...intent, channels: resolved.targets }, "write");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "write",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        if (intent.kind === "bulk_bus_mute") {
            if (intent.mode === "all") {
                const stored = this.store.createPlan({ ...intent, buses: [] }, "write");
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: true,
                    status: "ready",
                    effect: "write",
                    planToken: stored.token,
                    expiresInMs: stored.expiresInMs,
                    responseText: null,
                };
            }
            const resolved = await this.resolveExactBusQueries(intent.busQueries);
            if (resolved.errorText) {
                const stored = this.store.createContinuation({ intent, candidates: [] });
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: true,
                    status: "clarification",
                    effect: "none",
                    continuationToken: stored.token,
                    expiresInMs: stored.expiresInMs,
                    responseText: resolved.errorText,
                };
            }
            const stored = this.store.createPlan({ ...intent, buses: resolved.targets }, "write");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "write",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        const sourceMatches = await this.adapter.resolve(intent.sourceQuery, ["channel"]);
        const source = safeUnique(sourceMatches);
        if (!source || source.matchType === "fuzzy") {
            const stored = this.store.createContinuation({ intent, candidates: [] });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: `Source « ${intent.sourceQuery} » ambiguë ou introuvable. Reformule avec le nom exact de la voie.`,
            };
        }

        if (intent.mode === "all") {
            const stored = this.store.createPlan({ ...intent, source, buses: [] }, "write");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "write",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        const resolved = await this.resolveExactBusQueries(intent.busQueries);
        if (resolved.errorText) {
            const stored = this.store.createContinuation({ intent, candidates: [] });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: resolved.errorText,
            };
        }

        const stored = this.store.createPlan({ ...intent, source, buses: resolved.targets }, "write");
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "ready",
            effect: "write",
            planToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: null,
        };
    }

    private async planScopedTargetIntent(
        intent: Extract<Intent, { kind: "read_mute" | "read_effect_on" }>,
        families: LocalMixerTargetFamily[],
    ): Promise<AnalyzeCommandResult> {
        const matches = await this.adapter.resolve(intent.targetQuery, families);
        const resolved = safeUnique(matches);
        if (resolved && resolved.matchType !== "fuzzy") {
            const stored = this.store.createPlan({ ...intent, target: resolved }, "read");
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "ready",
                effect: "read",
                planToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: null,
            };
        }

        const stored = this.store.createContinuation({ intent, candidates: matches.slice(0, 8) });
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "clarification",
            effect: "none",
            continuationToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: matches.length === 0
                ? `Je ne trouve aucune cible correspondant à « ${intent.targetQuery} ».`
                : `La cible « ${intent.targetQuery} » est ambiguë : ${summarizeCandidates(matches)}.`,
        };
    }

    private async planTargetIntent(
        intent: TargetIntent,
    ): Promise<AnalyzeCommandResult> {
        const main = mainTarget(intent.targetQuery);
        if (main) return this.readyTargetPlan(intent, main);

        const matches = await this.adapter.resolve(intent.targetQuery);
        const resolved = safeUnique(matches);
        if (resolved) return this.readyTargetPlan(intent, resolved);

        const stored = this.store.createContinuation({
            intent,
            candidates: matches.slice(0, 8),
        });

        const suggestions = summarizeCandidates(matches);
        const responseText =
            matches.length === 0
                ? `Je ne trouve aucune cible mixeur correspondant à « ${intent.targetQuery} ». Quelle cible veux-tu utiliser ?`
                : matches.every((match) => match.matchType === "fuzzy")
                  ? `La cible « ${intent.targetQuery} » n'est pas assez sûre. Correspondances possibles : ${suggestions}. Laquelle veux-tu utiliser ?`
                  : `La cible « ${intent.targetQuery} » est ambiguë : ${suggestions}. Laquelle veux-tu utiliser ?`;

        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "clarification",
            effect: "none",
            continuationToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText,
        };
    }

    private readyTargetPlan(
        intent: TargetIntent,
        target: LocalMixerTarget,
    ): AnalyzeCommandResult {
        const effect = intent.kind === "read_level" ? "read" : "write";
        const plan: LocalPlan = { ...intent, target } as LocalPlan;

        const stored = this.store.createPlan(plan, effect);
        return {
            protocol: GATEWAY_PROTOCOL,
            recognized: true,
            status: "ready",
            effect,
            planToken: stored.token,
            expiresInMs: stored.expiresInMs,
            responseText: null,
        };
    }

    private async continueIntent(
        reply: string,
        token: string,
    ): Promise<AnalyzeCommandResult> {
        const continuation = this.store.takeContinuation(token);
        if (!continuation.ok) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
                responseText:
                    continuation.error === "expired_token"
                        ? "Cette clarification a expiré."
                        : "Cette clarification n'est plus valide.",
            };
        }

        if (!("intent" in continuation.value)) {
            const isSequence = continuation.value.kind === "sequence_context";
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
                responseText: isSequence
                    ? "Reformule toute la séquence avec les cibles et actions complètes."
                    : "Reformule la commande complète en précisant le retour, le bus ou la voie.",
            };
        }

        const active = continuation.value;
        if ("channelQueries" in active.intent || "busQueries" in active.intent || "sourceQuery" in active.intent) {
            const stored = this.store.createContinuation({
                intent: active.intent,
                candidates: [],
            });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText: active.intent.kind === "send_to_aux_output"
                    ? "Reformule la commande complète avec la voie source exacte et la sortie AUX."
                    : "Reformule la commande complète avec la source et le bus de destination exacts.",
            };
        }

        const main = mainTarget(reply);
        if (main) return this.readyTargetPlan(active.intent, main);

        const matches = await this.adapter.resolve(reply);
        const resolved = safeUnique(matches);
        if (!resolved) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
                responseText: "La réponse ne permet pas d'identifier une cible mixeur sûre.",
            };
        }

        if (active.candidates.length > 0) {
            const wasSuggested = active.candidates.some((candidate) =>
                sameIdentity(candidate, resolved),
            );
            if (!wasSuggested && active.candidates.some((candidate) => candidate.matchType !== "fuzzy")) {
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: false,
                    status: "unrecognized",
                    effect: "none",
                    responseText: "La réponse ne correspond pas à une des cibles proposées.",
                };
            }
        }

        return this.readyTargetPlan(active.intent, resolved);
    }

    private async revalidateBusTargets(
        queries: string[],
        expected: LocalMixerTarget[],
    ): Promise<LocalMixerTarget[]> {
        const live: LocalMixerTarget[] = [];
        for (let index = 0; index < queries.length; index += 1) {
            const target = await this.revalidateScopedTarget(queries[index], expected[index], ["bus"]);
            live.push(target);
        }
        return live;
    }

    private async revalidateScopedTarget(
        query: string,
        expected: LocalMixerTarget,
        families: LocalMixerTargetFamily[],
    ): Promise<LocalMixerTarget> {
        const matches = await this.adapter.resolve(query, families);
        const live = safeUnique(matches);
        if (!live || !sameIdentity(live, expected) || live.matchType === "fuzzy") {
            throw new Error("STALE_TARGET: resolver identity changed");
        }
        return live;
    }

    private async revalidateTarget(
        query: string,
        expected: LocalMixerTarget,
        forWrite: boolean,
    ): Promise<LocalMixerTarget> {
        if (expected.family === "main") return expected;

        const matches = await this.adapter.resolve(query);
        const live = safeUnique(matches);
        if (!live || !sameIdentity(live, expected)) {
            throw new Error("STALE_TARGET: resolver identity changed");
        }
        if (forWrite && live.matchType === "fuzzy") {
            throw new Error("STALE_TARGET: fuzzy target cannot authorize a write");
        }
        return live;
    }
}

export const LOCAL_GATEWAY_TOOLS: Tool[] = [
    {
        name: "lsa_local_analyze_command",
        description:
            "Analyze one Local LiveStageAssistant mixer command without side effects.",
        inputSchema: {
            type: "object",
            properties: {
                protocol: {
                    type: "string",
                    enum: [GATEWAY_PROTOCOL],
                },
                text: { type: "string" },
                locale: { type: "string" },
                continuationToken: { type: "string" },
                context: {
                    type: "object",
                    description: "Optional domain-neutral runtime context supplied by the host, for example recognized speaker metadata.",
                    additionalProperties: true,
                },
            },
            required: ["protocol", "text"],
        },
    },
    {
        name: "lsa_local_execute_command",
        description:
            "Execute one previously analyzed Local LiveStageAssistant mixer command.",
        inputSchema: {
            type: "object",
            properties: {
                protocol: {
                    type: "string",
                    enum: [GATEWAY_PROTOCOL],
                },
                planToken: { type: "string" },
            },
            required: ["protocol", "planToken"],
        },
    },
];

export function withLocalGatewayTools(
    baseTools: readonly Tool[],
    env: Readonly<Record<string, string | undefined>> = process.env,
): Tool[] {
    return isLocalGatewayEnabled(env)
        ? [...baseTools, ...LOCAL_GATEWAY_TOOLS]
        : [...baseTools];
}
