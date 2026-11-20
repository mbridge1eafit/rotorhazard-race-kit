#!/usr/bin/env node
/**
 * rotorhazard-mcp-server
 * MCP para administrar un timer de carreras FPV RotorHazard (https://github.com/RotorHazard/RotorHazard).
 *
 * Canales:
 *  - API JSON HTTP (/api/...) para lecturas.
 *  - Socket.IO (el mismo protocolo que la interfaz web) para configurar y controlar carreras.
 *  - SSH (opcional) para actualizar, gestionar el servicio, logs y salud de la Pi.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { config } from "./config.js";
import { closeSocket } from "./socket.js";
import { registerDataTools } from "./tools/data.js";
import { registerEventTools } from "./tools/event.js";
import { registerMarshalTools } from "./tools/marshal.js";
import { registerPluginTools } from "./tools/plugins.js";
import { registerRaceTools } from "./tools/race.js";
import { registerStatusTools } from "./tools/status.js";
import { registerSystemTools } from "./tools/system.js";
import { registerTimerTools } from "./tools/timer.js";

function createServer(): McpServer {
  const server = new McpServer(
    { name: "rotorhazard-mcp-server", version: "1.0.0" },
    {
      instructions:
        "Administra un timer RotorHazard (carreras FPV). Empieza con rh_get_status. " +
        "Antes de operaciones destructivas (restaurar, resetear, actualizar, borrar) haz rh_backup_database y confirma con el usuario. " +
        "No cambies formato/frecuencias ni actualices con una carrera en curso (estado RACING/STAGING). " +
        "Tras instalar plugins o cambiar config, reinicia con rh_restart_server.",
    }
  );

  registerStatusTools(server);
  registerEventTools(server);
  registerRaceTools(server);
  registerMarshalTools(server);
  registerTimerTools(server);
  registerPluginTools(server);
  registerDataTools(server);
  registerSystemTools(server);

  // ---------- Prompts de flujos de trabajo ----------
  server.registerPrompt(
    "preparar_evento",
    {
      title: "Preparar un evento",
      description: "Guía para dejar el timer listo para un evento: salud, backup, reset, clases, pilotos, frecuencias y heats.",
      argsSchema: z.object({
        nombre_evento: z.string().describe("Nombre del evento"),
        pilotos: z.string().optional().describe("Lista de callsigns separada por comas"),
      }),
    },
    ({ nombre_evento, pilotos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Prepara el timer RotorHazard para el evento "${nombre_evento}":\n` +
              `1. rh_get_status y rh_system_info (temperatura, throttling, disco).\n` +
              `2. rh_check_updates; si hay actualización, pregúntame antes de aplicarla.\n` +
              `3. rh_backup_database (con descarga) y, si lo confirmo, rh_reset_database reset_type='all' archive=true.\n` +
              `4. rh_set_option eventName="${nombre_evento}".\n` +
              `5. Crea las clases y formatos que necesite (pregúntame).\n` +
              (pilotos ? `6. rh_add_pilots con: ${pilotos}.\n` : `6. Pídeme la lista de pilotos y créalos con rh_add_pilots.\n`) +
              `7. Revisa rh_get_frequencies y aplica un preset adecuado al nº de pilotos por heat (RB-4 para 4).\n` +
              `8. Genera heats (rh_list_heat_generators → rh_generate_heats) y muéstrame rh_list_heats.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "ciclo_de_carrera",
    {
      title: "Ciclo de una carrera",
      description: "Pasos para correr un heat: seleccionar, revisar frecuencias, iniciar, detener, revisar y guardar.",
      argsSchema: z.object({ heat_id: z.string().describe("Id del heat a correr") }),
    },
    ({ heat_id }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Corre el heat ${heat_id}: rh_get_current_race (debe estar READY; si no, pregúntame si guardar o descartar), ` +
              `rh_set_current_heat ${heat_id}, muéstrame pilotos y frecuencias (rh_list_heats, rh_get_frequencies), ` +
              `espera mi confirmación y lanza rh_stage_race. Cuando te diga, rh_stop_race, enséñame rh_get_current_race ` +
              `y, si lo apruebo, rh_save_laps; si no, rh_discard_laps.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "mantenimiento",
    {
      title: "Mantenimiento del timer",
      description: "Revisión de salud, actualizaciones de RotorHazard y plugins, backups y errores en logs.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Haz mantenimiento del timer: rh_get_status, rh_system_info, rh_get_logs filter='error|exception|traceback', " +
              "rh_check_updates, rh_list_installed_plugins y rh_update_all_plugins dry_run=true, rh_list_backups. " +
              "Resume problemas y propón acciones; no apliques cambios sin mi confirmación.",
          },
        },
      ],
    })
  );

  return server;
}

serveStdio(createServer);
console.error(`rotorhazard-mcp-server en stdio → ${config.url}`);

const shutdown = () => {
  closeSocket();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
