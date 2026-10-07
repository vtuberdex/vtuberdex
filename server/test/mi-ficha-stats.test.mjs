/** Puntos de STATS: bolsa aparte de la de habilidades (10 por nivel) y stats que suben solos con los niveles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { PUNTOS_POR_NIVEL, PUNTOS_STATS_POR_NIVEL } from '../src/experiencia.mjs';
import {
  PuntosError,
  aplicarPuntosAStats,
  bonoAutomatico,
  estadoDePuntos,
  estadoDeStats,
  leerPuntosDeStats,
  reiniciarStats,
  subirHabilidad,
  subirStat,
} from '../src/mi-ficha.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const STATS = [
  { slug: 'hp', label: 'HP', value: 1000, max: 1000 },
  { slug: 'attack', label: 'Ataque', value: 100, max: null },
  { slug: 'speed', label: 'Velocidad', value: 90, max: null },
  { slug: 'evasion', label: 'Evasión', value: 98, max: null },
  { slug: 'luck', label: 'Suerte', value: 18, max: null },
  { slug: 'level', label: 'Nivel', value: 5, max: null },
];
const SKILLS = [{ category: 'active', name: 'Rayo' }];
const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const entrada = (nivelesGanados) => ({ vtuberId: 7, stats: STATS, nivelesGanados });
const fallo = (p) => p.then(() => null, (e) => e);

test('cada nivel da 10 puntos de stats y solo HP, MP, ataques y defensas se gastan', async () => {
  const e = nuevo();
  const e0 = await estadoDeStats(e, entrada(2));
  assert.equal(e0.ganados, 2 * PUNTOS_STATS_POR_NIVEL);
  assert.deepEqual(e0.stats.map((s) => s.slug), ['hp', 'attack']);
  const e1 = await subirStat(e, { ...entrada(2), slug: 'hp' });
  assert.equal(e1.stats.find((s) => s.slug === 'hp').valor, 1050);
  assert.equal(e1.disponibles, 19);
  assert.equal((await fallo(subirStat(e, { ...entrada(2), slug: 'speed' }))).code, 'stat_no_encontrado');
  assert.equal((await fallo(subirStat(e, { ...entrada(2), slug: 'level' }))).code, 'stat_no_encontrado');
});

test('sin puntos no se puede subir y no se pasa de lo ganado', async () => {
  const e = nuevo();
  assert.equal((await fallo(subirStat(e, { ...entrada(0), slug: 'attack' }))).code, 'sin_puntos_stats');
  for (let i = 0; i < PUNTOS_STATS_POR_NIVEL; i += 1) await subirStat(e, { ...entrada(1), slug: 'attack' });
  const error = await fallo(subirStat(e, { ...entrada(1), slug: 'attack' }));
  assert.ok(error instanceof PuntosError);
  assert.equal(error.code, 'sin_puntos_stats');
  assert.equal((await estadoDeStats(e, entrada(1))).stats.find((s) => s.slug === 'attack').valor, 100 + 10 * 5);
});

test('las bolsas de stats y de habilidades son independientes', async () => {
  const e = nuevo();
  await subirStat(e, { ...entrada(1), slug: 'hp' });
  const habilidades = await estadoDePuntos(e, { vtuberId: 7, skills: SKILLS, nivelesGanados: 1 });
  assert.equal(habilidades.disponibles, PUNTOS_POR_NIVEL);
  await subirHabilidad(e, { vtuberId: 7, skills: SKILLS, nivelesGanados: 1, clave: habilidades.habilidades[0].clave });
  assert.equal((await estadoDeStats(e, entrada(1))).disponibles, PUNTOS_STATS_POR_NIVEL - 1);
});

test('reiniciar devuelve los puntos de stats', async () => {
  const e = nuevo();
  await subirStat(e, { ...entrada(1), slug: 'hp' });
  const despues = await reiniciarStats(e, entrada(1));
  assert.equal(despues.repartidos, 0);
  assert.equal(despues.disponibles, PUNTOS_STATS_POR_NIVEL);
});

test('velocidad, evasión, precisión y crítico +1 cada 10 niveles; suerte +1 cada 20, máximo 20', () => {
  assert.equal(bonoAutomatico('speed', 90, 9), 0);
  assert.equal(bonoAutomatico('speed', 90, 10), 1);
  assert.equal(bonoAutomatico('speed', 90, 35), 3);
  assert.equal(bonoAutomatico('evasion', 98, 100), 2, 'la evasión no pasa de 100');
  assert.equal(bonoAutomatico('luck', 18, 19), 0);
  assert.equal(bonoAutomatico('luck', 18, 20), 1);
  assert.equal(bonoAutomatico('luck', 18, 200), 2, 'la suerte no pasa de 20');
  assert.equal(bonoAutomatico('luck', 25, 200), 0, 'una suerte base ya sobre el tope no baja ni sube');
  assert.equal(bonoAutomatico('attack', 100, 50), 0);
});

test('el estado lista los automáticos con su valor', async () => {
  const e = nuevo();
  const estado = await estadoDeStats(e, entrada(20));
  const vel = estado.automaticos.find((a) => a.slug === 'speed');
  assert.deepEqual([vel.base, vel.bono, vel.valor, vel.cada], [90, 2, 92, 10]);
  assert.equal(estado.automaticos.find((a) => a.slug === 'luck').valor, 19);
});

test('la ficha pública suma puntos y bonos; en HP también sube el máximo', async () => {
  const e = nuevo();
  await subirStat(e, { ...entrada(10), slug: 'hp' });
  await subirStat(e, { ...entrada(10), slug: 'hp' });
  const puestos = await leerPuntosDeStats(e, 7);
  const salida = aplicarPuntosAStats(STATS, puestos, 10);
  assert.deepEqual(salida.find((s) => s.slug === 'hp'), { slug: 'hp', label: 'HP', value: 1100, max: 1100 });
  assert.equal(salida.find((s) => s.slug === 'speed').value, 91);
  assert.equal(salida.find((s) => s.slug === 'level').value, 5);
  assert.equal(STATS[0].value, 1000, 'no muta la entrada');
});
