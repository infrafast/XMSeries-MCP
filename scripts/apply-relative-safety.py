from pathlib import Path

p = Path('src/index.ts')
s = p.read_text()

marker = 'interface RelativeLevelAdjustmentInput {'
if marker not in s:
    anchor = '''function formatLevelRead(label: string, level: number, unit: LevelToolUnit): string {
    if (unit === "db") {
        return `${label} is ${formatLevelWithDb(level)}`;
    }

    const converted = faderLevelToDb(level);
    if (unit === "percent") {
        return `${label} is at ${(level * 100).toFixed(1)}% (${formatDb(converted.db)})`;
    }

    return `${label} is at level ${level.toFixed(4)} (${formatDb(converted.db)})`;
}
'''
    addition = anchor + '''

type RelativeLevelDirection = "up" | "down";
type RelativeLevelAmount = "little" | "normal" | "much";

interface RelativeLevelAdjustmentInput {
    target: AutomationTargetSpec;
    deltaDb?: number;
    direction?: RelativeLevelDirection;
    amount?: RelativeLevelAmount;
    minDb?: number;
    maxDb?: number;
}

interface RelativeLevelAdjustmentResult {
    beforeDb: number;
    requestedDb: number;
    targetDb: number;
    requestedDeltaDb: number;
    effectiveDeltaDb: number;
    minDb?: number;
    maxDb?: number;
    clamped: boolean;
    noOp: boolean;
    targetLevel: number;
}

function relativePercent(amount: RelativeLevelAmount, currentDb: number): number | null {
    if (currentDb < -40) {
        if (amount === "little") return 15;
        if (amount === "much") return 30;
        return 20;
    }
    if (currentDb < -10) {
        if (amount === "little") return 10;
        if (amount === "much") return 15;
        return 15;
    }
    return null;
}

function relativeDbStep(amount: RelativeLevelAmount): number {
    if (amount === "little") return 1;
    if (amount === "much") return 5;
    return 2;
}

export function computeRelativeLevelAdjustment(
    currentLevel: number,
    input: Omit<RelativeLevelAdjustmentInput, "target">
): RelativeLevelAdjustmentResult {
    const before = faderLevelToDb(currentLevel);
    const beforeDb = before.db;
    const hasDelta = typeof input.deltaDb === "number" && Number.isFinite(input.deltaDb);
    const hasDirection = input.direction === "up" || input.direction === "down";

    if (hasDelta === hasDirection) {
        throw new Error("Relative level adjustment requires exactly one of deltaDb or direction.");
    }
    if (input.minDb !== undefined && !Number.isFinite(input.minDb)) throw new Error("minDb must be numeric.");
    if (input.maxDb !== undefined && !Number.isFinite(input.maxDb)) throw new Error("maxDb must be numeric.");
    if (input.minDb !== undefined && input.maxDb !== undefined && input.minDb > input.maxDb) {
        throw new Error("minDb cannot be greater than maxDb.");
    }

    let requestedLevel: number;
    if (hasDelta) {
        requestedLevel = dbToFaderLevel(beforeDb + input.deltaDb!).level;
    } else {
        const amount = input.amount ?? "normal";
        const sign = input.direction === "up" ? 1 : -1;
        const percent = relativePercent(amount, beforeDb);
        if (percent !== null) {
            requestedLevel = currentLevel * (1 + sign * percent / 100);
            requestedLevel = Math.min(0.8, Math.max(0, requestedLevel));
        } else {
            requestedLevel = dbToFaderLevel(beforeDb + sign * relativeDbStep(amount)).level;
        }
    }

    const requested = faderLevelToDb(requestedLevel);
    const requestedDb = requested.db;
    const requestedDeltaDb = requestedDb - beforeDb;
    let targetDb = requestedDb;
    let clamped = false;

    if (input.maxDb !== undefined && targetDb > input.maxDb) {
        targetDb = input.maxDb;
        clamped = true;
    }
    if (input.minDb !== undefined && targetDb < input.minDb) {
        targetDb = input.minDb;
        clamped = true;
    }

    let target = dbToFaderLevel(targetDb);
    let effectiveDeltaDb = target.db - beforeDb;
    const requestedDirection = Math.sign(requestedDeltaDb);
    const effectiveDirection = Math.sign(effectiveDeltaDb);
    const toleranceDb = 0.51;

    if (
        requestedDirection !== 0 &&
        (effectiveDirection !== 0 && effectiveDirection !== requestedDirection ||
            Math.abs(effectiveDeltaDb) > Math.abs(requestedDeltaDb) + toleranceDb)
    ) {
        target = before;
        targetDb = beforeDb;
        effectiveDeltaDb = 0;
        clamped = true;
    }

    return {
        beforeDb,
        requestedDb,
        targetDb: target.db,
        requestedDeltaDb,
        effectiveDeltaDb: target.db - beforeDb,
        minDb: input.minDb,
        maxDb: input.maxDb,
        clamped,
        noOp: target.level === before.level,
        targetLevel: target.level,
    };
}

async function applyRelativeLevelAdjustment(input: RelativeLevelAdjustmentInput): Promise<string> {
    const adapter = targetAdapter(input.target);
    const beforeLevel = await adapter.read();
    const computed = computeRelativeLevelAdjustment(beforeLevel, input);

    if (!computed.noOp) {
        await osc.assertMixerOnline();
        await adapter.write(computed.targetLevel);
    }

    const verifiedLevel = await adapter.read();
    const verified = faderLevelToDb(verifiedLevel);
    if (Math.abs(verifiedLevel - computed.targetLevel) > 0.002) {
        throw new Error(
            `Relative level verification failed for ${adapter.label}: expected ${computed.targetLevel.toFixed(6)} (${formatDb(computed.targetDb)}), ` +
            `read ${verifiedLevel.toFixed(6)} (${formatDb(verified.db)}).`
        );
    }

    return JSON.stringify({
        target: adapter.label,
        beforeDb: computed.beforeDb,
        requestedDeltaDb: computed.requestedDeltaDb,
        requestedDb: computed.requestedDb,
        minDb: computed.minDb ?? null,
        maxDb: computed.maxDb ?? null,
        clamped: computed.clamped,
        noOp: computed.noOp,
        targetDb: computed.targetDb,
        verifiedDb: verified.db,
        effectiveDeltaDb: verified.db - computed.beforeDb,
    });
}
'''
    if anchor not in s:
        raise SystemExit('formatLevelRead anchor not found')
    s = s.replace(anchor, addition, 1)

