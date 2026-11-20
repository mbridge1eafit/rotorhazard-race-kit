/**
 * Marshal de carreras guardadas.
 *  - Nativo (sin plugins): mismo flujo que la página Marshal de RotorHazard
 *    (get_pilotrace -> editar vueltas/umbrales/recalcular desde la traza RSSI -> resave_laps),
 *    más revisión automática (rh_marshal_review) y correcciones en lote (rh_marshal_fix).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { rhApi } from "../http.js";
import { downsample, diagnose, findPeaks, fmtS, type Issue, peakLevels, recalcFromTrace, summary, traceStats } from "../marshal/analysis.js";
import {
  lapTable,
  type LoadedPilot,
  loadPilots,
  pickPilot,
  pilotEdit,
  pilotEditShape,
  planEdit,
  planReport,
  raceCtx,
  raceMedian,
  raceOrigins,
  type RaceListPilot,
  raceSel,
  resolveRace,
  saveEdit,
  type SavedRace,
  savedRaces,
} from "../marshal/rh.js";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, out, responseFormat, text } from "../util.js";
import { RO, W, W_DESTRUCTIVE, W_IDEMPOTENT } from "./annotations.js";

/** Junta las correcciones sugeridas de los problemas (warn/error) de un piloto en una entrada para rh_marshal_fix. */
function proposeFix(p: LoadedPilot, issues: Issue[]): Record<string, unknown> | null {
  const act = issues.filter((i) => i.severity !== "info" && i.fix);
  if (!act.length) return null;
  const base = { node: p.who.node_index + 1, callsign: p.who.callsign ?? undefined };
  // si la calibración está rota, recalcular con umbrales nuevos invalida los índices: solo auto_tune
  if (act.some((i) => i.fix!.auto_tune)) return { ...base, auto_tune: true };
  const del = new Set<number>();
  const add = new Set<number>();
  for (const i of act) {
    for (const x of (i.fix!.delete as number[] | undefined) ?? []) del.add(x);
    for (const x of (i.fix!.add_at_s as number[] | undefined) ?? []) add.add(x);
  }
  if (!del.size && !add.size) return null;
  return { ...base, ...(del.size ? { delete: [...del].sort((a, b) => a - b) } : {}), ...(add.size ? { add_at_s: [...add].sort((a, b) => a - b) } : {}) };
}

