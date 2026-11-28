/** Misiones editables desde el panel: ajustes sobre el catálogo, misiones propias y desactivación. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { MISIONES, guardarMision, misionesTodas, misionesVigentes, restablecerMision, registrarAvances, misionesDeFicha } from '../src/misiones.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const DIA = '2026-10-21';
const base = MISIONES.find((m) => m.tipo === 'secundaria');
const propia = { nombre: 'Mi misión', descripcion: 'Una misión propia', tipo: 'secundaria', repetible: 'diaria', xp: 50, requisitos: { [Object.keys(base.requisitos)[0]]: 3 } };

test('sin ajustes las vigentes son exactamente el catálogo', async () => {
  const e = nuevo();
  assert.deepEqual((await misionesVigentes(e)).map((m) => m.id), MISIONES.map((m) => m.id));
});

test('un ajuste cambia solo lo enviado y restablecer devuelve el valor de catálogo', async () => {
  const e = nuevo();
  const r = await guardarMision(e, { id: base.id, cambios: { xp: 4321 }, actor: 'mad' });
  assert.equal(r.ok, true);
  const m = (await misionesVigentes(e)).find((x) => x.id === base.id);
  assert.equal(m.xp, 4321);
  assert.equal(m.nombre, base.nombre);
  assert.equal(await restablecerMision(e, { id: base.id }), true);
  assert.equal((await misionesVigentes(e)).find((x) => x.id === base.id).xp, base.xp);
});

test('una misión propia se crea, cuenta avances y se elimina al restablecer', async () => {
  const e = nuevo();
  const r = await guardarMision(e, { id: 'mia.prueba', cambios: propia, actor: 'mad' });
  assert.equal(r.ok, true);
  const [contador] = Object.keys(propia.requisitos);
  await registrarAvances(e, { vtuberId: 1, idLote: crypto.randomUUID(), avances: { [contador]: 3 }, dia: DIA });
  const ficha = await misionesDeFicha(e, { vtuberId: 1, dia: DIA });
  assert.ok(JSON.stringify(ficha).includes('mia.prueba'));
  await restablecerMision(e, { id: 'mia.prueba' });
  assert.ok(!(await misionesVigentes(e)).some((m) => m.id === 'mia.prueba'));
});

test('desactivar oculta la misión sin tocar el catálogo', async () => {
  const e = nuevo();
  await guardarMision(e, { id: base.id, cambios: { activa: false }, actor: 'mad' });
  assert.ok(!(await misionesVigentes(e)).some((m) => m.id === base.id));
  assert.equal((await misionesTodas(e)).find((m) => m.id === base.id).activa, false);
});

test('rechaza datos inválidos y no guarda nada', async () => {
  const e = nuevo();
  for (const cambios of [{ xp: -1 }, { xp: 1.5 }, { requisitos: { inexistente: 1 } }, { requisitos: {} }]) {
    const r = await guardarMision(e, { id: base.id, cambios, actor: 'mad' });
    assert.equal(r.ok, false, JSON.stringify(cambios));
    assert.equal(r.status, 400);
  }
  assert.equal((await guardarMision(e, { id: 'Mala Id', cambios: propia, actor: 'mad' })).ok, false);
  assert.equal((await guardarMision(e, { id: 'mia.sin-actor', cambios: propia, actor: '' })).ok, false);
  assert.deepEqual((await misionesVigentes(e)).map((m) => m.id), MISIONES.map((m) => m.id));
});

test('la ficha marca textoPropio solo cuando el panel cambió el texto', async () => {
  const e = nuevo();
  const otra = MISIONES.find((m) => m.tipo === 'secundaria' && m.id !== base.id);
  await guardarMision(e, { id: base.id, cambios: { descripcion: 'Texto nuevo' }, actor: 'mad' });
  await guardarMision(e, { id: otra.id, cambios: { xp: 99 }, actor: 'mad' });
  const { secundarias } = await misionesDeFicha(e, { vtuberId: 1, dia: DIA });
  assert.equal(secundarias.find((m) => m.id === base.id).textoPropio, true);
  assert.equal(secundarias.find((m) => m.id === otra.id).textoPropio, false);
});
