#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalizeNaturalFrenchCommand } from "../dist/local-language.js";
import { parseDeterministicMixerIntent } from "../dist/local-intent-parser.js";
import { rankNamedTargetCandidates } from "../dist/index.js";

const CHANNELS = [
  "vocal-clode", "vocal-anto", "cowbell", "guitar-clode", "guitar-loran", "basse-mike",
  "guitar-anto", "flute", "CLIC", "strings", "noname", "reserved", "batterie", "retour-tom",
  "inconnu", "Assistant"
];
const BUSES = ["anto", "laurent", "mike", "claude"];
const EXTRA_CHANNELS = [
  "vocal-laurent", "vocal-mike", "vocal-lead", "vocal-guest", "guitar-mike",
  "guitar-laurent", "guitar-anton", "guitar-acoustic", "guitar-clean", "bass-di",
  "bass-amp", "kick", "snare", "hihat", "tom-1", "tom-2", "floor-tom", "overhead-l",
  "overhead-r", "percussion"
];
const EXTRA_BUSES = [
  "monitor-a", "monitor-b", "drums", "vocals", "inear-anto", "inear-laurent", "sidefill", "click"
];
const EXTRA_FX = ["fx-reverb", "fx-delay", "fx-chorus", "fx-flanger"];
const EXTRA_AUX = ["playback-l", "playback-r", "usb", "talkback"];
const EXTRA_DCA = ["band", "vocals-dca", "drums-dca", "instruments"];

const SEND_SOURCE_FAMILIES = ["channel", "fxreturn", "aux"];
const ALL_FAMILIES = ["channel", "bus", "fxreturn", "aux", "dca", "matrix"];
const QUERY_KEYS = new Set([
  "targetQuery", "sourceQuery", "destinationQuery", "destinationQueries",
  "rawDestinationQuery", "targetQueries", "rawQuery", "channelQueries", "busQueries"
]);

function parseArgs(argv) {
  const result = { input: "", outputDir: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") result.input = argv[++i] || "";
    else if (argv[i] === "--output-dir") result.outputDir = argv[++i] || "";
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("node scripts/stt_resolver_benchmark.mjs --input benchmark_results.json --output-dir DIR");
      process.exit(0);
    } else {
      throw new Error("Argument inconnu: " + argv[i]);
    }
  }
  if (!result.input) throw new Error("--input est requis");
  return result;
}

function family(name, names, start = 1) {
  return names.map((value, index) => ({ family: name, index: start + index, name: value }));
}

function registry(stress) {
  const items = [...family("channel", CHANNELS), ...family("bus", BUSES)];
  if (stress) {
    items.push(
      ...family("channel", EXTRA_CHANNELS, CHANNELS.length + 1),
      ...family("bus", EXTRA_BUSES, BUSES.length + 1),
      ...family("fxreturn", EXTRA_FX),
      ...family("aux", EXTRA_AUX),
      ...family("dca", EXTRA_DCA)
    );
  }
  return items;
}

const REGISTRIES = {
  xr16: registry(false),
  stress60: registry(true),
};

function parser(text) {
  return parseDeterministicMixerIntent(canonicalizeNaturalFrenchCommand(String(text || "")));
}

function slots(intent) {
  if (!intent) return [];
  if (intent.kind === "multi_send") {
    const output = [{
      role: "source",
      query: intent.intent?.sourceQuery || intent.sourceQuery,
      families: SEND_SOURCE_FAMILIES,
    }];
    for (let i = 0; i < (intent.destinationQueries || []).length; i += 1) {
      output.push({
        role: "destination:" + i,
        query: intent.destinationQueries[i],
        families: ["bus"],
      });
    }
    return output.filter((item) => item.query);
  }

  if (typeof intent.sourceQuery === "string" && typeof intent.destinationQuery === "string") {
    return [
      {
        role: "source",
        query: intent.sourceQuery,
        families: SEND_SOURCE_FAMILIES,
      },
      {
        role: "destination",
        query: intent.destinationQuery,
        families: String(intent.kind).startsWith("send_") ? ["bus"] : ALL_FAMILIES,
      },
    ];
  }

  if (typeof intent.targetQuery === "string") {
    return [{ role: "target", query: intent.targetQuery, families: ALL_FAMILIES }];
  }
  if (typeof intent.sourceQuery === "string") {
    return [{ role: "source", query: intent.sourceQuery, families: SEND_SOURCE_FAMILIES }];
  }
  return [];
}

