'''Pruebas sin RotorHazard: python tests/test_chase_the_ace.py'''
import importlib.util
import os
import sys
import types

# RotorHazard no está instalado aquí: módulos mínimos para poder importar el plugin
for name in ('eventmanager', 'Results', 'RHUI'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['eventmanager'].Evt = type('Evt', (), {'CLASS_RANK_INITIALIZE': 'cri', 'LAPS_SAVE': 'ls'})
sys.modules['Results'].RaceClassRankMethod = lambda *a, **k: (a, k)


class _Field:
    def __init__(self, name, label, ftype, value=None, desc=None, **_):
        self.name, self.value = name, value


sys.modules['RHUI'].UIField = _Field
sys.modules['RHUI'].UIFieldType = type('T', (), {'BASIC_INT': 'int', 'TEXT': 'text'})

spec = importlib.util.spec_from_file_location('ctar', os.path.join(os.path.dirname(__file__), '..', 'funciones', 'chase-the-ace', 'chase_the_ace_rank', '__init__.py'))
ctar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctar)

IDS = {}


def race(order, laps=None, needed=3):
    '''order: callsigns from 1st to last. laps: completed laps per pilot (default = needed).'''
    lb = []
    for i, cs in enumerate(order):
        pid = IDS.setdefault(cs, len(IDS) + 1)
        lb.append({'pilot_id': pid, 'callsign': cs, 'position': i + 1,
                   'laps': (laps[i] if laps else needed), 'total_time_raw': 1000 * (i + 1)})
    return {'lb': lb, 'laps_needed': needed}


def ranking(board):
    return [(r['position'], r['callsign'], r['wins'], r['position_sum']) for r in board]


fails = 0


def check(name, got, want):
    global fails
    ok = got == want
    fails += not ok
    print(('OK   ' if ok else 'FAIL ') + name + ('' if ok else '\n     got  {}\n     want {}'.format(got, want)))


# 1) Final real del evento (callsigns cambiados): Bravo 2,1,2,1 -> campeón en la carrera 4
races = [race(['Alfa', 'Bravo', 'Charlie', 'Delta']),
         race(['Bravo', 'Charlie', 'Alfa', 'Delta']),
         race(['Charlie', 'Bravo', 'Delta', 'Alfa']),
         race(['Bravo', 'Charlie', 'Delta', 'Alfa'])]
board, info = ctar.build_multigp(races)
check('final real: campeón y suma de puestos', ranking(board),
      [(1, 'Bravo', 2, 6), (2, 'Charlie', 1, 8), (3, 'Alfa', 1, 12), (4, 'Delta', 0, 14)])
check('final real: carrera que define', info['clinched_race'], 4)

# 2) Desempate motocross (7.9.2): 3,1,2 [6] gana a 1,2,3 [6]; aquí nadie llega a 2 Aces
races = [race(['B', 'A', 'C', 'D']), race(['A', 'B', 'D', 'C']), race(['C', 'A', 'B', 'D'])]
# A: 2,1,2 = 5 · B: 1,2,3 = 6 · C: 3,4,1 = 8. Con wins=3 nadie es campeón todavía
board, info = ctar.build_multigp(races, wins=3)
check('sin campeón: primero más Aces', [r['callsign'] for r in board][:3], ['A', 'B', 'C'])
races = [race(['X', 'Y', 'Z', 'W']), race(['Y', 'Z', 'X', 'W']), race(['Z', 'X', 'Y', 'W']),
         race(['X', 'W', 'Z', 'Y'])]
# X gana la 1 y la 4 -> campeón. Y: 2,1,3,4 = 10 · Z: 3,2,1,3 = 9 · W: 4,4,4,2 = 14
board, info = ctar.build_multigp(races)
check('resto del podio por menor suma', ranking(board),
      [(1, 'X', 2, 7), (2, 'Z', 1, 9), (3, 'Y', 1, 10), (4, 'W', 0, 14)])
