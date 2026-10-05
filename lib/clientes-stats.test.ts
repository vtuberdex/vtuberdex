import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reiniciarHistorial, historial } from './clientes-historial.mjs';
import { MAX_NUEVAS_POR_MINUTO, MAX_SESIONES, MIN_ENTRE_LATIDOS_MS, MIN_ENTRE_NAVEGACIONES_MS, TTL_MS, __reiniciar, __sesionesGuardadas, limpiarLatido, registrar, resumen } from './clientes-stats.mjs';

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const sid = (n: number) => `sesion-${String(n).padStart(6, '0')}`;
const latido = (n: number, extra: Record<string, unknown> = {}) => ({ sid: sid(n), ruta: 'catalogo', disp: 'escritorio', ...extra });

beforeEach(() => {
  __reiniciar();
  __reiniciarHistorial();
});
afterEach(() => {
  __reiniciar();
  __reiniciarHistorial();
});

describe('limpiarLatido: valida y acota todo lo que llega del cliente', () => {
  it('rechaza lo que no es un latido', () => {
    for (const malo of [null, undefined, 'hola', 42, [], {}, { sid: 'corto' }, { sid: 'con espacios y caracteres <script>' }, { sid: 'x'.repeat(41) }]) {
      expect(limpiarLatido(malo), JSON.stringify(malo)).toBeNull();
    }
  });

  it('descarta valores fuera de la lista y acota los números', () => {
    const l = limpiarLatido({ ...latido(1), ruta: '/v/secreto-slug', disp: '<img>', gpu: 'nvidia rtx 4090', red: '5g', lcp: 9e12, fps: -5, nuc: 'mucho', lt: { n: 1e9, ms: -4 } })!;
    expect(l.ruta).toBe('otra'); // jamás se guarda una ruta libre (podría llevar un slug)
    expect(l.disp).toBe('escritorio');
    expect(l.gpu).toBe('desconocida'); // informado pero inválido
    expect(l.red).toBe('desconocida');
    expect(limpiarLatido(latido(1))!.gpu).toBeNull(); // no informado: no es lo mismo
    expect(l.lcp).toBe(300_000);
    expect(l.fps).toBe(0);
    expect(l.nuc).toBeNull();
    expect(l.ltN).toBe(100_000);
    expect(l.ltMs).toBe(0);
  });

  it('no deja pasar campos desconocidos (ni la IP ni el user-agent)', () => {
    const l = limpiarLatido({ ...latido(1), ip: '1.2.3.4', ua: 'Mozilla', texto: 'hola' })!;
    expect(Object.keys(l)).not.toEqual(expect.arrayContaining(['ip']));
    expect(Object.keys(l)).not.toEqual(expect.arrayContaining(['ua']));
    expect(Object.keys(l)).not.toEqual(expect.arrayContaining(['texto']));
  });
});

