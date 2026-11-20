'''Class ranking methods for Chase the Ace finals.

1) "MultiGP Chase the Ace" — 2026 MultiGP Rules & Regulations, section 7.9.2
   "Chase the Ace Race Format for Final":
   - The final starts with a clean slate (bracket results do not count).
   - The champion is the first pilot to earn two Aces. An Ace = winning the race AND
     completing the last lap through the finish gate (the designated number of laps).
   - If no pilot completes the designated number of laps, no Ace or points are awarded,
     the heat is void for scoring, and Ironman is disengaged.
   - The rest of the podium is decided by the lowest sum of finishing positions
     (1,2,3 = 6 beats 2,2,3 = 7); ties are broken motocross style, by the ranking in the
     last race (3,1,2 = 6 beats 1,2,3 = 6).
   - OPTIONAL Ironman clause: if the top qualifier won every bracket race, they win the
     event by winning the first race of the final. If they do not, Ironman is disengaged.
   Races run after the title is decided do not count.

   Per-class settings (Class → Ranking → settings): wins needed (2), laps to finish
   (0 = take "number of laps to win" from the race format) and the Ironman pilot
   (callsign; empty = clause off). RotorHazard cannot see disqualifications: per the
   rule book a DQ is last place in that heat, so mark it in Marshal (delete the laps).

2) "Chase the Ace (Points + Wins + Last Race)" — a non-MultiGP variant: total points of
   all races (use a points method such as 4,3,2,1), then race wins, then position in the
   last race.

Pilots with 0 laps are ordered by holeshot time (first gate crossing); pilots with no
crossing at all go last. Everyone else keeps RotorHazard's order (laps, then time).
'''

import json
import logging

from eventmanager import Evt
from Results import RaceClassRankMethod
from RHUI import UIField, UIFieldType

logger = logging.getLogger(__name__)

MGP_LABEL = "MultiGP Chase the Ace (2026 rules)"
MGP_NAME = 'multigp_chase_the_ace'
DEFAULT_WINS = 2
RULE_REF = "2026 MultiGP Rules & Regulations 7.9.2"

MGP_SETTINGS = [
    UIField('wins', "Aces (wins) needed to be champion", UIFieldType.BASIC_INT, value='2',
            desc="MultiGP: 2."),
    UIField('finish_laps', "Laps to complete for a valid race / Ace (0 = from race format)",
            UIFieldType.BASIC_INT, value='0',
            desc="If the race winner did not complete these laps, the race is void."),
    UIField('ironman', "Ironman pilot (callsign, empty = off)", UIFieldType.TEXT, value='',
            desc="Top qualifier who won every bracket race: wins the event by winning race 1."),
]


def order_race(lb):
    '''Finishing order of a race leaderboard. Pilots with 0 laps are ordered
    by holeshot time (first gate crossing, = total_time_raw when no laps were
    completed); pilots with no crossing at all go last. Everyone else keeps
    RotorHazard's order.'''
    lb = list(lb)
    zero = [i for i, l in enumerate(lb) if (l.get('laps') or 0) == 0]

    def key(l):
        t = l.get('total_time_raw') or 0
        return (0, t) if t > 0 else (1, 0)

    for i, l in zip(zero, sorted((lb[i] for i in zero), key=key)):
        lb[i] = l
    return lb


def _int(value, default=0):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Points + Wins + Last Race (custom variant)
# ---------------------------------------------------------------------------
def build_leaderboard(races):
    '''races: list (chronological) of leaderboards; each leaderboard is a list
    of dicts with pilot_id, callsign, team_name, position, points.'''
    pilots = {}
    for lb in races:
        for idx, line in enumerate(order_race(lb), start=1):
            pid = line['pilot_id']
            p = pilots.setdefault(pid, {
                'pilot_id': pid, 'callsign': line['callsign'],
                'team_name': line.get('team_name'),
                'points': 0, 'wins': 0, 'races': 0, 'last_position': None})
            p['points'] += line.get('points') or 0
            p['races'] += 1
            if idx == 1:
                p['wins'] += 1
            p['last_position'] = idx

    board = sorted(pilots.values(), key=lambda x: (
        -x['points'], -x['wins'],
        x['last_position'] if x['last_position'] else 999))

    last_key = None
    last_rank = 0
    for i, row in enumerate(board, start=1):
        key = (row['points'], row['wins'],
               row['last_position'] if row['last_position'] else 999)
        row['position'] = last_rank if key == last_key else i
        last_key, last_rank = key, row['position']
    return board


