'''OBS: cambio automático de escena según el estado de la carrera (+ DVR por carrera).

- Al iniciar el staging de una carrera pone al aire la escena de carrera.
- Al terminar (al guardar/descartar vueltas, o al detener la carrera, según configuración)
  pone al aire la escena de "terminar" (p. ej. Próximo heat), tras una espera configurable.
- DVR (opcional): al iniciar cada heat arranca la grabación de OBS en la carpeta configurada,
  con un archivo "<Clase> - <Heat> - R<ronda> <fecha hora>", y la detiene unos segundos después
  de detener la carrera (o al guardar si se guarda antes).
- Si las vueltas se descartan, el DVR de esa carrera se puede conservar, mover a una subcarpeta,
  mandar a la papelera o borrar. Eso lo hace el script de OBS `obs/scripts/rotorhazard_dvr.lua`
  (corre dentro de OBS, en Windows, macOS o Linux), porque el archivo está en el PC de OBS y no
  en la Raspberry Pi.

Habla con OBS por obs-websocket v5 (OBS 28 o más nuevo, puerto 4455 por defecto) usando
websocket-client, que ya viene en el entorno de RotorHazard. La configuración se guarda en
config.json (sección OBS_AUTO_ESCENA), así sobrevive a cambios de evento o reseteos de la base.
'''

import base64
import hashlib
import json
import logging

import gevent
from eventmanager import Evt
from RHUI import UIField, UIFieldType, UIFieldSelectOption

logger = logging.getLogger(__name__)

SECTION = 'OBS_AUTO_ESCENA'
PANEL = 'obs_auto_escena'
# Parámetros del perfil de OBS con que el plugin le habla al script rotorhazard_dvr.lua
DVR_CATEGORY = 'RotorHazardDVR'

FIELDS = [
    UIField('enabled', 'Activar cambio automático', UIFieldType.CHECKBOX, value=True,
            desc='Cambia la escena al aire en OBS al iniciar y al terminar cada carrera.'),
    UIField('host', 'IP o nombre del PC de OBS', UIFieldType.TEXT, value='', placeholder='192.168.1.50',
            desc='El PC (Windows, Mac o Linux) donde corre OBS. Mejor con IP fija o reservada en el router.'),
    UIField('port', 'Puerto WebSocket', UIFieldType.BASIC_INT, value=4455,
            desc='OBS → Herramientas → Ajustes del servidor WebSocket.'),
    UIField('password', 'Contraseña WebSocket', UIFieldType.PASSWORD, value=''),
    UIField('scene_race', 'Escena al iniciar la carrera', UIFieldType.TEXT, value='Carrera',
            desc='Nombre exacto de la escena en OBS (mayúsculas y tildes incluidas). Vacío = no cambiar.'),
    UIField('scene_next', 'Escena al terminar', UIFieldType.TEXT, value='Proximo Heat',
            desc='Nombre exacto de la escena en OBS. Vacío = no cambiar.'),
    UIField('trigger_next', 'Cuándo pasar a la escena de "terminar"', UIFieldType.SELECT, value='save',
            options=[
                UIFieldSelectOption('save', 'Al guardar o descartar las vueltas (muestra el heat siguiente)'),
                UIFieldSelectOption('stop', 'Al detener la carrera'),
            ]),
    UIField('delay_next', 'Espera antes de cambiar al terminar (s)', UIFieldType.BASIC_INT, value=3,
            desc='Segundos para que el público vea los tiempos finales antes del cambio.'),
    UIField('rec_enabled', 'Grabar cada carrera (DVR)', UIFieldType.CHECKBOX, value=False,
            desc='Inicia la grabación de OBS al empezar cada heat y la detiene al terminar.'),
    UIField('rec_path', 'Carpeta de grabación (en el PC de OBS)', UIFieldType.TEXT, value='',
            placeholder='D:/DVR carreras  ·  /Volumes/DISCO/DVR  ·  /home/yo/Videos/DVR',
            desc='Ruta tal como la ve el PC de OBS. La carpeta debe existir. En Windows puedes usar / o \\.'),
    UIField('rec_stop_delay', 'Seguir grabando tras detener la carrera (s)', UIFieldType.BASIC_INT, value=3,
            desc='Segundos extra para que quede la llegada de los últimos pilotos.'),
    UIField('rec_discard', 'DVR de una carrera descartada', UIFieldType.SELECT, value='move',
            options=[
                UIFieldSelectOption('keep', 'Conservarlo'),
                UIFieldSelectOption('move', 'Moverlo a una subcarpeta'),
                UIFieldSelectOption('trash', 'Mandarlo a la papelera'),
                UIFieldSelectOption('delete', 'Borrarlo'),
            ],
            desc='Mover, papelera y borrar necesitan el script rotorhazard_dvr.lua cargado en OBS.'),
    UIField('rec_discard_dir', 'Subcarpeta para los DVR descartados', UIFieldType.TEXT, value='descartadas',
            desc='Se crea dentro de la carpeta de grabación (solo con "Moverlo a una subcarpeta").'),
]


