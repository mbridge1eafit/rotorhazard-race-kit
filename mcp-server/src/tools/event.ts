import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { rhApi } from "../http.js";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, out, paginate, pagination, responseFormat, text, WIN_CONDITION, START_BEHAVIOR } from "../util.js";
import { RO, W, W_DESTRUCTIVE, W_IDEMPOTENT } from "./annotations.js";

// ---------- Tipos de datos ----------
export interface Pilot {
  id: number;
  callsign: string;
  team: string;
  phonetic: string;
  name: string;
  color: string | null;
  active?: boolean;
}
interface Slot {
  id: number;
  node_index: number | null;
  pilot_id: number;
  method: number;
  seed_rank: number | null;
  seed_id: number | null;
}
interface HeatSock {
  id: number;
  displayname: string;
  name: string | null;
  class_id: number;
  group_id: number;
  status: number;
  auto_frequency: boolean;
  active: boolean;
  locked: boolean;
  dynamic: boolean;
  next_round: number;
  slots: Slot[];
}
interface RaceClass {
  id: number;
  name: string | null;
  displayname: string;
  description: string | null;
  format: number | null;
  win_condition: string;
  rank_method_label?: string;
  ranksettings: unknown;
  rounds: number;
  heat_advance_type: number;
  round_type: number;
  locked: boolean;
}
interface RaceFormat {
  id: number;
  name: string;
  unlimited_time: number;
  race_time_sec: number;
  lap_grace_sec: number;
  staging_fixed_tones: number;
  start_delay_min: number;
  start_delay_max: number;
  locked: boolean;
  staging_delay_tones: number;
  number_laps_win: number;
  win_condition: number;
  team_racing_mode: number;
  start_behavior: number;
  points_method: string | null;
}

// ---------- Lectores comunes ----------
export async function getPilots(signal?: AbortSignal): Promise<Pilot[]> {
  return (await rhApi<{ pilots: Pilot[] }>("api/pilot/all", signal)).pilots;
}
export async function getHeats(): Promise<HeatSock[]> {
  const ev = await loadData(["heat_data"], ["heat_data"]);
  return (ev.heat_data as { heats: HeatSock[] }).heats;
}
/** Vía Socket.IO: /api/class/all provoca warnings 'deprecated attribute' en el log de RotorHazard. */
export async function getClasses(_signal?: AbortSignal): Promise<RaceClass[]> {
  const ev = await loadData(["class_data"], ["class_data"]);
  return (ev.class_data as { classes: RaceClass[] }).classes;
}
/** Vía Socket.IO: el endpoint HTTP /api/format/all provoca warnings con stack trace en el log de RotorHazard. */
export async function getFormats(_signal?: AbortSignal): Promise<RaceFormat[]> {
  const ev = await loadData(["format_data"], ["format_data"]);
  return (ev.format_data as { formats: RaceFormat[] }).formats;
}
const maxId = (arr: Array<{ id: number }>) => arr.reduce((m, x) => Math.max(m, x.id), 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Repite fn hasta que devuelva un valor o venza el plazo. */
async function pollUntil<T>(fn: () => Promise<T | undefined>, timeoutMs = 45_000, everyMs = 800): Promise<T | undefined> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) return undefined;
    await sleep(everyMs);
  }
}

/**
 * Emite un evento de creación y espera (sondeando) a que aparezca un id nuevo.
 * No se fía del evento de respuesta: plugins como Cloudlink hacen llamadas de red síncronas
 * en los hooks de creación y retrasan muchos segundos la respuesta del servidor.
 */
async function createAndFind<T extends { id: number }>(
  event: string,
  data: unknown,
  list: () => Promise<T[]>,
  what: string
): Promise<{ item: T; messages: string[] }> {
  const before = maxId(await list());
  const r = await rhRequest(event, data, { settleMs: 300 });
  const item = await pollUntil(async () => {
    const items = (await list()).filter((x) => x.id > before);
    return items.length ? items.reduce((a, b) => (b.id > a.id ? b : a)) : undefined;
  });
  if (!item) throw new Error(`No apareció ${what} nuevo tras 45 s. Puede haberse creado igualmente: revisa el listado antes de reintentar.`);
  return { item, messages: r.messages };
}

