# Instrucciones para agentes de IA

Este archivo es para agentes (Claude Code, Codex, Cursor u otros) que instalan, configuran o modifican
este kit en el timer RotorHazard de alguien. Las guías para personas están en `docs/`.

## Qué es cada cosa

| Ruta | Corre en | Lenguaje | Notas |
|---|---|---|---|
| `funciones/<función>/` | — | — | Una carpeta por función, con su `README.md` (la línea `> …` es la descripción que lista el instalador). Las funciones no dependen entre sí ni de plugins de terceros. |
| `funciones/<función>/<dominio>/` | Raspberry Pi, dentro de RotorHazard (`~/rh-data/plugins/<dominio>/`) | Python 3.11 + RHAPI | El plugin: `manifest.json` y `__init__.py` (`initialize(rhapi)`). |
| `funciones/overlays/skr_overlays/static/` | fuente de navegador de OBS | HTML + JS sin dependencias | `common.js` tiene el i18n (es/en) y los parámetros de URL. `/skr/carrera.json` alimenta nodos y próximo heat. |
| `funciones/obs-escena-automatica/rotorhazard_dvr.lua` | dentro de OBS (Windows, macOS, Linux) | Lua 5.1 / LuaJIT (obslua) | Lee `[RotorHazardDVR]` del perfil de OBS. |
| `funciones/obs-escena-automatica/obs-ws.mjs` | PC del usuario | Node.js 22+ | Cliente obs-websocket v5 para pruebas. |
| `mcp-server/` | PC del usuario | TypeScript, Node.js ≥ 20.3 | Servidor MCP (stdio). Configuración solo por variables de entorno (`mcp-server/README.md`). |
| `herramientas/espectro/` | PC del usuario | Node.js | Usa `socket.io-client` de `mcp-server/node_modules`. |
| `scripts/instalar.{sh,ps1}` | PC del usuario | bash 3.2+ / PowerShell | Instala por SSH las funciones elegidas y reinicia el servicio. Sin argumentos lista las funciones. |
| `tests/` | PC | Python | Pruebas sin RotorHazard (módulos simulados). |

Referencias de RotorHazard: `doc/Plugins.md` y `doc/RHAPI.md` del repo oficial (versión 4.5.1 en las pruebas).
Reglamento de Chase the Ace: *2026 MultiGP Rules & Regulations*, sección 7.9.2 (Google Doc enlazado desde
multigp.com → Organizers → Rule Book).

## Lo que hay que preguntarle al usuario (no lo adivines)

- IP (o nombre) de la Pi y usuario SSH; ruta de su clave SSH.
- Credenciales de admin de la web de RotorHazard, si las cambió (por defecto `admin` / `rotorhazard`).
- Qué funciones quiere instalar (lista: `./scripts/instalar.sh` sin argumentos).
- Para OBS: IP del PC de OBS, sistema operativo, contraseña de obs-websocket, nombres exactos de las escenas
  (puedes listarlos con `GetSceneList`), carpeta de grabación tal como la ve ese PC.
- Ids de clase para los overlays y para `orden_heats`; reglas de su final (Aces, Ironman).

## Reglas de seguridad (obligatorias)

1. **Nunca cambies nada con una carrera en curso** (estado `STAGING` o `RACING`). Antes de reiniciar el servidor,
   instalar plugins, cambiar formato o frecuencias, comprueba que esté en `READY` (`rh_get_status` con el MCP).
2. **Backup antes de cualquier operación destructiva** (borrar carreras, heats, clases, pilotos; reset; restore;
   actualizar RotorHazard): `rh_backup_database` y confirma con el usuario.
3. **No leas ni escribas `~/rh-data/database.db` directamente** mientras el servidor corre (sqlite3, Python).
   Ya dejó la base "malformed" en un evento. Usa la API/Socket.IO (el MCP) o copia el archivo primero.
4. **Nada de comandos pesados por SSH en la Pi** (regex largas sobre logs, `find /`, compilaciones): una Pi 3B se
   queda sin RAM y entra en throttling. Lee logs con `tail`/`journalctl -n`.
5. Si el evento tiene **Cloudlink o MultiGP Toolkit** activos, todo lo que crees se replica en su nube: no hagas
   pruebas de escritura sobre el evento real. Prueba con una copia del evento y esos plugins desactivados.
6. **OBS en vivo**: no cambies la escena al aire ni detengas la transmisión o la grabación sin que el usuario lo
   pida. Para probar el plugin usa sus botones o escenas que no estén al aire.