function scoped(reg, families) {
  return families ? reg.filter((item) => families.includes(item.family)) : reg;
}

function cleanTarget(value) {
  return String(value || "")
    .replace(/^\s*(?:le|la|les|de|du|de la|de l|d|the)\s+/iu, "")
    .replace(/\s*(?:fader|niveau|volume|son)\s*$/iu, "")
    .trim();
}

function qualifiedTargetQuery(rawQuery, allowedFamilies) {
  const query = cleanTarget(rawQuery);
  const qualifiers = [
    { pattern: /^(?:channel|channels|voie|voies|canal|canaux|tranche|tranches|source)\s+(.+)$/iu, family: "channel" },
    { pattern: /^(?:retour\s+fx|fx(?:\s+return)?|effet|effets|effect|effects)\s+(.+)$/iu, family: "fxreturn" },
    { pattern: /^(?:aux\s+return|aux|auxiliaire|auxiliaires)\s+(.+)$/iu, family: "aux" },
    { pattern: /^(?:bus|retour|retours|monitor|moniteur|moniteurs)\s+(.+)$/iu, family: "bus" },
    { pattern: /^(?:dca)\s+(.+)$/iu, family: "dca" },
    { pattern: /^(?:matrix|matrice|matrices)\s+(.+)$/iu, family: "matrix" },
  ];

  for (const { pattern, family } of qualifiers) {
    const match = query.match(pattern);
    if (!match?.[1]) continue;
    const families = allowedFamilies
      ? allowedFamilies.filter((candidate) => candidate === family)
      : [family];
    return { query: cleanTarget(match[1]), families };
  }

  return { query, families: allowedFamilies };
}

function safeUnique(matches) {
  return matches.length === 1 && matches[0].matchType !== "fuzzy" ? matches[0] : null;
}

function resolve(query, reg, families, guardPhoneticExactCollisions = true) {
  const originalQuery = cleanTarget(query);
  const qualified = qualifiedTargetQuery(query, families);
  if (qualified.families && qualified.families.length === 0) {
    return { accepted: null, matches: [] };
  }

  // Mirror LocalMixerCommandGateway.resolveOneNamedTarget(): if a query starts
  // with an explicit family qualifier ("retour Claude", "bus Anto", ...), first
  // preserve the possibility that the complete phrase is a real label, then
  // resolve the qualifier-stripped query inside the qualified family.
  if (qualified.query !== originalQuery) {
    const fullMatches = rankNamedTargetCandidates(
      originalQuery,
      scoped(reg, qualified.families),
      { guardPhoneticExactCollisions },
    );
    const full = safeUnique(fullMatches);
    if (full && full.matchType !== "fuzzy") {
      return { accepted: full, matches: fullMatches };
    }
  }

  const matches = rankNamedTargetCandidates(
    qualified.query,
    scoped(reg, qualified.families),
    { guardPhoneticExactCollisions },
  );
  return { accepted: safeUnique(matches), matches };
}

function targetId(value) {
  return value ? value.family + ":" + value.name.toLowerCase() : null;
}

function core(value) {
  if (Array.isArray(value)) return value.map(core);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (!QUERY_KEYS.has(key)) output[key] = core(child);
  }
  return output;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameCore(left, right) {
  return JSON.stringify(stable(core(left))) === JSON.stringify(stable(core(right)));
}

