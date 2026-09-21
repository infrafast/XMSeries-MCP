import assert from "node:assert/strict";
import fs from "node:fs";

const gateway = fs.readFileSync("src/local-gateway.ts", "utf8");
const parser = fs.readFileSync("src/local-intent-parser.ts", "utf8");

const parseStart = gateway.indexOf("function parseIntent");
const parseEnd = gateway.indexOf("\nfunction sameIdentity", parseStart);
assert.ok(parseStart >= 0 && parseEnd > parseStart, "parseIntent block must exist");
const parseIntent = gateway.slice(parseStart, parseEnd);

assert.match(parseIntent, /parseSequenceIntent\(text\)/);
assert.match(parseIntent, /parseDeterministicMixerIntent\(text\)/);

for (const retired of [
  "bulkAllChannelMute",
  "bulkSelectedChannelMute",
  "bulkAllBusMute",
  "bulkSelectedBusMute",
  "bulkSendAll",
  "bulkSendSelected",
  "channelToAuxOutput",
  "channelToAuxNormalized",
  "isMixerStatusUtterance",
  "isAutomationStatusUtterance",
  "isMainLevelReadUtterance",
]) {
  assert.ok(!parseIntent.includes(retired), `retired specialized parser path reintroduced: ${retired}`);
}

for (const kind of [
  '"status"',
  '"automation_list"',
  '"automation_cancel"',
  '"read_channel_name"',
  '"read_mute"',
  '"read_effect_on"',
  '"set_effect_on"',
  '"send_to_aux_output"',
  '"bulk_channel_mute"',
  '"bulk_bus_mute"',
  '"bulk_send_db"',
  '"multi_send"',
]) {
  assert.ok(parser.includes(`kind: ${kind}`), `native parser missing consolidated intent ${kind}`);
}

console.log("native parser architecture guard passed");
