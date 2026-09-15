import assert from "node:assert/strict";
import { TOOLS } from "./dist/index.js";

const rampTool = TOOLS.find((tool) => tool.name === "osc_automation_ramp");
assert.ok(rampTool, "osc_automation_ramp tool must be exposed");

const properties = rampTool.inputSchema?.properties ?? {};
assert.ok(properties.fromDb, "osc_automation_ramp must expose fromDb for dB ramp start bounds");
assert.equal(properties.fromDb.type, "number");
assert.equal(properties.fromDb.minimum, -120);
assert.equal(properties.fromDb.maximum, 20);

const macroTool = TOOLS.find((tool) => tool.name === "osc_automation_macro");
assert.ok(macroTool, "osc_automation_macro tool must be exposed");

const stepProperties = macroTool.inputSchema?.properties?.steps?.items?.properties ?? {};
assert.ok(stepProperties.fromDb, "osc_automation_macro ramp steps must expose fromDb");
assert.equal(stepProperties.fromDb.type, "number");
assert.equal(stepProperties.fromDb.minimum, -120);
assert.equal(stepProperties.fromDb.maximum, 20);

console.log("automation ramp schema exposes fromDb");
