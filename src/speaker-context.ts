export interface SpeakerMixerMapping {
    bus?: string;
    channel?: string;
    enabled?: boolean;
}

export interface SpeakerMixerContext {
    speaker: string;
    known: boolean;
    monitorDestination: { kind: "bus"; name: string } | { kind: "main" } | null;
    busName: string | null;
    channelName: string | null;
    source: string;
}

export function parseSpeakerMap(raw: string): Record<string, SpeakerMixerMapping> {
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

export function speakerMapFromRaw(raw: string): Record<string, SpeakerMixerMapping> {
    if (!raw.trim()) return {};
    return parseSpeakerMap(raw);
}

export function resolveSpeakerMixerContext(
    speaker: string,
    mappings: Record<string, SpeakerMixerMapping>,
): SpeakerMixerContext {
    const normalized = String(speaker || "unknown").trim().toLowerCase();
    const mapping = mappings[normalized];
    const enabled = mapping?.enabled !== false;
    const known = Boolean(
        normalized &&
        normalized !== "unknown" &&
        mapping &&
        enabled
    );
    const explicitBus = known ? String(mapping?.bus || "").trim() : "";
    const monitorDestination = !known
        ? null
        : explicitBus
          ? { kind: "bus" as const, name: explicitBus }
          : { kind: "main" as const };

    return {
        speaker: normalized || "unknown",
        known,
        monitorDestination,
        busName: monitorDestination?.kind === "bus" ? monitorDestination.name : null,
        channelName: known ? (mapping?.channel || null) : null,
        source: mapping ? "XMS_SPEAKER_MAP" : "unmapped-speaker",
    };
}