function score(sample, registryName) {
  if (sample.domain !== "mixer") {
    return {
      engine: sample.engine,
      registry: registryName,
      file: sample.file,
      phrase_id: sample.phrase_id,
      take: sample.take,
      domain: sample.domain,
      skipped: true,
      skip_reason: "non-mixer corpus item",
      reference: sample.reference,
      transcription: sample.transcription,
      wrong_accepted: 0,
      full_command_correct: null,
    };
  }

  const reg = REGISTRIES[registryName];
  const reference = parser(sample.reference);
  const actual = parser(sample.transcription);
  if (!reference) throw new Error("Référence non parsable: " + sample.reference);

  const expectedSlots = slots(reference).map((slot) => {
    const resolved = resolve(slot.query, reg, slot.families, false);
    if (!resolved.accepted) {
      throw new Error("Référence non résolue: " + slot.query + " / " + sample.reference);
    }
    return { ...slot, expected: resolved.accepted };
  });

  const actualByRole = new Map(slots(actual).map((slot) => [slot.role, slot]));
  let allResolved = true;
  let allCorrect = true;
  let wrongTarget = false;
  let phoneticRecoveries = 0;
  const detail = [];

  for (const expected of expectedSlots) {
    const actualSlot = actualByRole.get(expected.role);
    if (!actualSlot) {
      allResolved = false;
      allCorrect = false;
      detail.push({
        role: expected.role,
        query: null,
        expected: targetId(expected.expected),
        resolved: null,
        method: "slot_missing",
        correct: false,
      });
      continue;
    }

    const resolved = resolve(actualSlot.query, reg, expected.families);
    const correct = targetId(resolved.accepted) === targetId(expected.expected);
    if (!resolved.accepted) allResolved = false;
    if (!correct) allCorrect = false;
    if (resolved.accepted && !correct) wrongTarget = true;
    if (correct && resolved.accepted?.matchType === "phonetic") phoneticRecoveries += 1;

    detail.push({
      role: expected.role,
      query: actualSlot.query,
      expected: targetId(expected.expected),
      resolved: targetId(resolved.accepted),
      method: resolved.accepted?.matchType || (resolved.matches.length ? "unresolved" : "none"),
      candidates: resolved.matches.slice(0, 6).map((item) => ({
        target: targetId(item),
        method: item.matchType,
      })),
      correct,
    });
  }

  const parserRecognized = Boolean(actual);
  const coreCorrect = parserRecognized && sameCore(reference, actual);
  const fullCorrect = coreCorrect && allCorrect;

  // Safety proxy: this transcript is considered potentially executable-wrong
  // only when the parser recognizes it and every expected entity slot resolves
  // safely, yet the resulting command semantics or target identity is wrong.
  // Refused/unresolved commands are failures, but not wrong accepted writes.
  const wrongAccepted = parserRecognized && allResolved && !fullCorrect ? 1 : 0;

  return {
    engine: sample.engine,
    registry: registryName,
    file: sample.file,
    phrase_id: sample.phrase_id,
    take: sample.take,
    domain: sample.domain,
    skipped: false,
    reference: sample.reference,
    transcription: sample.transcription,
    parser_recognized: parserRecognized,
    expected_kind: reference.kind,
    parsed_kind: actual?.kind || null,
    core_correct: coreCorrect,
    entities_expected: expectedSlots.length,
    entities_all_resolved: allResolved,
    entities_all_correct: allCorrect,
    wrong_target: wrongTarget,
    phonetic_recoveries: phoneticRecoveries,
    wrong_accepted: wrongAccepted,
    full_command_correct: fullCorrect,
    resolved_slots: detail,
  };
}

function percentage(rows, predicate) {
  return rows.length ? 100 * rows.filter(predicate).length / rows.length : 0;
}

function summary(rows) {
  const mixer = rows.filter((row) => !row.skipped);
  return {
    samples: mixer.length,
    parser_percent: Number(percentage(mixer, (row) => row.parser_recognized).toFixed(2)),
    core_percent: Number(percentage(mixer, (row) => row.core_correct).toFixed(2)),
    resolved_percent: Number(percentage(mixer, (row) => row.entities_all_resolved).toFixed(2)),
    entities_percent: Number(percentage(mixer, (row) => row.entities_all_correct).toFixed(2)),
    full_percent: Number(percentage(mixer, (row) => row.full_command_correct).toFixed(2)),
    wrong_accepted: mixer.reduce((sum, row) => sum + Number(row.wrong_accepted || 0), 0),
    phonetic_recoveries: mixer.reduce((sum, row) => sum + Number(row.phonetic_recoveries || 0), 0),
  };
}

