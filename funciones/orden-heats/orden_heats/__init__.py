'''Orden de heats entre clases: corre los heats en una secuencia fija aunque sean de
clases distintas (p. ej. uno de Sport y uno de Pro, intercalados).

RotorHazard solo sabe avanzar al siguiente heat de la MISMA clase. Este plugin, al
guardar las vueltas de un heat que está en la secuencia, pone como heat actual el que
le sigue en la secuencia. Al descartar no hace nada (el heat se vuelve a correr).

Para que RotorHazard no mueva el heat por su cuenta, las clases de la secuencia deben
tener "Avance de heat" = Ninguno.

La secuencia es una lista de ids de heat separados por comas y se guarda en la base de
datos del evento (opción oh_sequence), porque los ids cambian de un evento a otro.
Se puede escribir a mano o generar con el botón "Generar secuencia intercalada": toma las
clases de oh_classes (p. ej. "3,2") y alterna sus heats: 1.º de la clase 3, 1.º de la 2,
2.º de la 3... Si una clase tiene más heats, los que sobran van al final.
'''

import logging

import gevent
from eventmanager import Evt
from RHUI import UIField, UIFieldType

logger = logging.getLogger(__name__)

PANEL = 'orden_heats'
OPT_ENABLED = 'oh_enabled'
OPT_SEQUENCE = 'oh_sequence'
OPT_CLASSES = 'oh_classes'
READY = 0  # RHRace.RaceStatus.READY
DELAY_S = 1.0  # deja terminar el guardado de RotorHazard antes de cambiar el heat


def parse_sequence(text):
    out = []
    for part in str(text or '').replace(';', ',').replace(' ', ',').split(','):
        part = part.strip()
        if part.isdigit() and int(part) > 0:
            out.append(int(part))
    return out


def next_in_sequence(seq, heat_id):
    '''Heat que sigue a heat_id en la secuencia; None si no está o es el último.'''
    if heat_id not in seq:
        return None
    idx = seq.index(heat_id)
    return seq[idx + 1] if idx + 1 < len(seq) else None


def interleave(groups):
    '''[[a1, a2, a3], [b1, b2]] -> [a1, b1, a2, b2, a3]'''
    out = []
    for i in range(max((len(g) for g in groups), default=0)):
        for g in groups:
            if i < len(g):
                out.append(g[i])
    return out


