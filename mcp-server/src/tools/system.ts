import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { config } from "../config.js";
import { fetchWithTimeout, rhApi } from "../http.js";
import { rhRequest } from "../socket.js";
import { formatExec, remotePath, sftpDownload, shQuote, sshExec, tail } from "../ssh.js";
import { json, msgs, text } from "../util.js";
import { RO, W, W_DESTRUCTIVE, W_IDEMPOTENT } from "./annotations.js";
import { localDir } from "./data.js";
import { cmpVer } from "./plugins.js";

const UPDATE_LOG = "~/rh_mcp_update.log";

async function currentVersion(): Promise<string | null> {
  try {
    const s = await rhApi<{ status: { server_info: { release_version: string } } }>("api/status");
    return s.status.server_info.release_version;
  } catch {
    return null;
  }
}

/** Espera a que la web vuelva a responder tras un reinicio. */
async function waitForServer(maxMs = 90_000): Promise<string | null> {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 4000));
  while (Date.now() - start < maxMs) {
    const v = await currentVersion();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

interface GhRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  html_url: string;
  body: string;
}

async function ghReleases(signal?: AbortSignal): Promise<GhRelease[]> {
  const res = await fetchWithTimeout(
    "https://api.github.com/repos/RotorHazard/RotorHazard/releases?per_page=20",
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "rotorhazard-mcp-server" } },
    20_000,
    signal
  );
  if (!res.ok) throw new Error(`GitHub devolvió HTTP ${res.status} al consultar releases (límite de peticiones si es 403; reintenta en unos minutos).`);
  return ((await res.json()) as GhRelease[]).filter((r) => !r.draft);
}

