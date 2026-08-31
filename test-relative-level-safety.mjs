import assert from "node:assert/strict";
import { computeRelativeLevelAdjustment } from "./dist/index.js";
import { dbToFaderLevel } from "./dist/level-table.js";
import { coerceOscArg } from "./dist/osc-client.js";

function at(db) { return dbToFaderLevel(db).level; }

{
  const r = computeRelativeLevelAdjustment(at(-35), { deltaDb: 1, maxDb: -25 });
  assert.equal(r.beforeDb, -35);
  assert.equal(r.targetDb, -34);
  assert.equal(r.effectiveDeltaDb, 1);
  assert.equal(r.clamped, false);
}

{
  const r = computeRelativeLevelAdjustment(at(-26), { deltaDb: 3, maxDb: -25 });
  assert.equal(r.targetDb, -25);
  assert.equal(r.effectiveDeltaDb, 1);
  assert.equal(r.clamped, true);
}

{
  const r = computeRelativeLevelAdjustment(at(-20), { deltaDb: 1, maxDb: -25 });
  assert.equal(r.targetDb, -20);
  assert.equal(r.effectiveDeltaDb, 0);
  assert.equal(r.noOp, true);
}

{
  const r = computeRelativeLevelAdjustment(at(-35), { deltaDb: -1, minDb: -50 });
  assert.equal(r.targetDb, -36);
  assert.equal(r.effectiveDeltaDb, -1);
}

{
  const r = computeRelativeLevelAdjustment(at(-10), { direction: "down", amount: "normal", minDb: null, maxDb: null });
  assert.ok(r.targetDb < r.beforeDb);
  assert.equal(r.minDb, undefined);
  assert.equal(r.maxDb, undefined);
}

assert.throws(() => computeRelativeLevelAdjustment(0, { deltaDb: 1 }), /-inf/);

console.log("relative level safety checks passed");

{
  const zeroAsFloat = coerceOscArg(0, "float");
  assert.equal(typeof zeroAsFloat, "number");
  assert.notEqual(zeroAsFloat, 0);
  assert.ok(Math.abs(zeroAsFloat) < 0.000001);
}