class OrdenHeats():
    def __init__(self, rhapi):
        self.rhapi = rhapi

    def enabled(self):
        return str(self.rhapi.db.option(OPT_ENABLED, '0')).strip().lower() in ('1', 'true', 'on', 'yes')

    def sequence(self):
        return parse_sequence(self.rhapi.db.option(OPT_SEQUENCE, ''))

    def heat_name(self, heat_id):
        heat = self.rhapi.db.heat_by_id(heat_id)
        return heat.name if heat else 'heat {}'.format(heat_id)

    def set_heat(self, heat_id, reason):
        if self.rhapi.race.status != READY:
            logger.warning('orden_heats: carrera no está lista; no se cambia a %s', heat_id)
            return False
        if not self.rhapi.db.heat_by_id(heat_id):
            logger.warning('orden_heats: el heat %s no existe', heat_id)
            return False
        self.rhapi.race.heat = heat_id
        name = self.heat_name(heat_id)
        logger.info('orden_heats: siguiente heat %s (%s) [%s]', heat_id, name, reason)
        self.rhapi.ui.message_notify('Siguiente heat: {}'.format(name))
        return True

    # ---------------- eventos ----------------
    def on_laps_save(self, args):
        if not self.enabled():
            return
        race = self.rhapi.db.race_by_id(args.get('race_id'))
        if not race:
            return
        nxt = next_in_sequence(self.sequence(), race.heat_id)
        if nxt is None:
            if race.heat_id in self.sequence():
                self.rhapi.ui.message_notify('Orden de heats: era el último de la secuencia.')
            return
        gevent.sleep(DELAY_S)
        self.set_heat(nxt, 'guardado heat {}'.format(race.heat_id))

    # ---------------- botones ----------------
    def btn_first_pending(self, _args=None):
        '''Pone el primer heat de la secuencia que todavía no tiene carreras guardadas.'''
        for heat_id in self.sequence():
            if not self.rhapi.db.races_by_heat(heat_id):
                self.set_heat(heat_id, 'botón primer pendiente')
                return
        self.rhapi.ui.message_notify('Orden de heats: todos los heats de la secuencia ya se corrieron.')

    def btn_generate(self, _args=None):
        '''Arma la secuencia alternando los heats de las clases de oh_classes.'''
        class_ids = parse_sequence(self.rhapi.db.option(OPT_CLASSES, ''))
        if not class_ids:
            self.rhapi.ui.message_alert('Orden de heats: escribe las clases a intercalar (ids separados por comas).')
            return
        groups = []
        for cid in class_ids:
            rc = self.rhapi.db.raceclass_by_id(cid)
            if not rc:
                self.rhapi.ui.message_alert('Orden de heats: la clase {} no existe.'.format(cid))
                return
            heats = sorted(self.rhapi.db.heats_by_class(cid), key=lambda h: h.id)
            groups.append([h.id for h in heats])
        seq = interleave(groups)
        self.rhapi.db.option_set(OPT_SEQUENCE, ','.join(str(x) for x in seq))
        logger.info('orden_heats: secuencia generada desde clases %s: %s', class_ids, seq)
        self.rhapi.ui.message_notify('Orden de heats: secuencia de {} heats generada. Recarga la página para '
                                     'verla en el campo; recuerda poner "Avance de heat" = Ninguno en esas clases.'
                                     .format(len(seq)))

    def btn_show(self, _args=None):
        seq = self.sequence()
        if not seq:
            self.rhapi.ui.message_notify('Orden de heats: la secuencia está vacía.')
            return
        current = self.rhapi.race.heat
        parts = []
        for i, heat_id in enumerate(seq, start=1):
            mark = ' ◀' if heat_id == current else ''
            done = ' ✓' if self.rhapi.db.races_by_heat(heat_id) else ''
            parts.append('{}. {}{}{}'.format(i, self.heat_name(heat_id), done, mark))
        self.rhapi.ui.message_notify(' · '.join(parts))


def initialize(rhapi):
    plugin = OrdenHeats(rhapi)

    rhapi.ui.register_panel(PANEL, 'Orden de heats entre clases', 'settings')
    rhapi.fields.register_option(
        UIField(OPT_ENABLED, 'Activar orden de heats', UIFieldType.CHECKBOX, value='0',
                desc='Al guardar las vueltas pasa al siguiente heat de la secuencia. '
                     'Las clases de la secuencia deben tener "Avance de heat" = Ninguno.'),
        PANEL)
    rhapi.fields.register_option(
        UIField(OPT_SEQUENCE, 'Secuencia (ids de heat separados por comas)', UIFieldType.TEXT,
                value='', placeholder='48,32,49,33,...'),
        PANEL)
    rhapi.fields.register_option(
        UIField(OPT_CLASSES, 'Clases a intercalar (para generar la secuencia)', UIFieldType.TEXT,
                value='', placeholder='3,2',
                desc='Ids de clase en el orden en que se alternan. Luego usa "Generar secuencia intercalada".'),
        PANEL)
    rhapi.ui.register_quickbutton(PANEL, 'oh_generate', 'Generar secuencia intercalada',
                                  plugin.btn_generate)
    rhapi.ui.register_quickbutton(PANEL, 'oh_first_pending', 'Ir al primer heat pendiente',
                                  plugin.btn_first_pending)
    rhapi.ui.register_quickbutton(PANEL, 'oh_show', 'Mostrar secuencia', plugin.btn_show)

    rhapi.events.on(Evt.LAPS_SAVE, plugin.on_laps_save, name='orden_heats_save')
    logger.info('orden_heats: listo')
