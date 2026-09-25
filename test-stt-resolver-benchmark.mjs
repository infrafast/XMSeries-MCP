#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xm-stt-bench-"));
const input = path.join(dir, "benchmark_results.json");

fs.writeFileSync(input, JSON.stringify({
  results: [
    {
      engine: "fixture",
      phrase_id: 1,
      domain: "mixer",
      take: 1,
      file: "exact.wav",
      reference: "mets guitar-anto à moins cinq dB",
      transcription: "mets guitar-anto à moins cinq dB",
      error: null
    },
    {
      engine: "fixture",
      phrase_id: 2,
      domain: "mixer",
      take: 1,
      file: "phonetic.wav",
      reference: "mets anto à moins cinq dB",
      transcription: "en taux à moins 5 dB",
      error: null
    },
    {
      engine: "fixture",
      phrase_id: 3,
      domain: "mixer",
      take: 1,
      file: "wrong.wav",
      reference: "mets anto à moins cinq dB",
      transcription: "mets claude à moins cinq dB",
      error: null
    },
    {
      engine: "fixture",
      phrase_id: 4,
      domain: "mixer",
      take: 1,
      file: "qualified-route.wav",
      reference: "mets guitar-anto sur le retour Claude à moins douze dB",
      transcription: "mets guitare en taux sur le retour Claude à moins 12 dB",
      error: null
    },
    {
      engine: "fixture",
      phrase_id: 5,
      domain: "qlc",
      take: 1,
      file: "qlc.wav",
      reference: "qlc rouge",
      transcription: "QLC rouge.",
      error: null
    }
  ]
}, null, 2));

const run = spawnSync(
  process.execPath,
  ["scripts/stt_resolver_benchmark.mjs", "--input", input, "--output-dir", dir],
  { cwd: process.cwd(), encoding: "utf8" }
);

assert.equal(run.status, 0, run.stdout + "\n" + run.stderr);

const result = JSON.parse(
  fs.readFileSync(path.join(dir, "resolver_benchmark_results.json"), "utf8")
);
const xr16 = result.results.filter((row) => row.registry === "xr16");

const exact = xr16.find((row) => row.file === "exact.wav");
assert.equal(exact.full_command_correct, true);
assert.equal(exact.wrong_accepted, 0);

const phonetic = xr16.find((row) => row.file === "phonetic.wav");
assert.equal(phonetic.full_command_correct, true);
assert.equal(phonetic.phonetic_recoveries, 1);
assert.equal(phonetic.resolved_slots[0].method, "phonetic");
assert.equal(phonetic.wrong_accepted, 0);

const wrong = xr16.find((row) => row.file === "wrong.wav");
assert.equal(wrong.full_command_correct, false);
assert.equal(wrong.wrong_accepted, 1);

const qualifiedRoute = xr16.find((row) => row.file === "qualified-route.wav");
assert.equal(qualifiedRoute.full_command_correct, true);
assert.equal(qualifiedRoute.wrong_accepted, 0);
assert.equal(qualifiedRoute.resolved_slots.find((slot) => slot.role === "destination")?.resolved, "bus:claude");

const qlc = xr16.find((row) => row.file === "qlc.wav");
assert.equal(qlc.skipped, true);

console.log("STT resolver benchmark scorer tests passed.");
