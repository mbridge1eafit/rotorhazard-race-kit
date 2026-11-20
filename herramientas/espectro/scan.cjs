// Barrido de espectro con los receptores de RotorHazard, sin escribir en la base de datos.
// Truco: set_scan con min = max = F fija el hardware del nodo en F. Cada ronda el nodo n escucha
// la frecuencia (r + n*off) mod N, así todos los nodos pasan por todas las frecuencias y luego se
// normaliza cada nodo contra su propio piso. Al final set_scan "apagado" restaura la frecuencia
// del perfil en cada nodo.
//
// Uso:
//   node scan.cjs --salida amplio.json                              (5645-5945 MHz cada 5 MHz)
//   node scan.cjs --rango 5645-5945 --paso 5 --espera 3000 --pasadas 1 --salida amplio.json
//   node scan.cjs --canales R1,R2,R3,R4,R5,R6,R7,R8,F1,F2,F4,E1 --espera 6000 --pasadas 2 --salida canales.json
// Variables de entorno: RH_URL (p. ej. http://192.168.1.20:5000), RH_USERNAME / RH_PASSWORD
// (por defecto admin / rotorhazard). El timer debe estar en READY (sin carrera).
const path = require("path");
const fs = require("fs");
const { parseList, arg } = require("./bandas.cjs");

function loadIo() {
  // Usa el socket.io-client del MCP del repo (npm install en mcp-server/) o uno instalado aquí.
  for (const p of [path.join(__dirname, "..", "..", "mcp-server", "node_modules", "socket.io-client"), "socket.io-client"]) {
    try {
      return require(p).io;
    } catch {
      /* siguiente */
    }
  }
  console.error("Falta socket.io-client: ejecuta 'npm install' en mcp-server/ (o 'npm install socket.io-client' aquí).");
  process.exit(1);
}
const io = loadIo();

const URL = (process.env.RH_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const USER = process.env.RH_USERNAME || "admin";
const PASS = process.env.RH_PASSWORD || "rotorhazard";
const DWELL = Number(arg("espera", 3000)); // ms por frecuencia
const PASSES = Number(arg("pasadas", 1));
const OUT = arg("salida", "barrido.json");
const STEP = Number(arg("paso", 5));
const SETTLE = 600; // ms descartados tras retunear

let FREQS = [];
if (arg("canales")) FREQS = parseList(arg("canales"));
else {
  const [min, max] = String(arg("rango", "5645-5945")).split("-").map(Number);
  for (let f = min; f <= max; f += STEP) FREQS.push(f);
}
const N = FREQS.length;

const s = io(URL, { extraHeaders: { Authorization: "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64") } });
const samples = {}; // node -> freq -> [rssi]
let NODES = 0;
let target = null;
let tuneAt = 0;
let beats = 0;

const park = (n, f) => s.emit("set_scan", { node: n, min_scan_frequency: f, max_scan_frequency: f, max_scan_interval: STEP, min_scan_interval: STEP, scan_zoom: 1 });
const release = (n) => s.emit("set_scan", { node: n, min_scan_frequency: 0, max_scan_frequency: 0, max_scan_interval: 0, min_scan_interval: 0, scan_zoom: 0 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

s.on("heartbeat", (h) => {
  beats++;
  if (!NODES && Array.isArray(h.frequency)) NODES = h.frequency.length;
  if (!target || Date.now() - tuneAt < SETTLE) return;
  for (let n = 0; n < NODES; n++) {
    if (h.frequency[n] !== target[n]) continue; // solo muestras ya sintonizadas
    ((samples[n] ??= {})[target[n]] ??= []).push(h.current_rssi[n]);
  }
});

s.on("connect", async () => {
  for (let i = 0; i < 50 && !NODES; i++) await sleep(100); // el primer heartbeat dice cuántos nodos hay
  if (!NODES) {
    console.error("No llegan heartbeats: ¿credenciales de admin correctas?");
    process.exit(1);
  }
  const OFF = Math.max(1, Math.floor(N / NODES));
  console.log(`conectado a ${URL}: ${NODES} nodos, ${N} frecuencias x ${PASSES} pasadas, ${DWELL} ms c/u (~${Math.round((N * PASSES * DWELL) / 60000)} min)`);
  const t0 = Date.now();
  const restore = () => {
    for (let n = 0; n < NODES; n++) release(n);
  };
  process.on("SIGINT", async () => {
    console.log("\ninterrumpido: restaurando frecuencias");
    restore();
    await sleep(1500);
    process.exit(130);
  });
  for (let p = 0; p < PASSES; p++) {
    for (let r = 0; r < N; r++) {
      const t = [];
      for (let n = 0; n < NODES; n++) t[n] = FREQS[(r + n * OFF) % N];
      target = null;
      t.forEach((f, n) => park(n, f));
      tuneAt = Date.now();
      target = t;
      await sleep(DWELL);
    }
    console.log(`pasada ${p + 1} lista (${((Date.now() - t0) / 1000).toFixed(0)} s, ${beats} heartbeats)`);
  }
  target = null;
  restore();
  await sleep(1500);
  fs.writeFileSync(OUT, JSON.stringify({ url: URL, freqs: FREQS, nodes: NODES, beats, samples }));
  console.log("guardado", OUT);
  s.close();
  process.exit(0);
});
s.on("connect_error", (e) => console.log("connect_error", e.message));
