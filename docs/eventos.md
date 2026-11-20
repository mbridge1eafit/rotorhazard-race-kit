# Armar el evento: round robin, finales y orden de heats

Recetas con los plugins de este repo, sacadas del evento original (19 pilotos, 4 canales: clasificación
el domingo, round robin Pro y Sport y finales Chase the Ace el lunes).

## Puntos y ranking de la clase

Para que la tabla de posiciones muestre puntos, usa en el **formato** de carrera un método de puntos de
RotorHazard (p. ej. por posición, `3,2,1`) y en la **clase** un ranking que los sume. El ranking
*Chase the Ace (Points + Wins + Last Race)* de `chase_the_ace_rank` suma los puntos, desempata por victorias
y luego por el puesto en la última carrera; los pilotos con 0 vueltas se ordenan por su primer cruce (holeshot).

## Round robin con heats de 3 o 4

RotorHazard trae generadores de heats, pero para un round robin donde **todos vuelen lo mismo, se crucen
con todos y nadie vuele dos heats seguidos**, conviene diseñarlo aparte (en una hoja de cálculo o pidiéndoselo
a un agente con el MCP) y crear los heats ya armados. Reglas que funcionaron:

- Número de baterías por piloto × pilotos divisible por el tamaño del heat (8 pilotos × 6 baterías = 48 = 16 heats de 3).
- Canal fijo por piloto cuando se pueda (menos cambios de VTX en los pits).
- Al menos un heat de descanso entre baterías del mismo piloto (cambio de batería y de gafas).
- Clase con *Avance de heat* = **Ninguno** si vas a usar `orden_heats`.

Un evento muy largo (más de ~100 heats) hace lenta la Pi: para el día de las finales puedes guardar un backup
y empezar un evento nuevo solo con los pilotos que siguen.

## Heats intercalados entre clases (`orden_heats`)

RotorHazard solo avanza al siguiente heat **de la misma clase**. Para correr Sport 1, Pro 1, Sport 2, Pro 2…:

1. En las clases que se van a intercalar: *Avance de heat* = **Ninguno**.
2. **Ajustes → Orden de heats entre clases**:
   - *Clases a intercalar*: ids en el orden en que se alternan, p. ej. `3,2` (Sport primero).
   - Botón **Generar secuencia intercalada**. Si una clase tiene más heats, los que sobran van al final.
     (También puedes escribir la secuencia a mano: ids de heat separados por comas.)
   - *Activar orden de heats*: sí. Recarga la página para ver la secuencia en su campo.
3. Botón **Ir al primer heat pendiente** para arrancar, **Mostrar secuencia** para ver por dónde vas.

Al **guardar** un heat de la secuencia pasa al siguiente 1 s después (antes de que `obs_auto_escena`
muestre el próximo heat). Al **descartar** no cambia nada: el heat se repite. No actúa si hay una carrera
en curso. La secuencia se guarda en la base del evento, porque los ids de heat cambian de un evento a otro.

## Final Chase the Ace (MultiGP)

Plugin `chase_the_ace_rank`, ranking **MultiGP Chase the Ace (2026 rules)**, según *2026 MultiGP Rules &
Regulations*, sección 7.9.2 *Chase the Ace Race Format for Final*:

- Los 4 (u 8) finalistas empiezan de cero: lo del bracket no cuenta.
- **Campeón: el primero en sumar 2 Aces.** Un Ace es ganar la carrera **y** completar la última vuelta
  pasando por la puerta de llegada.
- Si **nadie completa las vueltas**, no hay Ace ni puntos y la carrera **no cuenta** (nula).
- El resto del podio, por la **menor suma de puestos** (1,2,3 = 6 gana a 2,2,3 = 7). Empate: estilo
  **motocross**, gana quien quedó mejor en la última carrera (3,1,2 gana a 1,2,3).
- **Cláusula Ironman (opcional)**: si el mejor clasificado ganó todas sus carreras del bracket, se lleva el
  evento si gana la primera carrera de la final. Si no la gana (o es nula), la cláusula se cae.
- Las carreras que se corran después de que hay campeón no cuentan.

Configuración:

1. Crea la clase de la final (p. ej. "Pro Final") con un heat con los 4 finalistas; *Avance de heat* =
   **Ninguno** y rondas ilimitadas, para repetir el mismo heat carrera tras carrera.
2. Formato: **primero en N vueltas** (p. ej. 3). El plugin toma ese número para saber si el ganador completó la carrera.
3. Ranking de la clase: **MultiGP Chase the Ace (2026 rules)**. En sus ajustes:
   - *Aces needed*: `2` (reglamento).
   - *Laps to complete*: `0` = las del formato; pon un número si tu formato no es "primero en N vueltas".
   - *Ironman pilot*: callsign del mejor clasificado si aplica la cláusula; vacío si no.
4. Después de cada carrera sale un aviso: cuántas carreras van (de un máximo de 5 con 4 pilotos), los Aces de
   cada uno, si la carrera fue nula y, al haber campeón, que no hay que correr más y el orden por suma de puestos.

RotorHazard no sabe de **descalificaciones**. El reglamento dice que una DQ es último lugar en ese heat
(pueden empatar varios): márcala en *Marshal* borrando las vueltas del piloto.

Overlays: `skr/chase` (tabla en vivo) y `skr/podio?clase=N` ([overlays.md](overlays.md)).

También está el ranking **Chase the Ace (Points + Wins + Last Race)**, que no es el de MultiGP: suma los puntos
de todas las carreras (formato con puntos, p. ej. 4,3,2,1), desempata por victorias y luego por la última carrera.
