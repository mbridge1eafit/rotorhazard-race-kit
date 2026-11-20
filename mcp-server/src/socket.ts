/**
 * Cliente Socket.IO hacia RotorHazard. La interfaz web usa Socket.IO para todas las
 * operaciones de escritura; aquí se replica ese protocolo.
 *
 * RotorHazard valida la cabecera Basic Auth del handshake (Admin Socket Auth). Si las
 * credenciales fallan, el servidor descarta el evento en silencio: por eso un timeout
 * esperando respuesta suele indicar credenciales incorrectas.
 */
import { io, type Socket } from "socket.io-client";
import { config } from "./config.js";
import { basicAuthHeader } from "./http.js";

export interface RequestOptions {
  /** Eventos de respuesta a esperar (se resuelve al recibir todos o al vencer el tiempo). */
  waitFor?: string[];
  /** Tiempo máximo de espera (ms). */
  timeoutMs?: number;
  /** Si no se espera ningún evento: ventana para recoger mensajes del servidor (ms). */
  settleMs?: number;
  /** Si true, lanza error cuando falte algún evento de waitFor. */
  requireAll?: boolean;
  /** Si true, termina en cuanto llegue un priority_message (usa timeoutMs como máximo). */
  finishOnMessage?: boolean;
  /** Eventos cuyos payloads se acumulan (todas las ocurrencias) en 'collected'. */
  collect?: string[];
  /** Termina cuando llegue el evento 'name' y test(payload) sea true (el último payload queda en events[name]). */
  until?: { name: string; test: (payload: unknown) => boolean };
}

export interface RequestResult {
  events: Record<string, unknown>;
  messages: string[];
  missing: string[];
  collected: Record<string, unknown[]>;
}

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

/**
 * Cierre por inactividad: un socket abierto recibe TODOS los broadcast de RotorHazard
 * (p. ej. result_data, ~600 KB en cada cambio de resultados) y le suma carga a la Pi.
 * Cada sesión de Claude levanta su propio MCP, así que no se deja abierto sin uso.
 * RH_SOCKET_IDLE_MS=0 desactiva el cierre.
 */
const IDLE_MS = Number(process.env.RH_SOCKET_IDLE_MS ?? 60_000);
let inflight = 0;
let idleTimer: NodeJS.Timeout | null = null;

function markBusy(): void {
  inflight++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function markIdle(): void {
  inflight = Math.max(0, inflight - 1);
  if (inflight > 0 || !(IDLE_MS > 0)) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (inflight === 0 && !connecting) closeSocket();
  }, IDLE_MS);
  idleTimer.unref();
}

function getSocket(): Promise<Socket> {
  if (socket?.connected) return Promise.resolve(socket);
  if (connecting) return connecting;

  connecting = new Promise<Socket>((resolve, reject) => {
    const s =
      socket ??
      io(config.url, {
        extraHeaders: basicAuthHeader(),
        reconnection: true,
        reconnectionDelay: 2000,
        timeout: 10_000,
      });
    socket = s;
    if (s.connected) {
      resolve(s);
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `No se pudo abrir Socket.IO con ${config.url} en 10 s. Verifica que la Pi esté encendida y el servicio activo (rh_get_status / rh_service_control).`
        )
      );
    }, 10_000);
    const onConnect = () => {
      cleanup();
      resolve(s);
    };
    const onError = (err: Error) => {
      // socket.io reintenta solo; dejamos que el timer decida, pero guardamos el motivo
      lastError = err.message;
    };
    const cleanup = () => {
      clearTimeout(timer);
      s.off("connect", onConnect);
      s.off("connect_error", onError);
      connecting = null;
    };
    s.on("connect", onConnect);
    s.on("connect_error", onError);
    if (!s.active) s.connect();
  });
  return connecting;
}

let lastError = "";

export function socketState(): { connected: boolean; lastError: string } {
  return { connected: Boolean(socket?.connected), lastError };
}

/** Emite un evento y recoge las respuestas indicadas más cualquier priority_message. */
export async function rhRequest(event: string, data?: unknown, opts: RequestOptions = {}): Promise<RequestResult> {
  markBusy();
  try {
    return await doRequest(event, data, opts);
  } finally {
    markIdle();
  }
}

async function doRequest(event: string, data: unknown, opts: RequestOptions): Promise<RequestResult> {
  const s = await getSocket();
  const waitFor = opts.waitFor ?? [];
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const settleMs = opts.settleMs ?? 700;

  const events: Record<string, unknown> = {};
  const messages: string[] = [];
  const collected: Record<string, unknown[]> = {};

  return await new Promise<RequestResult>((resolve, reject) => {
    const handlers: Array<[string, (...a: unknown[]) => void]> = [];
    let timer: NodeJS.Timeout;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const [ev, h] of handlers) s.off(ev, h);
      const missing = waitFor.filter((e) => !(e in events));
      if (missing.length && opts.requireAll) {
        reject(
          new Error(
            `RotorHazard no respondió a '${event}' (faltan: ${missing.join(", ")}) en ${timeoutMs / 1000}s. ` +
              `Causas habituales: credenciales de admin incorrectas (RH_USERNAME/RH_PASSWORD), carrera en curso que bloquea la operación o servidor reiniciándose.` +
              (messages.length ? ` Mensajes del servidor: ${messages.join(" | ")}` : "")
          )
        );
        return;
      }
      resolve({ events, messages, missing, collected });
    };

    const onMsg = (payload: unknown) => {
      const p = payload as { message?: string };
      if (p?.message) messages.push(String(p.message));
      if (opts.finishOnMessage) finish();
    };
    s.on("priority_message", onMsg);
    handlers.push(["priority_message", onMsg]);

    for (const ev of opts.collect ?? []) {
      collected[ev] = [];
      const h = (payload: unknown) => {
        collected[ev].push(payload);
      };
      s.on(ev, h);
      handlers.push([ev, h]);
    }

    if (opts.until) {
      const u = opts.until;
      const h = (payload: unknown) => {
        events[u.name] = payload;
        if (u.test(payload)) finish();
      };
      s.on(u.name, h);
      handlers.push([u.name, h]);
    }

    for (const ev of waitFor) {
      const h = (payload: unknown) => {
        if (!(ev in events)) events[ev] = payload;
        if (waitFor.every((e) => e in events)) finish();
      };
      s.on(ev, h);
      handlers.push([ev, h]);
    }

    timer = setTimeout(finish, waitFor.length || opts.finishOnMessage || opts.until ? timeoutMs : settleMs);

    if (data === undefined) s.emit(event);
    else s.emit(event, data);
  });
}

/** Atajo: pide uno o varios tipos de 'load_data' y devuelve los eventos recibidos. */
export async function loadData(types: string[], eventNames: string[], timeoutMs?: number): Promise<Record<string, unknown>> {
  const r = await rhRequest("load_data", { load_types: types }, { waitFor: eventNames, timeoutMs, requireAll: true });
  return r.events;
}

export function closeSocket(): void {
  socket?.disconnect();
  socket = null;
}
