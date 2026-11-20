/**
 * Análisis puro (sin red) de carreras guardadas para hacer marshal rápido:
 *  - recálculo de vueltas desde la traza RSSI (mismo algoritmo que static/marshal.js de RotorHazard 4.5)
 *  - detección de picos en la traza, diagnóstico de anomalías y barrido de umbrales EnterAt/ExitAt.
 * Todas las marcas de tiempo internas están en ms desde el inicio de la carrera.
 */

export interface Lap {
  id?: number;
  lap_time_stamp: number; // ms desde el inicio de la carrera
  lap_time: number; // ms
  lap_time_formatted?: string;
  source: number; // 0 tiempo real, 1 manual, 2 recalculada, 3 automática, 4 API
  deleted: boolean;
  peak_rssi?: number | null;
}

export interface Trace {
  t: number[]; // ms desde el inicio
  v: number[];
}

export interface Ctx {
  minLapMs: number; // 0 = sin mínimo
  minFirstMs: number; // MinFirstCrossingSec * 1000
  raceTimeMs: number | null; // null = tiempo ilimitado
  deleteShort: boolean; // MinLapBehavior != 0 (descartar vueltas cortas al recalcular)
}

export const SRC_MANUAL = 1;
export const SRC_RECALC = 2;
export const SRC_API = 4;
const PROTECTED = new Set([SRC_MANUAL, SRC_API]);

export const fmtS = (ms: number) => (ms / 1000).toFixed(3);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))];
}

export function toTrace(values: number[] | undefined, times: number[] | undefined, startTime: number): Trace {
  const v = values ?? [];
  const t = (times ?? []).map((x) => (x - startTime) * 1000);
  const n = Math.min(v.length, t.length);
  return { t: t.slice(0, n), v: v.slice(0, n) };
}

/** Ordena y recalcula lap_time (marshal.js: updateIncrementalLapTimes). */
export function recompute(laps: Lap[]): Lap[] {
  const sorted = [...laps].sort((a, b) => a.lap_time_stamp - b.lap_time_stamp);
  let prev: Lap | undefined;
  for (const l of sorted) {
    if (l.deleted) {
      l.lap_time = 0;
      continue;
    }
    l.lap_time = prev ? l.lap_time_stamp - prev.lap_time_stamp : l.lap_time_stamp;
    prev = l;
  }
  return sorted;
}

/**
 * Recalcula las vueltas desde la traza RSSI con unos umbrales (como el botón de recálculo de la página Marshal):
 * entra al cruce con rssi > enter, sale con rssi < exit, marca = punto medio del pico. Conserva las vueltas manuales/API.
 */
export function recalcFromTrace(trace: Trace, enter: number, exit: number, ctx: Ctx, keep: Lap[] = []): Lap[] {
  const laps: Lap[] = [];
  let crossing = false;
  let peak = 0;
  let pf = 0;
  let pl = 0;
  let lastTs = -Infinity;
  const push = (ts: number) => {
    if (ts <= 0) return;
    const l: Lap = { lap_time_stamp: Math.round(ts), lap_time: 0, source: SRC_RECALC, deleted: false, peak_rssi: peak };
    if (ts < ctx.minFirstMs) l.deleted = true;
    else if (ctx.deleteShort && ctx.minLapMs && ts < lastTs + ctx.minLapMs) l.deleted = true;
    else lastTs = ts;
    laps.push(l);
  };
  for (let i = 0; i < trace.v.length; i++) {
    const rssi = trace.v[i];
    const time = trace.t[i];
    if (!crossing && rssi > enter) crossing = true;
    if (rssi >= peak) {
      pl = time;
      if (rssi > peak) {
        pf = time;
        peak = rssi;
      }
    }
    if (crossing && rssi < exit) {
      push((pf + pl) / 2);
      crossing = false;
      peak = 0;
    }
  }
  if (crossing) push((pf + pl) / 2);
  // vueltas tardías: tras la primera pasada posterior al final, el resto se borra
  if (ctx.raceTimeMs) {
    let finished = false;
    for (const l of laps) {
      if (finished) l.deleted = true;
      else if (l.lap_time_stamp > ctx.raceTimeMs) finished = true;
    }
  }
  return recompute([...laps, ...keep.filter((l) => PROTECTED.has(l.source)).map((l) => ({ ...l }))]);
}

