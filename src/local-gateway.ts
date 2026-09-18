import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
    GATEWAY_PROTOCOL,
    TokenStore,
    type AnalyzeCommandResult,
    type ExecuteCommandResult,
} from "@infrafast/stage-command-core";
import { dbToFaderLevel, faderLevelToDb, formatDb } from "./level-table.js";

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

export interface LocalMixerGatewayAdapter {
    resolve(query: string): Promise<LocalMixerTarget[]>;
    status(): Promise<any>;
    readLevel(target: LocalMixerTarget): Promise<number>;
    writeLevel(target: LocalMixerTarget, level: number): Promise<void>;
    setMute(target: LocalMixerTarget, mute: boolean): Promise<void>;
}

type Intent =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string }
    | { kind: "set_level"; targetQuery: string; db: number }
    | { kind: "adjust_level"; targetQuery: string; deltaDb: number }
    | { kind: "mute"; targetQuery: string; mute: boolean };

type LocalPlan =
    | { kind: "status" }
    | { kind: "read_level"; targetQuery: string; target: LocalMixerTarget }
    | { kind: "set_level"; targetQuery: string; target: LocalMixerTarget; db: number }
    | { kind: "adjust_level"; targetQuery: string; target: LocalMixerTarget; deltaDb: number }
    | { kind: "mute"; targetQuery: string; target: LocalMixerTarget; mute: boolean };

interface LocalContinuation {
    intent: Exclude<Intent, { kind: "status" }>;
    candidates: LocalMixerTarget[];
}

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

function parseIntent(raw: string): Intent | null {
    const text = raw.trim();
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
                deltaDb,
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
                deltaDb,
            };
        }
    }

    const qualitativeRelative = text.match(
        /^\s*(monte|augmente|raise|increase|baisse|diminue|lower|decrease)\s+(?:(un\s+peu|beaucoup|a\s+lot|slightly)\s+)?(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s*$/iu,
    );
    if (qualitativeRelative?.[1] && qualitativeRelative[3]) {
        const verb = simplify(qualitativeRelative[1]);
        const amount = simplify(qualitativeRelative[2] || "");
        const magnitude =
            amount === "un peu" || amount === "slightly"
                ? 1
                : amount === "beaucoup" || amount === "a lot"
                  ? 6
                  : 3;
        const down = ["baisse", "diminue", "lower", "decrease"].includes(verb);
        return {
            kind: "adjust_level",
            targetQuery: cleanTarget(qualitativeRelative[3]),
            deltaDb: down ? -magnitude : magnitude,
        };
    }

    const setPatterns = [
        /^\s*(?:mets|met|regle|règle|fixe|set)\s+(?:le\s+)?(?:niveau|volume|fader)?\s*(?:de\s+|du\s+|de la\s+|of\s+)?(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB]\s*$/iu,
        /^\s*(.+?)\s+(?:a|à|to)\s+([+-]?\d+(?:[.,]\d+)?)\s*d[bB]\s*$/iu,
    ];
    for (const re of setPatterns) {
        const match = text.match(re);
        if (match?.[1] && match[2]) {
            const db = parseDb(match[2]);
            const targetQuery = cleanTarget(match[1]);
            if (db !== null && targetQuery) {
                return { kind: "set_level", targetQuery, db };
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

        const intent = parseIntent(input.text);
        if (!intent) {
            return {
                protocol: GATEWAY_PROTOCOL,
                recognized: false,
                status: "unrecognized",
                effect: "none",
            };
        }

        if (intent.kind === "status") {
            const stored = this.store.createPlan({ kind: "status" }, "read");
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

            const liveTarget = await this.revalidateTarget(plan.targetQuery, plan.target, true);

            if (plan.kind === "set_level") {
                const converted = dbToFaderLevel(plan.db);
                await this.adapter.writeLevel(liveTarget, converted.level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} réglé à ${formatDb(converted.db)}${converted.clipped ? " (limité à la plage du fader)" : ""}.`,
                };
            }

            if (plan.kind === "adjust_level") {
                const before = faderLevelToDb(await this.adapter.readLevel(liveTarget));
                const requested = before.db + plan.deltaDb;
                const converted = dbToFaderLevel(requested);
                await this.adapter.writeLevel(liveTarget, converted.level);
                return {
                    protocol: GATEWAY_PROTOCOL,
                    ok: true,
                    responseText: `${displayName(liveTarget)} : ${formatDb(before.db)} → ${formatDb(converted.db)}.`,
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

    private async planTargetIntent(
        intent: Exclude<Intent, { kind: "status" }>,
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
        intent: Exclude<Intent, { kind: "status" }>,
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
        const plan: LocalPlan =
            intent.kind === "read_level"
                ? { ...intent, target }
                : intent.kind === "set_level"
                  ? { ...intent, target }
                  : intent.kind === "adjust_level"
                    ? { ...intent, target }
                    : { ...intent, target };

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

        const main = mainTarget(reply);
        if (main) return this.readyTargetPlan(continuation.value.intent, main);

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

        if (continuation.value.candidates.length > 0) {
            const wasSuggested = continuation.value.candidates.some((candidate) =>
                sameIdentity(candidate, resolved),
            );
            if (!wasSuggested && continuation.value.candidates.some((candidate) => candidate.matchType !== "fuzzy")) {
                return {
                    protocol: GATEWAY_PROTOCOL,
                    recognized: false,
                    status: "unrecognized",
                    effect: "none",
                    responseText: "La réponse ne correspond pas à une des cibles proposées.",
                };
            }
        }

        return this.readyTargetPlan(continuation.value.intent, resolved);
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
