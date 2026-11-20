#!/usr/bin/env bash
# Instala en la Raspberry Pi de RotorHazard las funciones que elijas y reinicia el servidor.
# macOS / Linux (en Windows usa instalar.ps1).
#
# Uso:
#   ./scripts/instalar.sh                                         # lista las funciones disponibles
#   ./scripts/instalar.sh pi@192.168.1.20 overlays chase-the-ace  # solo esas funciones
#   ./scripts/instalar.sh pi@192.168.1.20 todas                   # todas
#   NO_RESTART=1 ./scripts/instalar.sh pi@192.168.1.20 overlays   # sin reiniciar
#   DRY_RUN=1 ./scripts/instalar.sh pi@192.168.1.20 todas          # solo muestra qué instalaría
#
# Las funciones son las carpetas de funciones/ (también acepta el nombre del plugin, p. ej. skr_overlays).
# Variables opcionales: RH_DATA_DIR (carpeta de datos en la Pi, por defecto rh-data, relativa a $HOME),
# RH_SERVICE (servicio systemd, por defecto rotorhazard), SSH_KEY (ruta de la clave privada).
#
# La versión anterior de cada plugin queda en ~/rh-plugin-backups/<plugin>-<fecha>/ en la Pi
# (fuera de la carpeta plugins, para que RotorHazard no la cargue).
# Ojo: el reinicio corta cualquier carrera en curso. Úsalo con el timer en READY (sin carrera).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FUNCS="$ROOT/funciones"

list_functions() {
  echo "Funciones disponibles:"
  for d in "$FUNCS"/*/; do
    name="$(basename "$d")"
    desc="$(sed -n 's/^> //p' "$d/README.md" 2>/dev/null | head -1)"
    printf "  %-24s %s\n" "$name" "$desc"
  done
}

# Carpeta del plugin (la que tiene manifest.json) de una función o de un nombre de plugin
plugin_dirs() {
  local want="$1" found=0
  if [[ -d "$FUNCS/$want" ]]; then
    for m in "$FUNCS/$want"/*/manifest.json; do [[ -f "$m" ]] && { dirname "$m"; found=1; }; done
  else
    for m in "$FUNCS"/*/"$want"/manifest.json; do [[ -f "$m" ]] && { dirname "$m"; found=1; }; done
  fi
  [[ $found -eq 1 ]]
}

DEST="${1:-}"
if [[ -z "$DEST" || $# -lt 2 ]]; then
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
  echo
  list_functions
  exit 1
fi
shift

WANT=("$@")
if [[ "${WANT[0]}" == "todas" || "${WANT[0]}" == "all" ]]; then
  WANT=()
  for d in "$FUNCS"/*/; do WANT+=("$(basename "$d")"); done
fi

DIRS=()
for w in "${WANT[@]}"; do
  found="$(plugin_dirs "$w" || true)"
  if [[ -z "$found" ]]; then
    echo "✗ '$w' no es una función ni un plugin de este repo."
    list_functions
    exit 1
  fi
  while IFS= read -r line; do DIRS+=("$line"); done <<< "$found"
done

if [[ -n "${DRY_RUN:-}" ]]; then
  echo "Se instalarían en $DEST:"
  for dir in "${DIRS[@]}"; do echo "  ${dir#"$ROOT"/}"; done
  exit 0
fi

DATA="${RH_DATA_DIR:-rh-data}"
SERVICE="${RH_SERVICE:-rotorhazard}"
SSH_OPTS=(-o ConnectTimeout=8)
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS+=(-i "$SSH_KEY")
STAMP="$(date +%Y%m%d-%H%M%S)"

for dir in "${DIRS[@]}"; do
  p="$(basename "$dir")"
  echo "→ $p"
  tar --exclude=__pycache__ -czf - -C "$(dirname "$dir")" "$p" | ssh "${SSH_OPTS[@]}" "$DEST" "
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
echo "Algunas funciones necesitan un paso más en OBS: revisa el README de cada una en funciones/."