7. No publiques ni copies credenciales (contraseña de obs-websocket, claves SSH, tokens) en archivos del repo.

## Instalar funciones

Preferido (el script guarda la versión anterior fuera de `plugins/` y reinicia):

```bash
SSH_KEY=~/.ssh/<clave> ./scripts/instalar.sh pi@<IP> <función> [<función> ...]   # DRY_RUN=1 para simular
```

```powershell
.\scripts\instalar.ps1 -Destino pi@<IP> -Clave <clave> -Funciones <función>,<función>   # -Simular para simular
```

Con el MCP: `rh_install_plugin_from_file path='<repo>/funciones/<función>/<dominio>' restart=true`.
Después revisa el README de la función: `obs-escena-automatica` necesita configurar OBS y, para el DVR descartado,
cargar `rotorhazard_dvr.lua` en OBS (Herramientas → Scripts); eso lo hace el usuario en el PC de OBS.
A mano: copiar la carpeta a `~/rh-data/plugins/` y `sudo systemctl restart rotorhazard`.

**No dejes copias dentro de `~/rh-data/plugins/`** (p. ej. `skr_overlays.bak/`): RotorHazard intenta cargarlas
como plugins.

## Verificar

- Log tras reiniciar: `journalctl -u rotorhazard -n 200 --no-pager | grep -iE 'plugin|listo|error|Traceback'`.
  Cada plugin escribe una línea al cargar (`obs_auto_escena: listo`, `orden_heats: listo`,
  `skr_overlays: /skr/... listos`).
- Overlays: `curl -s http://<IP>:5000/skr/posiciones.json?clases=todas` devuelve JSON con `classes`,
  `seat_colors` y `lang`.
- Overlays en vivo: `curl -s http://<IP>:5000/skr/carrera.json` devuelve `status`, `heat` y `seats`.
- OBS: botón *Probar conexión* del panel, o `node funciones/obs-escena-automatica/obs-ws.mjs '[["GetVersion"]]'` con `OBS_URL`/`OBS_PASSWORD`.
- Chase the Ace: `rh_get_class_results` de la clase de la final (o el overlay `chase.json`).

## Configurar sin la interfaz web

- Opciones de `obs_auto_escena`: `config.json` sección `OBS_AUTO_ESCENA` (con el MCP: `rh_set_config`, en caliente).
- Opciones de la base del evento (`oh_*`): `rh_set_option`.
- Ajustes del ranking Chase the Ace: van en `rank_settings` de la clase (`rh_update_class`), p. ej.
  `{"wins": "2", "finish_laps": "0", "ironman": ""}`, con `win_condition = "multigp_chase_the_ace"`.

## Pruebas antes de entregar cambios

```bash
python tests/test_chase_the_ace.py
python tests/test_obs_auto_escena.py
python tests/test_skr_overlays.py
python -m py_compile funciones/*/*/__init__.py
node --check funciones/overlays/skr_overlays/static/common.js
DRY_RUN=1 ./scripts/instalar.sh pi@x todas
cd mcp-server && npm install && npm run build && npx tsx scripts/marshal-analysis.test.ts
```

Para los overlays, las páginas se pueden abrir sin la Pi sirviendo `static/` junto a un JSON de ejemplo
(ver el formato en `funciones/overlays/skr_overlays/__init__.py`).
`test_obs_auto_escena.py` simula OBS; el script Lua y la conexión real no tienen prueba automática: pruébalos con
OBS real y una carrera de prueba (staging → detener → guardar, y otra con descartar).

## Convenciones

- Textos de la interfaz en español en los plugins `obs_auto_escena` y `orden_heats`; en inglés en
  `chase_the_ace_rank` (así salieron; no los mezcles dentro de un mismo plugin).
- Sin valores del evento original en el código (IPs, nombres de escenas o de clases): todo va en opciones o en la URL.
- Al cambiar un plugin, sube `version` en su `manifest.json` y actualiza el README de su función.
- Una función nueva = carpeta nueva en `funciones/` con su plugin y un README que empiece con `# Título` y una
  línea `> descripción`. Sin dependencias de plugins de terceros: si hace falta un dato de RotorHazard, léelo con RHAPI.
- Nada de dependencias nuevas en los plugins: el entorno de RotorHazard en la Pi solo trae lo suyo
  (Flask, gevent, websocket-client…).
