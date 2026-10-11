/** El equilibrio de stats: una regla para todos, nivel/EXP fuera. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { equilibrarStats, topeDeStatBase, valorEquilibrado } from '../src/equilibrio.mjs';
import { calcularPoder } from '../src/mutations.mjs';

test('un stat de nivel 100 se limita a 1,5 x el p90 y uno normal pasa intacto', () => {
  const r = equilibrarStats([{ slug: 'attack', value: 950 }, { slug: 'defense', value: 131 }, { slug: 'hp', value: 12440, max: 12440 }]);
  assert.equal(r[0].value, topeDeStatBase('attack'));
  assert.equal(r[1].value, 131);
  assert.equal(r[2].value, topeDeStatBase('hp'));
  assert.equal(r[2].max, topeDeStatBase('hp'));
});

test('nivel y EXP salen de la lista y un stat desconocido no se toca', () => {
  const r = equilibrarStats([{ slug: 'level', value: 100 }, { slug: 'exp', value: 5980260 }, { slug: 'rareza', value: 9999 }]);
  assert.deepEqual(r, [{ slug: 'rareza', value: 9999 }]);
});

test('el poder de una ficha con stats inflados queda en el orden de las demás, y EXP no cuenta', () => {
  const normal = calcularPoder([{ slug: 'attack', value: 236 }, { slug: 'magicAttack', value: 233 }]);
  const inflada = calcularPoder([{ slug: 'attack', value: 950 }, { slug: 'magicAttack', value: 1063 }, { slug: 'exp', value: 5980260 }]);
  assert.ok(inflada < normal * 2);
  assert.equal(valorEquilibrado('exp', 5), 5);
});