function csv(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(args.input);
const outputDir = path.resolve(args.outputDir || path.dirname(input));
const data = JSON.parse(fs.readFileSync(input, "utf8"));
const samples = Array.isArray(data.results) ? data.results.filter((item) => !item.error) : [];

const rows = [];
for (const sample of samples) {
  for (const registryName of ["xr16", "stress60"]) {
    rows.push(score(sample, registryName));
  }
}

const summaries = [];
for (const engine of [...new Set(rows.map((row) => row.engine))].sort()) {
  for (const registryName of ["xr16", "stress60"]) {
    summaries.push({
      engine,
      registry: registryName,
      ...summary(rows.filter((row) => row.engine === engine && row.registry === registryName)),
    });
  }
}

fs.mkdirSync(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, "resolver_benchmark_results.json");
const csvPath = path.join(outputDir, "resolver_benchmark_results.csv");
const reportPath = path.join(outputDir, "resolver_benchmark_report.md");

fs.writeFileSync(jsonPath, JSON.stringify({
  created_at_utc: new Date().toISOString(),
  input,
  production_resolver: "exact -> contains -> structured -> phonetic -> fuzzy",
  safety_rule: "wrong_accepted must remain zero",
  registries: {
    xr16: { channels: CHANNELS, buses: BUSES, total: 20 },
    stress60: { total: 60 },
  },
  summaries,
  results: rows,
}, null, 2) + "\n");

const fields = [
  "engine", "registry", "file", "phrase_id", "take", "domain", "skipped",
  "parser_recognized", "expected_kind", "parsed_kind", "core_correct",
  "entities_expected", "entities_all_resolved", "entities_all_correct",
  "phonetic_recoveries", "wrong_accepted", "full_command_correct",
  "reference", "transcription", "resolved_slots"
];
fs.writeFileSync(
  csvPath,
  fields.join(",") + "\n" +
    rows.map((row) => fields.map((field) => csv(row[field] ?? "")).join(",")).join("\n") +
    "\n"
);

const lines = [
  "# STT -> XMSeries production parser/resolver benchmark",
  "",
  "Pure replay only. No OSC, mixer or MCP transport is opened.",
  "",
  "Resolver: exact -> contains -> structured -> phonetic -> fuzzy.",
  "Only a unique non-fuzzy result is treated as safely resolved.",
  "",
  "## Summary",
  "",
  "| Engine | Registry | Parse | Core | Entities resolved | Entities correct | Full command | Phonetic recoveries | Wrong accepted |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|",
];

for (const item of summaries) {
  lines.push(
    "| " + item.engine +
    " | " + item.registry +
    " | " + item.parser_percent.toFixed(2) + "%" +
    " | " + item.core_percent.toFixed(2) + "%" +
    " | " + item.resolved_percent.toFixed(2) + "%" +
    " | " + item.entities_percent.toFixed(2) + "%" +
    " | " + item.full_percent.toFixed(2) + "%" +
    " | " + item.phonetic_recoveries +
    " | " + item.wrong_accepted + " |"
  );
}

lines.push("", "## Failures / safety cases", "");
for (const row of rows.filter((item) => !item.skipped && (!item.full_command_correct || item.wrong_accepted))) {
  lines.push(
    "- " + row.engine + " / " + row.registry + " / " + row.file +
    ": core=" + row.core_correct +
    ", full=" + row.full_command_correct +
    ", wrong_accepted=" + row.wrong_accepted +
    ", STT=" + JSON.stringify(row.transcription) +
    ", slots=" + JSON.stringify(row.resolved_slots)
  );
}
lines.push("", "A higher resolution rate is acceptable only while wrong_accepted remains zero.", "");
fs.writeFileSync(reportPath, lines.join("\n"));

console.log("\n=== XMSeries parser/resolver replay ===");
for (const item of summaries) {
  console.log(
    item.engine.padEnd(36) + " " +
    item.registry.padEnd(8) +
    " full=" + item.full_percent.toFixed(1) + "% " +
    "phonetic=" + item.phonetic_recoveries + " " +
    "wrong=" + item.wrong_accepted
  );
}
console.log("\nReport: " + reportPath);
