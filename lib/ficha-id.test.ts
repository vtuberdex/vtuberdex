import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reiniciarFichaId, idDeFichaPublica, nombresDeFichas } from './ficha-id.mjs';

function base(conPremium = true) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE vtuber (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, dex_number INTEGER, status TEXT);
    CREATE TABLE slug_alias (slug TEXT PRIMARY KEY, vtuber_id INTEGER);
    ${conPremium ? 'CREATE TABLE premium (vtuber_id INTEGER PRIMARY KEY, grade TEXT);' : ''}
    INSERT INTO vtuber VALUES (1, 'ana', 'Ana', 1, 'published'), (2, 'borrador', 'Borrador', 2, 'draft'),
                              (3, 'baja', 'Nombre Secreto', 3, 'published'), (4, 'oculta', 'Oculta', 4, 'hidden'), (5, 'bea', 'Bea', 5, 'published');
    INSERT INTO slug_alias VALUES ('ana-vieja', 1), ('baja-vieja', 3);
    ${conPremium ? "INSERT INTO premium VALUES (3, '1'), (5, '9');" : ''}
  `);
  return db;
}
const T = 1_000_000;

beforeEach(() => __reiniciarFichaId());
afterEach(() => __reiniciarFichaId());

describe('idDeFichaPublica', () => {
  it('una ficha publicada da su id', async () => {
    expect(await idDeFichaPublica('ana', { db: base(), ahora: T })).toBe(1);
    expect(await idDeFichaPublica('bea', { db: base(), ahora: T })).toBe(5); // una premium sigue siendo pública
  });

  it('un slug ANTIGUO sigue resolviendo a la ficha vigente', async () => {
    expect(await idDeFichaPublica('ana-vieja', { db: base(), ahora: T })).toBe(1);
  });

  it('un borrador, una oculta o un slug inexistente no cuentan', async () => {
    const db = base();
    for (const slug of ['borrador', 'oculta', 'no-existe']) expect(await idDeFichaPublica(slug, { db, ahora: T }), slug).toBeNull();
  });

  it('una ficha de BAJA (grado 1) no se confirma ni por su slug ni por su alias', async () => {
    const db = base();
    expect(await idDeFichaPublica('baja', { db, ahora: T })).toBeNull();
    expect(await idDeFichaPublica('baja-vieja', { db, ahora: T })).toBeNull();
  });

  it('lo que no tiene forma de slug se rechaza sin tocar la base', async () => {
    const db = { prepare: () => { throw new Error('no debía consultar'); } };
    for (const malo of ['', 'Ana', 'a b', '../x', "ana'; DROP TABLE vtuber;--", 'x'.repeat(200), null, undefined, 5, {}]) {
      expect(await idDeFichaPublica(malo, { db, ahora: T }), String(malo)).toBeNull();
    }
  });

  it('funciona con una base empaquetada sin tabla de premium', async () => {
    const db = base(false);
    expect(await idDeFichaPublica('ana', { db, ahora: T })).toBe(1);
    expect(await idDeFichaPublica('ana-vieja', { db, ahora: T })).toBe(1);
  });

  it('cachea: la misma ficha no vuelve a consultar durante unos minutos, y un «no» dura menos que un «sí»', async () => {
    let consultas = 0;
    const real = base();
    const db = { prepare: (sql: string) => { consultas += 1; return real.prepare(sql); } };
    await idDeFichaPublica('ana', { db, ahora: T });
    const tras1 = consultas;
    await idDeFichaPublica('ana', { db, ahora: T + 5 * 60_000 });
    expect(consultas).toBe(tras1); // sigue en caché
    await idDeFichaPublica('ana', { db, ahora: T + 11 * 60_000 });
    expect(consultas).toBeGreaterThan(tras1); // caducó
    consultas = 0;
    await idDeFichaPublica('nadie', { db, ahora: T });
    const tras = consultas;
    await idDeFichaPublica('nadie', { db, ahora: T + 30_000 });
    expect(consultas).toBe(tras);
    await idDeFichaPublica('nadie', { db, ahora: T + 61_000 });
    expect(consultas).toBeGreaterThan(tras);
  });
});

describe('nombresDeFichas', () => {
  it('da el nombre de las públicas y NO el de una baja ni el de una ficha no publicada', async () => {
    const m = await nombresDeFichas([1, 3, 2], { db: base() });
    expect(m.get(1)).toMatchObject({ nombre: 'Ana', dex: 1, slug: 'ana' });
    expect(m.get(3)).toMatchObject({ nombre: 'Ficha retirada', slug: null });
    expect(m.get(2)).toMatchObject({ nombre: 'Ficha retirada' });
    expect(JSON.stringify([...m.values()])).not.toContain('Secreto');
  });
  it('ignora ids inválidos, repetidos y no falla con una lista vacía', async () => {
    expect((await nombresDeFichas([], { db: base() })).size).toBe(0);
    expect((await nombresDeFichas([1, 1, -4, 2.5, NaN, 'x' as never], { db: base() })).size).toBe(1);
  });
});
