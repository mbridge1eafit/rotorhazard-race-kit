/** Acceso SSH a la Raspberry Pi (actualizaciones, servicio, logs, sistema, backups de archivos). */
import { readFileSync } from "node:fs";
import { Client, type ConnectConfig } from "ssh2";
import { config, sshConfigured } from "./config.js";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function connectConfig(): ConnectConfig {
  if (!sshConfigured()) {
    throw new Error(
      "SSH no está configurado. Define RH_SSH_HOST (y RH_SSH_USER, RH_SSH_KEY) en la configuración del servidor MCP para usar esta herramienta."
    );
  }
  const cfg: ConnectConfig = {
    host: config.ssh.host,
    port: config.ssh.port,
    username: config.ssh.username,
    readyTimeout: 10_000,
  };
  if (config.ssh.privateKeyPath) {
    try {
      cfg.privateKey = readFileSync(config.ssh.privateKeyPath);
    } catch (e) {
      throw new Error(`No se pudo leer la clave SSH en ${config.ssh.privateKeyPath}: ${(e as Error).message}`);
    }
  } else if (config.ssh.password) {
    cfg.password = config.ssh.password;
  }
  return cfg;
}

function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const cfg = connectConfig();
  return new Promise<T>((resolve, reject) => {
    const c = new Client();
    c.on("ready", () => {
      fn(c)
        .then(resolve, reject)
        .finally(() => c.end());
    });
    c.on("error", (err) => {
      reject(
        new Error(
          `Fallo SSH con ${cfg.username}@${cfg.host}:${cfg.port}: ${err.message}. ¿Está la Pi encendida y la clave autorizada en ~/.ssh/authorized_keys?`
        )
      );
    });
    c.connect(cfg);
  });
}

/** Ejecuta un comando con bash (shell no-login, sin banners) en la Pi. */
export function sshExec(command: string, timeoutMs = 60_000): Promise<ExecResult> {
  return withClient(
    (c) =>
      new Promise<ExecResult>((resolve, reject) => {
        c.exec(`bash -c ${shQuote(command)}`, (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          const timer = setTimeout(() => {
            stream.close();
            reject(new Error(`El comando SSH superó ${timeoutMs / 1000}s. Para tareas largas usa las herramientas en segundo plano (rh_update_server).`));
          }, timeoutMs);
          stream.on("data", (d: Buffer) => (stdout += d.toString()));
          stream.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          stream.on("close", (code: number | null) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
          });
        });
      })
  );
}

/** Descarga un archivo remoto vía SFTP. */
export function sftpDownload(remotePath: string, localPath: string): Promise<void> {
  return withClient(
    (c) =>
      new Promise<void>((resolve, reject) => {
        c.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.fastGet(remotePath, localPath, (e) => (e ? reject(e) : resolve()));
        });
      })
  );
}

/** Comillas seguras para bash. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Ruta remota apta para bash: expande ~ a $HOME y entrecomilla el resto. */
export function remotePath(p: string): string {
  if (p === "~") return '"$HOME"';
  if (p.startsWith("~/")) return `"$HOME"/${shQuote(p.slice(2))}`;
  return shQuote(p);
}

export function formatExec(r: ExecResult, maxLen = 20_000): string {
  const out = [`exit code: ${r.code}`];
  if (r.stdout.trim()) out.push("stdout:\n" + tail(r.stdout, maxLen));
  if (r.stderr.trim()) out.push("stderr:\n" + tail(r.stderr, Math.floor(maxLen / 4)));
  return out.join("\n");
}

export function tail(s: string, max: number): string {
  return s.length > max ? "…(recortado)…\n" + s.slice(s.length - max) : s;
}
