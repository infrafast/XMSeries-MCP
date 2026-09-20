/**
 * Lightweight deterministic French natural-language normalization for Local mode.
 *
 * This module intentionally does not try to understand arbitrary French. It maps
 * a bounded set of stage-control lexical variants to the canonical verbs already
 * understood by the Local grammar. Structural parsing, target resolution and
 * fail-closed authorization remain in local-gateway.ts.
 */

function simplifyForMatch(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("fr-FR")
        .replace(/[’']/g, " ")
        .replace(/[^a-z0-9+.,%\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const SAFE_CANONICAL_VERBS: Array<[RegExp, string]> = [
    [/\b(?:couper|desactive|désactive|eteins|éteins)\b/giu, "mute"],
    [/\b(?:demute|démute|reactive|réactive|rallume)\b/giu, "unmute"],
    [/\b(?:augmente)\b/giu, "monte"],
    [/\b(?:diminue|descends|descend)\b/giu, "baisse"],
    [/\b(?:regle|règle|fixe|met)\b/giu, "mets"],
];

const FRENCH_NUMBER_UNITS: Record<string, number> = {
    zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4,
    cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
    dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14,
    quinze: 15, seize: 16,
};

const FRENCH_NUMBER_TENS: Record<string, number> = {
    vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};

function parseFrenchIntegerWords(raw: string): number | null {
    const normalized = simplifyForMatch(raw)
        .replace(/-/gu, " ")
        .replace(/\bet\b/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
    if (!normalized) return null;
    const tokens = normalized.split(" ");

    if (tokens.length === 1 && FRENCH_NUMBER_UNITS[tokens[0]] !== undefined) {
        return FRENCH_NUMBER_UNITS[tokens[0]];
    }

    if (tokens[0] === "dix" && tokens.length === 2 && FRENCH_NUMBER_UNITS[tokens[1]] !== undefined) {
        const unit = FRENCH_NUMBER_UNITS[tokens[1]];
        return unit >= 7 && unit <= 9 ? 10 + unit : null;
    }

    if (tokens[0] === "quatre" && tokens[1] === "vingt") {
        if (tokens.length === 2) return 80;
        if (tokens[2] === "dix") {
            if (tokens.length === 3) return 90;
            const tail = parseFrenchIntegerWords(tokens.slice(2).join(" "));
            return tail !== null && tail >= 10 && tail <= 19 ? 80 + tail : null;
        }
        const unit = FRENCH_NUMBER_UNITS[tokens[2]];
        return tokens.length === 3 && unit >= 1 && unit <= 9 ? 80 + unit : null;
    }

    const tens = FRENCH_NUMBER_TENS[tokens[0]];
    if (tens !== undefined) {
        if (tokens.length === 1) return tens;
        if (tokens[0] === "soixante") {
            const tail = parseFrenchIntegerWords(tokens.slice(1).join(" "));
            if (tail !== null && tail >= 10 && tail <= 19) return 60 + tail;
        }
        const unit = FRENCH_NUMBER_UNITS[tokens[1]];
        return tokens.length === 2 && unit >= 1 && unit <= 9 ? tens + unit : null;
    }

    return null;
}

function normalizeSpokenFrenchLevels(raw: string): string {
    let text = raw.replace(/\b(?:d[ée]cibels?|decibels?|ddb)\b/giu, "dB");

    text = text.replace(
        /\b(moins|plus)\s+((?:[\p{L}-]+\s*){1,5})\s+dB\b/giu,
        (full, signRaw: string, wordsRaw: string) => {
            const value = parseFrenchIntegerWords(wordsRaw);
            if (value === null) return full;
            const sign = simplifyForMatch(signRaw) === "moins" ? "-" : "+";
            return sign + value + " dB";
        },
    );

    return text;
}

function normalizeLikelyFrenchSttSetVerb(raw: string): string {
    // Whisper can transcribe imperative "mets" as discourse "mais". Only repair
    // it when the rest of the utterance already has an explicit mixer-route
    // structure and an absolute numeric level, so ordinary "mais ..." speech is
    // never promoted to a write.
    if (
        /^\s*mais[,;:]?\s+/iu.test(raw) &&
        /\s+(?:sur|vers|dans|chez|to|in)\s+.+?\s+(?:a|à|to)\s+[+-]?\d+(?:[.,]\d+)?\s*(?:d[bB]|%)\b/iu.test(raw)
    ) {
        return raw.replace(/^\s*mais[,;:]?\s+/iu, "mets ");
    }
    return raw;
}
function remetsMeansSet(text: string): boolean {
    return (
        /\bremets?\b[\s\S]*?(?:\ba|à|au\s+niveau|\bniveau)\s*[+-]?\d/iu.test(text) ||
        /\bremets?\b[\s\S]*?\b(?:d[bB]|%)\b/iu.test(text)
    );
}

export function canonicalizeNaturalFrenchCommand(raw: string): string {
    let text = raw.trim();
    if (!text) return text;

    text = normalizeSpokenFrenchLevels(text);
    text = normalizeLikelyFrenchSttSetVerb(text);

    // "remets" is deliberately contextual: without a value it means reactivate;
    // with an explicit level it means set the level again.
    if (/\bremets?\b/iu.test(text)) {
        text = text.replace(/\bremets?\b/giu, remetsMeansSet(text) ? "mets" : "unmute");
    }

    for (const [pattern, replacement] of SAFE_CANONICAL_VERBS) {
        text = text.replace(pattern, replacement);
    }

    // Common mute/unmute paraphrases that are structurally unambiguous.
    text = text
        .replace(/^\s*met(?:s)?\s+en\s+sourdine\s+/iu, "mute ")
        .replace(/^\s*retire\s+(?:le\s+)?mute\s+(?:de\s+|du\s+|de la\s+)?/iu, "unmute ")
        .replace(/^\s*enleve\s+(?:le\s+)?mute\s+(?:de\s+|du\s+|de la\s+)?/iu, "unmute ");

    return text.replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "").trim();
}

export function isMixerStatusUtterance(raw: string): boolean {
    let text = simplifyForMatch(raw)
        .replace(/-/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^(?:stp|s il te plait|s il vous plait)\s+/u, "")
        .replace(/^(?:peux tu|pourrais tu|tu peux)(?: me)?(?: dire)?\s+/u, "");

    text = text.replace(/\bstatus\b/gu, "statut");

    if (
        /^(?:(?:quel est|quelle est|donne moi|affiche|montre moi)\s+)?(?:le\s+|la\s+|l\s+)?(?:statut|etat|version|firmware|modele)(?:\s+actuel)?\s+(?:du|de)\s+(?:mixeur|mixer)$/u.test(text)
    ) {
        return true;
    }

    if (
        /^(?:statut|etat)\s+(?:du\s+)?(?:mixeur|mixer)$/u.test(text)
    ) {
        return true;
    }

    if (
        /^(?:est ce que\s+)?(?:le\s+)?(?:mixeur|mixer)\s+(?:est\s+)?(?:connecte|en ligne|online|operationnel|operationnellement pret)$/u.test(text)
    ) {
        return true;
    }

    if (
        /^(?:le\s+)?(?:mixeur|mixer)\s+est il\s+(?:connecte|en ligne|online|operationnel)$/u.test(text)
    ) {
        return true;
    }

    if (/^(?:quel|quelle)\s+(?:mixeur|mixer)\s+est\s+(?:connecte|en ligne)$/u.test(text)) {
        return true;
    }

    return /^(?:comment va|comment se porte)\s+(?:le\s+)?(?:mixeur|mixer)$/u.test(text);
}


export function isMainLevelReadUtterance(raw: string): boolean {
    let text = simplifyForMatch(raw)
        .replace(/-/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^(?:stp|s il te plait|s il vous plait)\s+/u, "")
        .replace(/^(?:peux tu|pourrais tu|tu peux)(?: me)?(?: dire)?\s+/u, "");

    return (
        /^(?:quel est|quelle est|donne moi|affiche|montre moi)\s+(?:le\s+)?(?:niveau|volume|fader|son)(?:\s+(?:general|principal|master))?$/u.test(text) ||
        /^(?:c est quoi|combien vaut|ou est)\s+(?:le\s+)?(?:niveau|volume|fader|son)(?:\s+(?:general|principal|master))?$/u.test(text)
    );
}


export function isAutomationStatusUtterance(raw: string): boolean {
    let text = simplifyForMatch(raw)
        .replace(/-/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^(?:stp|s il te plait|s il vous plait)\s+/u, "")
        .replace(/^(?:peux tu|pourrais tu|tu peux)(?: me)?(?: dire|montrer|donner)?\s+/u, "");

    return (
        /^(?:quelles?\s+sont\s+)?(?:les\s+)?(?:automations|automatisations|fades|rampes)(?:\s+(?:en cours|actives))?$/u.test(text) ||
        /^(?:liste|affiche|montre moi|donne moi)\s+(?:les\s+)?(?:automations|automatisations)(?:\s+(?:en cours|actives))?$/u.test(text) ||
        /^(?:quel est|quelle est)\s+(?:le\s+|la\s+)?(?:statut|etat)\s+(?:des\s+)?(?:automations|automatisations)$/u.test(text)
    );
}
