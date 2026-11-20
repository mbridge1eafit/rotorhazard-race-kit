-- rotorhazard_dvr.lua — DVR de las carreras descartadas en RotorHazard.
--
-- Se carga en OBS: Herramientas → Scripts → "+". Funciona en Windows, macOS y Linux.
--
-- El plugin obs_auto_escena (en la Raspberry Pi) graba un archivo por carrera. Si en RotorHazard
-- se descartan las vueltas, el plugin deja en el perfil de OBS, sección [RotorHazardDVR]:
--   Discard   = ruta del video de esa carrera
--   Mode      = move | trash | delete
--   Folder    = carpeta de grabación configurada en el plugin
--   Subfolder = subcarpeta para "move" (por defecto "descartadas")
-- Este script lo revisa cada segundo y, cuando la grabación ya está cerrada, mueve el video a la
-- subcarpeta, lo manda a la papelera o lo borra. Lo hace OBS porque el archivo está en este PC, no
-- en la Pi (y en macOS, además, el disco externo no se puede tocar por SSH).
--
-- Seguridad: solo toca archivos de video (.mp4 .mov .mkv .flv .ts .m4v) que estén DENTRO de la
-- carpeta de grabación. Si la papelera falla, mueve el video a la subcarpeta en vez de borrarlo.

obs = obslua

local SECTION = "RotorHazardDVR"
local VIDEO_EXT = { mp4 = true, mov = true, mkv = true, flv = true, ts = true, m4v = true }
local IS_WINDOWS = package.config:sub(1, 1) == "\\"
local IS_MAC = (not IS_WINDOWS) and (io.popen and (function()
  local h = io.popen("uname -s 2>/dev/null")
  if not h then return false end
  local s = h:read("*l") or ""
  h:close()
  return s == "Darwin"
end)())

local function log(level, msg) obs.script_log(level, "RotorHazard DVR: " .. msg) end

-- ---------- utilidades de rutas ----------
local function norm(p)
  p = (p or ""):gsub("\\", "/"):gsub("/+$", "")
  return p
end

