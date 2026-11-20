# Afinar la Raspberry Pi para el día de carrera

Ajustes que se le hicieron a una **Raspberry Pi 3B (1 GB)** con Raspberry Pi OS bookworm y RotorHazard 4.5.1,
sin pantalla. Bajaron la RAM en reposo de 366 a ~213 MB y el CPU de `server.py` de ~16 % a 7–10 %.
Todos son opcionales y reversibles. Haz cada paso por SSH y **reinicia al final**.

> Antes de empezar: backup de los datos (`tar czf ~/rh-data_backup_$(date +%Y%m%d).tar.gz ~/rh-data`).

## 1. Arrancar en consola (sin escritorio)

Si la Pi no tiene pantalla, el escritorio solo gasta memoria:

```bash
sudo systemctl set-default multi-user.target
```

Para volver: `sudo systemctl set-default graphical.target`.

## 2. Apagar servicios que no se usan

Impresoras, módem, teclas multimedia y Bluetooth (si no usas mandos o LED por Bluetooth):

```bash
sudo systemctl disable --now cups cups-browsed ModemManager triggerhappy triggerhappy.socket bluetooth hciuart
```

## 3. CPU a máxima frecuencia fija

Evita que la CPU baje de frecuencia en medio de una carrera:

```bash
echo 'CPU_DEFAULT_GOVERNOR=performance' | sudo tee /etc/default/cpu_governor
```

(Lo lee `raspi-config.service` al arrancar; un parámetro del kernel no sirve porque ese servicio lo pisa.)
Vigila la temperatura: `vcgencmd measure_temp` y `vcgencmd get_throttled` (debe dar `0x0`).

## 4. Más swap y journal limitado

```bash
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=512/' /etc/dphys-swapfile && sudo systemctl restart dphys-swapfile
```

```bash
sudo mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nSystemMaxUse=50M\n' | sudo tee /etc/systemd/journald.conf.d/size.conf
```

(En la Pi original el journal ocupaba 746 MB.)

## 5. Servicio de RotorHazard más robusto

`sudo systemctl edit rotorhazard` y pega:

```ini
[Unit]
After=network-online.target
Wants=network-online.target

[Service]
Restart=on-failure
RestartSec=5
Nice=-5
```

## 6. Botón de apagado (placa S32_BPill)

Según la documentación oficial de RotorHazard, en `/boot/firmware/config.txt`:

```
dtoverlay=gpio-shutdown,gpio_pin=18,debounce=5000
```

## 7. Tarjeta SD, energía y backups

En el evento original la Pi se reinició de golpe a media tarde y **se perdieron dos heats ya guardados**:
la base volvió al último punto de control del WAL. RotorHazard usa `journal_mode=WAL` con `synchronous=FULL`,
así que la causa más probable es una SD que no respeta el `flush` o un corte de energía.

- Usa una SD de marca de tipo **endurance** (o arranca desde SSD por USB).
- Fuente oficial de 2,5 A (Pi 3) o 3 A (Pi 4), o un UPS/power bank con paso de corriente.
- Haz **backup de la base cada pocos heats** (Ajustes → Base de datos → Backup, o `rh_backup_database` con el MCP).
- Si pierdes heats, el **DVR de OBS** permite reconstruirlos: crea la carrera y agrega las vueltas a mano en Marshal
  con los tiempos del overlay final.

## 8. Cosas que NO hacer en la Pi con el servidor corriendo

- **No leer ni escribir `database.db` directamente** (sqlite3, scripts): con el servidor en marcha puede borrar el
  `-shm` y dejar la base "malformed" a mitad de carrera. Usa la web, el MCP o una **copia** del archivo.
- **No correr comandos pesados** (p. ej. `grep` con expresiones regulares largas sobre logs grandes): en una Pi 3B
  se comen la RAM y la llevan a 82 °C con throttling.
- No reiniciar el servicio ni instalar plugins con una carrera en curso.
