#!/usr/bin/env node

import assert from "node:assert/strict";
import {
    TOOLS,
    frenchPhoneticMixerKey,
    hasSafeUniqueTarget,
    isStructuredOwnershipMatch,
    normalizeOwnershipMixerName,
    rankNamedTargetCandidates,
} from "./dist/index.js";

const routeResolver = TOOLS.find((tool) => tool.name === "osc_resolve_channel_to_bus");
assert.ok(routeResolver, "osc_resolve_channel_to_bus must be exposed");
assert.deepEqual(routeResolver.inputSchema.required, ["source", "destination"]);
assert.equal(hasSafeUniqueTarget([{ matchType: "exact" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "contains" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "structured" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "phonetic" }]), true);
assert.equal(hasSafeUniqueTarget([{ matchType: "fuzzy" }]), false);
assert.equal(hasSafeUniqueTarget([]), false);
assert.equal(hasSafeUniqueTarget([{ matchType: "exact" }, { matchType: "exact" }]), false);

const duplicateExact = rankNamedTargetCandidates("Lead", [
    { family: "channel", index: 1, name: "Lead" },
    { family: "fxreturn", index: 2, name: "Lead" },
]);
assert.equal(duplicateExact.length, 2);
assert.deepEqual(duplicateExact.map((entry) => entry.matchType), ["exact", "exact"]);
assert.equal(hasSafeUniqueTarget(duplicateExact), false);


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

const phoneticEquivalences = [
    ["Anto", "en taux"],
    ["Anto", "ento"],
    ["Mika", "Mica"],
    ["Mika", "Micka"],
    ["Mike", "mic"],
    ["basse-mike", "baisse mic"],
    ["Laurent", "l'orant"],
    ["guitar-anto", "guitare de ento"],
    ["guitar-anto", "guitare à en taux"],
];

for (const [canonical, heard] of phoneticEquivalences) {
    assert.equal(
        frenchPhoneticMixerKey(canonical),
        frenchPhoneticMixerKey(heard),
        `${heard} should sound like ${canonical}`,
    );
}

const antoPhonetic = rankNamedTargetCandidates("en taux", [
    { family: "bus", index: 1, name: "ANTO" },
    { family: "bus", index: 2, name: "CLAUDE" },
]);
assert.equal(antoPhonetic.length, 1);
assert.equal(antoPhonetic[0].name, "ANTO");
assert.equal(antoPhonetic[0].matchType, "phonetic");
assert.equal(hasSafeUniqueTarget(antoPhonetic), true);

for (const heard of ["Mica", "Micka"]) {
    const mikaPhonetic = rankNamedTargetCandidates(heard, [
        { family: "bus", index: 1, name: "MIKA" },
        { family: "bus", index: 2, name: "CLAUDE" },
    ]);
    assert.equal(mikaPhonetic.length, 1, heard);
    assert.equal(mikaPhonetic[0].name, "MIKA", heard);
    assert.equal(mikaPhonetic[0].matchType, "phonetic", heard);
}

const ambiguousPhonetic = rankNamedTargetCandidates("en taux", [
    { family: "bus", index: 1, name: "ANTO" },
    { family: "channel", index: 2, name: "ENTO" },
]);
assert.equal(ambiguousPhonetic.length, 2);
assert.deepEqual(ambiguousPhonetic.map((entry) => entry.matchType), ["phonetic", "phonetic"]);
assert.equal(hasSafeUniqueTarget(ambiguousPhonetic), false);

const typedExactKeepsExactPriority = rankNamedTargetCandidates("guitar Laurent", [
    { family: "channel", index: 1, name: "guitar-loran" },
    { family: "channel", index: 2, name: "guitar-laurent" },
]);
assert.equal(typedExactKeepsExactPriority.length, 1);
assert.equal(typedExactKeepsExactPriority[0].name, "guitar-laurent");
assert.equal(typedExactKeepsExactPriority[0].matchType, "exact");

const guardedExactCollision = rankNamedTargetCandidates(
    "guitar Laurent",
    [
        { family: "channel", index: 1, name: "guitar-loran" },
        { family: "channel", index: 2, name: "guitar-laurent" },
    ],
    { guardPhoneticExactCollisions: true },
);
assert.equal(guardedExactCollision.length, 2);
assert.deepEqual(guardedExactCollision.map((entry) => entry.matchType), ["exact", "phonetic"]);
assert.equal(hasSafeUniqueTarget(guardedExactCollision), false);

console.log("Structured and phonetic name-resolution tests passed.");
