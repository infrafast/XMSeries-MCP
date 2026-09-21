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

export type NativeMixerIntent =
    | { kind: "read_level"; targetQuery: string }
    | { kind: "set_level"; targetQuery: string; unit: NativeLevelUnit; value: number }
    | { kind: "adjust_level"; targetQuery: string; unit: NativeLevelUnit; delta: number }
    | { kind: "adjust_level_qualitative"; targetQuery: string; direction: NativeDirection; amount: NativeAmount }
    | { kind: "send_read_level"; sourceQuery: string; destinationQuery: string }
    | { kind: "send_set_level"; sourceQuery: string; destinationQuery: string; unit: NativeLevelUnit; value: number }
    | { kind: "send_adjust_level"; sourceQuery: string; destinationQuery: string; unit: NativeLevelUnit; delta: number }
    | { kind: "send_adjust_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: NativeDirection; amount: NativeAmount }
    | { kind: "mute"; targetQuery: string; mute: boolean }
    | { kind: "send_mute"; sourceQuery: string; destinationQuery: string; mute: boolean }
    | { kind: "delay_level"; targetQuery: string; value: NativeLevelValue; delaySeconds: number }
    | { kind: "send_delay_level"; sourceQuery: string; destinationQuery: string; value: NativeLevelValue; delaySeconds: number }
    | { kind: "delay_mute"; targetQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "send_delay_mute"; sourceQuery: string; destinationQuery: string; mute: boolean; delaySeconds: number }
    | { kind: "ramp_level"; targetQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number }
    | { kind: "send_ramp_level"; sourceQuery: string; destinationQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number }
    | { kind: "delayed_ramp_level"; targetQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "send_delayed_ramp_level"; sourceQuery: string; destinationQuery: string; to?: NativeLevelValue; from?: NativeLevelValue; delta?: NativeLevelValue; durationSeconds: number; delaySeconds: number }
    | { kind: "ramp_level_qualitative"; targetQuery: string; direction: NativeDirection; amount: NativeAmount; durationSeconds: number }
    | { kind: "send_ramp_level_qualitative"; sourceQuery: string; destinationQuery: string; direction: NativeDirection; amount: NativeAmount; durationSeconds: number };

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

function isBulkLike(text: string): boolean {
    return (
        /\b(?:tous|toutes|all)\s+(?:les\s+)?(?:bus|voies|tranches|canaux|channels)\b/iu.test(text) ||
        /^\s*(?:mute|coupe|couper|desactive|désactive|eteins|éteins|unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\s+(?:les\s+)?(?:bus|voies|tranches|canaux|channels)\b/iu.test(text) ||
        /\bsur\s+(?:les\s+)?bus\b/iu.test(text)
    );
}

function readRequested(text: string): boolean {
    // A trailing level noun is a read cue only when no explicit write verb is present.
    // This prevents "monte le son" / "baisse le volume" from degrading into reads.
    if (/\b(?:monte|augmente|raise|increase|baisse|diminue|lower|decrease|mets|met|regle|règle|fixe|set|mute|coupe|unmute|rallume|reactive|réactive)\b/iu.test(text)) {
        return false;
    }
    return (
        /^\s*(?:quel(?:le)?\s+est\s+)?(?:le\s+)?(?:niveau|volume|fader|son)\b/iu.test(text) ||
        /^\s*(?:lis|donne|read|get|affiche|montre(?:-|\s)+moi)\b/iu.test(text) ||
        /^\s*o[uù]\s+est\s+(?:le\s+)?(?:niveau|volume|fader|son)\b/iu.test(text) ||
        /\b(?:niveau|volume|fader|son)\s*\??\s*$/iu.test(text)
    );
}

function stripReadLanguage(text: string): string {
    return compact(
        text
            .replace(/^\s*(?:quel(?:le)?\s+est\s+)?/iu, "")
            .replace(/^\s*(?:lis|donne|read|get|affiche|montre(?:-|\s)+moi)\s+/iu, "")
            .replace(/^\s*o[uù]\s+est\s+/iu, "")
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
    if (!text || isBulkLike(text)) return null;
    // Channel -> physical AUX output is a dedicated mixer capability with
    // protocol-specific guards; keep it on the existing specialized parser path.
    if (/\b(?:sortie\s+aux|aux\s+output)\s+\d+\b/iu.test(text)) return null;

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

    let setVerb = false;
    let adjustVerb = false;
    if (!direction) {
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

    let mute: boolean | undefined;
    const muteOn = text.match(/\b(?:mute|coupe|couper|desactive|désactive|eteins|éteins)\b/iu);
    const muteOff = text.match(/\b(?:unmute|demute|démute|reactive|réactive|active|rallume|ouvre|remet|remets)\b/iu);
    if (muteOn?.[0]) {
        mute = true;
        text = compact(text.replace(muteOn[0], " "));
    } else if (muteOff?.[0]) {
        mute = false;
        text = compact(text.replace(muteOff[0], " "));
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
            if (delaySeconds !== undefined) return { kind: "send_delay_mute", ...route, mute, delaySeconds };
            return { kind: "send_mute", ...route, mute };
        }
        if (delaySeconds !== undefined) return { kind: "delay_mute", targetQuery, mute, delaySeconds };
        return { kind: "mute", targetQuery, mute };
    }

    if (wantsRead && !absolute && !relative && !from && !to && durationSeconds === undefined && delaySeconds === undefined) {
        if (route) return { kind: "send_read_level", ...route };
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
                return {
                    kind: "send_delayed_ramp_level",
                    ...route,
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {}),
                    ...(signedRelative ? { delta: signedRelative } : {}),
                    durationSeconds,
                    delaySeconds,
                };
            }
            if (to || from || signedRelative) {
                return {
                    kind: "send_ramp_level",
                    ...route,
                    ...(from ? { from } : {}),
                    ...(to ? { to } : {}),
                    ...(signedRelative ? { delta: signedRelative } : {}),
                    durationSeconds,
                };
            }
            if (direction) {
                return { kind: "send_ramp_level_qualitative", ...route, direction, amount: qualitativeAmount, durationSeconds };
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
        if (route) return { kind: "send_delay_level", ...route, value, delaySeconds };
        return { kind: "delay_level", targetQuery, value, delaySeconds };
    }

    if (absolute) {
        if (route) return { kind: "send_set_level", ...route, unit: absolute.unit, value: absolute.value };
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
        if (route) return { kind: "send_adjust_level", ...route, unit: relative.unit, delta };
        return { kind: "adjust_level", targetQuery, unit: relative.unit, delta };
    }

    if (direction && !setVerb) {
        if (route) return { kind: "send_adjust_level_qualitative", ...route, direction, amount: qualitativeAmount };
        return { kind: "adjust_level_qualitative", targetQuery, direction, amount: qualitativeAmount };
    }

    // An absolute-looking command with no extracted value must never degrade
    // into a qualitative write.
    if (/[+-]?\d+(?:[.,]\d+)?\s*(?:d[bB]|%)/u.test(original)) return null;

    return null;
}
