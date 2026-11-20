'''SKR Overlays: páginas para OBS (browser source, 1920x1080, fondo transparente). No dependen de
otros plugins: leen RotorHazard directamente (la carrera en curso y la base de datos).

En vivo (/skr/carrera.json, la carrera en curso):
/skr/nodos            Overlay de cada piloto sobre su cuadro de video: posición, piloto, canal,
                      vueltas, última y mejor vuelta. ?nodos=1,2,3,4&disposicion=2x2
/skr/proximo-heat     Pilotos del heat actual con su canal (antes de que arranque la carrera).

Desde la base de datos (sobreviven a reinicios):
/skr/ultima-carrera   Resultado de la última carrera guardada con el tiempo de cada vuelta.
/skr/posiciones       Tablas de una o varias clases lado a lado. ?clases=2,3 | actual | todas
/skr/chase            Final Chase the Ace: Aces, puesto en cada carrera y suma. ?clases=actual | 4
/skr/podio            Podio animado de cualquier clase (ranking de la clase o sus resultados). ?clase=actual | 4
/skr/proximo-y-anterior  Próximo heat arriba y resultado de la última carrera abajo, en una sola página.

Cada página tiene su JSON (<página>.json). Los parámetros de presentación (idioma, colores,
títulos, zona de final...) van en la URL de la página: ver funciones/overlays/README.md.
Chase the Ace usa el ranking del plugin chase_the_ace_rank si la clase lo tiene (carreras nulas,
Ironman); si no, calcula aquí lo básico: primero en N victorias y suma de puestos.

Los colores de cada puesto salen de Ajustes → LED → colores de puesto (o los de fábrica), y el
idioma por defecto es el de la interfaz de RotorHazard.
'''

import json
import logging
import os

from flask import Blueprint, jsonify, request, send_file

logger = logging.getLogger(__name__)

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = '/skr'

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


STATUS = {0: 'ready', 3: 'staging', 1: 'racing', 2: 'done'}  # RHRace.RaceStatus