def _truthy(val):
    return val is True or str(val).lower() in ('1', 'true', 'on', 'yes')


class OBSAutoEscena:
    def __init__(self, rhapi):
        self.rhapi = rhapi
        self._pending = None  # greenlet del cambio diferido a la escena de "terminar"
        self._rec_stop = None  # greenlet del stop diferido de la grabación
        self._last_rec_path = None  # último DVR cerrado de la carrera actual

    # ---------------- configuración ----------------
    def cfg(self, name):
        val = self.rhapi.config.get_item(SECTION, name)
        # get_item devuelve False si la clave no existe; en un checkbox False es un valor válido
        if val is None or val == '' or (val is False and name not in ('enabled', 'rec_enabled')):
            for f in FIELDS:
                if f.name == name:
                    return f.value
        return val

    def enabled(self):
        return _truthy(self.cfg('enabled')) and bool(self.cfg('host'))

    # ---------------- obs-websocket ----------------
    def _request(self, request_type, request_data=None, timeout=4):
        import websocket  # websocket-client

        host = self.cfg('host')
        if not host:
            raise RuntimeError('falta la IP de OBS en Ajustes')
        url = 'ws://{}:{}'.format(host, int(self.cfg('port') or 4455))
        ws = websocket.create_connection(url, timeout=timeout, subprotocols=['obswebsocket.json'])
        try:
            hello = json.loads(ws.recv())
            identify = {'rpcVersion': 1}
            auth = hello.get('d', {}).get('authentication')
            if auth:
                pwd = self.cfg('password') or ''
                if not pwd:
                    raise RuntimeError('OBS pide contraseña y no está configurada')
                secret = base64.b64encode(hashlib.sha256((pwd + auth['salt']).encode()).digest()).decode()
                identify['authentication'] = base64.b64encode(
                    hashlib.sha256((secret + auth['challenge']).encode()).digest()).decode()
            ws.send(json.dumps({'op': 1, 'd': identify}))
            msg = json.loads(ws.recv())
            if msg.get('op') != 2:
                raise RuntimeError('OBS rechazó la conexión (¿contraseña incorrecta?)')
            ws.send(json.dumps({'op': 6, 'd': {'requestType': request_type, 'requestId': 'rh',
                                                'requestData': request_data or {}}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get('op') == 7 and msg['d'].get('requestId') == 'rh':
                    status = msg['d']['requestStatus']
                    if not status.get('result'):
                        raise RuntimeError(status.get('comment') or 'código {}'.format(status.get('code')))
                    return msg['d'].get('responseData') or {}
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _profile_set(self, category, name, value):
        self._request('SetProfileParameter', {'parameterCategory': category, 'parameterName': name,
                                              'parameterValue': value})

    def set_scene(self, scene, reason, notify_ok=False):
        if not scene:
            return
        try:
            self._request('SetCurrentProgramScene', {'sceneName': scene})
            logger.info('OBS: escena "%s" al aire (%s)', scene, reason)
            if notify_ok:
                self.rhapi.ui.message_notify('OBS: escena "{}" al aire'.format(scene))
        except Exception as ex:
            logger.warning('OBS: no se pudo poner "%s" al aire (%s): %s', scene, reason, ex)
            self.rhapi.ui.message_notify('OBS: no se pudo cambiar a "{}": {}'.format(scene, ex))

    # ---------------- eventos de carrera ----------------
    def _cancel_pending(self):
        if self._pending is not None and not self._pending.dead:
            self._pending.kill(block=False)
        self._pending = None

    def on_stage(self, _args):
        if self.rec_enabled():
            self._cancel_rec_stop()
            self._last_rec_path = None  # carrera nueva: un descarte solo afecta su propio DVR
            gevent.spawn(self.start_recording, self._rec_name())
        if not self.enabled():
            return
        self._cancel_pending()
        gevent.spawn(self.set_scene, self.cfg('scene_race'), 'inicio de carrera')

    # ---------------- grabación DVR ----------------
    def rec_enabled(self):
        return _truthy(self.cfg('rec_enabled')) and bool(self.cfg('rec_path')) and bool(self.cfg('host'))

    def _cancel_rec_stop(self):
        if self._rec_stop is not None and not self._rec_stop.dead:
            self._rec_stop.kill(block=False)
        self._rec_stop = None

    def _rec_name(self):
        '''"<Clase> - <Heat> - R<ronda>", sin caracteres que el sistema de archivos no acepta.'''
        parts = []
        try:
            heat_id = self.rhapi.race.heat
            if heat_id:
                heat = self.rhapi.db.heat_by_id(heat_id)
                if heat and heat.class_id:
                    rc = self.rhapi.db.raceclass_by_id(heat.class_id)
                    if rc and rc.name:
                        parts.append(rc.name)
                parts.append((heat.name if heat and heat.name else 'Heat {}'.format(heat_id)))
                parts.append('R{}'.format(self.rhapi.race.round))
            else:
                parts.append('Practica')
        except Exception as ex:
            logger.warning('OBS: no se pudo armar el nombre del DVR: %s', ex)
            parts = ['Carrera']
        name = ' - '.join(parts)
        for ch in '/\\:*?"<>|%':
            name = name.replace(ch, '-')
        return name.strip()

    def _set_record_folder(self, folder):
        '''SetRecordDirectory (obs-websocket 5.3+, sirve en salida Simple y Avanzada). Si OBS es más
        viejo, se escribe en los dos parámetros del perfil.'''
        try:
            self._request('SetRecordDirectory', {'recordDirectory': folder})
            return
        except Exception as ex:
            logger.info('OBS: SetRecordDirectory no disponible (%s); uso los parámetros del perfil', ex)
        self._profile_set('AdvOut', 'RecFilePath', folder)
        self._profile_set('SimpleOutput', 'FilePath', folder)

    def start_recording(self, name):
        try:
            if self._request('GetRecordStatus').get('outputActive'):
                self._request('StopRecord')  # carrera reiniciada sin terminar la anterior
                gevent.sleep(1.5)
            self._set_record_folder(self.cfg('rec_path'))
            self._profile_set('Output', 'FilenameFormatting', name + ' %CCYY-%MM-%DD %hh-%mm-%ss')
            self._request('StartRecord')
            logger.info('OBS: grabando DVR "%s"', name)
            self.rhapi.ui.message_notify('OBS: grabando "{}"'.format(name))
        except Exception as ex:
            logger.warning('OBS: no se pudo iniciar la grabación: %s', ex)
            self.rhapi.ui.message_alert('OBS: no se pudo iniciar la grabación: {}'.format(ex))

    def stop_recording(self, reason, notify=True):
        '''Detiene la grabación y devuelve la ruta del archivo (o None si no estaba grabando).'''
        try:
            if not self._request('GetRecordStatus').get('outputActive'):
                return None
            path = self._request('StopRecord').get('outputPath')
            self._last_rec_path = path
            logger.info('OBS: grabación detenida (%s): %s', reason, path)
            if notify:
                self.rhapi.ui.message_notify('OBS: DVR guardado')
            return path
        except Exception as ex:
            logger.warning('OBS: no se pudo detener la grabación: %s', ex)
            self.rhapi.ui.message_alert('OBS: no se pudo detener la grabación: {}'.format(ex))
            return None

    def discard_recording(self):
        '''Vueltas descartadas: cierra el DVR de esa carrera y, según "rec_discard", le pide al
        script rotorhazard_dvr.lua de OBS que lo mueva, lo mande a la papelera o lo borre.'''
        mode = self.cfg('rec_discard') or 'move'
        path = self.stop_recording('vueltas descartadas', notify=False) or self._last_rec_path
        self._last_rec_path = None
        if not path or mode == 'keep':
            return
        try:
            self._profile_set(DVR_CATEGORY, 'Folder', self.cfg('rec_path'))
            self._profile_set(DVR_CATEGORY, 'Mode', mode)
            self._profile_set(DVR_CATEGORY, 'Subfolder', self.cfg('rec_discard_dir') or 'descartadas')
            self._profile_set(DVR_CATEGORY, 'Discard', path)  # al final: es lo que el script vigila
            logger.info('OBS: DVR descartado (%s): %s', mode, path)
            self.rhapi.ui.message_notify('OBS: DVR de la carrera descartada → {}'.format(
                {'move': 'subcarpeta', 'trash': 'papelera', 'delete': 'borrado'}.get(mode, mode)))
        except Exception as ex:
            logger.warning('OBS: no se pudo pedir el descarte del DVR %s: %s', path, ex)
            self.rhapi.ui.message_alert('OBS: no se pudo descartar el DVR: {}'.format(ex))

    def _schedule_rec_stop(self, reason, delay=None):
        if not self.rec_enabled():
            return
        self._cancel_rec_stop()
        if delay is None:
            try:
                delay = max(0, int(self.cfg('rec_stop_delay') or 0))
            except (TypeError, ValueError):
                delay = 0
        self._rec_stop = gevent.spawn_later(delay, self.stop_recording, reason)

    def _schedule_next(self, reason):
        self._cancel_pending()
        try:
            delay = max(0, int(self.cfg('delay_next') or 0))
        except (TypeError, ValueError):
            delay = 0
        self._pending = gevent.spawn_later(delay, self.set_scene, self.cfg('scene_next'), reason)

    def on_stop(self, _args):
        self._schedule_rec_stop('carrera detenida')
        if self.enabled() and self.cfg('trigger_next') == 'stop':
            self._schedule_next('carrera detenida')

    def on_laps_done(self, _args):
        # vueltas guardadas: si el stop programado no ha corrido, cerrar ya el archivo
        if self._rec_stop is None or self._rec_stop.dead:
            self._schedule_rec_stop('vueltas guardadas', delay=0)
        if self.enabled() and self.cfg('trigger_next') != 'stop':
            self._schedule_next('vueltas guardadas/descartadas')

    def on_laps_discard(self, _args):
        if self.rec_enabled():
            self._cancel_rec_stop()
            gevent.spawn(self.discard_recording)
        if self.enabled() and self.cfg('trigger_next') != 'stop':
            self._schedule_next('vueltas guardadas/descartadas')

    # ---------------- botones ----------------
    def btn_test(self, _args=None):
        def run():
            try:
                data = self._request('GetCurrentProgramScene')
                ver = self._request('GetVersion')
                self.rhapi.ui.message_notify('OBS {} ({}) conectado. Al aire: "{}"'.format(
                    ver.get('obsVersion', '?'), ver.get('platformDescription') or ver.get('platform', '?'),
                    data.get('sceneName') or data.get('currentProgramSceneName')))
            except Exception as ex:
                self.rhapi.ui.message_notify('OBS: sin conexión: {}'.format(ex))
        gevent.spawn(run)

    def btn_scenes(self, _args=None):
        def run():
            try:
                scenes = [s.get('sceneName') for s in self._request('GetSceneList').get('scenes', [])]
                self.rhapi.ui.message_notify('OBS: escenas: ' + ' · '.join('"{}"'.format(s) for s in reversed(scenes)))
            except Exception as ex:
                self.rhapi.ui.message_notify('OBS: sin conexión: {}'.format(ex))
        gevent.spawn(run)

    def btn_rec_test(self, _args=None):
        if not self.cfg('rec_path'):
            self.rhapi.ui.message_alert('OBS: falta la carpeta de grabación')
            return

        def run():
            self.start_recording('Prueba DVR')
            gevent.sleep(5)
            self.stop_recording('prueba')
        gevent.spawn(run)

    def btn_race(self, _args=None):
        gevent.spawn(self.set_scene, self.cfg('scene_race'), 'botón', True)

    def btn_next(self, _args=None):
        gevent.spawn(self.set_scene, self.cfg('scene_next'), 'botón', True)


def initialize(rhapi):
    plugin = OBSAutoEscena(rhapi)

    rhapi.config.register_section(SECTION)
    rhapi.ui.register_panel(PANEL, 'OBS: cambio automático de escena', 'settings')
    for field in FIELDS:
        field.persistent_section = SECTION
        rhapi.fields.register_option(field, PANEL)

    rhapi.ui.register_quickbutton(PANEL, 'obs_test', 'Probar conexión', plugin.btn_test)
    rhapi.ui.register_quickbutton(PANEL, 'obs_scenes', 'Listar escenas de OBS', plugin.btn_scenes)
    rhapi.ui.register_quickbutton(PANEL, 'obs_race', 'Poner escena de carrera', plugin.btn_race)
    rhapi.ui.register_quickbutton(PANEL, 'obs_next', 'Poner escena de terminar', plugin.btn_next)
    rhapi.ui.register_quickbutton(PANEL, 'obs_rec_test', 'Probar grabación (5 s)', plugin.btn_rec_test)

    rhapi.events.on(Evt.RACE_STAGE, plugin.on_stage, name='obs_auto_escena_stage')
    rhapi.events.on(Evt.RACE_STOP, plugin.on_stop, name='obs_auto_escena_stop')
    rhapi.events.on(Evt.LAPS_SAVE, plugin.on_laps_done, name='obs_auto_escena_save')
    rhapi.events.on(Evt.LAPS_DISCARD, plugin.on_laps_discard, name='obs_auto_escena_discard')
    logger.info('obs_auto_escena: listo')
