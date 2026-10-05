import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __reiniciarHistorial,
  contarPagina,
  contarPico,
  contarVisita,
  historial,
  mesDe,
  vaciar,
} from './clientes-historial.mjs';

const T = (y: number, m: number, d = 15) => Date.UTC(y, m - 1, d, 12);
const OCT = T(2026, 10);
const SEP = T(2026, 9);

/** Un «almacén» con la forma del cliente libsql, respaldado por SQLite en memoria. */
function almacenSqlite(db = new DatabaseSync(':memory:')) {
  return {
    db,
    fallos: 0,
    execute: async (arg: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof arg === 'string' ? arg : arg.sql;
      const args = (typeof arg === 'string' ? [] : (arg.args ?? [])) as never[];
      const sentencia = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return { rows: sentencia.all(...args).map((r) => ({ ...r })) };
      sentencia.run(...args);
      return { rows: [] };
    },
    batch: async function (this: { fallos: number }, sentencias: Array<{ sql: string; args: never[] }>) {
      if (this.fallos > 0) {
        this.fallos -= 1;
        throw new Error('base caída');
      }
      db.exec('BEGIN');
      try {
        for (const s of sentencias) db.prepare(s.sql).run(...s.args);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
const mes = async (m: string, opciones: Record<string, unknown> = {}) => (await historial({ ahora: OCT, ...opciones })).find((x: { mes: string }) => x.mes === m)!;

beforeEach(() => {
  __reiniciarHistorial();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  __reiniciarHistorial();
  vi.restoreAllMocks();
});

describe('histórico mensual: qué se cuenta', () => {
  it('una visita cuenta por dispositivo y por tipo de conexión; una página, por categoría y por dispositivo', async () => {
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    contarVisita({ disp: 'escritorio', red: 'desconocida' }, OCT);
    contarPagina({ disp: 'movil', ruta: 'catalogo' }, OCT);
    contarPagina({ disp: 'movil', ruta: 'ficha' }, OCT);
    contarPagina({ disp: 'escritorio', ruta: 'ficha' }, OCT);
    const o = await mes('2026-10', { almacen: null });
    expect(o.visitas).toBe(2);
    expect(o.dispositivo).toEqual({ movil: 1, escritorio: 1 });
    expect(o.conexion).toMatchObject({ '4g': 1, desconocida: 1, '3g': 0 });
    expect(o.pagina).toEqual({ catalogo: 1, ficha: 2, otra: 0 });
    expect(o.cruce.movil).toEqual({ catalogo: 1, ficha: 1, otra: 0 });
    expect(o.cruce.escritorio).toEqual({ catalogo: 0, ficha: 1, otra: 0 });
  });

  it('el pico es el máximo del mes (no se suma)', async () => {
    contarPico(3, OCT);
    contarPico(7, OCT);
    contarPico(5, OCT);
    expect((await mes('2026-10', { almacen: null })).pico).toBe(7);
  });

  it('cada mes tiene lo suyo: octubre no se mezcla con septiembre', async () => {
    contarVisita({ disp: 'movil', red: '4g' }, SEP);
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    expect((await mes('2026-09', { almacen: null })).visitas).toBe(1);
    expect((await mes('2026-10', { almacen: null })).visitas).toBe(2);
  });

  it('devuelve los últimos N meses, el más reciente primero, con ceros donde no hubo nada', async () => {
    const h = await historial({ ahora: OCT, meses: 4, almacen: null });
    expect(h.map((m: { mes: string }) => m.mes)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(h[3]).toMatchObject({ visitas: 0, pico: 0 });
    expect(h[3].dispositivo).toEqual({ movil: 0, escritorio: 0 });
  });

  it('cruza el cambio de año sin romperse', async () => {
    const h = await historial({ ahora: T(2026, 1), meses: 3, almacen: null });
    expect(h.map((m: { mes: string }) => m.mes)).toEqual(['2026-01', '2025-12', '2025-11']);
  });

  it('solo cuenta valores de listas cerradas: un texto del cliente no crea contadores', async () => {
    const almacen = almacenSqlite();
    contarVisita({ disp: '<script>alert(1)</script>', red: '/v/mi-slug' }, OCT);
    contarPagina({ disp: 'movil', ruta: '/v/mi-slug' }, OCT);
    await vaciar(almacen);
    const claves = (almacen.db.prepare('SELECT clave FROM estadistica_mes').all() as Array<{ clave: string }>).map((r) => r.clave);
    expect(claves.join('|')).not.toMatch(/script|slug|\//);
    expect(claves).toEqual(expect.arrayContaining(['visitas', 'conexion:desconocida']));
  });
});

describe('histórico mensual: persistencia', () => {
  it('vaciar() guarda en la base y sobrevive a un reinicio (se vuelve a leer de la base)', async () => {
    const almacen = almacenSqlite();
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    contarPagina({ disp: 'movil', ruta: 'ficha' }, OCT);
    contarPico(4, OCT);
    expect(await vaciar(almacen)).toBeGreaterThan(0);
    __reiniciarHistorial(); // «se reinició el servicio»: la memoria se pierde, la base no
    const o = await mes('2026-10', { almacen });
    expect(o).toMatchObject({ visitas: 1, pico: 4 });
    expect(o.pagina.ficha).toBe(1);
    expect(o.conexion['4g']).toBe(1);
  });

  it('los vaciados SUMAN (no se pisan) y lo ya volcado no se cuenta dos veces', async () => {
    const almacen = almacenSqlite();
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    await vaciar(almacen);
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    contarVisita({ disp: 'escritorio', red: '4g' }, OCT);
    // Con parte en la base y parte aún en memoria, la lectura suma ambas UNA vez.
    expect((await mes('2026-10', { almacen })).visitas).toBe(3);
    await vaciar(almacen);
    expect((await mes('2026-10', { almacen })).visitas).toBe(3);
    expect((await mes('2026-10', { almacen })).dispositivo).toEqual({ movil: 2, escritorio: 1 });
  });

  it('dos procesos que escriben el mismo mes se suman (UPSERT que suma)', async () => {
    const almacen = almacenSqlite();
    contarVisita({ disp: 'movil', red: '3g' }, OCT);
    await vaciar(almacen);
    __reiniciarHistorial(); // otro proceso, mismo mes
    contarVisita({ disp: 'movil', red: '3g' }, OCT);
    await vaciar(almacen);
    expect((await mes('2026-10', { almacen })).visitas).toBe(2);
  });

  it('el pico guardado solo sube', async () => {
    const almacen = almacenSqlite();
    contarPico(5, OCT);
    await vaciar(almacen);
    contarPico(3, OCT);
    await vaciar(almacen);
    expect((await mes('2026-10', { almacen })).pico).toBe(5);
    contarPico(9, OCT);
    await vaciar(almacen);
    expect((await mes('2026-10', { almacen })).pico).toBe(9);
  });

  it('si la base falla, NO se pierde nada: se reintenta con lo acumulado', async () => {
    const almacen = almacenSqlite();
    almacen.fallos = 1;
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    contarPico(6, OCT);
    expect(await vaciar(almacen)).toBe(0);
    expect((await mes('2026-10', { almacen })).visitas).toBe(1); // sigue en memoria
    expect(await vaciar(almacen)).toBeGreaterThan(0);
    const o = await mes('2026-10', { almacen });
    expect(o).toMatchObject({ visitas: 1, pico: 6 });
  });

  it('sin base configurada no falla: todo queda en memoria', async () => {
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    expect(await vaciar(null)).toBe(0);
    expect((await mes('2026-10', { almacen: null })).visitas).toBe(1);
  });

  it('una base ilegible no tumba la lectura: devuelve lo que hay en memoria', async () => {
    const roto = { execute: async () => { throw new Error('sin base'); }, batch: async () => undefined };
    contarVisita({ disp: 'movil', red: '4g' }, OCT);
    expect((await mes('2026-10', { almacen: roto })).visitas).toBe(1);
  });

  it('mesDe da el mes en UTC', () => {
    expect(mesDe(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10');
    expect(mesDe(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11');
  });
});
