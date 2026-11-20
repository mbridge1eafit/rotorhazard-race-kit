/**
 * Acceso a carreras guardadas en RotorHazard para marshal (Socket.IO, como la página Marshal)
 * y la lógica compartida de planificar/guardar correcciones por piloto.
 */
import * as z from "zod/v4";
import { rhApi } from "../http.js";
import { loadData, rhRequest } from "../socket.js";
import { getFormats } from "../tools/event.js";
import { type Ctx, enforceMinLap, type Lap, fmtS, median, recalcFromTrace, recompute, scanThresholds, summary, toTrace, type Trace } from "./analysis.js";

export interface RaceListPilot {
  pilotrace_id: number;
  callsign: string | null;
  pilot_id: number;
  node_index: number;
}
interface RaceListRound {
  race_id: number;
  format_id: number;
  start_time: number;
  start_time_formatted: string;
  pilotraces: RaceListPilot[];
}
interface RaceListHeat {
  heat_id: number;
  class_id: number;
  displayname: string;
  rounds: Record<string, RaceListRound>;
}
export interface SavedRace extends RaceListRound {
  heat_id: number;
  heat_name: string;
  class_id: number;
  round: number;
}
export interface PilotRace {
  pilotrace_id: number;
  callsign: string | null;
  pilot_id: number;
  node_index: number;
  laps: Lap[];
  enter_at: number;
  exit_at: number;
  marshal_type: number;
  history_values?: number[];
  history_times?: number[];
}

export const SOURCE: Record<number, string> = { 0: "tiempo real", 1: "manual", 2: "recalculada", 3: "automática", 4: "API" };

/** Carreras guardadas, ordenadas por race_id (autoincremental). start_time es monotónico y se reinicia con el servidor. */
export async function savedRaces(): Promise<SavedRace[]> {
  const ev = await loadData(["race_list"], ["race_list"], 20_000);
  const heats = (ev.race_list as { heats: Record<string, RaceListHeat> }).heats ?? {};
  const outp: SavedRace[] = [];
  for (const h of Object.values(heats)) {
    for (const [rnd, r] of Object.entries(h.rounds)) {
      outp.push({ ...r, heat_id: h.heat_id, heat_name: h.displayname, class_id: h.class_id, round: Number(rnd) });
    }
  }
  return outp.sort((a, b) => a.race_id - b.race_id);
}

export const raceSel = {
  race_id: z.number().int().min(1).optional().describe("Id de la carrera guardada (rh_marshal_list_races). Sin selector = la última carrera guardada"),
  heat_id: z.number().int().min(1).optional().describe("Alternativa a race_id: heat (+ round; sin round = su última ronda)"),
  heat_name: z.string().optional().describe("Alternativa: parte del nombre del heat, p. ej. 'Sab H2' (+ round opcional)"),
  round: z.number().int().min(1).optional(),
};
export type RaceSel = { race_id?: number; heat_id?: number; heat_name?: string; round?: number; callsign?: string };

/** race_id, o heat (id/nombre) + round, o la última carrera en la que voló 'callsign', o la última carrera guardada. */
export async function resolveRace(sel: RaceSel): Promise<SavedRace> {
  const races = await savedRaces();
  if (!races.length) throw new Error("No hay carreras guardadas todavía.");
  let r: SavedRace | undefined;
  const pickRound = (of: SavedRace[]) => (sel.round !== undefined ? of.find((x) => x.round === sel.round) : of[of.length - 1]);
  if (sel.race_id !== undefined) r = races.find((x) => x.race_id === sel.race_id);
  else if (sel.heat_id !== undefined) r = pickRound(races.filter((x) => x.heat_id === sel.heat_id));
  else if (sel.heat_name) {
    const q = sel.heat_name.toLowerCase();
    const of = races.filter((x) => x.heat_name?.toLowerCase().includes(q));
    const names = [...new Set(of.map((x) => `${x.heat_name} (heat ${x.heat_id})`))];
    if (names.length > 1 && !of.some((x) => x.heat_name.toLowerCase() === q))
      throw new Error(`'${sel.heat_name}' coincide con varios heats: ${names.join(", ")}. Sé más concreto o usa heat_id.`);
    const exact = of.filter((x) => x.heat_name.toLowerCase() === q);
    r = pickRound(exact.length ? exact : of);
  } else if (sel.callsign) {
    const q = sel.callsign.toLowerCase();
    r = [...races].reverse().find((x) => x.pilotraces.some((p) => p.callsign?.toLowerCase() === q));
  } else r = races[races.length - 1];
  if (!r) throw new Error("No se encontró esa carrera guardada. Usa rh_marshal_list_races.");
  return r;
}