def rank_chase_the_ace(rhapi, race_class, _args):
    races = class_races(rhapi, race_class.id)
    if races is None:
        logger.warning("Chase the Ace ranking: race result not available")
        return False, {}
    board = build_leaderboard([r['lb'] for r in races])
    meta = {'rank_fields': [
        {'name': 'points', 'label': "Points"},
        {'name': 'wins', 'label': "Wins"},
        {'name': 'last_position', 'label': "Last race"},
    ]}
    return board, meta


# ---------------------------------------------------------------------------
# MultiGP Chase the Ace (2026 rules)
# ---------------------------------------------------------------------------
def build_multigp(races, wins=DEFAULT_WINS, finish_laps=0, ironman=None):
    '''races: chronological list of {'lb': leaderboard, 'laps_needed': int}.
    finish_laps > 0 overrides each race's laps_needed. ironman: callsign or None.

    Returns (board, info). board rows: pilot_id, callsign, team_name, position, wins
    (Aces), races (valid races flown), position_sum, last_position, results (finishing
    position in every race of the final, 0 = void race, None = did not fly), status.'''
    wins = max(1, _int(wins, DEFAULT_WINS))
    finish_laps = max(0, _int(finish_laps, 0))
    iron = (ironman or '').strip().lower() or None
    iron_state = 'active' if iron else None

    pilots = {}
    champion = None
    clinched = None
    void = []
    counted = 0  # races used for scoring (up to the one that decides the title)

    def row(line):
        pid = line['pilot_id']
        return pilots.setdefault(pid, {
            'pilot_id': pid, 'callsign': line['callsign'], 'team_name': line.get('team_name'),
            'wins': 0, 'races': 0, 'position_sum': 0, 'last_position': None,
            'results': [None] * len(races)})

    for n, race in enumerate(races):
        ordered = order_race(race['lb'])
        if not ordered:
            continue
        counted = n + 1
        required = finish_laps or max(0, _int(race.get('laps_needed'), 0))
        leader = ordered[0]
        valid = required <= 0 or (leader.get('laps') or 0) >= required
        if not valid:
            # nadie completó las vueltas: carrera nula (sin Ace ni posiciones), Ironman fuera
            void.append(n + 1)
            for line in ordered:
                row(line)['results'][n] = 0
            if iron_state == 'active':
                iron_state = 'disengaged'
            continue
        for idx, line in enumerate(ordered, start=1):
            p = row(line)
            p['races'] += 1
            p['position_sum'] += idx
            p['last_position'] = idx
            p['results'][n] = idx
        winner = pilots[leader['pilot_id']]
        winner['wins'] += 1
        if iron_state == 'active':
            if (leader.get('callsign') or '').strip().lower() == iron:
                iron_state = 'won'
                champion, clinched = leader['pilot_id'], n + 1
            else:
                iron_state = 'disengaged'
        if champion is None and winner['wins'] >= wins:
            champion, clinched = leader['pilot_id'], n + 1
        if champion is not None:
            break  # las carreras de más no cuentan: manda la que dio el título

    def key(x):
        return (0 if x['pilot_id'] == champion else 1,
                -x['wins'] if champion is None else 0,
                x['position_sum'] if x['races'] else 999,
                x['last_position'] if x['last_position'] else 999)

    board = sorted(pilots.values(), key=key)
    last_key = None
    last_rank = 0
    for i, r in enumerate(board, start=1):
        k = key(r)
        r['position'] = last_rank if k == last_key else i
        r['status'] = 'Champion' if r['pilot_id'] == champion else ''
        r['results'] = r['results'][:counted]
        last_key, last_rank = k, r['position']

    n_pilots = max(len(board), 1)
    info = {
        'champion': champion,
        'clinched_race': clinched,
        'wins_needed': wins,
        'races': counted,
        'void_races': void,
        # peor caso sin carreras nulas: todos ganan (wins-1) antes de que alguien llegue
        'max_races': (wins - 1) * n_pilots + 1 + len(void),
        'ironman': iron_state,
        'rule': RULE_REF,
    }
    return board, info


