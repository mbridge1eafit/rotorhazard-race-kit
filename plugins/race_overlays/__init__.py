'''Race Overlays: páginas para OBS (browser source, 1920x1080, fondo transparente) que leen la
base de datos de RotorHazard, así que siguen funcionando después de reiniciar el servidor.

/race-overlays/ultima-carrera   Resultado de la última carrera guardada: posición, piloto, canal,
                                vueltas, mejor tiempo y el tiempo de cada vuelta.
/race-overlays/posiciones       Tablas de una o varias clases lado a lado (posición, piloto, puntos,
                                baterías corridas y victorias). ?clases=2,3 | actual | todas
/race-overlays/chase            Final Chase the Ace: victorias, puesto en cada carrera y suma.
                                ?clases=actual (por defecto) | 4 | 4,5
/race-overlays/podio            Podio animado de una final con campeón. ?clase=actual | 4

Cada página tiene su JSON (<página>.json). Los parámetros de presentación (idioma, colores,
títulos, zona de final...) van en la URL de la página: ver docs/overlays.md.

Los colores de cada puesto salen de Ajustes → LED → colores de puesto (o los de fábrica), y el
idioma por defecto es el de la interfaz de RotorHazard.
'''

import logging
import os

from flask import Blueprint, jsonify, request, send_file

logger = logging.getLogger(__name__)

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = '/race-overlays'

