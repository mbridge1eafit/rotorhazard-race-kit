<#
.SYNOPSIS
  Copia plugins de este repo a la Raspberry Pi de RotorHazard por SSH y reinicia el servidor (Windows).

.EXAMPLE
  .\scripts\instalar-plugins.ps1 -Destino pi@192.168.1.20
  .\scripts\instalar-plugins.ps1 -Destino pi@192.168.1.20 -Plugins race_overlays,obs_auto_escena
  .\scripts\instalar-plugins.ps1 -Destino pi@192.168.1.20 -SinReiniciar -Clave $env:USERPROFILE\.ssh\rotorhazard_ed25519

.NOTES
  Usa ssh y tar, que vienen con Windows 10/11. La versión anterior de cada plugin queda en
  ~/rh-plugin-backups/<plugin>-<fecha>/ en la Pi (fuera de la carpeta plugins).
  Ojo: el reinicio corta cualquier carrera en curso. Úsalo con el timer en READY (sin carrera).
#>
param(
  [Parameter(Mandatory = $true)][string]$Destino,
  [string[]]$Plugins,
  [string]$Clave,
  [string]$DataDir = "rh-data",
  [string]$Servicio = "rotorhazard",
  [switch]$SinReiniciar
)
$ErrorActionPreference = "Stop"

$sshArgs = @("-o", "ConnectTimeout=8")
if ($Clave) { $sshArgs += @("-i", $Clave) }

$root = Join-Path $PSScriptRoot "..\plugins" | Resolve-Path
if (-not $Plugins) { $Plugins = Get-ChildItem $root -Directory | ForEach-Object Name }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($p in $Plugins) {
  if (-not (Test-Path (Join-Path $root "$p\manifest.json"))) { throw "$p no es un plugin (falta manifest.json)" }
  Write-Host "-> $p"
  $tgz = Join-Path $env:TEMP "rh-plugin-$p.tgz"
  & tar --exclude=__pycache__ -czf $tgz -C $root $p
  if ($LASTEXITCODE) { throw "tar falló con $p" }
  & scp @sshArgs $tgz "${Destino}:/tmp/rh-plugin-$p.tgz"
  if ($LASTEXITCODE) { throw "scp falló con $p" }
  $remote = "set -e; mkdir -p ~/$DataDir/plugins ~/rh-plugin-backups; cd ~/$DataDir/plugins; " +
            "rm -rf .tmp-$p; mkdir .tmp-$p; tar -xzf /tmp/rh-plugin-$p.tgz -C .tmp-$p; rm -f /tmp/rh-plugin-$p.tgz; " +
            "if [ -d '$p' ]; then mv '$p' ~/rh-plugin-backups/$p-$stamp; fi; mv .tmp-$p/$p '$p'; rm -rf .tmp-$p"
  & ssh @sshArgs $Destino $remote
  if ($LASTEXITCODE) { throw "la copia en la Pi falló con $p" }
  Remove-Item $tgz -Force
}

if ($SinReiniciar) {
  Write-Host "Listo. Reinicia RotorHazard para cargar los cambios (Ajustes -> Sistema -> Reiniciar servidor)."
  exit 0
}
Write-Host "Reiniciando $Servicio..."
& ssh @sshArgs $Destino "sudo systemctl restart $Servicio && sleep 8 && systemctl is-active $Servicio"
Write-Host "Plugins cargados (últimas líneas del log):"
& ssh @sshArgs $Destino "journalctl -u $Servicio --since '-1 min' --no-pager 2>/dev/null | grep -iE 'plugin|listo|error' | tail -20 || true"
