import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { rhApi } from "../http.js";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, out, RACE_STATUS, responseFormat, text } from "../util.js";
import { RO, W, W_DESTRUCTIVE, W_IDEMPOTENT } from "./annotations.js";

type Row = Record<string, unknown>;
interface Leaderboard {
  meta?: { primary_leaderboard?: string };
  [k: string]: unknown;
}

/** Convierte un leaderboard de RotorHazard en tabla markdown. */
export function leaderboardTable(lb: Leaderboard | null | undefined, title = "Clasificación"): string {
  if (!lb) return "_(sin datos)_";
  const key = lb.meta?.primary_leaderboard ?? Object.keys(lb).find((k) => Array.isArray(lb[k]));
  const rows = (key ? (lb[key] as Row[]) : []) ?? [];
  if (!rows.length) return `### ${title}\n_(sin vueltas registradas)_`;
  const lines = [
    `### ${title} (${key})`,
    "| Pos | Piloto | Vueltas | Tiempo total | Vuelta rápida | Consecutivas | Última |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.position ?? ""} | ${r.callsign ?? ""} | ${r.laps ?? ""} | ${r.total_time ?? ""} | ${r.fastest_lap ?? ""} | ${r.consecutives ?? ""}${r.consecutives_base ? ` (${r.consecutives_base})` : ""} | ${r.last_lap ?? ""} |`
    );
  }
  return lines.join("\n");
}

async function raceStatus(): Promise<{ race_status: number; race_heat_id: number; race_format_id: number }> {
  const ev = await loadData(["race_status"], ["race_status"]);
  return ev.race_status as { race_status: number; race_heat_id: number; race_format_id: number };
}