local function same_prefix(path, dir)
  local a, b = norm(path), norm(dir) .. "/"
  if IS_WINDOWS then a, b = a:lower(), b:lower() end
  return b ~= "/" and a:sub(1, #b) == b
end

local function basename(p) return norm(p):match("([^/]+)$") end

-- Las funciones de libobs aceptan UTF-8 en Windows (las de Lua no, si hay tildes en la ruta).
local function mkdirs(dir)
  if obs.os_mkdirs then return obs.os_mkdirs(dir) >= 0 end
  if IS_WINDOWS then
    return os.execute('mkdir "' .. dir:gsub("/", "\\") .. '" 2>nul') ~= nil
  end
  return os.execute('mkdir -p "' .. dir .. '"') ~= nil
end

local function rename(src, dst)
  if obs.os_rename then return obs.os_rename(src, dst) == 0 end
  return os.rename(src, dst) == true
end

local function unlink(p)
  if obs.os_unlink then return obs.os_unlink(p) == 0 end
  return os.remove(p) == true
end

local function exists(p)
  if obs.os_file_exists then return obs.os_file_exists(p) end
  local f = io.open(p, "rb")
  if f then f:close() return true end
  return false
end

-- Nombre libre en la carpeta destino ("x.mp4", "x (2).mp4", ...)
local function free_name(dir, name)
  local dst = dir .. "/" .. name
  if not exists(dst) then return dst end
  local stem, ext = name:match("^(.*)(%.[^.]+)$")
  for i = 2, 99 do
    dst = dir .. "/" .. stem .. " (" .. i .. ")" .. ext
    if not exists(dst) then return dst end
  end
  return nil
end

-- ---------- papelera ----------
-- Windows: PowerShell con -EncodedCommand (UTF-16LE en base64), así la ruta viaja en ASCII y
-- las tildes no se dañan.
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64(bytes)
  local out = {}
  for i = 1, #bytes, 3 do
    local a, b, c = bytes[i], bytes[i + 1], bytes[i + 2]
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1 = math.floor(n / 262144) % 64
    local c2 = math.floor(n / 4096) % 64
    local c3 = math.floor(n / 64) % 64
    local c4 = n % 64
    out[#out + 1] = B64:sub(c1 + 1, c1 + 1) .. B64:sub(c2 + 1, c2 + 1)
      .. (b and B64:sub(c3 + 1, c3 + 1) or "=") .. (c and B64:sub(c4 + 1, c4 + 1) or "=")
  end
  return table.concat(out)
end

local function utf16le(s)
  local bytes, i = {}, 1
  while i <= #s do
    local c = s:byte(i)
    local cp, n
    if c < 0x80 then cp, n = c, 1
    elseif c < 0xE0 then cp, n = (c % 0x20) * 64 + (s:byte(i + 1) % 64), 2
    elseif c < 0xF0 then cp, n = (c % 0x10) * 4096 + (s:byte(i + 1) % 64) * 64 + (s:byte(i + 2) % 64), 3
    else cp, n = (c % 0x08) * 262144 + (s:byte(i + 1) % 64) * 4096 + (s:byte(i + 2) % 64) * 64 + (s:byte(i + 3) % 64), 4 end
    i = i + n
    if cp >= 0x10000 then
      cp = cp - 0x10000
      local hi, lo = 0xD800 + math.floor(cp / 1024), 0xDC00 + cp % 1024
      bytes[#bytes + 1] = hi % 256; bytes[#bytes + 1] = math.floor(hi / 256)
      bytes[#bytes + 1] = lo % 256; bytes[#bytes + 1] = math.floor(lo / 256)
    else
      bytes[#bytes + 1] = cp % 256; bytes[#bytes + 1] = math.floor(cp / 256)
    end
  end
  return bytes
end

local function trash_windows(path)
  local win = path:gsub("/", "\\"):gsub("'", "''")
  local ps = "Add-Type -AssemblyName Microsoft.VisualBasic; "
    .. "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('" .. win .. "', 'OnlyErrorDialogs', 'SendToRecycleBin')"
  local cmd = 'powershell -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' .. base64(utf16le(ps))
  os.execute(cmd)
  return not exists(path)
end

local function shell_quote(p) return "'" .. p:gsub("'", "'\\''") .. "'" end

local function trash_mac(path)
  -- Disco externo: /Volumes/<disco>/.Trashes/<uid>. Disco interno: ~/.Trash.
  local vol = path:match("^(/Volumes/[^/]+)/")
  local dir
  if vol then
    local h = io.popen("id -u")
    local uid = h and h:read("*l") or ""
    if h then h:close() end
    if not uid:match("^%d+$") then return false end
    dir = vol .. "/.Trashes/" .. uid
  else
    dir = (os.getenv("HOME") or "") .. "/.Trash"
  end
  mkdirs(dir)
  local dst = free_name(dir, basename(path))
  return dst ~= nil and rename(path, dst)
end

local function trash_linux(path)
  os.execute("gio trash " .. shell_quote(path) .. " 2>/dev/null")
  if not exists(path) then return true end
  local home = os.getenv("XDG_DATA_HOME") or ((os.getenv("HOME") or "") .. "/.local/share")
  local dir = home .. "/Trash/files"
  mkdirs(dir)
  local dst = free_name(dir, basename(path))
  return dst ~= nil and rename(path, dst)
end

local function to_trash(path)
  if IS_WINDOWS then return trash_windows(path) end
  if IS_MAC then return trash_mac(path) end
  return trash_linux(path)
end

-- ---------- acciones ----------
local function move_to_subfolder(path, folder, sub)
  sub = (sub ~= nil and sub ~= "") and sub or "descartadas"
  sub = sub:gsub("[/\\:%*%?\"<>|]", "-")
  local dir = norm(folder) .. "/" .. sub
  mkdirs(dir)
  local dst = free_name(dir, basename(path))
  if dst and rename(path, dst) then
    log(obs.LOG_INFO, "carrera descartada, video movido a " .. sub .. "/" .. basename(dst))
    return true
  end
  log(obs.LOG_WARNING, "no se pudo mover " .. path .. " a " .. dir)
  return false
end

local function process()
  local cfg = obs.obs_frontend_get_profile_config()
  if cfg == nil then return end
  local path = obs.config_get_string(cfg, SECTION, "Discard")
  if path == nil or path == "" then return end
  if obs.obs_frontend_recording_active() then return end -- esperar a que el archivo quede cerrado

  local mode = obs.config_get_string(cfg, SECTION, "Mode") or "move"
  local folder = obs.config_get_string(cfg, SECTION, "Folder") or ""
  local sub = obs.config_get_string(cfg, SECTION, "Subfolder") or "descartadas"
  obs.config_set_string(cfg, SECTION, "Discard", "")
  obs.config_save(cfg)

  local p = norm(path)
  local ext = (p:match("%.([%w]+)$") or ""):lower()
  if folder == "" or not same_prefix(p, folder) or not VIDEO_EXT[ext] or p:find("/%.%./") then
    log(obs.LOG_WARNING, "no se toca (no es un video dentro de la carpeta de grabación): " .. path)
    return
  end
  if not exists(path) then
    log(obs.LOG_WARNING, "el video ya no existe: " .. path)
    return
  end

  if mode == "keep" then
    return
  elseif mode == "delete" then
    local ok = unlink(path)
    log(ok and obs.LOG_INFO or obs.LOG_WARNING,
      "carrera descartada, " .. (ok and "video borrado: " or "no se pudo borrar: ") .. basename(p))
  elseif mode == "trash" then
    if to_trash(path) then
      log(obs.LOG_INFO, "carrera descartada, video a la papelera: " .. basename(p))
    else
      log(obs.LOG_WARNING, "la papelera falló; lo muevo a la subcarpeta")
      move_to_subfolder(path, folder, sub)
    end
  else
    move_to_subfolder(path, folder, sub)
  end
end

function script_description()
  return "<b>RotorHazard DVR</b><br>Si RotorHazard descarta una carrera, mueve su video a una subcarpeta, "
      .. "a la papelera o lo borra, según el plugin <i>obs_auto_escena</i> en la Raspberry Pi. "
      .. "Solo toca videos dentro de la carpeta de grabación."
end

function script_unload()
  obs.timer_remove(process)
end

function script_load(settings)
  obs.timer_add(process, 1000)
  log(obs.LOG_INFO, "listo (" .. (IS_WINDOWS and "Windows" or (IS_MAC and "macOS" or "Linux")) .. ")")
end
