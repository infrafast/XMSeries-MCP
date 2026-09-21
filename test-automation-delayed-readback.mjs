import assert from "node:assert/strict";
import { verifyAutomationReadback } from "./dist/automation.js";

{
  const reads = [0.25, 0.2874, 0.375];
  let count = 0;
  const actual = await verifyAutomationReadback(
    async () => {
      count += 1;
      return reads.shift() ?? 0.375;
    },
    0.375,
    {
      description: "Local delayed level batterie",
      attempts: 5,
      retryDelayMs: 0,
      tolerance: 0.002,
    },
  );
  assert.equal(actual, 0.375);
  assert.equal(count, 3);
}

{
  await assert.rejects(
    () => verifyAutomationReadback(
      async () => 0.25,
      0.375,
      {
        description: "Local delayed level batterie",
        attempts: 3,
        retryDelayMs: 0,
        tolerance: 0.002,
      },
    ),
    /Delayed level verification failed.*expected 0\.375.*read 0\.25/i,
  );
}

console.log("delayed automation readback retry tests passed");
