# Overlays para OBS (`race_overlays`)

Páginas de 1920×1080 con fondo transparente que se ponen en OBS como **fuente de navegador**. Leen la
base de datos de RotorHazard, así que siguen funcionando después de reiniciar el timer, y se actualizan
solas cada 3 s.

Reemplaza `PI` por la IP del timer (p. ej. `192.168.1.20:5000`).

| Página | URL | Para qué |
|---|---|---|
| Última carrera | `http://PI/race-overlays/ultima-carrera` | Resultado de la última carrera guardada: posición, piloto, canal, vueltas, mejor tiempo y cada vuelta (la más rápida resaltada). Ideal debajo del "próximo heat". |
| Posiciones | `http://PI/race-overlays/posiciones?clases=2,3` | Tablas de una o varias clases lado a lado: posición, piloto, puntos, baterías corridas y victorias, con zona de final. |
| Chase the Ace | `http://PI/race-overlays/chase` | Final en curso: Aces (A♠), puesto en cada carrera, suma de puestos, carreras nulas y campeón. |
| Podio | `http://PI/race-overlays/podio?clase=4` | Podio animado (3.º → 2.º → 1.º, corona y confeti) cuando la final tiene campeón. |

Cada página tiene su JSON (`.../posiciones.json?clases=2,3`, `.../ultima-carrera.json`, `.../chase.json`)
por si quieres hacer tu propio diseño.

## Configurar la fuente en OBS

- **Ancho 1920, alto 1080.** Si tu lienzo es más grande (p. ej. 2880×1800), escala la fuente (×1.5), no cambies el ancho.
- **CSS personalizado**: deja el que trae OBS (fondo transparente).
- **Apagar la fuente cuando no es visible**: apagado si quieres que la escena aparezca completa al instante;
  encendido si prefieres que no consulte la Pi cuando no está al aire (tarda 1–4 s en cargar).
- **Podio**: actívale *Actualizar el navegador cuando la escena se active* para que la animación arranque de cero.
- Las fuentes (Orbitron, Rajdhani) se cargan de Google Fonts: si el PC de OBS no tiene internet, se ven con la letra del sistema.

## Parámetros de la URL

Se combinan con `&`: `.../posiciones?clases=2,3&titulos=PRO,SPORT&lang=en`.

**Todas las páginas**

| Parámetro | Por defecto | Ejemplo |
|---|---|---|
| `lang` | idioma de la interfaz de RotorHazard (`es` o `en`) | `lang=en` |
| `intervalo` | `3000` (ms entre consultas) | `intervalo=5000` |
| `colores` | colores de puesto de RotorHazard (Ajustes → LED) | `colores=2a4bff,ff6a1a,22d63a,ff2a6a` |

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

El ranking es el de la clase en RotorHazard (con `points_by_heat_size` y el ranking *Chase the Ace
(Points + Wins + Last Race)* salen puntos y victorias). Los pilotos que todavía no corren salen con "—".

**Chase the Ace** (`chase`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `clases` | `actual` | `actual` = la final que se está corriendo (sirve para varias finales sin tocar OBS), o ids |
| `titulos`, `paleta` | como en posiciones | |
| `subtitulo` | "Final Chase the Ace" | texto sobre el título |

Los Aces necesarios, las carreras nulas y la cláusula Ironman salen de los ajustes del ranking
*MultiGP Chase the Ace (2026 rules)* de la clase ([eventos.md](eventos.md#final-chase-the-ace-multigp)).

**Podio** (`podio`)

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| `clase` | `actual` | id de la clase de la final |
| `titulo` | "Podio <clase>" | título grande |
| `subtitulo` | "Final Chase the Ace" | línea de arriba, p. ej. `subtitulo=Copa%20Tiny%20Whoop%202026` |
| `paleta` | azul | `paleta=ffb321-ff6a3d` |
| `fondo` | fondo oscuro animado | `fondo=0` lo deja transparente para ponerlo sobre otra escena |
| `confeti` | sí | `confeti=0` lo quita |

Para escribir espacios en la URL usa `%20`.

## Ejemplo de escenas

| Escena | Fuentes |
|---|---|
| Carrera | captura del VRX + overlays de nodo de Stream Overlays (`/stream/overlay/<tema>/node/1..4`) |
| Próximo heat | video de fondo + `/stream/overlay/apex/heat/upcoming` arriba + `race-overlays/ultima-carrera` abajo |
| Posiciones | video de fondo + `race-overlays/posiciones?clases=2,3&titulos=PRO,SPORT` |
| Chase the Ace | video de fondo + `race-overlays/chase` |
| Podio Pro / Sport | `race-overlays/podio?clase=4&titulo=PODIO%20PRO&paleta=ffb321-ff6a3d` |

Con `obs_auto_escena` la escena de carrera entra sola en el staging y la de próximo heat al guardar.

## CSS para Stream Overlays

En `obs/css/` hay CSS para el plugin [Stream Overlays](https://github.com/dutchdronesquad/rh-stream-overlays)
(tema *apex*, versión 1.5.1). Se pegan en la fuente de navegador → *CSS personalizado*, debajo del que ya trae:

- `nodo-posicion.css`: la posición del piloto en el overlay de nodo resaltada con el color de su puesto
  (recuadro con brillo y animación) y ordinal "1º".
- `proximo-heat.css`: en el próximo heat, solo el canal, grande y con el color del puesto; nombres más
  grandes; panel arriba para dejar abajo la última carrera. Los colores de los puestos son de ejemplo.

Si actualizas Stream Overlays, revisa que los selectores sigan existiendo.
