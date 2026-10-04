/**
 * Tests del DIARIO de cambios del mantenedor en producción (`lib/diario.mjs`).
 *
 * Lo que se fija aquí es el contrato que ninguna otra suite ve: que un cambio guardado en el
 * diario de Turso se VE después en otra instancia (la que arranca en frío y reproduce el diario),
 * y que lo que las reglas rechazan NO llega a escribirse. Turso se sustituye por un cliente falso
 * respaldado por SQLite en memoria: la suite corre en CI sin credenciales ni red.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// --- Turso falso: SQLite en memoria con la misma interfaz que usa `lib/ediciones.mjs`.
const turso = new DatabaseSync(':memory:');
/** Cuántas veces se preguntó la clave del diario (la consulta con `MAX(seq)`). */
let consultasDeClave = 0;
const clienteFalso = {
  execute: async (arg: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    if (/MAX\(seq\)/i.test(sql)) consultasDeClave += 1;
    const args = (typeof arg === 'string' ? [] : (arg.args ?? [])) as never[];
    const sentencia = turso.prepare(sql);
    if (/^\s*(select|pragma)/i.test(sql)) {
      const rows = sentencia.all(...args).map((fila) => ({ ...fila }));
      return { rows, rowsAffected: 0 };
    }
    const info = sentencia.run(...args);
    return { rows: [], rowsAffected: Number(info.changes), lastInsertRowid: BigInt(info.lastInsertRowid) };
  },
  executeMultiple: async (sql: string) => {
    turso.exec(sql);
  },
  batch: async () => ({}),
};
vi.mock('@libsql/client/node', () => ({ createClient: () => clienteFalso }));

const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  vtubers: [
    { dexNumber: 18, slug: 'gkuro', name: 'GKuro', countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }], languages: ['es'], groups: [], artists: [], source: { hasDetail: true }, assets: {}, detail: { phrase: 'hola', profile: [], factions: ['Netherbane2', 'Primal Monarch', 'Terran'], stats: {}, skills: [], socials: [] } },
    { dexNumber: 30, slug: 'drawchii', name: 'Drawchii', countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }], languages: ['es'], groups: [], artists: [], source: { hasDetail: false }, assets: {}, detail: null },
  ],
};

let dir: string;
type Diario = typeof import('@/lib/diario.mjs');
let diario: Diario;
let buscar: typeof import('@/server/src/search.mjs');

/** Una instancia FRÍA: olvida la copia vigente y vuelve a importar con el módulo limpio. */
async function instanciaFria() {
  diario.reiniciarDiario();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-diario-'));
  const dbPath = path.join(dir, 'catalogo.db');
  const { openDatabase } = await import('@/server/src/db/index.mjs');
  const { seedDatabase } = await import('@/server/src/seed.mjs');
  const db = openDatabase(dbPath);
  seedDatabase({ db, dataset: DATASET });
  db.close();
  process.env.VTUBERDEX_DB = dbPath;
  process.env.TURSO_DATABASE_URL = 'http://turso-de-mentira';
  process.env.TURSO_AUTH_TOKEN = 'no-hace-falta';
  vi.resetModules();
  diario = await import('@/lib/diario.mjs');
  buscar = await import('@/server/src/search.mjs');
});

afterAll(() => {
  diario.reiniciarDiario();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  turso.exec('DROP TABLE IF EXISTS cambio; DROP TABLE IF EXISTS edicion; DROP TABLE IF EXISTS asset_remoto;');
  // El memo del DDL vive en el módulo: se vuelve a crear con un módulo limpio.
  vi.resetModules();
  diario = await import('@/lib/diario.mjs');
  await instanciaFria();
});

type Carta = { id: number; slug: string; dexNumber: number; status: string };
const cartas = async (): Promise<Carta[]> =>
  buscar.searchVtubers(await diario.dbConDiario(), { includeHidden: true, perPage: 100 }).items as Carta[];
/** Id de una ficha del catálogo de prueba, por slug. */
const idDe = async (slug: string): Promise<number> =>
  ((await diario.dbConDiario()).prepare('SELECT id FROM vtuber WHERE slug = ?').get(slug) as { id: number }).id;

