// SKR Overlays: utilidades comunes de las páginas (idioma, parámetros de la URL, colores, sondeo).
// Parámetros que sirven en todas las páginas:
//   lang=es|en         idioma (por defecto, el de la interfaz de RotorHazard)
//   intervalo=3000     cada cuántos ms se consulta el timer
//   colores=0022ff,... colores por puesto/nodo (por defecto, los de Ajustes → LED de RotorHazard)
window.RO = (() => {
  const qs = new URLSearchParams(location.search);
  const I18N = {
    es: {
      result: 'Resultado', round: 'Ronda', channel: 'Canal', laps: 'Vueltas', no_laps: 'Sin vueltas',
      best_consec: 'Mejor {0} consec.', best_lap: 'Mejor vuelta', total_time: 'Tiempo total', lap: 'V',
      pos: 'Pos', pilot: 'Piloto', points: 'Puntos', pts: 'PTS', heats: 'Heats',
      flights: 'baterías', win: 'victoria', wins: 'victorias', no_wins: 'sin victorias', aces: 'Aces',
      final_zone: '▲ Zona de final ▲', race: 'Carrera', races_n: 'Carreras 1 a {0}', sum: 'Suma',
      chase_title: 'Final Chase the Ace', champion: '★ Campeón', one_more: 'Con una victoria más gana',
      champion_banner: '★ {0} gana el Chase the Ace ★',
      chase_rule: 'Gana el primero en sumar {0} victorias · el resto por menor suma de puestos',
      void: 'carrera nula', podium: 'Podio', still_running: 'La final sigue en juego', sum_short: 'suma', no_data: 'Sin datos',
    },
    en: {
      result: 'Result', round: 'Round', channel: 'Channel', laps: 'Laps', no_laps: 'No laps',
      best_consec: 'Best {0} consec.', best_lap: 'Fastest lap', total_time: 'Total time', lap: 'L',
      pos: 'Pos', pilot: 'Pilot', points: 'Points', pts: 'PTS', heats: 'Heats',
      flights: 'flights', win: 'win', wins: 'wins', no_wins: 'no wins',
      final_zone: '▲ Finals zone ▲', race: 'Race', races_n: 'Races 1 to {0}', sum: 'Sum',
      chase_title: 'Chase the Ace Final', champion: '★ Champion', one_more: 'One more win takes it',
      champion_banner: '★ {0} wins the Chase the Ace ★',
      chase_rule: 'First to {0} wins takes it · the rest by lowest sum of positions',
      void: 'void race', podium: 'Podium', still_running: 'The final is still on', sum_short: 'sum', no_data: 'No data',
    },
  };
  let lang = (qs.get('lang') || '').toLowerCase();

  const setLang = (fromServer) => {
    if (!I18N[lang]) lang = I18N[fromServer] ? fromServer : 'es';
    document.documentElement.lang = lang;
  };
  const t = (key, ...args) => {
    let s = (I18N[lang] || I18N.es)[key] ?? I18N.es[key] ?? key;
    args.forEach((v, i) => { s = s.replace('{' + i + '}', v); });
    return s;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const list = (name) => {
    const v = qs.get(name);
    return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null;
  };
  const color = (c) => (/^[0-9a-f]{3,8}$/i.test(c) ? '#' + c : c);
  const num = (name, def) => {
    const v = Number(qs.get(name));
    return qs.has(name) && qs.get(name) !== '' && !Number.isNaN(v) ? v : def;
  };
  // "ffb321-ff6a3d,2bb5f5-6a5cff" → [['#ffb321','#ff6a3d'], ['#2bb5f5','#6a5cff']]
  const palette = (name, def) => (list(name) || def).map((p) => p.split('-').map(color));
  const seatColors = (data) => {
    const custom = list('colores');
    if (custom) return custom.map(color);
    return (data && data.seat_colors) || ['#0022ff', '#ff5500', '#00ff22', '#ff0055', '#ddff00', '#9900ff', '#00ffff', '#ffffff'];
  };

  // Consulta el JSON cada "intervalo" ms y llama render(data) solo si cambió.
  const poll = (url, render) => {
    const every = num('intervalo', 3000);
    let last = null;
    const tick = async () => {
      try {
        const data = await (await fetch(url, { cache: 'no-store' })).json();
        setLang(data.lang);
        const key = JSON.stringify(data);
        if (key !== last) { last = key; render(data); }
      } catch (e) { /* timer reiniciando o sin red: se reintenta */ }
      setTimeout(tick, every);
    };
    tick();
  };

  return { qs, t, esc, list, color, num, palette, seatColors, poll, setLang };
})();
