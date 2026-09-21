import assert from "node:assert/strict";
import { parseDeterministicMixerIntent } from "./dist/local-intent-parser.js";

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
];

for (const [utterance, expected] of cases) {
  assert.deepEqual(parseDeterministicMixerIntent(utterance), expected, utterance);
}

assert.equal(parseDeterministicMixerIntent("mute les bus Anthony et Laurent"), null);
assert.equal(parseDeterministicMixerIntent("mets Batterie à -20 dB sur les bus Anthony et Laurent"), null);
assert.equal(parseDeterministicMixerIntent("set Voix to aux output 3 to -12 dB"), null);

console.log("native deterministic intent parser tests: OK");
