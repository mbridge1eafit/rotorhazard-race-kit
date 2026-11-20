import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { zipSync } from "fflate";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { fetchWithTimeout } from "../http.js";
import { loadData, rhRequest } from "../socket.js";
import { json, msgs, out, paginate, pagination, responseFormat, text } from "../util.js";
import { RO, W, W_DESTRUCTIVE } from "./annotations.js";

/** Catálogo oficial de plugins comunitarios (el mismo que consulta RotorHazard). */
const RHCP_DATA = "https://rhcp.hazardcreative.com/v1/plugin/data.json";

interface Manifest {
  domain: string;
  name: string;
  author?: string;
  description?: string;
  documentation_uri?: string;
  required_rhapi_version?: string;
  version?: string;
  category?: string[];
  zip_filename?: string;
}
interface Release {
  tag_name: string;
  published_at: string;
  prerelease: boolean;
  assets?: Array<{ name: string; sha256?: string | null }>;
}
interface RemotePlugin {
  manifest: Manifest;
  repository: string;
  last_version: string | null;
  last_prerelease?: string | null;
  last_updated?: string;
  releases: Release[];
}
interface InstalledPlugin {
  id: string;
  name: string | null;
  version: string | null;
  author: string | null;
  enabled: boolean;
  loaded: boolean;
  load_issue: string | null;
  update_status: string | number | null;
  required_rhapi_version: string | null;
}

/** Códigos _PluginStatus de RotorHazard. */
const UPDATE_STATUS: Record<string, string> = {
  "1": "estado desconocido",
  "2": "no instalado",
  "3": "beta disponible",
  "4": "ACTUALIZACIÓN disponible",
  "5": "al día",
};
const statusText = (s: string | number | null) => (s === null || s === undefined ? "" : UPDATE_STATUS[String(s)] ?? String(s));
const v = (s: string | null | undefined) => (s ? s.replace(/^v/i, "") : "?");

let cache: { at: number; data: Record<string, RemotePlugin> } | null = null;

async function catalog(signal?: AbortSignal): Promise<RemotePlugin[]> {
  if (!cache || Date.now() - cache.at > 10 * 60_000) {
    const res = await fetchWithTimeout(RHCP_DATA, { headers: { Accept: "application/json" } }, 20_000, signal);
    if (!res.ok) throw new Error(`El catálogo de plugins (${RHCP_DATA}) devolvió HTTP ${res.status}. Reintenta más tarde.`);
    cache = { at: Date.now(), data: (await res.json()) as Record<string, RemotePlugin> };
  }
  return Object.values(cache.data);
}

async function installed(): Promise<InstalledPlugin[]> {
  const ev = await loadData(["plugin_list"], ["plugin_list"]);
  return (ev.plugin_list as { plugins: InstalledPlugin[] }).plugins;
}

/** Descarga el zip de un plugin desde GitHub (mismo criterio que RotorHazard: asset <domain>.zip o archivo del tag). */
async function downloadPluginZip(p: RemotePlugin, tag: string, signal?: AbortSignal): Promise<{ buf: Buffer; url: string; verified: boolean }> {
  const rel = p.releases.find((r) => r.tag_name === tag);
  if (!rel) throw new Error(`El plugin ${p.manifest.domain} no tiene la versión '${tag}'. Disponibles: ${p.releases.map((r) => r.tag_name).join(", ")}`);
  const asset = rel.assets?.find((a) => a.name === `${p.manifest.domain}.zip`);
  const url = asset
    ? `https://github.com/${p.repository}/releases/download/${tag}/${asset.name}`
    : `https://github.com/${p.repository}/archive/refs/tags/${tag}.zip`;
  const res = await fetchWithTimeout(url, { redirect: "follow" }, 60_000, signal);
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  let verified = false;
  if (asset?.sha256) {
    const h = createHash("sha256").update(buf).digest("hex");
    if (h !== asset.sha256) throw new Error(`El hash SHA-256 del zip descargado no coincide con el del catálogo. Instalación abortada.`);
    verified = true;
  }
  return { buf, url, verified };
}

async function uploadZip(buf: Buffer): Promise<string[]> {
  const r = await rhRequest("plugin_install", { method: "upload", source_data: buf }, { finishOnMessage: true, timeoutMs: 90_000 });
  return r.messages;
}

