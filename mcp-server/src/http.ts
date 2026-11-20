/** Cliente HTTP para la API JSON pública de RotorHazard (/api/...). */
import { config } from "./config.js";

export function basicAuthHeader(): Record<string, string> {
  if (!config.username && !config.password) return {};
  const token = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
  signal?: AbortSignal
): Promise<Response> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (error) {
    const e = error as Error;
    if (e.name === "TimeoutError") {
      throw new Error(`Sin respuesta de ${url} en ${timeoutMs / 1000}s. ¿Está encendida la Raspberry Pi y en la misma red?`);
    }
    throw new Error(
      `No se pudo conectar con ${url} (${e.message}). Verifica que la Pi esté encendida, que RH_URL sea correcto y que el servicio 'rotorhazard' esté activo (rh_service_control).`
    );
  }
}

/** GET a la API JSON de RotorHazard. path sin barra inicial, p. ej. "api/pilot/all". */
export async function rhApi<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${config.url}/${path.replace(/^\//, "")}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json", ...basicAuthHeader() } }, 15_000, signal);
  if (!res.ok) {
    if (res.status === 401) throw new Error("RotorHazard rechazó las credenciales. Revisa RH_USERNAME/RH_PASSWORD.");
    if (res.status === 404) throw new Error(`Recurso no encontrado: /${path}. Comprueba el ID con la herramienta de listado correspondiente.`);
    throw new Error(`RotorHazard devolvió HTTP ${res.status} en /${path}.`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Respuesta no JSON en /${path}: ${text.slice(0, 200)}`);
  }
}
