# Armar el evento: puntos, round robin y finales

Recetas generales, sacadas del evento original (19 pilotos, 4 canales: clasificación
el domingo, round robin Pro y Sport y finales Chase the Ace el lunes).

## Puntos y ranking de la clase

Para que la tabla de posiciones muestre puntos, usa en el **formato** de carrera un método de puntos de
RotorHazard (p. ej. por posición, `3,2,1`) y en la **clase** un ranking que los sume. El ranking
*Chase the Ace (Points + Wins + Last Race)* de la función [chase-the-ace](../funciones/chase-the-ace) suma los puntos, desempata por victorias
y luego por el puesto en la última carrera; los pilotos con 0 vueltas se ordenan por su primer cruce (holeshot).

## Round robin con heats de 3 o 4

RotorHazard trae generadores de heats, pero para un round robin donde **todos vuelen lo mismo, se crucen
con todos y nadie vuele dos heats seguidos**, conviene diseñarlo aparte (en una hoja de cálculo o pidiéndoselo
a un agente con el MCP) y crear los heats ya armados. Reglas que funcionaron:

- Número de baterías por piloto × pilotos divisible por el tamaño del heat (8 pilotos × 6 baterías = 48 = 16 heats de 3).
- Canal fijo por piloto cuando se pueda (menos cambios de VTX en los pits).
- Al menos un heat de descanso entre baterías del mismo piloto (cambio de batería y de gafas).
- Clase con *Avance de heat* = **Ninguno** si vas a usar [orden-heats](../funciones/orden-heats).

Un evento muy largo (más de ~100 heats) hace lenta la Pi: para el día de las finales puedes guardar un backup
y empezar un evento nuevo solo con los pilotos que siguen.

## Heats intercalados y finales

- Alternar heats de dos clases (Sport 1, Pro 1, Sport 2…): función [orden-heats](../funciones/orden-heats).
- Final Chase the Ace con el reglamento MultiGP 2026: función [chase-the-ace](../funciones/chase-the-ace).
- Mostrarlo en la transmisión: función [overlays](../funciones/overlays) (posiciones, Chase the Ace, podio).
