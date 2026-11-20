// Analiza barridos: ruido por frecuencia (normalizado por nodo) + IMD de las combinaciones de canales.
// Uso: node analyze.cjs amplio.json canales.json [--candidatos R1,R2,...] [--grupo 4] [--ref "R1,R3,R6,R8;R1,R2,F4,R7"]
//   --candidatos  canales que soportan tus VTX/VRX (por defecto R1-R8, F1, F2, F4, E1)
//   --grupo       cuántos pilotos vuelan a la vez (por defecto 4)
//   --ref         combinaciones a comparar con el ranking, separadas por ";"
const { parseList, toName, arg } = require("./bandas.cjs");
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
if (!files.length) {
  console.error("Uso: node analyze.cjs barrido1.json [barrido2.json ...] [--candidatos ...] [--grupo 4] [--ref ...]");
  process.exit(1);
}
const CANDS = parseList(arg("candidatos", "R1,R2,E1,R3,F1,F2,R4,F4,R5,R6,R7,R8"));
const GROUP = Number(arg("grupo", 4));
const NAMES = Object.fromEntries(CANDS.map((f) => [f, toName(f)]));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// Junta muestras de todos los archivos: node -> freq -> [rssi]
const all = {};
for (const f of files) {
  const d = require(require("path").resolve(f));
  for (const n in d.samples) for (const fr in d.samples[n]) ((all[n] ??= {})[fr] ??= []).push(...d.samples[n][fr]);
}
// Línea base por nodo: mediana de sus medianas en todas las frecuencias medidas
const base = {};
for (const n in all) base[n] = med(Object.values(all[n]).map(med));
const allFreqs = [...new Set(Object.values(all).flatMap((o) => Object.keys(o).map(Number)))].sort((a, b) => a - b);
const prof = allFreqs.map((fr) => {
  const rel = [], relPk = [];
  for (const n in all) { const s = all[n][fr]; if (!s?.length) continue; rel.push(med(s) - base[n]); relPk.push(pct(s, 0.95) - base[n]); }
  return { fr, noise: rel.reduce((a, b) => a + b, 0) / rel.length, peak: Math.max(...relPk), nodes: rel.length };
});
console.log("Base por nodo:", Object.entries(base).map(([n, b]) => `N${+n + 1}=${b}`).join(" "));
console.log("\nPerfil (RSSI relativo a la base de cada nodo; + = más energía):");
for (const p of prof) {
  const tag = NAMES[p.fr] ? NAMES[p.fr].padEnd(3) : "   ";
  console.log(`${p.fr} ${tag} prom ${p.noise.toFixed(1).padStart(6)}  p95max ${p.peak.toFixed(1).padStart(6)}  ${"#".repeat(Math.max(0, Math.round(p.noise + 5)))}`);
}
// Ruido en cada candidato: si no se midió exacto, interpola el vecino más cercano (±5 MHz)
const noiseAt = (f) => { const near = prof.filter((p) => Math.abs(p.fr - f) <= 5); return near.length ? Math.max(...near.map((p) => p.noise)) : 0; };
const peakAt = (f) => { const near = prof.filter((p) => Math.abs(p.fr - f) <= 5); return near.length ? Math.max(...near.map((p) => p.peak)) : 0; };

// IMD 3er orden: productos 2a-b y a+b-c cerca de un canal en uso (ancho útil ~ ±35 MHz con caída cuadrática)
function imd(set) {
  let pen = 0;
  for (const a of set) for (const b of set) {
    if (a === b) continue;
    const p = 2 * a - b;
    for (const c of set) { const d = Math.abs(p - c); if (d < 35) pen += ((35 - d) / 35) ** 2; }
  }
  return pen;
}
const minSep = (set) => { const s = [...set].sort((a, b) => a - b); let m = 1e9; for (let i = 1; i < s.length; i++) m = Math.min(m, s[i] - s[i - 1]); return m; };
function* choose(arr, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i < arr.length; i++) {
    acc.push(arr[i]);
    yield* choose(arr, k, i + 1, acc);
    acc.pop();
  }
}
const combos = [];
for (const set of choose([...CANDS].sort((a, b) => a - b), GROUP)) {
  const sep = minSep(set);
  const noise = set.reduce((a, f) => a + Math.max(0, noiseAt(f)), 0);
  const worst = Math.max(...set.map((f) => Math.max(noiseAt(f), peakAt(f) / 2)));
  const im = imd(set);
  const sepPen = sep >= 37 ? 0 : ((37 - sep) / 10) ** 2 * 5;
  const score = im * 10 + sepPen + noise * 1.5 + Math.max(0, worst) * 1.5;
  combos.push({ set, sep, im, noise, worst, score });
}
combos.sort((a, b) => a.score - b.score);
console.log("\nRuido por candidato:");
for (const f of [...CANDS].sort((a, b) => a - b)) console.log(`  ${NAMES[f].padEnd(3)} ${f}  prom ${noiseAt(f).toFixed(1).padStart(5)}  p95 ${peakAt(f).toFixed(1).padStart(5)}`);
console.log("\nTop 10 combinaciones (menor puntaje = mejor):");
for (const c of combos.slice(0, 10)) console.log(`  ${c.set.map((f) => NAMES[f]).join(" ").padEnd(GROUP * 3 + 2)} [${c.set.join(", ")}]  sepMin ${c.sep}  IMD ${c.im.toFixed(2)}  ruido ${c.noise.toFixed(1)}  peor ${c.worst.toFixed(1)}  -> ${c.score.toFixed(1)}`);
const refs = arg("ref") ? arg("ref").split(";").map((r) => parseList(r).sort((a, b) => a - b)) : [];
for (const ref of refs) {
  const c = combos.find((x) => x.set.join() === ref.join());
  if (!c) {
    console.log(`  ref ${ref.join(",")}: no está entre los candidatos`);
    continue;
  }
  const rank = combos.indexOf(c) + 1;
  console.log(`  ref ${c.set.map((f) => NAMES[f]).join(" ")}: puesto ${rank}, IMD ${c.im.toFixed(2)}, sep ${c.sep}, puntaje ${c.score.toFixed(1)}`);
}
