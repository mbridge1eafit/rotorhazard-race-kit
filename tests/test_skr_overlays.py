'''Pruebas sin RotorHazard: python tests/test_skr_overlays.py
Revisa el estado en vivo (/skr/carrera.json) y el Chase the Ace propio (sin chase_the_ace_rank).'''
import importlib.util
import json
import os
import sys
import types

flask = types.ModuleType('flask')
for name in ('Blueprint', 'jsonify', 'request', 'send_file'):
    setattr(flask, name, None)
sys.modules['flask'] = flask

spec = importlib.util.spec_from_file_location(
    'skr', os.path.join(os.path.dirname(__file__), '..', 'funciones', 'overlays', 'skr_overlays', '__init__.py'))
skr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(skr)

fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    fails += not ok
    print(('OK   ' if ok else 'FAIL ') + name + ('' if ok else '\n     got  {}\n     want {}'.format(got, want)))


NS = types.SimpleNamespace
pilots = {1: NS(callsign='Alfa', name='Ana'), 2: NS(callsign='Bravo', name='Beto'), 3: NS(callsign='Charlie', name='')}


def fake_rhapi(status, results):
    db = NS(heat_by_id=lambda i: NS(display_name='Pro Heat 4', class_id=2),
            raceclass_by_id=lambda i: NS(name='Pro'),
            pilot_by_id=lambda i: pilots.get(i),
            frequencyset_by_id=lambda i: NS(frequencies=json.dumps(
                {'b': ['R', 'R', 'F', None], 'c': [1, 2, 4, None], 'f': [5658, 5695, 5800, 5880]})))
    race = NS(status=status, heat=4, round=1, frequencyset=3, pilots=[1, 2, 3, 0],
              raceformat=NS(number_laps_win=3, unlimited_time=0, race_time_sec=120),
              results=results, seats_finished={1: True}, laps=LAPS)
    return NS(db=db, race=race)


def lap(n, t, ts, **kw):
    return dict({'lap_number': n, 'lap_time': t, 'lap_time_stamp': ts, 'deleted': False, 'late_lap': False}, **kw)


LAPS = {'node_index': [
    {'laps': [lap(0, 1383, 1383), lap(1, 22900, 24283), lap(2, 23410, 47693)]},
    {'laps': [lap(0, 2003, 2003), lap(1, 31784, 33787), lap(None, 5000, 38787, deleted=True), lap(2, 21870, 55657)]},
    {'laps': []},
    {'laps': []},
]}

results = {'meta': {'primary_leaderboard': 'by_race_time'}, 'by_race_time': [
    {'node': 1, 'position': 1, 'laps': 3, 'last_lap_raw': 21870, 'fastest_lap_raw': 21870},
    {'node': 0, 'position': 2, 'laps': 2, 'last_lap_raw': 23410, 'fastest_lap_raw': 22900},
    {'node': 2, 'position': 3, 'laps': 0, 'last_lap_raw': None, 'fastest_lap_raw': 0},
]}

live = skr.build_live(fake_rhapi(1, results))
check('en vivo: estado', live['status'], 'racing')
check('en vivo: canales del perfil (y MHz si no hay banda)', [s['channel'] for s in live['seats']], ['R1', 'R2', 'F4', 'R7'])
check('en vivo: puesto vacío', live['seats'][3]['active'], False)
check('en vivo: posición, vueltas y tiempos', [(s['position'], s['laps'], s['last_lap'], s['fastest_lap']) for s in live['seats'][:3]],
      [(2, 2, '23.410', '22.900'), (1, 3, '21.870', '21.870'), (None, 0, '', '')])
check('en vivo: terminó', [s['finished'] for s in live['seats']], [False, True, False, False])
check('en vivo: holeshot y vueltas (sin borradas)', [[(c['lap'], c['time']) for c in s['crossings']] for s in live['seats'][:2]],
      [[(0, '0:01.383'), (1, '0:22.900'), (2, '0:23.410')], [(0, '0:02.003'), (1, '0:31.784'), (2, '0:21.870')]])
check('en vivo: tiempo total y vuelta actual', [(s['total'], s['lap_number']) for s in live['seats'][:3]],
      [('0:47.693', 2), ('0:55.657', 2), ('', None)])
check('reloj: minutos', skr.fmt_clock(125004), '2:05.004')
ready = skr.build_live(fake_rhapi(0, results))
check('antes de la carrera: sin posiciones ni vueltas', ([s['position'] for s in ready['seats']], [s['crossings'] for s in ready['seats']]),
      ([None] * 4, [[]] * 4))
check('antes de la carrera: pilotos y canal (próximo heat)', [(s['callsign'], s['channel']) for s in ready['seats'] if s['active']],
      [('Alfa', 'R1'), ('Bravo', 'R2'), ('Charlie', 'F4')])

# Chase the Ace propio: primero en 2 victorias, suma de puestos, desempate por la última
order, stats, champ, n = skr.chase_basic([{1: 2, 2: 1, 3: 3}, {1: 1, 2: 3, 3: 2}, {1: 1, 2: 2, 3: 3}, {1: 3, 2: 1, 3: 2}], 2)
check('chase propio: campeón y carrera que define', (champ, n), (1, 3))
check('chase propio: orden por suma', [(p, stats[p]['sum']) for p in order], [(1, 4), (2, 6), (3, 8)])
order, stats, champ, n = skr.chase_basic([{1: 1, 2: 2, 3: 3}, {1: 2, 2: 1, 3: 3}], 2)
check('chase propio: sin campeón todavía', (champ, n), (None, 2))
check('chase propio: empate en suma y victorias, decide la última', order[:2], [2, 1])

print('\n{} fallo(s)'.format(fails))
sys.exit(1 if fails else 0)
