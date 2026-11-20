<#
.SYNOPSIS
  Instala en la Raspberry Pi de RotorHazard las funciones que elijas y reinicia el servidor (Windows).
  Se ejecuta en TU computador (no en la Pi), en PowerShell abierto en la carpeta del kit. Guía: docs\instalacion.md
  Si Windows no deja ejecutar scripts: powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1 ...

.EXAMPLE
  .\scripts\instalar.ps1                                             # lista las funciones disponibles
  .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays,chase-the-ace
  .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones todas -Clave $env:USERPROFILE\.ssh\rotorhazard_ed25519
  .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones overlays -SinReiniciar
  .\scripts\instalar.ps1 -Destino pi@192.168.1.20 -Funciones todas -Simular      # solo muestra qué instalaría

.NOTES
  Las funciones son las carpetas de funciones\ (también acepta el nombre del plugin, p. ej. skr_overlays).
  Usa ssh, scp y tar, que vienen con Windows 10/11. La versión anterior de cada plugin queda en
  ~/rh-plugin-backups/<plugin>-<fecha>/ en la Pi (fuera de la carpeta plugins).
  Ojo: el reinicio corta cualquier carrera en curso. Úsalo con el timer en READY (sin carrera).
#>
param(
  [string]$Destino,
  [string[]]$Funciones,
  [string]$Clave,
  [string]$DataDir = "rh-data",
  [string]$Servicio = "rotorhazard",
  [switch]$SinReiniciar,
  [switch]$Simular
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
# "overlays,chase-the-ace" llega como un solo texto si se llama con powershell -File
$Funciones = @($Funciones | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$funcRoot = Join-Path $PSScriptRoot "..\funciones" | Resolve-Path

function Show-Functions {
  Write-Host "Funciones disponibles:"
  foreach ($d in Get-ChildItem $funcRoot -Directory) {
    $readme = Join-Path $d.FullName "README.md"
    $desc = ""
    if (Test-Path $readme) {
      $line = Get-Content $readme -Encoding UTF8 | Where-Object { $_ -like "> *" } | Select-Object -First 1
      if ($line) { $desc = $line.Substring(2) }
    }
    Write-Host ("  {0,-24} {1}" -f $d.Name, $desc)
  }
}

# Carpetas de plugin (las que tienen manifest.json) de una función o de un nombre de plugin
function Get-PluginDirs([string]$name) {
  $f = Join-Path $funcRoot $name
  if (Test-Path $f -PathType Container) {
    return Get-ChildItem $f -Directory | Where-Object { Test-Path (Join-Path $_.FullName "manifest.json") }
  }
  return Get-ChildItem $funcRoot -Directory | ForEach-Object { Get-ChildItem $_.FullName -Directory } |
    Where-Object { $_.Name -eq $name -and (Test-Path (Join-Path $_.FullName "manifest.json")) }
}

if (-not $Destino -or -not $Funciones) {
  Get-Help $PSCommandPath -Examples | Out-String | Write-Host
  Show-Functions
  exit 1
}

if ($Funciones -contains "todas" -or $Funciones -contains "all") {
  $Funciones = Get-ChildItem $funcRoot -Directory | ForEach-Object Name
}
$dirs = @()
foreach ($name in $Funciones) {
  $found = @(Get-PluginDirs $name)
  if (-not $found.Count) { Show-Functions; throw "'$name' no es una función ni un plugin de este repo." }
  $dirs += $found
}

if ($Simular) {
  Write-Host "Se instalarían en ${Destino}:"
  foreach ($d in $dirs) { Write-Host ("  " + $d.FullName.Substring($funcRoot.Path.Length - "funciones".Length)) }
  exit 0
}

$sshArgs = @("-o", "ConnectTimeout=8")
if ($Clave) { $sshArgs += @("-i", $Clave) }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($dir in $dirs) {
  $p = $dir.Name
  Write-Host "-> $p"
  $tgz = Join-Path $env:TEMP "rh-plugin-$p.tgz"
  & tar --exclude=__pycache__ -czf $tgz -C $dir.Parent.FullName $p
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
Write-Host "Algunas funciones necesitan un paso más en OBS: revisa el README de cada una en funciones\."