function installResult(messages: string[]): string {
  if (!messages.length) return "⚠ Sin confirmación del servidor. Verifica con rh_list_installed_plugins tras reiniciar, o revisa rh_get_logs.";
  const failed = messages.some((m) => /fail|fall/i.test(m));
  return (failed ? "❌ La instalación falló." : "✅ Plugin instalado. Requiere reiniciar el servidor (rh_restart_server).") + msgs(messages);
}

export function registerPluginTools(server: McpServer): void {
  server.registerTool(
    "rh_list_installed_plugins",
    {
      title: "Plugins instalados",
      description: "Plugins externos instalados en el timer: versión, si cargaron bien, errores de carga y si hay actualización disponible.",
      inputSchema: z.object({ response_format: responseFormat }),
      annotations: RO,
    },
    async ({ response_format }) => {
      const list = (await installed()).map((p) => ({ ...p, update_status_text: statusText(p.update_status) }));
      return out(response_format, { plugins: list }, () =>
        list.length
          ? list
              .map(
                (p) =>
                  `- **${p.name ?? p.id}** (\`${p.id}\`) v${v(p.version)} · ${p.loaded ? "cargado" : "NO cargado"}${p.enabled ? "" : " · deshabilitado"}` +
                  `${p.update_status ? ` · ${statusText(p.update_status)}` : ""}${p.load_issue ? `\n  ⚠ ${p.load_issue}` : ""}`
              )
              .join("\n")
          : "No hay plugins externos instalados."
      );
    }
  );

  server.registerTool(
    "rh_search_community_plugins",
    {
      title: "Buscar plugins comunitarios",
      description: `Busca en el catálogo oficial de plugins comunitarios de RotorHazard (rhcp.hazardcreative.com) por nombre, descripción, autor o categoría.
Muestra el 'domain' (id para instalar), versión, categoría y si ya está instalado. Ejemplos: query="multigp", "overlay", "led", "points".`,
      inputSchema: z.object({
        query: z.string().optional().describe("Texto a buscar; vacío = todos"),
        category: z.string().optional().describe("Filtrar por categoría, p. ej. 'Data Exporters', 'Class Rankings', 'Event Management'"),
        ...pagination,
        response_format: responseFormat,
      }),
      annotations: RO,
    },
    async ({ query, category, limit, offset, response_format }, ctx) => {
      let list = await catalog(ctx.mcpReq.signal);
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((p) =>
          [p.manifest.domain, p.manifest.name, p.manifest.description, p.manifest.author, ...(p.manifest.category ?? [])].some((s) => s?.toLowerCase().includes(q))
        );
      }
      if (category) list = list.filter((p) => p.manifest.category?.some((c) => c.toLowerCase().includes(category.toLowerCase())));
      list.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
      let inst: Map<string, InstalledPlugin> = new Map();
      try {
        inst = new Map((await installed()).map((p) => [p.id, p]));
      } catch {
        /* timer apagado: se muestra solo el catálogo */
      }
      const rows = list.map((p) => ({
        domain: p.manifest.domain,
        name: p.manifest.name,
        author: p.manifest.author,
        description: p.manifest.description,
        category: p.manifest.category,
        latest_version: p.last_version ?? p.last_prerelease ?? null,
        required_rhapi_version: p.manifest.required_rhapi_version,
        repository: p.repository,
        docs: p.manifest.documentation_uri,
        installed_version: inst.get(p.manifest.domain)?.version ?? null,
      }));
      const page = paginate(rows, limit, offset);
      return out(response_format, page, () => {
        if (!page.total) return "Sin coincidencias en el catálogo.";
        const lines = [`# Plugins comunitarios (${page.count} de ${page.total})`];
        for (const p of page.items)
          lines.push(
            `- **${p.name}** \`${p.domain}\` v${v(p.latest_version)} — ${p.author ?? ""}${p.category?.length ? ` [${p.category.join(", ")}]` : ""}` +
              `${p.installed_version ? ` · instalado v${v(p.installed_version)}` : ""}\n  ${p.description ?? ""}`
          );
        if (page.has_more) lines.push(`\nMás: offset=${page.next_offset}.`);
        return lines.join("\n");
      });
    }
  );

  server.registerTool(
    "rh_install_plugin",
    {
      title: "Instalar/actualizar plugin comunitario",
      description: `Instala o actualiza un plugin del catálogo comunitario por su 'domain' (ver rh_search_community_plugins).
mode='download_here' (por defecto): este PC descarga el zip de GitHub (verificando SHA-256 si existe) y lo sube al timer — funciona aunque la Pi no tenga internet.
mode='timer': la propia Pi lo descarga (necesita internet).
Tras instalar hay que reiniciar el servidor (restart=true lo hace automáticamente).`,
      inputSchema: z.object({
        domain: z.string().min(1).describe("Id del plugin, p. ej. 'stream_overlays'"),
        version: z.string().optional().describe("Tag de versión; omitido = última estable"),
        mode: z.enum(["download_here", "timer"]).default("download_here"),
        restart: z.boolean().default(false).describe("Reiniciar el servidor RotorHazard tras instalar"),
      }),
      annotations: W,
    },
    async ({ domain, version, mode, restart }, ctx) => {
      const p = (await catalog(ctx.mcpReq.signal)).find((x) => x.manifest.domain === domain);
      if (!p) throw new Error(`'${domain}' no está en el catálogo comunitario. Busca con rh_search_community_plugins o usa rh_install_plugin_from_url.`);
      const tag = version ?? p.last_version ?? p.last_prerelease;
      if (!tag) throw new Error(`No hay versiones publicadas para ${domain}.`);
      let messages: string[];
      let detail = "";
      if (mode === "timer") {
        const r = await rhRequest("plugin_install", { method: "domain", domain, tag }, { finishOnMessage: true, timeoutMs: 120_000 });
        messages = r.messages;
      } else {
        const z1 = await downloadPluginZip(p, tag, ctx.mcpReq.signal);
        detail = `\nOrigen: ${z1.url} (${(z1.buf.length / 1024).toFixed(0)} KB${z1.verified ? ", SHA-256 verificado" : ", sin hash publicado"})`;
        messages = await uploadZip(z1.buf);
      }
      let res = `${domain} v${v(tag)}:${installResult(messages)}${detail}`;
      if (restart && !messages.some((m) => /fail|fall/i.test(m))) {
        await rhRequest("restart_server", undefined, { settleMs: 500 });
        res += "\nReinicio del servidor solicitado (tarda ~10-20 s).";
      }
      return text(res);
    }
  );

  server.registerTool(
    "rh_install_plugin_from_url",
    {
      title: "Instalar plugin desde un zip",
      description: `Descarga un zip de plugin desde una URL (p. ej. asset de una release de GitHub) y lo sube al timer.
El zip debe contener una carpeta <domain>/ con __init__.py (y idealmente manifest.json). Úsalo para plugins fuera del catálogo; confirma la fuente con el usuario.`,
      inputSchema: z.object({ url: z.url().describe("URL https del .zip"), restart: z.boolean().default(false) }),
      annotations: W,
    },
    async ({ url, restart }, ctx) => {
      const res = await fetchWithTimeout(url, { redirect: "follow" }, 60_000, ctx.mcpReq.signal);
      if (!res.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status}).`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 2).toString() !== "PK") throw new Error("El archivo descargado no es un zip.");
      const messages = await uploadZip(buf);
      let out2 = installResult(messages);
      if (restart && !messages.some((m) => /fail|fall/i.test(m))) {
        await rhRequest("restart_server", undefined, { settleMs: 500 });
        out2 += "\nReinicio solicitado.";
      }
      return text(out2);
    }
  );

  server.registerTool(
    "rh_install_plugin_from_file",
    {
      title: "Instalar plugin desde este PC",
      description: `Instala un plugin desde una carpeta o un .zip de ESTE PC (p. ej. un plugin propio en desarrollo) subiéndolo al timer,
igual que 'Upload plugin' en Settings → Plugins. La carpeta debe ser la del plugin (<domain>/ con __init__.py y manifest.json);
se empaqueta sin __pycache__ ni .git. Sustituye la versión instalada con el mismo domain. Requiere reinicio (restart=true).`,
      inputSchema: z.object({
        path: z.string().min(1).describe("Ruta local de la carpeta del plugin o de un .zip"),
        restart: z.boolean().default(false),
      }),
      annotations: W,
    },
    async ({ path, restart }) => {
      const { buf, domain } = packPlugin(path);
      const messages = await uploadZip(buf);
      let res = `${domain ?? "plugin"} (${(buf.length / 1024).toFixed(0)} KB): ${installResult(messages)}`;
      if (restart && !messages.some((m) => /fail|fall/i.test(m))) {
        await rhRequest("restart_server", undefined, { settleMs: 500 });
        res += "\nReinicio solicitado (tarda ~10-20 s; verifica con rh_list_installed_plugins).";
      }
      return text(res);
    }
  );

  server.registerTool(
    "rh_update_all_plugins",
    {
      title: "Actualizar todos los plugins",
      description: "Compara los plugins instalados con el catálogo y actualiza los que tengan versión más nueva (dry_run=true solo informa).",
      inputSchema: z.object({ dry_run: z.boolean().default(true), restart: z.boolean().default(false) }),
      annotations: W,
    },
    async ({ dry_run, restart }, ctx) => {
      const [cat, inst] = await Promise.all([catalog(ctx.mcpReq.signal), installed()]);
      const cmap = new Map(cat.map((p) => [p.manifest.domain, p]));
      const plan = inst
        .filter((i) => cmap.has(i.id))
        .map((i) => ({ domain: i.id, installed: i.version, latest: cmap.get(i.id)!.last_version }))
        .filter((x) => x.latest && x.installed && cmpVer(x.latest, x.installed) > 0);
      const notInCatalog = inst.filter((i) => !cmap.has(i.id)).map((i) => i.id);
      if (dry_run || !plan.length) return json({ updates_available: plan, not_in_catalog: notInCatalog, applied: false });
      const results: Array<{ domain: string; result: string }> = [];
      for (const u of plan) {
        const z1 = await downloadPluginZip(cmap.get(u.domain)!, u.latest!, ctx.mcpReq.signal);
        results.push({ domain: u.domain, result: installResult(await uploadZip(z1.buf)) });
      }
      if (restart) await rhRequest("restart_server", undefined, { settleMs: 500 });
      return json({ applied: true, results, restarted: restart });
    }
  );

  server.registerTool(
    "rh_remove_plugin",
    {
      title: "Desinstalar plugin",
      description: "Borra la carpeta de un plugin instalado (id de rh_list_installed_plugins). Requiere reinicio. Confirma con el usuario.",
      inputSchema: z.object({ plugin_id: z.string().min(1), restart: z.boolean().default(false) }),
      annotations: W_DESTRUCTIVE,
    },
    async ({ plugin_id, restart }) => {
      const r = await rhRequest("plugin_delete", { domain: plugin_id }, { finishOnMessage: true, timeoutMs: 15_000 });
      let t = `Eliminación de '${plugin_id}' solicitada.${msgs(r.messages)}`;
      if (restart && !r.messages.some((m) => /fail|fall/i.test(m))) {
        await rhRequest("restart_server", undefined, { settleMs: 500 });
        t += "\nReinicio solicitado.";
      }
      return text(t);
    }
  );
}

/** Compara versiones tipo semver (1.10.0 > 1.9.2). */
export function cmpVer(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.-]/);
  const pb = b.replace(/^v/i, "").split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Empaqueta una carpeta de plugin (o lee un .zip) para subirlo con method 'upload'. */
export function packPlugin(path: string): { buf: Buffer; domain: string | null } {
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`No existe ${full}.`);
  if (statSync(full).isFile()) {
    const buf = readFileSync(full);
    if (buf.subarray(0, 2).toString() !== "PK") throw new Error(`${full} no es un .zip.`);
    return { buf, domain: null };
  }
  if (!existsSync(join(full, "__init__.py"))) throw new Error(`${full} no parece un plugin: falta __init__.py.`);
  let domain = basename(full);
  try {
    domain = (JSON.parse(readFileSync(join(full, "manifest.json"), "utf-8")) as { domain?: string }).domain ?? domain;
  } catch {
    /* sin manifest: RotorHazard usa el nombre de la carpeta */
  }
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "__pycache__" || name === ".git" || name.endsWith(".pyc")) continue;
      const f = join(dir, name);
      if (statSync(f).isDirectory()) walk(f);
      else files[`${domain}/${relative(full, f).split("\\").join("/")}`] = readFileSync(f);
    }
  };
  walk(full);
  return { buf: Buffer.from(zipSync(files, { level: 6 })), domain };
}