describe('registrar / resumen', () => {
  it('cuenta las sesiones conectadas y deja de contar las que dejaron de latir', () => {
    registrar(latido(1), T0);
    registrar(latido(2), T0);
    expect(resumen(T0 + 1000).conectados).toBe(2);
    expect(resumen(T0 + TTL_MS - 1).conectados).toBe(2);
    expect(resumen(T0 + TTL_MS + 1).conectados).toBe(0);
  });

  it('un latido de la misma sesión no la cuenta dos veces', () => {
    registrar(latido(1), T0);
    registrar(latido(1), T0 + 20_000);
    const r = resumen(T0 + 21_000);
    expect(r.conectados).toBe(1);
    expect(r.visitas_hoy).toBe(1);
  });

  it('«bye» la retira al instante', () => {
    registrar(latido(1), T0);
    registrar({ ...latido(1), bye: true }, T0 + 6000);
    expect(resumen(T0 + 7000).conectados).toBe(0);
  });

  it('limita la cadencia de una misma sesión', () => {
    expect(registrar(latido(1), T0)).toBe('ok');
    expect(registrar(latido(1), T0 + MIN_ENTRE_LATIDOS_MS - 1)).toBe('demasiado_rapido');
    expect(registrar(latido(1), T0 + MIN_ENTRE_LATIDOS_MS)).toBe('ok');
  });

  it('con sesiones de más desaloja las más viejas y la memoria no crece sin tope', () => {
    // 100 ms entre sesiones = 600 por minuto: lo máximo que admite el guardia de sesiones nuevas.
    for (let i = 0; i < MAX_SESIONES + 50; i += 1) expect(registrar(latido(i), T0 + i * 100)).toBe('ok');
    expect(__sesionesGuardadas()).toBe(MAX_SESIONES);
  });

  it('no admite más de MAX_NUEVAS_POR_MINUTO sesiones nuevas por minuto (sin IP, es el freno contra un script)', () => {
    for (let i = 0; i < MAX_NUEVAS_POR_MINUTO; i += 1) expect(registrar(latido(i), T0 + i)).toBe('ok');
    expect(registrar(latido(MAX_NUEVAS_POR_MINUTO), T0 + 5000)).toBe('demasiado_rapido');
    // Las sesiones que ya existen siguen latiendo normal, y al minuto siguiente se admiten nuevas otra vez.
    expect(registrar(latido(0), T0 + MIN_ENTRE_LATIDOS_MS + 10)).toBe('ok');
    expect(registrar(latido(MAX_NUEVAS_POR_MINUTO), T0 + 61_000)).toBe('ok');
  });

  it('las medianas ignoran a quien no midió ese dato y conservan el último valor conocido', () => {
    registrar(latido(1, { lcp: 1000, fps: 60, gpu: 'hardware' }), T0);
    registrar(latido(2, { lcp: 3000, fps: 30, gpu: 'software' }), T0);
    registrar(latido(3), T0); // sin métricas
    registrar(latido(1), T0 + 20_000); // el latido siguiente no repite el LCP: no debe perderlo
    const r = resumen(T0 + 21_000);
    expect(r.rendimiento.lcp_ms).toBe(2000);
    expect(r.rendimiento.fps).toBe(45);
    expect(r.gpu_software_pct).toBe(50);
  });

  it('las pestañas ocultas cuentan como conectadas pero no entran en el fps', () => {
    registrar(latido(1, { fps: 60 }), T0);
    registrar(latido(2, { fps: 5, vis: false }), T0);
    const r = resumen(T0 + 1000);
    expect(r.conectados).toBe(2);
    expect(r.visibles).toBe(1);
    expect(r.rendimiento.fps).toBe(60);
  });

  it('reparte por dispositivo, ruta y red, y nunca expone una sesión individual', () => {
    registrar(latido(1, { disp: 'movil', ruta: 'ficha', red: '4g' }), T0);
    registrar(latido(2), T0);
    const r = resumen(T0 + 1000);
    expect(r.por_dispositivo).toEqual({ movil: 1, escritorio: 1 });
    expect(r.por_ruta).toEqual({ ficha: 1, catalogo: 1 });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('sesion-');
    expect(texto).not.toContain('sid');
  });

  it('el historial guarda el pico por minuto y rellena con ceros', () => {
    registrar(latido(1), T0);
    registrar(latido(2), T0 + 10_000);
    registrar(latido(3), T0 + 5 * 60_000);
    const r = resumen(T0 + 5 * 60_000 + 1000);
    expect(r.historial).toHaveLength(60);
    expect(r.historial.at(-1)).toBe(1); // minuto actual: solo la 3 sigue viva… (las otras caducaron)
    expect(r.historial.at(-6)).toBe(2); // hace 5 min: el pico fue 2
    expect(r.pico_hora).toBe(2);
  });

  it('visitas de hoy se reinician al cambiar de día', () => {
    registrar(latido(1), T0);
    expect(resumen(T0).visitas_hoy).toBe(1);
    expect(resumen(T0 + 24 * 3600_000).visitas_hoy).toBe(0);
  });

  it('sin datos devuelve ceros y nulos, no NaN', () => {
    const r = resumen(T0);
    expect(r.conectados).toBe(0);
    expect(r.rendimiento.lcp_ms).toBeNull();
    expect(r.gpu_software_pct).toBeNull();
    expect(JSON.stringify(r)).not.toContain('NaN');
  });
});