/**
 * Resuelve pares de pasos más cercanos que la vuelta mínima: borra el de menor pico (si no se sabe, el posterior).
 * Nunca borra pasos manuales/API ni el primero del par si es manual. Devuelve cuántos borró.
 */
export function enforceMinLap(laps: Lap[], minLapMs: number): number {
  if (!minLapMs) return 0;
  let n = 0;
  for (let guard = 0; guard < laps.length + 2; guard++) {
    const act = laps.filter((l) => !l.deleted).sort((a, b) => a.lap_time_stamp - b.lap_time_stamp);
    let pair: [Lap, Lap] | undefined;
    for (let i = 1; i < act.length; i++) {
      if (act[i].lap_time_stamp - act[i - 1].lap_time_stamp < minLapMs && !(PROTECTED.has(act[i].source) && PROTECTED.has(act[i - 1].source))) {
        pair = [act[i - 1], act[i]];
        break;
      }
    }
    if (!pair) break;
    const [a, b] = pair;
    let loser = a.peak_rssi != null && b.peak_rssi != null && a.peak_rssi < b.peak_rssi ? a : b;
    if (PROTECTED.has(loser.source)) loser = loser === a ? b : a;
    loser.deleted = true;
    n++;
  }
  recompute(laps);
  return n;
}

export interface Peak {
  t_s: number; // segundo del pico desde el inicio
  rssi: number;
  width_s: number;
}

/** Picos de la traza con histéresis (hi/lo), útil para ver pasadas que los umbrales no capturaron. */
export function findPeaks(trace: Trace, hi: number, lo: number): Peak[] {
  const peaks: Peak[] = [];
  let inside = false;
  let best = -Infinity;
  let bt = 0;
  let t0 = 0;
  for (let i = 0; i < trace.v.length; i++) {
    const v = trace.v[i];
    const t = trace.t[i];
    if (!inside && v >= hi) {
      inside = true;
      best = v;
      bt = t;
      t0 = t;
    }
    if (inside) {
      if (v > best) {
        best = v;
        bt = t;
      }
      if (v < lo) {
        if (bt > 0) peaks.push({ t_s: r1(bt / 1000), rssi: best, width_s: r1((t - t0) / 1000) });
        inside = false;
      }
    }
  }
  if (inside && bt > 0) peaks.push({ t_s: r1(bt / 1000), rssi: best, width_s: r1(((trace.t.at(-1) ?? bt) - t0) / 1000) });
  return peaks;
}

/** Niveles para buscar picos "candidatos a pasada": bastante por debajo de EnterAt pero claramente sobre el ruido. */
export function peakLevels(st: TraceStats, enter: number): { hi: number; lo: number } {
  const span = Math.max(enter, st.floor + 8) - st.floor;
  return { hi: st.floor + 0.45 * span, lo: st.floor + 0.25 * span };
}

export interface TraceStats {
  samples: number;
  duration_s: number;
  floor: number; // percentil 10 ≈ ruido de fondo
  p50: number;
  max: number;
}

export function traceStats(tr: Trace): TraceStats | null {
  if (!tr.v.length) return null;
  return {
    samples: tr.v.length,
    duration_s: r1(((tr.t.at(-1) ?? 0) - (tr.t[0] ?? 0)) / 1000),
    floor: percentile(tr.v, 10),
    p50: percentile(tr.v, 50),
    max: Math.max(...tr.v),
  };
}

export interface LapSummary {
  passes: number;
  laps: number;
  fastest_s: number | null;
  median_s: number | null;
  total_s: number | null;
}

