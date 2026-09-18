import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
    GATEWAY_PROTOCOL,
    TokenStore,
    type AnalyzeCommandResult,
    type ExecuteCommandResult,
} from "@infrafast/stage-command-core";
import { dbToFaderLevel, faderLevelToDb, formatDb } from "./level-table.js";
import { isLocalGatewayEnabled } from "@infrafast/stage-command-core";

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

export interface LocalMixerGatewayAdapter {
    resolve(query: string, families?: LocalMixerTargetFamily[]): Promise<LocalMixerTarget[]>;
    status(): Promise<any>;
    readLevel(target: LocalMixerTarget): Promise<number>;
    writeLevel(target: LocalMixerTarget, level: number): Promise<void>;
    setMute(target: LocalMixerTarget, mute: boolean): Promise<void>;
    readSendLevel(source: LocalMixerTarget, destination: LocalMixerTarget): Promise<number>;
    writeSendLevel(source: LocalMixerTarget, destination: LocalMixerTarget, level: number): Promise<void>;
    setSendMute(source: LocalMixerTarget, destination: LocalMixerTarget, mute: boolean): Promise<void>;
    startLevelRamp(target: LocalMixerTarget, toLevel: number, durationSeconds: number, fromLevel?: number): Promise<string>;
    startSendRamp(source: LocalMixerTarget, destination: LocalMixerTarget, toLevel: number, durationSeconds: number, fromLevel?: number): Promise<string>;
    scheduleLevel(target: LocalMixerTarget, toLevel: number, delaySeconds: number): Promise<string>;
    scheduleSend(source: LocalMixerTarget, destination: LocalMixerTarget, toLevel: number, delaySeconds: number): Promise<string>;
    listAutomations(): Promise<Array<{ id: string; label?: string; status: string; currentAction?: string; error?: string }>>;
    cancelAutomation(id: string): Promise<{ id: string; label?: string; status: string } | null>;
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

type LevelUnit = "db" | "percent";
type LevelValue = { unit: LevelUnit; value: number };

type Intent =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string }
    | { kind: "set_level"; targetQuery: string; unit: LevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; unit: LevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; unit: LevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; unit: LevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; mute: boolean }
    | { kind: "ramp_level"; targetQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "delay_level"; targetQuery: string; value: LevelValue; delaySeconds: number }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; value: LevelValue; delaySeconds: number }
    | { kind: "automation_list" }
    | { kind: "automation_cancel"; id?: string; lastRunning: boolean }
    | { kind: "bulk_bus_mute"; mode: "selected" | "all" | "all_except"; busQueries: string[]; mute: boolean }
    | { kind: "bulk_send_db"; mode: "selected" | "all"; sourceQuery: string; busQueries: string[]; db: number; includeMain: boolean }
    | { kind: "mute"; targetQuery: string; mute: boolean };

type TargetIntent = Extract<Intent, { targetQuery: string }>;
type SendIntent = Extract<Intent, { sourceQuery: string; destinationQuery: string }>;
type BulkIntent = Extract<Intent, { kind: "bulk_bus_mute" | "bulk_send_db" }>;

type LocalPlan =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string; target: LocalMixerTarget }
    | { kind: "set_level"; targetQuery: string; target: LocalMixerTarget; unit: LevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; target: LocalMixerTarget; unit: LevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; target: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; unit: LevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; unit: LevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; mute: boolean }
    | { kind: "ramp_level"; targetQuery: string; target: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; target: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; to?: LevelValue; from?: LevelValue; delta?: LevelValue; durationSeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; direction: LocalRelativeDirection; amount: LocalRelativeAmount; durationSeconds: number }
    | { kind: "delay_level"; targetQuery: string; target: LocalMixerTarget; value: LevelValue; delaySeconds: number }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; source: LocalMixerTarget; destination: LocalMixerTarget; value: LevelValue; delaySeconds: number }
    | { kind: "automation_list" }
    | { kind: "automation_cancel"; id: string }
    | { kind: "bulk_bus_mute"; mode: "selected" | "all" | "all_except"; busQueries: string[]; buses: LocalMixerTarget[]; mute: boolean }
    | { kind: "bulk_send_db"; mode: "selected" | "all"; sourceQuery: string; source: LocalMixerTarget; busQueries: string[]; buses: LocalMixerTarget[]; db: number; includeMain: boolean }
    | { kind: "mute"; targetQuery: string; target: LocalMixerTarget; mute: boolean };