describe('navegación y histórico mensual', () => {
  const mesActual = async (ahora: number) => (await historial({ ahora, meses: 1, almacen: null }))[0];

  it('un aviso de navegación crea la sesión y cuenta UNA visita y su primera página, con dispositivo y conexión', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', disp: 'movil', red: '4g' }, T0);
    const m = await mesActual(T0);
    expect(m.visitas).toBe(1);
    expect(m.dispositivo).toEqual({ movil: 1, escritorio: 0 });
    expect(m.conexion['4g']).toBe(1);
    expect(m.pagina.catalogo).toBe(1);
    expect(m.cruce.movil.catalogo).toBe(1);
    expect(resumen(T0 + 1000).conectados).toBe(1);
  });

  it('el primer latido completo (3 s después) NO se descarta ni cuenta otra visita', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', disp: 'escritorio' }, T0);
    expect(registrar({ ...latido(1), lcp: 1200, fps: 60 }, T0 + 3000)).toBe('ok'); // la cadencia normal es de 5 s, pero el aviso no la gasta
    const m = await mesActual(T0 + 3000);
    expect(m.visitas).toBe(1);
    expect(resumen(T0 + 4000).rendimiento.lcp_ms).toBe(1200);
  });

  it('cada cambio de página cuenta una vista; repetir la misma categoría no', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', disp: 'escritorio' }, T0);
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', disp: 'escritorio' }, T0 + MIN_ENTRE_NAVEGACIONES_MS);
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', disp: 'escritorio' }, T0 + 2 * MIN_ENTRE_NAVEGACIONES_MS); // otra ficha, misma categoría
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', disp: 'escritorio' }, T0 + 3 * MIN_ENTRE_NAVEGACIONES_MS); // vuelve al catálogo
    const m = await mesActual(T0 + 10_000);
    expect(m.visitas).toBe(1);
    expect(m.pagina).toEqual({ catalogo: 2, ficha: 1, otra: 0 });
  });

  it('los avisos de navegación no pueden llegar a ráfagas (no inflan las vistas)', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo' }, T0);
    expect(registrar({ sid: sid(1), nav: true, ruta: 'ficha' }, T0 + MIN_ENTRE_NAVEGACIONES_MS - 1)).toBe('demasiado_rapido');
    expect((await mesActual(T0 + 5000)).pagina.ficha).toBe(0);
  });

  it('un latido normal que trae otra ruta (navegación no avisada) también la cuenta', async () => {
    registrar(latido(1, { ruta: 'catalogo' }), T0);
    registrar(latido(1, { ruta: 'ficha' }), T0 + MIN_ENTRE_LATIDOS_MS);
    expect((await mesActual(T0 + 10_000)).pagina).toMatchObject({ catalogo: 1, ficha: 1 });
  });

  it('el pico de conectados del mes se guarda', async () => {
    for (let i = 1; i <= 4; i += 1) registrar({ sid: sid(i), nav: true, ruta: 'catalogo' }, T0 + i);
    expect((await mesActual(T0 + 100)).pico).toBe(4);
  });

  it('un aviso de «bye» no cuenta nada', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo' }, T0);
    registrar({ sid: sid(1), bye: true }, T0 + 10_000);
    expect((await mesActual(T0 + 10_000)).visitas).toBe(1);
  });
});

