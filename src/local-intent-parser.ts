import {
    isAutomationStatusUtterance,
    isMainLevelReadUtterance,
    isMixerStatusUtterance,
} from "./local-language.js";

/**
 * Native deterministic mixer intent parser.
 *
 * Design:
 * - regexes recognize local lexical primitives only (verbs, levels, duration, delay)
 * - semantic markers keep their meaning: "à" absolute, "de" relative,
 *   "en" ramp duration, "dans" delay unless it binds a route, route markers bind destination
 * - intent selection is constraint-driven after slot extraction
 * - target resolution/authorization remains in local-gateway.ts
 */

export type NativeLevelUnit = "db" | "percent" | "level";
export type NativeLevelValue = { unit: NativeLevelUnit; value: number };
export type NativeDirection = "up" | "down";
export type NativeAmount = "little" | "normal" | "much";

export type NativeSendIntent =
    | { kind: "send_read_level"; sourceQuery: string; destinationQuery: string }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; unit: NativeLevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; unit: NativeLevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: NativeDirection; amount: NativeAmount }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; mute: boolean }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; value: NativeLevelValue; delaySeconds: number }
    | { kind: "send_delay_mute"; sourceQuery: string; destinationQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number }
    | { kind: "send_delayed_ramp_level"; sourceQuery: string; destinationQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: NativeDirection; amount: NativeAmount; durationSeconds: number };

export type NativeMixerIntent =
    | { kind: "status" }
    | { kind: "automation_list" }
    | { kind: "automation_cancel"; id?: string; lastRunning: boolean }
    | { kind: "read_channel_name"; channel: number }
    | { kind: "read_mute"; targetQuery: string }
    | { kind: "read_effect_on"; targetQuery: string }
    | { kind: "set_effect_on"; targetQuery: string; on: boolean }
    | { kind: "send_to_aux_output"; sourceQuery: string; aux: number; unit: NativeLevelUnit; value: number }
    | { kind: "bulk_channel_mute"; mode: "selected" | "all" | "all_except"; channelQueries: string[]; mute: boolean }
    | { kind: "bulk_bus_mute"; mode: "selected" | "all" | "all_except"; busQueries: string[]; mute: boolean }
    | { kind: "bulk_named_mute"; targetQueries: string[]; rawQuery: string; mute: boolean }
    | { kind: "bulk_send_db"; mode: "selected" | "all"; sourceQuery: string; busQueries: string[]; db: number; includeMain: boolean }
    | { kind: "multi_send"; intent: NativeSendIntent; destinationQueries: string[]; rawDestinationQuery: string }
    | { kind: "read_level"; targetQuery: string }
    | { kind: "set_level"; targetQuery: string; unit: NativeLevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; unit: NativeLevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; direction: NativeDirection; amount: NativeAmount }
    | { kind: "mute"; targetQuery: string; mute: boolean }
    | { kind: "delay_level"; targetQuery: string; value: NativeLevelValue; delaySeconds: number }
    | { kind: "delay_mute"; targetQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "ramp_level"; targetQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number }
    | { kind: "delayed_ramp_level"; targetQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; direction: NativeDirection; amount: NativeAmount; durationSeconds: number }
    | NativeSendIntent;

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

function number(raw: string): number | null {
    const value = Number(raw.trim().replace(",", "."));
    return Number.isFinite(value) ? value : null;
}

function level(rawValue: string, rawUnit: string): NativeLevelValue | null {
    const value = number(rawValue);
    if (value === null) return null;
    const normalizedUnit = simplify(rawUnit);
    if (rawUnit === "%") return { unit: "percent", value };
    if (normalizedUnit === "level" || normalizedUnit === "niveau") {
        if (value < 0 || value > 1) return null;
        return { unit: "level", value };
    }
    return { unit: "db", value };
}

function amountFrom(raw: string | undefined): NativeAmount {
    const value = simplify(raw || "");
    if (value === "un peu" || value === "a little" || value === "slightly") return "little";
    if (value === "beaucoup" || value === "a lot") return "much";
    return "normal";
}