tool_anchor = '''    // ========== Channel Controls ==========
    {
        name: "osc_channel_fader",'''
if 'name: "osc_adjust_level"' not in s:
    tool = '''    {
        name: "osc_adjust_level",
        description: "Atomically adjust a mixer fader/send relative to its live value. MUST be used for relative requests such as '+1 dB', 'monte', 'baisse', 'un peu', 'beaucoup', including limits such as 'sans dépasser -25 dB'. The MCP reads the live value, computes the change, applies minDb/maxDb only as bounds, rejects any bound that would reverse or amplify the requested movement, writes, then verifies by reading back. Use deltaDb for an explicit signed dB delta; otherwise use direction plus optional amount (little/normal/much).",
        inputSchema: {
            type: "object",
            properties: {
                target: {
                    type: "object",
                    properties: {
                        kind: { type: "string", enum: ["channel_fader", "channel_send", "bus_fader", "main_fader", "fx_return_fader", "fx_send", "aux_fader", "aux_send"] },
                        channel: { type: "number" },
                        bus: { type: "number" },
                        effect: { type: "number" },
                        aux: { type: "number" }
                    },
                    required: ["kind"]
                },
                deltaDb: { type: "number", description: "Explicit signed dB delta. Example +1 dB => 1, -3 dB => -3. Do not provide direction when deltaDb is used.", minimum: -40, maximum: 40 },
                direction: { type: "string", enum: ["up", "down"], description: "Direction for qualitative relative commands when deltaDb is absent." },
                amount: { type: "string", enum: ["little", "normal", "much"], description: "Qualitative amount. Defaults to normal when direction is used." },
                minDb: { type: "number", description: "Optional lower bound/floor in dB. It may only reduce the requested movement, never amplify or reverse it.", minimum: -120, maximum: 20 },
                maxDb: { type: "number", description: "Optional upper bound/ceiling in dB, e.g. 'sans dépasser -25 dB' => -25. It may only reduce the requested movement, never amplify or reverse it.", minimum: -120, maximum: 20 }
            },
            required: ["target"]
        }
    },
    // ========== Channel Controls ==========
    {
        name: "osc_channel_fader",'''
    if tool_anchor not in s:
        raise SystemExit('tool anchor not found')
    s = s.replace(tool_anchor, tool, 1)

handler_anchor = '''            // ========== Channel Controls ==========
            case "osc_channel_fader": {'''
if 'case "osc_adjust_level":' not in s:
    handler = '''            case "osc_adjust_level": {
                const input = args as unknown as RelativeLevelAdjustmentInput;
                return { content: [{ type: "text", text: await applyRelativeLevelAdjustment(input) }] };
            }

            // ========== Channel Controls ==========
            case "osc_channel_fader": {'''
    if handler_anchor not in s:
        raise SystemExit('handler anchor not found')
    s = s.replace(handler_anchor, handler, 1)

