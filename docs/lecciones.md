# Lecciones del evento

Problemas reales del evento original (RotorHazard 4.5.1 en Pi 3B, OBS en una MacBook M1, 3 días) y cómo evitarlos.

## Timer y base de datos

- **Heat sin pilotos / "no valid pilots"** aunque el heat los tenga asignados: los slots tenían método
  `-1` (ninguno) y RotorHazard ignoraba al piloto. Asigna el piloto con método "piloto" (0). El MCP de este
  repo ya lo hace al usar `rh_set_heat_pilot`.
- **"database disk image is malformed" a mitad de carrera**: faltaba el `database.db-shm` mientras el servidor
  corría, probablemente por leer la base en vivo con `sqlite3`. Se perdieron las vueltas en memoria de esa
  carrera. Reiniciar el servicio recrea el `-shm`. Nunca toques la base en vivo: usa la web, el MCP o una copia.
- **Reinicio de golpe de la Pi** con dos heats perdidos: ver [raspberry-pi.md](raspberry-pi.md#7-tarjeta-sd-energía-y-backups).
  Backups frecuentes y DVR de cada carrera.
- **Muchos heats → Pi lenta**: con más de ~100 heats y sus carreras, recalcular resultados tarda varios segundos
  tras cada guardado. Para el último día, backup y evento nuevo solo con lo que falta.
- Plugins que **replican datos** (Cloudlink, MultiGP Toolkit) suben a su nube cada clase, heat y carrera que
  crees, también las de prueba. Desactívalos mientras pruebas. MultiGP Toolkit además impide repetir ronda
  en clases que no son de "heats predefinidos".
- RotorHazard 4.5.1: la página Marshal recalculaba sin vuelta mínima → `option_numeric_fix`.

## Radio

- Elige los canales midiendo ([herramientas/espectro](../herramientas/espectro)) y con poca intermodulación
  (IMDTabler). Aun así, en vivo un canal puede verse mal por los propios drones (pasó con R8 y luego F1);
  ten un plan B de 4 canales.
- Al cambiar de canal, revisa el EnterAt/ExitAt de ese nodo con un paso real: el piso de ruido cambia por canal.
- Cambiar frecuencias en el perfil afecta a todas las clases que lo usan: avisa a los pilotos de los heats
  siguientes para que cambien su VTX.
- El escáner nativo de RotorHazard 4.5.1 falla (`TypeError` en `pack_16`); la herramienta de espectro de este
  repo usa otro método.

## OBS y transmisión

- **La IP del PC de OBS cambió dos veces** en tres días (DHCP). El plugin dejó de encontrar OBS. Reserva la IP.
- **Videos de fondo 4K** hicieron que OBS se saltara 1 de cada 4 cuadros al poner la escena de próximo heat.
  Usa videos 1080p con decodificación por hardware.
- **Cadencia 50/60**: la caja de cuadrantes del VRX salía a 50 Hz. Con OBS a 60 fps se veían tirones; todo a 50
  (OBS, capturadora y pantalla) quedó fluido.
- La pantalla grande iba por un **dock DisplayLink** (copia por software, ~30 fps). Pasarla a la salida de video
  nativa del PC lo arregló. En un Mac M1 solo hay una pantalla externa nativa.
- Un **proyector de programa** pesado (vista múltiple) bajaba OBS a 40 fps; un proyector de programa simple
  volvió a 50 fps. OBS no guarda los proyectores al cerrar.
- **Disco externo desconectado** con OBS abierto: todos los videos de OBS se trabaron (duración 0) hasta reiniciar OBS.
- Las fuentes de navegador con "apagar cuando no es visible" recargan al entrar en escena (1–4 s en blanco).
  Las escenas que se ponen al aire a menudo, mejor siempre cargadas.
- Fuentes compartidas entre escenas: un cambio de CSS en una cambia todas. Es útil (los overlays de nodo en dos
  escenas de carrera), pero tenlo en cuenta.
- YouTube: el codificador por software (x264) perdía cuadros en el M1; VideoToolbox por hardware a 8–12 Mbps no.
  Si la red se congestiona, activa la tasa de bits dinámica. Al crear la emisión, proyección **Rectangular**.
- Con el **Modo Estudio** activo los atajos de escena cambian la vista previa, no el aire. El plugin usa
  `SetCurrentProgramScene`, que sí cambia el aire. Decidimos no usar Modo Estudio.

## Stream Overlays 1.5.1

- El overlay de **próximo heat** mostraba el canal del puesto siguiente (mezclaba los datos de los nodos n y n+1)
  en `static/dist/heat.js`. Se corrigió a mano en la Pi; revisa si tu versión lo trae corregido.
- Los textos fijos del plugin están en inglés; se tradujeron a mano en sus `.js`/`.css`. Esos cambios se pierden
  al actualizar el plugin.

## Operación

- Guardar en vez de descartar: con `obs_auto_escena` y `orden_heats`, **guardar** avanza al siguiente heat y
  cambia la escena; **descartar** repite el heat (y manda el DVR a `descartadas/`).
- En las finales Chase the Ace, deja *Avance de heat* = Ninguno para repetir el mismo heat.
- Ten a mano la lista de canales por piloto y por heat para los pits: los cambios de VTX son lo que más atrasa.
