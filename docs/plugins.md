# Referencia de los plugins

Dónde se configura cada uno y dónde guarda su configuración.

| Plugin | Versión | Panel en Ajustes | Guarda en |
|---|---|---|---|
| `obs_auto_escena` | 2.0.0 | OBS: cambio automático de escena | `config.json` → `OBS_AUTO_ESCENA` (sobrevive a cambios de evento) |
| `skr_overlays` | 2.0.0 | — (se configura con la URL) | — |
| `chase_the_ace_rank` | 2.0.0 | en cada clase, ajustes del ranking | la clase (`rank_settings`) |
| `orden_heats` | 1.1.0 | Orden de heats entre clases | base del evento (opciones `oh_*`) |
| `option_numeric_fix` | 1.0.0 | — | — |

## obs_auto_escena

| Opción (`config.json`) | Por defecto | |
|---|---|---|
| `enabled` | sí | cambio automático de escena |
| `host` / `port` / `password` | — / 4455 / — | PC de OBS (Windows, Mac o Linux) |
| `scene_race` | `Carrera` | escena al hacer staging (vacío = no cambiar) |
| `scene_next` | `Proximo Heat` | escena al terminar (vacío = no cambiar) |
| `trigger_next` | `save` | `save` = al guardar/descartar, `stop` = al detener |
| `delay_next` | 3 | segundos antes de cambiar al terminar |
| `rec_enabled` | no | DVR por carrera |
| `rec_path` | — | carpeta de grabación en el PC de OBS |
| `rec_stop_delay` | 3 | segundos extra de grabación al detener |
| `rec_discard` | `move` | DVR descartado: `keep`, `move`, `trash`, `delete` |
| `rec_discard_dir` | `descartadas` | subcarpeta para `move` |

Eventos que escucha: `RACE_STAGE`, `RACE_STOP`, `LAPS_SAVE`, `LAPS_DISCARD`. Para el DVR descartado escribe en
el perfil de OBS la sección `[RotorHazardDVR]` (`Discard`, `Mode`, `Folder`, `Subfolder`), que lee
`obs/scripts/rotorhazard_dvr.lua`. Ver [obs.md](obs.md).

## skr_overlays

Rutas `/skr/{ultima-carrera,posiciones,chase,podio}` y sus `.json`; estáticos en
`/skr/static/`. Los JSON incluyen `seat_colors` (de Ajustes → LED) y `lang` (idioma de la interfaz).
Parámetros de URL en [overlays.md](overlays.md).

## chase_the_ace_rank

Rankings de clase:

- `multigp_chase_the_ace` — *MultiGP Chase the Ace (2026 rules)*. Ajustes por clase: `wins` (2),
  `finish_laps` (0 = del formato), `ironman` (callsign o vacío). En el ranking: `wins` (Aces), `position_sum`,
  `last_position`, `status` (`Champion`), `results` (puesto en cada carrera, 0 = nula). En `meta.chase_the_ace`:
  `champion`, `clinched_race`, `wins_needed`, `races`, `void_races`, `max_races`, `ironman`
  (`active` / `disengaged` / `won`).
- *Chase the Ace (Points + Wins + Last Race)* — puntos, victorias, última carrera.

Al guardar una carrera de una clase con el ranking MultiGP, avisa en la interfaz cómo va la final.
Pruebas: `python tests/test_chase_the_ace.py`.

## orden_heats

Opciones: `oh_enabled`, `oh_sequence` (ids de heat), `oh_classes` (ids de clase para generar la secuencia).
Botones: *Generar secuencia intercalada*, *Ir al primer heat pendiente*, *Mostrar secuencia*.
Escucha `LAPS_SAVE`. Requiere *Avance de heat* = Ninguno en esas clases.

## option_numeric_fix

Filtro `OPTION_GET_NUMERIC` para `MinLapSec` y `MinFirstCrossingSec` (bug de RotorHazard 4.5.1).
