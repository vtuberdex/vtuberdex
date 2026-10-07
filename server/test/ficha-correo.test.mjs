/** Correo asociado a una ficha: lo fijado a mano manda sobre la inscripción y se puede quitar. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { fijarGraduado, idsGraduados, fichasDelTitular, correoDeLaFicha, correoTieneFicha, correosDeFichas, ejecutorSqlite, fijarCorreoDeFicha, conTablas } from '../src/solicitudes.mjs';

const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const resolverFicha = (slug) => ({ aaa: { id: 1, slug: 'aaa' }, bbb: { id: 2, slug: 'bbb' } })[slug] ?? null;

async function inscripcionAprobada(e, slug, email) {
  await conTablas(e);
  await e.execute(
    `INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado, vtuber_slug)
     VALUES ('inscripcion', 'aprobada', '{}', ?, 'r', 'v', 'x', 'x', ?)`,
    [JSON.stringify({ email }), slug],
  );
}

test('fijar, corregir y quitar el correo de una ficha del scrape', async () => {
  const e = nuevo();
  assert.equal((await correosDeFichas(e, { resolverFicha })).size, 0);
  assert.equal(await fijarCorreoDeFicha(e, 2, '  Ana@Ejemplo.COM '), 'ana@ejemplo.com');
  assert.equal(await correoDeLaFicha(e, { fichaId: 2, resolverFicha }), 'ana@ejemplo.com');
  await fijarCorreoDeFicha(e, 2, 'otra@ejemplo.com');
  assert.equal((await correosDeFichas(e, { resolverFicha })).get(2), 'otra@ejemplo.com');
  assert.equal(await fijarCorreoDeFicha(e, 2, ''), null);
  assert.equal(await correoDeLaFicha(e, { fichaId: 2, resolverFicha }), null);
});

test('un correo inválido se rechaza', async () => {
  await assert.rejects(fijarCorreoDeFicha(nuevo(), 1, 'no-es-correo'), { code: 'correo_invalido' });
});

test('el correo fijado a mano gana al de la inscripción aprobada', async () => {
  const e = nuevo();
  await inscripcionAprobada(e, 'aaa', 'insc@ejemplo.com');
  assert.equal((await correosDeFichas(e, { resolverFicha })).get(1), 'insc@ejemplo.com');
  await fijarCorreoDeFicha(e, 1, 'nuevo@ejemplo.com');
  assert.equal((await correosDeFichas(e, { resolverFicha })).get(1), 'nuevo@ejemplo.com');
  assert.equal(await correoDeLaFicha(e, { fichaId: 1, resolverFicha }), 'nuevo@ejemplo.com');
});

test('correoTieneFicha: inscripción aprobada o correo fijado a mano; si no, no', async () => {
  const e = nuevo();
  assert.equal(await correoTieneFicha(e, 'insc@ejemplo.com'), false);
  await inscripcionAprobada(e, 'aaa', 'insc@ejemplo.com');
  assert.equal(await correoTieneFicha(e, ' INSC@ejemplo.com '), true);
  await fijarCorreoDeFicha(e, 2, 'manual@ejemplo.com');
  assert.equal(await correoTieneFicha(e, 'manual@ejemplo.com'), true);
  assert.equal(await correoTieneFicha(e, 'otro@ejemplo.com'), false);
});

test('fichasDelTitular: el correo fijado a mano solo cuenta si se pide (Mi ficha), y sin distinguir mayúsculas', async () => {
  const e = nuevo();
  const porId = (id) => ({ 1: { id: 1, slug: 'aaa' }, 2: { id: 2, slug: 'bbb' } })[id] ?? null;
  await inscripcionAprobada(e, 'aaa', 'Insc@Ejemplo.com');
  await fijarCorreoDeFicha(e, 2, 'mano@ejemplo.com');
  assert.deepEqual((await fichasDelTitular(e, { email: 'mano@ejemplo.com', resolverFicha })).length, 0);
  const manual = await fichasDelTitular(e, { email: 'MANO@ejemplo.com', resolverFicha, resolverPorId: porId });
  assert.deepEqual(manual.map((f) => f.ficha.id), [2]);
  const insc = await fichasDelTitular(e, { email: 'insc@ejemplo.com', resolverFicha, resolverPorId: porId });
  assert.deepEqual(insc.map((f) => f.ficha.id), [1]);
});

test('graduados: marcar, repetir sin duplicar y desmarcar', async () => {
  const e = nuevo();
  assert.equal((await idsGraduados(e)).size, 0);
  await fijarGraduado(e, 3);
  await fijarGraduado(e, 3);
  assert.deepEqual([...(await idsGraduados(e))], [3]);
  await fijarGraduado(e, 3, false);
  assert.equal((await idsGraduados(e)).size, 0);
});
