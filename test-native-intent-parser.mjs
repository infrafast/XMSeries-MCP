import assert from "node:assert/strict";
import { parseDeterministicMixerIntent } from "./dist/local-intent-parser.js";
import { canonicalizeNaturalFrenchCommand } from "./dist/local-language.js";

const cases = [
  ["baisse progressivement en 2 secondes Batterie à -30 dB", {
    kind: "ramp_level", targetQuery: "Batterie", to: { unit: "db", value: -30 }, durationSeconds: 2
  }],
  ["Batterie à -30 dB baisse progressivement en 2 secondes", {
    kind: "ramp_level", targetQuery: "Batterie", to: { unit: "db", value: -30 }, durationSeconds: 2
  }],
  ["progressivement monte Batterie sur Anthony en 3 secondes à -10 dB", {
    kind: "send_ramp_level", sourceQuery: "Batterie", destinationQuery: "Anthony",
    to: { unit: "db", value: -10 }, durationSeconds: 3
  }],
  ["mets à -27 dB Batterie dans 2 secondes", {
    kind: "delay_level", targetQuery: "Batterie", value: { unit: "db", value: -27 }, delaySeconds: 2
  }],
  ["dans 3 secondes rallume Batterie", {
    kind: "delay_mute", targetQuery: "Batterie", mute: false, delaySeconds: 3
  }],
  ["baisse un peu progressivement Batterie en 2 secondes", {
    kind: "ramp_level_qualitative", targetQuery: "Batterie", direction: "down", amount: "little", durationSeconds: 2
  }],
  ["mets la guitare de anto sur claude à -5db", {
    kind: "send_set_level", sourceQuery: "guitare de anto", destinationQuery: "claude", unit: "db", value: -5
  }],
  ["monte Voix de 10%", {
    kind: "adjust_level", targetQuery: "Voix", unit: "percent", delta: 10
  }],
  ["mets Voix à 50%", {
    kind: "set_level", targetQuery: "Voix", unit: "percent", value: 50
  }],
  ["Batterie moins fort", {
    kind: "adjust_level_qualitative", targetQuery: "Batterie", direction: "down", amount: "normal"
  }],
  ["éteins Voix", {
    kind: "mute", targetQuery: "Voix", mute: true
  }],
  ["rallume Voix", {
    kind: "mute", targetQuery: "Voix", mute: false
  }],
  ["éteins Batterie sur Anthony", {
    kind: "send_mute", sourceQuery: "Batterie", destinationQuery: "Anthony", mute: true
  }],
  ["monte le son", {
    kind: "adjust_level_qualitative", targetQuery: "main", direction: "up", amount: "normal"
  }],
  ["baisse le volume", {
    kind: "adjust_level_qualitative", targetQuery: "main", direction: "down", amount: "normal"
  }],
  ["où est le fader", {
    kind: "read_level", targetQuery: "main"
  }],
  ["où est le fader de Batterie", {
    kind: "read_level", targetQuery: "Batterie"
  }],
  ["donne-moi le volume", {
    kind: "read_level", targetQuery: "main"
  }],
  ["c'est quoi le volume", {
    kind: "read_level", targetQuery: "main"
  }],
  ["peux-tu me dire quel est le niveau", {
    kind: "read_level", targetQuery: "main"
  }],
  ["fade out en 5 secondes", {
    kind: "ramp_level", targetQuery: "main", to: { unit: "db", value: -120 }, durationSeconds: 5
  }],
  ["dans 5 secondes fais un fade out de Voix", {
    kind: "delayed_ramp_level", targetQuery: "Voix", to: { unit: "db", value: -120 },
    durationSeconds: 5, delaySeconds: 5
  }],
  ["en 4 secondes fais une rampe Batterie de -40 dB à -10 dB", {
    kind: "ramp_level", targetQuery: "Batterie", from: { unit: "db", value: -40 },
    to: { unit: "db", value: -10 }, durationSeconds: 4
  }],
  ["fade Batterie de -40 dB à -10 dB en 5 secondes", {
    kind: "ramp_level", targetQuery: "Batterie", from: { unit: "db", value: -40 },
    to: { unit: "db", value: -10 }, durationSeconds: 5
  }],
  ["statut du mixeur", { kind: "status" }],
  ["quelles sont les automations en cours ?", { kind: "automation_list" }],
  ["annule la dernière automation", { kind: "automation_cancel", lastRunning: true }],
  ["annule l'automation auto-3", { kind: "automation_cancel", id: "auto-3", lastRunning: false }],
  ["quel est le nom de la voie 6 ?", { kind: "read_channel_name", channel: 6 }],
  ["état du mute de Batterie", { kind: "read_mute", targetQuery: "Batterie" }],
  ["Hall FX est-il actif ?", { kind: "read_effect_on", targetQuery: "Hall FX" }],
  ["active l'effet Hall FX", { kind: "set_effect_on", targetQuery: "Hall FX", on: true }],
  ["désactive l'effet Hall FX", { kind: "set_effect_on", targetQuery: "Hall FX", on: false }],
  ["mute les bus Anthony et Laurent", {
    kind: "bulk_bus_mute", mode: "selected", busQueries: ["Anthony", "Laurent"], mute: true
  }],
  ["coupe tous les bus sauf Anthony", {
    kind: "bulk_bus_mute", mode: "all_except", busQueries: ["Anthony"], mute: true
  }],
  ["mute les voies Voix et Batterie", {
    kind: "bulk_channel_mute", mode: "selected", channelQueries: ["Voix", "Batterie"], mute: true
  }],
  ["unmute Anthony et Laurent", {
    kind: "bulk_named_mute", targetQueries: ["Anthony", "Laurent"],
    rawQuery: "Anthony et Laurent", mute: false
  }],
  ["mute Batterie et Anthony", {
    kind: "bulk_named_mute", targetQueries: ["Batterie", "Anthony"],
    rawQuery: "Batterie et Anthony", mute: true
  }],
  ["mets Batterie à -20 dB sur Anthony et Laurent", {
    kind: "multi_send",
    intent: {
      kind: "send_set_level", sourceQuery: "Batterie",
      destinationQuery: "Anthony et Laurent", unit: "db", value: -20
    },
    destinationQueries: ["Anthony", "Laurent"],
    rawDestinationQuery: "Anthony et Laurent"
  }],
  ["mute Batterie sur Anthony et Laurent", {
    kind: "multi_send",
    intent: {
      kind: "send_mute", sourceQuery: "Batterie",
      destinationQuery: "Anthony et Laurent", mute: true
    },
    destinationQueries: ["Anthony", "Laurent"],
    rawDestinationQuery: "Anthony et Laurent"
  }],
  ["monte Batterie sur Anthony et Laurent de 3 dB", {
    kind: "multi_send",
    intent: {
      kind: "send_adjust_level", sourceQuery: "Batterie",
      destinationQuery: "Anthony et Laurent", unit: "db", delta: 3
    },
    destinationQueries: ["Anthony", "Laurent"],
    rawDestinationQuery: "Anthony et Laurent"
  }],
  ["baisse progressivement Batterie sur Anthony et Laurent à -30 dB en 2 secondes", {
    kind: "multi_send",
    intent: {
      kind: "send_ramp_level", sourceQuery: "Batterie",
      destinationQuery: "Anthony et Laurent", to: { unit: "db", value: -30 }, durationSeconds: 2
    },
    destinationQueries: ["Anthony", "Laurent"],
    rawDestinationQuery: "Anthony et Laurent"
  }],
  ["niveau de Batterie sur Anthony et Laurent", {
    kind: "multi_send",
    intent: {
      kind: "send_read_level", sourceQuery: "Batterie",
      destinationQuery: "Anthony et Laurent"
    },
    destinationQueries: ["Anthony", "Laurent"],
    rawDestinationQuery: "Anthony et Laurent"
  }],
  ["mets Batterie à -20 dB sur les bus Anthony et Laurent", {
    kind: "bulk_send_db", mode: "selected", sourceQuery: "Batterie",
    busQueries: ["Anthony", "Laurent"], db: -20, includeMain: false
  }],
  ["mets Batterie à -25 dB sur tous les bus et façade", {
    kind: "bulk_send_db", mode: "all", sourceQuery: "Batterie",
    busQueries: [], db: -25, includeMain: true
  }],
  ["set Voix to aux output 3 to -12 dB", {
    kind: "send_to_aux_output", sourceQuery: "Voix", aux: 3, unit: "db", value: -12
  }],
  ["mets Batterie sur sortie aux 2 au niveau 0.5", {
    kind: "send_to_aux_output", sourceQuery: "Batterie", aux: 2, unit: "level", value: 0.5
  }],
];

for (const [utterance, expected] of cases) {
  assert.deepEqual(parseDeterministicMixerIntent(utterance), expected, utterance);
}

assert.equal(parseDeterministicMixerIntent("Batterie -20 dB"), null);
assert.deepEqual(parseDeterministicMixerIntent("active Hall FX"), { kind: "mute", targetQuery: "Hall FX", mute: false }, "historical FX-return unmute shorthand must stay compatible");

assert.deepEqual(
  parseDeterministicMixerIntent(canonicalizeNaturalFrenchCommand("Mais guitar Claude à moins cinq dB.")),
  { kind: "set_level", targetQuery: "guitar Claude", unit: "db", value: -5 },
  "bounded STT 'mais' repair must not leak the repaired action into targetQuery",
);
assert.deepEqual(
  parseDeterministicMixerIntent(canonicalizeNaturalFrenchCommand("de mute, baisse, Mike.")),
  { kind: "mute", targetQuery: "baisse Mike", mute: false },
  "mute parsing must preserve a target token that sounds like a direction verb",
);

console.log("native deterministic intent parser tests: OK");
