/** Prueba offline del análisis de marshal con trazas sintéticas:  npx tsx scripts/marshal-analysis.test.ts */
import { strict as assert } from "node:assert";
import { type Ctx, diagnose, enforceMinLap, type Lap, recalcFromTrace, recompute, scanThresholds, summary, toTrace } from "../src/marshal/analysis.js";

const START = 1000; // start_time (s, monotónico)
const ctx: Ctx = { minLapMs: 5000, minFirstMs: 0, raceTimeMs: 120_000, deleteShort: false };

/** Traza a 20 Hz: ruido ~50 y una campana por pasada (t en s, pico). */
function trace(passes: Array<[number, number]>, dur = 125) {
  const v: number[] = [];
  const t: number[] = [];
  for (let ms = 0; ms <= dur * 1000; ms += 50) {
    let x = 50 + ((ms * 7919) % 5) - 2;
    for (const [ps, pk] of passes) {
      const d = (ms - ps * 1000) / 350;
      x = Math.max(x, Math.round(50 + (pk - 50) * Math.exp(-d * d)));
    }
    v.push(x);
    t.push(START + ms / 1000);
  }
  return { v, t };
}

// piloto real: holeshot a 3 s y vueltas de ~20 s; la pasada de 43 s es débil (90) y la de 63.3 s es un doble cruce
const passes: Array<[number, number]> = [[3, 120], [23, 125], [43, 90], [63, 122], [64.2, 118], [83, 124], [103, 121], [121, 119]];
const h = toTrace(...(Object.values(trace(passes)) as [number[], number[]]), START);
assert.equal(h.v.length, h.t.length);

// "guardado" en tiempo real con EnterAt 100 / ExitAt 92: pierde la de 43 y registra el doble cruce
const stored = recalcFromTrace(h, 100, 92, ctx).map((l) => ({ ...l, source: 0 }));
const s = summary(stored);
console.log("guardado:", s, stored.map((l) => (l.lap_time_stamp / 1000).toFixed(2)).join(" "));
assert.equal(s.passes, 7, "7 pasos: falta 43 y sobra el doble cruce");

const d = diagnose(recompute(stored), h, 100, 92, ctx, null);
console.log(d.issues.map((i) => `${i.severity} ${i.code}: ${i.msg} ${JSON.stringify(i.fix ?? {})}`).join("\n"));
console.log("candidatos:", d.best);
assert.ok(d.issues.some((i) => i.code === "SHORT_LAP"), "detecta vuelta corta");
const long = d.issues.find((i) => i.code === "LONG_LAP");
assert.ok(long, "detecta vuelta larga");
assert.deepEqual(long!.fix, { add_at_s: [43] }, "propone añadir la pasada perdida en 43 s");

// el barrido debe encontrar unos umbrales que capten la pasada débil (enter < 90)
const best = scanThresholds(h, ctx, stored, null, { enter: 100, exit: 92 }, 1)[0];
assert.ok(best.enter_at < 90, `enter sugerido < 90 (fue ${best.enter_at})`);
const tuned = recalcFromTrace(h, best.enter_at, best.exit_at, ctx, stored);
assert.equal(enforceMinLap(tuned, ctx.minLapMs), 1, "borra el doble cruce");
const fixed = summary(tuned);
console.log("auto_tune:", best, fixed);
assert.equal(fixed.laps, 6, "6 vueltas reales");
assert.ok(fixed.fastest_s! >= 18, "sin vueltas cortas");

// vuelta manual se conserva al recalcular
const withManual: Lap[] = [...stored, { lap_time_stamp: 50_000, lap_time: 0, source: 1, deleted: false }];
assert.ok(recalcFromTrace(h, 100, 92, ctx, withManual).some((l) => l.source === 1), "conserva manual");
console.log("\nOK: todas las comprobaciones pasaron");
