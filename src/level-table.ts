export interface FaderLevelPoint {
    index: number;
    level: number;
    db: number | null;
}

export interface DbToFaderResult {
    requestedDb: number | null;
    level: number;
    db: number | null;
    index: number;
    clipped: boolean;
}

export interface FaderToDbResult {
    requestedLevel: number;
    level: number;
    db: number | null;
    index: number;
    clipped: boolean;
}

function roundHalfAwayFromZero(value: number, digits: number): number {
    const factor = 10 ** digits;
    const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * X32/M32 "Appendix - Level Table - 161 pseudo-log scale Level values".
 * The first entry is -inf; remaining entries cover -87 dB through +10 dB.
 */
export const FADER_LEVEL_TABLE: FaderLevelPoint[] = Array.from({ length: 161 }, (_, index) => {
    const level = index / 160;
    let db: number | null;

    if (index === 0) {
        db = null;
    } else if (index <= 10) {
        db = -90 + index * 3;
    } else if (index <= 40) {
        db = -70 + index;
    } else if (index <= 80) {
        db = -30 + (index - 40) * 0.5;
    } else {
        db = roundHalfAwayFromZero(-10 + (index - 80) * 0.25, 1);
    }

    return { index, level, db };
});

export function dbToFaderLevel(db: number): DbToFaderResult {
    if (!Number.isFinite(db)) {
        return { requestedDb: null, ...FADER_LEVEL_TABLE[0], clipped: false };
    }

    const finitePoints = FADER_LEVEL_TABLE.filter((point) => point.db !== null);
    const minPoint = finitePoints[0];
    const maxPoint = finitePoints[finitePoints.length - 1];

    if (db < minPoint.db!) {
        return { requestedDb: db, ...FADER_LEVEL_TABLE[0], clipped: true };
    }
    if (db > maxPoint.db!) {
        return { requestedDb: db, ...maxPoint, clipped: true };
    }

    let best = finitePoints[0];
    for (const point of finitePoints) {
        const currentDiff = Math.abs(point.db! - db);
        const bestDiff = Math.abs(best.db! - db);
        if (currentDiff < bestDiff || (currentDiff === bestDiff && point.db! > best.db!)) {
            best = point;
        }
    }

    return { requestedDb: db, ...best, clipped: false };
}

export function faderLevelToDb(level: number): FaderToDbResult {
    const clippedLevel = Math.min(1, Math.max(0, level));
    const index = Math.round(clippedLevel * 160);
    const point = FADER_LEVEL_TABLE[index];
    return {
        requestedLevel: level,
        ...point,
        clipped: clippedLevel !== level,
    };
}

export function formatDb(db: number | null): string {
    return db === null ? "-inf dB" : `${db > 0 ? "+" : ""}${db.toFixed(db % 1 === 0 ? 0 : 2)} dB`;
}
