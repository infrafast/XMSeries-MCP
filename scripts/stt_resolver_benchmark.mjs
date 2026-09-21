#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseLocalMixerIntent, qualifiedTargetQuery } from "../dist/local-gateway.js";
import { rankNamedTargetCandidates } from "../dist/index.js";

const VARIANTS = ["base_prompt_current", "small_prompt_current"];
const CHANNELS = [
  "vocal-clode","vocal-anto","cowbell","guitar-clode","guitar-loran","basse-mike",
  "guitar-anto","flute","CLIC","strings","noname","reserved","batterie","retour-tom",
  "inconnu","Assistant"
];
const BUSES = ["anto","laurent","mike","claude"];
const EXTRA_CHANNELS = [
  "vocal-laurent","vocal-mike","vocal-lead","vocal-guest","guitar-mike",
  "guitar-laurent","guitar-anton","guitar-acoustic","guitar-clean","bass-di",
  "bass-amp","kick","snare","hihat","tom-1","tom-2","floor-tom","overhead-l",
  "overhead-r","percussion"
];
const EXTRA_BUSES = ["monitor-a","monitor-b","drums","vocals","inear-anto","inear-laurent","sidefill","click"];
const EXTRA_FX = ["fx-reverb","fx-delay","fx-chorus","fx-flanger"];
const EXTRA_AUX = ["playback-l","playback-r","usb","talkback"];
const EXTRA_DCA = ["band","vocals-dca","drums-dca","instruments"];
const SEND_SOURCE_FAMILIES = ["channel","fxreturn","aux"];
const ALL_FAMILIES = ["channel","bus","fxreturn","aux","dca","matrix"];

function args(argv) {
  const out = { input: "", outputDir: "", variants: VARIANTS.slice() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") out.input = argv[++i] || "";
    else if (argv[i] === "--output-dir") out.outputDir = argv[++i] || "";
    else if (argv[i] === "--variants") out.variants = String(argv[++i] || "").split(",").map(x => x.trim()).filter(Boolean);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("node scripts/stt_resolver_benchmark.mjs [--input benchmark_results.json] [--variants base_prompt_current,small_prompt_current]");
      process.exit(0);
    } else throw new Error("Argument inconnu: " + argv[i]);
  }
  return out;
}

