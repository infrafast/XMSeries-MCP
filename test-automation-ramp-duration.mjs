import assert from "node:assert/strict";
import { AutomationEngine } from "./dist/automation.js";

const engine = new AutomationEngine();

assert.throws(
  () => engine.start("instant ramp must be rejected", [
    {
      type: "ramp",
      description: "instant level change",
      to: 0.5,
      durationSeconds: 0,
      read: async () => 0.4,
      write: async () => {},
    },
  ]),
  /durationSeconds > 0.*immediate fader\/send tool/i,
);

console.log("PASS: zero-duration ramp automation is rejected synchronously");