export function summary(laps: Lap[]): LapSummary {
  const active = laps.filter((l) => !l.deleted);
  const times = active.slice(1).map((l) => l.lap_time);
  const med = median(times);
  return {
    passes: active.length,
    laps: Math.max(0, active.length - 1),
    fastest_s: times.length ? Number(fmtS(Math.min(...times))) : null,
    median_s: med !== null ? Number(fmtS(med)) : null,
    total_s: active.length ? Number(fmtS(active[active.length - 1].lap_time_stamp)) : null,
  };
}

/** Puntúa un conjunto de vueltas: premia vueltas normales, castiga cortas y largas. refMs = mediana de referencia (p. ej. de la carrera). */
export function scoreLaps(laps: Lap[], ctx: Ctx, refMs: number | null): { score: number; short: number; long: number; normal: number; median_ms: number | null } {
  const active = laps.filter((l) => !l.deleted);
  const times = active.slice(1).map((l) => l.lap_time);
  const own = median(times);
  const ref = refMs ?? own;
  if (!times.length || !ref) return { score: active.length ? -1 : -5, short: 0, long: 0, normal: 0, median_ms: own };
  const shortLim = Math.max(ctx.minLapMs, ref * 0.55);
  const short = times.filter((t) => t < shortLim).length;
  const long = times.filter((t) => t > ref * 1.6).length;
  const normal = times.length - short - long;
  return { score: normal - 3 * short - 2 * long, short, long, normal, median_ms: own };
}

export interface Candidate {
  enter_at: number;
  exit_at: number;
  laps: number;
  short: number;
  long: number;
  median_s: number | null;
  score: number;
}

