import assert from "node:assert/strict";
import { getOscToolSummaries } from "./dist/index.js";

const tools = new Map(getOscToolSummaries().map((tool) => [tool.name, tool]));
for (const name of [
  "osc_fx_return_fader",
  "osc_get_effect_on",
  "osc_set_effect_on",
]) {
  assert.ok(tools.has(name), `missing typed MCP tool: ${name}`);
}

assert.match(tools.get("osc_fx_return_fader").description, /FX return fader/i);
console.log("typed/Local FX capability symmetry checks passed");
