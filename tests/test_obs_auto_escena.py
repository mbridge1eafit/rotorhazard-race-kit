'''Pruebas sin RotorHazard ni OBS: python tests/test_obs_auto_escena.py
Simula RHAPI y obs-websocket para revisar qué le pide el plugin a OBS.'''
import importlib.util
import os
import sys
import types

# ---- módulos de RotorHazard y gevent simulados ----
gevent = types.ModuleType('gevent')


class _G:
    dead = True

    def kill(self, block=False):
        pass


def _spawn(fn, *a, **k):
    fn(*a, **k)
    return _G()


gevent.spawn = _spawn
gevent.spawn_later = lambda delay, fn, *a, **k: _spawn(fn, *a, **k)
gevent.sleep = lambda s: None
sys.modules['gevent'] = gevent
sys.modules['eventmanager'] = types.ModuleType('eventmanager')
sys.modules['eventmanager'].Evt = type('Evt', (), {'RACE_STAGE': 1, 'RACE_STOP': 2, 'LAPS_SAVE': 3, 'LAPS_DISCARD': 4})
rhui = types.ModuleType('RHUI')


class _Field:
    def __init__(self, name, label, ftype, value=None, **_):
        self.name, self.value = name, value


rhui.UIField = _Field
rhui.UIFieldSelectOption = lambda *a, **k: a
rhui.UIFieldType = type('T', (), {'CHECKBOX': 'c', 'TEXT': 't', 'BASIC_INT': 'i', 'PASSWORD': 'p', 'SELECT': 's'})
sys.modules['RHUI'] = rhui

spec = importlib.util.spec_from_file_location(
    'oae', os.path.join(os.path.dirname(__file__), '..', 'funciones', 'obs-escena-automatica', 'obs_auto_escena', '__init__.py'))
oae = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oae)


class FakeRH:
    def __init__(self, cfg):
        self._cfg = cfg
        self.config = types.SimpleNamespace(get_item=lambda s, n: self._cfg.get(n, False))
        self.notes = []
        self.ui = types.SimpleNamespace(message_notify=self.notes.append, message_alert=self.notes.append)
        heat = types.SimpleNamespace(class_id=2, name='Sport Heat 3')
        self.db = types.SimpleNamespace(heat_by_id=lambda i: heat,
                                        raceclass_by_id=lambda i: types.SimpleNamespace(name='Sport: Round/Robin'))
        self.race = types.SimpleNamespace(heat=7, round=2)


def plugin(cfg, recording=False, has_set_record_dir=True):
    p = oae.OBSAutoEscena(FakeRH(cfg))
    p.calls = []
    state = {'rec': recording}

    def req(rtype, data=None, timeout=4):
        p.calls.append((rtype, data))
        if rtype == 'SetRecordDirectory' and not has_set_record_dir:
            raise RuntimeError('unknown request type')
        if rtype == 'GetRecordStatus':
            return {'outputActive': state['rec']}
        if rtype == 'StopRecord':
            state['rec'] = False
            return {'outputPath': 'D:/DVR/Sport - Heat 3 - R2.mp4'}
        if rtype == 'StartRecord':
            state['rec'] = True
        return {}
    p._request = req
    return p


fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    fails += not ok
    print(('OK   ' if ok else 'FAIL ') + name + ('' if ok else '\n     got  {}\n     want {}'.format(got, want)))


base = {'host': '192.168.1.50', 'enabled': True, 'rec_enabled': True, 'rec_path': 'D:/DVR'}

# sin host: apagado aunque "enabled" esté marcado
check('sin IP de OBS = apagado', oae.OBSAutoEscena(FakeRH({'enabled': True})).enabled(), False)

# staging: escena de carrera por defecto + DVR con nombre sin caracteres prohibidos
p = plugin(base)
p.on_stage({})
types_called = [c[0] for c in p.calls]
check('staging: graba y cambia escena', 'StartRecord' in types_called and 'SetCurrentProgramScene' in types_called, True)
check('staging: escena por defecto', [c[1] for c in p.calls if c[0] == 'SetCurrentProgramScene'][0], {'sceneName': 'Carrera'})
check('staging: carpeta con SetRecordDirectory', [c[1] for c in p.calls if c[0] == 'SetRecordDirectory'][0],
      {'recordDirectory': 'D:/DVR'})
fname = [c[1]['parameterValue'] for c in p.calls if c[0] == 'SetProfileParameter'
         and c[1]['parameterName'] == 'FilenameFormatting'][0]
check('staging: nombre del archivo', fname, 'Sport- Round-Robin - Sport Heat 3 - R2 %CCYY-%MM-%DD %hh-%mm-%ss')

# OBS viejo sin SetRecordDirectory: escribe la carpeta en salida Simple y Avanzada
p = plugin(base, has_set_record_dir=False)
p.start_recording('x')
params = {(c[1]['parameterCategory'], c[1]['parameterName']) for c in p.calls if c[0] == 'SetProfileParameter'}
check('OBS viejo: AdvOut y SimpleOutput', {('AdvOut', 'RecFilePath'), ('SimpleOutput', 'FilePath')} <= params, True)

# descarte con modo por defecto (move): Discard se escribe al final
p = plugin(base, recording=True)
p.discard_recording()
dvr = [(c[1]['parameterName'], c[1]['parameterValue']) for c in p.calls
       if c[0] == 'SetProfileParameter' and c[1]['parameterCategory'] == oae.DVR_CATEGORY]
check('descarte move: parámetros para el script', dvr, [('Folder', 'D:/DVR'), ('Mode', 'move'),
                                                        ('Subfolder', 'descartadas'),
                                                        ('Discard', 'D:/DVR/Sport - Heat 3 - R2.mp4')])

# descarte con "keep": solo detiene la grabación
p = plugin(dict(base, rec_discard='keep'), recording=True)
p.discard_recording()
check('descarte keep: no pide nada al script',
      [c for c in p.calls if c[0] == 'SetProfileParameter'], [])

# escena vacía: no cambia
p = plugin(dict(base, scene_next='', rec_enabled=False))
p.set_scene('', 'prueba')
check('escena vacía: no llama a OBS', p.calls, [])

print('\n{} fallo(s)'.format(fails))
sys.exit(1 if fails else 0)
