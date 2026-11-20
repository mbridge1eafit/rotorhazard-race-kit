# Instalación

Guía para instalar los plugins en el timer RotorHazard. OBS, los overlays y el MCP tienen su propia guía.

## 1. Lo que necesitas

- Un timer **RotorHazard 4.5.x** funcionando (normalmente una Raspberry Pi con la instalación oficial:
  programa en `~/RotorHazard`, datos en `~/rh-data`, servicio `rotorhazard`).
- La **IP de la Pi** en tu red (la que abres en el navegador, p. ej. `http://192.168.1.20:5000`).
  Reserva esa IP en el router (DHCP fijo) para que no cambie entre días de carrera.
- Acceso **SSH** a la Pi (usuario `pi` por defecto). Para no escribir la contraseña cada vez, ver el paso 3.
- Este repo en tu PC:

  ```bash
  git clone https://github.com/mbridge1eafit/rotorhazard-race-kit
  ```

  Sin git: botón **Code → Download ZIP** en GitHub y descomprimir.

## 2. Elegir qué instalar

Todos los plugins son independientes. Instala solo los que vas a usar:

| Plugin | Lo instalas si… |
|---|---|
| `obs_auto_escena` | usas OBS y quieres que cambie de escena o grabe solo |
| `skr_overlays` | quieres los overlays de última carrera, posiciones, Chase the Ace o podio |
| `chase_the_ace_rank` | tu final es Chase the Ace (MultiGP) |
| `points_by_heat_size` | tus heats tienen distinto número de pilotos y quieres puntos según eso |
| `orden_heats` | quieres alternar heats de dos o más clases |
| `option_numeric_fix` | usas **RotorHazard 4.5.1** y la página Marshal (no hace falta en otras versiones si ya está corregido) |

## 3. Clave SSH (recomendado, una sola vez)

Windows (PowerShell):

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

```powershell
Get-Content $env:USERPROFILE\.ssh\rotorhazard_ed25519.pub | ssh pi@192.168.1.20 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

macOS / Linux:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rotorhazard_ed25519
```

```bash
ssh-copy-id -i ~/.ssh/rotorhazard_ed25519.pub pi@192.168.1.20
```

Prueba: `ssh -i <clave> pi@192.168.1.20 "systemctl is-active rotorhazard"` debe responder `active`.

## 4. Copiar los plugins

> El servidor se reinicia al final: hazlo **sin carrera en curso** (timer en READY).

### Opción A — script (Windows, macOS o Linux)

Windows (PowerShell, desde la carpeta del repo):

```powershell
.\scripts\instalar-plugins.ps1 -Destino pi@192.168.1.20 -Clave $env:USERPROFILE\.ssh\rotorhazard_ed25519
```

Solo algunos: `-Plugins skr_overlays,obs_auto_escena`. Si PowerShell no deja ejecutar scripts:
`powershell -ExecutionPolicy Bypass -File .\scripts\instalar-plugins.ps1 -Destino pi@192.168.1.20`.

macOS / Linux:

```bash
SSH_KEY=~/.ssh/rotorhazard_ed25519 ./scripts/instalar-plugins.sh pi@192.168.1.20
```

Solo algunos: `./scripts/instalar-plugins.sh pi@192.168.1.20 skr_overlays obs_auto_escena`.

El script copia cada carpeta a `~/rh-data/plugins/`, guarda la versión anterior en
`~/rh-plugin-backups/` (fuera de `plugins`, para que RotorHazard no la cargue), reinicia el servicio
y muestra las líneas del log de los plugins.

### Opción B — a mano

1. Copia la carpeta del plugin (p. ej. `plugins/skr_overlays`) dentro de `~/rh-data/plugins/` en la Pi,
   con `scp -r`, WinSCP, FileZilla (SFTP) o una memoria USB. Debe quedar `~/rh-data/plugins/skr_overlays/__init__.py`.
2. Reinicia RotorHazard: **Ajustes → Sistema → Reiniciar servidor**, o `sudo systemctl restart rotorhazard`.

### Opción C — con un agente de IA

Con el MCP configurado ([mcp-server/README.md](../mcp-server/README.md)), pídele:
*"instala el plugin de la carpeta plugins/skr_overlays y reinicia"* (herramienta `rh_install_plugin_from_file`).

## 5. Verificar

- **Ajustes → Plugins**: cada plugin aparece cargado, sin error.
- Log de la Pi: `journalctl -u rotorhazard -n 100 | grep -i plugin`. Cada plugin escribe una línea al cargar
  (p. ej. `obs_auto_escena: listo`, `skr_overlays: /skr/... listos`).
- Overlays: abre `http://IP-DE-LA-PI:5000/skr/posiciones?clases=todas` en el navegador.

## 6. Actualizar o desinstalar

- **Actualizar:** `git pull` en el repo y vuelve a correr el script. Revisa las notas de versión del plugin.
- **Desinstalar:** borra la carpeta en `~/rh-data/plugins/` y reinicia. RotorHazard 4.5 no tiene botón
  para desactivar un plugin sin borrarlo: para apagarlo un tiempo, muévelo fuera de `plugins/`.
- **Volver a la versión anterior:** está en `~/rh-plugin-backups/<plugin>-<fecha>/`; muévela de vuelta.

## Si vienes de la versión del evento original

Si ya tenías estos plugins de antes de que existiera este repo:

- `skr_overlays` 2.0: mismas rutas `/skr/...`, así que las fuentes de OBS no cambian. Lo nuevo:
  `posiciones` sin `?clases=` muestra la clase del heat actual (antes eran la 2 y la 3), y el podio también
  está en `/skr/podio` (la ruta vieja `/skr/static/podio.html` sigue funcionando).
- `obs_auto_escena` 2.0: hay que volver a cargar en OBS el script nuevo `obs/scripts/rotorhazard_dvr.lua`
  (reemplaza a `skr_escena_al_aire.lua`). La configuración guardada (IP, escenas, carpeta) se conserva.
- `chase_the_ace_rank` 2.0: el método cambió de nombre visible a *MultiGP Chase the Ace (2026 rules)*,
  pero el identificador interno es el mismo, así que las clases que ya lo usaban lo siguen usando.
  Revisa sus ajustes por clase (Aces, vueltas e Ironman).
