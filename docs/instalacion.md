# Instalación paso a paso

Guía para instalar las funciones del kit en un timer RotorHazard, aunque nunca hayas usado la terminal.
Si ya sabes usar SSH, ve al [resumen rápido](#resumen-rápido).

## Cómo funciona

- **El timer** es la Raspberry Pi con RotorHazard. Ahí quedan instalados los plugins. No necesita teclado ni pantalla.
- **Tu computador** (Windows, Mac o Linux) es donde descargas el kit y escribes **todos** los comandos de esta guía.
  El instalador copia los archivos al timer por la red y lo reinicia.
- **El PC de OBS** solo importa para algunas funciones; sus pasos están en el README de cada función.

En los comandos, cambia `192.168.1.20` por la IP de tu timer.

## 1. Antes de empezar

Necesitas:

1. **RotorHazard 4.5 funcionando**: abres su página en el navegador, por ejemplo `http://192.168.1.20:5000`.
2. **La IP del timer**: es el número de esa dirección (`192.168.1.20`). Conviene reservarla en el router para que no cambie.
3. **Tu computador en la misma red** que el timer.
4. **Usuario y contraseña de la Raspberry Pi**. No son los de la página de RotorHazard, son los del sistema de la Pi.
   El usuario suele ser `pi`; la contraseña es la que se puso al instalar Raspberry Pi OS.
5. **Ninguna carrera en curso**: al final se reinicia RotorHazard.

No hay que instalar programas: Windows 10/11, macOS y Linux ya traen lo necesario.

## 2. Descarga el kit

Usa **una** de las dos opciones; el resultado es el mismo.

**Opción A: ZIP** (si no usas git)

1. Abre <https://github.com/mbridge1eafit/rotorhazard-race-kit>.
2. Botón verde **Code** → **Download ZIP**.
3. Descomprime el ZIP (en Windows: clic derecho → **Extraer todo**).

**Opción B: git** (si ya lo tienes)

```
git clone https://github.com/mbridge1eafit/rotorhazard-race-kit
```

En los dos casos, **la carpeta del kit** es la que tiene adentro `README.md`, `funciones` y `scripts`.
Con el ZIP se llama `rotorhazard-race-kit-main`; si Windows creó una carpeta dentro de otra con el mismo nombre, es la de adentro.

## 3. Abre una terminal en la carpeta del kit

**Windows**: abre la carpeta del kit en el Explorador, haz clic en la barra de direcciones (donde sale la ruta),
escribe `powershell` y pulsa **Enter**.

**macOS**: abre **Terminal** (Aplicaciones → Utilidades), escribe `cd ` (con un espacio), arrastra la carpeta del kit
a la ventana y pulsa **Enter**.

**Linux**: clic derecho dentro de la carpeta del kit → **Abrir en una terminal**.

Comprueba: escribe `ls` y pulsa Enter. Deben aparecer `README.md`, `funciones` y `scripts`.

## 4. Prueba la conexión con el timer

```
ssh pi@192.168.1.20
```

- Si pregunta `Are you sure you want to continue connecting (yes/no)?`, escribe `yes` y Enter.
- Escribe la contraseña de la Pi y Enter. **No se ve nada mientras la escribes; es normal.**
- Funcionó si la línea cambia a algo como `pi@raspberrypi:~ $`. Escribe `exit` y Enter para salir.

Si sale un error, búscalo en [problemas comunes](#problemas-comunes).

## 5. Entrar sin contraseña (opcional, recomendado)

Sin este paso, el instalador pide la contraseña de la Pi varias veces. Se hace una sola vez por computador.

**Windows**, un comando a la vez:

```powershell
mkdir $env:USERPROFILE\.ssh -Force
```

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

(Pulsa Enter en las dos preguntas de *passphrase*, sin escribir nada.)

```powershell
Get-Content $env:USERPROFILE\.ssh\rotorhazard_ed25519.pub | ssh pi@192.168.1.20 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

(Pide la contraseña de la Pi por última vez.)

**macOS / Linux**, un comando a la vez:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rotorhazard_ed25519
```

(Pulsa Enter en las dos preguntas de *passphrase*, sin escribir nada.)

```bash
ssh-copy-id -i ~/.ssh/rotorhazard_ed25519.pub pi@192.168.1.20
```

(Pide la contraseña de la Pi por última vez.)

## 6. Elige qué instalar

Cada función es independiente. Instala solo las que vas a usar:

| Función | Para qué |
|---|---|
| `obs-escena-automatica` | OBS cambia de escena solo al iniciar y terminar cada carrera, y graba un video por carrera |
| `overlays` | Gráficos para la transmisión: carrera en vivo, próximo heat, resultados, posiciones, Chase the Ace, podio |
| `chase-the-ace` | Finales Chase the Ace con el reglamento MultiGP 2026 |
| `orden-heats` | Alternar heats de dos clases (Sport 1, Pro 1, Sport 2…) |
| `todas` | Las cuatro |

## 7. Instala

Escribe **uno** de estos comandos según tu sistema y si hiciste el paso 5. Cambia la IP y la lista de funciones.

**Windows, con el paso 5 hecho:**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays,chase-the-ace -Clave $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

**Windows, sin el paso 5** (pide la contraseña de la Pi varias veces):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays,chase-the-ace
```

**macOS / Linux, con el paso 5 hecho:**

```bash
SSH_KEY=~/.ssh/rotorhazard_ed25519 bash scripts/instalar.sh pi@192.168.1.20 overlays chase-the-ace
```

**macOS / Linux, sin el paso 5** (pide la contraseña de la Pi varias veces):

```bash
bash scripts/instalar.sh pi@192.168.1.20 overlays chase-the-ace
```

En Windows las funciones van separadas por comas y sin espacios; en macOS/Linux, separadas por espacios.

Al terminar debe salir algo así:

```
-> skr_overlays
-> chase_the_ace_rank
Reiniciando rotorhazard...
active
```

`active` significa que RotorHazard volvió a arrancar. Espera unos segundos y recarga su página.

La versión anterior de cada plugin queda guardada en la Pi, en `~/rh-plugin-backups/`.

## 8. Comprueba

- En RotorHazard, **Ajustes → Plugins**: cada plugin instalado aparece sin error.
- Si instalaste `overlays`, abre `http://192.168.1.20:5000/skr/proximo-heat` en el navegador: debe mostrar el heat actual.

## 9. Configura cada función

Cada función tiene su guía:

- [obs-escena-automatica](../funciones/obs-escena-automatica): conectar OBS, elegir escenas y grabación. Incluye un paso en el PC de OBS.
- [overlays](../funciones/overlays): las direcciones para poner en OBS.
- [chase-the-ace](../funciones/chase-the-ace): crear la clase de la final.
- [orden-heats](../funciones/orden-heats): armar la secuencia de heats.

## Instalar sin terminal

Puedes copiar los plugins a mano con [WinSCP](https://winscp.net) (Windows) o [Cyberduck](https://cyberduck.io) (Mac):

1. Conéctate por **SFTP** a la IP del timer con el usuario y la contraseña de la Pi.
2. Ve a `/home/pi/rh-data/plugins/` (cambia `pi` si tu usuario es otro).
3. Copia ahí la carpeta del plugin (no la de la función):

   | Función | Carpeta a copiar |
   |---|---|
   | `obs-escena-automatica` | `funciones/obs-escena-automatica/obs_auto_escena` |
   | `overlays` | `funciones/overlays/skr_overlays` |
   | `chase-the-ace` | `funciones/chase-the-ace/chase_the_ace_rank` |
   | `orden-heats` | `funciones/orden-heats/orden_heats` |

   Debe quedar, por ejemplo, `/home/pi/rh-data/plugins/skr_overlays/__init__.py`.
4. Reinicia RotorHazard (botón de reiniciar el servidor en Ajustes) o reinicia la Pi.

No dejes copias viejas dentro de `plugins/`: RotorHazard las carga como si fueran otro plugin.

## Actualizar, volver atrás o desinstalar

- **Actualizar**: descarga el kit de nuevo (o `git pull`) y repite el paso 7.
- **Volver a la versión anterior**: en la Pi, mueve la copia de `~/rh-plugin-backups/<plugin>-<fecha>/` a
  `~/rh-data/plugins/<plugin>` y reinicia RotorHazard.
- **Desinstalar**: borra la carpeta del plugin en `~/rh-data/plugins/` y reinicia RotorHazard.

## Problemas comunes

| Error | Solución |
|---|---|
| `Could not resolve hostname` o `Connection timed out` | IP equivocada o tu computador no está en la red del timer. Revisa la IP en la dirección con que abres RotorHazard. |
| `Connection refused` | SSH está apagado en la Pi. Con teclado y pantalla en la Pi: `sudo raspi-config` → *Interface Options* → *SSH* → *Yes*. |
| `Permission denied (publickey,password)` | Usuario o contraseña de la Pi equivocados. |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | La Pi se reinstaló o cambió de IP. Ejecuta `ssh-keygen -R 192.168.1.20` y vuelve a intentar. |
| Windows: *la ejecución de scripts está deshabilitada* | Escribe el comando completo, empezando por `powershell -ExecutionPolicy Bypass -File`. |
| Mac/Linux: `Permission denied` al ejecutar el script | Empieza el comando con `bash scripts/instalar.sh`. |
| `sudo: a terminal is required` o `sudo: a password is required` | Tu usuario pide contraseña para reiniciar el servicio. Agrega `-SinReiniciar` (Windows) o pon `NO_RESTART=1 ` al inicio (Mac/Linux), y reinicia RotorHazard desde su página. |
| `'xxx' no es una función ni un plugin de este repo` | Nombre mal escrito. Revisa la tabla del paso 6. |
| El plugin no aparece en Ajustes → Plugins | Revisa el log: `ssh pi@192.168.1.20 "journalctl -u rotorhazard -n 80 --no-pager"` y busca `Traceback`. |
| RotorHazard no vuelve a cargar | Espera 30 s y recarga. Si sigue igual, reinicia la Pi o vuelve a la versión anterior. |

## Resumen rápido

```bash
git clone https://github.com/mbridge1eafit/rotorhazard-race-kit && cd rotorhazard-race-kit
bash scripts/instalar.sh                                                         # lista de funciones
SSH_KEY=~/.ssh/<clave> bash scripts/instalar.sh pi@<IP> overlays chase-the-ace   # instala y reinicia
```

Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 -Destino pi@<IP> -Funciones overlays,chase-the-ace -Clave <clave>`

Opciones: `todas`; sin reiniciar `NO_RESTART=1` / `-SinReiniciar`; simular `DRY_RUN=1` / `-Simular`;
carpeta de datos `RH_DATA_DIR` (por defecto `rh-data`); servicio `RH_SERVICE` (por defecto `rotorhazard`).
También acepta el nombre del plugin (`skr_overlays`) en vez del de la función.

## Si vienes de la versión del evento original

- `skr_overlays` 2.x: las rutas `/skr/...` no cambian. Nuevos: `/skr/nodos` (overlay de carrera) y `/skr/proximo-heat`
  reemplazan a Stream Overlays y su CSS; `/skr/proximo-y-anterior` los junta con el resultado anterior; el podio sirve
  para cualquier clase; `posiciones` sin `?clases=` muestra la clase del heat actual.
- `obs_auto_escena` 2.0: carga en OBS el script nuevo `funciones/obs-escena-automatica/rotorhazard_dvr.lua`
  (reemplaza a `skr_escena_al_aire.lua`). La configuración guardada se conserva.
- `chase_the_ace_rank` 2.0: el ranking se llama ahora *MultiGP Chase the Ace (2026 rules)*; las clases que ya lo usaban
  lo siguen usando. Revisa sus ajustes por clase.
