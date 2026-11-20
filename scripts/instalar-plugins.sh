#!/usr/bin/env bash
# Copia plugins de este repo a la Raspberry Pi de RotorHazard por SSH y reinicia el servidor.
# macOS / Linux (en Windows usa instalar-plugins.ps1).
#
# Uso:
#   ./scripts/instalar-plugins.sh pi@192.168.1.20                      # todos los plugins
#   ./scripts/instalar-plugins.sh pi@192.168.1.20 skr_overlays obs_auto_escena
#   NO_RESTART=1 ./scripts/instalar-plugins.sh pi@192.168.1.20         # sin reiniciar
#
# Variables opcionales: RH_DATA_DIR (carpeta de datos en la Pi, por defecto rh-data, relativa a $HOME),
# RH_SERVICE (servicio systemd, por defecto rotorhazard), SSH_KEY (ruta de la clave privada).
#
# La versión anterior de cada plugin queda en ~/rh-plugin-backups/<plugin>-<fecha>/ en la Pi
# (fuera de la carpeta plugins, para que RotorHazard no la cargue).
# Ojo: el reinicio corta cualquier carrera en curso. Úsalo con el timer en READY (sin carrera).
set -euo pipefail

DEST="${1:-}"
if [[ -z "$DEST" ]]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
shift

DATA="${RH_DATA_DIR:-rh-data}"
SERVICE="${RH_SERVICE:-rotorhazard}"
SSH_OPTS=(-o ConnectTimeout=8)
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS+=(-i "$SSH_KEY")

cd "$(dirname "$0")/../plugins"
if [[ $# -gt 0 ]]; then PLUGINS=("$@"); else PLUGINS=(*/); fi

STAMP="$(date +%Y%m%d-%H%M%S)"
for p in "${PLUGINS[@]}"; do
  p="${p%/}"
  [[ -f "$p/manifest.json" ]] || { echo "✗ $p no es un plugin (falta manifest.json)"; exit 1; }
  echo "→ $p"
  tar --exclude=__pycache__ -czf - "$p" | ssh "${SSH_OPTS[@]}" "$DEST" "
    set -e
    mkdir -p ~/$DATA/plugins ~/rh-plugin-backups
    cd ~/$DATA/plugins
    rm -rf .tmp-$p && mkdir .tmp-$p && tar -xzf - -C .tmp-$p
    if [ -d '$p' ]; then mv '$p' ~/rh-plugin-backups/$p-$STAMP; fi
    mv .tmp-$p/$p '$p' && rm -rf .tmp-$p
  "
done

if [[ -n "${NO_RESTART:-}" ]]; then
  echo "Listo. Reinicia RotorHazard para cargar los cambios (Ajustes → Sistema → Reiniciar servidor)."
  exit 0
fi

echo "Reiniciando $SERVICE…"
ssh "${SSH_OPTS[@]}" "$DEST" "sudo systemctl restart $SERVICE && sleep 8 && systemctl is-active $SERVICE"
echo "Plugins cargados (últimas líneas del log):"
ssh "${SSH_OPTS[@]}" "$DEST" "journalctl -u $SERVICE --since '-1 min' --no-pager 2>/dev/null | grep -iE 'plugin|listo|error' | tail -20 || true"
