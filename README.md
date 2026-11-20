# RotorHazard Race Kit

Plugins, overlays para OBS, scripts y un servidor MCP para correr un evento de drones FPV con
[RotorHazard](https://github.com/RotorHazard/RotorHazard): OBS cambia de escena y graba solo, hay
overlays de resultados y posiciones, finales **Chase the Ace con el
reglamento MultiGP 2026**, heats intercalados entre clases y un asistente de IA que administra el timer.

Salió de un evento real de tres días (clasificación, round robin Pro/Sport y finales) y se dejó
parametrizable para que cualquiera lo use en su timer.

*English summary at the end.*

## Qué trae

| Carpeta | Qué es |
|---|---|
| [`plugins/obs_auto_escena`](plugins/obs_auto_escena) | Cambia la escena de OBS al iniciar y terminar cada carrera, y graba un DVR por carrera. OBS en **Windows, macOS o Linux**. |
| [`plugins/skr_overlays`](plugins/skr_overlays) | Overlays para OBS: última carrera con tiempos por vuelta, posiciones de varias clases lado a lado, tabla de la final Chase the Ace y podio animado. Español e inglés. |
| [`plugins/chase_the_ace_rank`](plugins/chase_the_ace_rank) | Ranking de clase **MultiGP Chase the Ace** según *2026 MultiGP Rules & Regulations* 7.9.2 (Aces, carreras nulas, suma de puestos, desempate motocross, cláusula Ironman). |
| [`plugins/orden_heats`](plugins/orden_heats) | Corre heats de clases distintas en una secuencia fija (Sport 1, Pro 1, Sport 2…) y la puede generar sola. |
| [`plugins/option_numeric_fix`](plugins/option_numeric_fix) | Arreglo para RotorHazard **4.5.1**: la página Marshal no aplicaba la vuelta mínima. |
| [`obs/`](obs) | Script de OBS para el DVR de las carreras descartadas, CSS para los overlays de Stream Overlays y un cliente de obs-websocket. |
| [`mcp-server/`](mcp-server) | Servidor MCP: le permite a un agente de IA (Claude Code, Claude Desktop u otro cliente MCP) administrar el timer, con 80+ herramientas para eventos, carreras, frecuencias, marshal, plugins, backups y la Pi. |
| [`herramientas/espectro`](herramientas/espectro) | Usa los receptores del timer como analizador de espectro para elegir canales. |
| [`scripts/`](scripts) | Instalar los plugins en la Pi desde Windows (PowerShell) o macOS/Linux (bash). |
| [`docs/`](docs) | Guías paso a paso. |

## Compatibilidad

| | Probado | Debería funcionar |
|---|---|---|
| RotorHazard | 4.5.1 en Raspberry Pi 3B (Raspberry Pi OS bookworm) | 4.5.x; versiones anteriores sin probar (`required_rhapi_version` 1.0–1.2) |
| OBS Studio | 33 en macOS (Apple Silicon), obs-websocket 5.7 | OBS 28+ en Windows, macOS o Linux (obs-websocket v5 viene incluido) |
| Stream Overlays | 1.5.1 (solo para los CSS de `obs/css`) | — |
| PC del MCP | Windows 11, Node.js 24 | Node.js 20.3+ en Windows, macOS o Linux |

## Empezar

1. **Instalar los plugins en el timer** → [docs/instalacion.md](docs/instalacion.md). En resumen:

   ```bash
   git clone https://github.com/mbridge1eafit/rotorhazard-race-kit
   cd rotorhazard-race-kit
   ./scripts/instalar-plugins.sh pi@IP-DE-LA-PI
   ```

   En Windows: `.\scripts\instalar-plugins.ps1 -Destino pi@IP-DE-LA-PI`. También se pueden copiar a mano a `~/rh-data/plugins/` y reiniciar.
2. **Conectar OBS** (cambio de escena y DVR) → [docs/obs.md](docs/obs.md).
3. **Poner los overlays** en OBS → [docs/overlays.md](docs/overlays.md).
4. **Armar el evento** (puntos, round robin, finales Chase the Ace, heats intercalados) → [docs/eventos.md](docs/eventos.md).
5. *(Opcional)* **Administrar el timer con un agente de IA** → [mcp-server/README.md](mcp-server/README.md) y [AGENTS.md](AGENTS.md).
6. *(Opcional)* **Afinar la Raspberry Pi** para el día de carrera → [docs/raspberry-pi.md](docs/raspberry-pi.md).

Antes del evento, lee [docs/lecciones.md](docs/lecciones.md): son los problemas que tuvimos en carrera y cómo evitarlos.

## Para agentes de IA

[AGENTS.md](AGENTS.md) explica la estructura del repo, cómo instalar y verificar cada pieza, las pruebas
y las reglas de seguridad (backups antes de borrar, nada de cambios con una carrera en curso, no leer la
base SQLite en vivo). Claude Code lo carga desde [CLAUDE.md](CLAUDE.md).

## Licencia

MIT, ver [LICENSE](LICENSE). Los plugins se apoyan en la API de plugins de RotorHazard (MIT). Los CSS de
`obs/css` modifican la apariencia del plugin [Stream Overlays](https://github.com/dutchdronesquad/rh-stream-overlays),
que se instala aparte. *MultiGP* y *Chase the Ace* se mencionan solo para describir el formato.

---

## English summary

**RotorHazard Race Kit** is a set of RotorHazard plugins, OBS overlays and scripts, plus an MCP server
for AI agents, built for and tested at a real three-day FPV event:

- `obs_auto_escena`: switches the OBS program scene when a race is staged and when laps are saved, and records one DVR file per race. OBS can run on Windows, macOS or Linux. Discarded races can be kept, moved, sent to the trash or deleted by a companion OBS Lua script.
- `skr_overlays`: OBS browser-source pages (1920×1080, transparent) for the last race with lap times, standings of several classes side by side, the Chase the Ace final table and an animated podium. Language (`?lang=en`), colors, titles and classes are set in the URL.
- `chase_the_ace_rank`: a class ranking that follows the 2026 MultiGP Rules & Regulations 7.9.2. First to two Aces (a win with all laps completed); a race where nobody completes the laps is void; the rest of the podium goes by lowest sum of positions with a motocross tie-break; the Ironman clause is optional. Settings are per class.
- `orden_heats` (interleave heats across classes) and `option_numeric_fix` (RotorHazard 4.5.1 Marshal min-lap bug).
- `mcp-server`: an MCP server with 80+ tools to run the timer from Claude Code or any MCP client.
- `herramientas/espectro`: a spectrum scan using the timer's own receivers to pick clean channels.

The docs are in Spanish; plugin settings and the overlay URL parameters are listed in [docs/plugins.md](docs/plugins.md) and [docs/overlays.md](docs/overlays.md).
