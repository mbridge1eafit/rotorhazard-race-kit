/**
 * Configuración por variables de entorno.
 * Solo RH_URL es imprescindible; SSH es opcional (las herramientas rh_system_* y rh_update_* lo requieren).
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(1).replace(/^[\\/]/, "")) : p;
}

export const config = {
  /** URL base del servidor web de RotorHazard, p. ej. http://192.168.1.20:5000 */
  url: env("RH_URL", "http://127.0.0.1:5000").replace(/\/+$/, ""),
  /** Credenciales de administrador (Basic Auth). Vacías = sin autenticación. */
  username: env("RH_USERNAME", "admin"),
  password: env("RH_PASSWORD", "rotorhazard"),
  /** Tiempo de espera por defecto para respuestas Socket.IO (ms). */
  timeoutMs: Number(env("RH_TIMEOUT_MS", "8000")),

  ssh: {
    host: env("RH_SSH_HOST"),
    port: Number(env("RH_SSH_PORT", "22")),
    username: env("RH_SSH_USER", "pi"),
    privateKeyPath: env("RH_SSH_KEY") ? expandHome(env("RH_SSH_KEY")) : "",
    password: env("RH_SSH_PASSWORD"),
  },

  /** Rutas en la Raspberry Pi (relativas a $HOME del usuario SSH si empiezan por ~). */
  remote: {
    service: env("RH_SERVICE", "rotorhazard"),
    programDir: env("RH_PROGRAM_DIR", "~/RotorHazard"),
    dataDir: env("RH_DATA_DIR", "~/rh-data"),
    venv: env("RH_VENV", "~/.venv"),
  },
};

export const CHARACTER_LIMIT = 25_000;

export const sshConfigured = (): boolean => Boolean(config.ssh.host);