BANDS = {
    'R': [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
    'F': [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
    'E': [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
    'A': [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
    'B': [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
    'L': [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621],
}
# Raceband primero: 5880 es R7 y F7, se muestra como R7
BAND_ORDER = ['R', 'F', 'E', 'A', 'B', 'L']
FALLBACK_COLORS = ['#0022ff', '#ff5500', '#00ff22', '#ff0055', '#ddff00', '#9900ff', '#00ffff', '#ffffff']


def channel_label(freq):
    if not freq:
        return ''
    for band in BAND_ORDER:
        if freq in BANDS[band]:
            return '{}{}'.format(band, BANDS[band].index(freq) + 1)
    return str(freq)


def fmt_time(seconds):
    if seconds is None:
        return ''
    try:
        seconds = float(seconds)
    except (TypeError, ValueError):
        return str(seconds)
    if seconds >= 60:
        return '{}:{:06.3f}'.format(int(seconds // 60), seconds % 60)
    return '{:.3f}'.format(seconds)


def _hex(c):
    if isinstance(c, int):
        return '#{:06x}'.format(c & 0xFFFFFF)
    c = str(c or '').strip()
    if not c:
        return None
    return c if c.startswith('#') else '#' + c


def seat_colors(rhapi):
    '''Colores de puesto configurados en RotorHazard (Ajustes → LED), o los de fábrica.'''
    cols = None
    try:
        cols = rhapi.config.get_item('LED', 'seatColors')
    except Exception:
        pass
    if not cols:
        try:
            cols = rhapi.server.seat_color_defaults
        except Exception:
            cols = None
    out = [h for h in (_hex(c) for c in (cols or [])) if h]
    return out or FALLBACK_COLORS


def ui_language(rhapi):
    try:
        lang = rhapi.config.get_item('UI', 'currentLanguage')
    except Exception:
        lang = None
    return (lang or 'en').split('-')[0].lower()


def build_last_race(rhapi):
    db = rhapi.db
    races = db.races
    if not races:
        return {'race': None}
    race = max(races, key=lambda r: r.id)

    heat = db.heat_by_id(race.heat_id) if race.heat_id else None
    heat_name = (heat.display_name if heat else '') or 'Heat {}'.format(race.heat_id)
    raceclass = db.raceclass_by_id(race.class_id) if race.class_id else None
    fmt = db.raceformat_by_id(race.format_id) if race.format_id else None

    results = db.race_results(race) or {}
    meta = results.get('meta', {}) or {}
    primary = meta.get('primary_leaderboard') or 'by_race_time'
    board = results.get(primary) or results.get('by_race_time') or []
    consec_count = meta.get('consecutives_count') or 3

    runs = {run.node_index: run for run in db.pilotruns_by_race(race.id)}

    pilots = []
    for row in board:
        node = row.get('node')
        run = runs.get(node)
        laps = []
        if run is not None:
            laps = [lap for lap in db.laps_by_pilotrun(run.id) if not lap.deleted]
            laps.sort(key=lambda lap: lap.lap_time_stamp)
        n_laps = int(row.get('laps') or 0)
        # Los cruces que sobran respecto a las vueltas contadas son el holeshot (vuelta 0)
        extra = max(0, len(laps) - n_laps)
        lap_times = [lap.lap_time / 1000.0 for lap in laps[extra:]]
        fastest = min(lap_times) if lap_times else None
        pilots.append({
            'position': row.get('position'),
            'callsign': row.get('callsign') or '',
            'node': node,
            'channel': channel_label(run.frequency if run is not None else None),
            'laps': n_laps,
            'consecutives': row.get('consecutives') or '',
            'consecutives_base': row.get('consecutives_base') or 0,
            'fastest_lap': row.get('fastest_lap') or '',
            'total_time': row.get('total_time') or '',
            'lap_times': [fmt_time(t) for t in lap_times],
            'fastest_index': lap_times.index(fastest) if fastest is not None else None,
        })

    return {
        'race': {
            'id': race.id,
            'heat': heat_name,
            'class': raceclass.name if raceclass else '',
            'round': race.round_id,
            'format': fmt.name if fmt else '',
            'primary': primary,
            'consecutives_count': consec_count,
            'time': race.start_time_formatted,
        },
        'pilots': pilots,
    }


def _ranking_rows(ranking):
    if not ranking:
        return []
    if isinstance(ranking, dict):
        ranking = ranking.get('ranking') or []
    return list(ranking) if isinstance(ranking, (list, tuple)) else []


def build_standings(rhapi, class_ids):
    db = rhapi.db
    out = []
    for cid in class_ids:
        rc = db.raceclass_by_id(cid)
        if not rc:
            continue
        heats = [h for h in db.heats_by_class(cid) if getattr(h, 'active', True)]
        heats_done = sum(1 for h in heats if db.races_by_heat(h.id))
        flights = {}
        for h in heats:
            for slot in db.slots_by_heat(h.id):
                if slot.pilot_id:
                    flights[slot.pilot_id] = flights.get(slot.pilot_id, 0) + 1
        rows = []
        seen = set()
        for r in _ranking_rows(db.raceclass_ranking(cid)):
            pid = r.get('pilot_id')
            seen.add(pid)
            rows.append({'position': r.get('position'), 'callsign': r.get('callsign') or '',
                         'points': r.get('points') or 0, 'wins': r.get('wins') or 0,
                         'races': r.get('races') or 0, 'flights': flights.get(pid, 0)})
        rest = []
        for pid, n in flights.items():
            if pid in seen:
                continue
            pilot = db.pilot_by_id(pid)
            rest.append({'position': None, 'callsign': pilot.callsign if pilot else '?',
                         'points': 0, 'wins': 0, 'races': 0, 'flights': n})
        rest.sort(key=lambda x: x['callsign'].lower())
        out.append({'id': cid, 'name': rc.name, 'heats': len(heats), 'heats_done': heats_done,
                    'pilots': rows + rest})
    return {'classes': out}


def build_chase(rhapi, class_ids):
    '''Final Chase the Ace: Aces, suma de puestos y puesto en cada carrera.
    Con el ranking "MultiGP Chase the Ace" del plugin chase_the_ace_rank usa sus datos
    (carreras nulas, Ironman, Aces necesarios); con otro ranking los calcula aquí.'''
    db = rhapi.db
    out = []
    for cid in class_ids:
        rc = db.raceclass_by_id(cid)
        if not rc:
            continue
        seeds = []
        for h in db.heats_by_class(cid):
            for slot in sorted(db.slots_by_heat(h.id), key=lambda s: s.node_index if s.node_index is not None else 99):
                if slot.pilot_id and slot.pilot_id not in seeds:
                    seeds.append(slot.pilot_id)
        ranking = db.raceclass_ranking(cid)
        info = ((ranking.get('meta') or {}).get('chase_the_ace') if isinstance(ranking, dict) else None) or {}
        src = _ranking_rows(ranking)

        history = {}
        n_races = info.get('races')
        if not info:
            races = []
            for h in db.heats_by_class(cid):
                for race in db.races_by_heat(h.id):
                    res = db.race_results(race)
                    if res:
                        races.append((race.id, res[res['meta']['primary_leaderboard']]))
            races.sort(key=lambda r: r[0])
            n_races = len(races)
            for n, (_, lb) in enumerate(races):
                ordered = sorted(lb, key=lambda l: (l.get('position') or 99))
                for idx, line in enumerate(ordered, start=1):
                    history.setdefault(line['pilot_id'], [None] * n_races)[n] = idx

        rows = []
        seen = set()
        champion = None
        for r in src:
            pid = r.get('pilot_id')
            seen.add(pid)
            if r.get('status'):
                champion = r.get('callsign')
            rows.append({'position': r.get('position'), 'callsign': r.get('callsign') or '',
                         'wins': r.get('wins') or 0, 'sum': r.get('position_sum'),
                         'last': r.get('last_position'), 'champion': bool(r.get('status')),
                         'results': r.get('results') if 'results' in r else history.get(pid, [])})
        for pid in seeds:
            if pid in seen:
                continue
            pilot = db.pilot_by_id(pid)
            rows.append({'position': None, 'callsign': pilot.callsign if pilot else '?', 'wins': 0,
                         'sum': None, 'last': None, 'champion': False, 'results': []})
        wins_needed = info.get('wins_needed') or 2
        out.append({'id': cid, 'name': rc.name, 'races': n_races or 0, 'champion': champion,
                    'wins_needed': wins_needed,
                    'max_races': info.get('max_races') or (wins_needed - 1) * max(len(rows), 1) + 1,
                    'void_races': info.get('void_races') or [],
                    'ironman': info.get('ironman'),
                    'pilots': rows})
    return {'classes': out}


def parse_classes(rhapi, arg, default='actual'):
    '''"2,3" → [2, 3] · "actual" → clase del heat actual · "todas" → todas las clases con heats.'''
    arg = (arg or default).strip().lower()
    if arg in ('actual', 'current'):
        heat = rhapi.db.heat_by_id(rhapi.race.heat) if rhapi.race.heat else None
        return [heat.class_id] if heat and heat.class_id else []
    if arg in ('todas', 'all'):
        return [rc.id for rc in rhapi.db.raceclasses if rhapi.db.heats_by_class(rc.id)]
    return [int(x) for x in arg.split(',') if x.strip().isdigit()]


def initialize(rhapi):
    bp = Blueprint('race_overlays', __name__, static_folder='static',
                   static_url_path=PREFIX + '/static')

    def page(name):
        return send_file(os.path.join(HERE, 'static', name + '.html'))

    def reply(builder, what):
        try:
            data = builder()
        except Exception as ex:
            logger.exception('race_overlays: error armando %s', what)
            data = {'error': str(ex)}
        data['seat_colors'] = seat_colors(rhapi)
        data['lang'] = ui_language(rhapi)
        resp = jsonify(data)
        resp.headers['Cache-Control'] = 'no-store'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp

    @bp.route(PREFIX + '/ultima-carrera')
    def last_race_page():
        return page('ultima-carrera')

    @bp.route(PREFIX + '/ultima-carrera.json')
    def last_race_json():
        return reply(lambda: build_last_race(rhapi), 'la última carrera')

    @bp.route(PREFIX + '/posiciones')
    def standings_page():
        return page('posiciones')

    @bp.route(PREFIX + '/posiciones.json')
    def standings_json():
        return reply(lambda: build_standings(rhapi, parse_classes(rhapi, request.args.get('clases'))),
                     'posiciones')

    @bp.route(PREFIX + '/chase')
    def chase_page():
        return page('chase')

    @bp.route(PREFIX + '/chase.json')
    def chase_json():
        return reply(lambda: build_chase(rhapi, parse_classes(rhapi, request.args.get('clases'))),
                     'chase the ace')

    @bp.route(PREFIX + '/podio')
    def podium_page():
        return page('podio')

    rhapi.ui.blueprint_add(bp)
    logger.info('race_overlays: %s/{ultima-carrera,posiciones,chase,podio} listos', PREFIX)