export function registerRaceTools(server: McpServer): void {
  server.registerTool(
    "rh_get_current_race",
    {
      title: "Carrera actual",
      description: "Estado de la carrera en curso: estado (READY/STAGING/RACING/DONE), heat, ronda, clasificación en vivo y la de la última carrera.",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }) => {
      const ev = await loadData(["race_status", "leaderboard"], ["race_status", "leaderboard"]);
      const st = ev.race_status as Row;
      const lb = ev.leaderboard as { current: Row & { leaderboard: Leaderboard }; last_race?: Row & { leaderboard: Leaderboard } };
      return out(response_format, ev, () =>
        [
          `# Carrera actual: ${lb.current.displayname ?? "Práctica"} · ronda ${lb.current.round ?? "—"}`,
          `- Estado: **${RACE_STATUS[st.race_status as number] ?? st.race_status}**`,
          `- Formato id: ${st.race_format_id} · ${st.unlimited_time ? "sin límite" : `${st.race_time_sec}s`}`,
          lb.current.status_msg ? `- Mensaje: ${lb.current.status_msg}` : "",
          "",
          leaderboardTable(lb.current.leaderboard, "En vivo"),
          lb.last_race ? `\n${leaderboardTable(lb.last_race.leaderboard, `Última carrera: ${lb.last_race.displayname} ronda ${lb.last_race.round}`)}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  );

  server.registerTool(
    "rh_set_current_heat",
    {
      title: "Seleccionar heat",
      description: "Selecciona el heat que se correrá a continuación (0 = práctica). Solo con la carrera en READY.",
      inputSchema: z.object({ heat_id: z.number().int().min(0) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ heat_id }) => {
      const r = await rhRequest("set_current_heat", { heat: heat_id }, { waitFor: ["race_status"], requireAll: true });
      const st = r.events.race_status as { race_heat_id: number };
      return text(`Heat actual: ${st.race_heat_id}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_stage_race",
    {
      title: "Iniciar carrera (staging)",
      description: `Inicia la secuencia de salida de la carrera (staging + tonos + start), como el botón 'Start Race'.
Requiere estado READY (si hay laps sin guardar, guarda o descarta primero). ¡Los pilotos deben estar listos!`,
      inputSchema: z.object({}),
      annotations: W,
    },
    async () => {
      const before = await raceStatus();
      if (before.race_status !== 0) throw new Error(`La carrera no está en READY (estado: ${RACE_STATUS[before.race_status]}). Usa rh_save_laps o rh_discard_laps primero.`);
      const r = await rhRequest("stage_race", {}, { waitFor: ["stage_ready"], timeoutMs: 6000 });
      return text(r.missing.length ? `El servidor no inició el staging.${msgs(r.messages)}` : `Carrera en staging (heat ${before.race_heat_id}).${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_stop_race",
    {
      title: "Detener carrera",
      description: "Detiene la carrera en curso (como 'Stop Race'). Luego guarda (rh_save_laps) o descarta (rh_discard_laps).",
      inputSchema: z.object({}),
      annotations: W,
    },
    async () => {
      const r = await rhRequest("stop_race", {}, { waitFor: ["stop_timer"], timeoutMs: 5000 });
      return text(`Orden de parada enviada.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_save_laps",
    {
      title: "Guardar carrera",
      description: "Guarda las vueltas de la carrera terminada en la base de datos (resultados oficiales) y prepara la siguiente.",
      inputSchema: z.object({}),
      annotations: W,
    },
    async () => {
      // Sin payload: el servidor hace race.save(*args) y save() no acepta argumentos.
      const r = await rhRequest("save_laps", undefined, { waitFor: ["race_saved"], timeoutMs: 15000 });
      return text(r.missing.length ? `No hubo confirmación de guardado (¿la carrera estaba detenida?).${msgs(r.messages)}` : `Carrera guardada.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_discard_laps",
    {
      title: "Descartar carrera",
      description: "Descarta las vueltas de la carrera actual sin guardarlas. Irreversible: confirma con el usuario.",
      inputSchema: z.object({}),
      annotations: W_DESTRUCTIVE,
    },
    async () => {
      // Sin payload: on_discard_laps(**kwargs) falla con un argumento posicional.
      const r = await rhRequest("discard_laps", undefined, { waitFor: ["race_status"], timeoutMs: 5000 });
      return text(`Laps descartados.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_schedule_race",
    {
      title: "Programar inicio de carrera",
      description: "Programa el inicio automático de la carrera dentro de minutos/segundos. cancel=true cancela la programación.",
      inputSchema: z.object({
        minutes: z.number().int().min(0).max(120).default(0),
        seconds: z.number().int().min(0).max(59).default(0),
        cancel: z.boolean().default(false),
      }),
      annotations: W,
    },
    async ({ minutes, seconds, cancel }) => {
      if (cancel) {
        const r = await rhRequest("cancel_schedule_race", {}, { waitFor: ["race_scheduled"], timeoutMs: 4000 });
        return text(`Programación cancelada.${msgs(r.messages)}`);
      }
      if (!minutes && !seconds) throw new Error("Indica minutes y/o seconds > 0.");
      const r = await rhRequest("schedule_race", { m: minutes, s: seconds }, { waitFor: ["race_scheduled"], timeoutMs: 4000 });
      return json({ scheduled: r.events.race_scheduled ?? null, messages: r.messages });
    }
  );

  server.registerTool(
    "rh_delete_lap",
    {
      title: "Borrar vuelta (carrera actual)",
      description: "Marca como borrada una vuelta de la carrera actual (p. ej. falso positivo). node 1..N, lap_index empieza en 0 (0 = paso de salida/holeshot).",
      inputSchema: z.object({ node: z.number().int().min(1).max(16), lap_index: z.number().int().min(0) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ node, lap_index }) => {
      const r = await rhRequest("delete_lap", { node: node - 1, lap_index }, { waitFor: ["current_laps"], timeoutMs: 4000 });
      return text(`Vuelta ${lap_index} del nodo ${node} borrada.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_simulate_lap",
    {
      title: "Simular paso",
      description: "Registra un paso manual en un nodo (añadir vuelta perdida o probar el sistema). Solo durante una carrera.",
      inputSchema: z.object({ node: z.number().int().min(1).max(16) }),
      annotations: W,
    },
    async ({ node }) => {
      const r = await rhRequest("simulate_lap", { node: node - 1 }, { settleMs: 800 });
      return text(`Paso simulado en nodo ${node}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_broadcast_message",
    {
      title: "Mensaje a todas las pantallas",
      description: "Muestra un mensaje en todas las páginas abiertas de RotorHazard (y lo anuncia por voz si está activado). interrupt=true lo muestra como alerta.",
      inputSchema: z.object({ message: z.string().min(1).max(300), interrupt: z.boolean().default(false) }),
      annotations: W,
    },
    async ({ message, interrupt }) => {
      await rhRequest("broadcast_message", { message, interrupt }, { settleMs: 500 });
      return text("Mensaje enviado.");
    }
  );

  // ======================= RESULTADOS =======================
  server.registerTool(
    "rh_get_event_results",
    {
      title: "Resultados del evento",
      description: "Clasificación general del evento (todas las carreras guardadas) y nº de rondas por heat.",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }, ctx) => {
      const r = await rhApi<{ races: { heats: Array<{ id: number; rounds: number }>; leaderboard: Leaderboard } }>("api/race/all", ctx.mcpReq.signal);
      return out(response_format, r.races, () =>
        [
          "# Resultados del evento",
          `Heats con rondas: ${r.races.heats.filter((h) => h.rounds > 0).map((h) => `heat ${h.id}: ${h.rounds}`).join(", ") || "ninguno"}`,
          "",
          leaderboardTable(r.races.leaderboard, "General"),
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_get_heat_results",
    {
      title: "Resultados de un heat",
      description: "Clasificación agregada de un heat (todas sus rondas guardadas).",
      inputSchema: z.object({ heat_id: z.number().int().min(1), response_format: responseFormat }),
      annotations: RO,
    },
    async ({ heat_id, response_format }, ctx) => {
      const r = await rhApi<{ heat: { setup: Row | null; leaderboard: Leaderboard } }>(`api/heat/${heat_id}`, ctx.mcpReq.signal);
      if (!r.heat.setup) throw new Error(`No existe el heat ${heat_id}. Usa rh_list_heats.`);
      return out(response_format, r.heat, () => `# ${r.heat.setup?.displayname}\n\n${leaderboardTable(r.heat.leaderboard)}`);
    }
  );

  server.registerTool(
    "rh_get_race_result",
    {
      title: "Resultado de una ronda",
      description: "Detalle de una carrera guardada (heat + ronda): vueltas por piloto y clasificación.",
      inputSchema: z.object({ heat_id: z.number().int().min(1), round: z.number().int().min(1), response_format: responseFormat }),
      annotations: RO,
    },
    async ({ heat_id, round, response_format }, ctx) => {
      let r: { race: { start_time_formatted: string; nodes: Array<{ callsign: string; node_index: number; laps: Array<{ lap_time_formatted: string; deleted: boolean }> }>; leaderboard: Leaderboard } };
      try {
        r = await rhApi(`api/race/${heat_id}/${round}`, ctx.mcpReq.signal);
      } catch {
        throw new Error(`No hay carrera guardada para heat ${heat_id} ronda ${round}. Revisa rh_get_event_results.`);
      }
      return out(response_format, r.race, () =>
        [
          `# Heat ${heat_id} · ronda ${round} · ${r.race.start_time_formatted}`,
          leaderboardTable(r.race.leaderboard),
          "",
          "### Vueltas",
          ...r.race.nodes.map(
            (n) => `- nodo ${n.node_index + 1} ${n.callsign ?? "?"}: ${n.laps.map((l) => (l.deleted ? `~~${l.lap_time_formatted}~~` : l.lap_time_formatted)).join(", ") || "—"}`
          ),
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_get_class_results",
    {
      title: "Resultados por clase",
      description: "Resultados y ranking de clases (incluye el ranking del método configurado, p. ej. puntos o mejores 3 consecutivas).",
      inputSchema: z.object({ class_id: z.number().int().min(1).optional().describe("Omitir = todas las clases") }),
      annotations: RO,
    },
    async ({ class_id }) => {
      const ev = await loadData(["result_data"], ["result_data"], 20000);
      const rd = ev.result_data as { classes?: Record<string, Row> };
      if (class_id !== undefined) {
        const c = rd.classes?.[String(class_id)];
        if (!c) throw new Error(`Sin resultados para la clase ${class_id}.`);
        return json(c);
      }
      return json(rd);
    }
  );
}