function defaultInput() {
  const candidates = [
    process.env.LSA_STT_BENCHMARK_RESULTS,
    path.resolve(process.cwd(), "../LiveStageAssistant/recordings/stt_benchmark_audio/benchmark_results.json"),
    "/home/pi/LiveStageAssistant/recordings/stt_benchmark_audio/benchmark_results.json"
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error("benchmark_results.json introuvable; utilise --input");
  return found;
}

function family(fam, names, start = 1) {
  return names.map((name, i) => ({ family: fam, index: start + i, name }));
}
function registry(stress) {
  const r = [...family("channel", CHANNELS), ...family("bus", BUSES)];
  if (stress) r.push(
    ...family("channel", EXTRA_CHANNELS, CHANNELS.length + 1),
    ...family("bus", EXTRA_BUSES, BUSES.length + 1),
    ...family("fxreturn", EXTRA_FX),
    ...family("aux", EXTRA_AUX),
    ...family("dca", EXTRA_DCA)
  );
  return r;
}
const REG = { xr16: registry(false), stress60: registry(true) };
if (REG.xr16.length !== 20 || REG.stress60.length !== 60) throw new Error("Taille registry invalide");

function scoped(reg, families) {
  if (!families) return reg;
  return reg.filter(x => families.includes(x.family));
}
function strictResolve(query, reg, families) {
  const qualified = qualifiedTargetQuery(query, families);
  if (qualified.families && qualified.families.length === 0) {
    return { accepted: null, method: "family_conflict", score: null, margin: null, experimental: false };
  }
  const matches = rankNamedTargetCandidates(qualified.query, scoped(reg, qualified.families));
  const accepted = matches.length === 1 && matches[0].matchType !== "fuzzy" ? matches[0] : null;
  return {
    accepted,
    method: accepted ? accepted.matchType : "unresolved",
    score: null,
    margin: null,
    experimental: false,
    normalizedQuery: qualified.query,
    families: qualified.families,
  };
}
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\bguitares?\b/g, "guitar");
}
function phonetic(s) {
  return norm(s).split(/\s+/).filter(Boolean).map(t => {
    if (t === "en") t = "an";
    if (["taux","toe","tot"].includes(t)) t = "to";
    return t.replace(/eau/g,"o").replace(/au/g,"o").replace(/ph/g,"f").replace(/qu/g,"k").replace(/ck/g,"k").replace(/ent$/g,"an");
  }).join("");
}
function distance(a,b) {
  let p = Array.from({length:b.length+1},(_,i)=>i);
  for (let i=1;i<=a.length;i++) {
    const c=[i];
    for (let j=1;j<=b.length;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));
    p=c;
  }
  return p[b.length];
}
function similarity(a,b) {
  a=phonetic(a); b=phonetic(b);
  return a && b ? 1-distance(a,b)/Math.max(a.length,b.length) : 0;
}
function threshold(q) {
  const n=phonetic(q).length;
  return n<=5 ? .80 : n<=9 ? .76 : .72;
}
function familyFuzzy(query, reg, families) {
  const strict = strictResolve(query,reg,families);
  if (strict.accepted || strict.method === "family_conflict") return strict;
  const qualified = qualifiedTargetQuery(query, families);
  const scored=scoped(reg,qualified.families).map(candidate=>({candidate,score:similarity(qualified.query,candidate.name)})).sort((a,b)=>b.score-a.score);
  const a=scored[0], b=scored[1];
  if (!a) return strict;
  const margin=a.score-(b?.score ?? 0);
  if (a.score < threshold(qualified.query) || margin < .08) return { ...strict, method:"fuzzy_rejected", score:a.score, margin };
  return { accepted:{...a.candidate,matchType:"fuzzy"}, method:"family_fuzzy", score:a.score, margin, experimental:true };
}

const QUERY_KEYS = new Set(["targetQuery","sourceQuery","destinationQuery","destinationQueries","rawDestinationQuery","targetQueries","rawQuery","channelQueries","busQueries"]);
function core(v) {
  if (Array.isArray(v)) return v.map(core);
  if (!v || typeof v !== "object") return v;
  const o={};
  for (const [k,x] of Object.entries(v)) if (!QUERY_KEYS.has(k)) o[k]=core(x);
  return o;
}
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function sameCore(a,b) { return JSON.stringify(stable(core(a))) === JSON.stringify(stable(core(b))); }

function slots(intent) {
  if (!intent) return [];
  if (intent.kind === "multi_send") {
    const out=[{role:"source",query:intent.intent?.sourceQuery || intent.sourceQuery,families:SEND_SOURCE_FAMILIES}];
    for (let i=0;i<(intent.destinationQueries || []).length;i++) out.push({role:"destination:"+i,query:intent.destinationQueries[i],families:["bus"]});
    return out.filter(x=>x.query);
  }
  if (typeof intent.sourceQuery === "string" && typeof intent.destinationQuery === "string") return [
    {role:"source",query:intent.sourceQuery,families:SEND_SOURCE_FAMILIES},
    {role:"destination",query:intent.destinationQuery,families:String(intent.kind).startsWith("send_")?["bus"]:ALL_FAMILIES}
  ];
  if (typeof intent.targetQuery === "string") return [{role:"target",query:intent.targetQuery,families:ALL_FAMILIES}];
  if (typeof intent.sourceQuery === "string") return [{role:"source",query:intent.sourceQuery,families:SEND_SOURCE_FAMILIES}];
  return [];
}
function id(x) { return x ? x.family+":"+x.name.toLowerCase() : null; }