/** Datos de un piloto en una carrera. Seguro en paralelo: espera el race_details de ese pilotrace_id. */
export async function pilotRace(pilotrace_id: number): Promise<PilotRace> {
  const r = await rhRequest(
    "get_pilotrace",
    { pilotrace_id },
    { timeoutMs: 20_000, until: { name: "race_details", test: (p) => (p as PilotRace)?.pilotrace_id === pilotrace_id } }
  );
  const d = r.events.race_details as PilotRace | undefined;
  if (!d || d.pilotrace_id !== pilotrace_id) throw new Error(`RotorHazard no devolvió los datos del pilotrace ${pilotrace_id}.`);
  return d;
}

export function pickPilot(race: SavedRace, p: { pilotrace_id?: number; node?: number; callsign?: string }): RaceListPilot {
  const found = race.pilotraces.find(
    (x) =>
      (p.pilotrace_id !== undefined && x.pilotrace_id === p.pilotrace_id) ||
      (p.node !== undefined && x.node_index === p.node - 1) ||
      (p.callsign !== undefined && x.callsign?.toLowerCase() === p.callsign.toLowerCase())
  );
  if (!found) throw new Error(`Piloto no encontrado en la carrera ${race.race_id}. Pilotos: ${race.pilotraces.map((x) => `nodo ${x.node_index + 1} ${x.callsign}`).join(", ")}`);
  return found;
}

export interface RaceCtx extends Ctx {
  format_name: string | null;
  start_behavior: number;
}

/** Reglas de la carrera: vuelta mínima, primer cruce mínimo y duración del formato con el que se corrió. */
export async function raceCtx(race: SavedRace): Promise<RaceCtx> {
  const [formats, opts] = await Promise.all([
    getFormats().catch(() => []),
    rhApi<{ options: Record<string, string> | null }>("api/options").then((r) => r.options ?? {}).catch(() => ({}) as Record<string, string>),
  ]);
  const f = formats.find((x) => x.id === race.format_id);
  const num = (k: string) => Number((opts as Record<string, string>)[k] ?? 0) || 0;
  return {
    minLapMs: num("MinLapSec") * 1000,
    minFirstMs: num("MinFirstCrossingSec") * 1000,
    deleteShort: num("MinLapBehavior") !== 0,
    raceTimeMs: f && !f.unlimited_time && f.race_time_sec ? f.race_time_sec * 1000 : null,
    format_name: f?.name ?? null,
    start_behavior: f?.start_behavior ?? 0,
  };
}

export interface LoadedPilot {
  who: RaceListPilot;
  pr: PilotRace;
  laps: Lap[]; // guardadas, ordenadas y con lap_time recalculado
  trace: Trace;
}

/** Carga todos los pilotos (o los indicados) de una carrera en paralelo. */
export async function loadPilots(race: SavedRace, only?: RaceListPilot[]): Promise<LoadedPilot[]> {
  const who = (only ?? race.pilotraces).slice().sort((a, b) => a.node_index - b.node_index);
  return Promise.all(
    who.map(async (w) => {
      const pr = await pilotRace(w.pilotrace_id);
      return { who: w, pr, laps: recompute(pr.laps.map((l) => ({ ...l }))), trace: toTrace(pr.history_values, pr.history_times, race.start_time) };
    })
  );
}

/** Mediana de vuelta de toda la carrera (sin holeshot), referencia para detectar pasadas perdidas. */
export function raceMedian(pilots: LoadedPilot[]): number | null {
  const all: number[] = [];
  for (const p of pilots) all.push(...p.laps.filter((l) => !l.deleted).slice(1).map((l) => l.lap_time));
  return median(all);
}

