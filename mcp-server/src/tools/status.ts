import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { config, sshConfigured } from "../config.js";
import { rhApi } from "../http.js";
import { rhRequest, socketState } from "../socket.js";
import { json, out, RACE_STATUS, responseFormat, text } from "../util.js";
import { RO, W_DESTRUCTIVE } from "./annotations.js";
import { getFormats } from "./event.js";

/** Mapa tipo de load_data -> evento que emite el servidor. */
export const LOAD_TYPES: Record<string, string> = {
  node_data: "node_data",
  environmental_data: "environmental_data",
  frequency_data: "frequency_data",
  heat_list: "heat_list",
  heat_data: "heat_data",
  heat_attribute_types: "heat_attribute_types",
  seat_data: "seat_data",
  class_list: "class_list",
  class_data: "class_data",
  format_data: "format_data",
  pilot_list: "pilot_data",
  pilot_data: "pilot_data",
  result_data: "result_data",
  node_tuning: "node_tuning",
  enter_and_exit_at_levels: "enter_and_exit_at_levels",
  start_thresh_lower_amount: "start_thresh_lower_amount",
  start_thresh_lower_duration: "start_thresh_lower_duration",
  min_lap: "min_lap",
  action_setup: "action_setup",
  event_actions: "event_actions",
  leaderboard: "leaderboard",
  current_laps: "current_laps",
  race_status: "race_status",
  current_heat: "current_heat",
  race_list: "race_list",
  language: "language",
  led_effects: "led_effects",
  callouts: "callouts",
  vrx_list: "vrx_list",
  backups_list: "backups_list",
  upd_cfg_files_list: "upd_cfg_files_list",
  exporter_list: "exporter_list",
  importer_list: "importer_list",
  heatgenerator_list: "heatgenerator_list",
  raceclass_rank_method_list: "raceclass_rank_method_list",
  race_points_method_list: "race_points_method_list",
  plugin_list: "plugin_list",
  plugin_repo: "plugin_repo",
  cluster_status: "cluster_status",
};

interface StatusResp {
  status: {
    server_info: Record<string, unknown>;
    state: { current_heat: number; num_nodes: number; race_status: number; currentProfile: string; currentFormat: string; currentHeat: string };
  };
}