type LocalContinuation =
    | {
          intent: TargetIntent | SendIntent | BulkIntent;
          candidates: LocalMixerTarget[];
      }
    | {
          kind: "speaker_context";
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

function mainTarget(query: string): LocalMixerTarget | null {
    const normalized = simplify(query);
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
        .replace(/^\s*(?:le|la|les|du|de la|de l|d|the)\s+/iu, "")
        .replace(/\s*(?:fader|niveau|volume)\s*$/iu, "")
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

function levelToNormalized(unit: LevelUnit, value: number): { level: number; label: string } {
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
    const unit: LevelUnit = rawUnit === "%" ? "percent" : "db";
    const value = unit === "percent" ? parsePercent(rawValue) : parseDb(rawValue);
    return value === null ? null : { unit, value };
}

function cleanTemporalSubject(value: string): string {
    return cleanTarget(
        value
            .replace(/[,;]+/gu, " ")
            .replace(/\s+/gu, " ")
            .trim()
            .replace(/^(?:un|une)\s+/iu, "")
            .replace(
                /^(?:le\s+|la\s+)?(?:niveau|volume|fader)\s+(?:(?:de|du|de la|de l['’]?|of)\s+)?/iu,
                "",
            ),
    );
}

function parseFlexibleTemporalIntent(raw: string): Intent | null {
    const text = raw.trim();
    if (!text) return null;

    const durationMatch = text.match(
        /\ben\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\b/iu,
    );
    const delayMatch = text.match(
        /\bdans\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\b/iu,
    );

    if (!durationMatch && !delayMatch) return null;
    // A delay plus a ramp duration is a sequence/macro request. Do not silently collapse it.
    if (durationMatch && delayMatch) return null;

    const directionMatch = text.match(
        /\b(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\b/iu,
    );
    const direction = directionMatch?.[1] ? simplify(directionMatch[1]) : "";
    const isDown = ["baisse", "diminue", "lower", "decrease"].includes(direction);
    const amountMatch = text.match(/\b(un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\b/iu);
    const amountText = simplify(amountMatch?.[1] || "");
    const qualitativeAmount: LocalRelativeAmount =
        amountText === "un peu" || amountText === "a little" || amountText === "slightly"
            ? "little"
            : amountText === "beaucoup" || amountText === "a lot"
              ? "much"
              : "normal";

    const fadeMatch = text.match(/\bfade[ -]?(in|out)\b/iu);
    const hasProgressiveMarker =
        /\b(?:progressivement|progressively|gradually|rampe|ramp|fade(?:[ -]?(?:in|out))?)\b/iu.test(text);

    const rangeMatch = text.match(
        /\bde\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\b/iu,
    );
    let absoluteMatch: RegExpMatchArray | null = null;
    let relativeMatch: RegExpMatchArray | null = null;
    if (!rangeMatch) {
        absoluteMatch = text.match(
            /(?:^|\s)(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\b/iu,
        );
        relativeMatch = text.match(
            /\b(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\b/iu,
        );
    }

    let from: LevelValue | undefined;
    let to: LevelValue | undefined;
    let delta: LevelValue | undefined;
    let value: LevelValue | undefined;

    if (rangeMatch?.[1] && rangeMatch[2] && rangeMatch[3] && rangeMatch[4]) {
        const parsedFrom = parseTemporalLevelValue(rangeMatch[1], rangeMatch[2]);
        const parsedTo = parseTemporalLevelValue(rangeMatch[3], rangeMatch[4]);
        if (!parsedFrom || !parsedTo) return null;
        from = parsedFrom;
        to = parsedTo;
    } else if (absoluteMatch?.[1] && absoluteMatch[2]) {
        const parsed = parseTemporalLevelValue(absoluteMatch[1], absoluteMatch[2]);
        if (!parsed) return null;
        value = parsed;
        to = parsed;
    } else if (relativeMatch?.[1] && relativeMatch[2]) {
        const parsed = parseTemporalLevelValue(relativeMatch[1], relativeMatch[2]);
        if (!parsed || !direction) return null;
        delta = { ...parsed, value: isDown ? -Math.abs(parsed.value) : Math.abs(parsed.value) };
    }

    let remainder = text;
    const remove = (match: RegExpMatchArray | null) => {
        if (match?.[0]) remainder = remainder.replace(match[0], " ");
    };
    remove(durationMatch);
    remove(delayMatch);
    remove(rangeMatch);
    remove(absoluteMatch);
    remove(relativeMatch);

    remainder = remainder
        .replace(/\bfade[ -]?(?:in|out)\b/giu, " ")
        .replace(/\b(?:progressivement|progressively|gradually|rampe|ramp)\b/giu, " ")
        .replace(/\b(?:un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\b/giu, " ")
        .replace(/\b(?:fais|faire)\b/giu, " ")
        .replace(
            /\b(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease|mets|met|regle|règle|fixe|set)\b/giu,
            " ",
        )
        .replace(/\s+/gu, " ")
        .trim();

    const routeMatch = remainder.match(
        /^(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+)$/iu,
    );

    const sourceQuery = routeMatch?.[1] ? cleanTemporalSubject(routeMatch[1]) : "";
    const destinationQuery = routeMatch?.[2] ? cleanTemporalSubject(routeMatch[2]) : "";
    const targetQuery = routeMatch ? "" : cleanTemporalSubject(remainder || "main");

    const unboundLevelLiteral = remainder.match(
        /[+-]?\d+(?:[.,]\d+)?\s*(?:d[bB]|%)/u,
    );
    if (unboundLevelLiteral) return null;

    if (delayMatch?.[1]) {
        // "dans" is a delay marker. A progressive request without its own
        // "en N secondes" duration is incomplete and must not degrade to a direct set.
        if (hasProgressiveMarker) return null;
        const delaySeconds = Number(delayMatch[1].replace(",", "."));
        if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || !value) return null;
        if (routeMatch) {
            if (!sourceQuery || !destinationQuery) return null;
            return {
                kind: "send_delay_level",
                sourceQuery,
                destinationQuery,
                value,
                delaySeconds,
            };
        }
        return {
            kind: "delay_level",
            targetQuery: targetQuery || "main",
            value,
            delaySeconds,
        };
    }

    if (!durationMatch?.[1]) return null;
    const durationSeconds = Number(durationMatch[1].replace(",", "."));
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;

    // "en N secondes" is a ramp duration. A progressive marker is optional when
    // the duration + strict level marker already makes the temporal intent unambiguous.
    if (!hasProgressiveMarker && !from && !to && !delta) return null;

    if (!to && !delta) {
        if (fadeMatch?.[1]) {
            to = {
                unit: "db",
                value: simplify(fadeMatch[1]) === "out" ? -120 : 0,
            };
        } else if (direction) {
            const qualitativeDirection: LocalRelativeDirection = isDown ? "down" : "up";
            if (routeMatch) {
                if (!sourceQuery || !destinationQuery) return null;
                return {
                    kind: "send_ramp_level_qualitative",
                    sourceQuery,
                    destinationQuery,
                    direction: qualitativeDirection,
                    amount: qualitativeAmount,
                    durationSeconds,
                };
            }
            return {
                kind: "ramp_level_qualitative",
                targetQuery: targetQuery || "main",
                direction: qualitativeDirection,
                amount: qualitativeAmount,
                durationSeconds,
            };
        } else {
            return null;
        }
    }

    if (routeMatch) {
        if (!sourceQuery || !destinationQuery) return null;
        return {
            kind: "send_ramp_level",
            sourceQuery,
            destinationQuery,
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(delta ? { delta } : {}),
            durationSeconds,
        };
    }

    return {
        kind: "ramp_level",
        targetQuery: targetQuery || "main",
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(delta ? { delta } : {}),
        durationSeconds,
    };
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

function parseIntent(raw: string): Intent | null {
    const text = normalizeLikelyFrenchSttDirection(raw);
    const normalized = simplify(text);

    if (
        [
            "etat mixeur",
            "etat du mixeur",
            "statut mixeur",
            "statut du mixeur",
            "mixer status",
            "status mixer",
            "mixeur status",
        ].includes(normalized)
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
        ].includes(normalized)
    ) {
        return { kind: "automation_list" };
    }

    const cancelLastAutomation = /^(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:la|le)\s+)?(?:derniere|dernière|dernier|last)\s+(?:automation|automatisation|fade|rampe|ramp)$/iu.test(text);
    if (cancelLastAutomation) {
        return { kind: "automation_cancel", lastRunning: true };
    }

    const cancelAutomation = text.match(
        /^\s*(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:l['’]?|la\s+|le\s+)?(?:automation|automatisation|fade|rampe|ramp)\s+)?(auto-\d+)\s*$/iu,
    );
    if (cancelAutomation?.[1]) {
        return { kind: "automation_cancel", id: cancelAutomation[1].toLowerCase(), lastRunning: false };
    }

    const parseLevelValue = (rawValue: string, rawUnit: string): LevelValue | null =>
        parseTemporalLevelValue(rawValue, rawUnit);

    const flexibleTemporalIntent = parseFlexibleTemporalIntent(text);
    if (flexibleTemporalIntent) return flexibleTemporalIntent;

    // Main LR shorthand: when volume/level/fader is named without another target,
    // the mixer domain owns the default and routes it to Main LR.
    const mainRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:volume|niveau|fader)\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    );
    if (mainRelative?.[1] && mainRelative[2] && mainRelative[3]) {
        const value = parseLevelValue(mainRelative[2], mainRelative[3]);
        if (value) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(mainRelative[1]));
            return {
                kind: "adjust_level",
                targetQuery: "main",
                unit: value.unit,
                delta: down ? -Math.abs(value.value) : Math.abs(value.value),
            };
        }
    }

    const mainAbsolute = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set|monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:volume|niveau|fader)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    );
    if (mainAbsolute?.[1] && mainAbsolute[2]) {
        const value = parseLevelValue(mainAbsolute[1], mainAbsolute[2]);
        if (value) {
            return { kind: "set_level", targetQuery: "main", unit: value.unit, value: value.value };
        }
    }

    const bulkAllBusMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|unmute|demute|démute|reactive|réactive|remets)\s+tous\s+les\s+bus(?:\s+sauf\s+(.+))?\s*$/iu,
    );
    if (bulkAllBusMute?.[1]) {
        const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(bulkAllBusMute[1].toLocaleLowerCase("fr-FR"));
        const busQueries = bulkAllBusMute[2] ? splitTargetList(bulkAllBusMute[2]) : [];
        return {
            kind: "bulk_bus_mute",
            mode: busQueries.length > 0 ? "all_except" : "all",
            busQueries,
            mute,
        };
    }

    const bulkSelectedBusMute = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|unmute|demute|démute|reactive|réactive|remets)\s+(?:les\s+)?bus\s+(.+?)\s*$/iu,
    );
    if (bulkSelectedBusMute?.[1] && bulkSelectedBusMute[2]) {
        const busQueries = splitTargetList(bulkSelectedBusMute[2]);
        if (busQueries.length > 0) {
            const mute = !["unmute", "demute", "démute", "reactive", "réactive", "remets"].includes(bulkSelectedBusMute[1].toLocaleLowerCase("fr-FR"));
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
        const mainSuffix = destinationText.match(/^(.*?)(?:\s+et\s+(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr))\s*$/iu);
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

    // "dans N secondes" means delay before the write, never ramp duration.
    const sendDelayed = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+dans\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (sendDelayed?.[1] && sendDelayed[2] && sendDelayed[3] && sendDelayed[4] && sendDelayed[5]) {
        const value = parseLevelValue(sendDelayed[3], sendDelayed[4]);
        const delaySeconds = Number(sendDelayed[5].replace(",", "."));
        if (value && Number.isFinite(delaySeconds) && delaySeconds >= 0) {
            return {
                kind: "send_delay_level",
                sourceQuery: cleanTarget(sendDelayed[1]),
                destinationQuery: cleanTarget(sendDelayed[2]),
                value,
                delaySeconds,
            };
        }
    }

    const delayed = text.match(
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(?:(?:le\s+)?(?:niveau|volume|fader)\s*(?:de\s+|du\s+|de la\s+|of\s+)?)?(.+?)?\s*(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+dans\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (delayed?.[2] && delayed[3] && delayed[4]) {
        const value = parseLevelValue(delayed[2], delayed[3]);
        const delaySeconds = Number(delayed[4].replace(",", "."));
        if (value && Number.isFinite(delaySeconds) && delaySeconds >= 0) {
            return {
                kind: "delay_level",
                targetQuery: cleanTarget(delayed[1] || "main"),
                value,
                delaySeconds,
            };
        }
    }

    // Explicit source -> bus ramp, e.g. "monte progressivement batterie sur Anthony à -10 dB en 5 secondes".
    const sendRampAbsolute = text.match(
        /^\s*(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease|fade)\s+(?:progressivement\s+)?(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (sendRampAbsolute?.[1] && sendRampAbsolute[2] && sendRampAbsolute[3] && sendRampAbsolute[4] && sendRampAbsolute[5]) {
        const to = parseLevelValue(sendRampAbsolute[3], sendRampAbsolute[4]);
        const durationSeconds = Number(sendRampAbsolute[5].replace(",", "."));
        if (to && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            return {
                kind: "send_ramp_level",
                sourceQuery: cleanTarget(sendRampAbsolute[1]),
                destinationQuery: cleanTarget(sendRampAbsolute[2]),
                to,
                durationSeconds,
            };
        }
    }

    const sendRampRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:progressivement\s+)?(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (sendRampRelative?.[1] && sendRampRelative[2] && sendRampRelative[3] && sendRampRelative[4] && sendRampRelative[5] && sendRampRelative[6]) {
        const delta = parseLevelValue(sendRampRelative[4], sendRampRelative[5]);
        const durationSeconds = Number(sendRampRelative[6].replace(",", "."));
        if (delta && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(sendRampRelative[1]));
            return {
                kind: "send_ramp_level",
                sourceQuery: cleanTarget(sendRampRelative[2]),
                destinationQuery: cleanTarget(sendRampRelative[3]),
                delta: { ...delta, value: down ? -Math.abs(delta.value) : Math.abs(delta.value) },
                durationSeconds,
            };
        }
    }

    // Fade-in/out defaults to Main LR when the target is omitted.
    const fade = text.match(
        /^\s*(?:fais\s+(?:un\s+)?)?fade[ -]?(in|out)(?:\s+(?:de\s+|du\s+|sur\s+)?(.+?))?\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (fade?.[1] && fade[3]) {
        const durationSeconds = Number(fade[3].replace(",", "."));
        if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
            return {
                kind: "ramp_level",
                targetQuery: cleanTarget(fade[2] || "main"),
                to: { unit: "db", value: simplify(fade[1]) === "out" ? -120 : 0 },
                durationSeconds,
            };
        }
    }

    const explicitRangeRamp = text.match(
        /^\s*(?:fais\s+(?:un\s+)?)?(?:fade|rampe|ramp)\s+(?:(?:de|du|sur)\s+)?(.+?)\s+de\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (explicitRangeRamp?.[1] && explicitRangeRamp[2] && explicitRangeRamp[3] && explicitRangeRamp[4] && explicitRangeRamp[5] && explicitRangeRamp[6]) {
        const from = parseLevelValue(explicitRangeRamp[2], explicitRangeRamp[3]);
        const to = parseLevelValue(explicitRangeRamp[4], explicitRangeRamp[5]);
        const durationSeconds = Number(explicitRangeRamp[6].replace(",", "."));
        if (from && to && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            return {
                kind: "ramp_level",
                targetQuery: cleanTarget(explicitRangeRamp[1]),
                from,
                to,
                durationSeconds,
            };
        }
    }

    const targetRampAbsolute = text.match(
        /^\s*(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+progressivement\s*(?:(?:le\s+)?(?:niveau|volume|fader)\s*(?:de\s+|du\s+|de la\s+|of\s+)?)?(.+?)?\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (targetRampAbsolute?.[2] && targetRampAbsolute[3] && targetRampAbsolute[4]) {
        const to = parseLevelValue(targetRampAbsolute[2], targetRampAbsolute[3]);
        const durationSeconds = Number(targetRampAbsolute[4].replace(",", "."));
        if (to && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            return {
                kind: "ramp_level",
                targetQuery: cleanTarget(targetRampAbsolute[1] || "main"),
                to,
                durationSeconds,
            };
        }
    }

    const targetRampRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+progressivement\s*(?:(?:le\s+)?(?:niveau|volume|fader)\s*(?:de\s+|du\s+|de la\s+|of\s+)?)?(.+?)?\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (targetRampRelative?.[1] && targetRampRelative[3] && targetRampRelative[4] && targetRampRelative[5]) {
        const delta = parseLevelValue(targetRampRelative[3], targetRampRelative[4]);
        const durationSeconds = Number(targetRampRelative[5].replace(",", "."));
        if (delta && Number.isFinite(durationSeconds) && durationSeconds > 0) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(targetRampRelative[1]));
            return {
                kind: "ramp_level",
                targetQuery: cleanTarget(targetRampRelative[2] || "main"),
                delta: { ...delta, value: down ? -Math.abs(delta.value) : Math.abs(delta.value) },
                durationSeconds,
            };
        }
    }

    const qualitativeRamp = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+progressivement\s*(?:(?:le\s+)?(?:niveau|volume|fader)\s*(?:de\s+|du\s+|de la\s+|of\s+)?)?(.+?)?\s+en\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\s*$/iu,
    );
    if (qualitativeRamp?.[1] && qualitativeRamp[3]) {
        const durationSeconds = Number(qualitativeRamp[3].replace(",", "."));
        if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(qualitativeRamp[1]));
            return {
                kind: "ramp_level",
                targetQuery: cleanTarget(qualitativeRamp[2] || "main"),
                delta: { unit: "db", value: down ? -3 : 3 },
                durationSeconds,
            };
        }
    }

    const sendAbsolutePatterns = [
        /^\s*(?:mets|met|regle|règle|fixe|set|monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
        /^\s*(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    ];
    for (const re of sendAbsolutePatterns) {
        const match = text.match(re);
        if (match?.[1] && match[2] && match[3] && match[4]) {
            const unit: LevelUnit = match[4] === "%" ? "percent" : "db";
            const value = unit === "percent" ? parsePercent(match[3]) : parseDb(match[3]);
            if (value !== null) {
                return {
                    kind: "send_set_level",
                    sourceQuery: cleanTarget(match[1]),
                    destinationQuery: cleanTarget(match[2]),
                    unit,
                    value,
                };
            }
        }
    }

    const sendRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    );
    if (sendRelative?.[1] && sendRelative[2] && sendRelative[3] && sendRelative[4] && sendRelative[5]) {
        const unit: LevelUnit = sendRelative[5] === "%" ? "percent" : "db";
        const base = unit === "percent" ? parsePercent(sendRelative[4]) : parseDb(sendRelative[4]);
        if (base !== null) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(sendRelative[1]));
            return {
                kind: "send_adjust_level",
                sourceQuery: cleanTarget(sendRelative[2]),
                destinationQuery: cleanTarget(sendRelative[3]),
                unit,
                delta: down ? -Math.abs(base) : Math.abs(base),
            };
        }
    }

    const sendQualitative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:(un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\s+)?(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s*$/iu,
    );
    if (sendQualitative?.[1] && sendQualitative[3] && sendQualitative[4]) {
        const verb = simplify(sendQualitative[1]);
        const amountText = simplify(sendQualitative[2] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" || amountText === "a little" || amountText === "slightly"
                ? "little"
                : amountText === "beaucoup" || amountText === "a lot"
                  ? "much"
                  : "normal";
        const direction: LocalRelativeDirection =
            ["baisse", "diminue", "lower", "decrease"].includes(verb) ? "down" : "up";
        return {
            kind: "send_adjust_level_qualitative",
            sourceQuery: cleanTarget(sendQualitative[3]),
            destinationQuery: cleanTarget(sendQualitative[4]),
            direction,
            amount,
        };
    }

    const directionalAbsoluteTarget = text.match(
        /^\s*(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    );
    if (directionalAbsoluteTarget?.[1] && directionalAbsoluteTarget[2] && directionalAbsoluteTarget[3]) {
        const unit: LevelUnit = directionalAbsoluteTarget[3] === "%" ? "percent" : "db";
        const value = unit === "percent"
            ? parsePercent(directionalAbsoluteTarget[2])
            : parseDb(directionalAbsoluteTarget[2]);
        const targetQuery = cleanTarget(directionalAbsoluteTarget[1]);
        if (value !== null && targetQuery) {
            return { kind: "set_level", targetQuery, unit, value };
        }
    }

    const sendMutePatterns: Array<{ re: RegExp; mute: boolean }> = [
        {
            re: /^\s*(?:mute|coupe|couper|desactive|désactive)\s+(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s*$/iu,
            mute: true,
        },
        {
            re: /^\s*(?:unmute|demute|démute|reactive|réactive|remets)\s+(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+?)\s*$/iu,
            mute: false,
        },
    ];
    for (const pattern of sendMutePatterns) {
        const match = text.match(pattern.re);
        if (match?.[1] && match[2]) {
            const sourceQuery = cleanTarget(match[1]);
            const destinationQuery = cleanTarget(match[2]);
            if (sourceQuery && destinationQuery) {
                return {
                    kind: "send_mute",
                    sourceQuery,
                    destinationQuery,
                    mute: pattern.mute,
                };
            }
        }
    }

    const mutePatterns: Array<{ re: RegExp; mute: boolean }> = [
        { re: /^\s*(?:mute|coupe|couper|desactive|désactive)\s+(?:le\s+son\s+de\s+)?(.+?)\s*$/iu, mute: true },
        { re: /^\s*(?:unmute|demute|démute|reactive|réactive|remets)\s+(?:le\s+son\s+de\s+)?(.+?)\s*$/iu, mute: false },
    ];
    for (const pattern of mutePatterns) {
        const match = text.match(pattern.re);
        if (match?.[1]) {
            const targetQuery = cleanTarget(match[1]);
            if (targetQuery) return { kind: "mute", targetQuery, mute: pattern.mute };
        }
    }

    const explicitRelative = text.match(
        /^\s*(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB]\s*$/iu,
    );
    if (explicitRelative?.[1] && explicitRelative[2]) {
        const base = parseDb(explicitRelative[2]);
        if (base !== null) {
            const directionWord = simplify(text.split(/\s+/u)[0] || "");
            const down = ["baisse", "diminue", "lower", "decrease"].includes(directionWord);
            const deltaDb = down ? -Math.abs(base) : Math.abs(base);
            return {
                kind: "adjust_level",
                targetQuery: cleanTarget(explicitRelative[1]),
                unit: "db",
                delta: deltaDb,
            };
        }
    }

    const signedRelative = text.match(
        /^\s*(?:ajuste|adjust|change)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:de|by)\s+([+-]\d+(?:[.,]\d+)?)\s*d[bB]\s*$/iu,
    );
    if (signedRelative?.[1] && signedRelative[2]) {
        const deltaDb = parseDb(signedRelative[2]);
        if (deltaDb !== null) {
            return {
                kind: "adjust_level",
                targetQuery: cleanTarget(signedRelative[1]),
                unit: "db",
                delta: deltaDb,
            };
        }
    }

    const relativePercent = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*%\s*$/iu,
    );
    if (relativePercent?.[1] && relativePercent[2] && relativePercent[3]) {
        const base = parsePercent(relativePercent[3]);
        if (base !== null) {
            const down = ["baisse", "diminue", "lower", "decrease"].includes(simplify(relativePercent[1]));
            return {
                kind: "adjust_level",
                targetQuery: cleanTarget(relativePercent[2]),
                unit: "percent",
                delta: down ? -Math.abs(base) : Math.abs(base),
            };
        }
    }

    const naturalRouteDirection = text.match(
        /^\s*(?:(un\s+peu|beaucoup)\s+)?(plus|moins)\s+fort\s+(.+?)\s+(?:sur|dans|vers|chez)\s+(.+?)\s*$/iu,
    );
    if (naturalRouteDirection?.[2] && naturalRouteDirection[3] && naturalRouteDirection[4]) {
        const amountText = simplify(naturalRouteDirection[1] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" ? "little" : amountText === "beaucoup" ? "much" : "normal";
        return {
            kind: "send_adjust_level_qualitative",
            sourceQuery: cleanTarget(naturalRouteDirection[3]),
            destinationQuery: cleanTarget(naturalRouteDirection[4]),
            direction: simplify(naturalRouteDirection[2]) === "moins" ? "down" : "up",
            amount,
        };
    }

    const naturalPrefixDirection = text.match(
        /^\s*(?:(un\s+peu|beaucoup)\s+)?(plus|moins)\s+fort(?:\s+(?:le\s+)?(?:niveau|volume|fader)(?:\s+(?:de|du|de la))?)?\s*(.*?)\s*$/iu,
    );
    if (naturalPrefixDirection?.[2]) {
        const amountText = simplify(naturalPrefixDirection[1] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" ? "little" : amountText === "beaucoup" ? "much" : "normal";
        return {
            kind: "adjust_level_qualitative",
            targetQuery: cleanTarget(naturalPrefixDirection[3] || "main") || "main",
            direction: simplify(naturalPrefixDirection[2]) === "moins" ? "down" : "up",
            amount,
        };
    }

    const naturalSuffixDirection = text.match(
        /^\s*(.+?)\s+(?:(un\s+peu|beaucoup)\s+)?(plus|moins)\s+fort\s*$/iu,
    );
    if (naturalSuffixDirection?.[1] && naturalSuffixDirection[3]) {
        const amountText = simplify(naturalSuffixDirection[2] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" ? "little" : amountText === "beaucoup" ? "much" : "normal";
        return {
            kind: "adjust_level_qualitative",
            targetQuery: cleanTarget(naturalSuffixDirection[1]),
            direction: simplify(naturalSuffixDirection[3]) === "moins" ? "down" : "up",
            amount,
        };
    }

    const mainQualitativeRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:(un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\s+)?(?:le\s+)?(?:niveau|volume|fader)\s*$/iu,
    );
    if (mainQualitativeRelative?.[1]) {
        const verb = simplify(mainQualitativeRelative[1]);
        const amountText = simplify(mainQualitativeRelative[2] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" || amountText === "a little" || amountText === "slightly"
                ? "little"
                : amountText === "beaucoup" || amountText === "a lot"
                  ? "much"
                  : "normal";
        const direction: LocalRelativeDirection =
            ["baisse", "diminue", "lower", "decrease"].includes(verb) ? "down" : "up";
        return {
            kind: "adjust_level_qualitative",
            targetQuery: "main",
            direction,
            amount,
        };
    }

    const qualitativeRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:(un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\s+)?(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s*$/iu,
    );
    if (qualitativeRelative?.[1] && qualitativeRelative[3]) {
        const verb = simplify(qualitativeRelative[1]);
        const amountText = simplify(qualitativeRelative[2] || "");
        const amount: LocalRelativeAmount =
            amountText === "un peu" || amountText === "a little" || amountText === "slightly"
                ? "little"
                : amountText === "beaucoup" || amountText === "a lot"
                  ? "much"
                  : "normal";
        const direction: LocalRelativeDirection =
            ["baisse", "diminue", "lower", "decrease"].includes(verb) ? "down" : "up";
        return {
            kind: "adjust_level_qualitative",
            targetQuery: cleanTarget(qualitativeRelative[3]),
            direction,
            amount,
        };
    }

    const setPatterns = [
        /^\s*(?:mets|met|regle|règle|fixe|set|monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
        /^\s*(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s*$/iu,
    ];
    for (const re of setPatterns) {
        const match = text.match(re);
        if (match?.[1] && match[2] && match[3]) {
            const unit: LevelUnit = match[3] === "%" ? "percent" : "db";
            const value = unit === "percent" ? parsePercent(match[2]) : parseDb(match[2]);
            const targetQuery = cleanTarget(match[1]);
            if (value !== null && targetQuery) {
                return { kind: "set_level", targetQuery, unit, value };
            }
        }
    }

    const readPatterns = [
        /^\s*(?:quel(?:le)?\s+est\s+)?(?:le\s+)?(?:niveau|volume|fader)\s+(?:de\s+|du\s+|de la\s+|of\s+)(.+?)\s*\??\s*$/iu,
        /^\s*(?:lis|donne|read|get)\s+(?:le\s+)?(?:niveau|volume|fader)\s+(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s*$/iu,
        /^\s*(.+?)\s+(?:niveau|volume|fader)\s*\??\s*$/iu,
    ];
    for (const re of readPatterns) {
        const match = text.match(re);
        if (match?.[1]) {
            const targetQuery = cleanTarget(match[1]);
            if (targetQuery) return { kind: "read_level", targetQuery };
        }
    }

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
                // Source -> "my return" means source -> Main LR. XMSeries owns this
                // semantic rewrite; LSA transports only neutral speaker metadata.
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

        if (input.continuationToken) {
            return await this.continueIntent(input.text, input.continuationToken);
        }

        const expanded = await this.expandSpeakerContext(input.text, input.context);
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
        if (!intent) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
            };
        }

        if (intent.kind === "status" || intent.kind === "automation_list") {
            const stored = this.store.createPlan({ kind: intent.kind }, "read");
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

        if (intent.kind === "bulk_bus_mute" || intent.kind === "bulk_send_db") {
            return await this.planBulkIntent(intent);
        }

        if (
            intent.kind === "send_set_level" ||
            intent.kind === "send_adjust_level" ||
            intent.kind === "send_adjust_level_qualitative" ||
            intent.kind === "send_ramp_level" ||
            intent.kind === "send_ramp_level_qualitative" ||
            intent.kind === "send_delay_level"
        ) {
            return await this.planSendIntent(intent);
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
                plan.kind === "send_set_level" ||
                plan.kind === "send_adjust_level" ||
                plan.kind === "send_adjust_level_qualitative" ||
                plan.kind === "send_mute" ||
                plan.kind === "send_ramp_level" ||
                plan.kind === "send_ramp_level_qualitative" ||
                plan.kind === "send_delay_level"
            ) {
                const source = await this.revalidateScopedTarget(plan.sourceQuery, plan.source, SEND_SOURCE_FAMILIES);
                const destination = await this.revalidateScopedTarget(plan.destinationQuery, plan.destination, ["bus"]);
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
                if (plan.kind === "send_delay_level") {
                    const converted = levelToNormalized(plan.value.unit, plan.value.value);
                    const jobId = await this.adapter.scheduleSend(source, destination, converted.level, plan.delaySeconds);
                    return {
                        protocol: GATEWAY_PROTOCOL,
                        ok: true,
                        responseText: `Action programmée ${jobId} : ${displayName(source)} → ${displayName(destination)} à ${converted.label} dans ${plan.delaySeconds} s.`,
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
                        responseText: `Automation ${jobId} démarrée : ${displayName(source)} → ${displayName(destination)} de ${formatDb(preview.beforeDb)} vers ${formatDb(preview.targetDb)} sur ${plan.durationSeconds} s.`,
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
                    responseText: `Automation ${jobId} démarrée : ${displayName(source)} → ${displayName(destination)} sur ${plan.durationSeconds} s.`,
                };
            }

            const liveTarget = await this.revalidateTarget(plan.targetQuery, plan.target, true);

            if (plan.kind === "delay_level") {
                const converted = levelToNormalized(plan.value.unit, plan.value.value);
                const jobId = await this.adapter.scheduleLevel(liveTarget, converted.level, plan.delaySeconds);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `Action programmée ${jobId} : ${displayName(liveTarget)} à ${converted.label} dans ${plan.delaySeconds} s.`,
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
                    responseText: `Automation ${jobId} démarrée : ${displayName(liveTarget)} de ${formatDb(preview.beforeDb)} vers ${formatDb(preview.targetDb)} sur ${plan.durationSeconds} s.`,
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
                    responseText: `Automation ${jobId} démarrée : ${displayName(liveTarget)} sur ${plan.durationSeconds} s.`,
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
                : sourceMatches.length
                  ? summarizeCandidates(sourceMatches)
                  : `aucune source pour « ${intent.sourceQuery} »`;
            const destinationText = destination
                ? displayName(destination)
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

        const stored = this.store.createPlan({ ...intent, source, destination }, "write");
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
        if (
            target.family === "dca" &&
            intent.kind !== "read_level"
        ) {
            const stored = this.store.createContinuation({
                intent,
                candidates: [target],
            });
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: true,
                status: "clarification",
                effect: "none",
                continuationToken: stored.token,
                expiresInMs: stored.expiresInMs,
                responseText:
                    "Les écritures DCA ne font pas partie du MVP déterministe actuel. Indique une autre cible.",
            };
        }

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
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
                responseText: "Reformule la commande complète en précisant le retour, le bus ou la voie.",
            };
        }

        const active = continuation.value;
        if ("busQueries" in active.intent || "sourceQuery" in active.intent) {
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
                responseText: "Reformule la commande complète avec la source et le bus de destination exacts.",
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
