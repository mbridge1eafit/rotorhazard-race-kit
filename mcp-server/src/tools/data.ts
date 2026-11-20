import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, text } from "../util.js";
import { RO, W, W_DESTRUCTIVE } from "./annotations.js";

/** Carpeta local donde se guardan descargas (backups/exportaciones). */
export function localDir(dir?: string): string {
  const d = resolve(dir || process.env.RH_LOCAL_DIR || join(homedir(), "Documents", "RotorHazard"));
  mkdirSync(d, { recursive: true });
  return d;
}

function safeName(n: string): string {
  return basename(n).replace(/[<>:"/\\|?*]/g, "_");
}

export function registerDataTools(server: McpServer): void {
  server.registerTool(
    "rh_backup_database",
    {
      title: "Backup de la base de datos",
      description: `Crea una copia de la base de datos del evento en el timer (carpeta db_bkp de rh-data) y, si download=true, la guarda también en este PC.
Hazlo SIEMPRE antes de restaurar, resetear, importar o actualizar.`,
      inputSchema: z.object({
        download: z.boolean().default(true).describe("Guardar también una copia local"),
        local_dir: z.string().optional().describe("Carpeta local destino (por defecto RH_LOCAL_DIR o ~/Documents/RotorHazard)"),
      }),
      annotations: W,
    },
    async ({ download, local_dir }) => {
      const r = await rhRequest("backup_database", undefined, { waitFor: ["database_bkp_done", "backups_list"], timeoutMs: 30_000, requireAll: true });
      const bk = r.events.database_bkp_done as { file_name: string; file_data: string };
      let local = "";
      if (download) {
        const p = join(localDir(local_dir), safeName(bk.file_name));
        writeFileSync(p, Buffer.from(bk.file_data, "base64"));
        local = `\nCopia local: ${p}`;
      }
      return text(`Backup creado en el timer: ${bk.file_name}${local}${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_list_backups",
    {
      title: "Listar backups",
      description: "Lista los backups de base de datos guardados en el timer (carpeta db_bkp).",
      inputSchema: z.object({}),
      annotations: RO,
    },
    async () => json((await loadData(["backups_list"], ["backups_list"])).backups_list)
  );

  server.registerTool(
    "rh_download_backup",
    {
      title: "Descargar backup",
      description: "Descarga a este PC un backup existente del timer (nombre de rh_list_backups).",
      inputSchema: z.object({ backup_file: z.string().min(1), local_dir: z.string().optional() }),
      annotations: RO,
    },
    async ({ backup_file, local_dir }) => {
      const r = await rhRequest("download_database", { event_file: backup_file }, { waitFor: ["database_bkp_done"], timeoutMs: 30_000, requireAll: true });
      const bk = r.events.database_bkp_done as { file_name: string; file_data: string };
      const p = join(localDir(local_dir), safeName(bk.file_name));
      writeFileSync(p, Buffer.from(bk.file_data, "base64"));
      return text(`Guardado en ${p}`);
    }
  );

  server.registerTool(
    "rh_restore_database",
    {
      title: "Restaurar backup",
      description: "Sustituye la base de datos actual por un backup del timer. DESTRUCTIVO: haz rh_backup_database antes y confirma con el usuario.",
      inputSchema: z.object({ backup_file: z.string().min(1).describe("Nombre exacto del archivo (rh_list_backups)") }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ backup_file }) => {
      const r = await rhRequest("restore_database", { backup_file }, { waitFor: ["database_restore_done"], timeoutMs: 60_000 });
      return text(r.missing.length ? `La restauración no se confirmó.${msgs(r.messages)}` : `Base de datos restaurada desde ${backup_file}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_reset_database",
    {
      title: "Resetear datos del evento",
      description: `Borra datos para empezar un evento nuevo, como en Settings → Database:
- races: borra carreras guardadas · heats: heats y carreras · classes: clases, heats y carreras · pilots: pilotos, heats y carreras
- formats: formatos · all: todo.
archive=true guarda antes una copia del evento actual (recomendado). DESTRUCTIVO: confirma con el usuario.`,
      inputSchema: z.object({
        reset_type: z.enum(["races", "heats", "classes", "pilots", "formats", "all"]),
        archive: z.boolean().default(true),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ reset_type, archive }) => {
      const r = await rhRequest("reset_database", { reset_type, with_archive: archive }, { waitFor: ["heat_data"], timeoutMs: 30_000 });
      return text(`Reset '${reset_type}' ejecutado${archive ? " (con archivo previo)" : ""}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_list_exporters",
    {
      title: "Listar exportadores/importadores",
      description: "Lista los exportadores (CSV, JSON, resultados MultiGP, etc., incluidos los de plugins) e importadores disponibles.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    async () => json(await loadData(["exporter_list", "importer_list"], ["exporter_list", "importer_list"]))
  );

  server.registerTool(
    "rh_export_data",
    {
      title: "Exportar datos",
      description: `Ejecuta un exportador (ver rh_list_exporters, p. ej. 'csv_all', 'json_all', 'csv_leaderboard') y guarda el archivo en este PC.
Devuelve la ruta y, si es texto pequeño, una vista previa.`,
      inputSchema: z.object({ exporter: z.string().min(1), local_dir: z.string().optional() }),
      annotations: RO,
    },
    async ({ exporter, local_dir }) => {
      const r = await rhRequest("export_database", { exporter }, { waitFor: ["exported_data"], timeoutMs: 60_000 });
      if (r.missing.length) throw new Error(`El exportador '${exporter}' no devolvió datos.${msgs(r.messages)} Comprueba el nombre con rh_list_exporters.`);
      const ex = r.events.exported_data as { filename: string; encoding: string; data: string };
      const p = join(localDir(local_dir), safeName(ex.filename));
      const buf = ex.encoding === "base64" ? Buffer.from(ex.data, "base64") : Buffer.from(ex.data, "utf-8");
      writeFileSync(p, buf);
      const preview = ex.encoding !== "base64" ? `\n\nVista previa:\n${ex.data.slice(0, 3000)}${ex.data.length > 3000 ? "\n…" : ""}` : "";
      return text(`Exportado a ${p} (${buf.length} bytes).${preview}`);
    }
  );

  server.registerTool(
    "rh_import_data",
    {
      title: "Importar datos",
      description: `Importa un archivo local con un importador del timer (ver rh_list_exporters → importer_list), p. ej. pilotos o un evento JSON.
'params' depende del importador. Puede sobrescribir datos: haz backup antes y confirma con el usuario.`,
      inputSchema: z.object({
        importer: z.string().min(1),
        file_path: z.string().min(1).describe("Ruta local del archivo a importar"),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ importer, file_path, params }) => {
      let buf: Buffer;
      try {
        buf = readFileSync(file_path);
      } catch (e) {
        throw new Error(`No se pudo leer ${file_path}: ${(e as Error).message}`);
      }
      const r = await rhRequest("import_data", { importer, source_data: buf, params }, { waitFor: ["database_restore_done"], timeoutMs: 60_000, finishOnMessage: true });
      return text(r.missing.length ? `La importación no se confirmó.${msgs(r.messages)}` : `Importación completada.${msgs(r.messages)}`);
    }
  );
}
