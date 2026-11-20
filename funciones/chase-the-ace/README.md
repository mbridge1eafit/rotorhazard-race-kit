# Final Chase the Ace con el reglamento MultiGP (`chase_the_ace_rank`)

> Ranking de clase para finales Chase the Ace según el reglamento MultiGP 2026: Aces, carreras nulas, suma de puestos e Ironman.

Plugin independiente: agrega dos métodos de ranking de clase a RotorHazard. No necesita otros plugins.

## Instalar

```bash
./scripts/instalar.sh pi@IP-DE-LA-PI chase-the-ace
```

En Windows: `.\scripts\instalar.ps1 -Destino pi@IP-DE-LA-PI -Funciones chase-the-ace`. O copia la carpeta
`chase_the_ace_rank` a `~/rh-data/plugins/` y reinicia RotorHazard.

## Reglas (MultiGP Chase the Ace, 2026 rules)

Según *2026 MultiGP Rules & Regulations*, sección 7.9.2 *Chase the Ace Race Format for Final*
(enlazado desde multigp.com → Organizers → Rule Book):

- Los 4 (u 8) finalistas empiezan de cero: lo del bracket no cuenta.
- **Campeón: el primero en sumar 2 Aces.** Un Ace es ganar la carrera **y** completar la última vuelta
  pasando por la puerta de llegada.
- Si **nadie completa las vueltas**, no hay Ace ni puntos y la carrera **no cuenta** (nula).
- El resto del podio, por la **menor suma de puestos** (1,2,3 = 6 gana a 2,2,3 = 7). Empate: estilo
  **motocross**, gana quien quedó mejor en la última carrera (3,1,2 gana a 1,2,3).
- **Cláusula Ironman (opcional)**: si el mejor clasificado ganó todas sus carreras del bracket, se lleva el
  evento si gana la primera carrera de la final. Si no la gana (o es nula), la cláusula se cae.
- Las carreras que se corran después de que hay campeón no cuentan.

## Configurar la final

1. Crea la clase de la final (p. ej. "Pro Final") con un heat con los 4 finalistas; *Avance de heat* =
   **Ninguno** y rondas ilimitadas, para repetir el mismo heat carrera tras carrera.
2. Formato: **primero en N vueltas** (p. ej. 3). El plugin toma ese número para saber si el ganador completó la carrera.
3. Ranking de la clase: **MultiGP Chase the Ace (2026 rules)**. En sus ajustes (por clase):
   - *Aces needed*: `2` (reglamento).
   - *Laps to complete*: `0` = las del formato; pon un número si tu formato no es "primero en N vueltas".
   - *Ironman pilot*: callsign del mejor clasificado si aplica la cláusula; vacío si no.
4. Después de cada carrera sale un aviso en RotorHazard: cuántas carreras van (de un máximo de 5 con 4 pilotos),
   los Aces de cada uno, si la carrera fue nula y, al haber campeón, que no hay que correr más y el orden por
   suma de puestos.

RotorHazard no sabe de **descalificaciones**. El reglamento dice que una DQ es último lugar en ese heat
(pueden empatar varios): márcala en *Marshal* borrando las vueltas del piloto.

Para mostrarla en la transmisión: overlays `skr/chase` y `skr/podio` de la función [overlays](../overlays)
(opcional; también funcionan sin este plugin, con reglas más simples).

## El otro ranking: Points + Wins + Last Race

*Chase the Ace (Points + Wins + Last Race)* no es el de MultiGP: suma los puntos de todas las carreras de la clase
(usa un formato con método de puntos, p. ej. por posición `4,3,2,1`), desempata por victorias y luego por el puesto
en la última carrera. También sirve para un round robin con puntos. Los pilotos con 0 vueltas se ordenan por su
primer cruce (holeshot).

## Referencia

- Identificador del ranking MultiGP: `multigp_chase_the_ace`. Ajustes por clase (`rank_settings`):
  `wins` (2), `finish_laps` (0 = del formato), `ironman` (callsign o vacío).
- Columnas del ranking: `wins` (Aces), `position_sum`, `last_position`, `status` (`Champion`), `results`
  (puesto en cada carrera, 0 = nula). En `meta.chase_the_ace`: `champion`, `clinched_race`, `wins_needed`,
  `races`, `void_races`, `max_races`, `ironman` (`active` / `disengaged` / `won`).
- Escucha `LAPS_SAVE` para el aviso tras cada carrera.
- Pruebas: `python tests/test_chase_the_ace.py`.