export function registerSystemTools(server: McpServer): void {
  // ---------------- Servidor RotorHazard ----------------
  server.registerTool(
    "rh_restart_server",
    {
      title: "Reiniciar servidor RotorHazard",
      description: "Reinicia el proceso de RotorHazard (necesario tras instalar plugins o cambiar config). Espera a que vuelva y devuelve la versión. No reinicia la Pi.",
      inputSchema: z.object({ wait: z.boolean().default(true).describe("Esperar a que el servidor vuelva a responder") }),
      annotations: W,
    },
    async ({ wait }) => {
      await rhRequest("restart_server", undefined, { settleMs: 500 });
      if (!wait) return text("Reinicio solicitado.");
      const v = await waitForServer();
      return text(v ? `Servidor reiniciado y en línea (v${v}).` : "Reinicio solicitado, pero el servidor no respondió en 90 s. Revisa rh_service_control action=status o rh_get_logs.");
    }
  );

  server.registerTool(
    "rh_power",
    {
      title: "Reiniciar/apagar la Raspberry Pi",
      description: "Reinicia (reboot) o apaga (shutdown) la Raspberry Pi desde RotorHazard. Apagar la deja inaccesible hasta encenderla físicamente. Confirma con el usuario.",
      inputSchema: z.object({ action: z.enum(["reboot", "shutdown"]) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ action }) => {
      const r = await rhRequest(action === "reboot" ? "reboot_pi" : "shutdown_pi", undefined, { settleMs: 1500 });
      return text(`${action === "reboot" ? "Reinicio" : "Apagado"} de la Pi solicitado.${msgs(r.messages)}`);
    }
  );

  // ---------------- SSH: servicio, logs, sistema ----------------
  server.registerTool(
    "rh_service_control",
    {
      title: "Servicio systemd",
      description: "Consulta o controla el servicio systemd de RotorHazard por SSH (status, start, stop, restart). Útil si la web no responde.",
      inputSchema: z.object({ action: z.enum(["status", "start", "stop", "restart"]) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ action }) => {
      const svc = shQuote(config.remote.service);
      const cmd = action === "status" ? `systemctl status ${svc} --no-pager -n 15` : `sudo systemctl ${action} ${svc} && systemctl is-active ${svc}`;
      return text(formatExec(await sshExec(cmd, 60_000)));
    }
  );

  server.registerTool(
    "rh_get_logs",
    {
      title: "Logs del servidor",
      description: `Últimas líneas del log de RotorHazard. source='file' lee el log actual de rh-data/logs (más detallado), 'journal' usa journalctl del servicio.
'filter' (regex grep -E, sin distinguir mayúsculas) para buscar, p. ej. 'error|exception|plugin'.`,
      inputSchema: z.object({
        lines: z.number().int().min(10).max(2000).default(150),
        source: z.enum(["file", "journal"]).default("file"),
        filter: z.string().optional(),
      }),
      annotations: RO,
    },
    async ({ lines, source, filter }) => {
      const grep = filter ? ` | grep -iE ${shQuote(filter)}` : "";
      const cmd =
        source === "journal"
          ? `journalctl -u ${shQuote(config.remote.service)} --no-pager -n ${filter ? 5000 : lines}${grep} | tail -n ${lines}`
          : `f=$(ls -t ${remotePath(config.remote.dataDir)}/logs/*.log 2>/dev/null | head -1); [ -z "$f" ] && { echo "No hay logs en ${config.remote.dataDir}/logs"; exit 1; }; echo "== $f"; tail -n ${filter ? 20000 : lines} "$f"${grep} | tail -n ${lines}`;
      const r = await sshExec(cmd, 60_000);
      return text(tail(r.stdout || r.stderr, 24_000));
    }
  );

  server.registerTool(
    "rh_system_info",
    {
      title: "Salud de la Raspberry Pi",
      description: "Temperatura de CPU, throttling/subtensión, uptime, carga, memoria, disco, IP, SO, Python y estado del servicio (por SSH). Útil antes de un evento.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    async () => {
      const cmd = [
        `echo "host: $(hostname) | $(hostname -I)"`,
        `echo "os: $(. /etc/os-release; echo $PRETTY_NAME) | kernel $(uname -r) | $(uname -m)"`,
        `echo "model: $(tr -d '\\0' </proc/device-tree/model 2>/dev/null)"`,
        `echo "uptime: $(uptime -p) | load: $(cut -d' ' -f1-3 /proc/loadavg)"`,
        `echo "temp: $(vcgencmd measure_temp 2>/dev/null || echo n/a)"`,
        `echo "throttled: $(vcgencmd get_throttled 2>/dev/null || echo n/a)  (0x0 = OK; bit0 subtensión ahora, bit16 subtensión ocurrida)"`,
        `free -h | head -2`,
        `df -h / | tail -1 | awk '{print "disk /: "$3" usados de "$2" ("$5"), libres "$4}'`,
        `echo "python venv: $(${remotePath(config.remote.venv)}/bin/python --version 2>&1)"`,
        `echo "service: $(systemctl is-active ${shQuote(config.remote.service)}) | enabled: $(systemctl is-enabled ${shQuote(config.remote.service)} 2>/dev/null)"`,
        `echo "rh-data: $(du -sh ${remotePath(config.remote.dataDir)} 2>/dev/null | cut -f1) | plugins: $(ls ${remotePath(config.remote.dataDir)}/plugins 2>/dev/null | tr '\\n' ' ')"`,
        `date`,
      ].join("; ");
      return text(formatExec(await sshExec(cmd, 30_000)));
    }
  );

  server.registerTool(
    "rh_get_config_file",
    {
      title: "Ver config.json",
      description: "Lee config.json del directorio de datos por SSH, con la sección SECRETS enmascarada.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    async () => {
      const r = await sshExec(`cat ${remotePath(config.remote.dataDir)}/config.json`, 20_000);
      if (r.code !== 0) throw new Error(`No se pudo leer config.json: ${r.stderr}`);
      const cfg = JSON.parse(r.stdout) as Record<string, Record<string, unknown>>;
      if (cfg.SECRETS) for (const k of Object.keys(cfg.SECRETS)) cfg.SECRETS[k] = cfg.SECRETS[k] ? "***" : "";
      return json(cfg);
    }
  );

  server.registerTool(
    "rh_backup_data_dir",
    {
      title: "Backup completo de rh-data",
      description: "Crea por SSH un .tar.gz de todo el directorio de datos (base de datos, config, plugins, logs) en el $HOME de la Pi y opcionalmente lo descarga a este PC.",
      inputSchema: z.object({ download: z.boolean().default(true), local_dir: z.string().optional() }),
      annotations: W,
    },
    async ({ download, local_dir }) => {
      const r = await sshExec(
        `ts=$(date +%Y%m%d_%H%M%S); d=${remotePath(config.remote.dataDir)}; out="$HOME/rh-data_backup_$ts.tar.gz"; ` +
          `tar -czf "$out" -C "$(dirname "$d")" "$(basename "$d")" && ls -l "$out" && echo "PATH=$out"`,
        300_000
      );
      const m = r.stdout.match(/PATH=(.+)/);
      if (r.code !== 0 || !m) throw new Error(`Falló el backup: ${formatExec(r)}`);
      const remote = m[1].trim();
      let extra = "";
      if (download) {
        const local = join(localDir(local_dir), remote.split("/").pop()!);
        await sftpDownload(remote, local);
        extra = `\nDescargado a: ${local}`;
      }
      return text(`Backup en la Pi: ${remote}${extra}`);
    }
  );

  server.registerTool(
    "rh_ssh_exec",
    {
      title: "Ejecutar comando en la Pi (avanzado)",
      description: "Ejecuta un comando de shell en la Raspberry Pi por SSH y devuelve stdout/stderr. Para diagnósticos puntuales; confirma con el usuario los comandos que modifiquen el sistema.",
      inputSchema: z.object({ command: z.string().min(1), timeout_sec: z.number().int().min(5).max(600).default(60) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ command, timeout_sec }) => text(formatExec(await sshExec(command, timeout_sec * 1000)))
  );

  // ---------------- Actualizaciones ----------------
  server.registerTool(
    "rh_check_updates",
    {
      title: "Buscar actualizaciones de RotorHazard",
      description: "Compara la versión instalada con las releases oficiales en GitHub (estable y beta) y resume las notas de la versión más nueva.",
      inputSchema: z.object({ include_prerelease: z.boolean().default(false) }),
      annotations: RO,
    },
    async ({ include_prerelease }, ctx) => {
      const [installed, rels] = await Promise.all([currentVersion(), ghReleases(ctx.mcpReq.signal)]);
      const stable = rels.find((r) => !r.prerelease);
      const pre = rels.find((r) => r.prerelease);
      const target = include_prerelease && pre && stable && cmpVer(pre.tag_name, stable.tag_name) > 0 ? pre : stable;
      const newer = installed && target ? cmpVer(target.tag_name, installed) > 0 : null;
      const lines = [
        `- Instalada: ${installed ?? "desconocida (timer no accesible)"}`,
        `- Última estable: ${stable?.tag_name ?? "?"} (${stable?.published_at?.slice(0, 10) ?? ""})`,
        `- Última beta: ${pre?.tag_name ?? "—"}${pre ? ` (${pre.published_at.slice(0, 10)})` : ""}`,
        newer === null ? "" : newer ? `\n**Hay actualización: ${target!.tag_name}** → usa rh_update_server version="${target!.tag_name}"` : "\nEstás en la última versión.",
      ];
      if (newer && target) lines.push(`\n### Notas de ${target.tag_name}\n${target.body.slice(0, 6000)}\n\n${target.html_url}`);
      return text(lines.filter(Boolean).join("\n"));
    }
  );

  server.registerTool(
    "rh_update_server",
    {
      title: "Actualizar RotorHazard",
      description: `Actualiza el software RotorHazard en la Pi con el procedimiento oficial (update.sh de rotorhazard.com), por SSH y en segundo plano:
1) backup .tar.gz de rh-data, 2) para el servicio, 3) activa el venv y ejecuta update.sh [versión] (archiva el programa anterior en ~/old y actualiza dependencias),
4) arranca el servicio. Tarda varios minutos: consulta el progreso con rh_update_status. Requiere internet en la Pi. Confirma con el usuario y no lo hagas durante una carrera.`,
      inputSchema: z.object({
        version: z.string().optional().describe("Tag, p. ej. 'v4.5.1' o 'v4.6.0-beta.1'; omitido = última estable"),
        backup: z.boolean().default(true),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ version, backup }) => {
      if (version && !/^v?\d+\.\d+\.\d+([-.][\w.]+)?$/.test(version)) throw new Error(`Versión no válida: '${version}'. Usa el formato v4.5.1.`);
      const running = await sshExec(`pgrep -f "[r]h_mcp_update.sh" >/dev/null && echo RUNNING || echo IDLE`, 20_000);
      if (running.stdout.includes("RUNNING")) throw new Error("Ya hay una actualización en curso. Consulta rh_update_status.");
      const svc = shQuote(config.remote.service);
      const script = [
        "#!/bin/bash",
        "set -o pipefail",
        `echo "== Inicio actualización $(date)"`,
        `cd "$HOME"`,
        backup
          ? `d=${remotePath(config.remote.dataDir)}; tar -czf "$HOME/rh-data_backup_$(date +%Y%m%d_%H%M%S).tar.gz" -C "$(dirname "$d")" "$(basename "$d")" && echo "== Backup rh-data OK" || { echo "== Backup FALLÓ"; echo "MCP_UPDATE_DONE rc=1"; exit 1; }`
          : `echo "== Sin backup"`,
        `sudo systemctl stop ${svc} && echo "== Servicio detenido"`,
        `source ${remotePath(config.remote.venv)}/bin/activate && echo "== venv: $(which python)"`,
        `rm -f update.sh && wget -q https://rotorhazard.com/update.sh -O update.sh || { echo "== No se pudo descargar update.sh"; sudo systemctl start ${svc}; echo "MCP_UPDATE_DONE rc=1"; exit 1; }`,
        `sh update.sh ${version ? shQuote(version) : ""}; rc=$?`,
        `sudo systemctl start ${svc} && echo "== Servicio arrancado"`,
        `echo "MCP_UPDATE_DONE rc=$rc $(date)"`,
      ].join("\n");
      const cmd =
        `cat > "$HOME/rh_mcp_update.sh" <<'RHMCPEOF'\n${script}\nRHMCPEOF\n` +
        `chmod +x "$HOME/rh_mcp_update.sh"; setsid nohup "$HOME/rh_mcp_update.sh" > ${remotePath(UPDATE_LOG)} 2>&1 < /dev/null & echo STARTED`;
      const r = await sshExec(cmd, 30_000);
      if (!r.stdout.includes("STARTED")) throw new Error(`No se pudo lanzar la actualización: ${formatExec(r)}`);
      return text(`Actualización${version ? ` a ${version}` : " a la última estable"} lanzada en segundo plano. Log: ${UPDATE_LOG}. Consulta el avance con rh_update_status (tarda 3-10 min).`);
    }
  );

  server.registerTool(
    "rh_update_status",
    {
      title: "Progreso de la actualización",
      description: "Muestra el final del log de rh_update_server, si terminó, el estado del servicio y la versión que responde ahora.",
      inputSchema: z.object({ lines: z.number().int().min(10).max(500).default(40) }),
      annotations: RO,
    },
    async ({ lines }) => {
      const r = await sshExec(
        `tail -n ${lines} ${remotePath(UPDATE_LOG)} 2>/dev/null || echo "(sin log de actualización)"; echo "---"; ` +
          `pgrep -f "[r]h_mcp_update.sh" >/dev/null && echo "PROCESO: en curso" || echo "PROCESO: terminado"; echo "servicio: $(systemctl is-active ${shQuote(config.remote.service)})"`,
        20_000
      );
      const v = await currentVersion();
      return text(`${r.stdout}\nVersión que responde en ${config.url}: ${v ?? "no responde (aún arrancando o detenido)"}`);
    }
  );

  // ---------------- Firmware de nodos ----------------
  server.registerTool(
    "rh_node_firmware",
    {
      title: "Firmware de nodos (STM32 / S32_BPill)",
      description: `Comprueba o flashea el firmware de la placa de nodos STM32 (S32_BPill) desde la Pi, como la página 'Update Nodes'.
action='check' muestra versión del archivo; action='update' flashea (tarda ~1 min; no apagar). Por defecto usa el .bin incluido con la versión instalada
(${config.remote.programDir}/firmware/RH_S32_BPill_node.bin). Tras actualizar, reinicia el servidor. Confirma con el usuario antes de 'update'.`,
      inputSchema: z.object({
        action: z.enum(["check", "update"]),
        source: z.string().optional().describe("Ruta absoluta en la Pi o URL del .bin"),
      }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ action, source }) => {
      const src = source ?? `${config.remote.programDir.replace(/^~/, `/home/${config.ssh.username}`)}/firmware/RH_S32_BPill_node.bin`;
      if (action === "check") {
        const r = await rhRequest("check_bpillfw_file", { src_file_str: src }, { waitFor: ["upd_set_info_text"], timeoutMs: 20_000 });
        return text(`${src}\n${String(r.events.upd_set_info_text ?? "Sin respuesta").replace(/<br>/g, "\n").trim()}${msgs(r.messages)}`);
      }
      const r = await rhRequest("do_bpillfw_update", { src_file_str: src }, { waitFor: ["upd_messages_finish"], collect: ["upd_messages_init", "upd_messages_append"], timeoutMs: 240_000 });
      const log = [...(r.collected.upd_messages_init ?? []), ...(r.collected.upd_messages_append ?? [])].map(String).join("");
      return text(`${r.missing.length ? "⚠ No llegó la señal de fin." : "Flasheo finalizado."}\n${tail(log, 8000)}\nReinicia con rh_restart_server.${msgs(r.messages)}`);
    }
  );
}