// ---------------- quién cambió cada vuelta (opcional) ----------------
// Gancho para un plugin que registre quién cambió cada vuelta (no incluido en este repo).
// Sin ese plugin las tablas muestran la fuente nativa de RotorHazard (tiempo real/manual/recalc/API).
export interface OriginEntry {
  l: string; // quién: Manual | <plugin>
  a: string; // añadida, borrada, restaurada, recalculada...
  t?: string;
}
export type PilotOrigins = Record<string, OriginEntry>; // marca en ms (texto) -> entrada
export type RaceOrigins = Record<string, PilotOrigins>; // pilotrace_id -> ...

export async function raceOrigins(_race_id: number): Promise<RaceOrigins> {
  return {};
}

export function originOf(origins: PilotOrigins | undefined, ts: number): OriginEntry | undefined {
  if (!origins) return undefined;
  const k = Object.keys(origins).find((x) => Math.abs(Number(x) - ts) < 2);
  return k ? origins[k] : undefined;
}

/** Origen visible: quién lo cambió (si se conoce) o la fuente nativa de RotorHazard. */
export function originLabel(l: Lap, origins?: PilotOrigins): string {
  const o = originOf(origins, l.lap_time_stamp);
  return o ? `**${o.l}** (${o.a}${o.t ? ` ${o.t}` : ""})` : SOURCE[l.source] ?? String(l.source);
}

export function lapTable(laps: Lap[], origins?: PilotOrigins): string {
  const rows = ["| # | marca (s) | vuelta (s) | origen | pico RSSI | estado |", "|---|---|---|---|---|---|"];
  let n = 0;
  laps.forEach((l, i) => {
    const label = l.deleted ? "borrada" : n++ === 0 ? "holeshot" : `vuelta ${n - 1}`;
    rows.push(`| ${i} | ${fmtS(l.lap_time_stamp)} | ${l.deleted ? "—" : fmtS(l.lap_time)} | ${originLabel(l, origins)} | ${l.peak_rssi ?? ""} | ${label} |`);
  });
  return rows.join("\n");
}

// ---------------- correcciones ----------------
export const pilotEditShape = {
  node: z.number().int().min(1).max(16).optional().describe("Nodo del piloto (1..N)"),
  callsign: z.string().optional(),
  pilotrace_id: z.number().int().optional(),
  enter_at: z.number().int().min(0).max(255).optional().describe("Nuevo EnterAt para esta carrera"),
  exit_at: z.number().int().min(0).max(255).optional().describe("Nuevo ExitAt para esta carrera"),
  recalc: z.boolean().default(false).describe("Recalcular las vueltas desde la traza RSSI con los umbrales (nuevos o guardados); conserva manuales/API"),
  auto_tune: z.boolean().default(false).describe("Elegir automáticamente los mejores EnterAt/ExitAt para la traza y recalcular (implica recalc)"),
  enforce_min_lap: z.boolean().default(true).describe("Con recalc/auto_tune: borrar pasos a menos de la vuelta mínima (conserva el de mayor pico)"),
  delete: z.array(z.number().int().min(0)).default([]).describe("Índices '#' a borrar (si hay recalc, índices de la lista recalculada)"),
  restore: z.array(z.number().int().min(0)).default([]),
  add_at_s: z.array(z.number().min(0)).default([]).describe("Segundos desde el inicio donde añadir pasos manuales"),
  purge_deleted: z.boolean().default(false),
};
export const pilotEdit = z.object(pilotEditShape);
export type PilotEdit = z.infer<typeof pilotEdit>;

export interface EditPlan {
  who: RaceListPilot;
  pr: PilotRace;
  before: Lap[];
  after: Lap[];
  enter_at: number;
  exit_at: number;
  notes: string[];
}

