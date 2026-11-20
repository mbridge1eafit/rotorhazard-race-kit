# Heats intercalados entre clases (`orden_heats`)

> Corre heats de clases distintas en una secuencia fija (Sport 1, Pro 1, Sport 2…) y la genera sola.

RotorHazard solo avanza al siguiente heat **de la misma clase**. Este plugin, al guardar las vueltas de un heat
de la secuencia, pone como heat actual el siguiente de la secuencia, aunque sea de otra clase. No necesita otros
plugins.

## Instalar

```bash
bash scripts/instalar.sh pi@IP-DE-LA-PI orden-heats
```

En Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@IP-DE-LA-PI -Funciones orden-heats`.
Paso a paso, qué ejecutar y dónde: [docs/instalacion.md](../../docs/instalacion.md). O copia la carpeta
`orden_heats` a `~/rh-data/plugins/` y reinicia RotorHazard.

## Usar

1. En las clases que se van a intercalar: *Avance de heat* = **Ninguno** (si no, RotorHazard también mueve el heat).
2. **Ajustes → Orden de heats entre clases**:
   - *Clases a intercalar*: ids en el orden en que se alternan, p. ej. `3,2` (Sport primero).
   - Botón **Generar secuencia intercalada**. Si una clase tiene más heats, los que sobran van al final.
     (También puedes escribir la secuencia a mano: ids de heat separados por comas.)
   - *Activar orden de heats*: sí. Recarga la página para ver la secuencia en su campo.
3. Botón **Ir al primer heat pendiente** para arrancar, **Mostrar secuencia** para ver por dónde vas.

Al **guardar** un heat de la secuencia pasa al siguiente 1 s después (antes de que
[obs-escena-automatica](../obs-escena-automatica) muestre el próximo heat, si la usas). Al **descartar** no
cambia nada: el heat se repite. No actúa si hay una carrera en curso. La secuencia se guarda en la base del
evento, porque los ids de heat cambian de un evento a otro.

## Referencia

- Opciones (base del evento): `oh_enabled`, `oh_sequence` (ids de heat), `oh_classes` (ids de clase para generar).
- Botones: *Generar secuencia intercalada*, *Ir al primer heat pendiente*, *Mostrar secuencia*.
- Escucha `LAPS_SAVE`.
