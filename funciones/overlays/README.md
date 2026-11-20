# Overlays para OBS (`skr_overlays`)

> Overlays propios para la transmisión: carrera en vivo sobre los videos, próximo heat con resultado anterior, posiciones, Chase the Ace y podio de cualquier clase.

Páginas de 1920×1080 con fondo transparente que se ponen en OBS como **fuente de navegador**. Es un solo
plugin y **no depende de ningún otro**: lee la carrera en curso y la base de datos de RotorHazard directamente
(no hace falta el plugin Stream Overlays). Se actualizan solas.

## Instalar

```bash
bash scripts/instalar.sh pi@IP-DE-LA-PI overlays
```

En Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@IP-DE-LA-PI -Funciones overlays`.
Paso a paso, qué ejecutar y dónde: [docs/instalacion.md](../../docs/instalacion.md). O copia la carpeta
`skr_overlays` a `~/rh-data/plugins/` de la Pi y reinicia RotorHazard. Prueba abriendo en el navegador
`http://IP-DE-LA-PI:5000/skr/proximo-heat`.

## Páginas

Reemplaza `PI` por la IP del timer con el puerto (p. ej. `192.168.1.20:5000`).

| Página | URL | Qué muestra | Se actualiza |
|---|---|---|---|
| Carrera (en vivo) | `http://PI/skr/nodos` | **El overlay de la carrera**, una sola fuente sobre los 4 cuadros del video: posición, canal, tarjeta con piloto, vuelta, tiempo total, holeshot (S) y cada vuelta, y aviso grande en cada vuelta nueva. | cada 0,5 s |
| Próximo heat | `http://PI/skr/proximo-heat` | Pilotos del heat actual con su canal grande y su color, para que vayan a los pits a cambiar el VTX. | cada 2 s |
| Última carrera | `http://PI/skr/ultima-carrera` | Resultado de la última carrera guardada: posición, piloto, canal, vueltas, mejor tiempo y cada vuelta (la más rápida resaltada). | cada 3 s |
| Próximo + anterior | `http://PI/skr/proximo-y-anterior` | Las dos anteriores en una sola fuente: próximo heat arriba y resultado de la última carrera abajo. | — |
| Posiciones | `http://PI/skr/posiciones?clases=2,3` | Tablas de una o varias clases lado a lado: posición, piloto, puntos, baterías corridas y victorias, con zona de final. | cada 3 s |
| Chase the Ace | `http://PI/skr/chase` | Final en curso: Aces (A♠), puesto en cada carrera, suma de puestos y campeón. | cada 3 s |
| Podio | `http://PI/skr/podio?clase=4` | Podio animado (3.º → 2.º → 1.º, corona y confeti) de **cualquier clase**: por puntos, Chase the Ace, vuelta rápida, consecutivas… | cada 4 s |

Datos en JSON: `/skr/carrera.json` (carrera en curso, para nodos y próximo heat), `/skr/ultima-carrera.json`, `/skr/podio.json?clase=…`,
`/skr/posiciones.json?clases=…` y `/skr/chase.json?clases=…`, por si quieres hacer tu propio diseño.

Cada página es independiente: usa solo las que quieras.

## Configurar la fuente en OBS

- **Ancho 1920, alto 1080.** Si tu lienzo es más grande (p. ej. 2880×1800), escala la fuente (×1.5), no cambies el ancho.
- **CSS personalizado**: deja el que trae OBS (fondo transparente).
- **Apagar la fuente cuando no es visible**: apagado si quieres que la escena aparezca completa al instante;
  encendido si prefieres que no consulte la Pi cuando no está al aire (tarda 1–4 s en cargar).
- **Podio**: actívale *Actualizar el navegador cuando la escena se active* para que la animación arranque de cero.
- Las letras (Orbitron, Rajdhani) se cargan de Google Fonts: si el PC de OBS no tiene internet, se ven con la del sistema.

## Parámetros de la URL

Se combinan con `&`: `…/posiciones?clases=2,3&titulos=PRO,SPORT&lang=en`. Para espacios usa `%20`.

**Todas las páginas**

| Parámetro | Por defecto | Ejemplo |
|---|---|---|
| `lang` | idioma de la interfaz de RotorHazard (`es` o `en`) | `lang=en` |
| `intervalo` | el de la tabla de arriba (ms entre consultas) | `intervalo=1000` |
| `colores` | colores de puesto de RotorHazard (Ajustes → LED) | `colores=2a4bff,ff6a1a,22d63a,ff2a6a` |

**Carrera** (`nodos`) — una sola fuente encima de la captura del VRX, del mismo tamaño

En cada cuadro de video:

- **Arriba a la izquierda**, la posición del piloto en un recuadro con el color de su puesto (con brillo que late).
  Sin posición todavía: "—" atenuado.
- **Arriba a la derecha**, el canal (R1, F4…) con el color del puesto.
- **Abajo a la derecha**, la tarjeta: piloto y vuelta actual, tiempo total desde la largada, el holeshot (**S**)
  y cada vuelta; la última vuelta va resaltada con el color del puesto. Al terminar sale "✓ Terminó".
- **En el centro**, un aviso grande "VUELTA N · tiempo" unos 3 s cada vez que el piloto completa una vuelta.
- Los puestos sin piloto se ven atenuados (con su canal), como en la caja de video.

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `nodos` | `1,2,3,4` | puestos que se muestran, en el orden de los cuadros |
| `disposicion` | `2x2` (`1x1` si hay un solo nodo) | columnas x filas: `2x2` para una caja de 4 cuadrantes, `4x1` en fila, `1x1` para una fuente por piloto |
| `mostrar` | `pos,canal,tarjeta,aviso` | qué partes se ven |
| `vueltas` | `4` | cuántas filas de vueltas caben en la tarjeta (las últimas) |
| `vacios` | sí | `vacios=0` oculta los puestos sin piloto |
| `escala` | `1` | tamaño de todo (`0.8`, `1.3`…) |