p.write_text(s)

pp = Path('PROMPT.md')
prompt = pp.read_text()
old = '''Relative level:

* direction-only commands with no explicit final value: `monte`, `baisse`, `augmente`, `diminue`, `plus fort`, `moins fort`
* delta commands: `monte de 3 dB`, `baisse de 3 dB`, `+3 dB`, `-3 dB`
* resolve target
* read current value first
* calculate new value from the current value and the requested direction/delta
* write updated value
* for direction-only `baisse` / `diminue` / `moins fort`, the final value must be lower than the current value; for example, from -5 dB the default result is -7 dB, never -3 dB
* for direction-only `monte` / `augmente` / `plus fort`, the final value must be higher than the current value; for example, from -5 dB the default result is -3 dB, never -7 dB

Default relative amount:

* `un peu`: 15% below -40 dB, 10% from -40 to -10 dB, 1 dB above -10 dB
* `beaucoup`: 30% below -40 dB, 15% from -40 to -10 dB, 5 dB above -10 dB
* unspecified: 20% below -40 dB, 15% from -40 to -10 dB, 2 dB above -10 dB

Clamp final normalized values to `0.0..0.8`.
'''
new = '''Relative level:

* direction-only commands with no explicit final value: `monte`, `baisse`, `augmente`, `diminue`, `plus fort`, `moins fort`
* delta commands: `monte de 3 dB`, `baisse de 3 dB`, `+3 dB`, `-3 dB`
* resolve the target, then ALWAYS use `osc_adjust_level`; never implement a relative request as `get` + LLM arithmetic + `set`
* explicit signed dB deltas use `deltaDb`, for example `+1 dB` -> `deltaDb:1` and `baisse de 3 dB` -> `deltaDb:-3`
* direction-only requests use `direction:"up"|"down"` and `amount:"little"|"normal"|"much"`; omit `amount` for the normal/default amount
* limits are bounds, not destinations: `sans dépasser -25 dB`, `au maximum -25 dB`, `pas plus de -25 dB` -> `maxDb:-25`; a lower limit/floor such as `pas en dessous de -60 dB` -> `minDb:-60`
* NEVER replace a requested delta with its limit. Example: current -35 dB, `+1 dB sans dépasser -25 dB` must produce -34 dB, NOT -25 dB
* the MCP reads the live level, calculates the relative result, applies the bound only if the requested result crosses it, rejects any bound application that would reverse/amplify the requested change, writes, and verifies the result

Default relative amount (implemented by `osc_adjust_level` from the live level):

* `un peu`: 15% below -40 dB, 10% from -40 to -10 dB, 1 dB above -10 dB
* `beaucoup`: 30% below -40 dB, 15% from -40 to -10 dB, 5 dB above -10 dB
* unspecified/normal: 20% below -40 dB, 15% from -40 to -10 dB, 2 dB above -10 dB

Relative operations clamp normalized values to `0.0..0.8`.
'''
if old not in prompt:
    raise SystemExit('PROMPT relative-level block not found')
pp.write_text(prompt.replace(old, new, 1))

Path('test-relative-level-safety.mjs').write_text('''import assert from "node:assert/strict";\nimport { computeRelativeLevelAdjustment } from "./dist/index.js";\nimport { dbToFaderLevel } from "./dist/level-table.js";\n\nfunction at(db) { return dbToFaderLevel(db).level; }\n\n{\n  const r = computeRelativeLevelAdjustment(at(-35), { deltaDb: 1, maxDb: -25 });\n  assert.equal(r.beforeDb, -35);\n  assert.equal(r.targetDb, -34);\n  assert.equal(r.effectiveDeltaDb, 1);\n  assert.equal(r.clamped, false);\n}\n\n{\n  const r = computeRelativeLevelAdjustment(at(-26), { deltaDb: 3, maxDb: -25 });\n  assert.equal(r.targetDb, -25);\n  assert.equal(r.effectiveDeltaDb, 1);\n  assert.equal(r.clamped, true);\n}\n\n{\n  const r = computeRelativeLevelAdjustment(at(-20), { deltaDb: 1, maxDb: -25 });\n  assert.equal(r.targetDb, -20);\n  assert.equal(r.effectiveDeltaDb, 0);\n  assert.equal(r.noOp, true);\n}\n\n{\n  const r = computeRelativeLevelAdjustment(at(-35), { deltaDb: -1, minDb: -50 });\n  assert.equal(r.targetDb, -36);\n  assert.equal(r.effectiveDeltaDb, -1);\n}\n\nconsole.log("relative level safety checks passed");\n''')
