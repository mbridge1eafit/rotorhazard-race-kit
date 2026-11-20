# rotorhazard-mcp-server

Servidor MCP para administrar un timer **RotorHazard** (carreras FPV) desde Claude u otro cliente MCP: evento, pilotos, heats, clases, formatos, control de carrera, frecuencias y afinación, plugins comunitarios, backups, exportación, actualizaciones del software y salud de la Raspberry Pi.

Basado en el código y la documentación oficiales de RotorHazard v4.5.1 (`doc/Software Setup.md`, `doc/Plugins.md`, `src/server/server.py`, `json_endpoints.py`, `util/plugin_installation.py`).

## Cómo se comunica

| Canal | Uso | Auth |
|---|---|---|
| API JSON `GET /api/...` | lecturas (pilotos, perfiles, resultados, estado) | — |
| **Socket.IO** (mismo protocolo que la web) | toda la configuración y el control de carreras | Basic Auth de admin en el handshake |
| **SSH** (opcional) | actualizar RotorHazard, servicio systemd, logs, salud de la Pi, backup de `rh-data` | clave privada |
| Internet desde este PC | catálogo de plugins (rhcp.hazardcreative.com), releases de GitHub | — |

## Instalación

Requiere Node.js ≥ 20.3.

```bash
npm install
```

```bash
npm run build
```

## Configuración (variables de entorno)

| Variable | Por defecto | Descripción |
|---|---|---|
| `RH_URL` | `http://127.0.0.1:5000` | URL de la web de RotorHazard |
| `RH_USERNAME` / `RH_PASSWORD` | `admin` / `rotorhazard` | Credenciales de admin (las de fábrica si no se cambiaron) |
| `RH_TIMEOUT_MS` | `8000` | Espera por respuestas Socket.IO |
| `RH_SSH_HOST` | — | Host SSH de la Pi (sin él, las herramientas SSH quedan desactivadas) |
| `RH_SSH_PORT` / `RH_SSH_USER` | `22` / `pi` | |
| `RH_SSH_KEY` | — | Ruta a la clave privada (admite `~`) |
| `RH_SSH_PASSWORD` | — | Alternativa a la clave (no recomendado) |
| `RH_SERVICE` | `rotorhazard` | Nombre del servicio systemd |
| `RH_PROGRAM_DIR` / `RH_DATA_DIR` / `RH_VENV` | `~/RotorHazard` / `~/rh-data` / `~/.venv` | Rutas en la Pi |
| `RH_LOCAL_DIR` | `~/Documents/RotorHazard` | Dónde se guardan backups y exportaciones descargadas |

## Registrar en Claude Code

Cambia la IP de la Pi (`192.168.1.20` en los ejemplos), la ruta de tu clave SSH y la ruta donde clonaste el repo.

Windows (PowerShell):

```powershell
claude mcp add rotorhazard -s user -e RH_URL=http://192.168.1.20:5000 -e RH_SSH_HOST=192.168.1.20 -e RH_SSH_USER=pi -e RH_SSH_KEY=~/.ssh/rotorhazard_ed25519 -- node C:/ruta/rotorhazard-race-kit/mcp-server/dist/index.js
```

macOS / Linux:

```bash
claude mcp add rotorhazard -s user -e RH_URL=http://192.168.1.20:5000 -e RH_SSH_HOST=192.168.1.20 -e RH_SSH_USER=pi -e RH_SSH_KEY=~/.ssh/rotorhazard_ed25519 -- node ~/rotorhazard-race-kit/mcp-server/dist/index.js
```

Si cambiaste las credenciales web, añade `-e RH_USERNAME=... -e RH_PASSWORD=...`.

En Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rotorhazard": {
      "command": "node",
      "args": ["C:/ruta/rotorhazard-race-kit/mcp-server/dist/index.js"],
      "env": {
        "RH_URL": "http://192.168.1.20:5000",
        "RH_SSH_HOST": "192.168.1.20",
        "RH_SSH_USER": "pi",
        "RH_SSH_KEY": "~/.ssh/rotorhazard_ed25519"
      }
    }
  }
}
```

## Herramientas (83)

**Estado y genéricas**: `rh_get_status`, `rh_get_options`, `rh_load_data` (cualquier `load_data` de la web), `rh_emit_event` (cualquier evento Socket.IO, avanzado).

**Pilotos**: `rh_list_pilots`, `rh_add_pilots` (en lote), `rh_update_pilot`, `rh_delete_pilot`.

**Heats**: `rh_list_heats`, `rh_add_heat` (con pilotos por nodo), `rh_update_heat`, `rh_set_heat_pilot`, `rh_duplicate_heat`, `rh_delete_heat`, `rh_list_heat_generators`, `rh_generate_heats`.

**Clases y formatos**: `rh_list_classes`, `rh_add_class`, `rh_update_class`, `rh_delete_class`, `rh_list_formats`, `rh_add_format`, `rh_update_format`, `rh_delete_format`, `rh_set_current_format`.

**Carrera**: `rh_get_current_race`, `rh_set_current_heat`, `rh_stage_race`, `rh_stop_race`, `rh_save_laps`, `rh_discard_laps`, `rh_schedule_race`, `rh_delete_lap`, `rh_simulate_lap`, `rh_broadcast_message`.

**Marshal (carreras guardadas, nativo, sin plugins ni IA externa)**: flujo rápido en 2–3 llamadas:

1. `rh_marshal_review`: revisa toda la carrera en una llamada (pilotos en paralelo). Por piloto da vueltas, rápida, mediana, umbrales y ruido/pico RSSI, y detecta vueltas cortas (doble cruce o bajo la vuelta mínima), vueltas largas con los picos sin registrar, holeshot perdido, pasos tras el final, umbrales en el ruido o sobre el máximo, traza plana (el piloto no fue visto) y piloto 1,7× más lento que la carrera. Propone umbrales alternativos (barrido de la traza) y un **arreglo** listo para `rh_marshal_fix`. No escribe.
2. `rh_marshal_trace` (opcional): traza RSSI en texto (picos con ✓/✗ según tengan paso y serie `t:rssi` reducida) y simulación con otros EnterAt/ExitAt.
3. `rh_marshal_fix`: correcciones en lote para varios pilotos (`delete`/`restore`/`add_at_s`, `enter_at`/`exit_at` + `recalc`, `auto_tune`, `purge_deleted`). `dry_run=true` por defecto; con `false` guarda con `resave_laps` como la página Marshal y verifica.

Selección de carrera en todas: sin argumentos = última guardada; o `race_id`, `heat_id`/`heat_name` (+ `round`), o `callsign` = última carrera de ese piloto. También `rh_marshal_list_races` (filtros por heat y piloto), `rh_marshal_get_race`, `rh_marshal_edit_laps` (un piloto; ahora también con `recalc`/`auto_tune`) y `rh_marshal_reassign_heat`. El recálculo usa el algoritmo de `static/marshal.js` de RH 4.5 (conserva pasos manuales/API) y, por defecto, borra pasos bajo la vuelta mínima conservando el de mayor pico. Prueba offline del análisis: `npx tsx scripts/marshal-analysis.test.ts`.

**Resultados**: `rh_get_event_results`, `rh_get_heat_results`, `rh_get_race_result`, `rh_get_class_results`.

**Timer / RF**: `rh_get_frequencies` (canal, MHz, EnterAt/ExitAt, picos RSSI), `rh_set_frequency` (banda+canal o MHz), `rh_set_frequency_preset` (RB-4, RB-8, IMD5C, All-N1), `rh_set_node_tuning`, `rh_list_profiles`, `rh_set_profile`, `rh_update_profile`, `rh_set_min_lap`, `rh_set_option`, `rh_set_config`.

**Plugins**: `rh_list_installed_plugins`, `rh_search_community_plugins`, `rh_install_plugin` (descarga en este PC con verificación SHA-256 y sube al timer, o la Pi descarga), `rh_install_plugin_from_url`, `rh_install_plugin_from_file` (carpeta o .zip de este PC, p. ej. `../plugins/obs_auto_escena`), `rh_update_all_plugins` (con `dry_run`), `rh_remove_plugin`.

**Datos**: `rh_backup_database`, `rh_list_backups`, `rh_download_backup`, `rh_restore_database`, `rh_reset_database`, `rh_list_exporters`, `rh_export_data`, `rh_import_data`.

**Sistema** (SSH salvo indicación): `rh_restart_server` (Socket.IO), `rh_power` (reboot/shutdown), `rh_service_control`, `rh_get_logs`, `rh_system_info` (temperatura, throttling, disco…), `rh_get_config_file` (SECRETS enmascarados), `rh_backup_data_dir`, `rh_ssh_exec`, `rh_check_updates`, `rh_update_server` (procedimiento oficial `update.sh` en segundo plano con backup previo), `rh_update_status`, `rh_node_firmware` (STM32/S32_BPill).

**Prompts**: `preparar_evento`, `ciclo_de_carrera`, `mantenimiento`.

## Notas importantes

- **Plugins que replican datos**: si tienes **Cloudlink** activo, crear/editar/borrar clases y heats y guardar carreras se replica en su nube; MultiGP Toolkit también puede subir resultados. Las herramientas del MCP disparan los mismos hooks que la web.
- Cloudlink hace llamadas de red síncronas al crear/editar clases: la respuesta del servidor puede tardar varios segundos. Por eso las creaciones esperan sondeando el id nuevo (hasta 45 s) en vez de fiarse del evento de respuesta.
- Las lecturas de formatos y clases van por Socket.IO porque los endpoints `/api/format/all` y `/api/class/all` de RotorHazard 4.5.1 llenan el log de *warnings* con stack trace (atributos obsoletos).
- RotorHazard bloquea cambios de formato y similares con carrera activa; para y guarda/descarta antes.
- Si un evento Socket.IO no responde, lo habitual es que las credenciales de admin no coincidan (el servidor descarta el evento en silencio).
- Tras instalar/eliminar plugins o cambiar `config.json`, reinicia con `rh_restart_server`.

## Pruebas

```bash
npm run build
```

Solo lecturas (más SSH si defines `RH_SSH_*`):

```bash
RH_URL=http://192.168.1.20:5000 npm run smoke
```

`SMOKE_WRITE=1` añade un ciclo crear/editar/borrar de un piloto de prueba (sin efectos externos). `SMOKE_WRITE=full` prueba también clase y heat (ojo: Cloudlink los replica).