function score(input, registryName, resolverName) {
  const reg=REG[registryName];
  const resolve=resolverName==="strict" ? strictResolve : familyFuzzy;
  const reference=parseLocalMixerIntent(String(input.reference || ""));
  const actual=parseLocalMixerIntent(String(input.transcription || ""));
  if (!reference) throw new Error("Référence non parsable: "+input.reference);
  const expected=slots(reference).map(s=>{
    const r=strictResolve(s.query,reg,s.families);
    if (!r.accepted) throw new Error("Référence non résolue: "+s.query);
    return {...s,expected:r.accepted};
  });
  const actualMap=new Map(slots(actual).map(s=>[s.role,s]));
  let resolved=true, correct=true, wrong=0, promoted=0;
  const detail=[];
  for (const e of expected) {
    const a=actualMap.get(e.role);
    if (!a) { resolved=false; correct=false; detail.push({role:e.role,expected:id(e.expected),query:null,resolved:null,method:"slot_missing",correct:false}); continue; }
    const r=resolve(a.query,reg,e.families);
    const ok=id(r.accepted)===id(e.expected);
    if (!r.accepted) resolved=false;
    if (!ok) correct=false;
    if (r.accepted && !ok) wrong++;
    if (r.experimental) promoted++;
    detail.push({role:e.role,expected:id(e.expected),query:a.query,resolved:id(r.accepted),method:r.method,score:r.score,margin:r.margin,correct:ok});
  }
  const parser=Boolean(actual);
  const coreOk=parser && sameCore(reference,actual);
  return {
    variant:input.variant, registry:registryName, resolver:resolverName, file:input.file,
    phrase_id:input.phrase_id, take:input.take, audio_outlier:Boolean(input.audio_outlier),
    reference:input.reference, transcription:input.transcription,
    parser_recognized:parser, expected_kind:reference.kind, parsed_kind:actual?.kind ?? null,
    core_correct:coreOk, entities_expected:expected.length, entities_all_resolved:resolved,
    entities_all_correct:correct, wrong_accepted:wrong, experimental_promotions:promoted,
    full_command_correct:coreOk && correct, resolved_slots:detail
  };
}
function summary(rows, clean) {
  const a=clean?rows.filter(x=>!x.audio_outlier):rows, n=a.length||1, pct=f=>100*a.filter(f).length/n;
  return {
    samples:a.length, parser:Number(pct(x=>x.parser_recognized).toFixed(2)),
    core:Number(pct(x=>x.core_correct).toFixed(2)), resolved:Number(pct(x=>x.entities_all_resolved).toFixed(2)),
    entities:Number(pct(x=>x.entities_all_correct).toFixed(2)), full:Number(pct(x=>x.full_command_correct).toFixed(2)),
    wrong_commands:a.filter(x=>x.wrong_accepted>0).length, wrong_slots:a.reduce((s,x)=>s+x.wrong_accepted,0),
    promotions:a.reduce((s,x)=>s+x.experimental_promotions,0)
  };
}
function esc(v) {
  const s=typeof v==="string"?v:JSON.stringify(v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function write(outDir,inputPath,variants,rows) {
  const groups=new Map();
  for (const r of rows) { const k=[r.variant,r.registry,r.resolver].join("|"); if(!groups.has(k))groups.set(k,[]); groups.get(k).push(r); }
  const sums=[];
  for (const [k,g] of groups) {
    const [variant,registry,resolver]=k.split("|");
    sums.push({variant,registry,resolver,scope:"all",...summary(g,false)});
    sums.push({variant,registry,resolver,scope:"clean",...summary(g,true)});
  }
  const payload={created_at_utc:new Date().toISOString(),input:inputPath,variants,
    registries:{xr16:{channels:CHANNELS,buses:BUSES,total:20},stress60:{total:60}},
    experimental_policy:{name:"family_fuzzy",runtime_unchanged:true,min_margin:.08},summaries:sums,results:rows};
  fs.mkdirSync(outDir,{recursive:true});
  const jp=path.join(outDir,"resolver_benchmark_results.json"), cp=path.join(outDir,"resolver_benchmark_results.csv"), mp=path.join(outDir,"resolver_benchmark_report.md");
  fs.writeFileSync(jp,JSON.stringify(payload,null,2)+"\n");
  const fields=["variant","registry","resolver","file","phrase_id","take","audio_outlier","parser_recognized","expected_kind","parsed_kind","core_correct","entities_expected","entities_all_resolved","entities_all_correct","wrong_accepted","experimental_promotions","full_command_correct","reference","transcription","resolved_slots"];
  fs.writeFileSync(cp,fields.join(",")+"\n"+rows.map(r=>fields.map(f=>esc(r[f]??"")).join(",")).join("\n")+"\n");
  const lines=["# Benchmark STT -> XMSeries parser/resolver","",
    "- Aucun OSC ni mixer I/O n'est exécuté.",
    "- strict = politique actuelle fail-closed; fuzzy refusé.",
    "- family_fuzzy = expérimental benchmark uniquement; family scoped + seuil + marge.",
    "- stress60 = 20 vrais noms XR16 + 40 distracteurs.","",
    "## Résumé — tous les samples","",
    "| STT | Registry | Resolver | Parse | Core | Entités résolues | Entités correctes | Commande complète | Wrong accepted | Promotions |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|"];
  for (const s of sums.filter(x=>x.scope==="all")) lines.push("| "+s.variant+" | "+s.registry+" | "+s.resolver+" | "+s.parser.toFixed(2)+"% | "+s.core.toFixed(2)+"% | "+s.resolved.toFixed(2)+"% | "+s.entities.toFixed(2)+"% | "+s.full.toFixed(2)+"% | "+s.wrong_commands+" | "+s.promotions+" |");
  lines.push("","## Résumé — hors outliers audio","",
    "| STT | Registry | Resolver | Parse | Core | Entités résolues | Entités correctes | Commande complète | Wrong accepted | Promotions |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of sums.filter(x=>x.scope==="clean")) lines.push("| "+s.variant+" | "+s.registry+" | "+s.resolver+" | "+s.parser.toFixed(2)+"% | "+s.core.toFixed(2)+"% | "+s.resolved.toFixed(2)+"% | "+s.entities.toFixed(2)+"% | "+s.full.toFixed(2)+"% | "+s.wrong_commands+" | "+s.promotions+" |");
  lines.push("","## Cas à risque / non résolus","");
  for (const r of rows.filter(x=>!x.full_command_correct || x.wrong_accepted)) lines.push("- "+r.variant+" / "+r.registry+" / "+r.resolver+" / "+r.file+": core="+r.core_correct+", full="+r.full_command_correct+", wrong="+r.wrong_accepted+" — "+r.transcription+" — "+JSON.stringify(r.resolved_slots));
  lines.push("","Une hausse des entités résolues n'est acceptable que si Wrong accepted reste à zéro.","");
  fs.writeFileSync(mp,lines.join("\n"));
  return {jp,cp,mp,sums};
}

const a=args(process.argv.slice(2));
const input=path.resolve(a.input || defaultInput());
const outDir=path.resolve(a.outputDir || path.dirname(input));
const data=JSON.parse(fs.readFileSync(input,"utf8"));
const selected=(data.results || []).filter(r=>a.variants.includes(r.variant) && !r.error);
for (const v of a.variants) if(!selected.some(r=>r.variant===v)) throw new Error("Variante absente: "+v);
console.log("\n=== STT -> XMSeries parser/resolver benchmark ===");
console.log("Input                 : "+input);
console.log("Variantes             : "+a.variants.join(", "));
console.log("Registry XR16 réel    : 20 noms");
console.log("Registry stress       : 60 noms");
console.log("Resolvers             : strict, family_fuzzy (expérimental)");
console.log("Mixer / OSC           : NON utilisé\n");
const rows=[];
for (const r of selected) for (const reg of ["xr16","stress60"]) for (const resolver of ["strict","family_fuzzy"]) rows.push(score(r,reg,resolver));
const result=write(outDir,input,a.variants,rows);
console.log("=== RÉSUMÉ ===");
for (const s of result.sums.filter(x=>x.scope==="all")) console.log(s.variant.padEnd(22)+" "+s.registry.padEnd(8)+" "+s.resolver.padEnd(13)+" parse="+s.parser.toFixed(1)+"% core="+s.core.toFixed(1)+"% entities="+s.entities.toFixed(1)+"% full="+s.full.toFixed(1)+"% wrong="+s.wrong_commands);
console.log("\nRapport Markdown : "+result.mp);
console.log("Résultats JSON    : "+result.jp);
console.log("Résultats CSV     : "+result.cp);