/** Barre EnterAt/ExitAt y devuelve los mejores candidatos (no escribe nada). */
export function scanThresholds(trace: Trace, ctx: Ctx, keep: Lap[], refMs: number | null, stored?: { enter: number; exit: number }, top = 3): Candidate[] {
  const st = traceStats(trace);
  if (!st || st.max - st.floor < 6) return [];
  const cands: Candidate[] = [];
  const noiseTop = percentile(trace.v, 75); // el ruido "alto"; EnterAt debe quedar claramente por encima
  const lo = Math.ceil(Math.max(st.floor + 3, noiseTop + 0.2 * (st.max - noiseTop)));
  const hi = Math.floor(st.max - 1);
  const step = Math.max(1, Math.round((hi - lo) / 60));
  // márgenes: 2 puntos (escuela ygr) y 8/15/25 % del rango sobre el ruido (escuela classic)
  const gapPcts = [0, 0.08, 0.15, 0.25];
  const gapOf = (enter: number, k: number) => (k === 0 ? 2 : Math.max(1, Math.round((enter - st.floor) * gapPcts[k])));
  const grid = new Map<string, Candidate>();
  for (let enter = lo; enter <= hi; enter += step) {
    for (let k = 0; k < gapPcts.length; k++) {
      const exit = enter - gapOf(enter, k);
      if (exit <= st.floor) continue;
      const laps = recalcFromTrace(trace, enter, exit, ctx, keep);
      enforceMinLap(laps, ctx.minLapMs); // igual que hará auto_tune al aplicar
      const s = scoreLaps(laps, ctx, refMs);
      const c = { enter_at: enter, exit_at: exit, laps: Math.max(0, laps.filter((l) => !l.deleted).length - 1), short: s.short, long: s.long, median_s: s.median_ms !== null ? Number(fmtS(s.median_ms)) : null, score: s.score };
      grid.set(`${enter}/${k}`, c);
      cands.push(c);
    }
  }
  // estabilidad: preferir umbrales cuyos vecinos (enter ± step) den el mismo nº de vueltas
  const stability = (c: Candidate) => {
    const k = gapPcts.findIndex((_, i) => c.exit_at === c.enter_at - gapOf(c.enter_at, i));
    return [-step, step].filter((d) => grid.get(`${c.enter_at + d}/${k}`)?.laps === c.laps).length;
  };
  // desempate: estable, cerca de los umbrales guardados y con más margen (enter alto)
  const dist = (c: Candidate) => (stored ? Math.abs(c.enter_at - stored.enter) + Math.abs(c.exit_at - stored.exit) : 0);
  cands.sort((a, b) => b.score - a.score || stability(b) - stability(a) || dist(a) - dist(b) || b.enter_at - a.enter_at);
  // quita duplicados con el mismo resultado (mismo nº vueltas/cortas/largas), quedándose con el mejor de cada grupo
  const seen = new Set<string>();
  const outp: Candidate[] = [];
  for (const c of cands) {
    const k = `${c.laps}/${c.short}/${c.long}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outp.push(c);
    if (outp.length >= top) break;
  }
  return outp;
}

export type Severity = "error" | "warn" | "info";
export interface Issue {
  code: string;
  severity: Severity;
  msg: string;
  fix?: Record<string, unknown>; // argumentos sugeridos para rh_marshal_fix (por piloto)
}

export interface PilotDiagnosis {
  issues: Issue[];
  peaks_unmatched: Peak[];
  stats: TraceStats | null;
  recalc_same_thresholds: LapSummary | null;
  best: Candidate[];
}

/**
 * Diagnostica un piloto. laps = vueltas guardadas (ya con recompute), raceMedianMs = mediana de vuelta de toda la carrera.
 */
export function diagnose(laps: Lap[], trace: Trace, enter: number, exit: number, ctx: Ctx, raceMedianMs: number | null): PilotDiagnosis {
  const issues: Issue[] = [];
  const st = traceStats(trace);
  const active = laps.map((l, i) => ({ l, i })).filter((x) => !x.l.deleted);
  const times = active.slice(1).map((x) => x.l.lap_time);
  // mediana propia sin las vueltas imposibles (< vuelta mínima), que la distorsionan
  const own = median(times.filter((t) => t >= ctx.minLapMs));
  const ref = own !== null && times.length >= 3 ? own : raceMedianMs ?? own;
  // la traza guardada está diezmada: los picos de las vueltas pueden superar su máximo
  const lapPeak = Math.max(-Infinity, ...laps.map((l) => l.peak_rssi ?? -Infinity));
  const sigMax = st ? Math.max(st.max, lapPeak) : lapPeak;
  // traza plana: el receptor no vio al piloto (no voló, frecuencia/vídeo equivocados): nada que recalcular
  const noSignal = !!st && !active.length && st.max - st.floor < 8;
  const tunable = !!st && !noSignal;
  const near = (tMs: number, tol: number) => active.some((x) => Math.abs(x.l.lap_time_stamp - tMs) < tol);

  if (exit >= enter) issues.push({ code: "THRESHOLDS_INVALID", severity: "error", msg: `ExitAt (${exit}) ≥ EnterAt (${enter}).`, fix: tunable ? { auto_tune: true } : undefined });
  if (!st) issues.push({ code: "NO_TRACE", severity: "info", msg: "Sin traza RSSI guardada: solo se pueden editar pasos a mano." });
  if (noSignal)
    issues.push({
      code: "NO_SIGNAL",
      severity: "warn",
      msg: `Traza plana (RSSI ${st!.floor}–${st!.max}): el receptor no vio al piloto (¿no voló, se cayó al inicio, frecuencia o VTX equivocados?). No hay nada que recalcular.`,
    });
  else if (!active.length) issues.push({ code: "NO_PASSES", severity: "error", msg: "Ningún paso activo registrado.", fix: tunable ? { auto_tune: true } : undefined });

  // vueltas cortas
  if (ref) {
    const shortLim = Math.max(ctx.minLapMs, ref * 0.55);
    for (let k = 1; k < active.length; k++) {
      const { l, i } = active[k];
      if (l.lap_time < shortLim) {
        const prev = active[k - 1];
        // borra el de menor pico (si se conoce); si no, el posterior
        const pa = prev.l.peak_rssi ?? null;
        const pb = l.peak_rssi ?? null;
        const victim = k - 1 > 0 && pa !== null && pb !== null && pa < pb ? prev.i : i;
        const underMin = ctx.minLapMs > 0 && l.lap_time < ctx.minLapMs;
        issues.push({
          code: "SHORT_LAP",
          severity: underMin ? "error" : "warn",
          msg: `Paso #${i} a ${fmtS(l.lap_time_stamp)}s deja una vuelta de ${fmtS(l.lap_time)}s (< ${fmtS(shortLim)}s${underMin ? " = vuelta mínima" : " ≈ 55% de la mediana: ¿doble cruce o vuelta realmente rápida?"}).`,
          fix: { delete: [victim] },
        });
      }
    }
  }

  // picos de la traza sin paso activo
  let unmatched: Peak[] = [];
  if (tunable && enter > st!.floor) {
    const { hi, lo } = peakLevels(st!, enter);
    const tol = Math.max(800, (ref ?? 4000) * 0.25);
    unmatched = findPeaks(trace, hi, lo).filter((p) => p.t_s * 1000 > ctx.minFirstMs && !near(p.t_s * 1000, tol));
    if (ctx.raceTimeMs) unmatched = unmatched.filter((p) => p.t_s * 1000 <= ctx.raceTimeMs! + (ref ?? 0) * 1.5);
  }
  /** El pico más alto sin paso en [a, b] ms. */
  const bestIn = (a: number, b: number) => unmatched.filter((p) => p.t_s * 1000 > a && p.t_s * 1000 < b).sort((x, y) => y.rssi - x.rssi)[0];
  const showPeaks = (ps: Peak[]) => ps.map((p) => `${p.t_s}s (RSSI ${p.rssi})`).join(", ");

  // vueltas largas → pasadas perdidas: el mejor pico cerca de cada posición esperada
  if (ref) {
    for (let k = 1; k < active.length; k++) {
      const { l, i } = active[k];
      if (l.lap_time <= ref * 1.6) continue;
      const from = active[k - 1].l.lap_time_stamp;
      const n = Math.max(1, Math.round(l.lap_time / ref) - 1);
      const picks: Peak[] = [];
      for (let j = 1; j <= n; j++) {
        const expect = from + (l.lap_time * j) / (n + 1);
        const p = bestIn(Math.max(from + ctx.minLapMs, expect - ref * 0.4), Math.min(l.lap_time_stamp - ctx.minLapMs, expect + ref * 0.4));
        if (p && !picks.includes(p)) picks.push(p);
      }
      issues.push({
        code: "LONG_LAP",
        severity: "warn",
        msg:
          `Vuelta de ${fmtS(l.lap_time)}s antes del paso #${i} (${(l.lap_time / ref).toFixed(1)}× la mediana ${fmtS(ref)}s): ~${n} pasada(s) perdida(s)` +
          (picks.length ? `; mejor(es) pico(s) sin registrar: ${showPeaks(picks)}.` : "; no hay picos claros en la traza (¿se cayó o cortó camino?)."),
        fix: picks.length ? { add_at_s: picks.map((p) => p.t_s) } : undefined,
      });
    }
  }

  // holeshot perdido: primer paso tarde y un pico claro antes
  if (active.length && ref) {
    const first = active[0].l.lap_time_stamp;
    const p = first > ref * 0.8 ? bestIn(Math.max(ctx.minFirstMs, first - ref * 1.5), first - Math.max(ctx.minLapMs, ref * 0.5)) : undefined;
    if (p)
      issues.push({
        code: "MISSED_FIRST",
        severity: "warn",
        msg: `Primer paso tarde (${fmtS(first)}s) y pico sin registrar antes: ${showPeaks([p])}. ¿Holeshot/primera pasada perdida?`,
        fix: { add_at_s: [p.t_s] },
      });
  } else if (!active.length && unmatched.length) {
    issues.push({ code: "PEAKS_NO_PASSES", severity: "error", msg: `La traza tiene ${unmatched.length} picos pero no hay pasos: los umbrales no los capturan.`, fix: { auto_tune: true } });
  }

  // vueltas tardías activas
  if (ctx.raceTimeMs) {
    const after = active.filter((x) => x.l.lap_time_stamp > ctx.raceTimeMs!);
    if (after.length > 1)
      issues.push({
        code: "LATE_PASSES",
        severity: "warn",
        msg: `${after.length} pasos después del final (${fmtS(ctx.raceTimeMs)}s); normalmente solo cuenta el primero.`,
        fix: { delete: after.slice(1).map((x) => x.i) },
      });
  }

  // calibración
  if (tunable) {
    if (enter <= st!.floor + 2)
      issues.push({ code: "ENTER_IN_NOISE", severity: "error", msg: `EnterAt ${enter} está en el ruido de fondo (piso ≈ ${st!.floor}).`, fix: { auto_tune: true } });
    if (!active.length && enter >= sigMax)
      issues.push({ code: "ENTER_ABOVE_MAX", severity: "error", msg: `EnterAt ${enter} ≥ máximo de la señal (${sigMax}): ningún cruce puede registrarse.`, fix: { auto_tune: true } });
    const fragile = active.filter((x) => x.l.source !== SRC_MANUAL && x.l.peak_rssi != null && (x.l.peak_rssi as number) - enter <= 2).length;
    if (fragile >= 2) issues.push({ code: "LOW_MARGIN", severity: "info", msg: `${fragile} pasos con pico apenas sobre EnterAt (≤2): calibración justa.` });
  }

  // comparación con la carrera
  if (own && raceMedianMs && times.length >= 2 && own > raceMedianMs * 1.7)
    issues.push({
      code: "SLOW_VS_RACE",
      severity: "warn",
      msg: `Mediana ${fmtS(own)}s ≈ ${(own / raceMedianMs).toFixed(1)}× la de la carrera (${fmtS(raceMedianMs)}s): ¿se pierde una pasada de cada dos?`,
      fix: tunable ? { auto_tune: true } : undefined,
    });

  // recálculo con los mismos umbrales (y vuelta mínima aplicada) vs lo guardado
  let same: LapSummary | null = null;
  let best: Candidate[] = [];
  if (tunable && exit < enter) {
    const rc = recalcFromTrace(trace, enter, exit, ctx, laps);
    enforceMinLap(rc, ctx.minLapMs);
    same = summary(rc);
    const now = summary(laps);
    if (same.passes !== now.passes)
      issues.push({
        code: "RECALC_DIFFERS",
        severity: "info",
        msg: `Recalcular desde la traza con los mismos umbrales daría ${same.laps} vueltas (guardadas: ${now.laps}); la traza guardada es más ruidosa que la detección en vivo.`,
      });
  }
  if (tunable && issues.some((x) => x.severity !== "info")) best = scanThresholds(trace, ctx, laps, raceMedianMs ?? ref, { enter, exit });
  // auto_tune solo si el barrido encontró algo plausible; si no, a revisar a mano
  if (!best.length || best[0].score < 2)
    for (const i of issues)
      if (i.fix?.auto_tune) {
        delete i.fix;
        i.msg += " El barrido de umbrales no encontró un resultado plausible: revisar a mano (rh_marshal_trace).";
      }

  return { issues, peaks_unmatched: unmatched, stats: st, recalc_same_thresholds: same, best };
}

/** Serie reducida (máx. n puntos, conservando picos) para ver la traza en texto. */
export function downsample(trace: Trace, fromMs: number, toMs: number, n: number): Array<[number, number]> {
  const idx: number[] = [];
  for (let i = 0; i < trace.t.length; i++) if (trace.t[i] >= fromMs && trace.t[i] <= toMs) idx.push(i);
  if (!idx.length) return [];
  const bucket = Math.max(1, Math.ceil(idx.length / n));
  const outp: Array<[number, number]> = [];
  for (let b = 0; b < idx.length; b += bucket) {
    let best = idx[b];
    for (let j = b; j < Math.min(idx.length, b + bucket); j++) if (trace.v[idx[j]] > trace.v[best]) best = idx[j];
    outp.push([r1(trace.t[best] / 1000), trace.v[best]]);
  }
  return outp;
}