races = [race(['P', 'Q', 'R', 'S']), race(['Q', 'R', 'P', 'S']), race(['R', 'P', 'Q', 'S']),
         race(['P', 'S', 'R', 'Q'])]
# P campeón. Q: 2,1,3,4 = 10 · R: 3,2,1,3 = 9 · S: 4,4,4,2 = 14 -> sin empate; forzar uno:
races = [race(['P', 'Q', 'R', 'S']), race(['R', 'Q', 'P', 'S']), race(['Q', 'R', 'S', 'P']),
         race(['P', 'R', 'Q', 'S'])]
# P campeón (1ª y 4ª). Q: 2,2,1,3 = 8 · R: 3,1,2,2 = 8 -> empate: última carrera R 2.º, Q 3.º -> R antes
board, info = ctar.build_multigp(races)
check('empate en suma: decide la última carrera', [r['callsign'] for r in board], ['P', 'R', 'Q', 'S'])

# 3) Carrera nula: el ganador no completó las 3 vueltas -> sin Ace ni posiciones
races = [race(['A', 'B', 'C', 'D'], laps=[2, 2, 1, 0]),
         race(['B', 'A', 'C', 'D']), race(['B', 'C', 'A', 'D'])]
board, info = ctar.build_multigp(races)
check('carrera nula: no cuenta', info['void_races'], [1])
check('carrera nula: B campeón con 2 Aces', ranking(board)[0], (1, 'B', 2, 2))
check('carrera nula: resultado 0 en la tabla', [r['results'] for r in board if r['callsign'] == 'A'][0], [0, 2, 3])

# 4) Ganador sin completar vueltas pero otro sí (no pasa en first-to-X, pero RH ordena por vueltas):
races = [race(['A', 'B'], laps=[3, 2])]
board, info = ctar.build_multigp(races)
check('ganador con las vueltas: Ace', board[0]['wins'], 1)

# 5) Ironman: gana la 1.ª carrera -> campeón
races = [race(['Top', 'B', 'C', 'D']), race(['B', 'Top', 'C', 'D'])]
board, info = ctar.build_multigp(races, ironman='top')
check('ironman gana la carrera 1 -> campeón', (board[0]['callsign'], info['clinched_race'], info['ironman']),
      ('Top', 1, 'won'))
# pierde la 1.ª -> se desactiva y sigue el formato normal
races = [race(['B', 'Top', 'C', 'D']), race(['Top', 'B', 'C', 'D'])]
board, info = ctar.build_multigp(races, ironman='Top')
check('ironman pierde la 1 -> desactivado', (info['ironman'], info['champion']), ('disengaged', None))
# carrera 1 nula -> Ironman desactivado (7.9.2)
races = [race(['Top', 'B'], laps=[1, 0]), race(['Top', 'B'])]
board, info = ctar.build_multigp(races, ironman='Top')
check('carrera 1 nula -> ironman desactivado', (info['ironman'], info['champion']), ('disengaged', None))

# 6) finish_laps del ajuste manda sobre el formato
races = [race(['A', 'B'], laps=[3, 2], needed=0)]
board, info = ctar.build_multigp(races, finish_laps=4)
check('finish_laps=4: carrera nula', info['void_races'], [1])

# 7) Carreras después del título no cuentan
races = [race(['A', 'B', 'C']), race(['A', 'C', 'B']), race(['C', 'B', 'A'])]
board, info = ctar.build_multigp(races)
check('carreras de más no cuentan', ranking(board), [(1, 'A', 2, 2), (2, 'C', 0, 5), (3, 'B', 0, 5)][:1] + ranking(board)[1:])
check('carreras de más: suma de C y B sin la 3.ª', sorted((r['callsign'], r['position_sum']) for r in board[1:]),
      [('B', 5), ('C', 5)])
check('max de carreras con 4 pilotos', ctar.build_multigp([race(['A', 'B', 'C', 'D'])])[1]['max_races'], 5)

print('\n{} fallo(s)'.format(fails))
sys.exit(1 if fails else 0)
