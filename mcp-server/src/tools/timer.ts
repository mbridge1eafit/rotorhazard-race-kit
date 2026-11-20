import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { rhApi } from "../http.js";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, out, responseFormat, text } from "../util.js";
import { RO, W_IDEMPOTENT } from "./annotations.js";

/** Tabla de canales de vídeo 5.8 GHz (la misma que usa la interfaz web de RotorHazard). */
export const BANDS: Record<string, number[]> = {
  R: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
  F: [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
  E: [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
  B: [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
  A: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
  L: [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621],
  D: [5660, 5695, 5735, 5770, 5805, 5880],
};

interface FData {
  fdata: Array<{ band: string | null; channel: number | null; frequency: number }>;
}
interface Profile {
  id: number;
  name: string;
  description: string | null;
  /** La API JSON ya entrega solo la lista de MHz (campo "f"). */
  frequencies: number[];
  enter_ats: number[] | null;
  exit_ats: number[] | null;
}

export function registerTimerTools(server: McpServer): void {
  server.registerTool(
    "rh_get_frequencies",
    {
      title: "Frecuencias y afinación",
      description: `Frecuencia (banda/canal/MHz) asignada a cada nodo del perfil activo, con sus niveles EnterAt/ExitAt y RSSI actual/pico.
Úsalo antes de un heat para comprobar canales y calibración. Frecuencia 0 = nodo desactivado.`,
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }) => {
      const ev = await loadData(
        ["frequency_data", "enter_and_exit_at_levels", "node_tuning", "node_data"],
        ["frequency_data", "enter_and_exit_at_levels", "node_tuning", "node_data"]
      );
      const f = (ev.frequency_data as FData).fdata;
      const lv = ev.enter_and_exit_at_levels as { enter_at_levels: number[]; exit_at_levels: number[] };
      const nt = ev.node_tuning as { profile_name: string; current_profile: number };
      const nd = ev.node_data as { node_peak_rssi?: number[]; pass_peak_rssi?: number[]; pass_nadir_rssi?: number[] };
      const nodes = f.map((x, i) => ({
        node: i + 1,
        band: x.band,
        channel: x.channel,
        frequency: x.frequency,
        enter_at: lv?.enter_at_levels?.[i],
        exit_at: lv?.exit_at_levels?.[i],
        node_peak_rssi: nd?.node_peak_rssi?.[i],
        pass_peak_rssi: nd?.pass_peak_rssi?.[i],
        pass_nadir_rssi: nd?.pass_nadir_rssi?.[i],
      }));
      const data = { profile: { id: nt.current_profile, name: nt.profile_name }, nodes };
      return out(response_format, data, () =>
        [
          `# Perfil de frecuencias: ${nt.profile_name} (id ${nt.current_profile})`,
          "| Nodo | Canal | MHz | EnterAt | ExitAt | Pico nodo | Pico paso |",
          "|---|---|---|---|---|---|---|",
          ...nodes.map(
            (n) =>
              `| ${n.node} | ${n.band && n.channel ? `${n.band}${n.channel}` : "—"} | ${n.frequency || "OFF"} | ${n.enter_at ?? ""} | ${n.exit_at ?? ""} | ${n.node_peak_rssi ?? ""} | ${n.pass_peak_rssi ?? ""} |`
          ),
        ].join("\n")
      );
    }
  );

  server.registerTool(
    "rh_set_frequency",
    {
      title: "Cambiar frecuencia de un nodo",
      description: `Asigna la frecuencia de un nodo en el perfil activo. Indica band+channel (p. ej. R y 3 → 5732 MHz) o frequency en MHz.
frequency=0 desactiva el nodo. Bandas: R (Raceband), F (Fatshark), E, B, A, L (Lowband), D (DJI).`,
      inputSchema: z.object({
        node: z.number().int().min(1).max(16).describe("Nodo 1..N"),
        band: z.enum(["R", "F", "E", "B", "A", "L", "D"]).optional(),
        channel: z.number().int().min(1).max(8).optional(),
        frequency: z.number().int().min(0).max(6000).optional().describe("MHz; 0 = desactivar el nodo"),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ node, band, channel, frequency }) => {
      let freq = frequency;
      if (band && channel) {
        const f = BANDS[band][channel - 1];
        if (!f) throw new Error(`La banda ${band} no tiene canal ${channel}.`);
        if (freq !== undefined && freq !== f) throw new Error(`${band}${channel} es ${f} MHz, no ${freq}. Indica solo band+channel o solo frequency.`);
        freq = f;
      }
      if (freq === undefined) throw new Error("Indica band+channel o frequency.");
      const r = await rhRequest(
        "set_frequency",
        { node: node - 1, frequency: freq, band: band && channel ? band : null, channel: band && channel ? channel : null },
        { waitFor: ["frequency_data"], requireAll: true }
      );
      return text(`Nodo ${node} → ${freq ? `${band && channel ? `${band}${channel} ` : ""}${freq} MHz` : "desactivado"}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_set_frequency_preset",
    {
      title: "Aplicar preset de frecuencias",
      description: `Aplica un preset a todos los nodos del perfil activo:
- RB-4: Raceband R1,R3,R6,R7 (4 pilotos, buena separación)
- RB-8: Raceband R1..R8
- IMD5C: 5 canales IMD (R1,R2,F2,F4,E1)
- All-N1: todos los nodos en la frecuencia del nodo 1`,
      inputSchema: z.object({ preset: z.enum(["RB-4", "RB-8", "IMD5C", "All-N1"]) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ preset }) => {
      const r = await rhRequest("set_frequency_preset", { preset }, { waitFor: ["frequency_data"], requireAll: true });
      const f = (r.events.frequency_data as FData).fdata;
      return text(`Preset ${preset} aplicado: ${f.map((x, i) => `N${i + 1}=${x.band ?? ""}${x.channel ?? ""}(${x.frequency || "OFF"})`).join(", ")}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_set_node_tuning",
    {
      title: "Ajustar EnterAt/ExitAt",
      description: `Ajusta los umbrales RSSI de detección de un nodo en el perfil activo. EnterAt debe ser mayor que ExitAt.
Guía oficial: EnterAt algo por debajo del pico del paso, ExitAt por encima del ruido con el dron lejos.`,
      inputSchema: z.object({
        node: z.number().int().min(1).max(16),
        enter_at: z.number().int().min(0).max(255).optional(),
        exit_at: z.number().int().min(0).max(255).optional(),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ node, enter_at, exit_at }) => {
      if (enter_at === undefined && exit_at === undefined) throw new Error("Indica enter_at y/o exit_at.");
      if (enter_at !== undefined && exit_at !== undefined && exit_at >= enter_at) throw new Error("ExitAt debe ser menor que EnterAt.");
      const m: string[] = [];
      if (enter_at !== undefined) m.push(...(await rhRequest("set_enter_at_level", { node: node - 1, enter_at_level: enter_at }, { settleMs: 600 })).messages);
      if (exit_at !== undefined) m.push(...(await rhRequest("set_exit_at_level", { node: node - 1, exit_at_level: exit_at }, { settleMs: 600 })).messages);
      const lv = (await loadData(["enter_and_exit_at_levels"], ["enter_and_exit_at_levels"])).enter_and_exit_at_levels as { enter_at_levels: number[]; exit_at_levels: number[] };
      return text(`Nodo ${node}: EnterAt=${lv.enter_at_levels[node - 1]}, ExitAt=${lv.exit_at_levels[node - 1]}.${msgs(m)}`);
    }
  );

  server.registerTool(
    "rh_list_profiles",
    {
      title: "Perfiles de frecuencias",
      description: "Lista los perfiles de frecuencias/afinación guardados (cada uno con frecuencias y EnterAt/ExitAt por nodo).",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }, ctx) => {
      const r = await rhApi<{ profiles: Profile[] }>("api/profile/all", ctx.mcpReq.signal);
      return out(response_format, r, () =>
        r.profiles
          .map(
            (p) =>
              `- **${p.name}** (id ${p.id})${p.description ? ` — ${p.description}` : ""}: ${(p.frequencies ?? []).map((x) => x || "OFF").join(", ")}` +
              (p.enter_ats ? `
  EnterAt: ${p.enter_ats.join(", ")} · ExitAt: ${(p.exit_ats ?? []).join(", ")}` : "")
          )
          .join("\n")
      );
    }
  );

  server.registerTool(
    "rh_set_profile",
    {
      title: "Activar perfil de frecuencias",
      description: "Activa un perfil de frecuencias/afinación existente (cambia frecuencias y umbrales de todos los nodos).",
      inputSchema: z.object({ profile_id: z.number().int().min(1) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ profile_id }) => {
      const r = await rhRequest("set_profile", { profile: profile_id }, { waitFor: ["frequency_data"], timeoutMs: 6000 });
      return text(`Perfil ${profile_id} activado.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_update_profile",
    {
      title: "Renombrar/duplicar perfil",
      description: "Renombra o describe el perfil ACTIVO, o crea un perfil nuevo duplicando el activo (duplicate=true) y lo activa.",
      inputSchema: z.object({
        name: z.string().max(80).optional(),
        description: z.string().max(256).optional(),
        duplicate: z.boolean().default(false).describe("true = crear un perfil nuevo copia del activo"),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ name, description, duplicate }) => {
      const m: string[] = [];
      if (duplicate) m.push(...(await rhRequest("add_profile", undefined, { waitFor: ["node_tuning"], timeoutMs: 6000 })).messages);
      const data: Record<string, string> = {};
      if (name !== undefined) data.profile_name = name;
      if (description !== undefined) data.profile_description = description;
      if (Object.keys(data).length) m.push(...(await rhRequest("alter_profile", data, { settleMs: 700 })).messages);
      const nt = (await loadData(["node_tuning"], ["node_tuning"])).node_tuning;
      return json({ node_tuning: nt, messages: m });
    }
  );

  server.registerTool(
    "rh_set_min_lap",
    {
      title: "Tiempo mínimo de vuelta",
      description: "Fija el tiempo mínimo de vuelta (segundos) y qué hacer con vueltas más cortas (resaltar o descartar).",
      inputSchema: z.object({
        seconds: z.number().min(0).max(300).optional(),
        behavior: z.enum(["highlight", "discard"]).optional().describe("highlight = marcar, discard = descartar automáticamente"),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ seconds, behavior }) => {
      const m: string[] = [];
      if (seconds !== undefined) m.push(...(await rhRequest("set_min_lap", { min_lap: seconds }, { settleMs: 600 })).messages);
      if (behavior !== undefined) m.push(...(await rhRequest("set_min_lap_behavior", { min_lap_behavior: behavior === "discard" ? 1 : 0 }, { settleMs: 600 })).messages);
      const ml = (await loadData(["min_lap"], ["min_lap"])).min_lap;
      return json({ min_lap: ml, messages: m });
    }
  );

  server.registerTool(
    "rh_set_option",
    {
      title: "Cambiar opción",
      description: `Cambia una opción de la base de datos (GlobalSettings), como en Settings. Ejemplos: eventName, eventDescription, timerName,
voiceCallouts, consecutivesCount. Consulta nombres actuales con rh_get_options.`,
      inputSchema: z.object({ option: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ option, value }) => {
      const r = await rhRequest("set_option", { option, value: String(value) }, { settleMs: 600 });
      return text(`Opción '${option}' = '${value}'.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_set_config",
    {
      title: "Cambiar configuración del servidor",
      description: `Cambia un valor de config.json (Advanced Settings): secciones GENERAL, TIMING, UI, HARDWARE, SENSORS, LED, LOGGING, VRX_CONTROL, SECRETS.
Ejemplos: GENERAL/HTTP_PORT, LED/LED_COUNT, LOGGING/CONSOLE_LEVEL, UI/timerName. Muchos cambios requieren reiniciar (rh_restart_server).
Cambiar SECRETS (credenciales de admin) puede dejarte sin acceso: confirma con el usuario y actualiza RH_PASSWORD del MCP.`,
      inputSchema: z.object({
        section: z.string().min(1).describe("Sección, p. ej. 'GENERAL'"),
        key: z.string().min(1).describe("Clave, p. ej. 'HTTP_PORT'"),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown())]),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ section, key, value }) => {
      const r = await rhRequest("set_config", { section, key, value }, { settleMs: 800 });
      return text(`config ${section}/${key} actualizado.${msgs(r.messages)} Si el cambio no se aplica en caliente, reinicia con rh_restart_server.`);
    }
  );
}