function cleanTarget(raw: string): string {
    let value = raw
        .replace(/[,;:]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();

    // Strip only leading grammatical wrappers, and allow a short stack such as
    // "un de Voix" created after removing "fais ... fade out". Internal ownership
    // markers (e.g. "guitare de anto") are deliberately preserved.
    for (let i = 0; i < 3; i += 1) {
        const next = value
            .replace(/^(?:de la|de l['’]?|du|d['’]?|de|le|la|les|l['’]?|un|une)\s+/iu, "")
            .trim();
        if (next === value) break;
        value = next;
    }

    return value
        .replace(/^(?:niveau|volume|fader|son)\s+(?:(?:de la|de l['’]?|du|de|of)\s+)?/iu, "")
        .replace(/\s+(?:niveau|volume|fader|son)\s*$/iu, "")
        .trim();
}

function compact(raw: string): string {
    return raw
        .replace(/[(),;:]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}

function take(text: string, re: RegExp): { text: string; match: RegExpMatchArray | null } {
    const match = text.match(re);
    if (!match?.[0]) return { text, match: null };
    return { text: compact(text.replace(match[0], " ")), match };
}

function directionFrom(raw: string | undefined): NativeDirection | null {
    const value = simplify(raw || "");
    if (["monte", "augmente", "raise", "increase"].includes(value)) return "up";
    if (["baisse", "diminue", "lower", "decrease"].includes(value)) return "down";
    return null;
}

function splitTargetList(value: string): string[] {
    return value
        .split(/\s*(?:,|;|\bet\b|\band\b)\s*/iu)
        .map((item) => cleanTarget(item))
        .filter(Boolean);
}

function withDestinationList(intent: NativeSendIntent): NativeMixerIntent {
    const destinationQueries = splitTargetList(intent.destinationQuery);
    if (destinationQueries.length < 2) return intent;
    return {
        kind: "multi_send",
        intent,
        destinationQueries,
        rawDestinationQuery: intent.destinationQuery,
    };
}

function muteValue(raw: string): boolean {
    const value = simplify(raw);
    return !["unmute", "demute", "reactive", "active", "rallume", "ouvre", "remet", "remets"].includes(value);
}

function parseControlIntent(text: string): NativeMixerIntent | null {
    if (isMixerStatusUtterance(text)) return { kind: "status" };
    if (isAutomationStatusUtterance(text)) return { kind: "automation_list" };

    const cancelLast = text.match(
        /^\s*(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:la|le)\s+)?(?:derniere|dernière|dernier|last)\s+(?:automation|automatisation|fade|rampe|ramp)\s*$/iu,
    );
    if (cancelLast) return { kind: "automation_cancel", lastRunning: true };

    const cancelById = text.match(
        /^\s*(?:annule|annuler|cancel|stop|arrete|arrête)\s+(?:(?:l['’]?|la\s+|le\s+)?(?:automation|automatisation|fade|rampe|ramp)\s+)?(auto-\d+)\s*$/iu,
    );
    if (cancelById?.[1]) {
        return { kind: "automation_cancel", id: cancelById[1].toLowerCase(), lastRunning: false };
    }

    const channelName = text.match(
        /^\s*(?:(?:quel(?:le)?\s+est\s+)?(?:le\s+)?nom\s+(?:de\s+)?(?:la\s+)?(?:voie|tranche|canal|channel)\s+(\d+)|(?:channel|voie|tranche|canal)\s+(\d+)\s+(?:name|nom))\s*\??\s*$/iu,
    );
    if (channelName) {
        const channel = Number(channelName[1] || channelName[2]);
        if (Number.isInteger(channel) && channel > 0) return { kind: "read_channel_name", channel };
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
        /^\s*(?:etat|état|statut)\s+(?:de\s+)?(?:l['’]?effet|effet|fx)\s+(.+?)\s*\??\s*$/iu,
    );
    const effectStateQuestion = text.match(
        /^\s*(?:est[-\s]?ce\s+que\s+)?(.+?)\s+(?:est\s+(?:actif|active|allume|allumé|allumée|on)|est[-\s]?(?:il|elle)\s+(?:actif|active|allume|allumé|allumée|on))\s*\??\s*$/iu,
    );
    if (effectStatePrefix || effectStateQuestion) {
        const targetQuery = cleanTarget(effectStatePrefix?.[1] || effectStateQuestion?.[1] || "");
        if (targetQuery) return { kind: "read_effect_on", targetQuery };
    }

    // Effect-engine on/off is deliberately explicit. "mute Hall FX" remains a
    // return mute; only wording that names "effet/effect/fx" as the object
    // selects the effect engine state.
    const effectSet = text.match(
        /^\s*(mute|coupe|desactive|désactive|eteins|éteins|unmute|reactive|réactive|active|rallume|ouvre|allume|enable|on|off|disable)\s+(?:(?:l['’]?|le\s+|la\s+)?(?:effet|effect|fx)\s+)(.+?)\s*$/iu,
    );
    if (effectSet?.[1] && effectSet[2]) {
        const action = simplify(effectSet[1]);
        const on = ["unmute", "reactive", "active", "rallume", "ouvre", "allume", "enable", "on"].includes(action);
        const targetQuery = cleanTarget(effectSet[2]);
        if (targetQuery) return { kind: "set_effect_on", targetQuery, on };
    }

    if (isMainLevelReadUtterance(text)) return { kind: "read_level", targetQuery: "main" };
    return null;
}

function parseBulkMuteIntent(text: string): NativeMixerIntent | null {
    const action = text.match(
        /^\s*(mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\b/iu,
    );
    if (!action?.[1]) return null;

    const mute = muteValue(action[1]);
    let rest = compact(text.slice(action[0].length));
    let family: "channel" | "bus" | null = null;
    let all = false;

    const allChannels = rest.match(/^(?:toutes\s+les\s+(?:voies|tranches)|tous\s+les\s+(?:canaux|channels)|all\s+channels)\b/iu);
    const allBuses = rest.match(/^(?:tous\s+les\s+bus|all\s+buses)\b/iu);
    const selectedChannels = rest.match(/^(?:les\s+)?(?:voies|tranches|canaux|channels)\b/iu);
    const selectedBuses = rest.match(/^(?:les\s+)?bus\b/iu);

    const marker = allChannels || allBuses || selectedChannels || selectedBuses;
    if (!marker) {
        // A route owns its destination list. Do not reinterpret
        // "mute Source sur A et B" as the flat targets "Source sur A" + "B".
        if (/\b(?:sur|dans|vers|chez|to|in)\b/iu.test(rest)) return null;
        const targetQueries = splitTargetList(rest);
        if (targetQueries.length < 2) return null;
        return {
            kind: "bulk_named_mute",
            targetQueries,
            rawQuery: cleanTarget(rest),
            mute,
        };
    }
    if (allChannels || selectedChannels) family = "channel";
    if (allBuses || selectedBuses) family = "bus";
    all = Boolean(allChannels || allBuses);
    rest = compact(rest.slice(marker[0].length));

    if (all) {
        if (!rest) {
            return family === "channel"
                ? { kind: "bulk_channel_mute", mode: "all", channelQueries: [], mute }
                : { kind: "bulk_bus_mute", mode: "all", busQueries: [], mute };
        }
        const except = rest.match(/^(?:sauf|except)\s+(.+)$/iu);
        if (!except?.[1]) return null;
        const queries = splitTargetList(except[1]);
        if (!queries.length) return null;
        return family === "channel"
            ? { kind: "bulk_channel_mute", mode: "all_except", channelQueries: queries, mute }
            : { kind: "bulk_bus_mute", mode: "all_except", busQueries: queries, mute };
    }

    const queries = splitTargetList(rest);
    if (!queries.length) return null;
    return family === "channel"
        ? { kind: "bulk_channel_mute", mode: "selected", channelQueries: queries, mute }
        : { kind: "bulk_bus_mute", mode: "selected", busQueries: queries, mute };
}

function parseBulkSendIntent(text: string): NativeMixerIntent | null {
    const set = text.match(/^\s*(?:mets|met|regle|règle|fixe|set)\b/iu);
    if (!set) return null;
    let rest = compact(text.slice(set[0].length));

    const valueSlot = take(rest, /(?:^|\s)(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB](?=\s|$)/iu);
    if (!valueSlot.match?.[1]) return null;
    const db = number(valueSlot.match[1]);
    if (db === null) return null;
    rest = valueSlot.text;

    const destination = rest.match(/\b(?:sur|to)\s+((?:tous\s+les\s+bus|all\s+buses)|(?:les\s+)?bus)\b/iu);

    let sourceQuery: string;
    let tail: string;
    let explicitBusSelector = false;
    let all = false;

    if (destination?.[0] && destination[1] && destination.index !== undefined) {
        explicitBusSelector = true;
        all = /^(?:tous\s+les\s+bus|all\s+buses)$/iu.test(destination[1]);
        sourceQuery = cleanTarget(rest.slice(0, destination.index));
        tail = compact(rest.slice(destination.index + destination[0].length));
    } else {
        return null;
    }
    if (!sourceQuery) return null;

    let includeMain = false;
    const mainSuffix = tail.match(
        /^(.*?)(?:\s+et\s+(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr))\s*$/iu,
    );
    if (mainSuffix) {
        tail = compact(mainSuffix[1] || "");
        includeMain = true;
    } else if (/^(?:et\s+)?(?:la\s+)?(?:facade|façade|main(?:\s+lr)?|lr)$/iu.test(tail)) {
        tail = "";
        includeMain = true;
    }

    if (all) {
        if (tail && !includeMain) return null;
        return { kind: "bulk_send_db", mode: "all", sourceQuery, busQueries: [], db, includeMain };
    }

    const busQueries = splitTargetList(tail);
    if (!explicitBusSelector || !busQueries.length) return null;
    // A single explicit bus destination is still an ordinary route. Let the
    // generic route parser preserve the "bus" qualifier so the resolver can
    // constrain that endpoint. Batch semantics start at two destinations.
    if (busQueries.length === 1) return null;
    return { kind: "bulk_send_db", mode: "selected", sourceQuery, busQueries, db, includeMain };
}

function parsePhysicalAuxIntent(text: string): NativeMixerIntent | null {
    const set = text.match(/^\s*(?:mets|met|regle|règle|fixe|set)\b/iu);
    if (!set) return null;
    const rest = compact(text.slice(set[0].length));
    const destination = rest.match(/\b(?:sur|vers|to)\s+(?:la\s+)?(?:sortie\s+aux|aux\s+output)\s+(\d+)\b/iu);
    if (!destination?.[1] || destination.index === undefined) return null;

    const aux = Number(destination[1]);
    if (!Number.isInteger(aux) || aux <= 0) return null;
    const sourceQuery = cleanTarget(rest.slice(0, destination.index));
    if (!sourceQuery) return null;

    const tail = compact(rest.slice(destination.index + destination[0].length));
    const normalized = tail.match(/^(?:(?:a|à|to)\s+)?(?:au\s+)?(?:niveau|level)\s+(0(?:[.,]\d+)?|1(?:[.,]0+)?)$/iu);
    if (normalized?.[1]) {
        const parsed = level(normalized[1], "level");
        if (parsed) return { kind: "send_to_aux_output", sourceQuery, aux, unit: parsed.unit, value: parsed.value };
    }

    const explicit = tail.match(/^(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)$/iu);
    if (explicit?.[1] && explicit[2]) {
        const parsed = level(explicit[1], explicit[2]);
        if (parsed) return { kind: "send_to_aux_output", sourceQuery, aux, unit: parsed.unit, value: parsed.value };
    }

    return null;
}

function readRequested(text: string): boolean {
    // A trailing level noun is a read cue only when no explicit write verb is present.
    // This prevents "monte le son" / "baisse le volume" from degrading into reads.
    if (/\b(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease|mets|met|regle|règle|fixe|set|mute|coupe|unmute|rallume|reactive|réactive)\b/iu.test(text)) {
        return false;
    }
    return (
        /^\s*(?:quel(?:le)?\s+est\s+)?(?:le\s+)?(?:niveau|volume|fader|son)\b/iu.test(text) ||
        /^\s*(?:lis|donne(?:-|\s)+moi|donne|read|get|affiche|montre(?:-|\s)+moi)\b/iu.test(text) ||
        /^\s*(?:c['’]?est\s+quoi|combien\s+vaut|o[uù]\s+est)\s+(?:le\s+)?(?:niveau|volume|fader|son)\b/iu.test(text) ||
        /^\s*(?:peux[-\s]+tu|pourrais[-\s]+tu|tu\s+peux)(?:\s+me)?(?:\s+dire)?\s+(?:quel(?:le)?\s+est\s+)?(?:le\s+)?(?:niveau|volume|fader|son)\b/iu.test(text) ||
        /\b(?:niveau|volume|fader|son)\s*\??\s*$/iu.test(text)
    );
}

function stripReadLanguage(text: string): string {
    return compact(
        text
            .replace(/^\s*(?:peux[-\s]+tu|pourrais[-\s]+tu|tu\s+peux)(?:\s+me)?(?:\s+dire)?\s+/iu, "")
            .replace(/^\s*(?:c['’]?est\s+quoi|combien\s+vaut|o[uù]\s+est)\s+/iu, "")
            .replace(/^\s*(?:quel(?:le)?\s+est\s+)?/iu, "")
            .replace(/^\s*(?:lis|donne(?:-|\s)+moi|donne|read|get|affiche|montre(?:-|\s)+moi)\s+/iu, "")
            .replace(/^\s*(?:quel(?:le)?\s+est\s+)?/iu, "")
            .replace(/^(?:le\s+)?(?:niveau|volume|fader|son)\s+(?:(?:de|du|de la|de l['’]?|of)\s+)?/iu, "")
            .replace(/^(?:le\s+)?(?:niveau|volume|fader|son)\s*$/iu, "")
            .replace(/\s+(?:niveau|volume|fader|son)\s*$/iu, ""),
    );
}

function splitRoute(text: string): { sourceQuery: string; destinationQuery: string } | null {
    const match = text.match(/^(.+?)\s+(?:sur|dans|vers|chez|to|in)\s+(.+)$/iu);
    if (!match?.[1] || !match[2]) return null;
    const sourceQuery = cleanTarget(match[1]);
    const destinationQuery = cleanTarget(match[2]);
    return sourceQuery && destinationQuery ? { sourceQuery, destinationQuery } : null;
}

export function parseDeterministicMixerIntent(raw: string): NativeMixerIntent | null {
    let text = compact(raw);
    if (!text) return null;

    // Domain-neutral intent selection lives here; protocol/capability enforcement
    // remains in the gateway adapter and OSC layer.
    const control = parseControlIntent(text);
    if (control) return control;

    const bulkMute = parseBulkMuteIntent(text);
    if (bulkMute) return bulkMute;

    const bulkSend = parseBulkSendIntent(text);
    if (bulkSend) return bulkSend;

    const auxOutput = parsePhysicalAuxIntent(text);
    if (auxOutput) return auxOutput;

    const original = text;
    const wantsRead = readRequested(text);

    let durationSeconds: number | undefined;
    let delaySeconds: number | undefined;
    let absolute: NativeLevelValue | undefined;
    let relative: NativeLevelValue | undefined;
    let from: NativeLevelValue | undefined;
    let to: NativeLevelValue | undefined;

    // Range must be extracted before generic relative/absolute values.
    {
        const result = take(
            text,
            /\bde\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)(?=\s|$)/iu,
        );
        text = result.text;
        if (result.match?.[1] && result.match[2] && result.match[3] && result.match[4]) {
            from = level(result.match[1], result.match[2]) || undefined;
            to = level(result.match[3], result.match[4]) || undefined;
            if (!from || !to) return null;
        }
    }

    {
        const result = take(text, /\ben\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\b/iu);
        text = result.text;
        if (result.match?.[1]) {
            const value = number(result.match[1]);
            if (value === null || value <= 0) return null;
            durationSeconds = value;
        }
    }

    {
        const result = take(text, /\bdans\s+(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes|seconds?)\b/iu);
        text = result.text;
        if (result.match?.[1]) {
            const value = number(result.match[1]);
            if (value === null || value < 0) return null;
            delaySeconds = value;
        }
    }

    // Normalized fader level form ("niveau 0.5") is deliberately narrow.
    if (!from && !to) {
        const result = take(text, /\b(?:au\s+)?(?:niveau|level)\s+(0(?:[.,]\d+)?|1(?:[.,]0+)?)\b/iu);
        text = result.text;
        if (result.match?.[1]) absolute = level(result.match[1], "level") || undefined;
    }

    if (!from && !to && !absolute) {
        const result = take(text, /(?:^|\s)(?:a|à|to|sur)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)(?=\s|$)/iu);
        text = result.text;
        if (result.match?.[1] && result.match[2]) absolute = level(result.match[1], result.match[2]) || undefined;
    }

    if (!from && !to) {
        const result = take(text, /\b(?:de|by)\s+([+-]?\d+(?:[.,]\d+)?)\s*(d[bB]|%)(?=\s|$)/iu);
        text = result.text;
        if (result.match?.[1] && result.match[2]) relative = level(result.match[1], result.match[2]) || undefined;
    }

    const fadeMatch = text.match(/\bfade[ -]?(in|out)\b/iu);
    const fadeDirection = fadeMatch?.[1] ? simplify(fadeMatch[1]) : null;
    if (fadeMatch?.[0]) text = compact(text.replace(fadeMatch[0], " "));

    // In an explicit from/to range, standalone "fade" is a structural ramp
    // keyword just like "rampe"/"ramp", never part of the target name.
    if (from && to) {
        text = compact(text.replace(/\bfade\b/giu, " "));
    }

    const progressive = /\b(?:progressivement|progressively|gradually|rampe|ramp)\b/iu.test(text) || Boolean(fadeDirection);
    text = compact(text.replace(/\b(?:progressivement|progressively|gradually|rampe|ramp)\b/giu, " "));

    let qualitativeAmount: NativeAmount = "normal";
    {
        const result = take(text, /\b(un\s+peu|beaucoup|a\s+little|a\s+lot|slightly)\b/iu);
        text = result.text;
        qualitativeAmount = amountFrom(result.match?.[1]);
    }

    let direction: NativeDirection | null = null;
    {
        const natural = text.match(/\b(plus|moins)\s+fort\b/iu);
        if (natural?.[1]) {
            direction = simplify(natural[1]) === "moins" ? "down" : "up";
            text = compact(text.replace(natural[0], " "));
        }
    }

    // Mute/unmute is an action on a named target, so extract it before
    // directional level verbs. Otherwise an STT target such as "baisse Mike"
    // (heard for "basse-mike") loses "baisse" as if it were a second action and
    // can incorrectly collapse to the unrelated exact bus "Mike".
    let mute: boolean | undefined;
    const muteOn = text.match(/(?:^|\s)(mute|coupe|couper|desactive|désactive|eteins|éteins)(?=\s|$)/iu);
    const muteOff = text.match(/(?:^|\s)(unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)(?=\s|$)/iu);
    if (muteOn?.[0]) {
        mute = true;
        text = compact(text.replace(muteOn[0], " "));
    } else if (muteOff?.[0]) {
        mute = false;
        text = compact(text.replace(muteOff[0], " "));
    }

    let setVerb = false;
    let adjustVerb = false;
    if (!direction && mute === undefined) {
        const action = text.match(/\b(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\b/iu);
        if (action?.[1]) {
            direction = directionFrom(action[1]);
            text = compact(text.replace(action[0], " "));
        }
    }

    if (/\b(?:mets|met|regle|règle|fixe|set)\b/iu.test(text)) {
        setVerb = true;
        text = compact(text.replace(/\b(?:mets|met|regle|règle|fixe|set)\b/giu, " "));
    }
    if (/\b(?:ajuste|adjust|change)\b/iu.test(text)) {
        adjustVerb = true;
        text = compact(text.replace(/\b(?:ajuste|adjust|change)\b/giu, " "));
    }

    text = compact(
        text
            .replace(/\b(?:fais|faire)\b/giu, " ")
            .replace(/\b(?:un|une)\s+(?=(?:fade|rampe|ramp)\b)/giu, " ")
            .replace(/^\s*(?:le\s+)?(?:niveau|volume|fader|son)\s+(?:(?:de|du|de la|de l['’]?|of)\s+)?/iu, "")
            .replace(/^\s*(?:le\s+)?(?:volume|niveau|fader|son)\s*$/iu, ""),
    );

    const readText = wantsRead ? stripReadLanguage(text) : text;
    const route = splitRoute(readText);
    const targetQuery = route ? "" : cleanTarget(readText) || "main";

    if (mute !== undefined) {
        if (durationSeconds !== undefined) return null;
        if (route) {
            if (delaySeconds !== undefined) return withDestinationList({ kind: "send_delay_mute", ...route, mute, delaySeconds });
            return withDestinationList({ kind: "send_mute", ...route, mute });
        }
        if (delaySeconds !== undefined) return { kind: "delay_mute", targetQuery, mute, delaySeconds };
        return { kind: "mute", targetQuery, mute };
    }

    if (wantsRead && !absolute && !relative && !from && !to && durationSeconds === undefined && delaySeconds === undefined) {
        if (route) return withDestinationList({ kind: "send_read_level", ...route });
        return { kind: "read_level", targetQuery };
    }

    if (progressive && delaySeconds !== undefined && durationSeconds === undefined && !fadeDirection) {
        // "progressivement ... dans N secondes" has a delay but no ramp duration.
        return null;
    }

    if (fadeDirection && !to && !absolute && !relative && !from) {
        to = { unit: "db", value: fadeDirection === "out" ? -120 : 0 };
        if (delaySeconds !== undefined && durationSeconds === undefined) durationSeconds = 5;
    }

    const signedRelative = relative
        ? {
              ...relative,
              value:
                  direction === "down"
                      ? -Math.abs(relative.value)
                      : direction === "up"
                        ? Math.abs(relative.value)
                        : relative.value,
          }
        : undefined;

    if (durationSeconds !== undefined) {
        if (!to && absolute) to = absolute;
        if (route) {
            if (delaySeconds !== undefined) {
                if (!to && !from && !signedRelative) return null;
                return withDestinationList({
                    kind: "send_delayed_ramp_level",
                    ...route,
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {}),
                    ...(signedRelative ? { delta: signedRelative } : {}),
                    durationSeconds,
                    delaySeconds,
                });
            }
            if (to || from || signedRelative) {
                return withDestinationList({
                    kind: "send_ramp_level",
                    ...route,
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {}),
                    ...(signedRelative ? { delta: signedRelative } : {}),
                    durationSeconds,
                });
            }
            if (direction) {
                return withDestinationList({ kind: "send_ramp_level_qualitative", ...route, direction, amount: qualitativeAmount, durationSeconds });
            }
            return null;
        }

        if (delaySeconds !== undefined) {
            if (!to && !from && !signedRelative) return null;
            return {
                kind: "delayed_ramp_level",
                targetQuery,
                ...(from ? { from } : {}),
                ...(to ? { to } : {}),
                ...(signedRelative ? { delta: signedRelative } : {}),
                durationSeconds,
                delaySeconds,
            };
        }
        if (to || from || signedRelative) {
            return {
                kind: "ramp_level",
                targetQuery,
                ...(from ? { from } : {}),
                ...(to ? { to } : {}),
                ...(signedRelative ? { delta: signedRelative } : {}),
                durationSeconds,
            };
        }
        if (direction) {
            return { kind: "ramp_level_qualitative", targetQuery, direction, amount: qualitativeAmount, durationSeconds };
        }
        return null;
    }

    if (delaySeconds !== undefined) {
        const value = absolute || to;
        if (!value) return null;
        if (route) return withDestinationList({ kind: "send_delay_level", ...route, value, delaySeconds });
        return { kind: "delay_level", targetQuery, value, delaySeconds };
    }

    if (absolute) {
        if (route) return withDestinationList({ kind: "send_set_level", ...route, unit: absolute.unit, value: absolute.value });
        return { kind: "set_level", targetQuery, unit: absolute.unit, value: absolute.value };
    }

    if (relative) {
        if (!direction && !adjustVerb && relative.value >= 0) return null;
        const delta =
            direction === "down"
                ? -Math.abs(relative.value)
                : direction === "up"
                  ? Math.abs(relative.value)
                  : relative.value;
        if (route) return withDestinationList({ kind: "send_adjust_level", ...route, unit: relative.unit, delta });
        return { kind: "adjust_level", targetQuery, unit: relative.unit, delta };
    }

    if (direction && !setVerb) {
        if (route) return withDestinationList({ kind: "send_adjust_level_qualitative", ...route, direction, amount: qualitativeAmount });
        return { kind: "adjust_level_qualitative", targetQuery, direction, amount: qualitativeAmount };
    }

    // An absolute-looking command with no extracted value must never degrade
    // into a qualitative write.
    if (/[+-]?\d+(?:[.,]\d+)?\s*(?:d[bB]|%)/u.test(original)) return null;

    return null;
}
