# RotorHazard Race Kit

Funciones para correr un evento de drones FPV con [RotorHazard](https://github.com/RotorHazard/RotorHazard):
OBS que cambia de escena y graba solo, overlays propios para la transmisión, finales **Chase the Ace con el
reglamento MultiGP 2026**, heats intercalados entre clases y un servidor MCP que apoya al director de
carrera desde un asistente de IA: crear o editar heats, cambiar frecuencias, revisar el estado de la Raspberry Pi
y más, pidiéndolo en lenguaje natural.

Salió de un evento real de tres días (clasificación, round robin Pro/Sport y finales). Cada función es
**independiente**: instalas solo las que quieras y no necesitan otros plugins.

*English summary at the end.*

## Funciones

| Función | Qué hace | Va en | Requiere |
|---|---|---|---|
| [`obs-escena-automatica`](funciones/obs-escena-automatica) | Cambia la escena de OBS al iniciar y terminar cada carrera y graba un video por carrera. | Pi (+ script opcional en OBS) | OBS 28+ en Windows, macOS o Linux |
| [`overlays`](funciones/overlays) | Overlays propios: el de la carrera sobre los 4 videos (posición, canal, vueltas y aviso de vuelta), próximo heat con el resultado anterior, posiciones de varias clases, Chase the Ace y podio de cualquier clase. Español e inglés. | Pi | OBS (fuente de navegador) |
| [`chase-the-ace`](funciones/chase-the-ace) | Ranking de clase **MultiGP Chase the Ace** según *2026 MultiGP Rules & Regulations* 7.9.2 (Aces, carreras nulas, suma de puestos, desempate motocross, Ironman). | Pi | — |
| [`orden-heats`](funciones/orden-heats) | Corre heats de clases distintas en una secuencia fija (Sport 1, Pro 1, Sport 2…) y la genera sola. | Pi | — |

Cada carpeta trae su README con qué hace, cómo se instala y cómo se configura.

Herramientas para el PC (no se instalan en el timer):

| Carpeta | Qué es |
|---|---|
| [`mcp-server/`](mcp-server) | Apoyo al director de carrera desde Claude Code, Claude Desktop u otro cliente MCP: crear y editar pilotos, heats y clases, cambiar frecuencias, revisar carreras guardadas (marshal), backups, plugins y el estado de la Raspberry Pi (80+ herramientas). El director decide; el asistente hace las tareas repetitivas y revisa. |
| [`herramientas/espectro`](herramientas/espectro) | Usa los receptores del timer como analizador de espectro para elegir canales. |
| [`scripts/`](scripts) | Instalador de funciones (Windows y macOS/Linux). |
| [`docs/`](docs) | Instalación, armado del evento, Raspberry Pi y lecciones aprendidas. |

## Instalar

**Guía paso a paso, sin experiencia previa: [docs/instalacion.md](docs/instalacion.md).**

En resumen: descargas el kit en **tu computador**, abres una terminal en su carpeta y ejecutas el instalador. Este
copia por la red las funciones que elijas a la Raspberry Pi del timer y reinicia RotorHazard (hazlo sin carrera en
curso). Necesitas la IP del timer y el usuario y la contraseña de la Pi.

macOS / Linux:

```bash
bash scripts/instalar.sh pi@192.168.1.20 overlays chase-the-ace
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays,chase-the-ace
```

También se puede [instalar sin terminal](docs/instalacion.md#instalar-sin-terminal), copiando las carpetas con WinSCP
o Cyberduck. Antes del evento, lee [docs/lecciones.md](docs/lecciones.md).

## Compatibilidad

| | Probado | Debería funcionar |
|---|---|---|
| RotorHazard | 4.5.1 en Raspberry Pi 3B (Raspberry Pi OS bookworm) | 4.5.x; versiones anteriores sin probar |
| OBS Studio | 33 en macOS (Apple Silicon), obs-websocket 5.7 | OBS 28+ en Windows, macOS o Linux (obs-websocket v5 viene incluido) |
| PC del MCP | Windows 11, Node.js 24 | Node.js 20.3+ en Windows, macOS o Linux |

## Para agentes de IA

[AGENTS.md](AGENTS.md) explica la estructura, cómo instalar y verificar cada función, las pruebas y las reglas
de seguridad (backups antes de borrar, nada de cambios con una carrera en curso, no leer la base SQLite en vivo).
Claude Code lo carga desde [CLAUDE.md](CLAUDE.md).

## Licencia

MIT, ver [LICENSE](LICENSE). *MultiGP* y *Chase the Ace* se mencionan solo para describir el formato.

---

## English summary

**RotorHazard Race Kit** is a set of independent features for RotorHazard, built for and tested at a real
three-day FPV event. Install only the ones you want with `scripts/instalar.sh` (or `instalar.ps1` on Windows);
none of them needs another plugin.

- `obs-escena-automatica`: switches the OBS program scene when a race is staged and when laps are saved, and records one DVR file per race. OBS can run on Windows, macOS or Linux. A companion OBS Lua script keeps, moves, trashes or deletes the video of a discarded race.
- `overlays`: self-contained OBS browser-source pages (1920×1080, transparent). They show live pilot info over each video feed, the next heat, the last race with lap times, the standings of several classes, the Chase the Ace final table and an animated podium. Language (`?lang=en`), colors, titles and layout are set in the URL. Stream Overlays is not required.
- `chase-the-ace`: a class ranking that follows the 2026 MultiGP Rules & Regulations 7.9.2. First to two Aces (a win with all laps completed); a race where nobody completes the laps is void; the rest go by lowest sum of positions with a motocross tie-break; the Ironman clause is optional.
- `orden-heats`: interleaves heats across classes.
- `mcp-server`: an MCP server (80+ tools) that supports the race director from Claude Code or any MCP client: creating and editing heats, changing frequencies, reviewing saved races, backups and auditing the Raspberry Pi.
- `herramientas/espectro`: a spectrum scan that uses the timer's own receivers to pick clean channels.

The docs are in Spanish. Each feature folder has a README with its settings and the overlay URL parameters.
