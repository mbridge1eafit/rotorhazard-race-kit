'''Fix for RotorHazard 4.5.1: RHData.get_optionNumeric() always returns the default.

get_optionNumeric() only returns the cached value when it is already a number
(isinstance(val, numbers.Real)), but the options cache stores every value as a
string ('10'). So templates that use it always render 0:
  - marshal.html: min_lap_ms / min_first_crossing_ms = 0 -> the Marshal page
    recalculation never deletes laps under the minimum lap time.
  - run.html / format.html: the "Minimum Lap" and "Minimum First Crossing"
    inputs show 0 instead of the real value.

This plugin adds an OPTION_GET_NUMERIC filter that parses the stored string.
Timing itself is not affected (it uses get_optionInt).
'''

import logging
from filtermanager import Flt

logger = logging.getLogger(__name__)

# Options read through get_optionNumeric in RH 4.5.1 templates that are still
# stored in the database (start_thresh_lower_* were migrated to config.json).
NUMERIC_OPTIONS = ('MinLapSec', 'MinFirstCrossingSec')


def _to_number(raw):
    if raw is None or raw is False:
        return None
    try:
        f = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


def initialize(rhapi):
    def fix_numeric(data, context):
        name = (context or {}).get('option')
        if name not in NUMERIC_OPTIONS:
            return data
        val = _to_number(rhapi.db.option(name, None))
        return data if val is None else val

    rhapi.filters.add(Flt.OPTION_GET_NUMERIC, 'option_numeric_fix', fix_numeric, priority=50, with_context=True)
    logger.info('option_numeric_fix: get_optionNumeric filter registered for %s', ', '.join(NUMERIC_OPTIONS))
