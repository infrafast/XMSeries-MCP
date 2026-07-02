#!/usr/bin/env node

import assert from "node:assert/strict";
import {
    TOOLS,
    hasSafeUniqueTarget,
    isStructuredOwnershipMatch,
    normalizeOwnershipMixerName,
} from "./dist/index.js";

const routeResolver = TOOLS.find((tool) => tool.name === "osc_resolve_channel_to_bus");
assert.ok(routeResolver, "osc_resolve_channel_to_bus must be exposed");
assert.deepEqual(routeResolver.inputSchema.required, ["source", "destination"]);
assert.equal(hasSafeUniqueTarget([{ matchType: "exact" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "contains" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "structured" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "fuzzy" }]), false);
assert.equal(hasSafeUniqueTarget([]), false);
assert.equal(hasSafeUniqueTarget([{ matchType: "exact" }, { matchType: "exact" }]), false);

const normalizationCases = [
    ["la guitare de Claude", "guitare claude"],
    ["guitare d'Anto", "guitare anto"],
    ["la basse à Mike", "basse mike"],
    ["saxophone de Luc", "saxophone luc"],
];

for (const [input, expected] of normalizationCases) {
    assert.equal(normalizeOwnershipMixerName(input), expected, input);
}

const matchingCases = [
    ["la guitare de Claude", "guitar-clode"],
    ["guitare de Laurent", "guitar-loran"],
    ["guitare d'Anto", "guitar-anto"],
    ["basse de Mike", "basse-mike"],
    ["saxophone de Luc", "saxophone-luc"],
];

for (const [query, candidate] of matchingCases) {
    assert.equal(isStructuredOwnershipMatch(query, candidate), true, `${query} -> ${candidate}`);
}

assert.equal(isStructuredOwnershipMatch("guitare de Claude", "guitar-loran"), false);
assert.equal(isStructuredOwnershipMatch("guitare de Claude", "basse-clode"), false);
assert.equal(isStructuredOwnershipMatch("saxophone de Luc", "saxophone-paul"), false);

console.log("Structured ownership name-resolution tests passed.");