describe('la clave del diario no se pregunta en cada lectura pública', () => {
  // Este coste no lo ve ningún otro gate: la respuesta es idéntica con 1 consulta o con 100.
  test('con TTL, una ráfaga de lecturas comparte UNA consulta; sin TTL, cada lectura pregunta', async () => {
    await diario.dbConDiario({ ttlMs: 60_000 });
    consultasDeClave = 0;
    for (let i = 0; i < 5; i += 1) await diario.dbConDiario({ ttlMs: 60_000 });
    expect(consultasDeClave).toBe(0);
    for (let i = 0; i < 3; i += 1) await diario.dbConDiario();
    expect(consultasDeClave).toBe(3);
  });

  test('una escritura de esta instancia invalida el TTL: la siguiente lectura vuelve a preguntar', async () => {
    const id = await idDe('gkuro');
    await diario.dbConDiario({ ttlMs: 60_000 });
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { name: 'GKuro 2' } });
    // Otra instancia escribe en medio: la clave de ESTA ya no coincide con la de Turso.
    turso.prepare("INSERT INTO cambio (tipo, payload, actor, creado) VALUES ('vtuber.editar', ?, 'x', 'x')").run(
      JSON.stringify({ tipo: 'vtuber.editar', id, patch: { name: 'GKuro 3' } }),
    );
    consultasDeClave = 0;
    await diario.dbConDiario(); // sin TTL: pregunta y reconstruye
    expect(consultasDeClave).toBe(1);
    const fila = (await diario.dbConDiario({ ttlMs: 60_000 })).prepare('SELECT name FROM vtuber WHERE id = ?').get(id) as { name: string };
    expect(fila.name).toBe('GKuro 3');
  });
});

describe('el diario se reproduce en una instancia fría', () => {
  test('sin cambios, el catálogo sale tal cual', async () => {
    expect((await cartas()).map((c) => c.dexNumber)).toEqual([18, 30]);
  });

  test('el número de dex cambia, queda libre el anterior y se reproduce', async () => {
    const id = await idDe('gkuro');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { dexNumber: 'end' } });
    expect((await cartas()).map((c) => c.dexNumber)).toEqual([30, 31]);

    // Otra instancia (arranque en frío) ve lo mismo reproduciendo el diario.
    await instanciaFria();
    expect((await cartas()).map((c) => c.dexNumber)).toEqual([30, 31]);
    // Y el 18 quedó disponible: se puede reclamar para la otra ficha.
    const idDos = await idDe('drawchii');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id: idDos, patch: { dexNumber: 18 } });
    await instanciaFria();
    expect((await cartas()).map((c) => [c.slug, c.dexNumber])).toEqual([['drawchii', 18], ['gkuro', 31]]);
  });

  test('una regla que rechaza el cambio NO escribe en el diario', async () => {
    const id = await idDe('gkuro');
    await expect(diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { dexNumber: 30 } })).rejects.toMatchObject({
      status: 409,
      code: 'dex_ocupado',
    });
    expect(turso.prepare('SELECT COUNT(*) AS n FROM cambio').get()).toEqual({ n: 0 });
  });

  test('una carta creada recibe un id propio y sobrevive al arranque en frío', async () => {
    const { resultado } = await diario.aplicarYAnotar({ tipo: 'vtuber.crear', datos: { name: 'Nueva Estrella' } });
    const { id: idNueva } = resultado as { id: number };
    expect(idNueva).toBeGreaterThan(100_000);
    await instanciaFria();
    const nueva = (await cartas()).find((c) => c.slug === 'nueva-estrella');
    expect(nueva).toMatchObject({ dexNumber: 31, status: 'draft' });
    expect(nueva?.id).toBe(idNueva);
  });

  test('cambiar la URL deja alias y se reproduce', async () => {
    const id = await idDe('gkuro');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { slug: 'kuro-oficial' } });
    await instanciaFria();
    const fresca = await diario.dbConDiario();
    expect(buscar.getVtuberBySlug(fresca, 'kuro-oficial', { includeHidden: true })?.id).toBe(id);
    expect(buscar.getVtuberBySlug(fresca, 'gkuro', { includeHidden: true })?.slug).toBe('kuro-oficial');
  });

  test('las facciones ya salen limpias del seed (sin variantes y máximo dos)', async () => {
    const db = await diario.dbConDiario();
    const faccionesDe = (slug: string) => buscar.getVtuberBySlug(db, slug, { includeHidden: true })!.factions;
    // El origen traía Netherbane2 + Primal Monarch + Terran: se funde y se recorta a dos.
    expect(faccionesDe('gkuro')).toEqual(['Netherbane', 'Primal Monarch']);
  });

  test('las ediciones antiguas de la tabla `edicion` se siguen aplicando', async () => {
    await diario.dbConDiario(); // crea las tablas
    turso.prepare('INSERT INTO edicion (slug, campo, valor) VALUES (?, ?, ?)').run('drawchii', 'phrase', '"Frase vieja"');
    await instanciaFria();
    const detalle = buscar.getVtuberBySlug(await diario.dbConDiario(), 'drawchii', { includeHidden: true });
    expect(detalle?.phrase).toBe('Frase vieja');
  });

  test('estado masivo y facciones: crear, fusionar y recontar', async () => {
    const a = (await diario.aplicarYAnotar({ tipo: 'faccion.crear', datos: { label: 'Nueva Liga' } })).resultado as { id: number };
    expect(a.id).toBeGreaterThan(1_000);
    const id = await idDe('drawchii');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { factions: ['nueva-liga'] } });
    await diario.aplicarYAnotar({ tipo: 'vtuber.estado', ids: [id], status: 'hidden' });
    await instanciaFria();
    const fresca = await diario.dbConDiario();
    expect(buscar.getVtuberBySlug(fresca, 'drawchii')).toBeNull(); // oculta
    expect(buscar.getVtuberBySlug(fresca, 'drawchii', { includeHidden: true })?.factions).toEqual(['Nueva Liga']);
  });

  test('el emblema de una facción creada se guarda en el diario con su ruta versionada', async () => {
    const { resultado } = await diario.aplicarYAnotar({ tipo: 'faccion.crear', datos: { label: 'Con Emblema' } });
    const { id } = resultado as { id: number };
    const ruta = 'images/faction/con-emblema.png?v=123';
    await diario.aplicarYAnotar({ tipo: 'faccion.editar', id, patch: { icon: ruta } });
    await instanciaFria();
    const fila = (await diario.dbConDiario()).prepare('SELECT icon FROM faction WHERE id = ?').get(id) as { icon: string };
    expect(fila.icon).toBe(ruta);
    // La carta que la usa expone el emblema versionado como URL pública.
    const gkuro = await idDe('gkuro');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id: gkuro, patch: { factions: ['con-emblema'] } });
    const detalle = buscar.getVtuberBySlug(await diario.dbConDiario(), 'gkuro', { includeHidden: true });
    expect(detalle?.factionIcons?.[0]?.icon).toBe(`/${ruta}`);
  });
});

