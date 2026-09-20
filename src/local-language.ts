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

function remetsMeansSet(text: string): boolean {
    return (
        /\bremets?\b[\s\S]*?(?:\ba|à|au\s+niveau|\bniveau)\s*[+-]?\d/iu.test(text) ||
        /\bremets?\b[\s\S]*?\b(?:d[bB]|%)\b/iu.test(text)
    );
}

export function canonicalizeNaturalFrenchCommand(raw: string): string {
    let text = raw.trim();
    if (!text) return text;

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

    return text.replace(/\s+/gu, " ").trim();
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
        /^(?:c est quoi|combien vaut)\s+(?:le\s+)?(?:niveau|volume|fader|son)(?:\s+(?:general|principal|master))?$/u.test(text)
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