export function planEdit(race: SavedRace, ctx: Ctx, refMs: number | null, p: LoadedPilot, e: PilotEdit): EditPlan {
  const notes: string[] = [];
  let enter = e.enter_at ?? p.pr.enter_at;
  let exit = e.exit_at ?? p.pr.exit_at;
  let laps = p.laps.map((l) => ({ ...l }));
  if (e.auto_tune) {
    if (!p.trace.v.length) throw new Error(`${p.who.callsign}: no hay traza RSSI guardada para auto_tune.`);
    const best = scanThresholds(p.trace, ctx, p.laps, refMs, { enter: p.pr.enter_at, exit: p.pr.exit_at }, 1)[0];
    if (!best) throw new Error(`${p.who.callsign}: la traza no tiene señal suficiente para elegir umbrales.`);
    enter = best.enter_at;
    exit = best.exit_at;
    notes.push(`auto_tune → EnterAt ${enter} / ExitAt ${exit} (${best.laps} vueltas, ${best.short} cortas, ${best.long} largas)`);
  }
  if (exit >= enter) throw new Error(`${p.who.callsign}: ExitAt (${exit}) debe ser menor que EnterAt (${enter}).`);
  if (e.recalc || e.auto_tune) {
    if (!p.trace.v.length) throw new Error(`${p.who.callsign}: no hay traza RSSI guardada para recalcular.`);
    laps = recalcFromTrace(p.trace, enter, exit, ctx, p.laps);
    if (e.enforce_min_lap) {
      const n = enforceMinLap(laps, ctx.minLapMs);
      if (n) notes.push(`${n} paso(s) a menos de la vuelta mínima (${ctx.minLapMs / 1000}s) borrados (se conserva el de mayor pico).`);
    }
  } else if (e.enter_at !== undefined || e.exit_at !== undefined) {
    notes.push("Umbrales cambiados sin recalc: las vueltas no se recalculan (añade recalc=true para hacerlo).");
  }
  for (const i of [...e.delete, ...e.restore]) if (!laps[i]) throw new Error(`${p.who.callsign}: índice ${i} fuera de rango (0..${laps.length - 1}).`);
  for (const i of e.delete) laps[i].deleted = true;
  for (const i of e.restore) laps[i].deleted = false;
  for (const s of e.add_at_s) laps.push({ lap_time_stamp: Math.round(s * 1000), lap_time: 0, source: 1, deleted: false, peak_rssi: null });
  const after = recompute(e.purge_deleted ? laps.filter((l) => !l.deleted) : laps);
  return { who: p.who, pr: p.pr, before: p.laps, after, enter_at: enter, exit_at: exit, notes };
}

export function planReport(race: SavedRace, pl: EditPlan, withTable = true, origins?: RaceOrigins): string {
  const b = summary(pl.before);
  const a = summary(pl.after);
  const thr = pl.enter_at !== pl.pr.enter_at || pl.exit_at !== pl.pr.exit_at ? ` · umbrales ${pl.pr.enter_at}/${pl.pr.exit_at} → ${pl.enter_at}/${pl.exit_at}` : "";
  return (
    `### Nodo ${pl.who.node_index + 1} · ${pl.who.callsign}\n` +
    `Vueltas ${b.laps} → **${a.laps}** · rápida ${b.fastest_s ?? "—"} → ${a.fastest_s ?? "—"} s · total ${b.total_s ?? "—"} → ${a.total_s ?? "—"} s${thr}` +
    (pl.notes.length ? `\n${pl.notes.map((n) => `- ${n}`).join("\n")}` : "") +
    (withTable ? `\n\n${lapTable(pl.after, origins?.[String(pl.who.pilotrace_id)])}` : "")
  );
}

/** Guarda una corrección (resave_laps, igual que 'Save Laps' de la página Marshal) y verifica. */
export async function saveEdit(race: SavedRace, pl: EditPlan): Promise<{ check: ReturnType<typeof summary>; messages: string[] }> {
  const r = await rhRequest(
    "resave_laps",
    {
      heat_id: race.heat_id,
      round_id: race.round,
      callsign: pl.who.callsign,
      race_id: race.race_id,
      pilotrace_id: pl.who.pilotrace_id,
      seat: pl.who.node_index,
      pilot_id: pl.who.pilot_id,
      enter_at: pl.enter_at,
      exit_at: pl.exit_at,
      laps: pl.after.map((l) => ({ lap_time_stamp: l.lap_time_stamp, lap_time: l.lap_time, source: l.source, deleted: l.deleted, peak_rssi: l.peak_rssi ?? null })),
    },
    { finishOnMessage: true, timeoutMs: 20_000 }
  );
  const check = summary(recompute((await pilotRace(pl.who.pilotrace_id)).laps));
  return { check, messages: r.messages };
}

export function hasEdit(e: PilotEdit): boolean {
  return e.recalc || e.auto_tune || e.purge_deleted || e.delete.length > 0 || e.restore.length > 0 || e.add_at_s.length > 0 || e.enter_at !== undefined || e.exit_at !== undefined;
}
