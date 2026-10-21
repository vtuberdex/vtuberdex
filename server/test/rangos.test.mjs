import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RANGOS, rangoDeNivel } from '../src/rangos.mjs';

test('la escalera está ordenada, empieza en el nivel 1 y no repite ids', () => {
  assert.equal(RANGOS[0].desde, 1);
  for (let i = 1; i < RANGOS.length; i += 1) assert.ok(RANGOS[i].desde > RANGOS[i - 1].desde);
  assert.equal(new Set(RANGOS.map((r) => r.id)).size, RANGOS.length);
});

test('cada nivel cae en el rango correcto y calcula cuánto falta para el siguiente', () => {
  assert.equal(rangoDeNivel(1).id, 'novato');
  assert.equal(rangoDeNivel(4).id, 'novato');
  assert.deepEqual(rangoDeNivel(4).siguiente, { id: 'aprendiz', desde: 5, faltan: 1 });
  assert.equal(rangoDeNivel(5).id, 'aprendiz');
  assert.equal(rangoDeNivel(34).id, 'elite');
  assert.equal(rangoDeNivel(35).id, 'maestro');
  assert.equal(rangoDeNivel(50).id, 'leyenda');
  assert.equal(rangoDeNivel(999).siguiente, null);
});

test('entradas absurdas no rompen: cuentan como nivel 1', () => {
  for (const x of [0, -3, NaN, undefined, null, 'abc']) assert.equal(rangoDeNivel(x).id, 'novato');
  assert.equal(rangoDeNivel('12').id, 'veterano');
});