def _ms(value):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def fmt_clock(ms):
    '''31784 -> "0:31.784" (formato de reloj de los overlays de carrera)'''
    if ms is None:
        return ''
    ms = max(0, int(round(float(ms))))
    return '{}:{:02d}.{:03d}'.format(ms // 60000, (ms // 1000) % 60, ms % 1000)


def seat_crossings(rhapi):
    '''{puesto: [(número de vuelta, ms de la vuelta, ms desde la largada)]} de la carrera en curso.
    Vuelta 0 = holeshot. Sin las borradas ni las tardías.'''
    out = {}
    try:
        nodes = (rhapi.race.laps or {}).get('node_index') or []
    except Exception as ex:
        logger.debug('skr_overlays: sin vueltas: %s', ex)
        return out
    for i, node in enumerate(nodes):
        laps = []
        for lap in (node or {}).get('laps') or []:
            if lap.get('deleted') or lap.get('late_lap') or lap.get('lap_number') is None or lap.get('lap_number') < 0:
                continue
            laps.append((int(lap['lap_number']), lap.get('lap_time') or 0, lap.get('lap_time_stamp') or 0))
        out[i] = laps
    return out


def seat_channels(rhapi):
    '''[(etiqueta, MHz)] por puesto según el perfil de frecuencias activo.'''
    out = []
    try:
        fs = rhapi.db.frequencyset_by_id(rhapi.race.frequencyset)
        data = json.loads(fs.frequencies) if isinstance(fs.frequencies, str) else (fs.frequencies or {})
        bands, chans, freqs = data.get('b') or [], data.get('c') or [], data.get('f') or []
        for i, f in enumerate(freqs):
            b = bands[i] if i < len(bands) else None
            c = chans[i] if i < len(chans) else None
            label = '{}{}'.format(b, c) if b and c else channel_label(f)
            out.append((label if f else '', f or 0))
    except Exception as ex:
        logger.debug('skr_overlays: sin perfil de frecuencias: %s', ex)
    return out


def build_live(rhapi):
    '''La carrera en curso: un renglón por puesto con piloto, canal, posición y vueltas.'''
    db = rhapi.db
    race = rhapi.race
    status = STATUS.get(int(race.status), str(race.status))
    heat = db.heat_by_id(race.heat) if race.heat else None
    rc = db.raceclass_by_id(heat.class_id) if heat and heat.class_id else None
    fmt = race.raceformat
    results = race.results or {}
    primary = (results.get('meta') or {}).get('primary_leaderboard') or 'by_race_time'
    rows = {r.get('node'): r for r in (results.get(primary) or [])}
    finished = race.seats_finished or {}
    channels = seat_channels(rhapi)
    show_results = status in ('racing', 'done')
    crossings = seat_crossings(rhapi) if show_results else {}

    seats = []
    for i, pid in enumerate(race.pilots or []):
        pilot = db.pilot_by_id(pid) if pid and pid > 0 else None
        label, freq = channels[i] if i < len(channels) else ('', 0)
        row = rows.get(i) if show_results else None
        cross = crossings.get(i) or []
        seats.append({
            'seat': i,
            'active': pilot is not None,
            'callsign': pilot.callsign if pilot else '',
            'name': pilot.name if pilot else '',
            'channel': label,
            'frequency': freq,
            'position': row.get('position') if row and (cross or row.get('laps') or status == 'done') else None,
            'laps': int(row.get('laps') or 0) if row else 0,
            'last_lap': fmt_time(_ms(row.get('last_lap_raw')) / 1000.0) if row and _ms(row.get('last_lap_raw')) else '',
            'fastest_lap': fmt_time(_ms(row.get('fastest_lap_raw')) / 1000.0) if row and _ms(row.get('fastest_lap_raw')) else '',
            'finished': bool(finished.get(i)) if hasattr(finished, 'get') else False,
            # cada paso por la meta: vuelta (0 = holeshot) y su tiempo; total = tiempo desde la largada
            'crossings': [{'lap': n, 'time': fmt_clock(t)} for n, t, _ in cross],
            'lap_number': cross[-1][0] if cross else None,
            'total': fmt_clock(cross[-1][2]) if cross else '',
        })
    return {
        'status': status,
        'heat': (heat.display_name if heat else '') or ('Heat {}'.format(race.heat) if race.heat else ''),
        'class': rc.name if rc else '',
        'round': race.round,
        'laps_to_win': getattr(fmt, 'number_laps_win', 0) or 0,
        'race_time_sec': 0 if getattr(fmt, 'unlimited_time', 0) else (getattr(fmt, 'race_time_sec', 0) or 0),
        'seats': seats,
    }


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


def chase_basic(races, wins_needed):
    '''Sin el plugin chase_the_ace_rank: primero en N victorias, resto por menor suma de puestos y
    desempate por la última carrera. races = [{pilot_id: puesto}] en orden. No sabe de carreras
    nulas ni Ironman.'''
    stats = {}
    champion = None
    counted = 0
    for n, race in enumerate(races):
        counted = n + 1
        for pid, pos in race.items():
            st = stats.setdefault(pid, {'wins': 0, 'sum': 0, 'last': None, 'results': [None] * len(races)})
            st['sum'] += pos
            st['last'] = pos
            st['results'][n] = pos
            if pos == 1:
                st['wins'] += 1
                if champion is None and st['wins'] >= wins_needed:
                    champion = pid
        if champion is not None:
            break
    for st in stats.values():
        st['results'] = st['results'][:counted]
    order = sorted(stats, key=lambda pid: (0 if pid == champion else 1,
                                           -stats[pid]['wins'] if champion is None else 0,
                                           stats[pid]['sum'], stats[pid]['last'] or 99))
    return order, stats, champion, counted


def build_chase(rhapi, class_ids, wins_needed=2):
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

        n_races = info.get('races')
        rows = []
        seen = set()
        champion = None
        if not info:
            # la clase no usa el ranking de chase_the_ace_rank: cálculo propio
            races = []
            for h in db.heats_by_class(cid):
                for race in db.races_by_heat(h.id):
                    res = db.race_results(race)
                    if res:
                        lb = sorted(res[res['meta']['primary_leaderboard']], key=lambda l: (l.get('position') or 99))
                        races.append((race.id, {l['pilot_id']: i for i, l in enumerate(lb, start=1)}))
            races.sort(key=lambda r: r[0])
            order, stats, champ_id, n_races = chase_basic([r for _, r in races], wins_needed)
            src = []
            for pos, pid in enumerate(order, start=1):
                pilot = db.pilot_by_id(pid)
                st = stats[pid]
                src.append({'pilot_id': pid, 'callsign': pilot.callsign if pilot else '?', 'position': pos,
                            'wins': st['wins'], 'position_sum': st['sum'], 'last_position': st['last'],
                            'status': 'Champion' if pid == champ_id else '', 'results': st['results']})
            info = {'wins_needed': wins_needed, 'races': n_races}

        for r in src:
            pid = r.get('pilot_id')
            seen.add(pid)
            if r.get('status'):
                champion = r.get('callsign')
            rows.append({'position': r.get('position'), 'callsign': r.get('callsign') or '',
                         'wins': r.get('wins') or 0, 'sum': r.get('position_sum'),
                         'last': r.get('last_position'), 'champion': bool(r.get('status')),
                         'results': r.get('results') or []})
        for pid in seeds:
            if pid in seen:
                continue
            pilot = db.pilot_by_id(pid)
            rows.append({'position': None, 'callsign': pilot.callsign if pilot else '?', 'wins': 0,
                         'sum': None, 'last': None, 'champion': False, 'results': []})
        need = info.get('wins_needed') or wins_needed
        out.append({'id': cid, 'name': rc.name, 'races': n_races or 0, 'champion': champion,
                    'wins_needed': need,
                    'max_races': info.get('max_races') or (need - 1) * max(len(rows), 1) + 1,
                    'void_races': info.get('void_races') or [],
                    'ironman': info.get('ironman'),
                    'pilots': rows})
    return {'classes': out}


# Campos de ranking que no se muestran como dato en el podio (ya están en la posición o no aportan)
PODIUM_SKIP = {'position', 'pilot_id', 'callsign', 'team_name', 'node', 'results', 'last_position', 'status'}


def _podium_value(value):
    if value is None or value == '' or value is False:
        return None
    if isinstance(value, float):
        return round(value, 3)
    return value


def build_podium(rhapi, class_id, mode='auto', wins_needed=2):
    '''Podio de cualquier clase. Orden: el ranking de la clase (puntos, Chase the Ace o el método que
    tenga); si la clase no tiene ranking, sus resultados (por tiempo, vuelta rápida o consecutivas).
    pending = la final Chase the Ace todavía no tiene campeón (el podio espera).'''
    db = rhapi.db
    rc = db.raceclass_by_id(class_id) if class_id else None
    if not rc:
        return {'class': None, 'podium': [], 'pending': False}
    try:
        event = db.option('eventName', '') or ''
    except Exception:
        event = ''
    out = {'class': {'id': rc.id, 'name': rc.name}, 'event': event, 'pending': False, 'chase': False,
           'source': None, 'podium': []}

    if mode == 'chase':
        # Chase the Ace aunque la clase no use el ranking de chase_the_ace_rank (cálculo propio)
        data = build_chase(rhapi, [class_id], wins_needed)['classes']
        c = data[0] if data else None
        out.update({'chase': True, 'source': 'chase', 'pending': not (c and c['champion'])})
        for r in sorted((r for r in (c['pilots'] if c else []) if r['position']), key=lambda r: r['position'])[:3]:
            stats = [{'key': 'wins', 'value': r['wins']}]
            if r['sum'] is not None:
                stats.append({'key': 'position_sum', 'value': r['sum']})
            out['podium'].append({'position': r['position'], 'callsign': r['callsign'], 'stats': stats})
        return out

    ranking = db.raceclass_ranking(class_id)
    rows = _ranking_rows(ranking)
    meta = (ranking.get('meta') or {}) if isinstance(ranking, dict) else {}
    if rows:
        chase = meta.get('chase_the_ace')
        out['source'] = 'ranking'
        if chase:
            out.update({'chase': True, 'pending': not chase.get('champion')})
        fields = [f for f in (meta.get('rank_fields') or []) if f.get('name') not in PODIUM_SKIP]
        for r in sorted((r for r in rows if r.get('position')), key=lambda r: r.get('position'))[:3]:
            stats = []
            for f in fields:
                v = _podium_value(r.get(f['name']))
                if v is not None:
                    stats.append({'key': f['name'], 'label': f.get('label') or f['name'], 'value': v})
            out['podium'].append({'position': r.get('position'), 'callsign': r.get('callsign') or '', 'stats': stats})
        return out

    # sin ranking: resultados de la clase según su condición de victoria
    results = db.raceclass_results(class_id) or {}
    primary = (results.get('meta') or {}).get('primary_leaderboard') or 'by_race_time'
    board = [r for r in (results.get(primary) or []) if r.get('position')]
    out['source'] = primary
    for r in sorted(board, key=lambda r: r.get('position'))[:3]:
        if primary == 'by_consecutives':
            stats = [{'key': 'consecutives', 'value': r.get('consecutives')}]
        elif primary == 'by_fastest_lap':
            stats = [{'key': 'fastest_lap', 'value': r.get('fastest_lap')}]
        else:
            stats = [{'key': 'laps', 'value': r.get('laps')}, {'key': 'total_time', 'value': r.get('total_time')}]
        stats = [x for x in stats if _podium_value(x['value']) is not None]
        out['podium'].append({'position': r.get('position'), 'callsign': r.get('callsign') or '', 'stats': stats})
    return out


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
    bp = Blueprint('skr_overlays', __name__, static_folder='static',
                   static_url_path=PREFIX + '/static')

    def page(name):
        return send_file(os.path.join(HERE, 'static', name + '.html'))

    def reply(builder, what):
        try:
            data = builder()
        except Exception as ex:
            logger.exception('skr_overlays: error armando %s', what)
            data = {'error': str(ex)}
        data['seat_colors'] = seat_colors(rhapi)
        data['lang'] = ui_language(rhapi)
        resp = jsonify(data)
        resp.headers['Cache-Control'] = 'no-store'
        resp.headers['Access-Control-Allow-Origin'] = '*'
        return resp

    @bp.route(PREFIX + '/carrera.json')
    def live_json():
        return reply(lambda: build_live(rhapi), 'la carrera en curso')

    @bp.route(PREFIX + '/nodos')
    def nodes_page():
        return page('nodos')

    @bp.route(PREFIX + '/proximo-heat')
    def upcoming_page():
        return page('proximo-heat')

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
        try:
            aces = max(1, int(request.args.get('aces') or 2))
        except ValueError:
            aces = 2
        return reply(lambda: build_chase(rhapi, parse_classes(rhapi, request.args.get('clases')), aces),
                     'chase the ace')

    @bp.route(PREFIX + '/podio')
    def podium_page():
        return page('podio')

    @bp.route(PREFIX + '/podio.json')
    def podium_json():
        ids = parse_classes(rhapi, request.args.get('clase'))
        try:
            aces = max(1, int(request.args.get('aces') or 2))
        except ValueError:
            aces = 2
        mode = (request.args.get('modo') or 'auto').lower()
        return reply(lambda: build_podium(rhapi, ids[0] if ids else None, mode, aces), 'el podio')

    @bp.route(PREFIX + '/proximo-y-anterior')
    def next_and_last_page():
        return page('proximo-y-anterior')

    rhapi.ui.blueprint_add(bp)
    logger.info('skr_overlays: %s/{nodos,proximo-heat,ultima-carrera,proximo-y-anterior,posiciones,chase,podio} listos',
                PREFIX)
