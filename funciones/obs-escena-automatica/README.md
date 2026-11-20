# OBS: cambio automático de escena y DVR por carrera (`obs_auto_escena`)

> Cambia la escena de OBS al iniciar y terminar cada carrera y graba un video por carrera (OBS en Windows, Mac o Linux).

Contiene el plugin `obs_auto_escena` (va en la Pi), el script `rotorhazard_dvr.lua` (va en OBS, opcional, para las
carreras descartadas) y `obs-ws.mjs` (para probar OBS desde la terminal). No necesita otros plugins.

## Instalar

```bash
bash scripts/instalar.sh pi@IP-DE-LA-PI obs-escena-automatica
```

En Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@IP-DE-LA-PI -Funciones obs-escena-automatica`.
Paso a paso, qué ejecutar y dónde: [docs/instalacion.md](../../docs/instalacion.md). O copia la carpeta
`obs_auto_escena` a `~/rh-data/plugins/` y reinicia RotorHazard. Después sigue los pasos de abajo.

El plugin `obs_auto_escena` corre en la Raspberry Pi y le habla a OBS por la red con **obs-websocket v5**
(viene incluido en OBS 28 o más nuevo). OBS puede estar en **Windows, macOS o Linux**: el plugin no cambia.
Lo que cambia entre sistemas son las rutas de grabación, el firewall y algunos detalles que van abajo.

```
 Raspberry Pi (RotorHazard)                     PC de OBS (Windows / Mac / Linux)
 ┌──────────────────────────┐   ws://IP:4455   ┌──────────────────────────────────┐
 │ obs_auto_escena          │ ───────────────▶ │ obs-websocket: escena, grabación │
 │  staging → escena carrera│                  │ rotorhazard_dvr.lua (opcional):  │
 │  guardar → escena final  │                  │  mueve/borra el DVR descartado   │
 │  DVR: grabar por carrera │ ◀─────────────── │ fuentes de navegador → overlays  │
 └──────────────────────────┘  http://PI:5000  └──────────────────────────────────┘