def class_settings(race_class):
    '''Ajustes del método de ranking guardados en la clase (rank_settings, JSON).'''
    out = {f.name: f.value for f in MGP_SETTINGS}
    raw = getattr(race_class, 'rank_settings', None)
    try:
        data = json.loads(raw) if isinstance(raw, str) and raw else (raw or {})
        if isinstance(data, dict):
            out.update({k: v for k, v in data.items() if v not in (None, '')})
    except Exception:
        logger.warning("Chase the Ace: cannot read rank_settings of class %s", getattr(race_class, 'id', '?'))
    return out


def class_races(rhapi, class_id):
    '''Carreras guardadas de la clase, en orden, con las vueltas que pide su formato.'''
    races = []
    for heat in rhapi.db.heats_by_class(class_id):
        for race in rhapi.db.races_by_heat(heat.id):
            result = rhapi.db.race_results(race)
            if not result:
                return None
            fmt = rhapi.db.raceformat_by_id(race.format_id) if race.format_id else None
            races.append((race.id, {
                'lb': result[result['meta']['primary_leaderboard']],
                'laps_needed': getattr(fmt, 'number_laps_win', 0) or 0,
            }))
    races.sort(key=lambda r: r[0])
    return [r for _, r in races]


def rank_multigp(rhapi, race_class, args):
    races = class_races(rhapi, race_class.id)
    if races is None:
        logger.warning("MultiGP Chase the Ace ranking: race result not available")
        return False, {}
    settings = dict(class_settings(race_class))
    settings.update({k: v for k, v in (args or {}).items() if v not in (None, '')})
    board, info = build_multigp(races, settings.get('wins'), settings.get('finish_laps'),
                                settings.get('ironman'))
    meta = {'rank_fields': [
        {'name': 'wins', 'label': "Aces"},
        {'name': 'position_sum', 'label': "Sum of positions"},
        {'name': 'last_position', 'label': "Last race"},
        {'name': 'status', 'label': "Status"},
    ]}
    meta.update({'chase_the_ace': info})
    return board, meta


def register_handlers(args):
    args['register_fn'](RaceClassRankMethod(
        "Chase the Ace (Points + Wins + Last Race)",
        rank_chase_the_ace, None, None))
    args['register_fn'](RaceClassRankMethod(
        MGP_LABEL, rank_multigp, {f.name: f.value for f in MGP_SETTINGS}, MGP_SETTINGS, name=MGP_NAME))


def on_laps_save(rhapi, args):
    '''Aviso en la UI tras cada carrera de una final MultiGP Chase the Ace.'''
    race = rhapi.db.race_by_id(args.get('race_id'))
    if not race:
        return
    race_class = rhapi.db.raceclass_by_id(race.class_id) if race.class_id else None
    if not race_class or race_class.win_condition != MGP_NAME:
        return
    races = class_races(rhapi, race_class.id)
    if not races:
        return
    s = class_settings(race_class)
    board, info = build_multigp(races, s.get('wins'), s.get('finish_laps'), s.get('ironman'))
    n = len(races)
    if info['void_races'] and info['void_races'][-1] == n:
        rhapi.ui.message_alert('{}: race {} is VOID (nobody completed the laps): no Ace and no positions. '
                               'Run it again.'.format(race_class.name, n))
    champ_id = info['champion']
    if champ_id:
        champ = next(r for r in board if r['pilot_id'] == champ_id)
        how = 'Ironman clause' if info['ironman'] == 'won' else '{} Aces'.format(info['wins_needed'])
        order = ', '.join('{}. {} ({})'.format(r['position'], r['callsign'], r['position_sum']) for r in board)
        extra = ' Races after race {} do not count.'.format(info['clinched_race']) if n > info['clinched_race'] else ''
        rhapi.ui.message_alert('{}: {} wins the Chase the Ace ({}, race {}). No more races needed.{} '
                               'Standings (sum of positions): {}'.format(
                                   race_class.name, champ['callsign'], how, info['clinched_race'], extra, order))
    else:
        wins_txt = ', '.join('{} {}'.format(r['callsign'], r['wins']) for r in board if r['wins'])
        iron = ' Ironman disengaged.' if info['ironman'] == 'disengaged' and n == 1 else ''
        rhapi.ui.message_notify('{}: race {} of at most {}. Aces: {}.{} The final goes on.'.format(
            race_class.name, n, info['max_races'], wins_txt or 'none', iron))


def initialize(rhapi):
    rhapi.events.on(Evt.CLASS_RANK_INITIALIZE, register_handlers)
    rhapi.events.on(Evt.LAPS_SAVE, lambda args: on_laps_save(rhapi, args),
                    name='chase_the_ace_rank_save', priority=200)