export function registerMarshalTools(server: McpServer): void {
  // ======================= NATIVO =======================
  server.registerTool(
    "rh_marshal_list_races",
    {
      title: "Carreras guardadas",
      description: "Lista las carreras guardadas (más recientes primero) con race_id, heat, ronda, hora y pilotos. Filtra por heat_id, heat_name o callsign.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).default(10),
        heat_id: z.number().int().optional(),
        heat_name: z.string().optional().describe("Parte del nombre del heat"),
        callsign: z.string().optional().describe("Solo carreras en las que voló este piloto"),
        response_format: responseFormat,
      }),
      annotations: RO,
    },
    async ({ limit, heat_id, heat_name, callsign, response_format }) => {
      let races = (await savedRaces()).reverse();
      if (heat_id !== undefined) races = races.filter((r) => r.heat_id === heat_id);
      if (heat_name) races = races.filter((r) => r.heat_name?.toLowerCase().includes(heat_name.toLowerCase()));
      if (callsign) races = races.filter((r) => r.pilotraces.some((p) => p.callsign?.toLowerCase() === callsign.toLowerCase()));
      races = races.slice(0, limit);
      return out(response_format, { races }, () =>
        races.length
          ? races
              .map(
                (r) =>
                  `- **race_id ${r.race_id}** · ${r.heat_name} (heat ${r.heat_id}) ronda ${r.round} · ${r.start_time_formatted}\n  ` +
                  r.pilotraces.map((p) => `nodo ${p.node_index + 1}: ${p.callsign ?? p.pilot_id}`).join(" · ")
              )
              .join("\n")
          : "No hay carreras guardadas con ese filtro."
      );
    }
  );

  server.registerTool(
    "rh_marshal_review",
    {
      title: "Revisión rápida de marshal",
      description: `PUNTO DE PARTIDA para hacer marshal. En una sola llamada carga todos los pilotos de una carrera guardada (en paralelo),
analiza vueltas y traza RSSI y devuelve por piloto: vueltas, rápida, mediana, umbrales, ruido/pico RSSI y problemas detectados:
vueltas cortas (doble cruce/ruido, según la vuelta mínima o <55% de la mediana), vueltas largas (pasada perdida, con los picos sin registrar),
holeshot perdido, pasos tras el final, umbrales en el ruido o por encima del máximo, piloto 1.7× más lento que la carrera, etc.
Para pilotos con problemas propone umbrales EnterAt/ExitAt alternativos (barrido sobre la traza) y al final un ARREGLO PROPUESTO
listo para pasar a rh_marshal_fix. No escribe nada.
Selección: sin argumentos = última carrera guardada; o race_id; o heat_id/heat_name (+ round); o callsign = última carrera de ese piloto.`,
      inputSchema: z.object({
        ...raceSel,
        callsign: z.string().optional().describe("Sin otro selector: la última carrera de este piloto. Siempre: limita la revisión a ese piloto"),
        node: z.number().int().min(1).max(16).optional().describe("Limitar la revisión a un nodo"),
        show_laps: z.enum(["none", "issues", "all"]).default("issues").describe("Tabla de pasos: ninguno, solo pilotos con problemas (defecto) o todos"),
        response_format: responseFormat,
      }),
      annotations: RO,
    },
    async (a) => {
      const race = await resolveRace(a);
      const [ctx, pilots, st, origins] = await Promise.all([
        raceCtx(race),
        loadPilots(race),
        loadData(["race_status"], ["race_status"]).catch(() => ({})),
        raceOrigins(race.race_id),
      ]);
      const ref = raceMedian(pilots);
      const focus = pilots.filter(
        (p) => (a.node === undefined || p.who.node_index === a.node - 1) && (a.callsign === undefined || p.who.callsign?.toLowerCase() === a.callsign.toLowerCase())
      );
      if (!focus.length) throw new Error(`Ese piloto/nodo no está en la carrera ${race.race_id}.`);
      const rows = focus.map((p) => {
        const d = diagnose(p.laps, p.trace, p.pr.enter_at, p.pr.exit_at, ctx, ref);
        return { p, d, s: summary(p.laps), fix: proposeFix(p, d.issues) };
      });
      const raceStatus = (st as { race_status?: { race_status?: number } }).race_status?.race_status;
      const fixes = rows.filter((r) => r.fix).map((r) => r.fix!);
      const data = {
        race: { race_id: race.race_id, heat_id: race.heat_id, heat: race.heat_name, round: race.round, start: race.start_time_formatted, format: ctx.format_name },
        rules: { min_lap_s: ctx.minLapMs / 1000, min_first_crossing_s: ctx.minFirstMs / 1000, race_time_s: ctx.raceTimeMs ? ctx.raceTimeMs / 1000 : null, delete_short_on_recalc: ctx.deleteShort },
        race_median_s: ref !== null ? Number(fmtS(ref)) : null,
        unsaved_race_pending: raceStatus === 2,
        pilots: rows.map(({ p, d, s }) => ({
          node: p.who.node_index + 1,
          callsign: p.who.callsign,
          pilotrace_id: p.who.pilotrace_id,
          enter_at: p.pr.enter_at,
          exit_at: p.pr.exit_at,
          summary: s,
          rssi: d.stats,
          issues: d.issues,
          unmatched_peaks: d.peaks_unmatched,
          recalc_same_thresholds: d.recalc_same_thresholds,
          threshold_candidates: d.best,
          laps: p.laps,
          origins: origins[String(p.who.pilotrace_id)] ?? {},
        })),
        proposed_fix: fixes.length ? { race_id: race.race_id, pilots: fixes } : null,
      };
      return out(a.response_format, data, () => {
        const L: string[] = [
          `# Marshal · ${race.heat_name} ronda ${race.round} (race_id ${race.race_id}) · ${race.start_time_formatted}`,
          `Formato: ${ctx.format_name ?? `id ${race.format_id}`} · ${ctx.raceTimeMs ? `${ctx.raceTimeMs / 1000}s` : "sin límite"} · vuelta mínima ${ctx.minLapMs / 1000}s` +
            `${ctx.minFirstMs ? ` · primer cruce ≥ ${ctx.minFirstMs / 1000}s` : ""} · mediana de la carrera ${ref !== null ? fmtS(ref) + "s" : "—"}`,
        ];
        if (raceStatus === 2) L.push("\n> ⚠ Hay una carrera terminada SIN GUARDAR en el timer (estado DONE): no aparece aquí hasta guardarla (rh_save_laps).");
        L.push("", "| Nodo | Piloto | Vueltas | Rápida | Mediana | Total | Enter/Exit | RSSI piso–máx | Estado |", "|---|---|---|---|---|---|---|---|---|");
        for (const { p, d, s } of rows) {
          const errs = d.issues.filter((x) => x.severity === "error").length;
          const warns = d.issues.filter((x) => x.severity === "warn").length;
          const state = errs ? `❌ ${errs + warns} problema(s)` : warns ? `⚠ ${warns} aviso(s)` : "✅ OK";
          L.push(
            `| ${p.who.node_index + 1} | ${p.who.callsign} | ${s.laps} | ${s.fastest_s ?? "—"} | ${s.median_s ?? "—"} | ${s.total_s ?? "—"} | ${p.pr.enter_at}/${p.pr.exit_at} | ${d.stats ? `${d.stats.floor}–${d.stats.max}` : "sin traza"} | ${state} |`
          );
        }
        for (const { p, d, fix } of rows) {
          const relevant = d.issues;
          const showTable = a.show_laps === "all" || (a.show_laps === "issues" && relevant.some((x) => x.severity !== "info"));
          if (!relevant.length && !showTable) continue;
          L.push("", `## Nodo ${p.who.node_index + 1} · ${p.who.callsign} (pilotrace ${p.who.pilotrace_id})`);
          for (const i of relevant) L.push(`- ${i.severity === "error" ? "❌" : i.severity === "warn" ? "⚠" : "ℹ"} **${i.code}**: ${i.msg}`);
          if (d.best.length)
            L.push(`- Umbrales candidatos: ${d.best.map((c) => `${c.enter_at}/${c.exit_at} → ${c.laps} vueltas (${c.short} cortas, ${c.long} largas, mediana ${c.median_s ?? "—"}s)`).join(" · ")}`);
          if (fix) L.push(`- Arreglo sugerido: \`${JSON.stringify(fix)}\``);
          if (showTable) L.push("", lapTable(p.laps, origins[String(p.who.pilotrace_id)]));
        }
        L.push(
          "",
          fixes.length
            ? `## Arreglo propuesto\nRevísalo (el criterio final es tuyo) y pruébalo con rh_marshal_fix (dry_run por defecto):\n\`\`\`json\n${JSON.stringify({ race_id: race.race_id, pilots: fixes })}\n\`\`\``
            : "## Sin arreglos automáticos propuestos"
        );
        return L.join("\n");
      });
    }
  );

  server.registerTool(
    "rh_marshal_fix",
    {
      title: "Aplicar correcciones de marshal (lote)",
      description: `Corrige varios pilotos de una carrera guardada en una sola llamada. Por piloto (node/callsign/pilotrace_id):
- enter_at/exit_at + recalc=true: recalcula las vueltas desde la traza RSSI con esos umbrales (como la página Marshal); conserva pasos manuales/API
- auto_tune=true: elige los mejores umbrales para la traza y recalcula
- delete / restore: índices '#' (de rh_marshal_review / rh_marshal_get_race; si hay recalc, de la lista recalculada → míralo antes en dry_run)
- add_at_s: añadir pasos manuales (s desde el inicio) · purge_deleted: eliminar definitivamente los borrados
dry_run=true (DEFECTO) muestra antes/después sin guardar. Con dry_run=false guarda cada piloto (resave_laps) y verifica en el servidor.
Cambia resultados oficiales (y Cloudlink/MultiGP si están activos): confirma con el usuario antes de dry_run=false.`,
      inputSchema: z.object({
        ...raceSel,
        pilots: z.array(pilotEdit).min(1).describe("Correcciones por piloto"),
        dry_run: z.boolean().default(true),
        show_laps: z.boolean().default(true).describe("Incluir la tabla de pasos resultante por piloto"),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async (a) => {
      const race = await resolveRace(a);
      for (const e of a.pilots) if (e.node === undefined && e.callsign === undefined && e.pilotrace_id === undefined) throw new Error("Cada piloto necesita node, callsign o pilotrace_id.");
      const targets = a.pilots.map((e) => pickPilot(race, e));
      const dup = targets.find((t, i) => targets.findIndex((x) => x.pilotrace_id === t.pilotrace_id) !== i);
      if (dup) throw new Error(`${dup.callsign} aparece dos veces: junta sus correcciones en una sola entrada.`);
      const [ctx, all, origins] = await Promise.all([raceCtx(race), loadPilots(race), raceOrigins(race.race_id)]);
      const ref = raceMedian(all);
      const plans = a.pilots.map((e, i) => planEdit(race, ctx, ref, all.find((p) => p.who.pilotrace_id === targets[i].pilotrace_id)!, e));
      const head = `${race.heat_name} ronda ${race.round} (race_id ${race.race_id})`;
      if (a.dry_run)
        return text(`VISTA PREVIA (no guardado) · ${head}\n\n${plans.map((p) => planReport(race, p, a.show_laps, origins)).join("\n\n")}\n\nPara guardar: misma llamada con dry_run=false.`);
      const res: string[] = [];
      for (const pl of plans) {
        const { check, messages } = await saveEdit(race, pl);
        res.push(`- Nodo ${pl.who.node_index + 1} ${pl.who.callsign}: GUARDADO · verificado ${check.laps} vueltas, rápida ${check.fastest_s ?? "—"} s, total ${check.total_s ?? "—"} s${msgs(messages)}`);
      }
      const saved = await raceOrigins(race.race_id);
      return text(`GUARDADO · ${head}\n${res.join("\n")}\n\n${plans.map((p) => planReport(race, p, a.show_laps, saved)).join("\n\n")}`);
    }
  );

  server.registerTool(
    "rh_marshal_trace",
    {
      title: "Ver traza RSSI de un piloto",
      description: `Muestra la traza RSSI guardada de un piloto en texto compacto: ruido/máximo, picos detectados (s, RSSI, ancho) marcando si tienen
paso registrado, y una serie reducida "t:rssi" (conserva los máximos) en una ventana [from_s, to_s]. Con enter_at/exit_at simula qué vueltas
saldrían con esos umbrales (sin guardar). Útil para decidir un add_at_s o unos umbrales a mano.`,
      inputSchema: z.object({
        ...raceSel,
        node: z.number().int().min(1).max(16).optional(),
        callsign: z.string().optional(),
        from_s: z.number().min(0).optional(),
        to_s: z.number().min(0).optional(),
        points: z.number().int().min(20).max(600).default(150).describe("Puntos de la serie reducida"),
        enter_at: z.number().int().min(0).max(255).optional().describe("Simular con este EnterAt"),
        exit_at: z.number().int().min(0).max(255).optional().describe("Simular con este ExitAt"),
        response_format: responseFormat,
      }),
      annotations: RO,
    },
    async (a) => {
      if (a.node === undefined && a.callsign === undefined) throw new Error("Indica node o callsign.");
      const race = await resolveRace({ ...a, callsign: a.race_id || a.heat_id || a.heat_name ? undefined : a.callsign });
      const who = pickPilot(race, a);
      const [ctx, [p]] = await Promise.all([raceCtx(race), loadPilots(race, [who])]);
      const st = traceStats(p.trace);
      if (!st) return text(`${who.callsign}: sin traza RSSI guardada (marshal_type ${p.pr.marshal_type}).`);
      const enter = a.enter_at ?? p.pr.enter_at;
      const exit = a.exit_at ?? p.pr.exit_at;
      const lv = peakLevels(st, enter);
      const peaks = findPeaks(p.trace, lv.hi, lv.lo).map((k) => ({
        ...k,
        pass: p.laps.some((l) => !l.deleted && Math.abs(l.lap_time_stamp - k.t_s * 1000) < 800),
      }));
      const from = (a.from_s ?? 0) * 1000;
      const to = (a.to_s ?? st.duration_s + 5) * 1000;
      const series = downsample(p.trace, from, to, a.points);
      const sim = a.enter_at !== undefined || a.exit_at !== undefined;
      if (sim && exit >= enter) throw new Error(`ExitAt (${exit}) debe ser menor que EnterAt (${enter}).`);
      const simLaps = sim ? recalcFromTrace(p.trace, enter, exit, ctx, p.laps) : null;
      const data = { race_id: race.race_id, node: who.node_index + 1, callsign: who.callsign, enter_at: p.pr.enter_at, exit_at: p.pr.exit_at, stats: st, peaks, series, simulation: simLaps ? { enter_at: enter, exit_at: exit, summary: summary(simLaps), laps: simLaps } : null };
      return out(a.response_format, data, () =>
        [
          `# Traza RSSI · nodo ${who.node_index + 1} ${who.callsign} · race_id ${race.race_id}`,
          `Guardado EnterAt ${p.pr.enter_at} / ExitAt ${p.pr.exit_at} · ruido ≈ ${st.floor} · mediana ${st.p50} · máx ${st.max} · ${st.samples} muestras en ${st.duration_s}s`,
          `\n## Picos (✓ = tiene paso activo)\n${peaks.map((k) => `${k.pass ? "✓" : "✗"} ${k.t_s}s:${k.rssi}${k.width_s ? ` (${k.width_s}s)` : ""}`).join(" · ") || "ninguno"}`,
          `\n## Serie ${fmtS(from)}–${fmtS(Math.min(to, st.duration_s * 1000))}s (t:rssi)\n${series.map(([t, v]) => `${t}:${v}`).join(" ")}`,
          simLaps ? `\n## Simulación ${enter}/${exit} → ${JSON.stringify(summary(simLaps))}\n\n${lapTable(simLaps)}` : "",
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_marshal_get_race",
    {
      title: "Ver carrera guardada (marshal)",
      description: `Muestra una carrera guardada como en la página Marshal: por piloto, EnterAt/ExitAt guardados y cada paso con índice, marca de tiempo,
tiempo de vuelta, origen (tiempo real/manual/recalculada/API), pico RSSI y si está borrado. Sin argumentos = la última carrera guardada.
Los índices '#' son los que usan rh_marshal_fix / rh_marshal_edit_laps. Para revisar problemas usa mejor rh_marshal_review.`,
      inputSchema: z.object({
        ...raceSel,
        node: z.number().int().min(1).max(16).optional(),
        callsign: z.string().optional().describe("Filtra el piloto (y sin otro selector: su última carrera)"),
        response_format: responseFormat,
      }),
      annotations: RO,
    },
    async (a) => {
      const race = await resolveRace(a);
      const only = a.node !== undefined || a.callsign !== undefined ? [pickPilot(race, a)] : undefined;
      const [pilots, origins] = await Promise.all([loadPilots(race, only), raceOrigins(race.race_id)]);
      const details = pilots.map(({ pr, laps, trace }) => {
        const st = traceStats(trace);
        const { history_values: _hv, history_times: _ht, ...rest } = pr;
        return { ...rest, laps, origins: origins[String(pr.pilotrace_id)] ?? {}, summary: summary(laps), ...(st ? { rssi_min: Math.min(...trace.v), rssi_max: st.max } : {}) };
      });
      const data = { race_id: race.race_id, heat_id: race.heat_id, heat: race.heat_name, round: race.round, start: race.start_time_formatted, pilots: details };
      return out(a.response_format, data, () =>
        [
          `# Marshal · ${race.heat_name} ronda ${race.round} (race_id ${race.race_id}) · ${race.start_time_formatted}`,
          ...details.map(
            (x) =>
              `\n## Nodo ${x.node_index + 1} · ${x.callsign} (pilotrace ${x.pilotrace_id})\n` +
              `EnterAt ${x.enter_at} · ExitAt ${x.exit_at}${x.rssi_min !== undefined ? ` · RSSI traza ${x.rssi_min}–${x.rssi_max}` : ""} · ` +
              `${x.summary.laps} vueltas, rápida ${x.summary.fastest_s ?? "—"} s, total ${x.summary.total_s ?? "—"} s\n\n${lapTable(x.laps, x.origins)}`
          ),
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_marshal_edit_laps",
    {
      title: "Corregir vueltas de un piloto",
      description: `Marshal de UN piloto en una carrera guardada (para varios a la vez usa rh_marshal_fix):
- delete / restore: índices de pasos (de rh_marshal_get_race / rh_marshal_review)
- add_at_s: marcas (s desde el inicio) donde añadir pasos manuales, p. ej. holeshot perdido
- enter_at / exit_at: umbrales de esa carrera; con recalc=true se recalculan las vueltas desde la traza RSSI
- auto_tune: elegir umbrales automáticamente y recalcular · purge_deleted: eliminar definitivamente los borrados
Guarda (resave_laps) y RotorHazard recalcula resultados. Sin selector = última carrera. dry_run=true solo muestra el antes/después.
Cambia resultados oficiales: confirma con el usuario.`,
      inputSchema: z.object({ ...raceSel, ...pilotEditShape, dry_run: z.boolean().default(false) }),
      annotations: W_DESTRUCTIVE,
    },
    async (a) => {
      if (a.node === undefined && a.callsign === undefined && a.pilotrace_id === undefined) throw new Error("Indica node, callsign o pilotrace_id.");
      const race = await resolveRace(a);
      const who = pickPilot(race, a);
      const needAll = a.auto_tune; // la mediana de la carrera solo hace falta para auto_tune
      const [ctx, all] = await Promise.all([raceCtx(race), loadPilots(race, needAll ? undefined : [who])]);
      const p = all.find((x) => x.who.pilotrace_id === who.pilotrace_id)!;
      const pl = planEdit(race, ctx, needAll ? raceMedian(all) : null, p, a);
      const head = `${race.heat_name} ronda ${race.round} (race_id ${race.race_id})`;
      if (a.dry_run) return text(`VISTA PREVIA (no guardado) · ${head}\n\n${planReport(race, pl)}`);
      const { check, messages } = await saveEdit(race, pl);
      return text(`GUARDADO · ${head}. Verificado en el servidor: ${JSON.stringify(check)}${msgs(messages)}\n\n${planReport(race, pl)}`);
    }
  );

  server.registerTool(
    "rh_marshal_reassign_heat",
    {
      title: "Mover carrera a otro heat",
      description: "Reasigna una carrera guardada a otro heat (p. ej. se corrió con el heat equivocado seleccionado). Cambia resultados: confirma con el usuario.",
      inputSchema: z.object({ race_id: z.number().int().min(1), heat_id: z.number().int().min(1).describe("Heat destino") }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ race_id, heat_id }) => {
      const r = await rhRequest("alter_race", { race_id, heat_id }, { finishOnMessage: true, timeoutMs: 15_000 });
      return text(`Carrera ${race_id} → heat ${heat_id}.${msgs(r.messages)}`);
    }
  );
}
