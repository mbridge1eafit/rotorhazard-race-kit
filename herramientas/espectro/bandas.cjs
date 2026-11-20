// Tabla de canales de 5.8 GHz (MHz) y utilidades compartidas por scan.cjs y analyze.cjs.
const BANDS = {
  R: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
  F: [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
  E: [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
  A: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
  B: [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
  L: [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621],
};

/** "R1" -> 5658 ; "5740" -> 5740 */
function toFreq(name) {
  const s = String(name).trim().toUpperCase();
  if (/^\d{4}$/.test(s)) return Number(s);
  const m = s.match(/^([RFEABL])([1-8])$/);
  if (!m) throw new Error(`Canal no válido: ${name} (usa R1..R8, F1..F8, E1..E8, A1..A8, B1..B8, L1..L8 o MHz)`);
  return BANDS[m[1]][Number(m[2]) - 1];
}

/** 5658 -> "R1" (Raceband primero: 5880 = R7) */
function toName(freq) {
  for (const b of ["R", "F", "E", "A", "B", "L"]) {
    const i = BANDS[b].indexOf(Number(freq));
    if (i >= 0) return b + (i + 1);
  }
  return String(freq);
}

/** "R1,R2,F4" -> [5658, 5695, 5800] */
const parseList = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean).map(toFreq);

/** Lee "--nombre valor" de los argumentos. */
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

module.exports = { BANDS, toFreq, toName, parseList, arg };
