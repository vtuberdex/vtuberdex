/** Puntos de habilidad al subir de nivel y el aviso de subida: las reglas del almacén, sobre SQLite en memoria. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { PUNTOS_POR_NIVEL, RANGO_MAXIMO } from '../src/experiencia.mjs';
import {
  PuntosError,
  claveDeHabilidad,
  estadoDePuntos,
  habilidadesMejorables,
  reclamarAvisoDeNivel,
  reiniciarRangos,
  soltarAvisoDeNivel,
  subirHabilidad,
} from '../src/mi-ficha.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const SKILLS = [
  { category: 'active', name: 'Rayo Láser', type: 'Ataque' },
  { category: 'passive', name: 'Voz Dulce' },
  { category: 'ultimate', name: 'Gran Final' },
  { category: 'other', name: null },
  { category: 'active', name: 'rayo laser' }, // repetida salvo tildes y mayúsculas
];
const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const entrada = (nivelesGanados, extra = {}) => ({ vtuberId: 7, skills: SKILLS, nivelesGanados, ...extra });
const mensajeDe = async (promesa) => promesa.then(() => null, (e) => e);

test('solo se mejoran las habilidades con nombre y sin repetir', () => {
  assert.deepEqual(habilidadesMejorables(SKILLS).map((h) => h.name), ['Rayo Láser', 'Voz Dulce', 'Gran Final']);
  assert.equal(claveDeHabilidad({ category: 'active', name: ' RAYO láser ' }), claveDeHabilidad({ category: 'active', name: 'rayo laser' }));
});

test('los puntos son nivelesGanados × PUNTOS_POR_NIVEL menos lo repartido', async () => {
  const e = nuevo();
  const sin = await estadoDePuntos(e, entrada(0));
  assert.equal(sin.disponibles, 0);
  const dos = await estadoDePuntos(e, entrada(2));
  assert.equal(dos.ganados, 2 * PUNTOS_POR_NIVEL);
  assert.equal(dos.disponibles, 2 * PUNTOS_POR_NIVEL);
  const clave = claveDeHabilidad(SKILLS[0]);
  const despues = await subirHabilidad(e, { ...entrada(2), clave });
  assert.equal(despues.disponibles, 2 * PUNTOS_POR_NIVEL - 1);
  assert.equal(despues.habilidades.find((h) => h.clave === clave).rango, 1);
});

test('sin puntos no se sube, y con puntos el rango tiene tope', async () => {
  const e = nuevo();
  const clave = claveDeHabilidad(SKILLS[0]);
  const error = await mensajeDe(subirHabilidad(e, { ...entrada(0), clave }));
  assert.ok(error instanceof PuntosError);
  assert.equal(error.code, 'sin_puntos');
  // 10 niveles = 30 puntos: sobra para topar una habilidad.
  for (let i = 0; i < RANGO_MAXIMO; i += 1) await subirHabilidad(e, { ...entrada(10), clave });
  const tope = await mensajeDe(subirHabilidad(e, { ...entrada(10), clave }));
  assert.equal(tope.code, 'rango_maximo');
  assert.equal((await estadoDePuntos(e, entrada(10))).habilidades.find((h) => h.clave === clave).rango, RANGO_MAXIMO);
});

test('una habilidad inexistente se rechaza, y dos clics a la vez no gastan un punto que no existe', async () => {
  const e = nuevo();
  assert.equal((await mensajeDe(subirHabilidad(e, { ...entrada(1), clave: 'active:no-existe' }))).code, 'habilidad_no_encontrada');
  // 1 nivel = 3 puntos; 6 clics simultáneos: solo 3 pueden entrar.
  const claves = habilidadesMejorables(SKILLS).map((h) => h.clave);
  const resultados = await Promise.all(claves.concat(claves).map((clave) => mensajeDe(subirHabilidad(e, { ...entrada(1), clave }))));
  const estado = await estadoDePuntos(e, entrada(1));
  assert.ok(estado.repartidos <= estado.ganados, `repartidos ${estado.repartidos} > ganados ${estado.ganados}`);
  assert.ok(resultados.some((r) => r === null));
});

test('reiniciar devuelve todos los puntos', async () => {
  const e = nuevo();
  await subirHabilidad(e, { ...entrada(1), clave: claveDeHabilidad(SKILLS[1]) });
  const r = await reiniciarRangos(e, entrada(1));
  assert.equal(r.repartidos, 0);
  assert.equal(r.disponibles, PUNTOS_POR_NIVEL);
});

test('una habilidad renombrada deja de contar (no resta puntos) y reaparece si vuelve a su nombre', async () => {
  const e = nuevo();
  await subirHabilidad(e, { ...entrada(1), clave: claveDeHabilidad(SKILLS[0]) });
  const sin = await estadoDePuntos(e, { ...entrada(1), skills: [{ category: 'active', name: 'Otro Nombre' }] });
  assert.equal(sin.repartidos, 0);
  assert.equal(sin.disponibles, PUNTOS_POR_NIVEL);
  assert.equal((await estadoDePuntos(e, entrada(1))).repartidos, 1);
});

test('el aviso de nivel lo gana UNA sola llamada, y solo si subió con likes', async () => {
  const e = nuevo();
  assert.equal(await reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 5, nivelBase: 5 }), false);
  const [a, b] = await Promise.all([
    reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 6, nivelBase: 5 }),
    reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 6, nivelBase: 5 }),
  ]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(await reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 6, nivelBase: 5 }), false);
  assert.equal(await reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 7, nivelBase: 5 }), true);
  // Si el correo falló, se suelta y el siguiente like lo reintenta.
  await soltarAvisoDeNivel(e, { vtuberId: 1, nivel: 7 });
  assert.equal(await reclamarAvisoDeNivel(e, { vtuberId: 1, nivel: 7, nivelBase: 5 }), true);
});
