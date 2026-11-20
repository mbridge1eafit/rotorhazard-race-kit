# Instalación paso a paso

Esta guía es para alguien que nunca ha usado la terminal. Si ya sabes usar SSH, ve directo al
[resumen rápido](#resumen-rápido).

## Antes de empezar: qué es cada cosa

En la instalación intervienen hasta tres equipos:

| Equipo | Qué es | Qué se hace ahí |
|---|---|---|
| **El timer** | La Raspberry Pi con RotorHazard (la página que abres en el navegador para manejar las carreras). | Ahí quedan instalados los plugins. **No hace falta conectarle teclado ni pantalla.** |
| **Tu computador** | Tu PC con Windows, tu Mac o tu Linux, conectado a la misma red que el timer. | Aquí descargas este kit y **aquí escribes todos los comandos de esta guía**. El instalador manda los archivos al timer por la red. |
| **El PC de OBS** | El computador que transmite o proyecta con OBS. Puede ser el mismo que el anterior. | Solo se usa si instalas funciones de OBS u overlays; sus pasos están en el README de cada función. |

> Todos los comandos de esta guía se escriben **en tu computador**, salvo que diga "en la Pi".

## 1. Revisa que tengas todo

- [ ] **RotorHazard 4.5 funcionando.** Abres su página en el navegador, algo como `http://192.168.1.20:5000`.
- [ ] **La IP del timer.** Es el número de esa dirección: en el ejemplo, `192.168.1.20`. Si entras con un nombre
      (p. ej. `http://rotorhazard.local:5000`), puedes usar ese nombre en lugar de la IP.
      Consejo: en el router, reserva esa IP para el timer, así no cambia de un día a otro.
- [ ] **Tu computador en la misma red** (el mismo Wi-Fi o switch) que el timer.
- [ ] **Usuario y contraseña de la Raspberry Pi.** No son los de la página de RotorHazard: son los del sistema de la
      Pi. Normalmente el usuario es `pi` y la contraseña es la que se puso al instalar Raspberry Pi OS.
- [ ] **SSH activado en la Pi.** Las instalaciones de RotorHazard casi siempre lo tienen. Si en el paso 4 sale
      "Connection refused", mira [problemas comunes](#problemas-comunes).
- [ ] **Ninguna carrera en curso.** Al final se reinicia RotorHazard, y eso corta una carrera en curso.

No necesitas instalar programas: Windows 10/11, macOS y Linux ya traen lo necesario (`ssh`, `scp` y `tar`).

## 2. Descarga el kit

Elige **una** de estas dos formas; las dos dejan lo mismo en tu computador.

**Opción A — ZIP (recomendada si no usas git)**

1. Abre <https://github.com/mbridge1eafit/rotorhazard-race-kit>.
2. Botón verde **Code** → **Download ZIP**.
3. Descomprime el ZIP (en Windows: clic derecho → **Extraer todo**). Queda una carpeta llamada
   `rotorhazard-race-kit-main`. Si al abrirla hay otra carpeta con el mismo nombre, entra en esa: la carpeta del
   kit es la que tiene adentro `README.md`, `funciones` y `scripts`.

**Opción B — git (si ya lo tienes instalado)**

```
git clone https://github.com/mbridge1eafit/rotorhazard-race-kit
```

Crea la carpeta `rotorhazard-race-kit`. Con git, para actualizar después basta `git pull` dentro de esa carpeta.

## 3. Abre una terminal en esa carpeta

La terminal es una ventana donde se escriben comandos. Tiene que abrirse **dentro de la carpeta del kit** (la que
tiene `README.md`, `funciones` y `scripts`).

**Windows**

1. Abre la carpeta en el Explorador de archivos.
2. Haz clic en la barra de direcciones (arriba, donde sale la ruta), borra lo que hay, escribe `powershell` y
   pulsa **Enter**.
3. Se abre una ventana azul o negra que termina en algo como `PS C:\Users\tu\Downloads\rotorhazard-race-kit-main>`.

**macOS**

1. Abre la app **Terminal** (Aplicaciones → Utilidades → Terminal).
2. Escribe `cd ` (con un espacio al final), **arrastra la carpeta del kit** a la ventana y pulsa **Enter**.

**Linux**: clic derecho dentro de la carpeta → **Abrir en una terminal**.

Para comprobarlo, escribe `ls` y pulsa Enter: deben aparecer `README.md`, `funciones`, `scripts`…

## 4. Prueba la conexión con el timer

Escribe esto (cambia la IP por la de tu timer) y pulsa Enter:

```
ssh pi@192.168.1.20
```

- La primera vez pregunta *"Are you sure you want to continue connecting (yes/no)?"*: escribe `yes` y Enter.
- Luego pide la contraseña de la Pi. **Al escribirla no se ve nada en pantalla, es normal.** Escríbela y pulsa Enter.
- Si entras, la línea cambia a algo como `pi@raspberrypi:~ $`. Ya estás "dentro" de la Pi: escribe `exit` y Enter para volver.

Si no funciona, mira [problemas comunes](#problemas-comunes) antes de seguir.

## 5. (Recomendado) Entra sin contraseña

El instalador se conecta varias veces a la Pi y, sin este paso, pide la contraseña en cada conexión. Esto se hace
**una sola vez por computador**.

**Windows** (en la misma ventana de PowerShell):

```powershell
mkdir $env:USERPROFILE\.ssh -Force
```

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

Pulsa Enter a todo lo que pregunte (dos veces "passphrase" vacía). Luego, cambiando la IP:

```powershell
Get-Content $env:USERPROFILE\.ssh\rotorhazard_ed25519.pub | ssh pi@192.168.1.20 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Te pide la contraseña de la Pi por última vez.

**macOS / Linux**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rotorhazard_ed25519
```

```bash
ssh-copy-id -i ~/.ssh/rotorhazard_ed25519.pub pi@192.168.1.20
```

Prueba: `ssh -i ~/.ssh/rotorhazard_ed25519 pi@192.168.1.20` (en Windows:
`ssh -i $env:USERPROFILE\.ssh\rotorhazard_ed25519 pi@192.168.1.20`) debe entrar sin pedir contraseña. Escribe `exit`.

## 6. Elige qué instalar

Cada función es independiente: instala solo las que quieras. Para ver la lista:

| Windows | macOS / Linux |
|---|---|
| `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1` | `bash scripts/instalar.sh` |

| Función | Para qué |
|---|---|
| `obs-escena-automatica` | OBS cambia solo de escena al iniciar y terminar cada carrera, y graba un video por carrera |
| `overlays` | Gráficos para la transmisión: carrera en vivo, próximo heat, resultados, posiciones, Chase the Ace, podio |
| `chase-the-ace` | Finales Chase the Ace con el reglamento MultiGP 2026 |
| `orden-heats` | Alternar heats de dos clases (Sport 1, Pro 1, Sport 2…) |

## 7. Instala

Con el timer **sin carrera en curso**, escribe el comando cambiando la IP y las funciones que quieras.

**Windows**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays,chase-the-ace -Clave $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

**macOS / Linux**:

```bash
SSH_KEY=~/.ssh/rotorhazard_ed25519 bash scripts/instalar.sh pi@192.168.1.20 overlays chase-the-ace
```

- Para instalar todas, cambia la lista por `todas`.
- Si no hiciste el paso 5, quita `-Clave …` (Windows) o `SSH_KEY=…` (Mac/Linux) y escribe la contraseña de la Pi
  cada vez que la pida.
- Para ver qué haría sin tocar nada, agrega `-Simular` (Windows) o pon `DRY_RUN=1 ` al principio (Mac/Linux).
- Se puede usar el nombre de la función (`overlays`) o el del plugin (`skr_overlays`).

Qué vas a ver:

```
-> skr_overlays
-> chase_the_ace_rank
Reiniciando rotorhazard...
active
Plugins cargados (últimas líneas del log):
... skr_overlays: /skr/{nodos,...} listos
```

`active` quiere decir que RotorHazard volvió a arrancar bien. La página del timer tarda unos segundos en volver:
recárgala.

El instalador guarda la versión anterior de cada plugin en la Pi, en `~/rh-plugin-backups/`, por si hay que volver atrás.

## 8. Comprueba que quedó instalado

- En la página de RotorHazard: **Ajustes → Plugins**. Cada plugin instalado aparece en la lista, sin error.
- Si instalaste `overlays`, abre en el navegador `http://192.168.1.20:5000/skr/proximo-heat` (con la IP de tu
  timer): debe verse el heat actual. Fondo transparente: en el navegador se ve sobre blanco o negro.

## 9. Configura cada función

Cada función tiene su guía, con lo que se configura en RotorHazard y, si aplica, en OBS:

- [obs-escena-automatica](../funciones/obs-escena-automatica): conexión con OBS, escenas y grabación. Tiene un
  paso que se hace **en el PC de OBS** (cargar un script).
- [overlays](../funciones/overlays): las URL para poner en OBS.
- [chase-the-ace](../funciones/chase-the-ace): cómo crear la clase de la final.
- [orden-heats](../funciones/orden-heats): cómo armar la secuencia de heats.

## Sin terminal: copiar a mano

Si prefieres no usar comandos, puedes copiar las carpetas con un programa de archivos remotos:
[WinSCP](https://winscp.net) en Windows o [Cyberduck](https://cyberduck.io) en Mac.

1. Conéctate por **SFTP** a la IP del timer con el usuario y la contraseña de la Pi.
2. En la Pi, entra a `/home/pi/rh-data/plugins/` (si tu usuario no es `pi`, cambia esa parte).
3. Copia **la carpeta del plugin**, no la de la función:
   - `funciones/overlays/skr_overlays`
   - `funciones/obs-escena-automatica/obs_auto_escena`
   - `funciones/chase-the-ace/chase_the_ace_rank`
   - `funciones/orden-heats/orden_heats`

   Debe quedar, por ejemplo, `/home/pi/rh-data/plugins/skr_overlays/__init__.py`.
4. Reinicia RotorHazard desde su página (en Ajustes, el botón para reiniciar el servidor) o reiniciando la Pi.

**No dejes copias de respaldo dentro de `plugins/`** (por ejemplo `skr_overlays viejo`): RotorHazard intenta
cargarlas como otro plugin.

## Actualizar, volver atrás o desinstalar

- **Actualizar**: descarga otra vez el ZIP (o `git pull`) y repite el paso 7.
- **Volver a la versión anterior**: en la Pi, la copia está en `~/rh-plugin-backups/<plugin>-<fecha>/`. Muévela de
  vuelta a `~/rh-data/plugins/<plugin>` y reinicia.
- **Desinstalar**: borra la carpeta del plugin en `~/rh-data/plugins/` y reinicia RotorHazard.

## Problemas comunes

| Lo que ves | Qué pasa y cómo arreglarlo |
|---|---|
| `ssh: Could not resolve hostname` / `Connection timed out` | La IP está mal o tu computador no está en la red del timer. Revisa la IP en la barra del navegador donde abres RotorHazard. |
| `Connection refused` | SSH está apagado en la Pi. Con teclado y pantalla en la Pi: `sudo raspi-config` → *Interface Options* → *SSH* → *Yes*. |
| `Permission denied (publickey,password)` | Usuario o contraseña de la Pi equivocados (no son los de la página de RotorHazard). |
| `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` | Reinstalaron la Pi o cambió de IP. Ejecuta `ssh-keygen -R 192.168.1.20` (con tu IP) y vuelve a intentar. |
| Windows: *"la ejecución de scripts está deshabilitada"* | Usa el comando completo con `powershell -ExecutionPolicy Bypass -File`, como en el paso 7. |
| Mac/Linux: `Permission denied` al ejecutar el script | Ejecútalo con `bash scripts/instalar.sh …` (el ZIP no guarda el permiso de ejecución). |
| `sudo: a terminal is required…` o `sudo: a password is required` al reiniciar | Tu usuario de la Pi pide contraseña para `sudo`. Instala sin reiniciar (`-SinReiniciar` en Windows, `NO_RESTART=1` en Mac/Linux) y reinicia RotorHazard desde su página. |
| `'xxx' no es una función ni un plugin de este repo` | Nombre mal escrito. Ejecuta el instalador sin argumentos para ver la lista. |
| El plugin no aparece en Ajustes → Plugins | Mira el log de la Pi: `ssh pi@192.168.1.20 "journalctl -u rotorhazard -n 80 --no-pager"` y busca `Traceback` o el nombre del plugin. |
| RotorHazard no vuelve después de instalar | Espera 30 s y recarga. Si sigue sin responder, reinicia la Pi. Para volver atrás, usa la copia de `~/rh-plugin-backups/`. |

## Resumen rápido

```bash
git clone https://github.com/mbridge1eafit/rotorhazard-race-kit && cd rotorhazard-race-kit
bash scripts/instalar.sh                                                      # lista de funciones
SSH_KEY=~/.ssh/<clave> bash scripts/instalar.sh pi@<IP> overlays chase-the-ace  # instala y reinicia RotorHazard
```

Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@<IP> -Funciones overlays,chase-the-ace -Clave <clave>`.

Variables y opciones: `RH_DATA_DIR` (carpeta de datos en la Pi, por defecto `rh-data`), `RH_SERVICE` (por defecto
`rotorhazard`), `NO_RESTART=1` / `-SinReiniciar`, `DRY_RUN=1` / `-Simular`.

## Si vienes de la versión del evento original

- `skr_overlays` 2.x: mismas rutas `/skr/...`, así que las fuentes de OBS no cambian. Lo nuevo: el overlay de
  carrera `/skr/nodos` y el próximo heat `/skr/proximo-heat` reemplazan a Stream Overlays y su CSS; `/skr/proximo-y-anterior`
  los junta con el resultado anterior; el podio sirve para cualquier clase; `posiciones` sin `?clases=` muestra la
  clase del heat actual.
- `obs_auto_escena` 2.0: hay que volver a cargar en OBS el script nuevo `funciones/obs-escena-automatica/rotorhazard_dvr.lua`
  (reemplaza a `skr_escena_al_aire.lua`). La configuración guardada (IP, escenas, carpeta) se conserva.
- `chase_the_ace_rank` 2.0: el método se llama ahora *MultiGP Chase the Ace (2026 rules)*, pero el identificador
  interno es el mismo, así que las clases que ya lo usaban lo siguen usando. Revisa sus ajustes por clase.