export function registerStatusTools(server: McpServer): void {
  server.registerTool(
    "rh_get_status",
    {
      title: "Estado del timer",
      description: `Resumen del servidor RotorHazard: versión, API de nodos, nº de nodos (receptores), estado de carrera y heat/formato/perfil de frecuencias activos.
Úsalo primero para comprobar que la Pi está encendida y accesible.`,
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }, ctx) => {
      const sig = ctx.mcpReq.signal;
      const [st, formats, heats, profiles] = await Promise.all([
        rhApi<StatusResp>("api/status", sig),
        getFormats().catch(() => null),
        rhApi<{ heats: Record<string, { heat_id: number; displayname: string }> }>("api/heat/all", sig).catch(() => null),
        rhApi<{ profiles: Array<{ id: number; name: string }> }>("api/profile/all", sig).catch(() => null),
      ]);
      const s = st.status.state;
      const info = st.status.server_info;
      const fmtName = formats?.find((f) => String(f.id) === String(s.currentFormat))?.name;
      const heatName = heats ? Object.values(heats.heats).find((h) => h.heat_id === s.current_heat)?.displayname : undefined;
      const profName = profiles?.profiles.find((p) => String(p.id) === String(s.currentProfile))?.name;
      const data = {
        url: config.url,
        server_info: info,
        state: { ...s, race_status_text: RACE_STATUS[s.race_status] ?? String(s.race_status), current_heat_name: heatName, current_format_name: fmtName, current_profile_name: profName },
        socket: socketState(),
        ssh_configured: sshConfigured(),
      };
      return out(response_format, data, () =>
        [
          `# RotorHazard en ${config.url}`,
          `- Versión: **${info.release_version}** (server API ${info.server_api}, JSON API ${info.json_api})`,
          `- API de nodos: mejor ${info.node_api_best}, mínima ${info.node_api_lowest}, coincide=${info.node_api_match}`,
          `- Nodos (receptores): ${s.num_nodes}`,
          `- Estado de carrera: ${data.state.race_status_text}`,
          `- Heat actual: ${heatName ?? "—"} (id ${s.current_heat})`,
          `- Formato actual: ${fmtName ?? "—"} (id ${s.currentFormat})`,
          `- Perfil de frecuencias: ${profName ?? "—"} (id ${s.currentProfile})`,
          `- SSH configurado: ${sshConfigured() ? "sí" : "no"}`,
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_get_options",
    {
      title: "Opciones guardadas",
      description: `Devuelve las opciones de la base de datos (tabla GlobalSettings): nombre del evento, idioma, temas, voz, minLapSec, etc.
Filtra por subcadena con 'filter'. Para cambiar una opción usa rh_set_option.`,
      inputSchema: z.object({ filter: z.string().optional().describe("Subcadena para filtrar nombres de opción, p. ej. 'eventName' o 'voice'") }),
      annotations: RO,
    },
    async ({ filter }, ctx) => {
      const r = await rhApi<{ options: Record<string, string> | null }>("api/options", ctx.mcpReq.signal);
      let opts = Object.entries(r.options ?? {});
      if (filter) opts = opts.filter(([k]) => k.toLowerCase().includes(filter.toLowerCase()));
      // Nunca devolver secretos (API keys de plugins, tokens, contraseñas): solo si están configurados.
      const secret = /(api_?key|apikey|token|secret|password|passwd|private|-key$|_key$)/i;
      opts = opts.map(([k, v]) => [k, secret.test(k) && v ? `<configurada, ${String(v).length} caracteres>` : v]);
      return json({ count: opts.length, options: Object.fromEntries(opts) });
    }
  );

  server.registerTool(
    "rh_load_data",
    {
      title: "Leer datos en vivo (Socket.IO)",
      description: `Pide al servidor datos en vivo vía el evento 'load_data' (el mismo que usa la web) y devuelve el JSON crudo.
Útil cuando no hay una herramienta específica. Tipos habituales: race_status, current_heat, current_laps, leaderboard, node_data (RSSI/picos),
frequency_data, node_tuning, enter_and_exit_at_levels, heat_data (incluye ids de slots), class_data, format_data, pilot_data, result_data,
exporter_list, importer_list, heatgenerator_list, plugin_list, backups_list, event_actions, callouts, cluster_status.`,
      inputSchema: z.object({
        types: z.array(z.enum(Object.keys(LOAD_TYPES) as [string, ...string[]])).min(1).max(8).describe("Tipos de datos a solicitar"),
        timeout_ms: z.number().int().min(1000).max(60000).default(10000).describe("Espera máxima"),
      }),
      annotations: RO,
    },
    async ({ types, timeout_ms }) => {
      const evs = [...new Set(types.map((t) => LOAD_TYPES[t]))];
      const r = await rhRequest("load_data", { load_types: types }, { waitFor: evs, timeoutMs: timeout_ms });
      return json({ ...r.events, ...(r.missing.length ? { _missing: r.missing } : {}), ...(r.messages.length ? { _messages: r.messages } : {}) });
    }
  );

  server.registerTool(
    "rh_emit_event",
    {
      title: "Emitir evento Socket.IO (avanzado)",
      description: `Escape avanzado: emite cualquier evento Socket.IO de RotorHazard con el payload dado y recoge las respuestas.
Úsalo solo si no existe una herramienta específica (p. ej. 'set_vrx_node', 'set_led_event_effect', 'save_callouts', 'set_consecutives_count',
eventos registrados por plugins). Puede modificar datos: confirma con el usuario antes de usarlo.`,
      inputSchema: z.object({
        event: z.string().min(1).describe("Nombre del evento, p. ej. 'set_consecutives_count'"),
        data: z.record(z.string(), z.unknown()).optional().describe("Payload JSON del evento"),
        wait_for: z.array(z.string()).default([]).describe("Eventos de respuesta a esperar, p. ej. ['heat_data']"),
        timeout_ms: z.number().int().min(500).max(60000).default(5000),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ event, data, wait_for, timeout_ms }) => {
      const r = await rhRequest(event, data, { waitFor: wait_for, timeoutMs: timeout_ms, settleMs: Math.min(timeout_ms, 1500) });
      if (!wait_for.length && !r.messages.length) return text(`Evento '${event}' emitido. (El servidor no envía confirmación para este evento.)`);
      return json({ events: r.events, messages: r.messages, missing: r.missing });
    }
  );
}