Ejemplos: caja de 4 cuadrantes del VRX → `…/skr/nodos` sobre el video, mismo tamaño. Un piloto por fuente →
`…/skr/nodos?nodos=3&disposicion=1x1`.

Antes de la carrera muestra piloto y canal; la posición y los tiempos aparecen al arrancar.

**Próximo heat** (`proximo-heat`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `pos` | `arriba` | `centro` lo centra (arriba deja espacio para la última carrera abajo) |
| `nombre` | sí | `nombre=0` oculta el nombre real del piloto |
| `paleta` | azul | color del título: `paleta=ffb321-ff6a3d` |

Muestra el heat actual de RotorHazard. Si usas `obs_auto_escena` con *Al guardar las vueltas*, cuando la
escena cambia RotorHazard ya pasó al heat siguiente (también con `orden_heats`).

**Última carrera** (`ultima-carrera`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `pos` | `abajo` | `arriba` pone el panel arriba |

**Posiciones** (`posiciones`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `clases` | `actual` | ids de clase separados por comas, `actual` (clase del heat actual) o `todas` |
| `titulos` | nombre de la clase hasta el primer " - " | títulos por columna: `titulos=PRO,SPORT` |
| `zona` | `4` | cuántos quedan resaltados como "zona de final"; `0` la quita |
| `paleta` | naranja, azul, verde | degradado por columna: `paleta=ffb321-ff6a3d,2bb5f5-6a5cff` |

Usa el ranking que tenga la clase en RotorHazard (puntos y victorias si el formato da puntos). Los pilotos que
todavía no corren salen con "—".

**Próximo + anterior** (`proximo-y-anterior`)

Recibe los parámetros de las dos páginas (`lang`, `colores`, `nombre`, `paleta`…) y los pasa a ambas; la posición
está fija: próximo heat arriba, resultado abajo. Con heats de hasta 4 pilotos caben sin taparse; con más, usa las
dos páginas por separado y ajústalas en OBS.

**Chase the Ace** (`chase`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `clases` | `actual` | la final que se está corriendo (sirve para varias finales sin tocar OBS), o ids |
| `aces` | `2` | victorias para ser campeón (solo si la clase **no** usa el ranking de [chase-the-ace](../chase-the-ace)) |
| `titulos`, `paleta` | como en posiciones | |
| `subtitulo` | "Final Chase the Ace" | texto sobre el título |

Sin otros plugins, la tabla calcula lo básico: campeón al primero en N victorias, el resto por menor suma de
puestos y desempate por la última carrera. Si además instalas la función [chase-the-ace](../chase-the-ace) y la
clase usa su ranking, toma de ahí las reglas completas de MultiGP 2026 (carreras nulas, Ironman).

**Podio** (`podio`) — sirve para cualquier clase

El orden sale del **ranking de la clase** en RotorHazard (el método que tenga: puntos, Chase the Ace, etc.) y debajo
de cada piloto van los datos de ese ranking (p. ej. "17 PTS · 4 victorias", "2 victorias · suma 6"). Si la clase
no tiene ranking, usa sus **resultados** según cómo se gana (vueltas y tiempo, vuelta más rápida o consecutivas).
Si es una final Chase the Ace sin campeón todavía, muestra "La final sigue en juego".

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `clase` | `actual` | id de la clase (o la del heat actual) |
| `titulo` | "PODIO <clase>" | título grande, p. ej. `titulo=PODIO%20PRO` |
| `subtitulo` | el nombre del evento ("Final Chase the Ace" en una final Chase the Ace) | línea de arriba |
| `modo` | automático | `modo=chase`: Chase the Ace calculado aquí aunque la clase no use el ranking de [chase-the-ace](../chase-the-ace) (con `aces=2`) |
| `paleta` | azul | `paleta=ffb321-ff6a3d` |
| `fondo` | fondo oscuro animado | `fondo=0` lo deja transparente para ponerlo sobre otra escena |
| `confeti` | sí | `confeti=0` lo quita |

## Ejemplo de escenas

| Escena | Fuentes |
|---|---|
| Carrera | captura del VRX + `skr/nodos` encima, del mismo tamaño (no hace falta nada más) |
| Próximo heat | video de fondo + `skr/proximo-y-anterior` (o `skr/proximo-heat` y `skr/ultima-carrera` por separado) |
| Posiciones | video de fondo + `skr/posiciones?clases=2,3&titulos=PRO,SPORT` |
| Chase the Ace | video de fondo + `skr/chase` |
| Podio de la final Pro | `skr/podio?clase=4&titulo=PODIO%20PRO&paleta=ffb321-ff6a3d` |
| Podio del round robin | `skr/podio?clase=2&subtitulo=Round%20Robin` |

Con la función [obs-escena-automatica](../obs-escena-automatica) la escena de carrera entra sola en el
staging y la de próximo heat al guardar.

## Si venías usando Stream Overlays

Este plugin reemplaza lo que se usaba de Stream Overlays: `/stream/overlay/<tema>/node/N` → `skr/nodos`
(una sola fuente para los 4) y `/stream/overlay/<tema>/heat/upcoming` → `skr/proximo-heat`. Ya no hace falta CSS
personalizado. Puedes dejar Stream Overlays instalado o quitarlo; no se estorban.
