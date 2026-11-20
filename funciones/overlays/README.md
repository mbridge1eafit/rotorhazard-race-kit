# Overlays para OBS (`skr_overlays`)

> Overlays propios para la transmisión: piloto en vivo sobre cada video, próximo heat, última carrera, posiciones, Chase the Ace y podio.

Páginas de 1920×1080 con fondo transparente que se ponen en OBS como **fuente de navegador**. Es un solo
plugin y **no depende de ningún otro**: lee la carrera en curso y la base de datos de RotorHazard directamente
(no hace falta el plugin Stream Overlays). Se actualizan solas.

## Instalar

```bash
./scripts/instalar.sh pi@IP-DE-LA-PI overlays
```

En Windows: `.\scripts\instalar.ps1 -Destino pi@IP-DE-LA-PI -Funciones overlays`. O copia la carpeta
`skr_overlays` a `~/rh-data/plugins/` de la Pi y reinicia RotorHazard. Prueba abriendo en el navegador
`http://IP-DE-LA-PI:5000/skr/proximo-heat`.

## Páginas

Reemplaza `PI` por la IP del timer con el puerto (p. ej. `192.168.1.20:5000`).

| Página | URL | Qué muestra | Se actualiza |
|---|---|---|---|
| Nodos (en vivo) | `http://PI/skr/nodos` | Sobre el video de cada piloto: posición resaltada con el color de su puesto, piloto, canal, vueltas (2/3), última y mejor vuelta, "terminó". Destella en cada vuelta. | cada 0,5 s |
| Próximo heat | `http://PI/skr/proximo-heat` | Pilotos del heat actual con su canal grande y su color, para que vayan a los pits a cambiar el VTX. | cada 2 s |
| Última carrera | `http://PI/skr/ultima-carrera` | Resultado de la última carrera guardada: posición, piloto, canal, vueltas, mejor tiempo y cada vuelta (la más rápida resaltada). | cada 3 s |
| Posiciones | `http://PI/skr/posiciones?clases=2,3` | Tablas de una o varias clases lado a lado: posición, piloto, puntos, baterías corridas y victorias, con zona de final. | cada 3 s |
| Chase the Ace | `http://PI/skr/chase` | Final en curso: Aces (A♠), puesto en cada carrera, suma de puestos y campeón. | cada 3 s |
| Podio | `http://PI/skr/podio?clase=4` | Podio animado (3.º → 2.º → 1.º, corona y confeti) cuando la final tiene campeón. | cada 4 s |

Datos en JSON: `/skr/carrera.json` (carrera en curso, para nodos y próximo heat), `/skr/ultima-carrera.json`,
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

**Nodos** (`nodos`) — una sola fuente que cubre los cuadros de video de los pilotos

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `nodos` | `1,2,3,4` | puestos que se muestran, en el orden de los cuadros |
| `disposicion` | `2x2` (`1x1` si hay un solo nodo) | columnas x filas: `2x2` para una caja de 4 cuadrantes, `4x1` en fila, `1x1` para una fuente por piloto |
| `esquina` | `arriba-izq` | dónde va el recuadro en cada cuadro: `arriba-izq`, `arriba-der`, `abajo-izq`, `abajo-der` |
| `escala` | `1` | tamaño del recuadro (`0.8`, `1.3`…) |
| `mostrar` | `pos,canal,vueltas,ultima,mejor` | qué datos se ven |

Ejemplos: caja de 4 cuadrantes del VRX → `…/skr/nodos` sobre el video, mismo tamaño. Un piloto por fuente →
`…/skr/nodos?nodos=3&disposicion=1x1&esquina=abajo-der`.

Antes de la carrera (y en staging) muestra piloto y canal; la posición y los tiempos aparecen al arrancar.

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

**Chase the Ace** (`chase`) y **Podio** (`podio`)

| Parámetro | Página | Por defecto | Qué hace |
|---|---|---|---|
| `clases` / `clase` | chase / podio | `actual` | la final que se está corriendo, o ids |
| `aces` | ambas | `2` | victorias para ser campeón (solo si la clase **no** usa el ranking de [chase-the-ace](../chase-the-ace)) |
| `titulos`, `paleta` | chase | como en posiciones | |
| `subtitulo` | ambas | "Final Chase the Ace" | texto sobre el título |
| `titulo` | podio | "PODIO <clase>" | título grande |
| `fondo` | podio | fondo oscuro animado | `fondo=0` lo deja transparente |
| `confeti` | podio | sí | `confeti=0` lo quita |

Sin otros plugins, la tabla calcula lo básico: campeón al primero en N victorias, el resto por menor suma de
puestos y desempate por la última carrera. Si además instalas la función [chase-the-ace](../chase-the-ace) y la
clase usa su ranking, toma de ahí las reglas completas de MultiGP 2026 (carreras nulas, Ironman).

## Ejemplo de escenas

| Escena | Fuentes |
|---|---|
| Carrera | captura del VRX + `skr/nodos` encima, del mismo tamaño |
| Próximo heat | video de fondo + `skr/proximo-heat` arriba + `skr/ultima-carrera` abajo |
| Posiciones | video de fondo + `skr/posiciones?clases=2,3&titulos=PRO,SPORT` |
| Chase the Ace | video de fondo + `skr/chase` |
| Podio Pro | `skr/podio?clase=4&titulo=PODIO%20PRO&paleta=ffb321-ff6a3d` |

Con la función [obs-escena-automatica](../obs-escena-automatica) la escena de carrera entra sola en el
staging y la de próximo heat al guardar.

## Si venías usando Stream Overlays

Este plugin reemplaza lo que se usaba de Stream Overlays: `/stream/overlay/<tema>/node/N` → `skr/nodos`
(una sola fuente para los 4) y `/stream/overlay/<tema>/heat/upcoming` → `skr/proximo-heat`. Ya no hace falta CSS
personalizado. Puedes dejar Stream Overlays instalado o quitarlo; no se estorban.