describe('navegador, sistema operativo y ficha', () => {
  it('limpiarLatido solo admite familias de las listas; lo demás cae en «otros» y lo ausente queda sin informar', () => {
    const l = limpiarLatido({ ...latido(1), navegador: 'chrome', so: 'windows' })!;
    expect([l.navegador, l.so]).toEqual(['chrome', 'windows']);
    const raro = limpiarLatido({ ...latido(1), navegador: 'Mozilla/5.0 (X11)', so: '<img src=x>' })!;
    expect([raro.navegador, raro.so]).toEqual(['otros', 'otros']);
    expect([limpiarLatido(latido(1))!.navegador, limpiarLatido(latido(1))!.so]).toEqual([null, null]);
  });

  it('fichaId solo acepta un entero positivo razonable; un slug o un texto no pasan', () => {
    for (const malo of ['madkoding', '12', 1.5, -3, 0, 1e12, null, undefined, {}]) expect(limpiarLatido({ ...latido(1), fichaId: malo })!.fichaId, String(malo)).toBeNull();
    expect(limpiarLatido({ ...latido(1), fichaId: 42 })!.fichaId).toBe(42);
    expect(limpiarLatido({ ...latido(1), ficha: 'madkoding' })).not.toHaveProperty('ficha'); // el slug ni se conserva
  });

  it('una visita cuenta su navegador y su sistema, y el día del mes', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', disp: 'movil', red: '4g', navegador: 'safari', so: 'ios' }, T0);
    const m = (await historial({ ahora: T0, meses: 1, almacen: null }))[0];
    expect(m.navegador.safari).toBe(1);
    expect(m.so.ios).toBe(1);
    expect(m.dias['05']).toBe(1);
  });

  it('cada ficha DISTINTA que se abre cuenta una vez; mirarla (latidos) o repetirla seguida no suma', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', fichaId: 7 }, T0);
    registrar({ ...latido(1), ruta: 'ficha', fichaId: 7 }, T0 + 10_000);
    registrar({ ...latido(1), ruta: 'ficha', fichaId: 7 }, T0 + 20_000);
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo' }, T0 + 30_000);
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', fichaId: 9 }, T0 + 33_000);
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo' }, T0 + 36_000);
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', fichaId: 7 }, T0 + 39_000); // vuelve a la 7: otra vista
    const m = (await historial({ ahora: T0 + 40_000, meses: 1, almacen: null }))[0];
    expect(m.fichas).toEqual([{ id: 7, n: 2 }, { id: 9, n: 1 }]);
    expect(m.fichasDistintas).toBe(2);
  });

  it('«fichas ahora» dice qué se mira en este momento y se olvida al volver al catálogo', () => {
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', fichaId: 7 }, T0);
    registrar({ sid: sid(2), nav: true, ruta: 'ficha', fichaId: 7 }, T0);
    registrar({ sid: sid(3), nav: true, ruta: 'ficha', fichaId: 9 }, T0);
    expect(resumen(T0 + 1000).fichas_ahora).toEqual([{ id: 7, n: 2 }, { id: 9, n: 1 }]);
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo' }, T0 + 3000);
    expect(resumen(T0 + 4000).fichas_ahora).toEqual([{ id: 7, n: 1 }, { id: 9, n: 1 }]); // empate: por id
  });

  it('una ficha NO validada (fichaId nulo) no cuenta ni aparece, aunque la ruta sea «ficha»', async () => {
    registrar({ sid: sid(1), nav: true, ruta: 'ficha', fichaId: null }, T0);
    const m = (await historial({ ahora: T0, meses: 1, almacen: null }))[0];
    expect(m.pagina.ficha).toBe(1); // sigue siendo una página vista de la categoría…
    expect(m.fichas).toEqual([]); // …pero no hay ficha a la que atribuirla
    expect(resumen(T0 + 100).fichas_ahora).toEqual([]);
  });

  it('el reparto de ahora incluye navegador y sistema', () => {
    registrar({ sid: sid(1), nav: true, ruta: 'catalogo', navegador: 'firefox', so: 'linux' }, T0);
    registrar({ sid: sid(2), nav: true, ruta: 'catalogo', navegador: 'firefox', so: 'windows' }, T0);
    const r = resumen(T0 + 100);
    expect(r.por_navegador).toEqual({ firefox: 2 });
    expect(r.por_so).toEqual({ linux: 1, windows: 1 });
  });
});