const HEAT_STATUS: Record<number, string> = { 0: "planificado", 1: "proyectado", 2: "confirmado" };

function pilotLabel(p: Pilot | undefined, id: number): string {
  if (!id || id === 0) return "—";
  return p ? `${p.callsign} (${p.id})` : `piloto ${id}`;
}

// ---------- Esquemas ----------
const pilotFields = {
  callsign: z.string().min(1).max(80).optional().describe("Callsign (nombre de piloto en pantalla)"),
  name: z.string().max(120).optional().describe("Nombre real"),
  team: z.string().max(1).optional().describe("Equipo: una letra A-Z (para carreras por equipos)"),
  phonetic: z.string().max(80).optional().describe("Pronunciación para la voz del timer"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Color en hex, p. ej. '#ff0000'"),
};

async function alterPilot(pilot_id: number, f: { callsign?: string; name?: string; team?: string; phonetic?: string; color?: string }) {
  const fields = defined({ callsign: f.callsign, name: f.name, team_name: f.team, phonetic: f.phonetic, color: f.color });
  if (!Object.keys(fields).length) return [];
  const r = await rhRequest("alter_pilot", { pilot_id, ...fields }, { waitFor: ["heat_data"], timeoutMs: 15_000 });
  return r.messages;
}

/** true si exists() pasa a false en <= 15 s (el servidor puede tardar por hooks de plugins). */
async function gone(exists: () => Promise<boolean>): Promise<boolean> {
  return (await pollUntil(async () => ((await exists()) ? undefined : true), 15_000)) === true;
}

/** Quita las claves con valor undefined. */
function defined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

async function alterHeat(data: Record<string, unknown>) {
  return rhRequest("alter_heat", data, { waitFor: ["race_status"], requireAll: true });
}

export function registerEventTools(server: McpServer): void {
  // ======================= PILOTOS =======================
  server.registerTool(
    "rh_list_pilots",
    {
      title: "Listar pilotos",
      description: "Lista los pilotos del evento (id, callsign, nombre, equipo, color). 'search' filtra por callsign o nombre.",
      inputSchema: z.object({ search: z.string().optional().describe("Texto a buscar en callsign/nombre"), ...pagination, response_format: responseFormat }),
      annotations: RO,
    },
    async ({ search, limit, offset, response_format }, ctx) => {
      let pilots = await getPilots(ctx.mcpReq.signal);
      if (search) {
        const q = search.toLowerCase();
        pilots = pilots.filter((p) => p.callsign.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      }
      const page = paginate(pilots, limit, offset);
      return out(response_format, page, () => {
        if (!page.total) return search ? `Ningún piloto coincide con '${search}'.` : "No hay pilotos. Crea con rh_add_pilots.";
        const lines = [`# Pilotos (${page.count} de ${page.total})`, "| id | callsign | nombre | equipo | color |", "|---|---|---|---|---|"];
        for (const p of page.items) lines.push(`| ${p.id} | ${p.callsign} | ${p.name} | ${p.team} | ${p.color ?? ""} |`);
        if (page.has_more) lines.push(`\nMás resultados: offset=${page.next_offset}.`);
        return lines.join("\n");
      });
    }
  );

  server.registerTool(
    "rh_add_pilots",
    {
      title: "Crear pilotos",
      description: `Crea uno o varios pilotos y les asigna callsign, nombre, equipo, fonética y color. Devuelve los ids creados.
Ejemplo: pilots=[{callsign:"Mauri", name:"Mauricio"}, {callsign:"Zeta"}]`,
      inputSchema: z.object({
        pilots: z.array(z.object({ ...pilotFields, callsign: z.string().min(1).max(80).describe("Callsign") })).min(1).max(100),
      }),
      annotations: W,
    },
    async ({ pilots }, ctx) => {
      const created: Array<{ id: number; callsign: string }> = [];
      const messages: string[] = [];
      for (const p of pilots) {
        const { item, messages: m } = await createAndFind("add_pilot", undefined, () => getPilots(ctx.mcpReq.signal), `un piloto para '${p.callsign}'`);
        messages.push(...m, ...(await alterPilot(item.id, p)));
        created.push({ id: item.id, callsign: p.callsign });
      }
      return json({ created, messages });
    }
  );

  server.registerTool(
    "rh_update_pilot",
    {
      title: "Editar piloto",
      description: "Modifica campos de un piloto existente (solo los indicados). Usa rh_list_pilots para obtener el id.",
      inputSchema: z.object({ pilot_id: z.number().int().min(1), ...pilotFields }),
      annotations: W_IDEMPOTENT,
    },
    async ({ pilot_id, ...f }, ctx) => {
      const m = await alterPilot(pilot_id, f);
      const p = (await getPilots(ctx.mcpReq.signal)).find((x) => x.id === pilot_id);
      if (!p) throw new Error(`No existe el piloto ${pilot_id}.`);
      return json({ pilot: p, messages: m });
    }
  );

  server.registerTool(
    "rh_delete_pilot",
    {
      title: "Borrar piloto",
      description: "Elimina un piloto. RotorHazard lo impide si el piloto tiene carreras guardadas. Acción irreversible: confirma con el usuario.",
      inputSchema: z.object({ pilot_id: z.number().int().min(1) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ pilot_id }, ctx) => {
      const r = await rhRequest("delete_pilot", { pilot: pilot_id }, { settleMs: 300 });
      const still = !(await gone(async () => (await getPilots(ctx.mcpReq.signal)).some((p) => p.id === pilot_id)));
      return text(still ? `El piloto ${pilot_id} NO se borró (probablemente tiene carreras guardadas).${msgs(r.messages)}` : `Piloto ${pilot_id} borrado.${msgs(r.messages)}`);
    }
  );

  // ======================= HEATS =======================
  server.registerTool(
    "rh_list_heats",
    {
      title: "Listar heats",
      description: `Lista los heats con su clase, estado y pilotos por slot (incluye node_index y slot id).
'class_id' filtra por clase. Los heats 'locked' ya tienen carreras guardadas.`,
      inputSchema: z.object({ class_id: z.number().int().optional().describe("Filtrar por id de clase"), include_inactive: z.boolean().default(false), response_format: responseFormat }),
      annotations: RO,
    },
    async ({ class_id, include_inactive, response_format }, ctx) => {
      const [heatsAll, pilots, classes] = await Promise.all([getHeats(), getPilots(ctx.mcpReq.signal), getClasses(ctx.mcpReq.signal)]);
      let heats = heatsAll;
      if (class_id !== undefined) heats = heats.filter((h) => h.class_id === class_id);
      if (!include_inactive) heats = heats.filter((h) => h.active !== false);
      const pmap = new Map(pilots.map((p) => [p.id, p]));
      const cmap = new Map(classes.map((c) => [c.id, c.displayname || c.name || `Clase ${c.id}`]));
      const data = {
        heats: heats.map((h) => ({
          id: h.id,
          name: h.displayname,
          class_id: h.class_id,
          class_name: h.class_id ? cmap.get(h.class_id) : null,
          status: HEAT_STATUS[h.status] ?? h.status,
          active: h.active,
          locked: h.locked,
          next_round: h.next_round,
          slots: h.slots.map((s) => ({ slot_id: s.id, node_index: s.node_index, pilot_id: s.pilot_id, callsign: pmap.get(s.pilot_id)?.callsign ?? null, method: s.method })),
        })),
      };
      return out(response_format, data, () => {
        if (!data.heats.length) return "No hay heats. Crea con rh_add_heat o genera con rh_generate_heats.";
        return data.heats
          .map(
            (h) =>
              `## ${h.name} (id ${h.id})${h.locked ? " 🔒" : ""}\n- Clase: ${h.class_name ?? "sin clase"} · estado: ${h.status} · próxima ronda: ${h.next_round}\n` +
              h.slots.map((s) => `  - nodo ${s.node_index === null ? "auto" : Number(s.node_index) + 1}: ${pilotLabel(pmap.get(s.pilot_id), s.pilot_id)}`).join("\n")
          )
          .join("\n\n");
      });
    }
  );

  server.registerTool(
    "rh_add_heat",
    {
      title: "Crear heat",
      description: `Crea un heat, opcionalmente con nombre, clase y pilotos asignados en orden de nodo (el primero al nodo 1, etc.).
Ejemplo: name="Final A", class_id=2, pilot_ids=[3,7,1,5]. Usa 0 para dejar un nodo vacío.`,
      inputSchema: z.object({
        name: z.string().max(80).optional(),
        class_id: z.number().int().min(0).optional().describe("Clase a la que pertenece (0/omitido = sin clase)"),
        pilot_ids: z.array(z.number().int().min(0)).max(16).optional().describe("Pilotos por orden de nodo"),
      }),
      annotations: W,
    },
    async ({ name, class_id, pilot_ids }) => {
      const { item: heat, messages } = await createAndFind("add_heat", class_id ? { class: class_id } : undefined, getHeats, "un heat");
      if (name) messages.push(...(await alterHeat({ heat: heat.id, name })).messages);
      if (pilot_ids?.length) {
        const slots = [...heat.slots].sort((a, b) => (a.node_index ?? 99) - (b.node_index ?? 99));
        if (pilot_ids.length > slots.length) throw new Error(`El heat tiene ${slots.length} slots; se pasaron ${pilot_ids.length} pilotos.`);
        for (let i = 0; i < pilot_ids.length; i++) {
          messages.push(...(await alterHeat({ heat: heat.id, slot_id: slots[i].id, pilot: pilot_ids[i] })).messages);
        }
      }
      return json({ heat_id: heat.id, messages });
    }
  );

  server.registerTool(
    "rh_update_heat",
    {
      title: "Editar heat",
      description: "Cambia nombre, clase, estado activo o asignación automática de frecuencias de un heat.",
      inputSchema: z.object({
        heat_id: z.number().int().min(1),
        name: z.string().max(80).optional(),
        class_id: z.number().int().min(0).optional(),
        active: z.boolean().optional().describe("false = archivar/ocultar el heat"),
        auto_frequency: z.boolean().optional().describe("Asignación automática de nodos/frecuencias"),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ heat_id, name, class_id, active, auto_frequency }) => {
      const messages: string[] = [];
      const changes: Record<string, unknown> = { name, class: class_id, auto_frequency };
      for (const [k, v] of Object.entries(changes)) if (v !== undefined) messages.push(...(await alterHeat({ heat: heat_id, [k]: v })).messages);
      if (active !== undefined) {
        const r = await rhRequest(active ? "activate_heat" : "deactivate_heat", { heat: heat_id }, { settleMs: 800 });
        messages.push(...r.messages);
      }
      const h = (await getHeats()).find((x) => x.id === heat_id);
      if (!h) throw new Error(`No existe el heat ${heat_id}.`);
      return json({ heat: h, messages });
    }
  );

  server.registerTool(
    "rh_set_heat_pilot",
    {
      title: "Asignar piloto a un nodo del heat",
      description: "Asigna (o quita con pilot_id=0) un piloto en el nodo indicado (1..N) de un heat.",
      inputSchema: z.object({
        heat_id: z.number().int().min(1),
        node: z.number().int().min(1).max(16).describe("Número de nodo (1 = primer receptor)"),
        pilot_id: z.number().int().min(0).describe("Id de piloto; 0 = vacío"),
      }),
      annotations: W_IDEMPOTENT,
    },
    async ({ heat_id, node, pilot_id }) => {
      const h = (await getHeats()).find((x) => x.id === heat_id);
      if (!h) throw new Error(`No existe el heat ${heat_id}. Usa rh_list_heats.`);
      const slot = h.slots.find((s) => s.node_index === node - 1) ?? [...h.slots].sort((a, b) => (a.node_index ?? 99) - (b.node_index ?? 99))[node - 1];
      if (!slot) throw new Error(`El heat ${heat_id} no tiene nodo ${node} (tiene ${h.slots.length} slots).`);
      // method 0 = ASSIGN: si el slot quedó en método -1 (NONE) RotorHazard ignora el piloto
      const r = await alterHeat({ heat: heat_id, slot_id: slot.id, method: pilot_id ? 0 : -1, pilot: pilot_id });
      return text(`Nodo ${node} del heat ${heat_id} → piloto ${pilot_id || "vacío"}.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_duplicate_heat",
    {
      title: "Duplicar heat",
      description: "Crea una copia de un heat existente (mismos pilotos y clase).",
      inputSchema: z.object({ heat_id: z.number().int().min(1) }),
      annotations: W,
    },
    async ({ heat_id }) => {
      const { item, messages } = await createAndFind("duplicate_heat", { heat: heat_id }, getHeats, "un heat duplicado");
      return text(`Heat ${heat_id} duplicado como heat ${item.id} (${item.displayname}).${msgs(messages)}`);
    }
  );

  server.registerTool(
    "rh_delete_heat",
    {
      title: "Borrar heat",
      description: "Elimina un heat. No se puede borrar si tiene carreras guardadas (locked). Irreversible: confirma con el usuario.",
      inputSchema: z.object({ heat_id: z.number().int().min(1) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ heat_id }) => {
      const r = await rhRequest("delete_heat", { heat: heat_id }, { settleMs: 300 });
      const still = !(await gone(async () => (await getHeats()).some((h) => h.id === heat_id)));
      return text(still ? `El heat ${heat_id} NO se borró (¿tiene carreras guardadas?).${msgs(r.messages)}` : `Heat ${heat_id} borrado.${msgs(r.messages)}`);
    }
  );

  // ======================= CLASES =======================
  server.registerTool(
    "rh_list_classes",
    {
      title: "Listar clases",
      description: "Lista las clases de carrera (id, nombre, descripción, formato, rondas, método de ranking).",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }, ctx) => {
      const [classes, formats] = await Promise.all([getClasses(ctx.mcpReq.signal), getFormats(ctx.mcpReq.signal)]);
      const fmap = new Map(formats.map((f) => [f.id, f.name]));
      return out(response_format, { classes }, () =>
        classes.length
          ? classes
              .map(
                (c) =>
                  `- **${c.displayname || c.name || "(sin nombre)"}** (id ${c.id})${c.locked ? " 🔒" : ""} · formato: ${c.format ? fmap.get(c.format) ?? c.format : "libre"} · rondas: ${c.rounds || "∞"} · ranking: ${c.rank_method_label ?? (c.win_condition || "—")}${c.description ? `\n  ${c.description}` : ""}`
              )
              .join("\n")
          : "No hay clases. Crea con rh_add_class."
      );
    }
  );

  const classFields = {
    name: z.string().max(80).optional(),
    description: z.string().max(256).optional(),
    format_id: z.number().int().min(0).optional().describe("Formato de carrera fijo para la clase (0 = cualquiera)"),
    rounds: z.number().int().min(0).optional().describe("Nº de rondas (0 = ilimitadas)"),
    rank_method: z.string().optional().describe("Método de ranking (nombre interno, ver rh_load_data types=['raceclass_rank_method_list'])"),
    rank_settings: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Ajustes del método de ranking, p. ej. {wins: 2, finish_laps: 0, ironman: ''} para multigp_chase_the_ace. Cambiar rank_method los borra: mándalos en la misma llamada."),
    round_type: z.enum(["races_per_heat", "grouped"]).optional(),
    heat_advance: z.enum(["none", "next_heat", "next_round"]).optional().describe("Avance automático tras guardar carrera"),
  };

  async function alterClass(class_id: number, f: { name?: string; description?: string; format_id?: number; rounds?: number; rank_method?: string; rank_settings?: Record<string, string | number | boolean>; round_type?: string; heat_advance?: string }) {
    const map: Record<string, unknown> = {
      class_name: f.name,
      class_description: f.description,
      class_format: f.format_id,
      rounds: f.rounds,
      win_condition: f.rank_method,
      rank_settings: f.rank_settings === undefined ? undefined : Object.fromEntries(Object.entries(f.rank_settings).map(([k, v]) => [k, String(v)])),
      round_type: f.round_type === undefined ? undefined : f.round_type === "grouped" ? 1 : 0,
      heat_advance_type: f.heat_advance === undefined ? undefined : { none: 0, next_heat: 1, next_round: 2 }[f.heat_advance],
    };
    const fields = defined(map);
    if (!Object.keys(fields).length) return [];
    // Hooks de plugins (p. ej. Cloudlink) pueden retrasar la escritura: se comprueba sondeando.
    const r = await rhRequest("alter_race_class", { class_id, ...fields }, { settleMs: 500 });
    if (f.name !== undefined) await pollUntil(async () => ((await getClasses()).find((c) => c.id === class_id)?.name === f.name ? true : undefined), 30_000);
    return r.messages;
  }

  server.registerTool(
    "rh_add_class",
    {
      title: "Crear clase",
      description: "Crea una clase de carrera (p. ej. 'Open', 'Tiny Whoop', 'Spec') y configura sus campos.",
      inputSchema: z.object({ ...classFields, name: z.string().min(1).max(80) }),
      annotations: W,
    },
    async (f, ctx) => {
      const { item, messages } = await createAndFind("add_race_class", undefined, getClasses, "una clase");
      const m = await alterClass(item.id, f);
      return json({ class: (await getClasses(ctx.mcpReq.signal)).find((c) => c.id === item.id), messages: [...messages, ...m] });
    }
  );

  server.registerTool(
    "rh_update_class",
    {
      title: "Editar clase",
      description: "Modifica campos de una clase existente.",
      inputSchema: z.object({ class_id: z.number().int().min(1), ...classFields }),
      annotations: W_IDEMPOTENT,
    },
    async ({ class_id, ...f }, ctx) => {
      const m = await alterClass(class_id, f);
      const c = (await getClasses(ctx.mcpReq.signal)).find((x) => x.id === class_id);
      if (!c) throw new Error(`No existe la clase ${class_id}.`);
      return json({ class: c, messages: m });
    }
  );

  server.registerTool(
    "rh_delete_class",
    {
      title: "Borrar clase",
      description: "Elimina una clase (no si tiene carreras guardadas). Irreversible: confirma con el usuario.",
      inputSchema: z.object({ class_id: z.number().int().min(1) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ class_id }, ctx) => {
      const r = await rhRequest("delete_class", { class: class_id }, { settleMs: 300 });
      const still = !(await gone(async () => (await getClasses(ctx.mcpReq.signal)).some((c) => c.id === class_id)));
      return text(still ? `La clase ${class_id} NO se borró.${msgs(r.messages)}` : `Clase ${class_id} borrada.${msgs(r.messages)}`);
    }
  );

  // ======================= FORMATOS =======================
  server.registerTool(
    "rh_list_formats",
    {
      title: "Listar formatos de carrera",
      description: "Lista los formatos (duración, vueltas para ganar, condición de victoria, salida, tonos, gracia).",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }, ctx) => {
      const formats = await getFormats(ctx.mcpReq.signal);
      return out(response_format, { formats }, () =>
        formats
          .map(
            (f) =>
              `- **${f.name}** (id ${f.id}): ${f.unlimited_time ? "tiempo ilimitado" : `${f.race_time_sec}s`}` +
              `${f.lap_grace_sec >= 0 ? ` + gracia ${f.lap_grace_sec}s` : ""} · victoria: ${WIN_CONDITION[f.win_condition] ?? f.win_condition}` +
              `${f.number_laps_win ? ` (${f.number_laps_win} vueltas)` : ""} · salida: ${START_BEHAVIOR[f.start_behavior] ?? f.start_behavior}` +
              ` · delay ${f.start_delay_min}-${f.start_delay_max}ms${f.team_racing_mode ? " · EQUIPOS" : ""}${f.locked ? " 🔒" : ""}${f.points_method ? ` · puntos: ${f.points_method}` : ""}`
          )
          .join("\n")
      );
    }
  );

  const formatFields = {
    name: z.string().max(80).optional(),
    race_time_sec: z.number().int().min(0).optional().describe("Duración en segundos"),
    unlimited_time: z.boolean().optional().describe("true = sin límite de tiempo (cuenta ascendente)"),
    lap_grace_sec: z.number().int().min(-1).optional().describe("Segundos de gracia tras el tiempo (-1 = desactivado)"),
    number_laps_win: z.number().int().min(0).optional().describe("Vueltas para ganar (para 'first_to_x_laps')"),
    win_condition: z
      .enum(["none", "most_progress", "first_to_x_laps", "fastest_lap", "fastest_consecutive", "most_laps", "most_laps_overtime"])
      .optional(),
    start_behavior: z.enum(["holeshot", "first_lap", "staggered"]).optional(),
    start_delay_min_ms: z.number().int().min(0).optional(),
    start_delay_max_ms: z.number().int().min(0).optional(),
    staging_fixed_tones: z.number().int().min(0).optional().describe("Tonos fijos de staging"),
    staging_delay_tones: z.number().int().min(0).max(2).optional().describe("0=ninguno,1=cada segundo,2=..."),
    team_racing_mode: z.number().int().min(0).max(2).optional().describe("0=individual, 1=equipos, 2=co-op"),
    points_method: z.string().optional().describe("Método de puntos (ver rh_load_data types=['race_points_method_list'])"),
  };
  const WC = { none: 0, most_progress: 1, first_to_x_laps: 2, fastest_lap: 3, fastest_consecutive: 4, most_laps: 5, most_laps_overtime: 6 } as const;
  const SB = { holeshot: 0, first_lap: 1, staggered: 2 } as const;

  async function alterFormat(format_id: number, f: z.infer<z.ZodObject<typeof formatFields>>) {
    const map: Record<string, unknown> = {
      format_name: f.name,
      race_time_sec: f.race_time_sec,
      unlimited_time: f.unlimited_time === undefined ? undefined : f.unlimited_time ? 1 : 0,
      lap_grace_sec: f.lap_grace_sec,
      number_laps_win: f.number_laps_win,
      win_condition: f.win_condition === undefined ? undefined : WC[f.win_condition],
      start_behavior: f.start_behavior === undefined ? undefined : SB[f.start_behavior],
      start_delay_min_ms: f.start_delay_min_ms,
      start_delay_max_ms: f.start_delay_max_ms,
      staging_fixed_tones: f.staging_fixed_tones,
      staging_delay_tones: f.staging_delay_tones,
      team_racing_mode: f.team_racing_mode,
      points_method: f.points_method,
    };
    const fields = defined(map);
    if (!Object.keys(fields).length) return [];
    // Si hay carrera activa el servidor no emite format_data y avisa con un mensaje.
    const r = await rhRequest("alter_race_format", { format_id, ...fields }, { waitFor: ["format_data"], timeoutMs: 15_000 });
    return r.messages;
  }

  server.registerTool(
    "rh_add_format",
    {
      title: "Crear formato",
      description: "Crea un formato copiando uno existente (source_format_id) y le aplica los cambios indicados.",
      inputSchema: z.object({ source_format_id: z.number().int().min(1).describe("Formato base a duplicar"), ...formatFields }),
      annotations: W,
    },
    async ({ source_format_id, ...f }, ctx) => {
      const { item, messages } = await createAndFind("add_race_format", { source_format_id }, getFormats, "un formato");
      const m = await alterFormat(item.id, f);
      return json({ format: (await getFormats(ctx.mcpReq.signal)).find((x) => x.id === item.id), messages: [...messages, ...m] });
    }
  );

  server.registerTool(
    "rh_update_format",
    {
      title: "Editar formato",
      description: "Modifica un formato. RotorHazard lo bloquea si hay una carrera activa (para y guarda/descarta antes).",
      inputSchema: z.object({ format_id: z.number().int().min(1), ...formatFields }),
      annotations: W_IDEMPOTENT,
    },
    async ({ format_id, ...f }, ctx) => {
      const m = await alterFormat(format_id, f);
      return json({ format: (await getFormats(ctx.mcpReq.signal)).find((x) => x.id === format_id), messages: m });
    }
  );

  server.registerTool(
    "rh_delete_format",
    {
      title: "Borrar formato",
      description: "Elimina un formato de carrera (no si está en uso por carreras guardadas). Irreversible.",
      inputSchema: z.object({ format_id: z.number().int().min(1) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ format_id }, ctx) => {
      const r = await rhRequest("delete_race_format", { format_id }, { settleMs: 300 });
      const still = !(await gone(async () => (await getFormats(ctx.mcpReq.signal)).some((x) => x.id === format_id)));
      return text(still ? `El formato ${format_id} NO se borró.${msgs(r.messages)}` : `Formato ${format_id} borrado.${msgs(r.messages)}`);
    }
  );

  server.registerTool(
    "rh_set_current_format",
    {
      title: "Activar formato",
      description: "Selecciona el formato de carrera activo (solo con la carrera en estado READY).",
      inputSchema: z.object({ format_id: z.number().int().min(1) }),
      annotations: W_IDEMPOTENT,
    },
    async ({ format_id }) => {
      const r = await rhRequest("set_race_format", { race_format: format_id }, { waitFor: ["race_status"], timeoutMs: 4000 });
      return text(r.missing.length ? `No se pudo cambiar el formato (¿carrera en curso?).${msgs(r.messages)}` : `Formato activo: ${format_id}.${msgs(r.messages)}`);
    }
  );

  // ======================= GENERADOR DE HEATS =======================
  server.registerTool(
    "rh_list_heat_generators",
    {
      title: "Listar generadores de heats",
      description: "Lista los generadores de heats disponibles (incluidos los de plugins) con sus parámetros configurables.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    async () => json((await loadData(["heatgenerator_list"], ["heatgenerator_list"])).heatgenerator_list)
  );

  server.registerTool(
    "rh_generate_heats",
    {
      title: "Generar heats",
      description: `Genera heats con un generador (p. ej. 'balanced_fill' para clasificatorias, 'ladder_params', 'bracket_*'), igual que en Format → Generate Heats.
input_class_id: clase cuyos resultados/pilotos se usan (0 = todos los pilotos sin clase). output_class_id omitido = crea clase nueva.
Los 'params' dependen del generador (consulta rh_list_heat_generators), p. ej. {"qualifiers_per_heat": 4}.`,
      inputSchema: z.object({
        generator: z.string().describe("Nombre interno del generador"),
        input_class_id: z.number().int().min(0).default(0),
        output_class_id: z.number().int().min(1).optional(),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
      annotations: W,
    },
    async ({ generator, input_class_id, output_class_id, params }) => {
      const r = await rhRequest(
        "generate_heats_v2",
        { generator, input_class: input_class_id || null, output_class: output_class_id ?? null, params },
        { waitFor: ["heat_data"], timeoutMs: 20000 }
      );
      return text((r.missing.length ? "La generación no confirmó cambios." : "Heats generados.") + msgs(r.messages) + " Revisa con rh_list_heats.");
    }
  );
}
