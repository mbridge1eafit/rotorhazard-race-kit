# Análisis de espectro con los nodos de RotorHazard

Usa los receptores (RX5808) del timer como analizador de espectro para elegir los canales con menos
ruido e intermodulación, **sin escribir nada en la base de datos**.

**Cómo funciona:** el evento Socket.IO `set_scan` con `min = max = F` fija el hardware de un nodo en F.
El script rota las frecuencias entre los nodos para que todos midan todas, normaliza cada nodo contra su
propio piso y al terminar (o con Ctrl+C) envía `set_scan` apagado, que restaura la frecuencia del perfil.
El escáner nativo de RotorHazard 4.5.1 falla con un `TypeError` en `pack_16` (paso con decimales), por eso
no se usa su barrido.

## Requisitos

- Node.js 20 o más nuevo y `npm install` hecho en `mcp-server/` (se usa su `socket.io-client`).
  Sin el MCP: `npm install socket.io-client` dentro de esta carpeta.
- El timer en **READY** (sin carrera) y, para medir el ruido de fondo, **sin drones encendidos**.
- Credenciales de admin de la web de RotorHazard (por defecto `admin` / `rotorhazard`).

## Uso

Windows (PowerShell):

```powershell
$env:RH_URL = "http://192.168.1.20:5000"
node scan.cjs --salida amplio.json
node scan.cjs --canales R1,R2,R3,R4,R5,R6,R7,R8,F1,F2,F4,E1 --espera 6000 --pasadas 2 --salida canales.json
node analyze.cjs amplio.json canales.json --grupo 4 --ref "R1,R3,R6,R8;R1,R2,F4,R7"
```

macOS / Linux:

```bash
export RH_URL=http://192.168.1.20:5000
node scan.cjs --salida amplio.json
node scan.cjs --canales R1,R2,R3,R4,R5,R6,R7,R8,F1,F2,F4,E1 --espera 6000 --pasadas 2 --salida canales.json
node analyze.cjs amplio.json canales.json --grupo 4 --ref "R1,R3,R6,R8;R1,R2,F4,R7"
```

| Opción | Script | Por defecto | Qué hace |
|---|---|---|---|
| `--rango 5645-5945` / `--paso 5` | scan | 5645–5945 cada 5 MHz | Barrido amplio |
| `--canales R1,F4,…` | scan | — | Solo esos canales (en vez del rango) |
| `--espera` | scan | 3000 | ms por frecuencia (se descartan los primeros 600 ms tras cambiar) |
| `--pasadas` | scan | 1 | Repeticiones completas |
| `--salida` | scan | `barrido.json` | Archivo de resultados |
| `--candidatos` | analyze | R1–R8, F1, F2, F4, E1 | Canales que soportan tus VTX y tu VRX |
| `--grupo` | analyze | 4 | Pilotos en el aire a la vez |
| `--ref "a;b"` | analyze | — | Combinaciones a comparar con el ranking |
| `RH_URL`, `RH_USERNAME`, `RH_PASSWORD` | scan | `http://127.0.0.1:5000`, `admin`, `rotorhazard` | Conexión al timer |

`analyze.cjs` imprime el perfil de RSSI relativo, el ruido de cada canal y el top de combinaciones
(intermodulación de 3.er orden 2F1−F2, separación mínima y ruido). Valida la ganadora con el IMDTabler
que trae RotorHazard, en la Pi:

```bash
java -jar ~/RotorHazard/src/server/static/IMDTabler.jar -r 5658 5732 5843 5917
```

## Consejos de campo

- Mide con el timer **fuera** de su caja o blindaje, como va a estar en la carrera.
- Un drone encendido en los pits se ve como un pico de +40 RSSI en su canal: repite la medición sin él.
- Después de elegir canales, revisa el EnterAt/ExitAt de cada nodo con un paso real; el ruido cambia por canal.
- Si un canal "se ve mal" en vivo aunque el análisis lo dé limpio (pasó con F1 en el evento original),
  cámbialo: el análisis no ve la interferencia de los propios drones de la carrera.
