'''Race points method: points table chosen by number of pilots in the heat.

The tables are edited in Settings -> "Points by Heat Size" (CSV, by finishing
position) and apply to every format that uses this points method:
  pbhs_points_4: heats with 4 or more pilots (default 10,9,8,5)
  pbhs_points_3: heats with 3 or fewer pilots (default 10,8,5)
Positions beyond the list get 0 points.
Pilots with 0 laps are separated by holeshot time (see order_race).
pbhs_finish_laps: laps needed to finish the race (e.g. 3 in a "first to 3
laps" race). Pilots below it are DNF and get 0 points. 0 = rule off.
'''

import logging
from eventmanager import Evt
from Results import RacePointsMethod
from RHUI import UIField, UIFieldType

logger = logging.getLogger(__name__)

OPT_4 = 'pbhs_points_4'
OPT_3 = 'pbhs_points_3'
OPT_FIN = 'pbhs_finish_laps'
DEFAULT_4 = "10,9,8,5"
DEFAULT_3 = "10,8,5"


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


def _parse(text, default):
    try:
        values = [int(x.strip()) for x in str(text).split(',') if x.strip() != '']
        if values:
            return values
    except Exception:
        pass
    logger.warning("Points by Heat Size: cannot parse %r, using %s", text, default)
    return [int(x) for x in default.split(',')]


def _int(value):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return 0


def assign_points(lb, text_4, text_3, finish_laps=0):
    t4 = _parse(text_4 or DEFAULT_4, DEFAULT_4)
    t3 = _parse(text_3 or DEFAULT_3, DEFAULT_3)
    table = t4 if len(lb) >= 4 else t3
    finish_laps = _int(finish_laps)
    for idx, line in enumerate(order_race(lb)):
        if finish_laps > 0 and (line.get('laps') or 0) < finish_laps:
            line['points'] = 0  # DNF
        else:
            line['points'] = table[idx] if idx < len(table) else 0


def points_by_heat_size(rhapi, leaderboard, _args):
    lb = leaderboard[leaderboard['meta']['primary_leaderboard']]
    assign_points(lb, rhapi.db.option(OPT_4, DEFAULT_4),
                  rhapi.db.option(OPT_3, DEFAULT_3),
                  rhapi.db.option(OPT_FIN, "0"))
    return leaderboard


def register_handlers(args):
    args['register_fn'](RacePointsMethod(
        "Points by Heat Size", points_by_heat_size, None, None,
        name="points_by_heat_size"))


def initialize(rhapi):
    rhapi.events.on(Evt.POINTS_INITIALIZE, register_handlers)

    rhapi.ui.register_panel("pbhs_settings", "Points by Heat Size", "settings")
    rhapi.fields.register_option(
        UIField(OPT_4, "Points, heat of 4+ pilots (CSV by position)",
                UIFieldType.TEXT, value=DEFAULT_4, placeholder=DEFAULT_4),
        "pbhs_settings")
    rhapi.fields.register_option(
        UIField(OPT_3, "Points, heat of 3 or fewer pilots (CSV by position)",
                UIFieldType.TEXT, value=DEFAULT_3, placeholder=DEFAULT_3),
        "pbhs_settings")
    rhapi.fields.register_option(
        UIField(OPT_FIN, "Laps to finish (fewer = DNF, 0 points; 0 = off)",
                UIFieldType.TEXT, value="0", placeholder="0"),
        "pbhs_settings")
