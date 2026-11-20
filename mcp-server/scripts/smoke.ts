/**
 * Prueba de humo: arranca el servidor compilado por stdio y llama herramientas.
 *   npm run build && npm run smoke              -> solo lecturas
 *   SMOKE_WRITE=1 npm run smoke                 -> además crea y borra datos de prueba (piloto, clase, heat)
 * Variables: RH_URL, RH_USERNAME, RH_PASSWORD, RH_SSH_HOST, RH_SSH_USER, RH_SSH_KEY
 */
import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const pass = (k: string) => process.env[k] ?? "";
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(
        ["RH_URL", "RH_USERNAME", "RH_PASSWORD", "RH_SSH_HOST", "RH_SSH_USER", "RH_SSH_KEY", "RH_LOCAL_DIR"].filter((k) => pass(k)).map((k) => [k, pass(k)])
      ),
    },
  })
);

const { tools } = await client.listTools();
console.error(`${tools.length} herramientas: ${tools.map((t) => t.name).join(", ")}`);
const { prompts } = await client.listPrompts();
console.error(`${prompts.length} prompts: ${prompts.map((p) => p.name).join(", ")}`);

let failures = 0;
async function call(name: string, args: Record<string, unknown> = {}, expectError = false) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const txt = (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
  const ok = expectError ? r.isError === true : !r.isError;
  if (!ok) failures++;
  console.error(`\n${ok ? "OK " : "FAIL"} ${name} ${JSON.stringify(args)} (${Date.now() - t0} ms)\n${txt.slice(0, 900)}`);
  return { r, txt };
}

// Lecturas
await call("rh_get_status");
await call("rh_get_options", { filter: "event" });
await call("rh_list_pilots");
await call("rh_list_heats");
await call("rh_list_classes");
await call("rh_list_formats");
await call("rh_list_profiles");
await call("rh_get_frequencies");
await call("rh_get_current_race");
await call("rh_get_event_results");
await call("rh_list_installed_plugins");
await call("rh_search_community_plugins", { query: "overlay", limit: 5 });
await call("rh_list_heat_generators");
await call("rh_list_exporters");
await call("rh_list_backups");
await call("rh_load_data", { types: ["min_lap", "race_status"] });
await call("rh_check_updates");
if (process.env.RH_SSH_HOST) {
  await call("rh_system_info");
  await call("rh_service_control", { action: "status" });
  await call("rh_get_logs", { lines: 15 });
  await call("rh_get_config_file");
  await call("rh_update_status", { lines: 10 });
}
// Validación de entrada
await call("rh_set_frequency", { node: 0, band: "R", channel: 1 }, true);
await call("rh_set_frequency", { node: 1, band: "R", channel: 9 }, true);

// Escrituras reversibles.
//  SMOKE_WRITE=1    -> solo pilotos (no dispara hooks externos)
//  SMOKE_WRITE=full -> también clase y heat. OJO: plugins como Cloudlink replican clases/heats en su nube.
if (process.env.SMOKE_WRITE === "1" || process.env.SMOKE_WRITE === "full") {
  const add = await call("rh_add_pilots", { pilots: [{ callsign: "MCP-TEST", name: "Prueba MCP", color: "#00ff00" }] });
  const pid = (add.r.structuredContent as { created: Array<{ id: number }> }).created[0].id;
  await call("rh_update_pilot", { pilot_id: pid, phonetic: "em ce pe test", team: "B" });
  if (process.env.SMOKE_WRITE !== "full") {
    await call("rh_delete_pilot", { pilot_id: pid });
    const after = await call("rh_list_pilots", { search: "MCP-TEST" });
    assert.ok(after.txt.includes("Ningún piloto"), "el piloto de prueba debería haberse borrado");
  }
}
if (process.env.SMOKE_WRITE === "full") {
  const pid = ((await call("rh_list_pilots", { search: "MCP-TEST", response_format: "json" })).r.structuredContent as { items: Array<{ id: number }> }).items[0].id;
  const cls = await call("rh_add_class", { name: "MCP-TEST-CLASS", rounds: 2 });
  const cid = (cls.r.structuredContent as { class: { id: number } }).class.id;
  const heat = await call("rh_add_heat", { name: "MCP-TEST-HEAT", class_id: cid, pilot_ids: [pid] });
  const hid = (heat.r.structuredContent as { heat_id: number }).heat_id;
  await call("rh_list_heats", { class_id: cid });
  await call("rh_set_heat_pilot", { heat_id: hid, node: 1, pilot_id: 0 });
  await call("rh_delete_heat", { heat_id: hid });
  await call("rh_delete_class", { class_id: cid });
  await call("rh_delete_pilot", { pilot_id: pid });
  const after = await call("rh_list_pilots", { search: "MCP-TEST" });
  assert.ok(after.txt.includes("Ningún piloto"), "el piloto de prueba debería haberse borrado");
}

await client.close();
console.error(`\n${failures ? `❌ ${failures} fallos` : "✅ Smoke test superado"}`);
process.exit(failures ? 1 : 0);