```

## 1. Preparar OBS

1. **Herramientas → Ajustes del servidor WebSocket**: activa el servidor, puerto `4455`, activa la
   autenticación y copia la contraseña (**Mostrar información de conexión**).
2. Anota la **IP del PC de OBS** y resérvala en el router: si cambia, el plugin deja de encontrar OBS.
   - Windows: `ipconfig` (IPv4 del adaptador de la red del timer).
   - macOS: Ajustes del Sistema → Red, o `ipconfig getifaddr en0`.
   - Linux: `ip -4 addr`.
3. **Firewall**: el PC de OBS debe aceptar conexiones entrantes al puerto 4455 desde la Pi.
   - Windows: la primera vez que se activa el servidor, Windows pregunta; permite **redes privadas**.
     Si la red quedó como "pública", cámbiala a privada o abre el puerto 4455 TCP en el Firewall de Windows Defender.
   - macOS: si el firewall está activo, permite conexiones entrantes a OBS.
   - Linux: `sudo ufw allow from <IP-de-la-Pi> to any port 4455 proto tcp` (si usas ufw).
4. Crea (o identifica) dos escenas: la de **carrera** (video de los pilotos + overlays de nodo) y la de
   **terminar** (próximo heat, resultados). Los nombres deben coincidir exactamente con los del plugin.

## 2. Configurar el plugin

En RotorHazard: **Ajustes → OBS: cambio automático de escena**.

| Opción | Qué poner |
|---|---|
| Activar cambio automático | Sí |
| IP o nombre del PC de OBS | p. ej. `192.168.1.50` |
| Puerto / Contraseña WebSocket | `4455` y la contraseña del paso 1 |
| Escena al iniciar la carrera | nombre exacto de la escena de carrera (vacío = no cambiar) |
| Escena al terminar | nombre exacto de la escena de próximo heat (vacío = no cambiar) |
| Cuándo pasar a la escena de terminar | *Al guardar o descartar las vueltas* (recomendado: el overlay de próximo heat ya muestra el heat siguiente) o *Al detener la carrera* |
| Espera antes de cambiar al terminar | segundos para que se vean los tiempos finales (3) |

Botones: **Probar conexión** (muestra versión y sistema de OBS y la escena al aire), **Listar escenas de
OBS** (para copiar los nombres exactos), **Poner escena de carrera / de terminar**.

La configuración queda en `config.json` de la Pi (sección `OBS_AUTO_ESCENA`): sobrevive a cambios de evento
y a reseteos de la base de datos.

## 3. DVR: un archivo por carrera (opcional)

Con **Grabar cada carrera (DVR)** activo, al iniciar cada heat el plugin fija la carpeta y el nombre del
archivo (`<Clase> - <Heat> - R<ronda> <fecha hora>`) y arranca la grabación de OBS. La detiene unos
segundos después de detener la carrera, o al guardar las vueltas si se guarda antes.

**Carpeta de grabación**: la ruta tal como la ve el PC de OBS. La carpeta debe existir.

| Sistema | Ejemplo |
|---|---|
| Windows | `D:/DVR carreras` o `D:\DVR carreras` |
| macOS (disco externo) | `/Volumes/MiDisco/DVR carreras` |
| macOS (disco interno) | `/Users/yo/Movies/DVR carreras` |
| Linux | `/home/yo/Videos/DVR carreras` |

Prueba con el botón **Probar grabación (5 s)**: debe aparecer un archivo `Prueba DVR ...` en esa carpeta.

Recomendaciones de grabación en OBS (Ajustes → Salida → Grabación):

- Formato **MP4 fragmentado** (o MKV): el archivo no se daña si se corta la luz o se cuelga OBS.
- Codificador **por hardware**: NVENC (NVIDIA), AMF (AMD) o QuickSync (Intel) en Windows/Linux;
  **Apple VideoToolbox** en Mac. El de software (x264) le quita CPU a la transmisión.
- Graba en un disco con espacio: a 20 Mbps son ~9 GB por hora.

### Carreras descartadas

Si en RotorHazard se **descartan** las vueltas, el plugin cierra el DVR de esa carrera y, según la opción
**DVR de una carrera descartada**:

| Opción | Qué pasa |
|---|---|
| Conservarlo | nada, queda en la carpeta |
| Moverlo a una subcarpeta (por defecto) | va a `<carpeta>/descartadas/` (nombre configurable) |
| Mandarlo a la papelera | Papelera de reciclaje (Windows), Papelera del disco (Mac), papelera del escritorio (Linux, con `gio`) |
| Borrarlo | se borra definitivamente |

Mover, papelera y borrar los hace el script **`rotorhazard_dvr.lua`** (en esta carpeta), que corre dentro de OBS
(el archivo está en el PC de OBS, no en la Pi; en macOS, además, el sistema no deja tocar los discos
externos por SSH). Para cargarlo: **Herramientas → Scripts → "+"** y elige el archivo. En el log de
scripts debe salir `RotorHazard DVR: listo (Windows|macOS|Linux)`.

El script solo toca archivos de video que estén **dentro** de la carpeta de grabación. Si la papelera
falla, mueve el video a la subcarpeta en vez de borrarlo.
En Windows, la papelera usa PowerShell: se puede ver un instante una ventana de consola. Si molesta
durante la transmisión, usa *Moverlo a una subcarpeta*.

## 4. Diferencias entre Windows, macOS y Linux

| Tema | Windows | macOS | Linux |
|---|---|---|---|
| Atajos de teclado para escenas | Ctrl+Alt+Shift+número | Ctrl+Opción+Shift+número (Opción = Alt) | Ctrl+Alt+Shift+número |
| Codificador por hardware | NVENC / AMF / QuickSync | Apple VideoToolbox | NVENC / VAAPI |
| Discos externos | sin restricciones | conectar **antes** de abrir OBS; si se desconecta, los videos de OBS se traban hasta reiniciarlo | montar antes de abrir OBS |
| Acceso a carpetas | — | OBS necesita permiso para Escritorio/Documentos/Descargas (Ajustes del Sistema → Privacidad); si no, los videos de fondo abren con duración 0 | — |
| Papelera del DVR | Papelera de reciclaje (PowerShell) | `.Trashes` del disco o `~/.Trash` | `gio trash` o `~/.local/share/Trash` |
| Captura de pantalla | Captura de pantalla / ventana | requiere permiso de Grabación de pantalla | PipeWire en Wayland |

## 5. Rendimiento (lo que aprendimos)

- Pon el **lienzo de OBS** en la resolución de la pantalla o proyector (normalmente 1920×1080) y los fps
  según tu cámara o caja de video: si la caja de cuadrantes del VRX sale a 50 Hz (PAL), usa **50 fps** en
  OBS y en la pantalla; a 60 fps se notan tirones.
- **Videos de fondo**: usa archivos 1080p y activa *Usar decodificación por hardware* en la fuente
  Multimedia. Un video 4K de fondo llevó a OBS a 25 ms por cuadro (se saltaba 1 de cada 4).
- **Fuentes de navegador que leen la Pi**: con *Apagar la fuente cuando no es visible* cada cambio de escena
  recarga la página (1–4 s en blanco). Si el cambio debe ser instantáneo, déjalas siempre cargadas; la Pi
  aguanta bien ~7 fuentes consultando cada 3 s.
- **Modo Estudio**: el plugin usa `SetCurrentProgramScene`, que cambia el programa (lo que sale al aire)
  aunque el Modo Estudio esté activo. Si usas un proyector de programa a pantalla completa, OBS no lo
  guarda al cerrar: hay que volver a abrirlo cada vez.
- Cuando OBS transmite a YouTube y el emisor pide crear una emisión nueva, eso se hace en OBS
  (*Gestionar emisión*), no por WebSocket. Elige proyección **Rectangular** (no 360°).

## 6. Problemas comunes

| Síntoma | Causa probable |
|---|---|
| "OBS: sin conexión: [Errno 111] Connection refused" | servidor WebSocket apagado, IP o puerto equivocado, firewall |
| "OBS pide contraseña y no está configurada" / "rechazó la conexión" | contraseña vacía o distinta |
| "No source was found by the name of…" | el nombre de la escena no coincide (mayúsculas, tildes, espacios). Usa **Listar escenas de OBS** |
| La grabación no arranca | la carpeta no existe en el PC de OBS, o el disco externo no está conectado |
| El DVR descartado no se mueve | falta cargar `rotorhazard_dvr.lua` en OBS (Herramientas → Scripts) |
| Dejó de funcionar de un día para otro | cambió la IP del PC de OBS (reserva la IP en el router) |

Para probar OBS desde la terminal está `obs-ws.mjs` (en esta carpeta, Node.js 22+):

```bash
OBS_URL=ws://192.168.1.50:4455 OBS_PASSWORD=... node funciones/obs-escena-automatica/obs-ws.mjs '[["GetVersion"],["GetSceneList"]]'
```

En PowerShell: `$env:OBS_URL="ws://192.168.1.50:4455"; $env:OBS_PASSWORD="..."; node funciones/obs-escena-automatica/obs-ws.mjs '[["GetVersion"]]'`.

## Referencia

| Opción (`config.json` → `OBS_AUTO_ESCENA`) | Por defecto | |
|---|---|---|
| `enabled` | sí | cambio automático de escena |
| `host` / `port` / `password` | — / 4455 / — | PC de OBS |
| `scene_race` / `scene_next` | `Carrera` / `Proximo Heat` | escenas (vacío = no cambiar) |
| `trigger_next` | `save` | `save` = al guardar/descartar, `stop` = al detener |
| `delay_next` | 3 | segundos antes de cambiar al terminar |
| `rec_enabled` / `rec_path` / `rec_stop_delay` | no / — / 3 | DVR por carrera |
| `rec_discard` / `rec_discard_dir` | `move` / `descartadas` | DVR descartado: `keep`, `move`, `trash`, `delete` |

Escucha `RACE_STAGE`, `RACE_STOP`, `LAPS_SAVE` y `LAPS_DISCARD`. Para el DVR descartado escribe en el perfil de
OBS la sección `[RotorHazardDVR]` (`Discard`, `Mode`, `Folder`, `Subfolder`), que lee `rotorhazard_dvr.lua`.
Pruebas: `python tests/test_obs_auto_escena.py`.