describe('cartas premium en producción', () => {
  const premiumDe = async (slug: string) =>
    buscar.getVtuberBySlug(await diario.dbConDiario(), slug, { includeHidden: true })?.premium ?? null;

  test('el premium se guarda en el diario CON sus fechas y otra instancia lo reproduce idéntico', async () => {
    const id = await idDe('gkuro');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { premium: { grade: '10' } } });
    const guardado = JSON.parse((turso.prepare('SELECT payload FROM cambio ORDER BY seq DESC LIMIT 1').get() as { payload: string }).payload);
    // El DÍA viaja en la operación: reproducirla otro día no puede mover la antigüedad.
    expect(guardado.patch.premium.grade).toBe('10');
    expect(guardado.patch.premium.ahora).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(guardado.patch.premium.since).toBeUndefined();

    const enEstaInstancia = await premiumDe('gkuro');
    await instanciaFria();
    const enOtra = await premiumDe('gkuro');
    expect(enOtra).toEqual(enEstaInstancia);
    expect(enOtra).toMatchObject({ grade: '10', cert: `VTD-${String(id).padStart(6, '0')}` });
    expect(await premiumDe('drawchii')).toBeNull();
  });

  test('subir de grado, y quitarlo, también sobreviven al arranque en frío', async () => {
    const id = await idDe('drawchii');
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { premium: { grade: '8', since: '2026-01-10' } } });
    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { premium: { grade: '8.5', gradedAt: '2026-02-10' } } });
    await instanciaFria();
    expect(await premiumDe('drawchii')).toMatchObject({ grade: '8.5', since: '2026-01-10', gradedAt: '2026-02-10' });
    const filtrada = buscar.searchVtubers(await diario.dbConDiario(), { premium: true });
    expect(filtrada.items.map((item) => item?.slug)).toEqual(['drawchii']);

    await diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { premium: null } });
    await instanciaFria();
    expect(await premiumDe('drawchii')).toBeNull();
  });

  test('un grado inválido NO se escribe en el diario', async () => {
    const id = await idDe('gkuro');
    const antes = (turso.prepare('SELECT COUNT(*) AS n FROM cambio').get() as { n: number }).n;
    await expect(
      diario.aplicarYAnotar({ tipo: 'vtuber.editar', id, patch: { premium: { grade: '11' } } }),
    ).rejects.toMatchObject({ code: 'grado_invalido' });
    expect((turso.prepare('SELECT COUNT(*) AS n FROM cambio').get() as { n: number }).n).toBe(antes);
  });
});
